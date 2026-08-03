"use client";

import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_VIDEO_FILE_BYTES = 50 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain"
]);

export function UploadAttachment({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setMessage(null);

    try {
      const fileInput = form.elements.namedItem("file");
      const file = fileInput instanceof HTMLInputElement ? fileInput.files?.[0] : null;
      const validationMessage = validateAttachmentFile(file);
      if (validationMessage) {
        setMessage(validationMessage);
        return;
      }

      const formData = new FormData(form);
      formData.set("documentId", documentId);
      const response = await fetch("/api/attachments/upload", {
        method: "POST",
        body: formData
      });
      const payload = await readUploadResponse(response);
      setMessage(payload.ok ? payload.message ?? "Anexo enviado." : payload.error ?? "Falha no envio.");
      if (payload.ok) {
        form.reset();
        router.refresh();
      }
    } catch {
      setMessage("Falha no envio. Tente novamente em instantes.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-decorato-line bg-white p-4">
      <h2 className="text-lg font-semibold text-decorato-ink">Anexos</h2>
      <p className="mt-1 text-sm text-decorato-muted">PDF, documentos, imagens e vídeos até 50MB por arquivo.</p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="file"
          name="file"
          required
          accept="application/pdf,image/png,image/jpeg,image/webp,video/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
          className="block w-full text-sm text-decorato-muted file:mr-4 file:rounded-md file:border-0 file:bg-decorato-paper file:px-3 file:py-2 file:text-decorato-ink"
        />
        <Button type="submit" disabled={pending} variant="secondary">
          <Upload aria-hidden="true" size={18} />
          {pending ? "Enviando..." : "Enviar"}
        </Button>
      </div>
      {message ? <p className="mt-3 text-sm text-decorato-muted">{message}</p> : null}
    </form>
  );
}

function validateAttachmentFile(file: File | null | undefined) {
  if (!file) {
    return "Escolha um arquivo para enviar.";
  }

  const limit = file.type.startsWith("video/") ? MAX_VIDEO_FILE_BYTES : MAX_FILE_BYTES;
  if (file.size > limit) {
    return `Arquivo acima do limite de ${Math.round(limit / 1024 / 1024)}MB.`;
  }

  if (!ALLOWED_TYPES.has(file.type) && !file.type.startsWith("video/")) {
    return "Envie apenas PDF, documento, imagem ou video.";
  }

  return null;
}

async function readUploadResponse(response: Response): Promise<{ ok?: boolean; error?: string; message?: string }> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as { ok?: boolean; error?: string; message?: string };
  }

  return {
    ok: false,
    error: response.ok ? "Resposta inesperada do servidor." : `Falha no envio (${response.status}).`
  };
}

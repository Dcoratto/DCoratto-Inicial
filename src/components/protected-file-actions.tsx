"use client";

import { Download, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";

export function ProtectedFileActions({
  storagePath,
  fileName,
  compact = false
}: {
  storagePath: string;
  fileName: string;
  compact?: boolean;
}) {
  const [pending, setPending] = useState<"open" | "download" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolveUrl(action: "open" | "download") {
    setPending(action);
    setError(null);

    try {
      const response = await fetch(`/api/media/signed-url?path=${encodeURIComponent(storagePath)}`, {
        cache: "no-store"
      });
      const payload = (await response.json().catch(() => null)) as { signedUrl?: string; error?: string } | null;

      if (!response.ok || !payload?.signedUrl) {
        setError(payload?.error ?? "Nao foi possivel abrir o arquivo.");
        return;
      }

      const link = document.createElement("a");
      link.href = payload.signedUrl;
      link.target = "_blank";
      link.rel = "noreferrer";

      if (action === "download") {
        link.download = fileName;
      }

      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      setPending(null);
    }
  }

  const buttonClass = compact
    ? "inline-flex h-9 w-9 items-center justify-center rounded-md border border-decorato-line text-decorato-muted hover:text-decorato-ink"
    : "inline-flex items-center gap-2 rounded-md border border-decorato-line bg-white px-3 py-2 text-sm text-decorato-ink hover:bg-decorato-paper";

  return (
    <span className="flex shrink-0 flex-wrap items-center gap-1">
      <button
        type="button"
        onClick={() => void resolveUrl("open")}
        className={buttonClass}
        title="Abrir"
        aria-label="Abrir arquivo"
        disabled={pending !== null}
      >
        {pending === "open" ? <Loader2 aria-hidden="true" size={16} className="animate-spin" /> : <ExternalLink aria-hidden="true" size={16} />}
        {!compact ? "Abrir arquivo" : null}
      </button>
      <button
        type="button"
        onClick={() => void resolveUrl("download")}
        className={buttonClass}
        title="Baixar"
        aria-label="Baixar arquivo"
        disabled={pending !== null}
      >
        {pending === "download" ? <Loader2 aria-hidden="true" size={16} className="animate-spin" /> : <Download aria-hidden="true" size={16} />}
        {!compact ? "Baixar" : null}
      </button>
      {error ? <span className="basis-full text-xs text-red-600">{error}</span> : null}
    </span>
  );
}

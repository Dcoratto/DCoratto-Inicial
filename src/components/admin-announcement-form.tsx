"use client";

import { ImageUp, Loader2, Megaphone, Square, StretchHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Announcement, Category, Profile } from "@/types/app";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const BANNER_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function AdminAnnouncementForm({
  profiles,
  categories,
  mode = "create",
  announcement = null,
  selectedUserIds = [],
  selectedCategoryIds = []
}: {
  profiles: Profile[];
  categories: Category[];
  mode?: "create" | "edit";
  announcement?: Announcement | null;
  selectedUserIds?: string[];
  selectedCategoryIds?: string[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const isEdit = mode === "edit";
  const selectedUsers = new Set(selectedUserIds);
  const selectedCategories = new Set(selectedCategoryIds);
  const hasCurrentPopup = Boolean(announcement?.popup_media_storage_path || announcement?.media_storage_path);
  const hasCurrentBanner = Boolean(announcement?.banner_image_storage_path);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setMessage(null);
    setPending(true);

    try {
      const validationMessage = await validateAnnouncementForm(form, { hasCurrentPopup, hasCurrentBanner });
      if (validationMessage) {
        setMessage({ type: "error", text: validationMessage });
        return;
      }

      const formData = new FormData(form);
      const response = await fetch(isEdit ? "/api/announcements/update" : "/api/announcements/create", {
        method: "POST",
        body: formData
      });
      const payload = await readAnnouncementResponse(response);

      if (!response.ok || !payload?.ok) {
        setMessage({ type: "error", text: payload?.error ?? announcementResponseFallback(response.status) });
        return;
      }

      if (!isEdit) {
        form.reset();
      }
      setMessage({ type: "success", text: isEdit ? "Alteracoes salvas." : "Rascunho salvo." });
      router.refresh();
    } catch {
      setMessage({
        type: "error",
        text: "Não foi possível enviar o comunicado. Verifique sua conexão e confirme se os arquivos têm até 20MB."
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-5 space-y-4">
      {announcement?.id ? <input type="hidden" name="id" value={announcement.id} /> : null}
      <div className="rounded-lg border border-decorato-line bg-decorato-paper/70 p-4">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-decorato-ink">
          <Megaphone aria-hidden="true" size={17} className="text-decorato-coral" />
          Dados gerais
        </div>
      <label className="block">
          <span className="text-sm text-decorato-ink">Título</span>
        <input
          name="title"
          required
          maxLength={140}
          defaultValue={announcement?.title ?? ""}
          className="mt-2 h-11 w-full rounded-lg border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
        />
      </label>
        <label className="mt-4 block">
        <span className="text-sm text-decorato-ink">Mensagem</span>
        <textarea
          name="body"
          required
          maxLength={5000}
          rows={7}
          defaultValue={announcement?.body ?? ""}
          className="mt-2 w-full rounded-lg border border-decorato-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
        />
      </label>
      </div>

      <ScheduleBox
        checkboxName="popup_enabled"
        startsAtName="popup_starts_at"
        durationName="popup_duration_days"
        fileName="popup_media"
        accept="image/png,image/jpeg,image/webp,video/*"
        icon={<Square aria-hidden="true" size={17} className="text-decorato-teal" />}
        title="Popup"
        description="Aparece em uma janela modal quando o colaborador abre a Central."
        uploadLabel="Mídia do popup"
        instruction="Formato obrigatório: quadrado 1:1. Imagem recomendada: 1080x1080. Vídeo recomendado: quadrado."
        defaultChecked={announcement?.popup_enabled ?? false}
        defaultStartsAt={toDatetimeLocal(announcement?.popup_starts_at)}
        defaultDuration={durationDays(announcement?.popup_starts_at, announcement?.popup_ends_at)}
        currentMediaName={announcement?.popup_media_original_name ?? announcement?.media_original_name ?? null}
        removeName="remove_popup_media"
      />

      <ScheduleBox
        checkboxName="banner_enabled"
        startsAtName="banner_starts_at"
        durationName="banner_duration_days"
        fileName="banner_image"
        accept="image/png,image/jpeg,image/webp"
        icon={<StretchHorizontal aria-hidden="true" size={18} className="text-decorato-coral" />}
        title="Banner na tela inicial"
        description="Aparece como destaque visual horizontal na primeira tela."
        uploadLabel="Imagem do banner"
        instruction="Formato obrigatório: banner horizontal 1920x600. Vídeos não são aceitos."
        defaultChecked={announcement?.banner_enabled ?? false}
        defaultStartsAt={toDatetimeLocal(announcement?.banner_starts_at)}
        defaultDuration={durationDays(announcement?.banner_starts_at, announcement?.banner_ends_at)}
        currentMediaName={announcement?.banner_image_original_name ?? null}
        removeName="remove_banner_image"
      />

      <fieldset className="rounded-lg border border-decorato-line p-4">
        <legend className="px-1 text-sm text-decorato-ink">Departamentos</legend>
        <p className="mb-3 text-xs text-decorato-muted">Selecione departamentos específicos ou deixe vazio para comunicado global.</p>
        <div className="max-h-44 space-y-2 overflow-y-auto pr-2">
          {categories.map((category) => (
            <label key={category.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-decorato-paper">
              <input
                type="checkbox"
                name="target_category_ids"
                value={category.id}
                defaultChecked={selectedCategories.has(category.id)}
                className="h-4 w-4 rounded"
              />
              <span className="min-w-0 truncate">{category.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-decorato-line p-4">
        <legend className="px-1 text-sm text-decorato-ink">Colaboradores</legend>
        <p className="mb-3 text-xs text-decorato-muted">
          Use apenas quando o comunicado for para pessoas específicas. Sem seleção de departamentos e colaboradores, aparece para todos.
        </p>
        <div className="max-h-52 space-y-2 overflow-y-auto pr-2">
          {profiles.map((profile) => (
            <label key={profile.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-decorato-paper">
              <input
                type="checkbox"
                name="target_user_ids"
                value={profile.id}
                defaultChecked={selectedUsers.has(profile.id)}
                className="h-4 w-4 rounded"
              />
              <span className="min-w-0 truncate">
                {profile.full_name || profile.username || profile.email}{" "}
                <span className="text-xs text-decorato-muted">({profile.role})</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {message ? (
        <p
          className={
            message.type === "error"
              ? "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              : "rounded-md border border-decorato-teal/25 bg-decorato-teal/10 px-3 py-2 text-sm text-decorato-ink"
          }
        >
          {message.text}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 aria-hidden="true" size={18} className="animate-spin" /> : null}
        {pending ? "Salvando..." : isEdit ? "Salvar alteracoes" : "Salvar rascunho"}
      </Button>
    </form>
  );
}

function ScheduleBox({
  checkboxName,
  startsAtName,
  durationName,
  fileName,
  accept,
  icon,
  title,
  description,
  uploadLabel,
  instruction,
  defaultChecked = false,
  defaultStartsAt = "",
  defaultDuration = 7,
  currentMediaName = null,
  removeName
}: {
  checkboxName: string;
  startsAtName: string;
  durationName: string;
  fileName: string;
  accept: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  uploadLabel: string;
  instruction: string;
  defaultChecked?: boolean;
  defaultStartsAt?: string;
  defaultDuration?: number;
  currentMediaName?: string | null;
  removeName?: string;
}) {
  return (
    <div className="rounded-lg border border-decorato-line bg-decorato-paper/70 p-4">
      <label className="flex items-start gap-2 text-sm text-decorato-ink">
        <input
          type="checkbox"
          name={checkboxName}
          defaultChecked={defaultChecked}
          className="mt-0.5 h-4 w-4 rounded border-decorato-line"
        />
        <span>
          <span className="flex items-center gap-2 font-semibold">
            {icon}
            {title}
          </span>
          <span className="mt-1 block text-xs leading-5 text-decorato-muted">{description}</span>
        </span>
      </label>
      <label className="mt-4 block">
        <span className="text-sm text-decorato-ink">{uploadLabel}</span>
        <input
          type="file"
          name={fileName}
          accept={accept}
          className="mt-2 block w-full text-sm text-decorato-muted file:mr-4 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-2 file:text-decorato-ink"
        />
        <span className="mt-1 flex items-start gap-1 text-xs leading-5 text-decorato-muted">
          <ImageUp aria-hidden="true" size={13} className="mt-0.5 shrink-0" />
          {instruction} Imagens são convertidas para WebP automaticamente.
        </span>
        {currentMediaName ? (
          <div className="mt-2 rounded-md border border-decorato-line bg-white px-3 py-2 text-xs text-decorato-muted">
            Midia atual: <span className="text-decorato-ink">{currentMediaName}</span>
            {removeName ? (
              <span className="mt-2 flex items-center gap-2">
                <input type="checkbox" name={removeName} className="h-4 w-4 rounded" />
                Remover midia atual
              </span>
            ) : null}
          </div>
        ) : null}
      </label>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label>
          <span className="text-sm text-decorato-ink">Início</span>
          <input
            type="datetime-local"
            name={startsAtName}
            defaultValue={defaultStartsAt}
            className="mt-2 h-11 w-full rounded-lg border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
          />
        </label>
        <label>
          <span className="text-sm text-decorato-ink">Duração em dias</span>
          <input
            type="number"
            name={durationName}
            min={1}
            max={60}
            defaultValue={defaultDuration}
            className="mt-2 h-11 w-full rounded-lg border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
          />
        </label>
      </div>
    </div>
  );
}

async function validateAnnouncementForm(
  form: HTMLFormElement,
  currentMedia: { hasCurrentPopup: boolean; hasCurrentBanner: boolean }
): Promise<string | null> {
  const popupEnabled = getCheckbox(form, "popup_enabled");
  const bannerEnabled = getCheckbox(form, "banner_enabled");
  const removePopup = getCheckbox(form, "remove_popup_media");
  const removeBanner = getCheckbox(form, "remove_banner_image");
  const popupFile = getFile(form, "popup_media");
  const bannerFile = getFile(form, "banner_image");

  if (popupEnabled && !popupFile && (!currentMedia.hasCurrentPopup || removePopup)) {
    return "Envie uma mídia quadrada para exibir o popup.";
  }

  if (bannerEnabled && !bannerFile && (!currentMedia.hasCurrentBanner || removeBanner)) {
    return "Envie uma imagem horizontal para exibir o banner.";
  }

  if (popupFile) {
    if (popupFile.size > MAX_FILE_BYTES) {
      return "A mídia do popup passou do limite de 20MB.";
    }

    if (!isPopupType(popupFile.type)) {
      return "Popup aceita PNG, JPG, WebP ou video.";
    }

    if (popupFile.type.startsWith("image/")) {
      const valid = await imageHasAspect(popupFile, 1, 0.02);
      if (!valid) {
        return "Imagem recusada. Popups devem estar no formato quadrado 1:1. Use 1080x1080 px ou outra medida quadrada.";
      }
    }
  }

  if (bannerFile) {
    if (bannerFile.size > MAX_FILE_BYTES) {
      return "A imagem do banner passou do limite de 20MB.";
    }

    if (bannerFile.type.startsWith("video/")) {
      return "Banners aceitam apenas imagem. Envie PNG, JPG ou WebP no formato 1920x600.";
    }

    if (!BANNER_TYPES.has(bannerFile.type)) {
      return "Banner aceita apenas PNG, JPG ou WebP.";
    }

    const valid = await imageHasAspect(bannerFile, 3.2, 0.03);
    if (!valid) {
      return "Imagem recusada. Banners devem estar no formato horizontal 1920x600 px, proporção 3.2:1.";
    }
  }

  return null;
}

function getCheckbox(form: HTMLFormElement, name: string) {
  const value = form.elements.namedItem(name);
  return value instanceof HTMLInputElement && value.checked;
}

function getFile(form: HTMLFormElement, name: string) {
  const value = form.elements.namedItem(name);
  if (!(value instanceof HTMLInputElement) || value.type !== "file") {
    return null;
  }

  return value.files?.[0] ?? null;
}

function isPopupType(type: string) {
  return type === "image/png" || type === "image/jpeg" || type === "image/webp" || type.startsWith("video/");
}

async function readAnnouncementResponse(response: Response): Promise<{ ok?: boolean; error?: string } | null> {
  const text = await response.text().catch(() => "");

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as { ok?: boolean; error?: string };
  } catch {
    return {
      ok: false,
      error: "O servidor não conseguiu retornar uma mensagem completa. Verifique o tamanho e o formato dos arquivos."
    };
  }
}

function announcementResponseFallback(status: number) {
  if (status === 413) {
    return "Arquivo muito grande. Envie uma imagem ou vídeo com até 20MB.";
  }

  if (status === 400 || status === 422) {
    return "Revise título, mensagem, datas e arquivos antes de salvar.";
  }

  return `Não foi possível salvar o comunicado (${status}). Verifique os arquivos e tente novamente.`;
}

function imageHasAspect(file: File, target: number, tolerance: number): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      const ratio = image.naturalWidth / image.naturalHeight;
      resolve(Math.abs(ratio - target) / target <= tolerance);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(false);
    };

    image.src = url;
  });
}

function toDatetimeLocal(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function durationDays(startsAt: string | null | undefined, endsAt: string | null | undefined) {
  if (!startsAt || !endsAt) {
    return 7;
  }

  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 7;
  }

  return Math.max(1, Math.min(60, Math.round((end - start) / 86400000)));
}

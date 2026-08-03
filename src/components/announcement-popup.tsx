"use client";

import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { ContentViewTracker, MarkAsViewedButton } from "@/components/content-view-tracker";
import { ProtectedMedia } from "@/components/protected-media";
import type { PopupAnnouncement } from "@/types/app";

export function AnnouncementPopup({ announcements }: { announcements: PopupAnnouncement[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const current = useMemo(
    () => announcements.find((announcement) => !dismissed.has(announcement.id)) ?? null,
    [announcements, dismissed]
  );

  if (!current) {
    return null;
  }

  async function closeCurrent() {
    if (!current) return;
    setDismissed((existing) => new Set(existing).add(current.id));
    await fetch("/api/announcements/dismiss", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ announcementId: current.id })
    }).catch(() => undefined);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-decorato-ink/35 px-4 py-6 backdrop-blur-sm">
      <ContentViewTracker contentType="popup" contentId={current.id} heartbeat />
      <article className="w-full max-w-[min(92vw,520px)] overflow-hidden rounded-lg bg-white shadow-soft">
        <div className="flex items-center justify-between gap-3 border-b border-decorato-line px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-decorato-muted">Comunicado D&apos;Coratto</p>
            <h2 className="mt-1 text-xl font-semibold text-decorato-ink">{current.title}</h2>
          </div>
          <button
            type="button"
            onClick={closeCurrent}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-decorato-line text-decorato-muted hover:text-decorato-ink"
            aria-label="Fechar comunicado"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        {current.mediaUrl || current.mediaStoragePath ? (
          <div className="bg-decorato-paper p-3">
            <div className="aspect-square overflow-hidden rounded-lg bg-decorato-ink/5">
              <ProtectedMedia
                storagePath={current.mediaStoragePath}
                initialUrl={current.mediaUrl}
                mimeType={current.mediaMimeType}
                alt={current.title}
                controls={current.mediaMimeType?.startsWith("video/") ?? false}
                className="h-full w-full object-cover"
              />
            </div>
          </div>
        ) : null}
        <div className="px-5 py-5">
          <p className="whitespace-pre-wrap text-sm leading-7 text-decorato-ink">{current.body}</p>
          {current.popupEndsAt ? (
            <p className="mt-4 text-xs text-decorato-muted">
              Disponível até {new Date(current.popupEndsAt).toLocaleDateString("pt-BR")}.
            </p>
          ) : null}
          <div className="mt-5">
            <MarkAsViewedButton contentType="popup" contentId={current.id} />
          </div>
        </div>
      </article>
    </div>
  );
}

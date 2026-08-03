import { Megaphone } from "lucide-react";
import { AnnouncementMedia } from "@/components/announcement-media";
import { ContentViewTracker, MarkAsViewedButton } from "@/components/content-view-tracker";
import type { Announcement } from "@/types/app";

export function AnnouncementCard({
  announcement,
  mediaUrl,
  compact = false
}: {
  announcement: Announcement;
  mediaUrl?: string | null;
  compact?: boolean;
}) {
  const mediaStoragePath = announcement.popup_media_storage_path ?? announcement.media_storage_path ?? null;
  const mediaMimeType = announcement.popup_media_mime_type ?? announcement.media_mime_type;

  return (
    <article className="overflow-hidden rounded-lg border border-decorato-line bg-white shadow-sm">
      <ContentViewTracker contentType="announcement" contentId={announcement.id} heartbeat={false} />
      {mediaUrl || mediaStoragePath ? (
        <AnnouncementMedia
          url={mediaUrl ?? null}
          storagePath={mediaStoragePath}
          mimeType={mediaMimeType}
          title={announcement.title}
          compact
        />
      ) : null}
      <div className={compact ? "p-4" : "p-5"}>
        <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-wide text-decorato-muted">
          <Megaphone aria-hidden="true" size={14} className="text-decorato-coral" />
          {announcement.published_at ? new Date(announcement.published_at).toLocaleDateString("pt-BR") : "Publicado"}
        </div>
        <h2 className={compact ? "font-semibold text-decorato-ink" : "text-xl font-semibold text-decorato-ink"}>
          {announcement.title}
        </h2>
        <p className={compact ? "mt-2 line-clamp-3 text-sm leading-6 text-decorato-muted" : "mt-3 whitespace-pre-wrap text-sm leading-7 text-decorato-ink"}>
          {announcement.body}
        </p>
        <div className="mt-4">
          <MarkAsViewedButton contentType="announcement" contentId={announcement.id} />
        </div>
      </div>
    </article>
  );
}

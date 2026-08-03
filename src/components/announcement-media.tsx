import { ImageIcon, Video } from "lucide-react";
import { ProtectedMedia } from "@/components/protected-media";

export function AnnouncementMedia({
  url,
  storagePath = null,
  mimeType,
  title,
  compact = false
}: {
  url: string | null;
  storagePath?: string | null;
  mimeType: string | null | undefined;
  title: string;
  compact?: boolean;
}) {
  if ((!url && !storagePath) || !mimeType) {
    return null;
  }

  if (mimeType.startsWith("image/")) {
    return (
      <div className="overflow-hidden rounded-lg bg-decorato-paper">
        <ProtectedMedia
          storagePath={storagePath}
          initialUrl={url}
          mimeType={mimeType}
          alt={title}
          className={compact ? "aspect-[16/9] w-full object-cover" : "max-h-[420px] w-full object-cover"}
        />
      </div>
    );
  }

  if (mimeType.startsWith("video/")) {
    return (
      <ProtectedMedia
        storagePath={storagePath}
        initialUrl={url}
        mimeType={mimeType}
        alt={title}
        controls
        className="aspect-video w-full rounded-lg bg-decorato-ink"
      />
    );
  }

  return (
    <div className="grid aspect-video place-items-center rounded-lg bg-decorato-paper text-decorato-muted">
      {mimeType.startsWith("video/") ? <Video aria-hidden="true" /> : <ImageIcon aria-hidden="true" />}
    </div>
  );
}

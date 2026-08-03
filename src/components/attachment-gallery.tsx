import { FileText } from "lucide-react";
import { ProtectedMedia } from "@/components/protected-media";
import { ProtectedFileActions } from "@/components/protected-file-actions";
import type { Attachment } from "@/types/app";

export function AttachmentGallery({ attachments }: { attachments: Attachment[] }) {
  if (attachments.length === 0) {
    return null;
  }

  const images = attachments.filter((attachment) => attachment.mime_type.startsWith("image/"));
  const videos = attachments.filter((attachment) => attachment.mime_type.startsWith("video/"));
  const documents = attachments.filter(
    (attachment) => !attachment.mime_type.startsWith("image/") && !attachment.mime_type.startsWith("video/")
  );

  return (
    <section className="mt-10 space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-decorato-ink">Arquivos</h2>
        <p className="mt-1 text-sm text-decorato-muted">
          Visualize anexos sem sair do documento. Imagens sao otimizadas em WebP no envio.
        </p>
      </div>

      {images.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {images.map((attachment) => (
            <figure key={attachment.id} className="overflow-hidden rounded-lg border border-decorato-line bg-white">
              <ProtectedMedia
                storagePath={attachment.storage_path}
                initialUrl={attachment.signedUrl}
                mimeType={attachment.mime_type}
                alt={attachment.original_name}
                className="aspect-[4/3] w-full object-cover"
              />
              <figcaption className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="truncate text-decorato-ink">{attachment.original_name}</span>
                <AttachmentActions attachment={attachment} />
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}

      {videos.length > 0 ? (
        <div className="grid gap-3">
          {videos.map((attachment) => (
            <article key={attachment.id} className="overflow-hidden rounded-lg border border-decorato-line bg-white">
              <ProtectedMedia
                storagePath={attachment.storage_path}
                initialUrl={attachment.signedUrl}
                mimeType={attachment.mime_type}
                alt={attachment.original_name}
                controls
                className="aspect-video w-full bg-decorato-ink"
              />
              <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="truncate text-decorato-ink">{attachment.original_name}</span>
                <AttachmentActions attachment={attachment} />
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {documents.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {documents.map((attachment) => (
            <article
              key={attachment.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-decorato-line bg-white p-4"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="rounded-md bg-decorato-teal/10 p-2 text-decorato-teal">
                  <FileText aria-hidden="true" size={18} />
                </span>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-decorato-ink">{attachment.original_name}</h3>
                  <p className="mt-1 text-xs text-decorato-muted">{formatBytes(attachment.size_bytes)}</p>
                </div>
              </div>
              <AttachmentActions attachment={attachment} />
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AttachmentActions({ attachment }: { attachment: Attachment }) {
  return <ProtectedFileActions storagePath={attachment.storage_path} fileName={attachment.original_name} compact />;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

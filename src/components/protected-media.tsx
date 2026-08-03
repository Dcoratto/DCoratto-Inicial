"use client";

import { Download } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export function ProtectedMedia({
  storagePath,
  initialUrl = null,
  mimeType,
  alt,
  className,
  controls = false,
  preload = "metadata",
  variant = "viewer"
}: {
  storagePath: string | null;
  initialUrl?: string | null;
  mimeType: string | null | undefined;
  alt: string;
  className?: string;
  controls?: boolean;
  preload?: "none" | "metadata" | "auto";
  variant?: "viewer" | "thumbnail";
}) {
  const [url, setUrl] = useState(initialUrl);
  const [failed, setFailed] = useState(false);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const lazyVideo = variant === "thumbnail" && Boolean(mimeType?.startsWith("video/"));
  const mediaLabel = variant === "thumbnail" && !alt.toLocaleLowerCase("pt-BR").startsWith("miniatura de ") ? `Miniatura de ${alt}` : alt;
  const [thumbnailVisible, setThumbnailVisible] = useState(!lazyVideo);
  const thumbnailPlaceholderRef = useRef<HTMLDivElement | null>(null);
  const refreshing = useRef(false);

  const refreshUrl = useCallback(async () => {
    if (!storagePath || refreshing.current) {
      return;
    }

    refreshing.current = true;
    try {
      const response = await fetch(`/api/media/signed-url?path=${encodeURIComponent(storagePath)}`, {
        cache: "no-store"
      });
      const payload = (await response.json().catch(() => null)) as { signedUrl?: string } | null;
      if (response.ok && payload?.signedUrl) {
        setUrl(payload.signedUrl);
        setFailed(false);
        setPlaybackFailed(false);
      } else {
        setFailed(true);
      }
    } finally {
      refreshing.current = false;
    }
  }, [storagePath]);

  useEffect(() => {
    if (!storagePath) {
      setUrl(null);
      return;
    }

    if (!initialUrl) {
      void refreshUrl();
    }

    const timer =
      variant === "viewer"
        ? window.setInterval(() => {
            void refreshUrl();
          }, 8 * 60 * 1000)
        : null;

    return () => {
      if (timer) window.clearInterval(timer);
    };
  }, [initialUrl, refreshUrl, storagePath, variant]);

  useEffect(() => {
    if (!lazyVideo) {
      setThumbnailVisible(true);
      return;
    }

    const element = thumbnailPlaceholderRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setThumbnailVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setThumbnailVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px" }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [lazyVideo, storagePath]);

  if (!storagePath || !mimeType) {
    return null;
  }

  if (lazyVideo && !thumbnailVisible) {
    return (
      <div
        ref={thumbnailPlaceholderRef}
        aria-label={mediaLabel}
        className={className ?? "aspect-video bg-decorato-ink motion-safe:animate-pulse"}
      />
    );
  }

  if (failed) {
    return (
      <div className={className ?? "grid aspect-video place-items-center bg-decorato-paper text-sm text-decorato-muted"}>
        {variant === "thumbnail" ? "Miniatura indisponível" : "Não foi possível carregar a mídia."}
      </div>
    );
  }

  if (!url) {
    return (
      <div
        aria-busy="true"
        className={className ?? "grid aspect-video place-items-center bg-decorato-paper text-sm text-decorato-muted motion-safe:animate-pulse"}
      >
        Carregando mídia...
      </div>
    );
  }

  if (mimeType.startsWith("video/")) {
    if (playbackFailed) {
      if (variant === "thumbnail") {
        return <div className={className ?? "aspect-video bg-decorato-ink"} aria-label={mediaLabel} />;
      }

      return (
        <div className={className ?? "grid aspect-video place-items-center bg-decorato-paper p-4 text-sm text-decorato-muted"}>
          <div className="text-center">
            <p>Este navegador pode não reproduzir este formato de vídeo.</p>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex rounded-md border border-decorato-line bg-white px-3 py-2 text-decorato-ink"
            >
              Abrir ou baixar vídeo
            </a>
          </div>
        </div>
      );
    }

    return (
      <video
        controls={variant === "viewer" && controls}
        preload={preload}
        muted={variant === "thumbnail"}
        playsInline
        aria-label={mediaLabel}
        className={className}
        onError={() => {
          setPlaybackFailed(true);
          void refreshUrl();
        }}
      >
        <source src={url} type={mimeType} />
      </video>
    );
  }

  if (mimeType === "application/pdf") {
    const pdfUrl = variant === "thumbnail" ? `${url}#page=1&toolbar=0&navpanes=0&scrollbar=0` : url;
    return (
      <iframe
        src={pdfUrl}
        title={mediaLabel}
        loading="lazy"
        tabIndex={variant === "thumbnail" ? -1 : undefined}
        className={className ?? "aspect-video w-full rounded-lg bg-white"}
      />
    );
  }

  if (!mimeType.startsWith("image/")) {
    if (variant === "thumbnail") {
      return <div className={className ?? "aspect-video bg-decorato-paper"} aria-label={mediaLabel} />;
    }

    return (
      <div className={className ?? "grid aspect-video place-items-center rounded-lg bg-decorato-paper p-4 text-sm text-decorato-muted"}>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-md border border-decorato-line bg-white px-3 py-2 text-decorato-ink"
        >
          <Download aria-hidden="true" size={16} />
          Abrir ou baixar arquivo
        </a>
      </div>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={mediaLabel} loading="lazy" draggable={false} className={className} onError={refreshUrl} />;
}

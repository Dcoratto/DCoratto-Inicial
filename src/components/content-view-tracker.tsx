"use client";

import { CheckCircle2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { EngagementContentType } from "@/types/app";

type TrackerPayload = {
  contentType: EngagementContentType;
  contentId: string;
  categoryId?: string | null;
  departmentId?: string | null;
};

export function ContentViewTracker({
  contentType,
  contentId,
  categoryId = null,
  departmentId = null,
  heartbeat = true
}: TrackerPayload & { heartbeat?: boolean }) {
  const lastBeatRef = useRef<number>(Date.now());
  const viewSessionIdRef = useRef<string>(crypto.randomUUID());
  const focusedRef = useRef<boolean>(true);
  const lastActivityRef = useRef<number>(Date.now());
  const closedRef = useRef<boolean>(false);

  useEffect(() => {
    closedRef.current = false;
    const trackerPayload = { contentType, contentId, categoryId, departmentId, viewSessionId: viewSessionIdRef.current };
    sendEvent(trackerPayload, "open");
    lastBeatRef.current = Date.now();
    lastActivityRef.current = Date.now();

    const markActivity = () => {
      lastActivityRef.current = Date.now();
    };

    const onFocus = () => {
      focusedRef.current = true;
      lastBeatRef.current = Date.now();
      markActivity();
    };

    const onBlur = () => {
      focusedRef.current = false;
      lastBeatRef.current = Date.now();
    };

    const interval = heartbeat
      ? window.setInterval(() => {
          const activeRecently = Date.now() - lastActivityRef.current <= 60_000;
          if (document.visibilityState !== "visible" || !focusedRef.current || !activeRecently) {
            lastBeatRef.current = Date.now();
            return;
          }

          const now = Date.now();
          const seconds = Math.min(15, Math.max(1, Math.round((now - lastBeatRef.current) / 1000)));
          lastBeatRef.current = now;
          sendEvent(trackerPayload, "heartbeat", seconds);
        }, 15_000)
      : null;

    const close = () => {
      if (closedRef.current) {
        return;
      }
      closedRef.current = true;
      const seconds =
        heartbeat && document.visibilityState === "visible" && focusedRef.current
          ? Math.min(15, Math.max(1, Math.round((Date.now() - lastBeatRef.current) / 1000)))
          : 0;
      const payload = buildPayload(trackerPayload, "close", seconds);
      const body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/engagement/record", new Blob([body], { type: "application/json" }));
      } else {
        fetch("/api/engagement/record", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          keepalive: true
        }).catch(() => undefined);
      }
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pointerdown", markActivity);
    window.addEventListener("keydown", markActivity);
    window.addEventListener("scroll", markActivity, { passive: true });
    window.addEventListener("pagehide", close);

    return () => {
      if (interval) {
        window.clearInterval(interval);
      }
      close();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pointerdown", markActivity);
      window.removeEventListener("keydown", markActivity);
      window.removeEventListener("scroll", markActivity);
      window.removeEventListener("pagehide", close);
    };
  }, [categoryId, contentId, contentType, departmentId, heartbeat]);

  return null;
}

export function MarkAsViewedButton({
  contentType,
  contentId,
  categoryId = null,
  initialViewed,
  initialViewedAt = null,
  onViewed
}: TrackerPayload & {
  initialViewed?: boolean;
  initialViewedAt?: string | null;
  onViewed?: (viewedAt: string) => void;
}) {
  const [viewed, setViewed] = useState(initialViewed ?? false);
  const [viewedAt, setViewedAt] = useState<string | null>(initialViewedAt);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialViewed !== undefined) {
      setViewed(initialViewed);
      setViewedAt(initialViewedAt);
      return;
    }

    let alive = true;
    const params = new URLSearchParams({ contentType, contentId });
    fetch(`/api/engagement/status?${params.toString()}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { viewed?: boolean; viewedAt?: string | null }) => {
        if (!alive) return;
        setViewed(Boolean(payload.viewed));
        setViewedAt(payload.viewedAt ?? null);
      })
      .catch(() => undefined);

    return () => {
      alive = false;
    };
  }, [contentId, contentType, initialViewed, initialViewedAt]);

  async function markViewed() {
    if (viewed) {
      return;
    }

    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/engagement/mark-viewed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contentType, contentId, categoryId })
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; viewedAt?: string | null } | null;
      if (response.ok && payload?.ok) {
        const nextViewedAt = payload.viewedAt ?? new Date().toISOString();
        setViewed(true);
        setViewedAt(nextViewedAt);
        onViewed?.(nextViewedAt);
      } else {
        setError("Não foi possível salvar agora. Tente novamente.");
      }
    } catch {
      setError("Não foi possível salvar agora. Verifique sua conexão.");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={markViewed}
        disabled={pending || viewed}
        className="inline-flex min-h-10 items-center gap-2 rounded-md border border-decorato-line bg-white px-3 py-2 text-sm text-decorato-ink transition hover:bg-decorato-paper focus:outline-none focus:ring-2 focus:ring-decorato-teal/35 disabled:cursor-default disabled:text-decorato-muted"
      >
        <CheckCircle2 aria-hidden="true" size={16} className={viewed ? "text-decorato-teal" : "text-decorato-muted"} />
        {viewed ? (viewedAt ? `Visualizado em ${new Date(viewedAt).toLocaleDateString("pt-BR")}` : "Visualizado") : pending ? "Salvando..." : "Marcar como visualizado"}
      </button>
      {error ? <span role="alert" className="text-xs text-decorato-coral">{error}</span> : null}
    </span>
  );
}

async function sendEvent(payload: TrackerPayload & { viewSessionId?: string }, eventType: string, activeSeconds = 0) {
  await fetch("/api/engagement/record", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildPayload(payload, eventType, activeSeconds))
  }).catch(() => undefined);
}

function buildPayload(payload: TrackerPayload & { viewSessionId?: string }, eventType: string, activeSeconds: number) {
  return {
    contentType: payload.contentType,
    contentId: payload.contentId,
    eventType,
    activeSeconds,
    categoryId: payload.categoryId ?? null,
    departmentId: payload.departmentId ?? null,
    metadata: {
      viewSessionId: payload.viewSessionId
    }
  };
}

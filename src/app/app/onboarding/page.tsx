import { CheckCircle2, Circle, ExternalLink } from "lucide-react";
import Link from "next/link";
import { completeOnboardingItem } from "@/actions/onboarding";
import { ContentViewTracker, MarkAsViewedButton } from "@/components/content-view-tracker";
import { ProtectedFileActions } from "@/components/protected-file-actions";
import { ProtectedMedia } from "@/components/protected-media";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireAuth } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { OnboardingItem, OnboardingTrack } from "@/types/app";

export default async function OnboardingPage() {
  const currentUser = await requireAuth();
  const supabase = await createSupabaseServerClient();
  const [{ data: tracksData }, { data: itemsData }, { data: progressData }, { data: documentsData }] =
    await Promise.all([
      supabase
        .from("onboarding_tracks")
        .select("id,title,description,is_active,department_category_id")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("onboarding_items")
        .select("id,track_id,title,description,document_id,video_url,attachment_id,file_storage_path,file_original_name,file_mime_type,file_size_bytes,sort_order")
        .order("sort_order", { ascending: true })
        .limit(200),
      supabase
        .from("onboarding_progress")
        .select("item_id")
        .eq("user_id", currentUser.id),
      supabase
        .from("documents")
        .select("id,title,slug,status")
        .eq("status", "published")
        .limit(200)
    ]);

  const tracks = (tracksData ?? []) as OnboardingTrack[];
  const items = (itemsData ?? []) as OnboardingItem[];
  const completed = new Set(((progressData as Array<{ item_id: string }> | null) ?? []).map((item) => item.item_id));
  const documents = new Map(
    ((documentsData as Array<{ id: string; title: string; slug: string }> | null) ?? []).map((document) => [
      document.id,
      document
    ])
  );
  const totalItems = items.length;
  const progress = totalItems > 0 ? Math.round((completed.size / totalItems) * 100) : 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold text-decorato-ink">Onboarding</h1>
        <p className="mt-2 text-decorato-muted">Acompanhe seu progresso nas trilhas ativas.</p>
        <div className="mt-5 h-3 overflow-hidden rounded-full bg-decorato-line">
          <div className="h-full rounded-full bg-decorato-teal" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-2 text-sm text-decorato-muted">{progress}% concluído</p>
      </header>

      {tracks.length === 0 ? (
        <EmptyState
          title="Nenhuma trilha ativa"
          description="As trilhas de onboarding publicadas pelo admin aparecerão aqui."
        />
      ) : (
        <div className="space-y-5">
          {tracks.map((track) => {
            const trackItems = items.filter((item) => item.track_id === track.id);
            return (
              <section key={track.id} className="rounded-lg border border-decorato-line bg-white p-5">
                <h2 className="text-xl font-semibold text-decorato-ink">{track.title}</h2>
                {track.description ? <p className="mt-2 text-sm text-decorato-muted">{track.description}</p> : null}
                <div className="mt-5 space-y-3">
                  {trackItems.map((item) => {
                    const done = completed.has(item.id);
                    const linkedDocument = item.document_id ? documents.get(item.document_id) : null;
                    return (
                      <div key={item.id} className="rounded-lg border border-decorato-line bg-decorato-paper/50 p-4">
                        <ContentViewTracker contentType="onboarding" contentId={item.id} heartbeat={false} />
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex gap-3">
                            {done ? (
                              <CheckCircle2 aria-hidden="true" className="mt-1 shrink-0 text-decorato-leaf" size={20} />
                            ) : (
                              <Circle aria-hidden="true" className="mt-1 shrink-0 text-decorato-muted" size={20} />
                            )}
                            <div>
                              <h3 className="font-semibold text-decorato-ink">{item.title}</h3>
                              {item.description ? (
                                <p className="mt-1 text-sm leading-6 text-decorato-muted">{item.description}</p>
                              ) : null}
                              <div className="mt-2 flex flex-wrap gap-2 text-sm">
                                {linkedDocument ? (
                                  <Link
                                    href={`/app/documents/${linkedDocument.slug}`}
                                    className="inline-flex items-center gap-1 text-decorato-teal"
                                  >
                                    Abrir documento
                                    <ExternalLink aria-hidden="true" size={14} />
                                  </Link>
                                ) : null}
                                {item.video_url ? (
                                  <a
                                    href={item.video_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-decorato-teal"
                                  >
                                    Abrir link
                                    <ExternalLink aria-hidden="true" size={14} />
                                  </a>
                                ) : null}
                              </div>
                              {item.file_storage_path && item.file_mime_type ? (
                                <div className="mt-3 overflow-hidden rounded-lg border border-decorato-line bg-white">
                                  {item.file_mime_type.startsWith("image/") || item.file_mime_type.startsWith("video/") ? (
                                    <ProtectedMedia
                                      storagePath={item.file_storage_path}
                                      mimeType={item.file_mime_type}
                                      alt={item.file_original_name ?? item.title}
                                      controls={item.file_mime_type.startsWith("video/")}
                                      className={
                                        item.file_mime_type.startsWith("video/")
                                          ? "aspect-video w-full bg-decorato-ink"
                                          : "max-h-80 w-full object-cover"
                                      }
                                    />
                                  ) : null}
                                  <div className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                                    <span className="min-w-0 truncate text-decorato-ink">
                                      {item.file_original_name ?? "Arquivo da trilha"}
                                    </span>
                                    <ProtectedFileActions
                                      storagePath={item.file_storage_path}
                                      fileName={item.file_original_name ?? "arquivo"}
                                    />
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                          {!done ? (
                            <div className="flex flex-wrap gap-2">
                              <MarkAsViewedButton contentType="onboarding" contentId={item.id} />
                              <form action={completeOnboardingItem}>
                                <input type="hidden" name="itemId" value={item.id} />
                                <Button type="submit" variant="secondary">
                                  Marcar concluído
                                </Button>
                              </form>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

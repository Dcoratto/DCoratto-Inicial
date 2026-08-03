import Link from "next/link";
import { Megaphone, NotebookTabs, Search, SquareCheckBig } from "lucide-react";
import { AnnouncementCard } from "@/components/announcement-card";
import { DocumentCard } from "@/components/document-card";
import { HomeBanners } from "@/components/home-banners";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireAuth } from "@/lib/auth";
import { createSignedUrl } from "@/lib/storage";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBannerAnnouncementsForUser, getRecentPublishedDocuments } from "@/lib/data";
import type { Announcement } from "@/types/app";

export default async function AppDashboardPage() {
  const currentUser = await requireAuth();
  const supabase = await createSupabaseServerClient();
  const [documents, banners, announcementsResult, tracksCount, progressCount] = await Promise.all([
    getRecentPublishedDocuments(6),
    getBannerAnnouncementsForUser(currentUser.profile),
    supabase
      .from("announcements")
      .select(
        "id,title,body,status,published_at,media_storage_path,media_original_name,media_mime_type,media_size_bytes,popup_media_storage_path,popup_media_mime_type,banner_image_storage_path,banner_image_mime_type,popup_enabled,popup_starts_at,popup_ends_at,created_at,updated_at"
      )
      .eq("status", "published")
      .is("deleted_at", null)
      .is("permanently_deleted_at", null)
      .order("published_at", { ascending: false })
      .limit(3),
    supabase.from("onboarding_items").select("id", { count: "exact", head: true }),
    supabase.from("onboarding_progress").select("id", { count: "exact", head: true })
  ]);

  const announcements = (announcementsResult.data ?? []) as Announcement[];
  const announcementMediaUrls = new Map(
    await Promise.all(
      announcements.map(async (announcement) => [
        announcement.id,
        announcement.popup_media_storage_path || announcement.media_storage_path
          ? await createSignedUrl((announcement.popup_media_storage_path ?? announcement.media_storage_path) as string)
          : null
      ] as const)
    )
  );
  const totalItems = tracksCount.count ?? 0;
  const completed = progressCount.count ?? 0;
  const progress = totalItems > 0 ? Math.round((completed / totalItems) * 100) : 0;

  return (
    <div className="space-y-7">
      <HomeBanners banners={banners} />

      <section className="rounded-lg border border-decorato-line bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-decorato-teal">Central D&apos;Coratto</p>
            <h1 className="mt-2 text-3xl font-semibold text-decorato-ink">Tudo importante em um só lugar</h1>
            <p className="mt-2 max-w-3xl text-base leading-7 text-decorato-muted">
              Procedimentos, comunicados, documentos e trilhas de onboarding organizados para consulta rápida.
            </p>
          </div>
          <ButtonLink href="/app/search" variant="secondary">
            <Search aria-hidden="true" size={18} />
            Buscar
          </ButtonLink>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Link href="/app/search" className="rounded-lg bg-decorato-teal/10 p-4 text-decorato-ink">
            <Search aria-hidden="true" className="mb-3 text-decorato-teal" size={22} />
            <h2 className="font-semibold">Busca global</h2>
            <p className="mt-1 text-sm text-decorato-muted">Encontre respostas por palavra-chave.</p>
          </Link>
          <Link href="/app/announcements" className="rounded-lg bg-decorato-coral/10 p-4 text-decorato-ink">
            <Megaphone aria-hidden="true" className="mb-3 text-decorato-coral" size={22} />
            <h2 className="font-semibold">Comunicados</h2>
            <p className="mt-1 text-sm text-decorato-muted">Avisos, campanhas e novidades internas.</p>
          </Link>
          <Link href="/app/onboarding" className="rounded-lg bg-decorato-sun/20 p-4 text-decorato-ink">
            <SquareCheckBig aria-hidden="true" className="mb-3 text-decorato-ink" size={22} />
            <h2 className="font-semibold">Onboarding</h2>
            <p className="mt-1 text-sm text-decorato-muted">{progress}% concluído nos itens disponíveis.</p>
          </Link>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-decorato-ink">Documentos recentes</h2>
            <p className="text-sm text-decorato-muted">Somente documentos publicados aparecem para leitores.</p>
          </div>
          <ButtonLink href="/app/search" variant="secondary">
            <NotebookTabs aria-hidden="true" size={18} />
            Ver tudo
          </ButtonLink>
        </div>
        {documents.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {documents.map((document) => (
              <DocumentCard key={document.id} document={document} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="Nenhum documento publicado ainda"
            description="Quando o admin publicar procedimentos ou padrões, eles aparecerão aqui."
          />
        )}
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-decorato-ink">Comunicados</h2>
          <ButtonLink href="/app/announcements" variant="secondary">
            Ver feed
          </ButtonLink>
        </div>
        {announcements.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-3">
            {announcements.map((announcement) => (
              <AnnouncementCard
                key={announcement.id}
                announcement={announcement}
                mediaUrl={announcementMediaUrls.get(announcement.id)}
                compact
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="Nenhum comunicado publicado"
            description="O feed de endomarketing vai aparecer assim que houver novidades publicadas."
          />
        )}
      </section>
    </div>
  );
}

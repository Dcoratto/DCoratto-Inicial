import Link from "next/link";
import {
  BarChart3,
  FilePlus2,
  FolderPlus,
  Megaphone,
  NotebookTabs,
  Search,
  ShieldCheck,
  SquareCheckBig,
  UserPlus
} from "lucide-react";
import { AnnouncementCard } from "@/components/announcement-card";
import { DocumentCard } from "@/components/document-card";
import { HomeBanners } from "@/components/home-banners";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireAdmin } from "@/lib/auth";
import { getBannerAnnouncementsForUser, getRecentPublishedDocuments } from "@/lib/data";
import { createSignedUrl } from "@/lib/storage";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Announcement } from "@/types/app";

export default async function AdminDashboardPage() {
  const currentUser = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [
    documents,
    published,
    departments,
    users,
    activeAnnouncements,
    views,
    recentReaders,
    banners,
    announcementsResult,
    onboardingItems,
    onboardingProgress
  ] = await Promise.all([
    getRecentPublishedDocuments(6),
    supabase.from("documents").select("id", { count: "exact", head: true }).eq("status", "published").is("deleted_at", null),
    supabase.from("categories").select("id", { count: "exact", head: true }).eq("is_active", true).eq("access_scope", "department").is("deleted_at", null),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase
      .from("announcements")
      .select("id", { count: "exact", head: true })
      .eq("status", "published")
      .is("deleted_at", null)
      .is("permanently_deleted_at", null),
    supabase.from("content_view_events").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
    supabase.from("content_view_rollups").select("user_id").gte("last_opened_at", sevenDaysAgo).limit(1000),
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
    supabase.from("onboarding_progress").select("id", { count: "exact", head: true }).eq("user_id", currentUser.id)
  ]);

  const recentReaderIds = new Set(((recentReaders.data as Array<{ user_id: string }> | null) ?? []).map((item) => item.user_id));
  const peopleWithoutRecentReading = Math.max((users.count ?? 0) - recentReaderIds.size, 0);
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
  const metrics = [
    { label: "Documentos publicados", value: published.count ?? 0 },
    { label: "Departamentos ativos", value: departments.count ?? 0 },
    { label: "Usuários ativos", value: users.count ?? 0 },
    { label: "Comunicados ativos", value: activeAnnouncements.count ?? 0 },
    { label: "Visualizações em 7 dias", value: views.count ?? 0 },
    { label: "Sem leitura recente", value: peopleWithoutRecentReading }
  ];
  const onboardingTotal = onboardingItems.count ?? 0;
  const onboardingDone = onboardingProgress.count ?? 0;
  const onboardingPercent = onboardingTotal > 0 ? Math.round((onboardingDone / onboardingTotal) * 100) : 0;

  return (
    <div className="space-y-7">
      <HomeBanners banners={banners} />

      <section className="rounded-lg border border-decorato-line bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-decorato-teal">Central D&apos;Coratto</p>
            <h1 className="mt-2 text-3xl font-semibold text-decorato-ink">Tudo importante em um só lugar</h1>
            <p className="mt-2 max-w-3xl text-base leading-7 text-decorato-muted">
              Procedimentos, comunicados, documentos e atalhos de gestão organizados para consulta rápida.
            </p>
          </div>
          <ButtonLink href="/app/search" variant="secondary">
            <Search aria-hidden="true" size={18} />
            Buscar
          </ButtonLink>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Link href="/app/search" className="rounded-lg bg-decorato-teal/10 p-4 text-decorato-ink transition hover:-translate-y-0.5">
            <Search aria-hidden="true" className="mb-3 text-decorato-teal" size={22} />
            <h2 className="font-semibold">Busca global</h2>
            <p className="mt-1 text-sm text-decorato-muted">Encontre respostas por palavra-chave.</p>
          </Link>
          <Link
            href="/app/announcements"
            className="rounded-lg bg-decorato-coral/10 p-4 text-decorato-ink transition hover:-translate-y-0.5"
          >
            <Megaphone aria-hidden="true" className="mb-3 text-decorato-coral" size={22} />
            <h2 className="font-semibold">Comunicados</h2>
            <p className="mt-1 text-sm text-decorato-muted">Avisos, campanhas e novidades internas.</p>
          </Link>
          <Link
            href="/app/onboarding"
            className="rounded-lg bg-decorato-sun/20 p-4 text-decorato-ink transition hover:-translate-y-0.5"
          >
            <SquareCheckBig aria-hidden="true" className="mb-3 text-decorato-ink" size={22} />
            <h2 className="font-semibold">Onboarding</h2>
            <p className="mt-1 text-sm text-decorato-muted">{onboardingPercent}% concluído nos itens disponíveis.</p>
          </Link>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-decorato-teal">Administração</p>
          <h2 className="mt-2 text-2xl font-semibold text-decorato-ink">Painel administrativo</h2>
          <p className="mt-1 text-sm text-decorato-muted">
            Indicadores, atalhos de gestão e acompanhamento da Central D&apos;Coratto.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
          {metrics.map((metric) => (
            <article key={metric.label} className="rounded-lg border border-decorato-line bg-white p-5 shadow-sm">
              <p className="text-sm text-decorato-muted">{metric.label}</p>
              <p className="mt-2 text-3xl font-semibold text-decorato-ink">{metric.value}</p>
            </article>
          ))}
        </div>

        <div className="rounded-lg border border-decorato-line bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-base font-semibold text-decorato-ink">Ações rápidas</h3>
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <ButtonLink href="/admin/documents/new">
              <FilePlus2 aria-hidden="true" size={18} />
              Novo documento
            </ButtonLink>
            <ButtonLink href="/admin/categories" variant="secondary">
              <FolderPlus aria-hidden="true" size={18} />
              Departamentos
            </ButtonLink>
            <ButtonLink href="/admin/users/new" variant="secondary">
              <UserPlus aria-hidden="true" size={18} />
              Criar colaborador
            </ButtonLink>
            <ButtonLink href="/admin/announcements" variant="secondary">
              <Megaphone aria-hidden="true" size={18} />
              Novo comunicado
            </ButtonLink>
            <ButtonLink href="/admin/engagement" variant="secondary">
              <BarChart3 aria-hidden="true" size={18} />
              Engajamento
            </ButtonLink>
            <ButtonLink href="/admin/audit" variant="secondary">
              <ShieldCheck aria-hidden="true" size={18} />
              Auditoria
            </ButtonLink>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-decorato-ink">Documentos recentes</h2>
            <p className="text-sm text-decorato-muted">Procedimentos publicados mais recentes para consulta rápida.</p>
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
            description="Quando houver procedimentos publicados, eles aparecerão nesta área."
          />
        )}
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-decorato-ink">Comunicados recentes</h2>
            <p className="text-sm text-decorato-muted">Publicações que também aparecem para colaboradores permitidos.</p>
          </div>
          <ButtonLink href="/admin/announcements" variant="secondary">
            Gerenciar
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
            description="Crie um comunicado, popup ou banner para aparecer na tela inicial."
          />
        )}
      </section>
    </div>
  );
}

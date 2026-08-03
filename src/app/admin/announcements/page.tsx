import { archiveAnnouncement, publishAnnouncement, reactivateAnnouncement } from "@/actions/announcements";
import Link from "next/link";
import { AdminAnnouncementForm } from "@/components/admin-announcement-form";
import { AnnouncementMedia } from "@/components/announcement-media";
import { AnnouncementTrashButton } from "@/components/announcement-trash-button";
import { Button } from "@/components/ui/button";
import { createSignedUrl } from "@/lib/storage";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Announcement, Category, Profile } from "@/types/app";

export default async function AdminAnnouncementsPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data }, { data: profilesData }, { data: targetsData }, { data: categoriesData }] = await Promise.all([
    supabase
      .from("announcements")
      .select(
        "id,title,body,status,published_at,media_storage_path,media_original_name,media_mime_type,media_size_bytes,popup_media_storage_path,popup_media_original_name,popup_media_mime_type,popup_media_size_bytes,popup_media_width,popup_media_height,popup_media_duration_seconds,banner_image_storage_path,banner_image_original_name,banner_image_mime_type,banner_image_size_bytes,banner_image_width,banner_image_height,popup_enabled,popup_starts_at,popup_ends_at,popup_active,banner_enabled,banner_starts_at,banner_ends_at,banner_active,created_at,updated_at"
      )
      .is("deleted_at", null)
      .is("permanently_deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("profiles")
      .select("id,username,email,full_name,role,department,department_id,department_category_id,is_active,must_change_password")
      .eq("is_active", true)
      .order("full_name", { ascending: true }),
    supabase.from("announcement_targets").select("announcement_id,user_id").limit(1000),
    supabase
      .from("categories")
      .select("id,parent_id,name,slug,description,sort_order,is_active,is_department,access_scope")
      .eq("is_active", true)
      .eq("is_department", true)
      .eq("access_scope", "department")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
  ]);

  const announcements = (data ?? []) as Announcement[];
  const profiles = (profilesData ?? []) as Profile[];
  const categories = (categoriesData ?? []) as Category[];
  const targetCounts = new Map<string, number>();
  ((targetsData as Array<{ announcement_id: string; user_id: string }> | null) ?? []).forEach((target) => {
    targetCounts.set(target.announcement_id, (targetCounts.get(target.announcement_id) ?? 0) + 1);
  });
  const mediaUrls = new Map(
    await Promise.all(
      announcements.map(async (announcement) => [
        announcement.id,
        announcement.popup_media_storage_path || announcement.banner_image_storage_path || announcement.media_storage_path
          ? await createSignedUrl(
              (announcement.popup_media_storage_path ??
                announcement.banner_image_storage_path ??
                announcement.media_storage_path) as string
            )
          : null
      ] as const)
    )
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,460px)_1fr]">
      <section className="rounded-lg border border-decorato-line bg-white p-6">
        <h1 className="text-2xl font-semibold text-decorato-ink">Novo comunicado</h1>
        <p className="mt-1 text-sm leading-6 text-decorato-muted">
          Crie rascunhos com popup, banner agendado e público específico.
        </p>
        <AdminAnnouncementForm profiles={profiles} categories={categories} />
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl font-semibold text-decorato-ink">Comunicados</h2>
        {announcements.map((announcement) => (
          <article key={announcement.id} className="overflow-hidden rounded-lg border border-decorato-line bg-white">
            {announcement.popup_media_storage_path || announcement.banner_image_storage_path || announcement.media_storage_path ? (
              <AnnouncementMedia
                url={mediaUrls.get(announcement.id) ?? null}
                storagePath={
                  announcement.popup_media_storage_path ??
                  announcement.banner_image_storage_path ??
                  announcement.media_storage_path ??
                  null
                }
                mimeType={
                  announcement.popup_media_mime_type ??
                  announcement.banner_image_mime_type ??
                  announcement.media_mime_type
                }
                title={announcement.title}
                compact
              />
            ) : null}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 p-4">
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-decorato-paper px-2 py-1 text-xs text-decorato-muted">{announcement.status}</span>
                  {announcement.popup_enabled ? (
                    <span className="rounded-full bg-decorato-sun/30 px-2 py-1 text-xs text-decorato-ink">
                      popup {announcement.popup_active ? "ativo" : "inativo"}
                    </span>
                  ) : null}
                  {announcement.banner_enabled ? (
                    <span className="rounded-full bg-decorato-coral/10 px-2 py-1 text-xs text-decorato-coral">
                      banner {announcement.banner_active ? "ativo" : "inativo"}
                    </span>
                  ) : null}
                  <span className="rounded-full bg-decorato-teal/10 px-2 py-1 text-xs text-decorato-teal">
                    {(targetCounts.get(announcement.id) ?? 0) || "todos"} alvo(s)
                  </span>
                </div>
                <h3 className="mt-1 font-semibold text-decorato-ink">{announcement.title}</h3>
                <p className="mt-2 line-clamp-3 text-sm leading-6 text-decorato-muted">{announcement.body}</p>
                {announcement.popup_enabled && announcement.popup_starts_at && announcement.popup_ends_at ? (
                  <p className="mt-2 text-xs text-decorato-muted">
                    Popup de {new Date(announcement.popup_starts_at).toLocaleString("pt-BR")} ate{" "}
                    {new Date(announcement.popup_ends_at).toLocaleString("pt-BR")}
                  </p>
                ) : null}
                {announcement.banner_enabled && announcement.banner_starts_at && announcement.banner_ends_at ? (
                  <p className="mt-1 text-xs text-decorato-muted">
                    Banner de {new Date(announcement.banner_starts_at).toLocaleString("pt-BR")} ate{" "}
                    {new Date(announcement.banner_ends_at).toLocaleString("pt-BR")}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2 p-4">
                <Link
                  href={`/admin/announcements/${announcement.id}/edit`}
                  className="inline-flex h-10 items-center rounded-md border border-decorato-line bg-white px-4 text-sm font-semibold text-decorato-ink hover:bg-decorato-paper"
                >
                  Editar
                </Link>
                {announcement.status === "draft" ? (
                  <form action={publishAnnouncement}>
                    <input type="hidden" name="announcementId" value={announcement.id} />
                    <Button type="submit" variant="secondary">
                      Publicar
                    </Button>
                  </form>
                ) : null}
                {announcement.status === "archived" ? (
                  <form action={reactivateAnnouncement}>
                    <input type="hidden" name="announcementId" value={announcement.id} />
                    <Button type="submit" variant="secondary">
                      Reativar
                    </Button>
                  </form>
                ) : null}
                {announcement.status !== "archived" ? (
                  <form action={archiveAnnouncement}>
                    <input type="hidden" name="announcementId" value={announcement.id} />
                    <Button type="submit" variant="danger">
                      Arquivar
                    </Button>
                  </form>
                ) : null}
                <AnnouncementTrashButton announcementId={announcement.id} />
              </div>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

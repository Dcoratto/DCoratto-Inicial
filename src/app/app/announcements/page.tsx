import { AnnouncementCard } from "@/components/announcement-card";
import { EmptyState } from "@/components/ui/empty-state";
import { createSignedUrl } from "@/lib/storage";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Announcement } from "@/types/app";

export default async function AnnouncementsPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("announcements")
    .select(
      "id,title,body,status,published_at,media_storage_path,media_original_name,media_mime_type,media_size_bytes,popup_media_storage_path,popup_media_mime_type,banner_image_storage_path,banner_image_mime_type,popup_enabled,popup_starts_at,popup_ends_at,created_at,updated_at"
    )
    .eq("status", "published")
    .is("deleted_at", null)
    .is("permanently_deleted_at", null)
    .order("published_at", { ascending: false })
    .limit(40);

  const announcements = (data ?? []) as Announcement[];
  const mediaUrls = new Map(
    await Promise.all(
      announcements.map(async (announcement) => [
        announcement.id,
        announcement.popup_media_storage_path || announcement.media_storage_path
          ? await createSignedUrl((announcement.popup_media_storage_path ?? announcement.media_storage_path) as string)
          : null
      ] as const)
    )
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold text-decorato-ink">Comunicados</h1>
        <p className="mt-2 text-decorato-muted">Avisos, campanhas e novidades da Central D&apos;Coratto.</p>
      </header>

      {announcements.length > 0 ? (
        <div className="space-y-4">
          {announcements.map((announcement) => (
            <AnnouncementCard key={announcement.id} announcement={announcement} mediaUrl={mediaUrls.get(announcement.id)} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="Nenhum comunicado publicado"
          description="Quando houver novidades, campanhas ou avisos internos, eles aparecerão aqui."
        />
      )}
    </div>
  );
}

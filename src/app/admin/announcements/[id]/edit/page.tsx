import { notFound } from "next/navigation";
import { AdminAnnouncementForm } from "@/components/admin-announcement-form";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Announcement, Category, Profile } from "@/types/app";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditAnnouncementPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [{ data: announcementData }, { data: profilesData }, { data: categoriesData }, { data: targetsData }, { data: categoryTargetsData }] =
    await Promise.all([
      supabase
        .from("announcements")
        .select(
          "id,title,body,status,published_at,media_storage_path,media_original_name,media_mime_type,media_size_bytes,popup_media_storage_path,popup_media_original_name,popup_media_mime_type,popup_media_size_bytes,popup_media_width,popup_media_height,popup_media_duration_seconds,banner_image_storage_path,banner_image_original_name,banner_image_mime_type,banner_image_size_bytes,banner_image_width,banner_image_height,popup_enabled,popup_starts_at,popup_ends_at,banner_enabled,banner_starts_at,banner_ends_at,popup_active,banner_active,created_at,updated_at"
        )
        .eq("id", id)
        .is("deleted_at", null)
        .is("permanently_deleted_at", null)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("id,username,email,full_name,role,department,department_id,department_category_id,is_active,must_change_password")
        .eq("is_active", true)
        .order("full_name", { ascending: true }),
      supabase
        .from("categories")
        .select("id,parent_id,name,slug,description,sort_order,is_active,is_department,access_scope")
        .eq("is_active", true)
        .eq("is_department", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase.from("announcement_targets").select("user_id").eq("announcement_id", id),
      supabase.from("announcement_target_categories").select("category_id").eq("announcement_id", id)
    ]);

  if (!announcementData) {
    notFound();
  }

  const announcement = announcementData as Announcement;
  const profiles = (profilesData ?? []) as Profile[];
  const categories = (categoriesData ?? []) as Category[];
  const selectedUserIds = ((targetsData as Array<{ user_id: string }> | null) ?? []).map((target) => target.user_id);
  const selectedCategoryIds = ((categoryTargetsData as Array<{ category_id: string }> | null) ?? []).map(
    (target) => target.category_id
  );

  return (
    <section className="mx-auto max-w-3xl rounded-lg border border-decorato-line bg-white p-6">
      <p className="text-sm uppercase tracking-wide text-decorato-teal">Comunicados</p>
      <h1 className="mt-1 text-2xl font-semibold text-decorato-ink">Editar comunicado</h1>
      <p className="mt-1 text-sm leading-6 text-decorato-muted">
        Ajuste texto, publico, banner e popup sem criar um novo comunicado.
      </p>
      <AdminAnnouncementForm
        mode="edit"
        announcement={announcement}
        profiles={profiles}
        categories={categories}
        selectedUserIds={selectedUserIds}
        selectedCategoryIds={selectedCategoryIds}
      />
    </section>
  );
}

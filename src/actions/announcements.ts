"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAnnouncementFromFormData } from "@/lib/announcements/create";
import { writeAuditLog } from "@/lib/audit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function createAnnouncement(formData: FormData) {
  const admin = await requireAdmin();
  await createAnnouncementFromFormData(formData, admin.id);
  revalidatePath("/admin/announcements");
}

export async function publishAnnouncement(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("announcementId") ?? "");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("publish_announcement_with_exclusive_surfaces", {
    p_announcement_id: id,
    p_actor_id: admin.id
  });

  if (error) {
    throw new Error("Nao foi possivel publicar o comunicado.");
  }

  await writeAuditLog({
    actorId: admin.id,
    action: "announcement.publish",
    entityType: "announcement",
    entityId: id
  });

  revalidatePath("/admin/announcements");
  revalidatePath("/app/announcements");
  revalidatePath("/app");
}

export async function archiveAnnouncement(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("announcementId") ?? "");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("announcements")
    .update({ status: "archived", popup_active: false, banner_active: false })
    .eq("id", id)
    .is("deleted_at", null)
    .is("permanently_deleted_at", null);

  if (error) {
    throw new Error("Nao foi possivel arquivar o comunicado.");
  }

  await writeAuditLog({
    actorId: admin.id,
    action: "announcement.archive",
    entityType: "announcement",
    entityId: id
  });

  revalidatePath("/admin/announcements");
  revalidatePath("/app/announcements");
  revalidatePath("/app");
}

export async function reactivateAnnouncement(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("announcementId") ?? "");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("announcements")
    .update({ status: "published", popup_active: false, banner_active: false })
    .eq("id", id)
    .is("deleted_at", null)
    .is("permanently_deleted_at", null);

  if (error) {
    throw new Error("Não foi possível reativar o comunicado.");
  }

  await writeAuditLog({
    actorId: admin.id,
    action: "announcement.reactivate",
    entityType: "announcement",
    entityId: id
  });

  revalidatePath("/admin/announcements");
  revalidatePath("/app/announcements");
  revalidatePath("/app");
}

"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireAuth } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { isUploadedFile, processUploadFile } from "@/lib/media-processing";
import { ensureKnowledgeBucketUploadConfiguration, KNOWLEDGE_BUCKET } from "@/lib/storage";
import { createServiceRoleClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { onboardingItemSchema, onboardingTrackSchema } from "@/lib/validation";

export async function createOnboardingTrack(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = onboardingTrackSchema.parse(Object.fromEntries(formData));
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("onboarding_tracks")
    .insert({
      title: parsed.title,
      description: parsed.description || null,
      department_category_id: parsed.department_category_id || null,
      created_by: admin.id
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error("Nao foi possivel criar a trilha.");
  }

  await writeAuditLog({
    actorId: admin.id,
    action: "onboarding.track_create",
    entityType: "onboarding_track",
    entityId: (data as { id: string }).id
  });

  revalidatePath("/admin/onboarding");
}

export async function createOnboardingItem(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = onboardingItemSchema.parse(Object.fromEntries(formData));
  const supabase = await createSupabaseServerClient();
  const service = createServiceRoleClient();
  const uploadedFile = await storeOnboardingFileIfPresent(formData.get("item_file"), admin.id);
  const { data, error } = await supabase
    .from("onboarding_items")
    .insert({
      track_id: parsed.track_id,
      title: parsed.title,
      description: parsed.description || null,
      document_id: parsed.document_id || null,
      video_url: parsed.video_url || null,
      attachment_id: uploadedFile?.attachmentId ?? null,
      file_storage_path: uploadedFile?.storagePath ?? null,
      file_original_name: uploadedFile?.originalName ?? null,
      file_mime_type: uploadedFile?.mimeType ?? null,
      file_size_bytes: uploadedFile?.sizeBytes ?? null,
      sort_order: parsed.sort_order
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error("Nao foi possivel criar o item.");
  }

  await writeAuditLog({
    actorId: admin.id,
    action: "onboarding.item_create",
    entityType: "onboarding_item",
    entityId: (data as { id: string }).id
  });

  await service.rpc("create_onboarding_receipts", {
    p_track_id: parsed.track_id,
    p_assigned_by: admin.id
  });

  revalidatePath("/admin/onboarding");
  revalidatePath("/app/onboarding");
}

export async function completeOnboardingItem(formData: FormData) {
  const currentUser = await requireAuth();
  const itemId = String(formData.get("itemId") ?? "");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("complete_onboarding_item", {
    p_item_id: itemId
  });

  if (error) {
    throw new Error("Nao foi possivel marcar o item como concluido.");
  }

  await supabase.rpc("mark_content_as_viewed", {
    p_content_type: "onboarding",
    p_content_id: itemId,
    p_category_id: null,
    p_user_id: currentUser.id,
    p_source: "manual"
  });

  revalidatePath("/app/onboarding");
  redirect("/app/onboarding");
}

async function storeOnboardingFileIfPresent(value: FormDataEntryValue | null, adminId: string) {
  if (!isUploadedFile(value) || value.size === 0) {
    return null;
  }

  const processed = await processUploadFile(value, {
    allowPdf: true,
    allowVideo: true
  });
  await ensureKnowledgeBucketUploadConfiguration();
  const service = createServiceRoleClient();
  const today = new Date().toISOString().slice(0, 10);
  const storagePath = `onboarding/${adminId}/${today}/${randomUUID()}${processed.extension}`;
  const { error: storageError } = await service.storage.from(KNOWLEDGE_BUCKET).upload(storagePath, processed.bytes, {
    contentType: processed.mimeType,
    upsert: false
  });

  if (storageError) {
    throw new Error("Não foi possível enviar o arquivo da trilha.");
  }

  const { data, error } = await service
    .from("attachments")
    .insert({
      document_id: null,
      storage_path: storagePath,
      original_name: processed.originalName.slice(0, 180),
      mime_type: processed.mimeType,
      size_bytes: processed.sizeBytes,
      uploaded_by: adminId
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    await service.storage.from(KNOWLEDGE_BUCKET).remove([storagePath]);
    throw new Error("Não foi possível vincular o arquivo à trilha.");
  }

  await writeAuditLog({
    actorId: adminId,
    action: "onboarding.file_upload",
    entityType: "onboarding_item",
    metadata: {
      attachmentId: data.id,
      mimeType: processed.mimeType,
      sizeBytes: processed.sizeBytes
    }
  });

  return {
    attachmentId: data.id,
    storagePath,
    originalName: processed.originalName.slice(0, 180),
    mimeType: processed.mimeType,
    sizeBytes: processed.sizeBytes
  };
}

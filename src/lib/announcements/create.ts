import "server-only";

import { randomUUID } from "node:crypto";
import { writeAuditLog } from "@/lib/audit";
import { isUploadedFile, processUploadFile } from "@/lib/media-processing";
import { ensureKnowledgeBucketUploadConfiguration, KNOWLEDGE_BUCKET } from "@/lib/storage";
import { createServiceRoleClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { announcementSchema } from "@/lib/validation";

export async function createAnnouncementFromFormData(formData: FormData, adminId: string) {
  const parsed = announcementSchema.parse(Object.fromEntries(formData));
  const service = createServiceRoleClient();
  const popupMedia = await processAnnouncementMedia(formData.get("popup_media"), adminId, "popup");
  const bannerImage = await processAnnouncementMedia(formData.get("banner_image"), adminId, "banner");
  const popupWindow = buildWindow(parsed.popup_enabled, parsed.popup_starts_at, parsed.popup_duration_days);
  const bannerWindow = buildWindow(parsed.banner_enabled, parsed.banner_starts_at, parsed.banner_duration_days);
  const targetUserIds = formData
    .getAll("target_user_ids")
    .map(String)
    .filter(Boolean);
  const targetCategoryIds = formData
    .getAll("target_category_ids")
    .map(String)
    .filter(Boolean);

  if (parsed.popup_enabled && !popupMedia) {
    throw new Error("Envie uma mídia quadrada para exibir o popup.");
  }

  if (parsed.banner_enabled && !bannerImage) {
    throw new Error("Envie uma imagem horizontal para exibir o banner.");
  }

  const { data, error } = await service
    .from("announcements")
    .insert({
      title: parsed.title,
      body: parsed.body,
      status: "draft",
      created_by: adminId,
      popup_media_storage_path: popupMedia?.storagePath ?? null,
      popup_media_original_name: popupMedia?.originalName ?? null,
      popup_media_mime_type: popupMedia?.mimeType ?? null,
      popup_media_size_bytes: popupMedia?.sizeBytes ?? null,
      popup_media_width: popupMedia?.width ?? null,
      popup_media_height: popupMedia?.height ?? null,
      popup_media_duration_seconds: popupMedia?.durationSeconds ?? null,
      banner_image_storage_path: bannerImage?.storagePath ?? null,
      banner_image_original_name: bannerImage?.originalName ?? null,
      banner_image_mime_type: bannerImage?.mimeType ?? null,
      banner_image_size_bytes: bannerImage?.sizeBytes ?? null,
      banner_image_width: bannerImage?.width ?? null,
      banner_image_height: bannerImage?.height ?? null,
      popup_enabled: parsed.popup_enabled,
      popup_starts_at: popupWindow.startsAt,
      popup_ends_at: popupWindow.endsAt,
      banner_enabled: parsed.banner_enabled,
      banner_starts_at: bannerWindow.startsAt,
      banner_ends_at: bannerWindow.endsAt
    })
    .select("id")
    .single();

  if (error || !data) {
    await removeUploadedAnnouncementMedia([popupMedia, bannerImage]);
    throw new Error(
      getAnnouncementDatabaseMessage(
        error,
        "Não foi possível criar o comunicado. Verifique os dados e tente novamente."
      )
    );
  }

  const announcementId = (data as { id: string }).id;
  if (targetUserIds.length > 0) {
    const { error: targetError } = await service.from("announcement_targets").insert(
      targetUserIds.map((userId) => ({
        announcement_id: announcementId,
        user_id: userId
      }))
    );

    if (targetError) {
      await service.from("announcements").delete().eq("id", announcementId);
      await removeUploadedAnnouncementMedia([popupMedia, bannerImage]);
      throw new Error(
        getAnnouncementDatabaseMessage(targetError, "Não foi possível definir o público do comunicado.")
      );
    }
  }

  if (targetCategoryIds.length > 0) {
    const { error: targetCategoryError } = await service.from("announcement_target_categories").insert(
      targetCategoryIds.map((categoryId) => ({
        announcement_id: announcementId,
        category_id: categoryId
      }))
    );

    if (targetCategoryError) {
      await service.from("announcements").delete().eq("id", announcementId);
      await removeUploadedAnnouncementMedia([popupMedia, bannerImage]);
      throw new Error(
        getAnnouncementDatabaseMessage(
          targetCategoryError,
          "Não foi possível definir os departamentos do comunicado."
        )
      );
    }
  }

  await writeAuditLog({
    actorId: adminId,
    action: "announcement.create",
    entityType: "announcement",
    entityId: announcementId,
    metadata: {
      hasPopupMedia: Boolean(popupMedia),
      hasBannerImage: Boolean(bannerImage),
      popupEnabled: parsed.popup_enabled,
      bannerEnabled: parsed.banner_enabled,
      targets: targetUserIds.length,
      targetDepartments: targetCategoryIds.length
    }
  });

  return announcementId;
}

export async function updateAnnouncementFromFormData(formData: FormData, adminId: string) {
  const parsed = announcementSchema.parse(Object.fromEntries(formData));
  const announcementId = parsed.id;

  if (!announcementId) {
    throw new Error("Comunicado invalido.");
  }

  const service = createServiceRoleClient();
  const userSupabase = await createSupabaseServerClient();
  const { data: existing, error: existingError } = await service
    .from("announcements")
    .select(
      "id,status,media_storage_path,media_original_name,media_mime_type,media_size_bytes,popup_media_storage_path,popup_media_original_name,popup_media_mime_type,popup_media_size_bytes,popup_media_width,popup_media_height,popup_media_duration_seconds,banner_image_storage_path,banner_image_original_name,banner_image_mime_type,banner_image_size_bytes,banner_image_width,banner_image_height"
    )
    .eq("id", announcementId)
    .is("deleted_at", null)
    .is("permanently_deleted_at", null)
    .single<{
      id: string;
      status: string;
      media_storage_path: string | null;
      media_original_name: string | null;
      media_mime_type: string | null;
      media_size_bytes: number | null;
      popup_media_storage_path: string | null;
      popup_media_original_name: string | null;
      popup_media_mime_type: string | null;
      popup_media_size_bytes: number | null;
      popup_media_width: number | null;
      popup_media_height: number | null;
      popup_media_duration_seconds: number | null;
      banner_image_storage_path: string | null;
      banner_image_original_name: string | null;
      banner_image_mime_type: string | null;
      banner_image_size_bytes: number | null;
      banner_image_width: number | null;
      banner_image_height: number | null;
    }>();

  if (existingError || !existing) {
    throw new Error("Comunicado nao encontrado.");
  }

  const newPopupMedia = await processAnnouncementMedia(formData.get("popup_media"), adminId, "popup");
  const newBannerImage = await processAnnouncementMedia(formData.get("banner_image"), adminId, "banner");
  const removePopupMedia = formData.get("remove_popup_media") === "on";
  const removeBannerImage = formData.get("remove_banner_image") === "on";
  const popupWindow = buildWindow(parsed.popup_enabled, parsed.popup_starts_at, parsed.popup_duration_days);
  const bannerWindow = buildWindow(parsed.banner_enabled, parsed.banner_starts_at, parsed.banner_duration_days);
  const popupMedia = newPopupMedia
    ? newPopupMedia
    : removePopupMedia
      ? null
      : existing.popup_media_storage_path || existing.media_storage_path
        ? {
            storagePath: existing.popup_media_storage_path ?? existing.media_storage_path ?? "",
            originalName: existing.popup_media_original_name ?? existing.media_original_name ?? "popup",
            mimeType: existing.popup_media_mime_type ?? existing.media_mime_type ?? "application/octet-stream",
            sizeBytes: existing.popup_media_size_bytes ?? existing.media_size_bytes ?? 0,
            width: existing.popup_media_width,
            height: existing.popup_media_height,
            durationSeconds: existing.popup_media_duration_seconds
          }
        : null;
  const bannerImage = newBannerImage
    ? newBannerImage
    : removeBannerImage
      ? null
      : existing.banner_image_storage_path
        ? {
            storagePath: existing.banner_image_storage_path,
            originalName: existing.banner_image_original_name ?? "banner",
            mimeType: existing.banner_image_mime_type ?? "application/octet-stream",
            sizeBytes: existing.banner_image_size_bytes ?? 0,
            width: existing.banner_image_width,
            height: existing.banner_image_height,
            durationSeconds: null
          }
        : null;
  const targetUserIds = formData
    .getAll("target_user_ids")
    .map(String)
    .filter(Boolean);
  const targetCategoryIds = formData
    .getAll("target_category_ids")
    .map(String)
    .filter(Boolean);

  if (parsed.popup_enabled && !popupMedia) {
    await removeUploadedAnnouncementMedia([newPopupMedia, newBannerImage]);
    throw new Error("Envie uma midia quadrada para exibir o popup.");
  }

  if (parsed.banner_enabled && !bannerImage) {
    await removeUploadedAnnouncementMedia([newPopupMedia, newBannerImage]);
    throw new Error("Envie uma imagem horizontal para exibir o banner.");
  }

  const { error: updateError } = await service
    .from("announcements")
    .update({
      title: parsed.title,
      body: parsed.body,
      popup_media_storage_path: popupMedia?.storagePath ?? null,
      popup_media_original_name: popupMedia?.originalName ?? null,
      popup_media_mime_type: popupMedia?.mimeType ?? null,
      popup_media_size_bytes: popupMedia?.sizeBytes ?? null,
      popup_media_width: popupMedia?.width ?? null,
      popup_media_height: popupMedia?.height ?? null,
      popup_media_duration_seconds: popupMedia?.durationSeconds ?? null,
      banner_image_storage_path: bannerImage?.storagePath ?? null,
      banner_image_original_name: bannerImage?.originalName ?? null,
      banner_image_mime_type: bannerImage?.mimeType ?? null,
      banner_image_size_bytes: bannerImage?.sizeBytes ?? null,
      banner_image_width: bannerImage?.width ?? null,
      banner_image_height: bannerImage?.height ?? null,
      popup_enabled: parsed.popup_enabled,
      popup_starts_at: popupWindow.startsAt,
      popup_ends_at: popupWindow.endsAt,
      banner_enabled: parsed.banner_enabled,
      banner_starts_at: bannerWindow.startsAt,
      banner_ends_at: bannerWindow.endsAt,
      popup_active: existing.status === "published" ? parsed.popup_enabled : false,
      banner_active: existing.status === "published" ? parsed.banner_enabled : false
    })
    .eq("id", announcementId);

  if (updateError) {
    await removeUploadedAnnouncementMedia([newPopupMedia, newBannerImage]);
    throw new Error(
      getAnnouncementDatabaseMessage(
        updateError,
        "Nao foi possivel atualizar o comunicado. Verifique os dados e tente novamente."
      )
    );
  }

  const { error: deleteTargetsError } = await service
    .from("announcement_targets")
    .delete()
    .eq("announcement_id", announcementId);

  if (deleteTargetsError) {
    throw new Error("Nao foi possivel atualizar o publico do comunicado.");
  }

  const { error: deleteCategoryTargetsError } = await service
    .from("announcement_target_categories")
    .delete()
    .eq("announcement_id", announcementId);

  if (deleteCategoryTargetsError) {
    throw new Error("Nao foi possivel atualizar os departamentos do comunicado.");
  }

  if (targetUserIds.length > 0) {
    const { error: targetError } = await service.from("announcement_targets").insert(
      targetUserIds.map((userId) => ({
        announcement_id: announcementId,
        user_id: userId
      }))
    );

    if (targetError) {
      throw new Error("Nao foi possivel definir o publico do comunicado.");
    }
  }

  if (targetCategoryIds.length > 0) {
    const { error: targetCategoryError } = await service.from("announcement_target_categories").insert(
      targetCategoryIds.map((categoryId) => ({
        announcement_id: announcementId,
        category_id: categoryId
      }))
    );

    if (targetCategoryError) {
      throw new Error("Nao foi possivel definir os departamentos do comunicado.");
    }
  }

  if (existing.status === "published") {
    if (parsed.popup_enabled || parsed.banner_enabled) {
      const { error: publishError } = await userSupabase.rpc("publish_announcement_with_exclusive_surfaces", {
        p_announcement_id: announcementId,
        p_actor_id: adminId
      });

      if (publishError) {
        throw new Error("Comunicado atualizado, mas nao foi possivel ativar banner ou popup.");
      }
    } else {
      await userSupabase.rpc("create_announcement_receipts", {
        p_announcement_id: announcementId,
        p_assigned_by: adminId
      });
    }
  }

  await removeUploadedAnnouncementMedia([
    newPopupMedia && existing.popup_media_storage_path
      ? {
          storagePath: existing.popup_media_storage_path,
          originalName: existing.popup_media_original_name ?? "popup",
          mimeType: existing.popup_media_mime_type ?? "application/octet-stream",
          sizeBytes: existing.popup_media_size_bytes ?? 0,
          width: existing.popup_media_width,
          height: existing.popup_media_height,
          durationSeconds: existing.popup_media_duration_seconds
        }
      : null,
    removePopupMedia && existing.popup_media_storage_path
      ? {
          storagePath: existing.popup_media_storage_path,
          originalName: existing.popup_media_original_name ?? "popup",
          mimeType: existing.popup_media_mime_type ?? "application/octet-stream",
          sizeBytes: existing.popup_media_size_bytes ?? 0,
          width: existing.popup_media_width,
          height: existing.popup_media_height,
          durationSeconds: existing.popup_media_duration_seconds
        }
      : null,
    newBannerImage && existing.banner_image_storage_path
      ? {
          storagePath: existing.banner_image_storage_path,
          originalName: existing.banner_image_original_name ?? "banner",
          mimeType: existing.banner_image_mime_type ?? "application/octet-stream",
          sizeBytes: existing.banner_image_size_bytes ?? 0,
          width: existing.banner_image_width,
          height: existing.banner_image_height,
          durationSeconds: null
        }
      : null,
    removeBannerImage && existing.banner_image_storage_path
      ? {
          storagePath: existing.banner_image_storage_path,
          originalName: existing.banner_image_original_name ?? "banner",
          mimeType: existing.banner_image_mime_type ?? "application/octet-stream",
          sizeBytes: existing.banner_image_size_bytes ?? 0,
          width: existing.banner_image_width,
          height: existing.banner_image_height,
          durationSeconds: null
        }
      : null
  ]);

  await writeAuditLog({
    actorId: adminId,
    action: "announcement.update",
    entityType: "announcement",
    entityId: announcementId,
    metadata: {
      popupEnabled: parsed.popup_enabled,
      bannerEnabled: parsed.banner_enabled,
      popupMediaUpdated: Boolean(newPopupMedia || removePopupMedia),
      bannerUpdated: Boolean(newBannerImage || removeBannerImage),
      targets: targetUserIds.length,
      targetDepartments: targetCategoryIds.length
    }
  });

  return announcementId;
}

type AnnouncementMedia = {
  storagePath: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
};

async function processAnnouncementMedia(
  value: FormDataEntryValue | null,
  userId: string,
  kind: "popup" | "banner"
): Promise<AnnouncementMedia | null> {
  if (!isUploadedFile(value) || value.size === 0) {
    return null;
  }

  if (kind === "popup" && !value.type.startsWith("image/") && !value.type.startsWith("video/")) {
    throw new Error("Popup aceita PNG, JPG, WebP ou video.");
  }

  if (kind === "banner" && !value.type.startsWith("image/")) {
    throw new Error("Banners aceitam apenas imagem. Envie PNG, JPG ou WebP no formato 1920x600.");
  }

  if (kind === "banner" && value.type.startsWith("video/")) {
    throw new Error("Banners aceitam apenas imagem. Envie PNG, JPG ou WebP no formato 1920x600.");
  }

  const processed = await processUploadFile(value, {
    allowPdf: false,
    allowVideo: kind === "popup",
    imageAspect:
      kind === "popup"
        ? {
            target: 1,
            tolerance: 0.02,
            message:
              "Imagem recusada. Popups devem estar no formato quadrado 1:1. Use 1080x1080 px ou outra medida quadrada."
          }
        : {
            target: 3.2,
            tolerance: 0.03,
            message:
              "Imagem recusada. Banners devem estar no formato horizontal 1920x600 px, proporção 3.2:1."
          }
  });
  const today = new Date().toISOString().slice(0, 10);
  const storagePath = `announcements/${kind}/${userId}/${today}/${randomUUID()}${processed.extension}`;
  await ensureKnowledgeBucketUploadConfiguration();
  const service = createServiceRoleClient();
  const { error } = await service.storage.from(KNOWLEDGE_BUCKET).upload(storagePath, processed.bytes, {
    contentType: processed.mimeType,
    upsert: false
  });

  if (error) {
    throw new Error("Não foi possível enviar a mídia do comunicado.");
  }

  return {
    storagePath,
    originalName: processed.originalName.slice(0, 180),
    mimeType: processed.mimeType,
    sizeBytes: processed.sizeBytes,
    width: processed.width,
    height: processed.height,
    durationSeconds: null
  };
}

async function removeUploadedAnnouncementMedia(items: Array<AnnouncementMedia | null>) {
  const paths = items.map((item) => item?.storagePath).filter(Boolean) as string[];
  if (paths.length === 0) {
    return;
  }

  const service = createServiceRoleClient();
  await service.storage.from(KNOWLEDGE_BUCKET).remove(paths);
}

function buildWindow(enabled: boolean, startsAtInput: string | undefined, durationDays: number) {
  if (!enabled) {
    return {
      startsAt: null,
      endsAt: null
    };
  }

  const startsAt = startsAtInput ? new Date(startsAtInput) : new Date();
  const endsAt = new Date(startsAt);
  endsAt.setDate(endsAt.getDate() + durationDays);

  return {
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString()
  };
}

function getAnnouncementDatabaseMessage(
  error: { message?: string; code?: string; details?: string } | null,
  fallback: string
) {
  const databaseMessage = [error?.message, error?.code, error?.details].filter(Boolean).join(" ").toLowerCase();

  if (
    databaseMessage.includes("schema cache") ||
    databaseMessage.includes("column") ||
    databaseMessage.includes("relation") ||
    databaseMessage.includes("announcement_target_categories") ||
    databaseMessage.includes("popup_media_") ||
    databaseMessage.includes("banner_image_")
  ) {
    return "A estrutura do banco ainda não está atualizada para comunicados com banner, popup e departamentos. Aplique as migrations mais recentes no Supabase e tente novamente.";
  }

  return fallback;
}

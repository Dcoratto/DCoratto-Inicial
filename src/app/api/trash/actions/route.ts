import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { KNOWLEDGE_BUCKET } from "@/lib/storage";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const trashTypeSchema = z.enum(["document", "folder", "link", "attachment", "document_version", "announcement"]);
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("moveToTrash"), itemType: z.literal("announcement"), itemId: z.string().uuid() }),
  z.object({ action: z.literal("restore"), itemType: trashTypeSchema, itemId: z.string().uuid() }),
  z.object({ action: z.literal("permanentDelete"), itemType: trashTypeSchema, itemId: z.string().uuid() }),
  z.object({ action: z.literal("purgeExpired") })
]);

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.profile.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Voce nao tem permissao para acessar a lixeira." }, { status: 403 });
  }

  const json = await request.json().catch(() => null);
  const parsed = actionSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Acao da lixeira invalida." }, { status: 400 });
  }

  const service = createServiceRoleClient();
  const actorId = currentUser.id;

  if (parsed.data.action === "moveToTrash") {
    const result = await moveAnnouncementToTrash(service, parsed.data.itemId, actorId);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  if (parsed.data.action === "restore") {
    const result = await restoreItem(service, parsed.data.itemType, parsed.data.itemId, actorId);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  if (parsed.data.action === "permanentDelete") {
    const result = await permanentlyDeleteItem(service, parsed.data.itemType, parsed.data.itemId, actorId, false);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  const purged = [];
  for (const type of trashTypeSchema.options) {
    const table = tableForType(type);
    let expiredQuery = service
      .from(table)
      .select("id")
      .not("deleted_at", "is", null)
      .lte("trash_expires_at", new Date().toISOString())
      .limit(100);
    if (type === "announcement") {
      expiredQuery = expiredQuery.is("permanently_deleted_at", null);
    }
    const { data } = await expiredQuery;

    for (const row of ((data as Array<{ id: string }> | null) ?? [])) {
      const result = await permanentlyDeleteItem(service, type, row.id, actorId, true);
      purged.push({ type, id: row.id, ...result });
    }
  }

  return NextResponse.json({ ok: true, purged });
}

async function restoreItem(
  service: ReturnType<typeof createServiceRoleClient>,
  itemType: TrashItemType,
  itemId: string,
  actorId: string
) {
  if (itemType === "announcement") {
    const { data: announcement } = await service
      .from("announcements")
      .select("id,status_before_delete,deleted_at,permanently_deleted_at")
      .eq("id", itemId)
      .maybeSingle<{ id: string; status_before_delete: string | null; deleted_at: string | null; permanently_deleted_at: string | null }>();
    if (!announcement?.deleted_at || announcement.permanently_deleted_at) {
      return { ok: false, error: "Comunicado não encontrado na lixeira." };
    }

    const restoredStatus = ["draft", "published", "archived"].includes(announcement.status_before_delete ?? "")
      ? announcement.status_before_delete
      : "draft";
    const { error } = await service
      .from("announcements")
      .update({
        status: restoredStatus,
        popup_active: false,
        banner_active: false,
        deleted_at: null,
        deleted_by: null,
        trash_expires_at: null,
        delete_reason: null,
        restored_at: new Date().toISOString(),
        restored_by: actorId
      })
      .eq("id", itemId);
    if (error) return { ok: false, error: "Não foi possível restaurar o comunicado." };

    await writeAuditLog({ actorId, action: "announcement.restore_from_trash", entityType: "announcement", entityId: itemId });
    return { ok: true };
  }

  if (itemType === "folder") {
    const { data: folder } = await service
      .from("categories")
      .select("id,name,parent_id")
      .eq("id", itemId)
      .maybeSingle<{ id: string; name: string; parent_id: string | null }>();

    if (!folder) {
      return { ok: false, error: "Pasta nao encontrada." };
    }

    if (folder.parent_id) {
      const { data: parent } = await service
        .from("categories")
        .select("deleted_at")
        .eq("id", folder.parent_id)
        .maybeSingle<{ deleted_at: string | null }>();

      if (parent?.deleted_at) {
        return { ok: false, error: "A pasta superior tambem esta na lixeira. Restaure a pasta superior primeiro." };
      }
    }
  }

  const table = tableForType(itemType);
  const { data, error } = await service
    .from(table)
    .update({
      deleted_at: null,
      deleted_by: null,
      trash_expires_at: null,
      delete_reason: null,
      restored_at: new Date().toISOString(),
      restored_by: actorId
    })
    .eq("id", itemId)
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    return { ok: false, error: "Nao foi possivel restaurar o item." };
  }

  await writeAuditLog({
    actorId,
    action: `${auditPrefix(itemType)}.restore_from_trash`,
    entityType: entityType(itemType),
    entityId: itemId
  });

  return { ok: true };
}

async function permanentlyDeleteItem(
  service: ReturnType<typeof createServiceRoleClient>,
  itemType: TrashItemType,
  itemId: string,
  actorId: string,
  skipUnexpired: boolean
) {
  const table = tableForType(itemType);
  const { data: row } = await service
    .from(table)
    .select("*")
    .eq("id", itemId)
    .maybeSingle<TrashRow>();

  if (!row?.deleted_at) {
    return { ok: false, error: "Item nao esta na lixeira." };
  }

  const expiresAt = row.trash_expires_at ? new Date(row.trash_expires_at).getTime() : 0;
  if (!skipUnexpired && expiresAt > Date.now()) {
    return { ok: false, error: "Este item ainda esta dentro do prazo de restauracao de 30 dias." };
  }

  if (itemType === "announcement") {
    const { error } = await service
      .from("announcements")
      .update({
        status: "archived",
        popup_active: false,
        banner_active: false,
        permanently_deleted_at: new Date().toISOString(),
        permanently_deleted_by: actorId
      })
      .eq("id", itemId);
    if (error) return { ok: false, error: "Não foi possível excluir definitivamente o comunicado." };

    await writeAuditLog({ actorId, action: "announcement.permanent_delete", entityType: "announcement", entityId: itemId });
    return { ok: true };
  }

  if (itemType === "folder") {
    const [{ count: childrenCount }, { count: documentsCount }, { count: linksCount }] = await Promise.all([
      service.from("categories").select("id", { count: "exact", head: true }).eq("parent_id", itemId),
      service.from("documents").select("id", { count: "exact", head: true }).eq("category_id", itemId),
      service.from("folder_links").select("id", { count: "exact", head: true }).eq("category_id", itemId)
    ]);

    if ((childrenCount ?? 0) > 0 || (documentsCount ?? 0) > 0 || (linksCount ?? 0) > 0) {
      return { ok: false, error: "Pasta ainda possui conteudos. Esvazie ou restaure os itens internos antes da exclusao definitiva." };
    }
  }

  const storagePaths = await collectStoragePaths(service, itemType, itemId);
  const { error } = await service.from(table).delete().eq("id", itemId);

  if (error) {
    return { ok: false, error: "Nao foi possivel excluir definitivamente." };
  }

  for (const path of storagePaths) {
    await removeStoragePathIfUnused(service, path);
  }

  await writeAuditLog({
    actorId,
    action: `${auditPrefix(itemType)}.permanent_delete`,
    entityType: entityType(itemType),
    entityId: itemId
  });

  return { ok: true };
}

async function collectStoragePaths(
  service: ReturnType<typeof createServiceRoleClient>,
  itemType: TrashItemType,
  itemId: string
) {
  if (itemType === "attachment") {
    const { data } = await service.from("attachments").select("storage_path").eq("id", itemId).maybeSingle<{ storage_path: string }>();
    return data?.storage_path ? [data.storage_path] : [];
  }

  if (itemType === "document_version") {
    const { data } = await service
      .from("document_file_versions")
      .select("storage_path")
      .eq("id", itemId)
      .maybeSingle<{ storage_path: string }>();
    return data?.storage_path ? [data.storage_path] : [];
  }

  if (itemType === "document") {
    const [{ data: attachments }, { data: versions }] = await Promise.all([
      service.from("attachments").select("storage_path").eq("document_id", itemId),
      service.from("document_file_versions").select("storage_path").eq("document_id", itemId)
    ]);
    return [
      ...(((attachments as Array<{ storage_path: string }> | null) ?? []).map((item) => item.storage_path)),
      ...(((versions as Array<{ storage_path: string }> | null) ?? []).map((item) => item.storage_path))
    ];
  }

  return [];
}

async function removeStoragePathIfUnused(service: ReturnType<typeof createServiceRoleClient>, storagePath: string) {
  const [{ count: attachmentCount }, { count: versionCount }] = await Promise.all([
    service.from("attachments").select("id", { count: "exact", head: true }).eq("storage_path", storagePath),
    service.from("document_file_versions").select("id", { count: "exact", head: true }).eq("storage_path", storagePath)
  ]);

  if ((attachmentCount ?? 0) === 0 && (versionCount ?? 0) === 0) {
    await service.storage.from(KNOWLEDGE_BUCKET).remove([storagePath]);
  }
}

function tableForType(itemType: TrashItemType) {
  const tables: Record<TrashItemType, "documents" | "categories" | "folder_links" | "attachments" | "document_file_versions" | "announcements"> = {
    document: "documents",
    folder: "categories",
    link: "folder_links",
    attachment: "attachments",
    document_version: "document_file_versions",
    announcement: "announcements"
  };
  return tables[itemType];
}

function auditPrefix(itemType: TrashItemType) {
  const prefixes: Record<TrashItemType, string> = {
    document: "document",
    folder: "category",
    link: "folder_link",
    attachment: "attachment",
    document_version: "document_version",
    announcement: "announcement"
  };
  return prefixes[itemType];
}

function entityType(itemType: TrashItemType) {
  const entities: Record<TrashItemType, string> = {
    document: "document",
    folder: "category",
    link: "folder_link",
    attachment: "attachment",
    document_version: "document_file_version",
    announcement: "announcement"
  };
  return entities[itemType];
}

type TrashItemType = z.infer<typeof trashTypeSchema>;
type TrashRow = {
  id: string;
  deleted_at: string | null;
  trash_expires_at: string | null;
};

async function moveAnnouncementToTrash(
  service: ReturnType<typeof createServiceRoleClient>,
  itemId: string,
  actorId: string
) {
  const { data: announcement } = await service
    .from("announcements")
    .select("id,title,status,deleted_at,permanently_deleted_at")
    .eq("id", itemId)
    .maybeSingle<{ id: string; title: string; status: string; deleted_at: string | null; permanently_deleted_at: string | null }>();

  if (!announcement || announcement.permanently_deleted_at) {
    return { ok: false, error: "Comunicado não encontrado." };
  }
  if (announcement.deleted_at) {
    return { ok: true };
  }

  const { error } = await service
    .from("announcements")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: actorId,
      trash_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      delete_reason: "Movido para a lixeira pelo administrador.",
      status_before_delete: announcement.status,
      status: "archived",
      popup_active: false,
      banner_active: false
    })
    .eq("id", itemId);

  if (error) return { ok: false, error: "Não foi possível mover o comunicado para a lixeira." };

  await writeAuditLog({
    actorId,
    action: "announcement.move_to_trash",
    entityType: "announcement",
    entityId: itemId,
    metadata: { title: announcement.title, previousStatus: announcement.status }
  });
  return { ok: true };
}

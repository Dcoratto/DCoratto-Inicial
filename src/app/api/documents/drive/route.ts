import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { appendSlugSuffix, slugify } from "@/lib/slug";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("copy"), documentId: z.string().uuid(), categoryId: z.string().uuid().nullable().optional() }),
  z.object({ action: z.literal("move"), documentId: z.string().uuid(), categoryId: z.string().uuid() }),
  z.object({ action: z.enum(["deactivate", "reactivate", "delete"]), documentId: z.string().uuid() }),
  z.object({ action: z.literal("setCurrentVersion"), versionId: z.string().uuid() })
]);

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.profile.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Voce nao tem permissao para gerenciar documentos." }, { status: 403 });
  }

  const json = await request.json().catch(() => null);
  const parsed = actionSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Acao de documento invalida." }, { status: 400 });
  }

  const service = createServiceRoleClient();
  const actorId = currentUser.id;

  if (parsed.data.action === "copy") {
    const { data: source } = await service
      .from("documents")
      .select("id,category_id,title,summary,content_json,content_text,status,tags")
      .eq("id", parsed.data.documentId)
      .maybeSingle<DocumentRow>();

    if (!source) {
      return NextResponse.json({ ok: false, error: "Documento nao encontrado." }, { status: 404 });
    }

    const title = `${source.title} copia`.slice(0, 140);
    const slug = await getAvailableDocumentSlug(title);
    const { data: copied, error: copyError } = await service
      .from("documents")
      .insert({
        category_id: parsed.data.categoryId ?? source.category_id,
        title,
        slug,
        summary: source.summary,
        content_json: source.content_json,
        content_text: source.content_text,
        status: source.status,
        tags: source.tags,
        created_by: actorId,
        updated_by: actorId,
        published_at: source.status === "published" ? new Date().toISOString() : null
      })
      .select("id,title,slug,summary,category_id,status,updated_at,tags")
      .single();

    if (copyError || !copied) {
      return NextResponse.json({ ok: false, error: "Nao foi possivel copiar o documento." }, { status: 500 });
    }

    const { data: currentVersion } = await service
      .from("document_file_versions")
      .select("attachment_id,storage_path,original_name,mime_type,size_bytes,checksum,notes")
      .eq("document_id", source.id)
      .eq("is_current", true)
      .eq("is_active", true)
      .maybeSingle<VersionSourceRow>();

    if (currentVersion) {
      await service.from("document_file_versions").insert({
        document_id: copied.id,
        version_number: 1,
        attachment_id: currentVersion.attachment_id,
        storage_path: currentVersion.storage_path,
        original_name: currentVersion.original_name,
        mime_type: currentVersion.mime_type,
        size_bytes: currentVersion.size_bytes,
        checksum: currentVersion.checksum,
        notes: currentVersion.notes,
        is_current: true,
        is_active: true,
        created_by: actorId
      });
    }

    if (copied.status === "published") {
      await service.rpc("create_document_receipts", {
        p_document_id: copied.id,
        p_assigned_by: actorId
      });
    }

    await writeAuditLog({
      actorId,
      action: "document.copy",
      entityType: "document",
      entityId: copied.id,
      metadata: { sourceId: source.id, title: copied.title, categoryId: copied.category_id }
    });

    return NextResponse.json({ ok: true, document: copied });
  }

  if (parsed.data.action === "move") {
    const [{ data: source }, { data: destination }] = await Promise.all([
      service
        .from("documents")
        .select("id,title,category_id,deleted_at")
        .eq("id", parsed.data.documentId)
        .maybeSingle<{ id: string; title: string; category_id: string | null; deleted_at: string | null }>(),
      service
        .from("categories")
        .select("id,name,is_active,deleted_at")
        .eq("id", parsed.data.categoryId)
        .maybeSingle<{ id: string; name: string; is_active: boolean; deleted_at: string | null }>()
    ]);

    if (!source || source.deleted_at) {
      return NextResponse.json({ ok: false, error: "O documento não está disponível para movimentação." }, { status: 404 });
    }
    if (!destination || destination.deleted_at || !destination.is_active) {
      return NextResponse.json({ ok: false, error: "A pasta de destino não está disponível." }, { status: 400 });
    }

    const { data, error } = await service
      .from("documents")
      .update({ category_id: parsed.data.categoryId, updated_by: actorId })
      .eq("id", parsed.data.documentId)
      .select("id,title,slug,summary,category_id,status,updated_at,tags")
      .single();

    if (error || !data) {
      return NextResponse.json({ ok: false, error: "Não foi possível mover o documento." }, { status: 500 });
    }

    await writeAuditLog({
      actorId,
      action: "document.move",
      entityType: "document",
      entityId: data.id,
      metadata: {
        title: data.title,
        previousCategoryId: source.category_id,
        categoryId: data.category_id,
        targetName: destination.name
      }
    });

    return NextResponse.json({ ok: true, document: data });
  }

  if (parsed.data.action === "setCurrentVersion") {
    const { data, error } = await service.rpc("set_current_document_file_version", {
      p_version_id: parsed.data.versionId,
      p_actor_id: actorId
    });

    if (error) {
      return NextResponse.json({ ok: false, error: "Nao foi possivel tornar esta versao vigente." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, versionId: data });
  }

  const updates =
    parsed.data.action === "delete"
      ? {
          deleted_at: new Date().toISOString(),
          deleted_by: actorId,
          trash_expires_at: trashExpiresAt(),
          delete_reason: "Movido para a lixeira pelo admin.",
          updated_by: actorId
        }
      : parsed.data.action === "deactivate"
        ? { inactivated_at: new Date().toISOString(), inactivated_by: actorId, is_active: false, updated_by: actorId }
        : { inactivated_at: null, inactivated_by: null, is_active: true, updated_by: actorId };

  const { data, error } = await service
    .from("documents")
    .update(updates)
    .eq("id", parsed.data.documentId)
    .select("id,title,slug,summary,category_id,status,updated_at,tags")
    .single();

  if (error || !data) {
    return NextResponse.json({ ok: false, error: "Nao foi possivel atualizar o documento." }, { status: 500 });
  }

  await writeAuditLog({
    actorId,
    action: parsed.data.action === "delete" ? "document.move_to_trash" : `document.${parsed.data.action}`,
    entityType: "document",
    entityId: data.id,
    metadata: { title: data.title }
  });

  return NextResponse.json({ ok: true, document: data });
}

function trashExpiresAt() {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
}

async function getAvailableDocumentSlug(title: string): Promise<string> {
  const base = slugify(title) || appendSlugSuffix("documento");
  const service = createServiceRoleClient();
  const { data } = await service.from("documents").select("slug").ilike("slug", `${base}%`);
  const existing = new Set(((data as Array<{ slug: string }> | null) ?? []).map((item) => item.slug));
  if (!existing.has(base)) {
    return base;
  }

  let candidate = appendSlugSuffix(base);
  while (existing.has(candidate)) {
    candidate = appendSlugSuffix(base);
  }
  return candidate;
}

type DocumentRow = {
  id: string;
  category_id: string | null;
  title: string;
  summary: string | null;
  content_json: unknown;
  content_text: string;
  status: "draft" | "published" | "archived";
  tags: string[];
};

type VersionSourceRow = {
  attachment_id: string | null;
  storage_path: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  checksum: string | null;
  notes: string | null;
};

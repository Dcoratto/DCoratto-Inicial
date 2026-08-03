import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { appendSlugSuffix, slugify } from "@/lib/slug";
import { DEFAULT_VIDEO_UPLOAD_LIMIT_BYTES, isKnownVideoExtension, KNOWLEDGE_BUCKET, mimeTypeForKnownVideoExtension } from "@/lib/storage";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const completeSchema = z.object({
  categoryId: z.string().uuid(),
  storagePath: z.string().trim().min(1).max(500),
  originalName: z.string().trim().min(1).max(180),
  mimeType: z.string().trim().max(120).optional().or(z.literal("")),
  sizeBytes: z.coerce.number().int().positive().max(DEFAULT_VIDEO_UPLOAD_LIMIT_BYTES)
});

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.profile.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Voce nao tem permissao para concluir este upload.", code: "FORBIDDEN" }, { status: 403 });
  }

  const json = await request.json().catch(() => null);
  const parsed = completeSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Dados invalidos para concluir o upload.", code: "INVALID_PAYLOAD" }, { status: 400 });
  }

  const storagePath = parsed.data.storagePath;
  if (!isSafeGeneratedVideoPath(storagePath, currentUser.id)) {
    return NextResponse.json({ ok: false, error: "Caminho de arquivo invalido.", code: "INVALID_STORAGE_PATH" }, { status: 400 });
  }

  const mimeType = normalizedVideoMime(parsed.data.originalName, parsed.data.mimeType ?? "");
  if (!mimeType) {
    return NextResponse.json({ ok: false, error: "Arquivo recusado. Envie um video valido.", code: "INVALID_VIDEO_TYPE" }, { status: 400 });
  }

  const service = createServiceRoleClient();
  const [{ data: category }, existing] = await Promise.all([
    service.from("categories").select("id,name").eq("id", parsed.data.categoryId).is("deleted_at", null).maybeSingle<{ id: string; name: string }>(),
    findExistingDocumentByStoragePath(storagePath)
  ]);

  if (!category) {
    return NextResponse.json({ ok: false, error: "Pasta nao encontrada.", code: "INVALID_FOLDER" }, { status: 404 });
  }
  if (existing) {
    return NextResponse.json({ ok: true, document: existing.document, warning: existing.warning });
  }

  const exists = await storageObjectExists(storagePath);
  if (!exists) {
    return NextResponse.json({ ok: false, error: "O video ainda nao foi encontrado no Storage. Tente novamente em alguns segundos.", code: "STORAGE_OBJECT_NOT_FOUND" }, { status: 409 });
  }

  const title = titleFromFileName(parsed.data.originalName);
  const slug = await getAvailableDocumentSlug(title);
  const { data: document, error: documentError } = await service
    .from("documents")
    .insert({
      category_id: parsed.data.categoryId,
      title,
      slug,
      summary: `Video enviado: ${parsed.data.originalName}`.slice(0, 300),
      content_json: [{ id: randomUUID(), type: "paragraph", text: `Video enviado: ${parsed.data.originalName}` }],
      content_text: `${title} ${parsed.data.originalName}`,
      status: "published",
      tags: [],
      created_by: currentUser.id,
      updated_by: currentUser.id,
      published_at: new Date().toISOString()
    })
    .select("id,title,slug,summary,category_id,status,updated_at,tags")
    .single();

  if (documentError || !document) {
    return NextResponse.json({ ok: false, error: "Nao foi possivel criar o documento do video.", code: "DOCUMENT_CREATE_FAILED" }, { status: 500 });
  }

  const { data: attachment, error: attachmentError } = await service
    .from("attachments")
    .insert({
      document_id: document.id,
      storage_path: storagePath,
      original_name: parsed.data.originalName.slice(0, 180),
      mime_type: mimeType,
      size_bytes: parsed.data.sizeBytes,
      uploaded_by: currentUser.id
    })
    .select("id")
    .single<{ id: string }>();

  if (attachmentError || !attachment) {
    await service.from("documents").delete().eq("id", document.id);
    return NextResponse.json({ ok: false, error: "Nao foi possivel registrar o video.", code: "ATTACHMENT_CREATE_FAILED" }, { status: 500 });
  }

  const { data: version, error: versionError } = await service
    .from("document_file_versions")
    .insert({
      document_id: document.id,
      version_number: 1,
      attachment_id: attachment.id,
      storage_path: storagePath,
      original_name: parsed.data.originalName.slice(0, 180),
      mime_type: mimeType,
      size_bytes: parsed.data.sizeBytes,
      is_current: true,
      is_active: true,
      created_by: currentUser.id
    })
    .select("id,document_id,version_number,attachment_id,storage_path,original_name,mime_type,size_bytes,checksum,notes,is_current,is_active,created_by,created_at")
    .single();

  if (versionError || !version) {
    await service.from("attachments").delete().eq("id", attachment.id);
    await service.from("documents").delete().eq("id", document.id);
    return NextResponse.json({ ok: false, error: "Nao foi possivel criar a versao vigente do video.", code: "VERSION_CREATE_FAILED" }, { status: 500 });
  }

  await service.rpc("create_document_receipts", {
    p_document_id: document.id,
    p_assigned_by: currentUser.id
  });

  await writeAuditLog({
    actorId: currentUser.id,
    action: "document.folder_video_upload",
    entityType: "document",
    entityId: document.id,
    metadata: {
      title,
      categoryId: parsed.data.categoryId,
      versionId: version.id,
      mimeType,
      sizeBytes: parsed.data.sizeBytes
    }
  });

  return NextResponse.json({
    ok: true,
    document: {
      ...document,
      current_file_version: version
    },
    warning: "Video enviado com sucesso. Se o navegador nao reproduzir este formato, ele ficara disponivel para download."
  });
}

async function findExistingDocumentByStoragePath(storagePath: string) {
  const service = createServiceRoleClient();
  const { data: version } = await service
    .from("document_file_versions")
    .select("id,document_id,version_number,attachment_id,storage_path,original_name,mime_type,size_bytes,checksum,notes,is_current,is_active,created_by,created_at")
    .eq("storage_path", storagePath)
    .maybeSingle<{
      id: string;
      document_id: string;
      version_number: number;
      attachment_id: string | null;
      storage_path: string;
      original_name: string;
      mime_type: string;
      size_bytes: number;
      checksum: string | null;
      notes: string | null;
      is_current: boolean;
      is_active: boolean;
      created_by: string | null;
      created_at: string;
    }>();
  if (!version) return null;

  const { data: document } = await service
    .from("documents")
    .select("id,title,slug,summary,category_id,status,updated_at,tags")
    .eq("id", version.document_id)
    .maybeSingle();
  if (!document) return null;
  return {
    document: { ...document, current_file_version: version },
    warning: "Video ja estava registrado."
  };
}

async function storageObjectExists(storagePath: string) {
  const service = createServiceRoleClient();
  const lastSlash = storagePath.lastIndexOf("/");
  const folder = storagePath.slice(0, lastSlash);
  const name = storagePath.slice(lastSlash + 1);
  const { data, error } = await service.storage.from(KNOWLEDGE_BUCKET).list(folder, { limit: 10, search: name });
  if (error) {
    return false;
  }
  return Boolean(data?.some((item) => item.name === name));
}

async function getAvailableDocumentSlug(title: string): Promise<string> {
  const base = slugify(title) || appendSlugSuffix("video");
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

function titleFromFileName(name: string) {
  const withoutExtension = name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return (withoutExtension || "Video enviado").slice(0, 140);
}

function normalizedVideoMime(fileName: string, mimeType: string) {
  const declared = mimeType.trim().toLowerCase();
  if (declared.startsWith("video/")) {
    return declared;
  }
  if (isKnownVideoExtension(fileName)) {
    return mimeTypeForKnownVideoExtension(fileName) ?? "video/unknown";
  }
  return null;
}

function isSafeGeneratedVideoPath(storagePath: string, userId: string) {
  return (
    storagePath.startsWith(`documents/${userId}/`) &&
    storagePath.length <= 500 &&
    !storagePath.includes("..") &&
    /^[a-zA-Z0-9/_.,@-]+$/.test(storagePath)
  );
}

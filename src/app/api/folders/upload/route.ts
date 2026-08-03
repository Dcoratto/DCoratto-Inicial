import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { isUploadedFile, processUploadFile, type UploadedFileLike } from "@/lib/media-processing";
import { firstMultipartField, MultipartUploadError, parseMultipartUploadRequest } from "@/lib/multipart-upload";
import { appendSlugSuffix, slugify } from "@/lib/slug";
import {
  DEFAULT_UPLOAD_LIMIT_BYTES,
  DEFAULT_VIDEO_UPLOAD_LIMIT_BYTES,
  ensureKnowledgeBucketUploadConfiguration,
  KNOWLEDGE_BUCKET
} from "@/lib/storage";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const categoryIdSchema = z.string().uuid();
const MAX_FOLDER_UPLOAD_BODY_BYTES = DEFAULT_UPLOAD_LIMIT_BYTES + DEFAULT_VIDEO_UPLOAD_LIMIT_BYTES + 2 * 1024 * 1024;

export async function POST(request: Request) {
  const route = "/api/folders/upload";
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.profile.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Voce nao tem permissao para enviar arquivos.", code: "FORBIDDEN" }, { status: 403 });
  }

  let parsedUpload: Awaited<ReturnType<typeof parseMultipartUploadRequest>>;
  try {
    parsedUpload = await parseMultipartUploadRequest(request, {
      fileFields: ["files", "file"],
      maxBodyBytes: MAX_FOLDER_UPLOAD_BODY_BYTES
    });
  } catch (error) {
    console.error("Falha ao ler FormData do upload de pasta", {
      route,
      errorType: error instanceof Error ? error.name : typeof error,
      code: error instanceof MultipartUploadError ? error.code : "FORMDATA_PARSE_ERROR",
      approximateSize: request.headers.get("content-length")
    });
    const status = error instanceof MultipartUploadError ? error.status : 400;
    const message =
      error instanceof MultipartUploadError
        ? error.message
        : "Nao foi possivel ler os arquivos enviados. Verifique tamanho e formato.";
    return NextResponse.json(
      { ok: false, error: message, code: error instanceof MultipartUploadError ? error.code : "FORMDATA_PARSE_ERROR" },
      { status }
    );
  }

  const categoryId = firstMultipartField(parsedUpload.fields, "categoryId");
  const parsedCategoryId = categoryIdSchema.safeParse(categoryId);
  if (!parsedCategoryId.success) {
    return NextResponse.json({ ok: false, error: "Pasta invalida para upload.", code: "INVALID_FOLDER" }, { status: 400 });
  }

  const files: UploadedFileLike[] = parsedUpload.files.filter(isUploadedFile);

  if (files.length === 0) {
    return NextResponse.json({ ok: false, error: "Nenhum arquivo foi enviado.", code: "MISSING_FILE" }, { status: 400 });
  }

  const service = createServiceRoleClient();
  const { data: category, error: categoryError } = await service
    .from("categories")
    .select("id,name")
    .eq("id", parsedCategoryId.data)
    .is("deleted_at", null)
    .maybeSingle<{ id: string; name: string }>();

  if (categoryError || !category) {
    return NextResponse.json({ ok: false, error: "Pasta nao encontrada.", code: "INVALID_FOLDER" }, { status: 404 });
  }

  try {
    await ensureKnowledgeBucketUploadConfiguration();
  } catch (configurationError) {
    console.error("Falha ao configurar limite do bucket para upload", {
      route,
      code: "STORAGE_LIMIT_CONFIGURATION_FAILED",
      message: configurationError instanceof Error ? configurationError.message : "erro desconhecido"
    });
    return NextResponse.json(
      { ok: false, error: "O Storage nao esta configurado para arquivos de ate 50 MB.", code: "STORAGE_LIMIT_CONFIGURATION_FAILED" },
      { status: 503 }
    );
  }

  const results = [];
  for (const file of files) {
    results.push(await uploadFolderFile(file, parsedCategoryId.data, currentUser.id));
  }

  const failed = results.filter((result) => !result.ok);
  return NextResponse.json(
    {
      ok: failed.length === 0,
      results,
      message: failed.length === 0 ? "Arquivos enviados." : "Alguns arquivos nao puderam ser enviados."
    },
    { status: failed.length === results.length ? 400 : 207 }
  );
}

async function uploadFolderFile(file: UploadedFileLike, categoryId: string, actorId: string) {
  const service = createServiceRoleClient();
  let storagePath: string | null = null;

  try {
    const processedFile = await processUploadFile(file, {
      allowPdf: true,
      allowVideo: true
    });
    const title = titleFromFileName(processedFile.originalName);
    const slug = await getAvailableDocumentSlug(title);
    const today = new Date().toISOString().slice(0, 10);
    storagePath = `documents/${actorId}/${today}/${randomUUID()}${processedFile.extension || safeExtension(file.name)}`;

    const { error: storageError } = await service.storage.from(KNOWLEDGE_BUCKET).upload(storagePath, processedFile.bytes, {
      contentType: processedFile.mimeType,
      upsert: false
    });

    if (storageError) {
      console.error("Falha no Storage para upload de pasta", {
        route: "/api/folders/upload",
        code: "STORAGE_UPLOAD_FAILED",
        statusCode: storageError.statusCode,
        mimeType: processedFile.mimeType,
        sizeBytes: processedFile.sizeBytes
      });
      return fileError(file.name, "Nao foi possivel salvar o arquivo.", "STORAGE_UPLOAD_FAILED");
    }

    const { data: document, error: documentError } = await service
      .from("documents")
      .insert({
        category_id: categoryId,
        title,
        slug,
        summary: `Arquivo enviado: ${processedFile.originalName}`.slice(0, 300),
        content_json: [{ id: randomUUID(), type: "paragraph", text: `Arquivo enviado: ${processedFile.originalName}` }],
        content_text: `${title} ${processedFile.originalName}`,
        status: "published",
        tags: [],
        created_by: actorId,
        updated_by: actorId,
        published_at: new Date().toISOString()
      })
      .select("id,title,slug,summary,category_id,status,updated_at,tags")
      .single();

    if (documentError || !document) {
      await service.storage.from(KNOWLEDGE_BUCKET).remove([storagePath]);
      return fileError(file.name, "Nao foi possivel criar o documento da pasta.", "DOCUMENT_CREATE_FAILED");
    }

    const { data: attachment, error: attachmentError } = await service
      .from("attachments")
      .insert({
        document_id: document.id,
        storage_path: storagePath,
        original_name: processedFile.originalName.slice(0, 180),
        mime_type: processedFile.mimeType,
        size_bytes: processedFile.sizeBytes,
        uploaded_by: actorId
      })
      .select("id")
      .single<{ id: string }>();

    if (attachmentError || !attachment) {
      await service.from("documents").delete().eq("id", document.id);
      await service.storage.from(KNOWLEDGE_BUCKET).remove([storagePath]);
      return fileError(file.name, "Nao foi possivel registrar o arquivo.", "ATTACHMENT_CREATE_FAILED");
    }

    const { data: version, error: versionError } = await service
      .from("document_file_versions")
      .insert({
        document_id: document.id,
        version_number: 1,
        attachment_id: attachment.id,
        storage_path: storagePath,
        original_name: processedFile.originalName.slice(0, 180),
        mime_type: processedFile.mimeType,
        size_bytes: processedFile.sizeBytes,
        is_current: true,
        is_active: true,
        created_by: actorId
      })
      .select("id,document_id,version_number,attachment_id,storage_path,original_name,mime_type,size_bytes,checksum,notes,is_current,is_active,created_by,created_at")
      .single();

    if (versionError || !version) {
      await service.from("attachments").delete().eq("id", attachment.id);
      await service.from("documents").delete().eq("id", document.id);
      await service.storage.from(KNOWLEDGE_BUCKET).remove([storagePath]);
      return fileError(file.name, "Nao foi possivel criar a versao vigente.", "VERSION_CREATE_FAILED");
    }

    await service.rpc("create_document_receipts", {
      p_document_id: document.id,
      p_assigned_by: actorId
    });

    await writeAuditLog({
      actorId,
      action: "document.folder_upload",
      entityType: "document",
      entityId: document.id,
      metadata: {
        title,
        categoryId,
        versionId: version.id,
        mimeType: processedFile.mimeType,
        sizeBytes: processedFile.sizeBytes
      }
    });

    return {
      ok: true,
      fileName: file.name,
      document: {
        ...document,
        current_file_version: version
      },
      warning: processedFile.warning
    };
  } catch (error) {
    if (storagePath) {
      await service.storage.from(KNOWLEDGE_BUCKET).remove([storagePath]);
    }

    const message = error instanceof Error ? error.message : "Arquivo recusado.";
    return fileError(file.name, message, uploadCodeForMessage(message));
  }
}

async function getAvailableDocumentSlug(title: string): Promise<string> {
  const base = slugify(title) || appendSlugSuffix("arquivo");
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
  return (withoutExtension || "Arquivo enviado").slice(0, 140);
}

function safeExtension(name: string) {
  const match = name
    .toLowerCase()
    .match(/\.(pdf|png|jpg|jpeg|webp|mp4|mov|avi|mkv|webm|mpeg|mpg|m4v|3gp|wmv|flv|mts|m2ts|doc|docx|xls|xlsx|ppt|pptx|txt)$/);
  return match ? match[0] : "";
}

function fileError(fileName: string, error: string, code: string) {
  return { ok: false, fileName, error, code };
}

function uploadCodeForMessage(message: string) {
  if (message.includes("muito grande")) {
    return "FILE_TOO_LARGE";
  }
  return "INVALID_FILE_TYPE";
}

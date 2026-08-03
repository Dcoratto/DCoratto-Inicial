import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { isUploadedFile, processUploadFile } from "@/lib/media-processing";
import { ensureKnowledgeBucketUploadConfiguration, KNOWLEDGE_BUCKET } from "@/lib/storage";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const documentIdSchema = z.string().uuid();

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.profile.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Voce nao tem permissao para enviar versoes." }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (error) {
    console.error("Falha ao ler FormData de versao", {
      route: "/api/documents/versions/upload",
      errorType: error instanceof Error ? error.name : typeof error,
      approximateSize: request.headers.get("content-length")
    });
    return NextResponse.json({ ok: false, error: "Nao foi possivel ler o arquivo da versao." }, { status: 400 });
  }

  const documentId = String(formData.get("documentId") ?? "");
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 1000) || null;
  const file = formData.get("file");
  const parsedDocumentId = documentIdSchema.safeParse(documentId);

  if (!parsedDocumentId.success) {
    return NextResponse.json({ ok: false, error: "Documento invalido." }, { status: 400 });
  }

  if (!isUploadedFile(file)) {
    return NextResponse.json({ ok: false, error: "Escolha um arquivo para a nova versao." }, { status: 400 });
  }

  const service = createServiceRoleClient();
  let storagePath: string | null = null;

  try {
    const { data: document } = await service
      .from("documents")
      .select("id,title")
      .eq("id", parsedDocumentId.data)
      .maybeSingle<{ id: string; title: string }>();

    if (!document) {
      return NextResponse.json({ ok: false, error: "Documento nao encontrado." }, { status: 404 });
    }

    const processedFile = await processUploadFile(file, {
      allowPdf: true,
      allowVideo: true
    });

    await ensureKnowledgeBucketUploadConfiguration();

    const [{ data: maxVersionData }, { data: previousCurrent }] = await Promise.all([
      service
        .from("document_file_versions")
        .select("version_number")
        .eq("document_id", document.id)
        .order("version_number", { ascending: false })
        .limit(1),
      service
        .from("document_file_versions")
        .select("id")
        .eq("document_id", document.id)
        .eq("is_current", true)
        .eq("is_active", true)
        .maybeSingle<{ id: string }>()
    ]);

    const nextVersion = (((maxVersionData as Array<{ version_number: number }> | null) ?? [])[0]?.version_number ?? 0) + 1;
    const today = new Date().toISOString().slice(0, 10);
    storagePath = `documents/${currentUser.id}/${today}/${randomUUID()}${processedFile.extension || safeExtension(file.name)}`;

    const { error: storageError } = await service.storage.from(KNOWLEDGE_BUCKET).upload(storagePath, processedFile.bytes, {
      contentType: processedFile.mimeType,
      upsert: false
    });

    if (storageError) {
      return NextResponse.json({ ok: false, error: "Nao foi possivel salvar o arquivo da versao." }, { status: 500 });
    }

    const { data: attachment, error: attachmentError } = await service
      .from("attachments")
      .insert({
        document_id: document.id,
        storage_path: storagePath,
        original_name: processedFile.originalName.slice(0, 180),
        mime_type: processedFile.mimeType,
        size_bytes: processedFile.sizeBytes,
        uploaded_by: currentUser.id
      })
      .select("id")
      .single<{ id: string }>();

    if (attachmentError || !attachment) {
      await service.storage.from(KNOWLEDGE_BUCKET).remove([storagePath]);
      return NextResponse.json({ ok: false, error: "Nao foi possivel registrar o anexo da versao." }, { status: 500 });
    }

    await service
      .from("document_file_versions")
      .update({ is_current: false })
      .eq("document_id", document.id);

    const { data: version, error: versionError } = await service
      .from("document_file_versions")
      .insert({
        document_id: document.id,
        version_number: nextVersion,
        attachment_id: attachment.id,
        storage_path: storagePath,
        original_name: processedFile.originalName.slice(0, 180),
        mime_type: processedFile.mimeType,
        size_bytes: processedFile.sizeBytes,
        notes,
        is_current: true,
        is_active: true,
        created_by: currentUser.id
      })
      .select("id,document_id,version_number,attachment_id,storage_path,original_name,mime_type,size_bytes,checksum,notes,is_current,is_active,created_by,created_at")
      .single();

    if (versionError || !version) {
      if (previousCurrent) {
        await service.from("document_file_versions").update({ is_current: true }).eq("id", previousCurrent.id);
      }
      await service.from("attachments").delete().eq("id", attachment.id);
      await service.storage.from(KNOWLEDGE_BUCKET).remove([storagePath]);
      return NextResponse.json({ ok: false, error: "Nao foi possivel criar a nova versao." }, { status: 500 });
    }

    await service.from("documents").update({ updated_by: currentUser.id }).eq("id", document.id);

    await writeAuditLog({
      actorId: currentUser.id,
      action: "document.version_upload",
      entityType: "document_file_version",
      entityId: version.id,
      metadata: {
        documentId: document.id,
        title: document.title,
        versionNumber: nextVersion,
        mimeType: processedFile.mimeType,
        sizeBytes: processedFile.sizeBytes
      }
    });

    return NextResponse.json({ ok: true, version, message: processedFile.warning ?? "Nova versao enviada." });
  } catch (error) {
    if (storagePath) {
      await service.storage.from(KNOWLEDGE_BUCKET).remove([storagePath]);
    }

    const message = error instanceof Error ? error.message : "Nao foi possivel enviar a versao.";
    return NextResponse.json({ ok: false, error: message }, { status: message.includes("muito grande") ? 400 : 500 });
  }
}

function safeExtension(name: string) {
  const match = name
    .toLowerCase()
    .match(/\.(pdf|png|jpg|jpeg|webp|mp4|mov|avi|mkv|webm|mpeg|mpg|m4v|3gp|wmv|flv|mts|m2ts|doc|docx|xls|xlsx|ppt|pptx|txt)$/);
  return match ? match[0] : "";
}

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
  const route = "/api/attachments/upload";
  const approximateSize = request.headers.get("content-length");

  try {
    const currentUser = await getCurrentUser();
    if (!currentUser || currentUser.profile.role !== "admin") {
      return uploadError("Voce nao tem permissao para anexar arquivos neste documento.", 403, "FORBIDDEN");
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (error) {
      safeUploadLog("Falha ao ler FormData do anexo", {
        route,
        code: "FORMDATA_PARSE_ERROR",
        errorType: error instanceof Error ? error.name : typeof error,
        approximateSize
      });
      return uploadError(
        "Nao foi possivel ler o arquivo enviado. Tente reenviar o arquivo ou escolha outro arquivo.",
        400,
        "FORMDATA_PARSE_ERROR"
      );
    }

    const file = formData.get("file");
    const documentId = String(formData.get("documentId") ?? "");
    const parsedDocumentId = documentIdSchema.safeParse(documentId);

    if (!isUploadedFile(file)) {
      return uploadError("Nenhum arquivo foi enviado.", 400, "MISSING_FILE");
    }

    if (!parsedDocumentId.success) {
      return uploadError("Documento invalido para anexar o arquivo.", 400, "INVALID_DOCUMENT");
    }

    const processedFile = await processUploadFile(file, {
      allowPdf: true,
      allowVideo: true
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Arquivo recusado. Envie PDF, imagem, documento ou video valido.";
      throw new UploadValidationError(message, uploadCodeForMessage(message));
    });

    const service = createServiceRoleClient();
    const { data: document, error: documentError } = await service
      .from("documents")
      .select("id")
      .eq("id", parsedDocumentId.data)
      .maybeSingle();

    if (documentError) {
      safeUploadLog("Falha ao consultar documento para upload", {
        route,
        code: "INVALID_DOCUMENT",
        documentId: parsedDocumentId.data,
        userId: currentUser.id,
        errorCode: documentError.code
      });
      return uploadError("Nao foi possivel validar o documento.", 500, "INVALID_DOCUMENT");
    }

    if (!document) {
      return uploadError("Documento invalido para anexar o arquivo.", 404, "INVALID_DOCUMENT");
    }

    await ensureKnowledgeBucketUploadConfiguration();

    const extension = safeExtension(file.name);
    const today = new Date().toISOString().slice(0, 10);
    const storagePath = `attachments/${currentUser.id}/${today}/${randomUUID()}${processedFile.extension || extension}`;
    const { error: storageError } = await service.storage.from(KNOWLEDGE_BUCKET).upload(storagePath, processedFile.bytes, {
      contentType: processedFile.mimeType,
      upsert: false
    });

    if (storageError) {
      safeUploadLog("Falha no Supabase Storage", {
        route,
        code: "STORAGE_UPLOAD_FAILED",
        statusCode: storageError.statusCode,
        message: storageError.message,
        mimeType: processedFile.mimeType,
        sizeBytes: processedFile.sizeBytes,
        documentId: parsedDocumentId.data,
        userId: currentUser.id
      });
      return uploadError("Nao foi possivel salvar o arquivo. Tente novamente.", 500, "STORAGE_UPLOAD_FAILED");
    }

    const { data: attachment, error: attachmentError } = await service
      .from("attachments")
      .insert({
        document_id: parsedDocumentId.data,
        storage_path: storagePath,
        original_name: processedFile.originalName.slice(0, 180),
        mime_type: processedFile.mimeType,
        size_bytes: processedFile.sizeBytes,
        uploaded_by: currentUser.id
      })
      .select("id")
      .single();

    if (attachmentError) {
      await service.storage.from(KNOWLEDGE_BUCKET).remove([storagePath]);
      safeUploadLog("Falha ao registrar anexo", {
        route,
        code: "STORAGE_UPLOAD_FAILED",
        errorCode: attachmentError.code,
        mimeType: processedFile.mimeType,
        sizeBytes: processedFile.sizeBytes,
        documentId: parsedDocumentId.data,
        userId: currentUser.id
      });
      return uploadError("Nao foi possivel salvar o arquivo. Tente novamente.", 500, "STORAGE_UPLOAD_FAILED");
    }

    const attachmentId = (attachment as { id: string }).id;
    await writeAuditLog({
      actorId: currentUser.id,
      action: "attachment.upload",
      entityType: "attachment",
      entityId: attachmentId,
      metadata: {
        documentId: parsedDocumentId.data,
        mimeType: processedFile.mimeType,
        sizeBytes: processedFile.sizeBytes,
        convertedToWebp: processedFile.convertedToWebp
      }
    });

    return NextResponse.json({
      ok: true,
      attachmentId,
      message: processedFile.warning ?? "Arquivo enviado com sucesso."
    });
  } catch (error) {
    if (error instanceof UploadValidationError) {
      return uploadError(error.message, 400, error.code);
    }

    safeUploadLog("Erro inesperado no upload de anexo", {
      route,
      code: "STORAGE_UPLOAD_FAILED",
      errorType: error instanceof Error ? error.name : typeof error,
      approximateSize,
      message: error instanceof Error ? error.message : "erro desconhecido"
    });
    return uploadError("Nao foi possivel salvar o arquivo. Tente novamente.", 500, "STORAGE_UPLOAD_FAILED");
  }
}

function safeExtension(name: string) {
  const match = name
    .toLowerCase()
    .match(/\.(pdf|png|jpg|jpeg|webp|mp4|mov|avi|mkv|webm|mpeg|mpg|m4v|3gp|wmv|flv|mts|m2ts|doc|docx|xls|xlsx|ppt|pptx|txt)$/);
  return match ? match[0] : "";
}

function uploadError(error: string, status: number, code: UploadErrorCode) {
  return NextResponse.json({ ok: false, error, code }, { status });
}

function uploadCodeForMessage(message: string): UploadErrorCode {
  if (message.includes("muito grande")) {
    return "FILE_TOO_LARGE";
  }

  return "INVALID_FILE_TYPE";
}

function safeUploadLog(message: string, metadata: Record<string, unknown>) {
  console.error(message, metadata);
}

type UploadErrorCode =
  | "FILE_TOO_LARGE"
  | "INVALID_FILE_TYPE"
  | "FORMDATA_PARSE_ERROR"
  | "MISSING_FILE"
  | "INVALID_DOCUMENT"
  | "STORAGE_UPLOAD_FAILED"
  | "FORBIDDEN";

class UploadValidationError extends Error {
  constructor(
    message: string,
    public code: UploadErrorCode
  ) {
    super(message);
  }
}

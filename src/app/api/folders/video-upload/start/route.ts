import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import {
  DEFAULT_VIDEO_UPLOAD_LIMIT_BYTES,
  ensureKnowledgeBucketUploadConfiguration,
  isKnownVideoExtension,
  KNOWLEDGE_BUCKET,
  mimeTypeForKnownVideoExtension
} from "@/lib/storage";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const startSchema = z.object({
  categoryId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(180),
  mimeType: z.string().trim().max(120).optional().or(z.literal("")),
  sizeBytes: z.coerce.number().int().positive().max(DEFAULT_VIDEO_UPLOAD_LIMIT_BYTES)
});

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.profile.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Voce nao tem permissao para enviar videos.", code: "FORBIDDEN" }, { status: 403 });
  }

  const json = await request.json().catch(() => null);
  const parsed = startSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Dados invalidos para enviar o video.", code: "INVALID_PAYLOAD" }, { status: 400 });
  }

  const mimeType = normalizedVideoMime(parsed.data.fileName, parsed.data.mimeType ?? "");
  if (!mimeType) {
    return NextResponse.json({ ok: false, error: "Arquivo recusado. Envie um video valido.", code: "INVALID_VIDEO_TYPE" }, { status: 400 });
  }

  const service = createServiceRoleClient();
  const { data: category, error: categoryError } = await service
    .from("categories")
    .select("id")
    .eq("id", parsed.data.categoryId)
    .is("deleted_at", null)
    .maybeSingle<{ id: string }>();

  if (categoryError || !category) {
    return NextResponse.json({ ok: false, error: "Pasta nao encontrada.", code: "INVALID_FOLDER" }, { status: 404 });
  }

  try {
    await ensureKnowledgeBucketUploadConfiguration();
  } catch (configurationError) {
    console.error("Falha ao configurar limite do bucket para upload", {
      route: "/api/folders/video-upload/start",
      code: "STORAGE_LIMIT_CONFIGURATION_FAILED",
      message: configurationError instanceof Error ? configurationError.message : "erro desconhecido"
    });
    return NextResponse.json(
      {
        ok: false,
        error: "O Storage nao esta configurado para arquivos de ate 50 MB.",
        code: "STORAGE_LIMIT_CONFIGURATION_FAILED"
      },
      { status: 503 }
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const storagePath = `documents/${currentUser.id}/${today}/${randomUUID()}${safeVideoExtension(parsed.data.fileName)}`;
  const { data, error } = await service.storage.from(KNOWLEDGE_BUCKET).createSignedUploadUrl(storagePath);

  if (error || !data?.token) {
    console.error("Falha ao criar URL assinada para video", {
      route: "/api/folders/video-upload/start",
      code: "SIGNED_UPLOAD_URL_FAILED",
      statusCode: error?.statusCode,
      mimeType,
      sizeBytes: parsed.data.sizeBytes
    });
    return NextResponse.json({ ok: false, error: "Nao foi possivel preparar o envio do video.", code: "SIGNED_UPLOAD_URL_FAILED" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    bucket: KNOWLEDGE_BUCKET,
    storagePath,
    token: data.token,
    mimeType,
    maxBytes: DEFAULT_VIDEO_UPLOAD_LIMIT_BYTES
  });
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

function safeVideoExtension(fileName: string) {
  return fileName.toLowerCase().match(/\.(mp4|mov|avi|mkv|webm|mpeg|mpg|m4v|3gp|wmv|flv|mts|m2ts)$/)?.[0] ?? "";
}

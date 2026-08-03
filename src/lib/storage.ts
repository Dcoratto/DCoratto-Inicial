import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/server";

export const KNOWLEDGE_BUCKET = "knowledge-assets";
const BYTES_PER_MB = 1024 * 1024;

export const KNOWLEDGE_BUCKET_UPLOAD_LIMIT_BYTES = 50 * BYTES_PER_MB;
export const DEFAULT_UPLOAD_LIMIT_BYTES = KNOWLEDGE_BUCKET_UPLOAD_LIMIT_BYTES;
export const DEFAULT_VIDEO_UPLOAD_LIMIT_BYTES = KNOWLEDGE_BUCKET_UPLOAD_LIMIT_BYTES;

let knowledgeBucketConfigurationPromise: Promise<void> | null = null;

const ALLOWED_EXACT_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain"
]);

export function isAllowedMimeType(mimeType: string): boolean {
  return ALLOWED_EXACT_MIME_TYPES.has(mimeType) || mimeType.startsWith("video/");
}

export function isKnownVideoExtension(fileName: string): boolean {
  return /\.(mp4|mov|avi|mkv|webm|mpeg|mpg|m4v|3gp|wmv|flv|mts|m2ts)$/i.test(fileName);
}

export function mimeTypeForKnownVideoExtension(fileName: string): string | null {
  const extension = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  const types: Record<string, string> = {
    "3gp": "video/3gpp",
    avi: "video/x-msvideo",
    flv: "video/x-flv",
    m2ts: "video/mp2t",
    m4v: "video/x-m4v",
    mkv: "video/x-matroska",
    mov: "video/quicktime",
    mp4: "video/mp4",
    mpeg: "video/mpeg",
    mpg: "video/mpeg",
    mts: "video/mp2t",
    webm: "video/webm",
    wmv: "video/x-ms-wmv"
  };

  return types[extension] ?? null;
}

export function isAllowedMagicBytes(mimeType: string, bytes: Uint8Array): boolean {
  if (mimeType === "application/pdf") {
    return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  }
  if (mimeType === "image/png") {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  if (mimeType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/webp") {
    return (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  }
  if (mimeType.startsWith("video/")) {
    if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
      return true; // WebM/Matroska
    }
    if (bytes[0] === 0x30 && bytes[1] === 0x26 && bytes[2] === 0xb2 && bytes[3] === 0x75) {
      return true; // ASF/WMV
    }
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      return true; // AVI and other RIFF-based video containers
    }
    if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && (bytes[3] === 0xba || bytes[3] === 0xb3)) {
      return true; // MPEG program/elementary streams
    }
    return bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return bytes[0] === 0x50 && bytes[1] === 0x4b;
  }
  if (
    mimeType === "application/msword" ||
    mimeType === "application/vnd.ms-excel" ||
    mimeType === "application/vnd.ms-powerpoint"
  ) {
    return (
      bytes[0] === 0xd0 &&
      bytes[1] === 0xcf &&
      bytes[2] === 0x11 &&
      bytes[3] === 0xe0 &&
      bytes[4] === 0xa1 &&
      bytes[5] === 0xb1 &&
      bytes[6] === 0x1a &&
      bytes[7] === 0xe1
    );
  }
  if (mimeType === "text/plain") {
    return !bytes.slice(0, 16).some((byte) => byte === 0);
  }
  return false;
}

export async function ensureKnowledgeBucketUploadConfiguration(): Promise<void> {
  if (!knowledgeBucketConfigurationPromise) {
    knowledgeBucketConfigurationPromise = configureKnowledgeBucketUploadLimit();
  }

  try {
    await knowledgeBucketConfigurationPromise;
  } catch (error) {
    knowledgeBucketConfigurationPromise = null;
    throw error;
  }
}

async function configureKnowledgeBucketUploadLimit(): Promise<void> {
  const service = createServiceRoleClient();
  const { error } = await service.storage.updateBucket(KNOWLEDGE_BUCKET, {
    public: false,
    fileSizeLimit: KNOWLEDGE_BUCKET_UPLOAD_LIMIT_BYTES
  });

  if (error) {
    throw new Error(`Nao foi possivel configurar o limite de upload do Storage: ${error.message}`);
  }
}

export async function createSignedUrl(storagePath: string): Promise<string | null> {
  const service = createServiceRoleClient();
  const { data, error } = await service.storage
    .from(KNOWLEDGE_BUCKET)
    .createSignedUrl(storagePath, 60 * 10);

  if (error) {
    return null;
  }

  return data.signedUrl;
}

export async function createSignedUrlMap(storagePaths: string[], expiresInSeconds = 60 * 10): Promise<Map<string, string>> {
  const uniquePaths = Array.from(new Set(storagePaths.filter(Boolean)));
  if (uniquePaths.length === 0) {
    return new Map();
  }

  const service = createServiceRoleClient();
  const { data, error } = await service.storage
    .from(KNOWLEDGE_BUCKET)
    .createSignedUrls(uniquePaths, expiresInSeconds);

  if (error) {
    return new Map();
  }

  return (data ?? []).reduce((urls, item) => {
    if (item.path && item.signedUrl) {
      urls.set(item.path, item.signedUrl);
    }
    return urls;
  }, new Map<string, string>());
}

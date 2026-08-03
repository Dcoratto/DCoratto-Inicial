import "server-only";

import sharp from "sharp";
import {
  DEFAULT_UPLOAD_LIMIT_BYTES,
  DEFAULT_VIDEO_UPLOAD_LIMIT_BYTES,
  isAllowedMagicBytes,
  isAllowedMimeType,
  isKnownVideoExtension,
  mimeTypeForKnownVideoExtension
} from "@/lib/storage";

export type UploadedFileLike = {
  name: string;
  type: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export type ProcessedUpload = {
  bytes: Buffer;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  extension: string;
  convertedToWebp: boolean;
  width: number | null;
  height: number | null;
  warning: string | null;
};

const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function processUploadFile(
  file: UploadedFileLike,
  options?: {
    allowPdf?: boolean;
    allowVideo?: boolean;
    imageAspect?: {
      target: number;
      tolerance: number;
      message: string;
    };
  }
): Promise<ProcessedUpload> {
  const normalizedMimeType = normalizeUploadMimeType(file);
  const isVideo = normalizedMimeType.startsWith("video/");
  const limitBytes = isVideo ? DEFAULT_VIDEO_UPLOAD_LIMIT_BYTES : DEFAULT_UPLOAD_LIMIT_BYTES;

  if (file.size > limitBytes) {
    throw new Error(`Arquivo muito grande. Envie um arquivo de ate ${Math.round(limitBytes / 1024 / 1024)} MB.`);
  }

  if (!isAllowedMimeType(normalizedMimeType)) {
    throw new Error("Arquivo recusado. Envie PDF, imagem, documento ou video valido.");
  }

  if (normalizedMimeType === "application/pdf" && options?.allowPdf === false) {
    throw new Error("PDF nao permitido neste envio.");
  }

  if (isVideo && options?.allowVideo === false) {
    throw new Error("Video nao permitido neste envio.");
  }

  const inputBytes = new Uint8Array(await file.arrayBuffer());
  const magicLooksValid = isAllowedMagicBytes(normalizedMimeType, inputBytes.slice(0, 16));
  if (!magicLooksValid && !(isVideo && isKnownVideoExtension(file.name))) {
    throw new Error("Arquivo recusado. Envie PDF, imagem, documento ou video valido.");
  }

  if (IMAGE_MIME_TYPES.has(normalizedMimeType)) {
    const imageMetadata = await sharp(Buffer.from(inputBytes), { failOn: "none" }).metadata();
    const dimensions = normalizedImageDimensions(imageMetadata.width, imageMetadata.height, imageMetadata.orientation);

    if (!dimensions.width || !dimensions.height) {
      throw new Error("Nao foi possivel ler as dimensoes da imagem.");
    }

    if (options?.imageAspect) {
      const ratio = dimensions.width / dimensions.height;
      const delta = Math.abs(ratio - options.imageAspect.target) / options.imageAspect.target;

      if (delta > options.imageAspect.tolerance) {
        throw new Error(options.imageAspect.message);
      }
    }

    const buffer = await sharp(Buffer.from(inputBytes), { failOn: "none" })
      .rotate()
      .resize({
        width: 1920,
        height: 1920,
        fit: "inside",
        withoutEnlargement: true
      })
      .webp({ quality: 78, effort: 4 })
      .toBuffer();

    return {
      bytes: buffer,
      originalName: file.name,
      mimeType: "image/webp",
      sizeBytes: buffer.byteLength,
      extension: ".webp",
      convertedToWebp: true,
      width: dimensions.width,
      height: dimensions.height,
      warning: null
    };
  }

  if (isVideo) {
    return {
      bytes: Buffer.from(inputBytes),
      originalName: file.name,
      mimeType: normalizedMimeType,
      sizeBytes: file.size,
      extension: safeExtension(file.name),
      convertedToWebp: false,
      width: null,
      height: null,
      warning: "Video enviado com sucesso. Se o navegador nao reproduzir este formato, ele ficara disponivel para download."
    };
  }

  return {
    bytes: Buffer.from(inputBytes),
    originalName: file.name,
    mimeType: normalizedMimeType,
    sizeBytes: file.size,
    extension: safeExtension(file.name),
    convertedToWebp: false,
    width: null,
    height: null,
    warning: null
  };
}

export function isUploadedFile(value: unknown): value is UploadedFileLike {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<UploadedFileLike>;
  return (
    typeof candidate.name === "string" &&
    typeof candidate.type === "string" &&
    typeof candidate.size === "number" &&
    typeof candidate.arrayBuffer === "function"
  );
}

function safeExtension(name: string) {
  const match = name
    .toLowerCase()
    .match(/\.(pdf|png|jpg|jpeg|webp|mp4|mov|avi|mkv|webm|mpeg|mpg|m4v|3gp|wmv|flv|mts|m2ts|doc|docx|xls|xlsx|ppt|pptx|txt)$/);
  return match ? match[0] : "";
}

function normalizeUploadMimeType(file: UploadedFileLike) {
  const declared = file.type.trim().toLowerCase();

  if (declared.startsWith("video/")) {
    return declared;
  }

  if ((declared === "" || declared === "application/octet-stream") && isKnownVideoExtension(file.name)) {
    return mimeTypeForKnownVideoExtension(file.name) ?? "video/unknown";
  }

  return declared;
}

function normalizedImageDimensions(width: number | undefined, height: number | undefined, orientation: number | undefined) {
  if (!width || !height) {
    return { width: null, height: null };
  }

  if (orientation && orientation >= 5 && orientation <= 8) {
    return { width: height, height: width };
  }

  return { width, height };
}

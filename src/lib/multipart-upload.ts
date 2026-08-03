import "server-only";

import type { UploadedFileLike } from "@/lib/media-processing";

export type ParsedMultipartUpload = {
  fields: Map<string, string[]>;
  files: UploadedFileLike[];
};

export class MultipartUploadError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 400
  ) {
    super(message);
  }
}

export async function parseMultipartUploadRequest(
  request: Request,
  options: {
    fileFields: string[];
    maxBodyBytes: number;
  }
): Promise<ParsedMultipartUpload> {
  const contentType = request.headers.get("content-type") ?? "";
  const boundary = parseBoundary(contentType);
  if (!boundary) {
    throw new MultipartUploadError("Envio invalido. Selecione o arquivo novamente.", "MISSING_MULTIPART_BOUNDARY");
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > options.maxBodyBytes) {
    throw new MultipartUploadError(
      `Arquivo muito grande. Envie arquivos com ate ${Math.round(options.maxBodyBytes / 1024 / 1024)} MB por envio.`,
      "REQUEST_TOO_LARGE",
      413
    );
  }

  let body: Buffer;
  try {
    body = Buffer.from(await request.arrayBuffer());
  } catch {
    throw new MultipartUploadError("Nao foi possivel ler os arquivos enviados. Tente reenviar ou escolha outro arquivo.", "BODY_READ_FAILED");
  }

  if (body.byteLength > options.maxBodyBytes) {
    throw new MultipartUploadError(
      `Arquivo muito grande. Envie arquivos com ate ${Math.round(options.maxBodyBytes / 1024 / 1024)} MB por envio.`,
      "REQUEST_TOO_LARGE",
      413
    );
  }

  const fields = new Map<string, string[]>();
  const files: UploadedFileLike[] = [];
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const headerSeparator = Buffer.from("\r\n\r\n");
  let cursor = body.indexOf(boundaryBuffer);

  if (cursor === -1) {
    throw new MultipartUploadError("Nao foi possivel identificar os arquivos enviados.", "INVALID_MULTIPART_BODY");
  }

  while (cursor !== -1) {
    const next = body.indexOf(boundaryBuffer, cursor + boundaryBuffer.length);
    if (next === -1) {
      break;
    }

    let part = body.subarray(cursor + boundaryBuffer.length, next);
    if (part[0] === 0x2d && part[1] === 0x2d) {
      break;
    }
    if (part[0] === 0x0d && part[1] === 0x0a) {
      part = part.subarray(2);
    }
    if (part.at(-2) === 0x0d && part.at(-1) === 0x0a) {
      part = part.subarray(0, -2);
    }

    const headerEnd = part.indexOf(headerSeparator);
    if (headerEnd > -1) {
      const headerText = part.subarray(0, headerEnd).toString("utf8");
      const content = part.subarray(headerEnd + headerSeparator.length);
      const disposition = headerText
        .split(/\r\n/)
        .find((line) => line.toLowerCase().startsWith("content-disposition:"));
      const name = disposition ? parseDispositionValue(disposition, "name") : null;
      const filename = disposition ? parseDispositionValue(disposition, "filename") ?? parseDispositionValue(disposition, "filename*") : null;
      const mimeType =
        headerText
          .split(/\r\n/)
          .find((line) => line.toLowerCase().startsWith("content-type:"))
          ?.split(":")
          .slice(1)
          .join(":")
          .trim() || "application/octet-stream";

      if (name && filename && options.fileFields.includes(name)) {
        const bytes = Buffer.from(content);
        if (bytes.byteLength > 0) {
          files.push(bufferToUploadedFile(filename, mimeType, bytes));
        }
      } else if (name) {
        fields.set(name, [...(fields.get(name) ?? []), content.toString("utf8")]);
      }
    }

    cursor = next;
  }

  return { fields, files };
}

export function firstMultipartField(fields: Map<string, string[]>, name: string) {
  return fields.get(name)?.[0] ?? "";
}

function parseBoundary(contentType: string) {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  return (match?.[1] ?? match?.[2] ?? "").trim();
}

function parseDispositionValue(disposition: string, key: string) {
  const starKey = `${key}=`;
  if (key.endsWith("*")) {
    const starMatch = disposition.match(new RegExp(`${key.replace("*", "\\*")}=(?:"([^"]+)"|([^;]+))`, "i"));
    const encoded = starMatch?.[1] ?? starMatch?.[2];
    if (encoded?.startsWith("UTF-8''")) {
      return decodeURIComponent(encoded.slice(7));
    }
    return encoded?.trim() ?? "";
  }

  const match = disposition.match(new RegExp(`${starKey}(?:"([^"]*)"|([^;]+))`, "i"));
  return (match?.[1] ?? match?.[2] ?? "").trim();
}

function bufferToUploadedFile(name: string, type: string, bytes: Buffer): UploadedFileLike {
  return {
    name,
    type,
    size: bytes.byteLength,
    arrayBuffer: async () => {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return copy.buffer;
    }
  };
}

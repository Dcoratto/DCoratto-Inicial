import "server-only";

import { createHash, randomBytes } from "node:crypto";

export type ShareResourceType = "category" | "document" | "folder_link";

export function createShareToken() {
  return randomBytes(32).toString("base64url");
}

export function hashShareToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenHint(token: string) {
  return token.slice(-6);
}

export function isSafeShareToken(token: string) {
  return /^[a-zA-Z0-9_-]{32,120}$/.test(token);
}

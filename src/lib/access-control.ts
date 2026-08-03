import type { DocumentStatus, Profile } from "@/types/app";

export function canAccessAdmin(profile: Pick<Profile, "role" | "is_active">): boolean {
  return profile.is_active && profile.role === "admin";
}

export function canReadDocumentStatus(
  profile: Pick<Profile, "role" | "is_active">,
  status: DocumentStatus
): boolean {
  if (!profile.is_active) {
    return false;
  }

  return profile.role === "admin" || status === "published";
}

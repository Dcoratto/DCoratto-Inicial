export type ShareLinkDatabaseError = {
  code?: string | null;
  message?: string | null;
};

export type ShareLinkDatabaseErrorKind = "schema_missing" | "database_error";

export function classifyShareLinkDatabaseError(
  error: ShareLinkDatabaseError | null | undefined
): ShareLinkDatabaseErrorKind {
  if (
    error?.code === "PGRST205" ||
    error?.code === "42P01" ||
    error?.message?.includes("public.shared_links")
  ) {
    return "schema_missing";
  }

  return "database_error";
}

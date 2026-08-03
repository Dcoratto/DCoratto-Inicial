const LOCAL_AUTH_DOMAIN = "decorato.local";

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function technicalEmailForUsername(username: string): string {
  return `${normalizeUsername(username)}@${LOCAL_AUTH_DOMAIN}`;
}

export function loginLooksLikeEmail(login: string): boolean {
  return login.includes("@");
}

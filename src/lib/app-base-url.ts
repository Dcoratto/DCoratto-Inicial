type AppBaseUrlOptions = {
  appBaseUrl?: string;
  railwayPublicDomain?: string;
  isProduction: boolean;
};

export function resolveAppBaseUrl(options: AppBaseUrlOptions): string {
  const configuredUrl = parseHttpUrl(options.appBaseUrl);
  if (configuredUrl && (!options.isProduction || !isLocalHostname(configuredUrl.hostname))) {
    return configuredUrl.origin;
  }

  const railwayUrl = parseRailwayUrl(options.railwayPublicDomain);
  if (railwayUrl) {
    return railwayUrl.origin;
  }

  if (!options.isProduction) {
    return configuredUrl?.origin ?? "http://localhost:3000";
  }

  throw new Error("APP_BASE_URL publica nao configurada");
}

function parseRailwayUrl(value?: string): URL | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  return parseHttpUrl(normalized.includes("://") ? normalized : `https://${normalized}`);
}

function parseHttpUrl(value?: string): URL | null {
  const normalized = value?.trim();
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "127.0.0.1" ||
    normalized === "0.0.0.0" ||
    normalized === "::1"
  );
}

import "server-only";

type Entry = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Entry>();

export async function enforceRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<void> {
  const now = Date.now();
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  if (current.count >= limit) {
    throw new Error("Muitas tentativas. Aguarde alguns instantes e tente novamente.");
  }

  current.count += 1;
}

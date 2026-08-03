export function slugify(input: string): string {
  const base = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);

  return base || "item";
}

export function appendSlugSuffix(base: string): string {
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

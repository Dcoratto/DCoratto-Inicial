import type { ContentBlock } from "@/types/app";

export function contentBlocksToText(blocks: ContentBlock[]): string {
  return blocks
    .flatMap((block) => {
      if (block.type === "paragraph" || block.type === "heading") return [block.text];
      if (block.type === "list") return block.items;
      if (block.type === "checklist") return block.items.map((item) => item.text);
      if (block.type === "table") return block.rows.flat();
      if (block.type === "link") return [block.label, block.url];
      return [];
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseContentBlocks(value: string): ContentBlock[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter(isContentBlock);
}

export function isSafeLink(url: string): boolean {
  if (url.startsWith("/") && !url.startsWith("//")) {
    return true;
  }

  try {
    const parsed = new URL(url);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function isContentBlock(block: unknown): block is ContentBlock {
  if (!block || typeof block !== "object") return false;
  const candidate = block as Record<string, unknown>;
  if (typeof candidate.id !== "string" || typeof candidate.type !== "string") return false;

  switch (candidate.type) {
    case "paragraph":
    case "heading":
      return typeof candidate.text === "string";
    case "list":
      return Array.isArray(candidate.items) && candidate.items.every((item) => typeof item === "string");
    case "checklist":
      return (
        Array.isArray(candidate.items) &&
        candidate.items.every((item) => {
          if (!item || typeof item !== "object") return false;
          const check = item as Record<string, unknown>;
          return typeof check.text === "string" && typeof check.checked === "boolean";
        })
      );
    case "table":
      return (
        Array.isArray(candidate.rows) &&
        candidate.rows.every(
          (row) => Array.isArray(row) && row.every((cell) => typeof cell === "string")
        )
      );
    case "link":
      return typeof candidate.label === "string" && typeof candidate.url === "string";
    default:
      return false;
  }
}

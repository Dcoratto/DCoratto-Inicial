import { CheckSquare, LinkIcon } from "lucide-react";
import { isSafeLink } from "@/lib/content";
import type { ContentBlock } from "@/types/app";

export function DocumentReader({ blocks }: { blocks: ContentBlock[] }) {
  if (blocks.length === 0) {
    return <p className="text-decorato-muted">Este documento ainda nao possui conteudo publicado.</p>;
  }

  return (
    <div className="space-y-6 text-[17px] leading-8 text-decorato-ink">
      {blocks.map((block) => {
        if (block.type === "heading") {
          return (
            <h2 key={block.id} className="pt-4 text-2xl font-semibold leading-tight">
              {block.text}
            </h2>
          );
        }

        if (block.type === "paragraph") {
          return <p key={block.id}>{block.text}</p>;
        }

        if (block.type === "list") {
          return (
            <ul key={block.id} className="list-disc space-y-2 pl-6">
              {block.items.map((item, index) => (
                <li key={`${block.id}-${index}`}>{item}</li>
              ))}
            </ul>
          );
        }

        if (block.type === "checklist") {
          return (
            <ul key={block.id} className="space-y-2">
              {block.items.map((item, index) => (
                <li key={`${block.id}-${index}`} className="flex gap-3">
                  <CheckSquare aria-hidden="true" className="mt-1 shrink-0 text-decorato-leaf" size={18} />
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === "table") {
          return (
            <div key={block.id} className="overflow-x-auto rounded-lg border border-decorato-line">
              <table className="min-w-full divide-y divide-decorato-line text-sm">
                <tbody className="divide-y divide-decorato-line bg-white">
                  {block.rows.map((row, rowIndex) => (
                    <tr key={`${block.id}-${rowIndex}`}>
                      {row.map((cell, cellIndex) => (
                        <td key={`${block.id}-${rowIndex}-${cellIndex}`} className="px-4 py-3">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (block.type === "link") {
          const safe = isSafeLink(block.url);
          return safe ? (
            <a
              key={block.id}
              href={block.url}
              className="inline-flex items-center gap-2 rounded-md bg-decorato-teal/10 px-3 py-2 text-sm text-decorato-teal"
              rel="noreferrer"
              target={block.url.startsWith("/") ? undefined : "_blank"}
            >
              <LinkIcon aria-hidden="true" size={16} />
              {block.label}
            </a>
          ) : null;
        }

        return null;
      })}
    </div>
  );
}

"use client";

import { CheckSquare, Heading2, LinkIcon, List, Table, Text } from "lucide-react";
import { useMemo, useState } from "react";
import type { ContentBlock } from "@/types/app";

export function BlockEditor({ initialBlocks }: { initialBlocks?: ContentBlock[] }) {
  const [blocks, setBlocks] = useState<ContentBlock[]>(
    initialBlocks && initialBlocks.length > 0
      ? initialBlocks
      : [{ id: createId(), type: "paragraph", text: "" }]
  );

  const serialized = useMemo(() => JSON.stringify(blocks), [blocks]);

  function updateBlock(id: string, next: ContentBlock) {
    setBlocks((current) => current.map((block) => (block.id === id ? next : block)));
  }

  function removeBlock(id: string) {
    setBlocks((current) => current.filter((block) => block.id !== id));
  }

  function addBlock(type: ContentBlock["type"]) {
    setBlocks((current) => [...current, createBlock(type)]);
  }

  return (
    <div className="space-y-4">
      <input type="hidden" name="content_json" value={serialized} />

      <div className="flex flex-wrap gap-2 rounded-lg border border-decorato-line bg-white p-2">
        <EditorTool icon={<Text size={16} />} label="Texto" onClick={() => addBlock("paragraph")} />
        <EditorTool icon={<Heading2 size={16} />} label="Titulo" onClick={() => addBlock("heading")} />
        <EditorTool icon={<List size={16} />} label="Lista" onClick={() => addBlock("list")} />
        <EditorTool icon={<CheckSquare size={16} />} label="Checklist" onClick={() => addBlock("checklist")} />
        <EditorTool icon={<Table size={16} />} label="Tabela" onClick={() => addBlock("table")} />
        <EditorTool icon={<LinkIcon size={16} />} label="Link" onClick={() => addBlock("link")} />
      </div>

      <div className="space-y-3">
        {blocks.map((block) => (
          <BlockControl
            key={block.id}
            block={block}
            onChange={(next) => updateBlock(block.id, next)}
            onRemove={() => removeBlock(block.id)}
          />
        ))}
      </div>
    </div>
  );
}

function EditorTool({
  icon,
  label,
  onClick
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="inline-flex h-9 items-center gap-2 rounded-md border border-decorato-line bg-decorato-paper px-3 text-sm text-decorato-ink hover:bg-white"
      onClick={onClick}
      title={label}
    >
      {icon}
      {label}
    </button>
  );
}

function BlockControl({
  block,
  onChange,
  onRemove
}: {
  block: ContentBlock;
  onChange: (block: ContentBlock) => void;
  onRemove: () => void;
}) {
  return (
    <section className="rounded-lg border border-decorato-line bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-wide text-decorato-muted">{blockLabel(block.type)}</span>
        <button type="button" className="text-sm text-decorato-coral" onClick={onRemove}>
          Remover
        </button>
      </div>

      {block.type === "paragraph" || block.type === "heading" ? (
        <textarea
          value={block.text}
          onChange={(event) => onChange({ ...block, text: event.target.value.slice(0, 5000) })}
          rows={block.type === "heading" ? 2 : 5}
          className="w-full rounded-lg border border-decorato-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
          placeholder={block.type === "heading" ? "Titulo interno" : "Texto do bloco"}
        />
      ) : null}

      {block.type === "list" ? (
        <textarea
          value={block.items.join("\n")}
          onChange={(event) =>
            onChange({
              ...block,
              items: event.target.value
                .split("\n")
                .map((item) => item.trim())
                .filter(Boolean)
                .slice(0, 50)
            })
          }
          rows={5}
          className="w-full rounded-lg border border-decorato-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
          placeholder="Um item por linha"
        />
      ) : null}

      {block.type === "checklist" ? (
        <textarea
          value={block.items.map((item) => item.text).join("\n")}
          onChange={(event) =>
            onChange({
              ...block,
              items: event.target.value
                .split("\n")
                .map((item) => item.trim())
                .filter(Boolean)
                .slice(0, 50)
                .map((text) => ({ text, checked: false }))
            })
          }
          rows={5}
          className="w-full rounded-lg border border-decorato-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
          placeholder="Um passo por linha"
        />
      ) : null}

      {block.type === "table" ? (
        <textarea
          value={block.rows.map((row) => row.join(" | ")).join("\n")}
          onChange={(event) =>
            onChange({
              ...block,
              rows: event.target.value
                .split("\n")
                .filter(Boolean)
                .slice(0, 25)
                .map((row) => row.split("|").map((cell) => cell.trim()).slice(0, 8))
            })
          }
          rows={6}
          className="w-full rounded-lg border border-decorato-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
          placeholder="Coluna A | Coluna B | Coluna C"
        />
      ) : null}

      {block.type === "link" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <input
            value={block.label}
            onChange={(event) => onChange({ ...block, label: event.target.value.slice(0, 120) })}
            className="h-11 rounded-lg border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
            placeholder="Texto do link"
          />
          <input
            value={block.url}
            onChange={(event) => onChange({ ...block, url: event.target.value.slice(0, 300) })}
            className="h-11 rounded-lg border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
            placeholder="https://..."
          />
        </div>
      ) : null}
    </section>
  );
}

function createBlock(type: ContentBlock["type"]): ContentBlock {
  const id = createId();
  if (type === "paragraph") return { id, type, text: "" };
  if (type === "heading") return { id, type, text: "" };
  if (type === "list") return { id, type, items: [""] };
  if (type === "checklist") return { id, type, items: [{ text: "", checked: false }] };
  if (type === "table") return { id, type, rows: [["", ""]] };
  return { id, type, label: "", url: "" };
}

function createId() {
  return Math.random().toString(36).slice(2, 10);
}

function blockLabel(type: ContentBlock["type"]) {
  if (type === "heading") return "Titulo";
  if (type === "list") return "Lista";
  if (type === "checklist") return "Checklist";
  if (type === "table") return "Tabela";
  if (type === "link") return "Link";
  return "Texto";
}

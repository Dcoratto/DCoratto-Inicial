import type { Category } from "@/types/app";

export function DocumentFields({
  categories,
  defaults
}: {
  categories: Category[];
  defaults?: {
    title?: string;
    summary?: string | null;
    category_id?: string | null;
    tags?: string[];
  };
}) {
  return (
    <>
      <label>
        <span className="text-sm text-decorato-ink">Título</span>
        <input
          name="title"
          required
          maxLength={140}
          defaultValue={defaults?.title}
          className="mt-2 h-11 w-full rounded-lg border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
        />
      </label>
      <label>
        <span className="text-sm text-decorato-ink">Resumo</span>
        <textarea
          name="summary"
          maxLength={300}
          rows={3}
          defaultValue={defaults?.summary ?? ""}
          className="mt-2 w-full rounded-lg border border-decorato-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
        />
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <label>
          <span className="text-sm text-decorato-ink">Departamento/Pasta</span>
          <select
            name="category_id"
            defaultValue={defaults?.category_id ?? ""}
            className="mt-2 h-11 w-full rounded-lg border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
          >
            <option value="">Global</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-sm text-decorato-ink">Tags</span>
          <input
            name="tags"
            defaultValue={defaults?.tags?.join(", ") ?? ""}
            placeholder="comercial, venda, projeto"
            maxLength={240}
            className="mt-2 h-11 w-full rounded-lg border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
          />
        </label>
      </div>
    </>
  );
}

import { createCategory, deactivateCategory, deleteCategory, reactivateCategory, updateCategory } from "@/actions/categories";
import { Button } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Category } from "@/types/app";

type PageProps = {
  searchParams?: Promise<{ notice?: string }>;
};

export default async function AdminCategoriesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [{ data }, { data: documentsData }] = await Promise.all([
    supabase
      .from("categories")
      .select("id,parent_id,name,slug,description,sort_order,is_active,is_department,access_scope")
      .is("deleted_at", null)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase.from("documents").select("id,category_id")
  ]);

  const categories = (data ?? []) as Category[];
  const childrenCount = new Map<string, number>();
  const documentCount = new Map<string, number>();

  categories.forEach((category) => {
    if (category.parent_id) {
      childrenCount.set(category.parent_id, (childrenCount.get(category.parent_id) ?? 0) + 1);
    }
  });

  ((documentsData as Array<{ id: string; category_id: string | null }> | null) ?? []).forEach((document) => {
    if (document.category_id) {
      documentCount.set(document.category_id, (documentCount.get(document.category_id) ?? 0) + 1);
    }
  });

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,420px)_1fr]">
      <section className="rounded-lg border border-decorato-line bg-white p-6">
        <h1 className="text-2xl font-semibold text-decorato-ink">Novo departamento</h1>
        <p className="mt-1 text-sm leading-6 text-decorato-muted">
          Departamentos são as pastas principais da Central. Conteúdos globais aparecem para todos.
        </p>
        <form action={createCategory} className="mt-5 space-y-4">
          <label className="block">
            <span className="text-sm text-decorato-ink">Nome</span>
            <input
              name="name"
              required
              maxLength={80}
              className="mt-2 h-11 w-full rounded-lg border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
            />
          </label>
          <label className="block">
            <span className="text-sm text-decorato-ink">Pasta superior</span>
            <select
              name="parent_id"
              className="mt-2 h-11 w-full rounded-lg border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
            >
              <option value="">Nenhuma</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {categoryPath(category, categories)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm text-decorato-ink">Escopo</span>
            <select
              name="access_scope"
              defaultValue="department"
              className="mt-2 h-11 w-full rounded-lg border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
            >
              <option value="department">Departamento</option>
              <option value="global">Global</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm text-decorato-ink">Descrição</span>
            <textarea
              name="description"
              maxLength={300}
              rows={3}
              className="mt-2 w-full rounded-lg border border-decorato-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
            />
          </label>
          <label className="block">
            <span className="text-sm text-decorato-ink">Ordem</span>
            <input
              type="number"
              name="sort_order"
              min={0}
              defaultValue={0}
              className="mt-2 h-11 w-full rounded-lg border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
            />
          </label>
          <input type="hidden" name="is_active" value="true" />
          <input type="hidden" name="is_department" value="true" />
          <Button type="submit">Criar departamento</Button>
        </form>
      </section>

      <section className="rounded-lg border border-decorato-line bg-white p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-decorato-ink">Departamentos</h2>
            <p className="mt-1 text-sm text-decorato-muted">Edite a hierarquia, ordem, status e escopo de acesso.</p>
          </div>
          {params?.notice ? (
            <p className="rounded-md border border-decorato-teal/25 bg-decorato-teal/10 px-3 py-2 text-sm text-decorato-ink">
              {params.notice}
            </p>
          ) : null}
        </div>
        <div className="mt-5 space-y-4">
          {categories.map((category) => (
            <article key={category.id} className="rounded-lg border border-decorato-line bg-decorato-paper/45 p-4">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="font-semibold text-decorato-ink">{categoryPath(category, categories)}</h3>
                  <p className="text-sm text-decorato-muted">/{category.slug}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-white px-2 py-1 text-xs text-decorato-muted">
                    {category.access_scope === "global" ? "Global" : "Departamento"}
                  </span>
                  <span
                    className={
                      category.is_active
                        ? "rounded-full bg-decorato-teal/10 px-2 py-1 text-xs text-decorato-teal"
                        : "rounded-full bg-decorato-coral/10 px-2 py-1 text-xs text-decorato-coral"
                    }
                  >
                    {category.is_active ? "Ativa" : "Inativa"}
                  </span>
                  <span className="rounded-full bg-white px-2 py-1 text-xs text-decorato-muted">
                    {documentCount.get(category.id) ?? 0} docs
                  </span>
                  <span className="rounded-full bg-white px-2 py-1 text-xs text-decorato-muted">
                    {childrenCount.get(category.id) ?? 0} subpastas
                  </span>
                </div>
              </div>

              <form action={updateCategory} className="grid gap-3 lg:grid-cols-2">
                <input type="hidden" name="id" value={category.id} />
                <input type="hidden" name="is_active" value={String(category.is_active)} />
                <input type="hidden" name="is_department" value="true" />
                <label>
                  <span className="text-sm text-decorato-ink">Nome</span>
                  <input
                    name="name"
                    defaultValue={category.name}
                    required
                    maxLength={80}
                    className="mt-2 h-10 w-full rounded-md border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
                  />
                </label>
                <label>
                  <span className="text-sm text-decorato-ink">Pasta superior</span>
                  <select
                    name="parent_id"
                    defaultValue={category.parent_id ?? ""}
                    className="mt-2 h-10 w-full rounded-md border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
                  >
                    <option value="">Nenhuma</option>
                    {categories
                      .filter((candidate) => candidate.id !== category.id)
                      .map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {categoryPath(candidate, categories)}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  <span className="text-sm text-decorato-ink">Escopo</span>
                  <select
                    name="access_scope"
                    defaultValue={category.access_scope ?? "department"}
                    className="mt-2 h-10 w-full rounded-md border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
                  >
                    <option value="department">Departamento</option>
                    <option value="global">Global</option>
                  </select>
                </label>
                <label>
                  <span className="text-sm text-decorato-ink">Ordem</span>
                  <input
                    type="number"
                    name="sort_order"
                    min={0}
                    defaultValue={category.sort_order}
                    className="mt-2 h-10 w-full rounded-md border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
                  />
                </label>
                <label className="lg:col-span-2">
                  <span className="text-sm text-decorato-ink">Descrição</span>
                  <textarea
                    name="description"
                    defaultValue={category.description ?? ""}
                    maxLength={300}
                    rows={2}
                    className="mt-2 w-full rounded-md border border-decorato-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
                  />
                </label>
                <div className="flex flex-wrap gap-2 lg:col-span-2">
                  <Button type="submit" variant="secondary">
                    Salvar edição
                  </Button>
                </div>
              </form>

              <div className="mt-3 flex flex-wrap gap-2">
                <form action={category.is_active ? deactivateCategory : reactivateCategory}>
                  <input type="hidden" name="id" value={category.id} />
                  <Button type="submit" variant="secondary">
                    {category.is_active ? "Desativar" : "Reativar"}
                  </Button>
                </form>
                {(documentCount.get(category.id) ?? 0) === 0 && (childrenCount.get(category.id) ?? 0) === 0 ? (
                  <form action={deleteCategory}>
                    <input type="hidden" name="id" value={category.id} />
                    <Button type="submit" variant="danger">
                      Excluir
                    </Button>
                  </form>
                ) : (
                  <form action={deleteCategory}>
                    <input type="hidden" name="id" value={category.id} />
                    <Button type="submit" variant="secondary">
                      Verificar exclusão
                    </Button>
                  </form>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function categoryPath(category: Category, categories: Category[]) {
  const byId = new Map(categories.map((item) => [item.id, item]));
  const names = [category.name];
  let current = category.parent_id ? byId.get(category.parent_id) : null;
  let guard = 0;

  while (current && guard < 20) {
    names.unshift(current.name);
    current = current.parent_id ? byId.get(current.parent_id) : null;
    guard += 1;
  }

  return names.join(" / ");
}

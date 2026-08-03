import { Search } from "lucide-react";
import { DocumentCard } from "@/components/document-card";
import { EmptyState } from "@/components/ui/empty-state";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DocumentListItem } from "@/types/app";

type PageProps = {
  searchParams: Promise<{ q?: string }>;
};

export default async function SearchPage({ searchParams }: PageProps) {
  const { q } = await searchParams;
  const query = (q ?? "").trim().slice(0, 80);
  const documents = query ? await searchDocuments(query) : [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold text-decorato-ink">Busca</h1>
        <form className="mt-4 flex max-w-2xl items-center gap-2 rounded-lg border border-decorato-line bg-white px-3">
          <Search aria-hidden="true" size={18} className="text-decorato-muted" />
          <input
            name="q"
            defaultValue={query}
            placeholder="Digite pelo menos duas letras"
            className="h-11 w-full bg-transparent text-sm outline-none"
          />
        </form>
      </header>

      {query.length < 2 ? (
        <EmptyState title="Comece uma busca" description="Pesquise por titulo, resumo, tag ou trecho do conteudo." />
      ) : documents.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {documents.map((document) => (
            <DocumentCard key={document.id} document={document} />
          ))}
        </div>
      ) : (
        <EmptyState title="Nada encontrado" description="Tente outro termo ou confirme se o conteudo foi publicado." />
      )}
    </div>
  );
}

async function searchDocuments(query: string): Promise<DocumentListItem[]> {
  const supabase = await createSupabaseServerClient();
  const term = query.replace(/[%_,]/g, " ").trim();
  const { data, error } = await supabase
    .from("documents")
    .select("id,title,slug,summary,category_id,status,updated_at,tags")
    .eq("status", "published")
    .or(`title.ilike.%${term}%,summary.ilike.%${term}%,content_text.ilike.%${term}%`)
    .order("updated_at", { ascending: false })
    .limit(30);

  if (error) {
    return [];
  }

  return data as DocumentListItem[];
}

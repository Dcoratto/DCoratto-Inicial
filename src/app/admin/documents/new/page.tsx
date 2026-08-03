import { createDocumentDraft } from "@/actions/documents";
import { BlockEditor } from "@/components/block-editor";
import { DocumentFields } from "@/components/document-form-fields";
import { Button } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Category } from "@/types/app";

export default async function NewDocumentPage() {
  const categories = await getCategories();

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-3xl font-semibold text-decorato-ink">Novo documento</h1>
        <p className="mt-1 text-decorato-muted">Salve como rascunho antes de publicar.</p>
      </header>
      <form action={createDocumentDraft} className="grid gap-4 rounded-lg border border-decorato-line bg-white p-6">
        <DocumentFields categories={categories} />
        <BlockEditor />
        <Button type="submit">Salvar rascunho</Button>
      </form>
    </div>
  );
}

async function getCategories(): Promise<Category[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("categories")
    .select("id,parent_id,name,slug,description,sort_order,is_active,is_department,access_scope")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  return (data ?? []) as Category[];
}

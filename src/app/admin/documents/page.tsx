import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DocumentListItem } from "@/types/app";

export default async function AdminDocumentsPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("documents")
    .select("id,title,slug,summary,category_id,status,updated_at,tags")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(100);

  const documents = (data ?? []) as DocumentListItem[];

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-decorato-ink">Documentos</h1>
          <p className="mt-1 text-decorato-muted">Rascunhos, publicados e arquivados.</p>
        </div>
        <ButtonLink href="/admin/documents/new">Novo documento</ButtonLink>
      </header>

      <div className="overflow-hidden rounded-lg border border-decorato-line bg-white">
        <table className="min-w-full divide-y divide-decorato-line text-sm">
          <thead className="bg-decorato-paper text-left text-decorato-muted">
            <tr>
              <th className="px-4 py-3 font-normal">Titulo</th>
              <th className="px-4 py-3 font-normal">Status</th>
              <th className="px-4 py-3 font-normal">Atualizado</th>
              <th className="px-4 py-3 font-normal">Acoes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-decorato-line">
            {documents.map((document) => (
              <tr key={document.id}>
                <td className="px-4 py-3">{document.title}</td>
                <td className="px-4 py-3">{document.status}</td>
                <td className="px-4 py-3">{new Date(document.updated_at).toLocaleDateString("pt-BR")}</td>
                <td className="px-4 py-3">
                  <Link href={`/admin/documents/${document.id}/edit`} className="text-decorato-teal">
                    Editar
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

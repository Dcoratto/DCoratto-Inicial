import { createOnboardingItem, createOnboardingTrack } from "@/actions/onboarding";
import { ProtectedFileActions } from "@/components/protected-file-actions";
import { Button } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Category, DocumentListItem, OnboardingItem, OnboardingTrack } from "@/types/app";

export default async function AdminOnboardingPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: tracksData }, { data: itemsData }, { data: documentsData }, { data: categoriesData }] = await Promise.all([
    supabase
      .from("onboarding_tracks")
      .select("id,title,description,is_active,department_category_id")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("onboarding_items")
      .select("id,track_id,title,description,document_id,video_url,attachment_id,file_storage_path,file_original_name,file_mime_type,file_size_bytes,sort_order")
      .order("sort_order", { ascending: true })
      .limit(200),
    supabase
      .from("documents")
      .select("id,title,slug,summary,category_id,status,updated_at,tags")
      .eq("status", "published")
      .order("title", { ascending: true })
      .limit(200),
    supabase
      .from("categories")
      .select("id,parent_id,name,slug,description,sort_order,is_active,is_department,access_scope")
      .eq("is_active", true)
      .eq("is_department", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
  ]);

  const tracks = (tracksData ?? []) as OnboardingTrack[];
  const items = (itemsData ?? []) as OnboardingItem[];
  const documents = (documentsData ?? []) as DocumentListItem[];
  const categories = (categoriesData ?? []) as Category[];
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,420px)_1fr]">
      <section className="space-y-5">
        <div className="rounded-lg border border-decorato-line bg-white p-6">
          <h1 className="text-2xl font-semibold text-decorato-ink">Nova trilha</h1>
          <form action={createOnboardingTrack} className="mt-5 space-y-4">
            <label className="block">
              <span className="text-sm text-decorato-ink">Titulo</span>
              <input
                name="title"
                required
                maxLength={140}
                className="mt-2 h-11 w-full rounded-lg border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
              />
            </label>
            <label className="block">
              <span className="text-sm text-decorato-ink">Descricao</span>
              <textarea
                name="description"
                maxLength={300}
                rows={3}
                className="mt-2 w-full rounded-lg border border-decorato-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
              />
            </label>
            <label className="block">
              <span className="text-sm text-decorato-ink">Departamento</span>
              <select
                name="department_category_id"
                className="mt-2 h-11 w-full rounded-lg border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
              >
                <option value="">Global</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-decorato-muted">
                Trilhas globais aparecem para todos. Trilhas com departamento seguem as permissões de pasta.
              </span>
            </label>
            <Button type="submit">Criar trilha</Button>
          </form>
        </div>

        <div className="rounded-lg border border-decorato-line bg-white p-6">
          <h2 className="text-2xl font-semibold text-decorato-ink">Novo item</h2>
          <form action={createOnboardingItem} className="mt-5 space-y-4">
            <label className="block">
              <span className="text-sm text-decorato-ink">Trilha</span>
              <select
                name="track_id"
                required
                className="mt-2 h-11 w-full rounded-lg border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
              >
                {tracks.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm text-decorato-ink">Titulo</span>
              <input
                name="title"
                required
                maxLength={140}
                className="mt-2 h-11 w-full rounded-lg border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
              />
            </label>
            <label className="block">
              <span className="text-sm text-decorato-ink">Descricao</span>
              <textarea
                name="description"
                maxLength={300}
                rows={3}
                className="mt-2 w-full rounded-lg border border-decorato-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
              />
            </label>
            <label className="block">
              <span className="text-sm text-decorato-ink">Documento publicado</span>
              <select
                name="document_id"
                className="mt-2 h-11 w-full rounded-lg border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
              >
                <option value="">Nenhum</option>
                {documents.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm text-decorato-ink">Link ou video</span>
              <input
                name="video_url"
                type="url"
                className="mt-2 h-11 w-full rounded-lg border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
              />
            </label>
            <label className="block">
              <span className="text-sm text-decorato-ink">Arquivo enviado</span>
              <input
                name="item_file"
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp,video/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
                className="mt-2 block w-full text-sm text-decorato-muted file:mr-4 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-2 file:text-decorato-ink"
              />
              <span className="mt-1 block text-xs text-decorato-muted">
                Aceita PDF, imagens, documentos e videos. Se o navegador nao reproduzir o video, o arquivo fica para abrir ou baixar.
              </span>
            </label>
            <label className="block">
              <span className="text-sm text-decorato-ink">Ordem</span>
              <input
                name="sort_order"
                type="number"
                min={0}
                defaultValue={0}
                className="mt-2 h-11 w-full rounded-lg border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
              />
            </label>
            <Button type="submit">Criar item</Button>
          </form>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-decorato-ink">Trilhas</h2>
        {tracks.map((track) => (
          <article key={track.id} className="rounded-lg border border-decorato-line bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold text-decorato-ink">{track.title}</h3>
                <p className="mt-1 text-xs text-decorato-muted">
                  {track.department_category_id ? categoryNames.get(track.department_category_id) ?? "Departamento" : "Global"}
                </p>
              </div>
              <span className="rounded-full bg-decorato-teal/10 px-2 py-1 text-xs text-decorato-teal">
                {items.filter((item) => item.track_id === track.id).length} item(ns)
              </span>
            </div>
            {track.description ? <p className="mt-1 text-sm text-decorato-muted">{track.description}</p> : null}
            <div className="mt-4 space-y-2">
              {items
                .filter((item) => item.track_id === track.id)
                .map((item) => (
                  <div key={item.id} className="rounded-md bg-decorato-paper px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>{item.title}</span>
                      {item.file_storage_path && item.file_original_name ? (
                        <ProtectedFileActions
                          storagePath={item.file_storage_path}
                          fileName={item.file_original_name}
                          compact
                        />
                      ) : null}
                    </div>
                  </div>
                ))}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

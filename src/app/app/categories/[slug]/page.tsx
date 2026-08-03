import { notFound } from "next/navigation";
import { CheckCircle2, ChevronRight, Circle, ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { DepartmentDocumentBrowser } from "@/components/department-document-browser";
import { EmptyState } from "@/components/ui/empty-state";
import { requireAuth } from "@/lib/auth";
import { createSignedUrlMap } from "@/lib/storage";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  Category,
  ContentAudienceReceipt,
  DocumentFileVersion,
  DocumentListItem,
  FolderLink,
  OnboardingItem,
  OnboardingTrack
} from "@/types/app";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function CategoryPage({ params }: PageProps) {
  const { slug } = await params;
  const currentUser = await requireAuth();
  const supabase = await createSupabaseServerClient();
  const { data: category } = await supabase
    .from("categories")
    .select("id,parent_id,name,slug,description,sort_order,is_active,is_department,access_scope,archived_at,deleted_at,created_at,updated_at")
    .eq("slug", slug)
    .maybeSingle();

  if (!category) {
    notFound();
  }

  const typedCategory = category as Category;
  const isAdmin = currentUser.profile.role === "admin";
  let documentsQuery = supabase
    .from("documents")
    .select("id,title,slug,summary,category_id,status,created_at,updated_at,tags,is_active,deleted_at")
    .eq("category_id", typedCategory.id)
    .is("deleted_at", null)
    .order("title", { ascending: true })
    .limit(120);

  if (!isAdmin) {
    documentsQuery = documentsQuery.eq("status", "published").eq("is_active", true).is("deleted_at", null);
  }

  const [{ data }, { data: tracksData }, { data: progressData }, { data: subfoldersData }, { data: linksData }, { data: allCategoriesData }] =
    await Promise.all([
      documentsQuery,
      supabase
        .from("onboarding_tracks")
        .select("id,title,description,is_active,department_category_id")
        .eq("is_active", true)
        .eq("department_category_id", typedCategory.id)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase.from("onboarding_progress").select("item_id").eq("user_id", currentUser.id),
      supabase
        .from("categories")
        .select("id,parent_id,name,slug,description,sort_order,is_active,is_department,access_scope,archived_at,deleted_at,created_at,updated_at")
        .eq("parent_id", typedCategory.id)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("folder_links")
        .select("id,category_id,title,url,description,sort_order,is_active,archived_at,deleted_at,created_at,updated_at")
        .eq("category_id", typedCategory.id)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true })
        .order("title", { ascending: true }),
      supabase
        .from("categories")
        .select("id,parent_id,name,slug,description,sort_order,is_active,is_department,access_scope,archived_at,deleted_at,created_at,updated_at")
        .is("deleted_at", null)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true })
    ]);

  const documents = (data ?? []) as DocumentListItem[];
  const documentIds = documents.map((document) => document.id);
  const tracks = (tracksData ?? []) as OnboardingTrack[];
  const trackIds = tracks.map((track) => track.id);
  const [{ data: versionsData }, { data: itemsData }, { data: engagementData }] = await Promise.all([
    documentIds.length > 0
      ? supabase
          .from("document_file_versions")
          .select("id,document_id,version_number,attachment_id,storage_path,original_name,mime_type,size_bytes,checksum,notes,is_current,is_active,deleted_at,created_by,created_at")
          .in("document_id", documentIds)
          .is("deleted_at", null)
          .order("version_number", { ascending: false })
      : Promise.resolve({ data: [] }),
    trackIds.length > 0
      ? supabase
          .from("onboarding_items")
          .select("id,track_id,title,description,document_id,video_url,attachment_id,file_storage_path,file_original_name,file_mime_type,file_size_bytes,sort_order")
          .in("track_id", trackIds)
          .order("sort_order", { ascending: true })
          .limit(200)
      : Promise.resolve({ data: [] }),
    documentIds.length > 0
      ? supabase
          .from("content_audience_receipts")
          .select("content_id,is_viewed,viewed_at,open_count,total_active_seconds,last_opened_at")
          .eq("user_id", currentUser.id)
          .eq("content_type", "document")
          .in("content_id", documentIds)
          .limit(120)
      : Promise.resolve({ data: [] })
  ]);

  const fileVersions = (versionsData ?? []) as DocumentFileVersion[];
  const currentVersions = new Map(fileVersions.filter((version) => version.is_current && version.is_active && !version.deleted_at).map((version) => [version.document_id, version]));
  const previewPaths = Array.from(currentVersions.values())
    .filter((version) => version.mime_type.startsWith("image/") || version.mime_type.startsWith("video/") || version.mime_type === "application/pdf")
    .map((version) => version.storage_path);
  const signedPreviewUrls = await createSignedUrlMap(previewPaths);
  const documentsWithVersions = documents.map((document) => ({
    ...document,
    current_file_version: currentVersions.get(document.id) ?? null,
    thumbnail_url: currentVersions.get(document.id)
      ? signedPreviewUrls.get(currentVersions.get(document.id)!.storage_path) ?? null
      : null
  }));
  const subfolders = ((subfoldersData ?? []) as Category[]).filter((folder) => isAdmin || (folder.is_active && !folder.deleted_at));
  const folderLinks = ((linksData ?? []) as FolderLink[]).filter((folderLink) => isAdmin || (folderLink.is_active && !folderLink.deleted_at));
  const allCategories = ((allCategoriesData ?? []) as Category[]).filter((folder) => isAdmin || (folder.is_active && !folder.deleted_at));
  const breadcrumbs = buildBreadcrumbs(typedCategory, allCategories);

  const items = (itemsData ?? []) as OnboardingItem[];
  const documentEngagement = (engagementData ?? []) as Array<
    Pick<ContentAudienceReceipt, "content_id" | "is_viewed" | "viewed_at" | "open_count" | "total_active_seconds" | "last_opened_at">
  >;
  const completed = new Set(((progressData as Array<{ item_id: string }> | null) ?? []).map((item) => item.item_id));

  return (
    <div className="space-y-6">
      <header>
        <nav className="mb-4 flex flex-wrap items-center gap-1 text-sm text-decorato-muted">
          <Link href="/app" className="hover:text-decorato-ink">
            Início
          </Link>
          {breadcrumbs.map((item) => (
            <span key={item.id} className="inline-flex items-center gap-1">
              <ChevronRight aria-hidden="true" size={14} />
              <Link href={`/app/categories/${item.slug}`} className="hover:text-decorato-ink">
                {item.name}
              </Link>
            </span>
          ))}
        </nav>
        <p className="text-sm text-decorato-muted">Departamento / pasta</p>
        <h1 className="mt-1 text-3xl font-semibold text-decorato-ink">{typedCategory.name}</h1>
        {typedCategory.description ? (
          <p className="mt-3 max-w-3xl text-base leading-7 text-decorato-muted">{typedCategory.description}</p>
        ) : null}
      </header>

      {tracks.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-xl font-semibold text-decorato-ink">Trilhas deste departamento</h2>
            <p className="mt-1 text-sm text-decorato-muted">Comece pelas trilhas antes de consultar os documentos.</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {tracks.map((track) => {
              const trackItems = items.filter((item) => item.track_id === track.id);
              const done = trackItems.filter((item) => completed.has(item.id)).length;
              const progress = trackItems.length > 0 ? Math.round((done / trackItems.length) * 100) : 0;
              const status = progress === 100 ? "Concluída" : progress > 0 ? "Em andamento" : "Não iniciada";

              return (
                <article key={track.id} className="rounded-lg border border-decorato-line bg-white p-5">
                  <div className="flex items-start gap-3">
                    <span className="rounded-lg bg-decorato-teal/10 p-2 text-decorato-teal">
                      <ClipboardCheck aria-hidden="true" size={20} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-decorato-ink">{track.title}</h3>
                      {track.description ? <p className="mt-1 text-sm text-decorato-muted">{track.description}</p> : null}
                      <div className="mt-4 h-2 overflow-hidden rounded-full bg-decorato-line">
                        <div className="h-full rounded-full bg-decorato-teal" style={{ width: `${progress}%` }} />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-decorato-muted">
                        <span>{status}</span>
                        <span>
                          {done}/{trackItems.length} item(ns)
                        </span>
                      </div>
                      <div className="mt-3 space-y-1">
                        {trackItems.slice(0, 4).map((item) => (
                          <div key={item.id} className="flex items-center gap-2 text-sm text-decorato-ink">
                            {completed.has(item.id) ? (
                              <CheckCircle2 aria-hidden="true" size={15} className="text-decorato-leaf" />
                            ) : (
                              <Circle aria-hidden="true" size={15} className="text-decorato-muted" />
                            )}
                            <span className="min-w-0 truncate">{item.title}</span>
                          </div>
                        ))}
                      </div>
                      <Link
                        href="/app/onboarding"
                        className="mt-4 inline-flex rounded-md border border-decorato-line bg-white px-3 py-2 text-sm text-decorato-ink hover:bg-decorato-paper"
                      >
                        Abrir trilha
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {isAdmin || documentsWithVersions.length > 0 || subfolders.length > 0 || folderLinks.length > 0 ? (
        <DepartmentDocumentBrowser
          category={typedCategory}
          allCategories={allCategories}
          subfolders={subfolders}
          documents={documentsWithVersions}
          folderLinks={folderLinks}
          fileVersions={fileVersions}
          documentEngagement={documentEngagement}
          storageKey={`department-view-mode:${typedCategory.id}`}
          profile={currentUser.profile}
        />
      ) : (
        <EmptyState
          title="Esta pasta ainda está vazia"
          description="Envie arquivos, crie uma subpasta ou adicione um link para organizar este departamento."
        />
      )}
    </div>
  );
}

function buildBreadcrumbs(category: Category, categories: Category[]) {
  const byId = new Map(categories.map((item) => [item.id, item]));
  const path: Category[] = [category];
  let current = category.parent_id ? byId.get(category.parent_id) : null;
  let guard = 0;

  while (current && guard < 30) {
    path.unshift(current);
    current = current.parent_id ? byId.get(current.parent_id) : null;
    guard += 1;
  }

  return path;
}

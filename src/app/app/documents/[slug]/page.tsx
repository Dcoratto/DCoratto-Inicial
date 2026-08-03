import Link from "next/link";
import { notFound } from "next/navigation";
import { AttachmentGallery } from "@/components/attachment-gallery";
import { ContentViewTracker, MarkAsViewedButton } from "@/components/content-view-tracker";
import { DocumentReader } from "@/components/document-reader";
import { requireAuth } from "@/lib/auth";
import { getPublishedDocumentForUser } from "@/lib/data";
import { createSignedUrl } from "@/lib/storage";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Attachment, Category, ContentBlock, DocumentDetail } from "@/types/app";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function DocumentPage({ params }: PageProps) {
  const { slug } = await params;
  const currentUser = await requireAuth();
  const document = await getDocumentForUser(slug, currentUser.profile.role === "admin");

  if (!document) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();
  const { data: attachments } = await supabase
    .from("attachments")
    .select("id,storage_path,original_name,mime_type,size_bytes")
    .eq("document_id", document.id)
    .order("created_at", { ascending: false });

  const signedAttachments = (await Promise.all(
    ((attachments as Array<{ id: string; storage_path: string; original_name: string; mime_type: string; size_bytes: number }> | null) ?? []).map(
      async (attachment) => ({
        ...attachment,
        signedUrl: await createSignedUrl(attachment.storage_path)
      })
    )
  )) as Attachment[];

  return (
    <article className="mx-auto max-w-5xl">
      <ContentViewTracker contentType="document" contentId={document.id} categoryId={document.category_id} />
      <div className="mx-auto max-w-[72ch]">
        <nav className="mb-5 text-sm text-decorato-muted">
          <Link href="/app" className="hover:text-decorato-ink">
            Início
          </Link>
          {document.category ? (
            <>
              <span className="mx-2">/</span>
              <Link href={`/app/categories/${document.category.slug}`} className="hover:text-decorato-ink">
                {document.category.name}
              </Link>
            </>
          ) : null}
        </nav>

        <header className="mb-8">
          <div className="mb-3 flex flex-wrap gap-2">
            {document.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-decorato-teal/10 px-3 py-1 text-xs text-decorato-teal">
                {tag}
              </span>
            ))}
          </div>
          <h1 className="text-4xl font-semibold leading-tight text-decorato-ink">{document.title}</h1>
          {document.summary ? <p className="mt-4 text-lg leading-8 text-decorato-muted">{document.summary}</p> : null}
        </header>

        <DocumentReader blocks={document.content_json} />
        <div className="mt-8 border-t border-decorato-line pt-5">
          <MarkAsViewedButton contentType="document" contentId={document.id} categoryId={document.category_id} />
        </div>
      </div>

      <AttachmentGallery attachments={signedAttachments} />
    </article>
  );
}

async function getDocumentForUser(slug: string, isAdmin: boolean): Promise<DocumentDetail | null> {
  if (!isAdmin) {
    return getPublishedDocumentForUser(slug);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("documents")
    .select(
      "id,title,slug,summary,category_id,status,updated_at,tags,content_json,content_text,version,published_at,archived_at,categories(name,slug)"
    )
    .eq("slug", slug)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const record = data as unknown as SupabaseDocumentWithCategory;
  const { categories, ...document } = record;
  return {
    ...document,
    category: normalizeCategory(categories)
  };
}

type SupabaseDocumentWithCategory = DocumentDetail & {
  content_json: ContentBlock[];
  categories?: Pick<Category, "name" | "slug"> | Array<Pick<Category, "name" | "slug">> | null;
};

function normalizeCategory(
  category: SupabaseDocumentWithCategory["categories"]
): Pick<Category, "name" | "slug"> | null {
  if (!category) {
    return null;
  }

  return Array.isArray(category) ? category[0] ?? null : category;
}

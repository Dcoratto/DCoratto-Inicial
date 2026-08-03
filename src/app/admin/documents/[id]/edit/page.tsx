import { notFound } from "next/navigation";
import { archiveDocument, publishDocument, saveDocumentDraft } from "@/actions/documents";
import { AttachmentGallery } from "@/components/attachment-gallery";
import { BlockEditor } from "@/components/block-editor";
import { DocumentFields } from "@/components/document-form-fields";
import { UploadAttachment } from "@/components/upload-attachment";
import { Button } from "@/components/ui/button";
import { createSignedUrl } from "@/lib/storage";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Attachment, Category, ContentBlock, DocumentDetail } from "@/types/app";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditDocumentPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [{ data: documentData }, { data: categoriesData }, { data: attachmentsData }] = await Promise.all([
    supabase
      .from("documents")
      .select("id,title,slug,summary,category_id,status,updated_at,tags,content_json,content_text,version,published_at,archived_at")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("categories")
      .select("id,parent_id,name,slug,description,sort_order,is_active,is_department,access_scope")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("attachments")
      .select("id,storage_path,original_name,mime_type,size_bytes")
      .eq("document_id", id)
      .order("created_at", { ascending: false })
  ]);

  if (!documentData) {
    notFound();
  }

  const document = documentData as DocumentDetail & { content_json: ContentBlock[] };
  const categories = (categoriesData ?? []) as Category[];
  const attachments = (await Promise.all(
    ((attachmentsData as Array<{
      id: string;
      storage_path: string;
      original_name: string;
      mime_type: string;
      size_bytes: number;
    }> | null) ?? []).map(async (attachment) => ({
      ...attachment,
      signedUrl: await createSignedUrl(attachment.storage_path)
    }))
  )) as Attachment[];

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm text-decorato-muted">Status: {document.status} · versao {document.version}</p>
        <h1 className="text-3xl font-semibold text-decorato-ink">Editar documento</h1>
      </header>

      <form action={saveDocumentDraft} className="grid gap-4 rounded-lg border border-decorato-line bg-white p-6">
        <input type="hidden" name="id" value={document.id} />
        <DocumentFields
          categories={categories}
          defaults={{
            title: document.title,
            summary: document.summary,
            category_id: document.category_id,
            tags: document.tags
          }}
        />
        <BlockEditor initialBlocks={document.content_json} />
        <Button type="submit">Salvar rascunho</Button>
      </form>

      <div className="flex flex-wrap gap-3 rounded-lg border border-decorato-line bg-white p-4">
        <form action={publishDocument}>
          <input type="hidden" name="documentId" value={document.id} />
          <Button type="submit">Publicar versao salva</Button>
        </form>
        <form action={archiveDocument}>
          <input type="hidden" name="documentId" value={document.id} />
          <Button type="submit" variant="danger">
            Arquivar
          </Button>
        </form>
      </div>

      <UploadAttachment documentId={document.id} />
      <AttachmentGallery attachments={attachments} />
    </div>
  );
}

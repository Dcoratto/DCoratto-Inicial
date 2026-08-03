"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { appendSlugSuffix, slugify } from "@/lib/slug";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseDocumentPayload } from "@/lib/validation";

export async function createDocumentDraft(formData: FormData) {
  const admin = await requireAdmin();
  const payload = parseDocumentPayload(formData);
  const supabase = await createSupabaseServerClient();
  const slug = await getAvailableDocumentSlug(payload.title);

  const { data, error } = await supabase
    .from("documents")
    .insert({
      category_id: payload.category_id,
      title: payload.title,
      slug,
      summary: payload.summary,
      content_json: payload.content_json,
      content_text: payload.content_text,
      status: "draft",
      tags: payload.tags,
      created_by: admin.id,
      updated_by: admin.id
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error("Nao foi possivel salvar o rascunho.");
  }

  const documentId = (data as { id: string }).id;
  await writeAuditLog({
    actorId: admin.id,
    action: "document.create_draft",
    entityType: "document",
    entityId: documentId,
    metadata: { title: payload.title }
  });

  revalidateTag("documents");
  revalidatePath("/admin/documents");
  redirect(`/admin/documents/${documentId}/edit`);
}

export async function saveDocumentDraft(formData: FormData) {
  const admin = await requireAdmin();
  const payload = parseDocumentPayload(formData);

  if (!payload.id) {
    throw new Error("Documento invalido.");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("documents")
    .update({
      category_id: payload.category_id,
      title: payload.title,
      summary: payload.summary,
      content_json: payload.content_json,
      content_text: payload.content_text,
      status: "draft",
      tags: payload.tags,
      updated_by: admin.id
    })
    .eq("id", payload.id);

  if (error) {
    throw new Error("Nao foi possivel atualizar o rascunho.");
  }

  await writeAuditLog({
    actorId: admin.id,
    action: "document.save_draft",
    entityType: "document",
    entityId: payload.id,
    metadata: { title: payload.title }
  });

  revalidateTag("documents");
  revalidatePath(`/admin/documents/${payload.id}/edit`);
}

export async function publishDocument(formData: FormData) {
  const admin = await requireAdmin();
  const documentId = String(formData.get("documentId") ?? "");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("publish_document", {
    p_document_id: documentId
  });

  if (error) {
    throw new Error("Nao foi possivel publicar o documento.");
  }

  await supabase.rpc("create_document_receipts", {
    p_document_id: documentId,
    p_assigned_by: admin.id
  });

  revalidateTag("documents");
  revalidatePath("/admin/documents");
  revalidatePath(`/admin/documents/${documentId}/edit`);
}

export async function archiveDocument(formData: FormData) {
  await requireAdmin();
  const documentId = String(formData.get("documentId") ?? "");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("archive_document", {
    p_document_id: documentId
  });

  if (error) {
    throw new Error("Nao foi possivel arquivar o documento.");
  }

  revalidateTag("documents");
  revalidatePath("/admin/documents");
  redirect("/admin/documents");
}

async function getAvailableDocumentSlug(title: string): Promise<string> {
  const base = slugify(title);
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("documents")
    .select("slug")
    .ilike("slug", `${base}%`);

  const existing = new Set(((data as Array<{ slug: string }> | null) ?? []).map((item) => item.slug));
  if (!existing.has(base)) {
    return base;
  }

  let candidate = appendSlugSuffix(base);
  while (existing.has(candidate)) {
    candidate = appendSlugSuffix(base);
  }

  return candidate;
}

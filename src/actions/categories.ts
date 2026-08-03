"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { appendSlugSuffix, slugify } from "@/lib/slug";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { categorySchema } from "@/lib/validation";

const categoryIdSchema = z.object({ id: z.string().uuid() });
const updateCategorySchema = categorySchema.extend({ id: z.string().uuid() });

export async function createCategory(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = categorySchema.parse(Object.fromEntries(formData));
  const supabase = await createSupabaseServerClient();
  const slug = await getAvailableCategorySlug(parsed.name);

  const { data, error } = await supabase
    .from("categories")
    .insert({
      parent_id: parsed.parent_id || null,
      name: parsed.name,
      slug,
      description: parsed.description || null,
      sort_order: parsed.sort_order,
      is_active: parsed.is_active,
      is_department: parsed.is_department,
      access_scope: parsed.access_scope,
      created_by: admin.id
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error("Não foi possível criar o departamento.");
  }

  await writeAuditLog({
    actorId: admin.id,
    action: "category.create",
    entityType: "category",
    entityId: (data as { id: string }).id,
    metadata: { name: parsed.name }
  });

  revalidatePath("/admin/categories");
  revalidateTag("categories");
  redirectWithNotice("Departamento criado.");
}

export async function updateCategory(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = updateCategorySchema.parse(Object.fromEntries(formData));
  const supabase = await createSupabaseServerClient();

  await assertNoCategoryCycle(parsed.id, parsed.parent_id || null);

  const { error } = await supabase
    .from("categories")
    .update({
      parent_id: parsed.parent_id || null,
      name: parsed.name,
      description: parsed.description || null,
      sort_order: parsed.sort_order,
      is_active: parsed.is_active,
      is_department: parsed.is_department,
      access_scope: parsed.access_scope
    })
    .eq("id", parsed.id);

  if (error) {
    throw new Error("Não foi possível atualizar o departamento.");
  }

  await writeAuditLog({
    actorId: admin.id,
    action: "category.update",
    entityType: "category",
    entityId: parsed.id,
    metadata: { name: parsed.name, accessScope: parsed.access_scope }
  });

  revalidatePath("/admin/categories");
  revalidateTag("categories");
  redirectWithNotice("Departamento atualizado.");
}

export async function deactivateCategory(formData: FormData) {
  await setCategoryActiveState(formData, false);
}

export async function reactivateCategory(formData: FormData) {
  await setCategoryActiveState(formData, true);
}

export async function deleteCategory(formData: FormData) {
  const admin = await requireAdmin();
  const { id } = categoryIdSchema.parse(Object.fromEntries(formData));
  const supabase = await createSupabaseServerClient();
  const [{ count: documentsCount }, { count: childrenCount }] = await Promise.all([
    supabase.from("documents").select("id", { count: "exact", head: true }).eq("category_id", id),
    supabase.from("categories").select("id", { count: "exact", head: true }).eq("parent_id", id)
  ]);

  if ((documentsCount ?? 0) > 0 || (childrenCount ?? 0) > 0) {
    redirectWithNotice("Departamento mantido: há documentos ou subpastas vinculados. Use desativar para ocultá-lo.");
  }

  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) {
    throw new Error("Não foi possível excluir o departamento.");
  }

  await writeAuditLog({
    actorId: admin.id,
    action: "category.delete",
    entityType: "category",
    entityId: id
  });

  revalidatePath("/admin/categories");
  revalidateTag("categories");
  redirectWithNotice("Departamento excluído.");
}

async function getAvailableCategorySlug(name: string): Promise<string> {
  const base = slugify(name);
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("categories")
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

async function setCategoryActiveState(formData: FormData, isActive: boolean) {
  const admin = await requireAdmin();
  const { id } = categoryIdSchema.parse(Object.fromEntries(formData));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("categories").update({ is_active: isActive }).eq("id", id);

  if (error) {
    throw new Error(isActive ? "Não foi possível reativar o departamento." : "Não foi possível desativar o departamento.");
  }

  await writeAuditLog({
    actorId: admin.id,
    action: isActive ? "category.reactivate" : "category.deactivate",
    entityType: "category",
    entityId: id
  });

  revalidatePath("/admin/categories");
  revalidateTag("categories");
  redirectWithNotice(isActive ? "Departamento reativado." : "Departamento desativado.");
}

async function assertNoCategoryCycle(categoryId: string, parentId: string | null) {
  if (!parentId) {
    return;
  }

  if (categoryId === parentId) {
    throw new Error("O departamento não pode ser superior dele mesmo.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("categories").select("id,parent_id");
  if (error) {
    throw new Error("Não foi possível validar a hierarquia do departamento.");
  }

  const parents = new Map(((data as Array<{ id: string; parent_id: string | null }> | null) ?? []).map((item) => [item.id, item.parent_id]));
  let current: string | null | undefined = parentId;

  while (current) {
    if (current === categoryId) {
      throw new Error("O departamento não pode ser movido para dentro de uma subpasta dele.");
    }
    current = parents.get(current);
  }
}

function redirectWithNotice(message: string): never {
  redirect(`/admin/categories?notice=${encodeURIComponent(message)}`);
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { appendSlugSuffix, slugify } from "@/lib/slug";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const folderPayloadSchema = z.object({
  id: z.string().uuid().optional(),
  parentId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional().or(z.literal("")),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
  accessScope: z.enum(["department", "global"]).default("department")
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), folder: folderPayloadSchema.omit({ id: true }) }),
  z.object({ action: z.literal("update"), folder: folderPayloadSchema.required({ id: true }) }),
  z.object({ action: z.literal("copy"), id: z.string().uuid(), parentId: z.string().uuid().nullable().optional() }),
  z.object({ action: z.literal("move"), id: z.string().uuid(), parentId: z.string().uuid().nullable() }),
  z.object({ action: z.enum(["deactivate", "reactivate", "delete"]), id: z.string().uuid() })
]);

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.profile.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Voce nao tem permissao para gerenciar pastas." }, { status: 403 });
  }

  const json = await request.json().catch(() => null);
  const parsed = actionSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Dados da pasta invalidos." }, { status: 400 });
  }

  const service = createServiceRoleClient();
  const actorId = currentUser.id;

  if (parsed.data.action === "create") {
    const duplicated = await findDuplicateFolderName(service, parsed.data.folder.parentId ?? null, parsed.data.folder.name);
    if (duplicated) {
      return NextResponse.json({ ok: false, error: "Ja existe uma pasta com esse nome neste local." }, { status: 409 });
    }
    const slug = await getAvailableCategorySlug(parsed.data.folder.name);
    const { data, error } = await service
      .from("categories")
      .insert({
        parent_id: parsed.data.folder.parentId ?? null,
        name: parsed.data.folder.name,
        slug,
        description: parsed.data.folder.description || null,
        sort_order: parsed.data.folder.sortOrder,
        is_active: true,
        is_department: true,
        access_scope: parsed.data.folder.accessScope,
        created_by: actorId
      })
      .select("id,parent_id,name,slug,description,sort_order,is_active,is_department,access_scope,archived_at,deleted_at,created_at,updated_at")
      .single();

    if (error || !data) {
      return NextResponse.json({ ok: false, error: "Nao foi possivel criar a pasta." }, { status: 500 });
    }

    await writeAuditLog({
      actorId,
      action: "category.create",
      entityType: "category",
      entityId: data.id,
      metadata: { name: data.name, parentId: data.parent_id }
    });

    return NextResponse.json({ ok: true, folder: data });
  }

  if (parsed.data.action === "update") {
    const duplicated = await findDuplicateFolderName(service, parsed.data.folder.parentId ?? null, parsed.data.folder.name, parsed.data.folder.id);
    if (duplicated) {
      return NextResponse.json({ ok: false, error: "Ja existe uma pasta com esse nome neste local." }, { status: 409 });
    }
    const cycleError = await safeAssertNoCategoryCycle(parsed.data.folder.id, parsed.data.folder.parentId ?? null);
    if (cycleError) {
      return NextResponse.json({ ok: false, error: cycleError }, { status: 400 });
    }
    const { data, error } = await service
      .from("categories")
      .update({
        parent_id: parsed.data.folder.parentId ?? null,
        name: parsed.data.folder.name,
        description: parsed.data.folder.description || null,
        sort_order: parsed.data.folder.sortOrder,
        access_scope: parsed.data.folder.accessScope
      })
      .eq("id", parsed.data.folder.id)
      .select("id,parent_id,name,slug,description,sort_order,is_active,is_department,access_scope,archived_at,deleted_at,created_at,updated_at")
      .single();

    if (error || !data) {
      return NextResponse.json({ ok: false, error: "Nao foi possivel atualizar a pasta." }, { status: 500 });
    }

    await writeAuditLog({
      actorId,
      action: "category.update",
      entityType: "category",
      entityId: data.id,
      metadata: { name: data.name, parentId: data.parent_id }
    });

    return NextResponse.json({ ok: true, folder: data });
  }

  if (parsed.data.action === "copy") {
    const { data: source } = await service
      .from("categories")
      .select("id,parent_id,name,description,sort_order,is_department,access_scope")
      .eq("id", parsed.data.id)
      .maybeSingle<CategoryRow>();

    if (!source) {
      return NextResponse.json({ ok: false, error: "Pasta nao encontrada." }, { status: 404 });
    }

    const name = `${source.name} copia`.slice(0, 80);
    const slug = await getAvailableCategorySlug(name);
    const { data, error } = await service
      .from("categories")
      .insert({
        parent_id: parsed.data.parentId ?? source.parent_id,
        name,
        slug,
        description: source.description,
        sort_order: source.sort_order,
        is_active: true,
        is_department: source.is_department,
        access_scope: source.access_scope,
        created_by: actorId
      })
      .select("id,parent_id,name,slug,description,sort_order,is_active,is_department,access_scope,archived_at,deleted_at,created_at,updated_at")
      .single();

    if (error || !data) {
      return NextResponse.json({ ok: false, error: "Nao foi possivel copiar a pasta." }, { status: 500 });
    }

    await writeAuditLog({
      actorId,
      action: "category.copy",
      entityType: "category",
      entityId: data.id,
      metadata: { sourceId: source.id, name: data.name }
    });

    return NextResponse.json({ ok: true, folder: data });
  }

  if (parsed.data.action === "move") {
    const { data: source } = await service
      .from("categories")
      .select("id,name,parent_id,deleted_at")
      .eq("id", parsed.data.id)
      .maybeSingle<{ id: string; name: string; parent_id: string | null; deleted_at: string | null }>();
    if (!source || source.deleted_at) {
      return NextResponse.json({ ok: false, error: "A pasta não está disponível para movimentação." }, { status: 404 });
    }

    const destination = parsed.data.parentId
      ? await service
          .from("categories")
          .select("id,name,is_active,deleted_at")
          .eq("id", parsed.data.parentId)
          .maybeSingle<{ id: string; name: string; is_active: boolean; deleted_at: string | null }>()
      : { data: null };
    if (parsed.data.parentId && (!destination.data || destination.data.deleted_at || !destination.data.is_active)) {
      return NextResponse.json({ ok: false, error: "A pasta de destino não está disponível." }, { status: 400 });
    }

    const cycleError = await safeAssertNoCategoryCycle(parsed.data.id, parsed.data.parentId);
    if (cycleError) {
      return NextResponse.json({ ok: false, error: cycleError }, { status: 400 });
    }
    const { data, error } = await service
      .from("categories")
      .update({ parent_id: parsed.data.parentId })
      .eq("id", parsed.data.id)
      .select("id,parent_id,name,slug,description,sort_order,is_active,is_department,access_scope,archived_at,deleted_at,created_at,updated_at")
      .single();

    if (error || !data) {
      return NextResponse.json({ ok: false, error: "Não foi possível mover a pasta." }, { status: 500 });
    }

    await writeAuditLog({
      actorId,
      action: "category.move",
      entityType: "category",
      entityId: data.id,
      metadata: {
        name: data.name,
        previousParentId: source.parent_id,
        parentId: data.parent_id,
        targetName: destination.data?.name ?? "Raiz"
      }
    });

    return NextResponse.json({ ok: true, folder: data });
  }

  const updates =
    parsed.data.action === "delete"
      ? {
          deleted_at: new Date().toISOString(),
          deleted_by: actorId,
          trash_expires_at: trashExpiresAt(),
          delete_reason: "Movida para a lixeira pelo admin."
        }
      : parsed.data.action === "deactivate"
        ? { archived_at: new Date().toISOString(), is_active: false }
        : { archived_at: null, is_active: true };

  const { data, error } = await service
    .from("categories")
    .update(updates)
    .eq("id", parsed.data.id)
    .select("id,parent_id,name,slug,description,sort_order,is_active,is_department,access_scope,archived_at,deleted_at,created_at,updated_at")
    .single();

  if (error || !data) {
    return NextResponse.json({ ok: false, error: "Nao foi possivel atualizar a pasta." }, { status: 500 });
  }

  await writeAuditLog({
    actorId,
    action: parsed.data.action === "delete" ? "category.move_to_trash" : `category.${parsed.data.action}`,
    entityType: "category",
    entityId: data.id,
    metadata: { name: data.name }
  });

  return NextResponse.json({ ok: true, folder: data });
}

function trashExpiresAt() {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
}

async function findDuplicateFolderName(
  service: ReturnType<typeof createServiceRoleClient>,
  parentId: string | null,
  name: string,
  ignoreId?: string
) {
  let query = service
    .from("categories")
    .select("id,name")
    .is("deleted_at", null);

  query = parentId ? query.eq("parent_id", parentId) : query.is("parent_id", null);

  const { data } = await query;
  const normalized = normalizeFolderName(name);
  return ((data as Array<{ id: string; name: string }> | null) ?? []).some(
    (folder) => folder.id !== ignoreId && normalizeFolderName(folder.name) === normalized
  );
}

function normalizeFolderName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

async function safeAssertNoCategoryCycle(categoryId: string, parentId: string | null) {
  try {
    await assertNoCategoryCycle(categoryId, parentId);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Hierarquia de pastas invalida.";
  }
}

async function assertNoCategoryCycle(categoryId: string, parentId: string | null) {
  if (!parentId) {
    return;
  }

  if (categoryId === parentId) {
    throw new Error("A pasta nao pode ser superior dela mesma.");
  }

  const service = createServiceRoleClient();
  const { data } = await service.from("categories").select("id,parent_id");
  const parents = new Map(((data as Array<{ id: string; parent_id: string | null }> | null) ?? []).map((item) => [item.id, item.parent_id]));
  let current: string | null | undefined = parentId;
  let guard = 0;

  while (current && guard < 100) {
    if (current === categoryId) {
      throw new Error("A pasta nao pode ser movida para dentro de uma subpasta dela.");
    }
    current = parents.get(current);
    guard += 1;
  }
}

async function getAvailableCategorySlug(name: string): Promise<string> {
  const base = slugify(name) || appendSlugSuffix("pasta");
  const service = createServiceRoleClient();
  const { data } = await service.from("categories").select("slug").ilike("slug", `${base}%`);
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

type CategoryRow = {
  id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
  sort_order: number;
  is_department: boolean;
  access_scope: "department" | "global";
};

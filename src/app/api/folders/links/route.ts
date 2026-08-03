import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const baseLinkSchema = z.object({
  id: z.string().uuid().optional(),
  categoryId: z.string().uuid(),
  title: z.string().trim().min(1).max(140),
  url: z.string().trim().url().max(2000),
  description: z.string().trim().max(300).optional().or(z.literal("")),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(0)
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), link: baseLinkSchema.omit({ id: true }) }),
  z.object({ action: z.literal("update"), link: baseLinkSchema.required({ id: true }) }),
  z.object({ action: z.literal("copy"), id: z.string().uuid(), categoryId: z.string().uuid().optional() }),
  z.object({ action: z.literal("move"), id: z.string().uuid(), categoryId: z.string().uuid() }),
  z.object({ action: z.enum(["deactivate", "reactivate", "delete"]), id: z.string().uuid() })
]);

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.profile.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Voce nao tem permissao para gerenciar links." }, { status: 403 });
  }

  const json = await request.json().catch(() => null);
  const parsed = actionSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Dados do link invalidos." }, { status: 400 });
  }

  const service = createServiceRoleClient();
  const actorId = currentUser.id;

  if (parsed.data.action === "create") {
    const { data, error } = await service
      .from("folder_links")
      .insert({
        category_id: parsed.data.link.categoryId,
        title: parsed.data.link.title,
        url: parsed.data.link.url,
        description: parsed.data.link.description || null,
        sort_order: parsed.data.link.sortOrder,
        created_by: actorId,
        updated_by: actorId
      })
      .select("*")
      .single();

    if (error || !data) {
      return NextResponse.json({ ok: false, error: "Nao foi possivel adicionar o link." }, { status: 500 });
    }

    await writeAuditLog({
      actorId,
      action: "folder_link.create",
      entityType: "folder_link",
      entityId: data.id,
      metadata: { title: data.title, categoryId: data.category_id }
    });

    return NextResponse.json({ ok: true, link: data });
  }

  if (parsed.data.action === "update") {
    const { data, error } = await service
      .from("folder_links")
      .update({
        category_id: parsed.data.link.categoryId,
        title: parsed.data.link.title,
        url: parsed.data.link.url,
        description: parsed.data.link.description || null,
        sort_order: parsed.data.link.sortOrder,
        updated_by: actorId
      })
      .eq("id", parsed.data.link.id)
      .select("*")
      .single();

    if (error || !data) {
      return NextResponse.json({ ok: false, error: "Nao foi possivel atualizar o link." }, { status: 500 });
    }

    await writeAuditLog({
      actorId,
      action: "folder_link.update",
      entityType: "folder_link",
      entityId: data.id,
      metadata: { title: data.title, categoryId: data.category_id }
    });

    return NextResponse.json({ ok: true, link: data });
  }

  if (parsed.data.action === "copy") {
    const { data: source } = await service.from("folder_links").select("*").eq("id", parsed.data.id).maybeSingle<FolderLinkRow>();
    if (!source) {
      return NextResponse.json({ ok: false, error: "Link nao encontrado." }, { status: 404 });
    }

    const { data, error } = await service
      .from("folder_links")
      .insert({
        category_id: parsed.data.categoryId ?? source.category_id,
        title: `${source.title} copia`.slice(0, 140),
        url: source.url,
        description: source.description,
        sort_order: source.sort_order,
        created_by: actorId,
        updated_by: actorId
      })
      .select("*")
      .single();

    if (error || !data) {
      return NextResponse.json({ ok: false, error: "Nao foi possivel copiar o link." }, { status: 500 });
    }

    await writeAuditLog({
      actorId,
      action: "folder_link.copy",
      entityType: "folder_link",
      entityId: data.id,
      metadata: { sourceId: source.id, title: data.title }
    });

    return NextResponse.json({ ok: true, link: data });
  }

  if (parsed.data.action === "move") {
    const [{ data: source }, { data: destination }] = await Promise.all([
      service
        .from("folder_links")
        .select("id,title,category_id,deleted_at")
        .eq("id", parsed.data.id)
        .maybeSingle<{ id: string; title: string; category_id: string; deleted_at: string | null }>(),
      service
        .from("categories")
        .select("id,name,is_active,deleted_at")
        .eq("id", parsed.data.categoryId)
        .maybeSingle<{ id: string; name: string; is_active: boolean; deleted_at: string | null }>()
    ]);

    if (!source || source.deleted_at) {
      return NextResponse.json({ ok: false, error: "O link não está disponível para movimentação." }, { status: 404 });
    }
    if (!destination || destination.deleted_at || !destination.is_active) {
      return NextResponse.json({ ok: false, error: "A pasta de destino não está disponível." }, { status: 400 });
    }

    const { data, error } = await service
      .from("folder_links")
      .update({ category_id: parsed.data.categoryId, updated_by: actorId })
      .eq("id", parsed.data.id)
      .select("*")
      .single();

    if (error || !data) {
      return NextResponse.json({ ok: false, error: "Não foi possível mover o link." }, { status: 500 });
    }

    await writeAuditLog({
      actorId,
      action: "folder_link.move",
      entityType: "folder_link",
      entityId: data.id,
      metadata: {
        title: data.title,
        previousCategoryId: source.category_id,
        categoryId: data.category_id,
        targetName: destination.name
      }
    });

    return NextResponse.json({ ok: true, link: data });
  }

  const updates =
    parsed.data.action === "delete"
      ? {
          deleted_at: new Date().toISOString(),
          deleted_by: actorId,
          trash_expires_at: trashExpiresAt(),
          delete_reason: "Movido para a lixeira pelo admin.",
          updated_by: actorId
        }
      : parsed.data.action === "deactivate"
        ? { is_active: false, archived_at: new Date().toISOString(), updated_by: actorId }
        : { is_active: true, archived_at: null, updated_by: actorId };

  const { data, error } = await service.from("folder_links").update(updates).eq("id", parsed.data.id).select("*").single();
  if (error || !data) {
    return NextResponse.json({ ok: false, error: "Nao foi possivel atualizar o link." }, { status: 500 });
  }

  await writeAuditLog({
    actorId,
    action: parsed.data.action === "delete" ? "folder_link.move_to_trash" : `folder_link.${parsed.data.action}`,
    entityType: "folder_link",
    entityId: data.id,
    metadata: { title: data.title }
  });

  return NextResponse.json({ ok: true, link: data });
}

function trashExpiresAt() {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
}

type FolderLinkRow = {
  id: string;
  category_id: string;
  title: string;
  url: string;
  description: string | null;
  sort_order: number;
};

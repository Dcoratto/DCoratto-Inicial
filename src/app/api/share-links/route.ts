import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { getAppBaseUrl } from "@/lib/env";
import {
  classifyShareLinkDatabaseError,
  type ShareLinkDatabaseError
} from "@/lib/share-link-errors";
import { createShareToken, hashShareToken, tokenHint, type ShareResourceType } from "@/lib/share-tokens";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const resourceSchema = z.object({
  resourceType: z.enum(["category", "document", "folder_link"]),
  resourceId: z.string().uuid()
});

const postSchema = resourceSchema.extend({
  action: z.enum(["create", "revoke"])
});

export async function GET(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.profile.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Voce nao tem permissao para gerenciar compartilhamento." }, { status: 403 });
  }

  const url = new URL(request.url);
  const parsed = resourceSchema.safeParse({
    resourceType: url.searchParams.get("resourceType"),
    resourceId: url.searchParams.get("resourceId")
  });

  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Dados de compartilhamento invalidos." }, { status: 400 });
  }

  const service = createServiceRoleClient();
  const now = new Date().toISOString();
  const { data, error } = await service
    .from("shared_links")
    .select("id,token_hint,expires_at,created_at,last_accessed_at,access_count")
    .eq("resource_type", parsed.data.resourceType)
    .eq("resource_id", parsed.data.resourceId)
    .eq("is_active", true)
    .is("revoked_at", null)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    return shareLinkDatabaseErrorResponse("read", error, "Não foi possível consultar o compartilhamento.");
  }

  const link = data?.[0] ?? null;
  return NextResponse.json({
    ok: true,
    isShared: Boolean(link),
    link: link
      ? {
          id: link.id,
          tokenHint: link.token_hint,
          expiresAt: link.expires_at,
          createdAt: link.created_at,
          lastAccessedAt: link.last_accessed_at,
          accessCount: link.access_count
        }
      : null
  });
}

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.profile.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Voce nao tem permissao para gerenciar compartilhamento." }, { status: 403 });
  }

  const json = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Dados de compartilhamento invalidos." }, { status: 400 });
  }

  const service = createServiceRoleClient();
  const resource = await validateShareableResource(parsed.data.resourceType, parsed.data.resourceId);
  if (!resource.ok) {
    return NextResponse.json({ ok: false, error: resource.error }, { status: resource.status });
  }

  if (parsed.data.action === "revoke") {
    const { error } = await service
      .from("shared_links")
      .update({
        is_active: false,
        revoked_at: new Date().toISOString(),
        revoked_by: currentUser.id
      })
      .eq("resource_type", parsed.data.resourceType)
      .eq("resource_id", parsed.data.resourceId)
      .eq("is_active", true);

    if (error) {
      return shareLinkDatabaseErrorResponse("revoke", error, "Não foi possível desativar o link.");
    }

    await writeAuditLog({
      actorId: currentUser.id,
      action: "shared_link.revoke",
      entityType: parsed.data.resourceType,
      entityId: parsed.data.resourceId,
      metadata: { name: resource.name }
    });

    return NextResponse.json({ ok: true, isShared: false });
  }

  let appBaseUrl: string;
  try {
    appBaseUrl = getAppBaseUrl();
  } catch {
    console.error("Falha segura ao definir URL de compartilhamento", {
      route: "/api/share-links",
      errorCode: "APP_BASE_URL_INVALID"
    });
    return NextResponse.json(
      {
        ok: false,
        code: "APP_BASE_URL_INVALID",
        error: "A URL publica do sistema nao esta configurada corretamente no Railway."
      },
      { status: 503 }
    );
  }

  const token = createShareToken();
  const { data, error } = await service
    .from("shared_links")
    .insert({
      resource_type: parsed.data.resourceType,
      resource_id: parsed.data.resourceId,
      token_hash: hashShareToken(token),
      token_hint: tokenHint(token),
      is_active: true,
      created_by: currentUser.id
    })
    .select("id,token_hint,created_at")
    .single();

  if (error || !data) {
    return shareLinkDatabaseErrorResponse("create", error, "Não foi possível gerar o link compartilhável.");
  }

  const revokedAt = new Date().toISOString();
  const { error: revokePreviousError } = await service
    .from("shared_links")
    .update({
      is_active: false,
      revoked_at: revokedAt,
      revoked_by: currentUser.id
    })
    .eq("resource_type", parsed.data.resourceType)
    .eq("resource_id", parsed.data.resourceId)
    .eq("is_active", true)
    .neq("id", data.id);

  if (revokePreviousError) {
    await service.from("shared_links").delete().eq("id", data.id);
    return shareLinkDatabaseErrorResponse(
      "replace",
      revokePreviousError,
      "Não foi possível substituir o link compartilhável anterior."
    );
  }

  await writeAuditLog({
    actorId: currentUser.id,
    action: "shared_link.create",
    entityType: parsed.data.resourceType,
    entityId: parsed.data.resourceId,
    metadata: { name: resource.name }
  });

  const shareUrl = new URL(`/share/${token}`, `${appBaseUrl}/`).toString();
  return NextResponse.json({
    ok: true,
    isShared: true,
    shareUrl,
    link: {
      id: data.id,
      tokenHint: data.token_hint,
      createdAt: data.created_at
    }
  });
}

function shareLinkDatabaseErrorResponse(
  operation: "read" | "create" | "replace" | "revoke",
  error: ShareLinkDatabaseError | null | undefined,
  fallbackMessage: string
) {
  const kind = classifyShareLinkDatabaseError(error);
  console.error("Falha segura em compartilhamento por link", {
    route: "/api/share-links",
    operation,
    errorCode: error?.code ?? "UNKNOWN",
    errorKind: kind
  });

  if (kind === "schema_missing") {
    return NextResponse.json(
      {
        ok: false,
        code: "SHARED_LINKS_SCHEMA_MISSING",
        error:
          "O compartilhamento por link ainda não foi ativado no banco. Aplique a migration 0012_shared_links no Supabase e tente novamente."
      },
      { status: 503 }
    );
  }

  return NextResponse.json(
    { ok: false, code: "SHARED_LINKS_DATABASE_ERROR", error: fallbackMessage },
    { status: 500 }
  );
}

async function validateShareableResource(resourceType: ShareResourceType, resourceId: string) {
  const service = createServiceRoleClient();

  if (resourceType === "category") {
    const { data } = await service
      .from("categories")
      .select("id,name,is_active,deleted_at")
      .eq("id", resourceId)
      .maybeSingle<{ id: string; name: string; is_active: boolean; deleted_at: string | null }>();
    if (!data || data.deleted_at || !data.is_active) {
      return { ok: false as const, status: 404, error: "A pasta precisa estar ativa para ser compartilhada." };
    }
    return { ok: true as const, name: data.name };
  }

  if (resourceType === "document") {
    const { data } = await service
      .from("documents")
      .select("id,title,status,is_active,deleted_at")
      .eq("id", resourceId)
      .maybeSingle<{ id: string; title: string; status: string; is_active: boolean; deleted_at: string | null }>();
    if (!data || data.deleted_at || !data.is_active || data.status !== "published") {
      return { ok: false as const, status: 404, error: "O documento precisa estar publicado e ativo para ser compartilhado." };
    }
    return { ok: true as const, name: data.title };
  }

  const { data } = await service
    .from("folder_links")
    .select("id,title,is_active,deleted_at")
    .eq("id", resourceId)
    .maybeSingle<{ id: string; title: string; is_active: boolean; deleted_at: string | null }>();
  if (!data || data.deleted_at || !data.is_active) {
    return { ok: false as const, status: 404, error: "O link precisa estar ativo para ser compartilhado." };
  }
  return { ok: true as const, name: data.title };
}

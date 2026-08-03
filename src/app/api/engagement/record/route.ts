import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const payloadSchema = z.object({
  contentType: z.enum(["document", "announcement", "popup", "banner", "onboarding", "folder_link", "attachment", "document_version"]),
  contentId: z.string().uuid(),
  eventType: z.enum(["open", "heartbeat", "close", "manual_viewed", "auto_viewed", "admin_marked_viewed"]),
  activeSeconds: z.coerce.number().int().min(0).max(60).default(0),
  categoryId: z.string().uuid().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Evento inválido." }, { status: 400 });
  }

  if (parsed.data.eventType === "admin_marked_viewed" && currentUser.profile.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Acesso negado." }, { status: 403 });
  }

  const supabase = await createSupabaseServerClient();
  const scope = await resolveTrackingScope(supabase, currentUser, parsed.data);
  if (!scope) {
    return NextResponse.json({ ok: false, error: "Conteúdo não permitido." }, { status: 403 });
  }

  const { error } = await supabase.rpc("record_content_view_event", {
    p_content_type: parsed.data.contentType,
    p_content_id: parsed.data.contentId,
    p_event_type: parsed.data.eventType,
    p_active_seconds: parsed.data.activeSeconds,
    p_category_id: scope.categoryId,
    p_department_id: scope.departmentId,
    p_metadata: parsed.data.metadata ?? {},
    p_user_id: null
  });

  if (error) {
    console.error("Falha ao registrar engajamento", {
      route: "/api/engagement/record",
      errorType: error.name,
      message: error.message
    });
    return NextResponse.json({ ok: false }, { status: 202 });
  }

  return NextResponse.json({ ok: true });
}

async function resolveTrackingScope(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  currentUser: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
  payload: z.infer<typeof payloadSchema>
) {
  if (currentUser.profile.role === "admin") {
    return {
      categoryId: payload.categoryId ?? null,
      departmentId: payload.departmentId ?? currentUser.profile.department_id ?? null
    };
  }

  if (payload.contentType === "document") {
    const { data } = await supabase
      .from("documents")
      .select("id,category_id")
      .eq("id", payload.contentId)
      .maybeSingle<{ id: string; category_id: string | null }>();

    if (!data) {
      return null;
    }

    return {
      categoryId: data.category_id,
      departmentId: currentUser.profile.department_id ?? null
    };
  }

  if (payload.contentType === "folder_link") {
    const { data } = await supabase
      .from("folder_links")
      .select("id,category_id")
      .eq("id", payload.contentId)
      .maybeSingle<{ id: string; category_id: string | null }>();

    if (!data) {
      return null;
    }

    return {
      categoryId: data.category_id,
      departmentId: currentUser.profile.department_id ?? null
    };
  }

  if (payload.contentType === "attachment") {
    const { data } = await supabase
      .from("attachments")
      .select("id,documents(category_id)")
      .eq("id", payload.contentId)
      .maybeSingle<{ id: string; documents?: { category_id: string | null } | Array<{ category_id: string | null }> | null }>();

    if (!data) {
      return null;
    }

    const relatedDocument = Array.isArray(data.documents) ? data.documents[0] : data.documents;
    return {
      categoryId: relatedDocument?.category_id ?? payload.categoryId ?? null,
      departmentId: currentUser.profile.department_id ?? null
    };
  }

  if (payload.contentType === "document_version") {
    const { data } = await supabase
      .from("document_file_versions")
      .select("id,documents(category_id)")
      .eq("id", payload.contentId)
      .maybeSingle<{ id: string; documents?: { category_id: string | null } | Array<{ category_id: string | null }> | null }>();

    if (!data) {
      return null;
    }

    const relatedDocument = Array.isArray(data.documents) ? data.documents[0] : data.documents;
    return {
      categoryId: relatedDocument?.category_id ?? payload.categoryId ?? null,
      departmentId: currentUser.profile.department_id ?? null
    };
  }

  if (payload.contentType === "announcement" || payload.contentType === "popup" || payload.contentType === "banner") {
    const { data } = await supabase
      .from("announcements")
      .select("id")
      .eq("id", payload.contentId)
      .eq("status", "published")
      .maybeSingle<{ id: string }>();

    if (!data) {
      return null;
    }

    return {
      categoryId: null,
      departmentId: currentUser.profile.department_id ?? null
    };
  }

  const { data } = await supabase
    .from("onboarding_items")
    .select("id")
    .eq("id", payload.contentId)
    .maybeSingle<{ id: string }>();

  if (!data) {
    return null;
  }

  return {
    categoryId: null,
    departmentId: currentUser.profile.department_id ?? null
  };
}

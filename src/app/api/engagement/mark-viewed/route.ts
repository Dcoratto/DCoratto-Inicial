import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const markViewedSchema = z.object({
  contentType: z.enum(["document", "announcement", "popup", "banner", "onboarding", "folder_link", "attachment", "document_version"]),
  contentId: z.string().uuid(),
  categoryId: z.string().uuid().nullable().optional()
});

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = markViewedSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Conteúdo inválido." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("mark_content_as_viewed", {
    p_content_type: parsed.data.contentType,
    p_content_id: parsed.data.contentId,
    p_category_id: parsed.data.categoryId ?? null,
    p_user_id: null,
    p_source: "manual"
  });

  if (error) {
    console.error("Falha ao marcar conteúdo como visualizado", {
      route: "/api/engagement/mark-viewed",
      errorType: error.name,
      message: error.message
    });
    return NextResponse.json({ ok: false, error: "Não foi possível marcar como visualizado." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, viewed: true, viewedAt: data ?? new Date().toISOString() });
}

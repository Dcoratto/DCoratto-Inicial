import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const statusSchema = z.object({
  contentType: z.enum(["document", "announcement", "popup", "banner", "onboarding", "folder_link", "attachment", "document_version"]),
  contentId: z.string().uuid()
});

export async function GET(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = statusSchema.safeParse({
    contentType: url.searchParams.get("contentType"),
    contentId: url.searchParams.get("contentId")
  });

  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Conteúdo inválido." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("content_audience_receipts")
    .select("is_viewed,viewed_at,viewed_source")
    .eq("user_id", currentUser.id)
    .eq("content_type", parsed.data.contentType)
    .eq("content_id", parsed.data.contentId)
    .maybeSingle<{ is_viewed: boolean; viewed_at: string | null; viewed_source: string | null }>();

  if (data) {
    return NextResponse.json({
      ok: true,
      viewed: data.is_viewed,
      viewedAt: data.viewed_at,
      viewedSource: data.viewed_source
    });
  }

  const { data: rollup } = await supabase
    .from("content_view_rollups")
    .select("is_viewed,viewed_at,viewed_source")
    .eq("user_id", currentUser.id)
    .eq("content_type", parsed.data.contentType)
    .eq("content_id", parsed.data.contentId)
    .maybeSingle<{ is_viewed: boolean; viewed_at: string | null; viewed_source: string | null }>();

  return NextResponse.json({
    ok: true,
    viewed: rollup?.is_viewed ?? false,
    viewedAt: rollup?.viewed_at ?? null,
    viewedSource: rollup?.viewed_source ?? null
  });
}

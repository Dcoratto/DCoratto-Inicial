import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as { announcementId?: string } | null;
  if (!payload?.announcementId) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("announcement_dismissals").upsert(
    {
      announcement_id: payload.announcementId,
      user_id: currentUser.id,
      dismissed_at: new Date().toISOString()
    },
    {
      onConflict: "announcement_id,user_id",
      ignoreDuplicates: true
    }
  );

  if (error) {
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

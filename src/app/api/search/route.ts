import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SearchResult } from "@/types/app";

export async function GET(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ results: [] }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  if (query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const term = query.replace(/[%,()]/g, " ").trim();
  const supabase = await createSupabaseServerClient();
  const isAdmin = currentUser.profile.role === "admin";

  const documentsQuery = supabase
    .from("documents")
    .select("id,title,slug,summary,status,updated_at")
    .or(`title.ilike.%${term}%,summary.ilike.%${term}%,content_text.ilike.%${term}%`)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(8);

  if (!isAdmin) {
    documentsQuery.eq("status", "published").eq("is_active", true);
  }

  const [documents, announcements, onboarding] = await Promise.all([
    documentsQuery,
    supabase
      .from("announcements")
      .select("id,title,body,status,published_at,updated_at")
      .eq("status", "published")
      .is("deleted_at", null)
      .is("permanently_deleted_at", null)
      .or(`title.ilike.%${term}%,body.ilike.%${term}%`)
      .order("published_at", { ascending: false })
      .limit(5),
    supabase
      .from("onboarding_items")
      .select("id,title,description")
      .or(`title.ilike.%${term}%,description.ilike.%${term}%`)
      .limit(5)
  ]);

  const results: SearchResult[] = [
    ...((documents.data as Array<{
      id: string;
      title: string;
      slug: string;
      summary: string | null;
      status: "draft" | "published" | "archived";
      updated_at: string;
    }> | null) ?? []).map((document) => ({
      type: "document" as const,
      id: document.id,
      title: document.title,
      slug: document.slug,
      summary: document.summary,
      status: document.status,
      href: `/app/documents/${document.slug}`,
      updated_at: document.updated_at
    })),
    ...((announcements.data as Array<{
      id: string;
      title: string;
      body: string;
      updated_at: string;
    }> | null) ?? []).map((announcement) => ({
      type: "announcement" as const,
      id: announcement.id,
      title: announcement.title,
      summary: announcement.body.slice(0, 180),
      href: "/app/announcements",
      updated_at: announcement.updated_at
    })),
    ...((onboarding.data as Array<{ id: string; title: string; description: string | null }> | null) ?? []).map(
      (item) => ({
        type: "onboarding" as const,
        id: item.id,
        title: item.title,
        summary: item.description,
        href: "/app/onboarding",
        updated_at: null
      })
    )
  ];

  return NextResponse.json({ results });
}

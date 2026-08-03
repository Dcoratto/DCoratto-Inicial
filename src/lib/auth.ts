import "server-only";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/app";

export type CurrentUser = {
  id: string;
  email: string | undefined;
  profile: Profile;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id,username,email,full_name,role,department,department_id,department_category_id,is_active,must_change_password,created_at,updated_at")
    .eq("id", user.id)
    .maybeSingle<Profile>();

  if (!profile || !profile.is_active) {
    await supabase.auth.signOut();
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    profile
  };
}

export async function requireAuth(): Promise<CurrentUser> {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    redirect("/login");
  }

  return currentUser;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const currentUser = await requireAuth();

  if (currentUser.profile.role !== "admin") {
    redirect("/app");
  }

  return currentUser;
}

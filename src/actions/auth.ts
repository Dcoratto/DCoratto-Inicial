"use server";

import { redirect } from "next/navigation";
import { createServiceRoleClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { loginLooksLikeEmail, normalizeUsername, technicalEmailForUsername } from "@/lib/username";
import { loginSchema } from "@/lib/validation";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/auth";

export type LoginState = {
  error?: string;
};

export async function loginAction(
  _previousState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return { error: "Login ou senha invalidos." };
  }

  const login = parsed.data.login.trim();

  try {
    await enforceRateLimit(`login:${login.toLowerCase()}`, 6, 60_000);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Tente novamente em alguns instantes."
    };
  }

  const email = await resolveLoginEmail(login);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: parsed.data.password
  });

  if (error) {
    return { error: "Login ou senha invalidos." };
  }

  const currentUser = await getCurrentUser();

  if (!currentUser) {
    await supabase.auth.signOut();
    return { error: "Login ou senha invalidos." };
  }

  if (currentUser.profile.role === "admin") {
    redirect("/admin");
  }

  redirect("/app");
}

export async function logoutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

async function resolveLoginEmail(login: string): Promise<string> {
  if (loginLooksLikeEmail(login)) {
    return login.toLowerCase();
  }

  const username = normalizeUsername(login);
  const service = createServiceRoleClient();
  const { data } = await service
    .from("profiles")
    .select("email")
    .eq("username", username)
    .maybeSingle();

  const profile = data as { email: string | null } | null;
  return profile?.email ?? technicalEmailForUsername(username);
}

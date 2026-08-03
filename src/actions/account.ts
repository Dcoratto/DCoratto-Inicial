"use server";

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { passwordSchema } from "@/lib/validation";
import { createServiceRoleClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";

export async function updateOwnPassword(formData: FormData) {
  const currentUser = await requireAuth();
  await enforceRateLimit(`password:${currentUser.id}`, 5, 60_000);

  const parsed = passwordSchema.parse(Object.fromEntries(formData));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({
    password: parsed.password
  });

  if (error) {
    throw new Error("Nao foi possivel trocar a senha.");
  }

  const service = createServiceRoleClient();
  await service
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", currentUser.id);

  await writeAuditLog({
    actorId: currentUser.id,
    action: "account.password_update",
    entityType: "profile",
    entityId: currentUser.id
  });

  redirect(currentUser.profile.role === "admin" ? "/admin" : "/app");
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { loginLooksLikeEmail, technicalEmailForUsername } from "@/lib/username";
import { createViewerUserSchema, passwordSchema, userIdSchema } from "@/lib/validation";
import { z } from "zod";

const updateUserAccessSchema = z.object({
  userId: z.string().uuid(),
  full_name: z.string().trim().max(120).optional().or(z.literal("")),
  department_category_id: z.string().uuid().optional().or(z.literal(""))
});
const updateUserRoleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["admin", "viewer"])
});

export async function createViewerUser(formData: FormData) {
  const admin = await requireAdmin();
  await enforceRateLimit(`admin:create-user:${admin.id}`, 20, 60_000);

  const parsed = createViewerUserSchema.parse(Object.fromEntries(formData));
  const service = createServiceRoleClient();
  const email = loginLooksLikeEmail(parsed.username) ? parsed.username : technicalEmailForUsername(parsed.username);
  const department = await getDepartmentCategory(service, parsed.department_category_id);
  const legacyDepartmentId = await getLegacyDepartmentId(service, department.slug);
  const extraFolderIds = await getValidExtraFolderIds(
    service,
    formData.getAll("extra_folder_category_ids").map(String),
    department.id
  );

  const { data, error } = await service.auth.admin.createUser({
    email,
    password: parsed.password,
    email_confirm: true,
    user_metadata: {
      username: parsed.username,
      full_name: parsed.full_name || null
    }
  });

  if (error || !data.user) {
    throw new Error("Nao foi possivel criar o usuario.");
  }

  const userId = data.user.id;

  const { error: profileError } = await service.from("profiles").insert({
    id: userId,
    username: parsed.username,
    email,
    full_name: parsed.full_name || null,
    role: "viewer",
    department: department.name,
    department_id: legacyDepartmentId,
    department_category_id: department.id,
    is_active: true,
    must_change_password: true,
    created_by: admin.id
  });

  if (profileError) {
    await service.auth.admin.deleteUser(userId);
    throw new Error("Usuario criado no Auth, mas o profile falhou. A criacao foi revertida.");
  }

  await writeAuditLog({
    actorId: admin.id,
    action: "user.create_viewer",
    entityType: "profile",
    entityId: userId,
    metadata: { username: parsed.username, department: department.name }
  });

  await replaceUserFolderPermissions(service, userId, extraFolderIds, admin.id);

  revalidatePath("/admin/users");
  redirect("/admin/users");
}

async function getDepartmentCategory(service: ReturnType<typeof createServiceRoleClient>, categoryId: string) {
  const { data, error } = await service
    .from("categories")
    .select("id,name,slug,is_active,access_scope")
    .eq("id", categoryId)
    .eq("is_active", true)
    .maybeSingle<{ id: string; name: string; slug: string; is_active: boolean; access_scope?: string | null }>();

  if (error || !data || data.access_scope === "global") {
    throw new Error("Selecione um departamento ativo para o colaborador.");
  }

  return data;
}

async function getLegacyDepartmentId(service: ReturnType<typeof createServiceRoleClient>, slug: string) {
  const { data } = await service.from("departments").select("id").eq("slug", slug).maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

export async function deactivateUser(formData: FormData) {
  const admin = await requireAdmin();
  const { userId } = userIdSchema.parse(Object.fromEntries(formData));
  if (userId === admin.id) {
    throw new Error("O admin atual nao pode desativar a propria conta.");
  }

  const service = createServiceRoleClient();
  const { data: target } = await service
    .from("profiles")
    .select("id,role,is_active")
    .eq("id", userId)
    .maybeSingle<{ id: string; role: "admin" | "viewer"; is_active: boolean }>();
  if (!target) {
    throw new Error("Usuário não encontrado.");
  }
  if (target.role === "admin" && target.is_active && (await countActiveAdmins(service)) <= 1) {
    throw new Error("O último administrador ativo não pode ser desativado.");
  }
  const { error } = await service.from("profiles").update({ is_active: false }).eq("id", userId);
  if (error) {
    throw new Error("Nao foi possivel desativar o usuario.");
  }

  await writeAuditLog({
    actorId: admin.id,
    action: "user.deactivate",
    entityType: "profile",
    entityId: userId
  });

  revalidatePath("/admin/users");
}

export async function updateUserRole(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin();
  await enforceRateLimit(`admin:update-role:${admin.id}`, 20, 60_000);
  const parsed = updateUserRoleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Papel de usuário inválido." };

  const service = createServiceRoleClient();
  const { data: target } = await service
    .from("profiles")
    .select("id,username,email,full_name,role,is_active,department_category_id")
    .eq("id", parsed.data.userId)
    .maybeSingle<{
      id: string;
      username: string | null;
      email: string | null;
      full_name: string | null;
      role: "admin" | "viewer";
      is_active: boolean;
      department_category_id: string | null;
    }>();

  if (!target) return { ok: false, error: "Usuário não encontrado." };
  if (target.role === parsed.data.role) return { ok: true };

  if (parsed.data.role === "viewer") {
    if (!target.department_category_id) {
      return { ok: false, error: "Defina um departamento principal antes de transformar este usuário em colaborador." };
    }
    if (target.is_active && (await countActiveAdmins(service)) <= 1) {
      return { ok: false, error: "O último administrador ativo não pode ser transformado em colaborador." };
    }
  }

  const { error } = await service.from("profiles").update({ role: parsed.data.role }).eq("id", target.id);
  if (error) return { ok: false, error: "Não foi possível alterar o papel do usuário." };

  await writeAuditLog({
    actorId: admin.id,
    action: parsed.data.role === "admin" ? "user.promote_admin" : "user.demote_viewer",
    entityType: "profile",
    entityId: target.id,
    metadata: {
      username: target.full_name || target.username || target.email,
      previousRole: target.role,
      newRole: parsed.data.role
    }
  });

  revalidatePath("/admin/users");
  revalidatePath("/admin");
  return { ok: true };
}

export async function activateUser(formData: FormData) {
  const admin = await requireAdmin();
  const { userId } = userIdSchema.parse(Object.fromEntries(formData));

  const service = createServiceRoleClient();
  const { error } = await service.from("profiles").update({ is_active: true }).eq("id", userId);
  if (error) {
    throw new Error("Nao foi possivel ativar o usuario.");
  }

  await writeAuditLog({
    actorId: admin.id,
    action: "user.activate",
    entityType: "profile",
    entityId: userId
  });

  revalidatePath("/admin/users");
}

export async function resetUserPassword(formData: FormData) {
  const admin = await requireAdmin();
  await enforceRateLimit(`admin:reset-password:${admin.id}`, 10, 60_000);

  const user = userIdSchema.parse(Object.fromEntries(formData));
  const password = passwordSchema.parse(Object.fromEntries(formData));
  const service = createServiceRoleClient();

  const { error } = await service.auth.admin.updateUserById(user.userId, {
    password: password.password
  });

  if (error) {
    throw new Error("Nao foi possivel redefinir a senha.");
  }

  await service
    .from("profiles")
    .update({ must_change_password: true })
    .eq("id", user.userId);

  await writeAuditLog({
    actorId: admin.id,
    action: "user.reset_password",
    entityType: "profile",
    entityId: user.userId
  });

  revalidatePath("/admin/users");
}

export async function updateUserAccess(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = updateUserAccessSchema.parse(Object.fromEntries(formData));
  const service = createServiceRoleClient();
  const { data: targetProfile } = await service
    .from("profiles")
    .select("role")
    .eq("id", parsed.userId)
    .maybeSingle<{ role: "admin" | "viewer" }>();

  if (!targetProfile) {
    throw new Error("Colaborador não encontrado.");
  }

  if (targetProfile.role !== "admin" && !parsed.department_category_id) {
    throw new Error("Selecione um departamento principal para o colaborador.");
  }

  const department = parsed.department_category_id
    ? await getDepartmentCategory(service, parsed.department_category_id)
    : null;
  const legacyDepartmentId = department ? await getLegacyDepartmentId(service, department.slug) : null;
  const extraFolderIds = await getValidExtraFolderIds(
    service,
    formData.getAll("extra_folder_category_ids").map(String),
    department?.id ?? ""
  );

  const { error } = await service
    .from("profiles")
    .update({
      full_name: parsed.full_name || null,
      department: department?.name ?? null,
      department_id: legacyDepartmentId,
      department_category_id: department?.id ?? null
    })
    .eq("id", parsed.userId);

  if (error) {
    throw new Error("Não foi possível atualizar o acesso do colaborador.");
  }

  await replaceUserFolderPermissions(service, parsed.userId, extraFolderIds, admin.id);

  await writeAuditLog({
    actorId: admin.id,
    action: "user.update_access",
    entityType: "profile",
    entityId: parsed.userId,
    metadata: {
      department: department?.name ?? "Global",
      extraFolders: extraFolderIds.length
    }
  });

  revalidatePath("/admin/users");
}

async function getValidExtraFolderIds(
  service: ReturnType<typeof createServiceRoleClient>,
  ids: string[],
  primaryDepartmentId: string
) {
  const uniqueIds = [...new Set(ids)].filter((id) => id && id !== primaryDepartmentId);
  if (uniqueIds.length === 0) {
    return [];
  }

  const { data, error } = await service
    .from("categories")
    .select("id")
    .in("id", uniqueIds)
    .eq("is_active", true)
    .eq("is_department", true)
    .eq("access_scope", "department");

  if (error) {
    throw new Error("Não foi possível validar as pastas adicionais.");
  }

  return ((data ?? []) as Array<{ id: string }>).map((item) => item.id);
}

async function countActiveAdmins(service: ReturnType<typeof createServiceRoleClient>) {
  const { count, error } = await service
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin")
    .eq("is_active", true);
  if (error) {
    throw new Error("Não foi possível validar os administradores ativos.");
  }
  return count ?? 0;
}

async function replaceUserFolderPermissions(
  service: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  categoryIds: string[],
  adminId: string
) {
  await service.from("user_folder_permissions").delete().eq("user_id", userId);

  if (categoryIds.length === 0) {
    return;
  }

  const { error } = await service.from("user_folder_permissions").insert(
    categoryIds.map((categoryId) => ({
      user_id: userId,
      category_id: categoryId,
      granted_by: adminId
    }))
  );

  if (error) {
    throw new Error("Não foi possível salvar as pastas adicionais.");
  }
}

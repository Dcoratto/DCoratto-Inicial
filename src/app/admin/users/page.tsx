import Link from "next/link";
import { activateUser, deactivateUser, resetUserPassword, updateUserAccess } from "@/actions/users";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button";
import { UserRoleControl } from "@/components/user-role-control";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Category, Profile, UserFolderPermission } from "@/types/app";

export default async function AdminUsersPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("profiles")
    .select("id,username,email,full_name,role,department,department_id,department_category_id,is_active,must_change_password,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(100);
  const [{ data: departmentsData }, { data: permissionsData }] = await Promise.all([
    supabase
      .from("categories")
      .select("id,parent_id,name,slug,description,sort_order,is_active,is_department,access_scope")
      .eq("is_active", true)
      .eq("is_department", true)
      .eq("access_scope", "department")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase.from("user_folder_permissions").select("id,user_id,category_id,granted_by,created_at").limit(5000)
  ]);

  const users = (data ?? []) as Profile[];
  const departments = (departmentsData ?? []) as Category[];
  const permissions = (permissionsData ?? []) as UserFolderPermission[];
  const permissionIdsByUser = new Map<string, Set<string>>();
  permissions.forEach((permission) => {
    const existing = permissionIdsByUser.get(permission.user_id) ?? new Set<string>();
    existing.add(permission.category_id);
    permissionIdsByUser.set(permission.user_id, existing);
  });

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-decorato-ink">Usuários</h1>
          <p className="mt-1 text-decorato-muted">Crie leitores, redefina senhas e controle acesso.</p>
        </div>
        <ButtonLink href="/admin/users/new">Criar colaborador</ButtonLink>
      </header>

      <div className="grid gap-4">
        {users.map((user) => {
          const userPermissions = permissionIdsByUser.get(user.id) ?? new Set<string>();
          return (
            <article key={user.id} className="rounded-lg border border-decorato-line bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-decorato-ink">{user.full_name || user.username || user.email}</h2>
                  <p className="mt-1 text-sm text-decorato-muted">
                    {user.username || user.email} · {user.role === "admin" ? "Administrador" : "Colaborador"} · {user.is_active ? "Ativo" : "Inativo"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <UserRoleControl userId={user.id} currentRole={user.role} />
                  <form action={user.is_active ? deactivateUser : activateUser}>
                    <input type="hidden" name="userId" value={user.id} />
                    <Button type="submit" variant="secondary">
                      {user.is_active ? "Desativar" : "Ativar"}
                    </Button>
                  </form>
                  <form action={resetUserPassword} className="flex gap-2">
                    <input type="hidden" name="userId" value={user.id} />
                    <input
                      type="password"
                      name="password"
                      minLength={8}
                      maxLength={72}
                      required
                      placeholder="nova senha"
                      className="h-10 w-36 rounded-md border border-decorato-line px-2 text-sm outline-none"
                    />
                    <Button type="submit" variant="secondary">
                      Redefinir
                    </Button>
                  </form>
                </div>
              </div>

              <form action={updateUserAccess} className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
                <input type="hidden" name="userId" value={user.id} />
                <label>
                  <span className="text-xs text-decorato-muted">Nome</span>
                  <input
                    name="full_name"
                    defaultValue={user.full_name ?? ""}
                    maxLength={120}
                    className="mt-1 h-10 w-full rounded-md border border-decorato-line px-2 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
                  />
                </label>
                <label>
                  <span className="text-xs text-decorato-muted">Departamento principal</span>
                  <select
                    name="department_category_id"
                    defaultValue={user.department_category_id ?? ""}
                    required={user.role !== "admin"}
                    className="mt-1 h-10 w-full rounded-md border border-decorato-line px-2 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
                  >
                    <option value="">Sem departamento</option>
                    {departments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-end">
                  <Button type="submit" className="w-full">
                    Salvar acesso
                  </Button>
                </div>
                <fieldset className="rounded-lg border border-decorato-line p-3 lg:col-span-3">
                  <legend className="px-1 text-xs text-decorato-muted">Pastas adicionais liberadas</legend>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    {departments.map((department) => (
                      <label key={department.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-decorato-paper">
                        <input
                          type="checkbox"
                          name="extra_folder_category_ids"
                          value={department.id}
                          defaultChecked={userPermissions.has(department.id)}
                          disabled={department.id === user.department_category_id}
                          className="h-4 w-4 rounded"
                        />
                        <span>{department.name}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </form>
            </article>
          );
        })}
      </div>

      <Link href="/app/account/password" className="text-sm text-decorato-teal">
        Trocar minha senha de admin
      </Link>
    </div>
  );
}

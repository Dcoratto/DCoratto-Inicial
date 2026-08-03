import { createViewerUser } from "@/actions/users";
import { Button } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Category } from "@/types/app";

export default async function NewUserPage() {
  const departments = await getDepartments();

  return (
    <div className="mx-auto max-w-2xl rounded-lg border border-decorato-line bg-white p-6">
      <h1 className="text-3xl font-semibold text-decorato-ink">Criar colaborador</h1>
      <p className="mt-2 text-sm leading-6 text-decorato-muted">
        Escolha o departamento do colaborador para limitar o acesso aos conteúdos corretos.
      </p>

      <form action={createViewerUser} className="mt-6 grid gap-4">
        <label>
          <span className="text-sm text-decorato-ink">Login</span>
          <input
            name="username"
            required
            minLength={3}
            maxLength={80}
            placeholder="rafael ou rafael@dcoratto.com.br"
            className="mt-2 h-11 w-full rounded-lg border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
          />
          <span className="mt-1 block text-xs text-decorato-muted">
            Use um e-mail válido ou login simples com letras, números, ponto, underline ou hífen.
          </span>
        </label>
        <label>
          <span className="text-sm text-decorato-ink">Senha inicial</span>
          <input
            type="password"
            name="password"
            required
            minLength={8}
            maxLength={72}
            className="mt-2 h-11 w-full rounded-lg border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
          />
        </label>
        <label>
          <span className="text-sm text-decorato-ink">Nome</span>
          <input
            name="full_name"
            maxLength={120}
            className="mt-2 h-11 w-full rounded-lg border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
          />
        </label>
        <label>
          <span className="text-sm text-decorato-ink">Departamento principal</span>
          <select
            name="department_category_id"
            required
            className="mt-2 h-11 w-full rounded-lg border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
          >
            <option value="">Selecione um departamento</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="rounded-lg border border-decorato-line p-4">
          <legend className="px-1 text-sm text-decorato-ink">Pastas adicionais liberadas</legend>
          <p className="mb-3 text-xs leading-5 text-decorato-muted">
            Por padrão, o colaborador vê apenas o departamento principal. Marque pastas extras somente quando necessário.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {departments.map((department) => (
              <label key={department.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-decorato-paper">
                <input type="checkbox" name="extra_folder_category_ids" value={department.id} className="h-4 w-4 rounded" />
                <span>{department.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <Button type="submit">Criar colaborador</Button>
      </form>
    </div>
  );
}

async function getDepartments(): Promise<Category[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("categories")
    .select("id,parent_id,name,slug,description,sort_order,is_active,is_department,access_scope")
    .eq("is_active", true)
    .eq("is_department", true)
    .eq("access_scope", "department")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  return (data ?? []) as Category[];
}

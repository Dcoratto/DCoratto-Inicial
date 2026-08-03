import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { config } from "dotenv";
import { slugify } from "../src/lib/slug";

config({ path: ".env.local" });
config();

const requiredEnv = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ADMIN_BOOTSTRAP_EMAIL",
  "ADMIN_BOOTSTRAP_PASSWORD"
] as const;

type SeedEnv = Record<(typeof requiredEnv)[number], string>;

let supabase: SupabaseClient;

const initialCategories = [
  "Processos Comerciais",
  "Logistica",
  "Padroes de Projeto",
  "Endomarketing",
  "Onboarding"
];

async function main() {
  const env = readSeedEnv();
  supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const email = env.ADMIN_BOOTSTRAP_EMAIL.trim().toLowerCase();
  const password = env.ADMIN_BOOTSTRAP_PASSWORD;

  const user = await ensureAdminUser(email, password);
  await ensureAdminProfile(user);
  await ensureInitialCategories(user.id);

  console.log("Seed concluido: admin e categorias iniciais verificados.");
}

function readSeedEnv(): SeedEnv {
  const values = {} as SeedEnv;

  for (const key of requiredEnv) {
    const value = process.env[key];
    if (!value) {
      throw new Error(`Variavel de ambiente ausente: ${key}`);
    }
    values[key] = value;
  }

  return values;
}

async function ensureAdminUser(email: string, password: string): Promise<User> {
  const existing = await findUserByEmail(email);
  if (existing) {
    return existing;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: "Admin D'Coratto"
    }
  });

  if (error || !data.user) {
    throw new Error("Nao foi possivel criar o admin inicial.");
  }

  return data.user;
}

async function findUserByEmail(email: string): Promise<User | null> {
  let page = 1;
  const perPage = 100;

  while (page < 50) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage
    });

    if (error) {
      throw new Error("Nao foi possivel consultar usuarios do Supabase Auth.");
    }

    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (user) {
      return user;
    }

    if (data.users.length < perPage) {
      return null;
    }

    page += 1;
  }

  return null;
}

async function ensureAdminProfile(user: User) {
  const { error } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      username: "admin",
      email: user.email,
      full_name: "Admin D'Coratto",
      role: "admin",
      department: "Inovacao",
      is_active: true,
      must_change_password: true
    },
    { onConflict: "id" }
  );

  if (error) {
    throw new Error("Nao foi possivel criar o profile admin.");
  }
}

async function ensureInitialCategories(adminId: string) {
  for (const [index, name] of initialCategories.entries()) {
    const { error } = await supabase.from("categories").upsert(
      {
        name,
        slug: slugify(name),
        sort_order: index + 1,
        is_active: true,
        created_by: adminId
      },
      { onConflict: "slug" }
    );

    if (error) {
      throw new Error(`Nao foi possivel criar categoria inicial: ${name}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Erro inesperado no seed.");
  process.exit(1);
});

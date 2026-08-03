import "server-only";

import { resolveAppBaseUrl } from "@/lib/app-base-url";

type PublicEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

type AdminEnv = PublicEnv & {
  supabaseServiceRoleKey: string;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variavel de ambiente ausente: ${name}`);
  }
  return value;
}

export function getPublicEnv(): PublicEnv {
  return {
    supabaseUrl: required("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseAnonKey: required("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  };
}

export function getAdminEnv(): AdminEnv {
  return {
    ...getPublicEnv(),
    supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY")
  };
}

export function getAppBaseUrl(): string {
  return resolveAppBaseUrl({
    appBaseUrl: process.env.APP_BASE_URL,
    railwayPublicDomain: process.env.RAILWAY_PUBLIC_DOMAIN,
    isProduction: process.env.NODE_ENV === "production"
  });
}

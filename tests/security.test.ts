import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canAccessAdmin, canReadDocumentStatus } from "@/lib/access-control";
import { resolveAppBaseUrl } from "@/lib/app-base-url";
import { contentBlocksToText } from "@/lib/content";
import { classifyShareLinkDatabaseError } from "@/lib/share-link-errors";
import { technicalEmailForUsername } from "@/lib/username";
import type { ContentBlock, Profile } from "@/types/app";

const adminProfile: Pick<Profile, "role" | "is_active"> = {
  role: "admin",
  is_active: true
};

const viewerProfile: Pick<Profile, "role" | "is_active"> = {
  role: "viewer",
  is_active: true
};

describe("controle de acesso", () => {
  it("admin pode acessar area administrativa", () => {
    expect(canAccessAdmin(adminProfile)).toBe(true);
  });

  it("viewer nao acessa admin", () => {
    expect(canAccessAdmin(viewerProfile)).toBe(false);
  });

  it("viewer nao le rascunho", () => {
    expect(canReadDocumentStatus(viewerProfile, "draft")).toBe(false);
    expect(canReadDocumentStatus(viewerProfile, "published")).toBe(true);
  });
});

describe("login simples e conteudo", () => {
  it("cria e-mail tecnico para usuario leitor", () => {
    expect(technicalEmailForUsername(" Vendedor.01 ")).toBe("vendedor.01@decorato.local");
  });

  it("gera texto pesquisavel a partir de blocos", () => {
    const blocks: ContentBlock[] = [
      { id: "1", type: "heading", text: "Processo Comercial" },
      { id: "2", type: "list", items: ["Abrir ficha", "Enviar proposta"] }
    ];
    expect(contentBlocksToText(blocks)).toContain("Enviar proposta");
  });
});

describe("erros de compartilhamento por link", () => {
  it("identifica migration ausente sem expor erro tecnico ao usuario", () => {
    expect(classifyShareLinkDatabaseError({ code: "PGRST205" })).toBe("schema_missing");
    expect(classifyShareLinkDatabaseError({ code: "42P01" })).toBe("schema_missing");
    expect(classifyShareLinkDatabaseError({ code: "23505" })).toBe("database_error");
  });

  it("gera link com dominio publico e nunca com localhost em producao", () => {
    expect(
      resolveAppBaseUrl({
        appBaseUrl: "https://localhost:8080",
        railwayPublicDomain: "dcoratto-processos-production.up.railway.app",
        isProduction: true
      })
    ).toBe("https://dcoratto-processos-production.up.railway.app");

    expect(
      resolveAppBaseUrl({
        appBaseUrl: "https://central.dcoratto.com.br/",
        railwayPublicDomain: "internal.example",
        isProduction: true
      })
    ).toBe("https://central.dcoratto.com.br");
  });
});

describe("migration de seguranca", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/0001_decorato_knowledge.sql", import.meta.url),
    "utf8"
  );
  const announcementMigration = readFileSync(
    new URL("../supabase/migrations/0002_announcements_media_targets.sql", import.meta.url),
    "utf8"
  );
  const bannerMigration = readFileSync(
    new URL("../supabase/migrations/0003_announcement_banners.sql", import.meta.url),
    "utf8"
  );
  const receiptsMigration = readFileSync(
    new URL("../supabase/migrations/0006_folder_permissions_receipts_active_media.sql", import.meta.url),
    "utf8"
  );
  const onboardingFilesMigration = readFileSync(
    new URL("../supabase/migrations/0007_onboarding_files_mark_viewed_video_uploads.sql", import.meta.url),
    "utf8"
  );
  const sessionsMigration = readFileSync(
    new URL("../supabase/migrations/0008_content_view_sessions_attention_metrics.sql", import.meta.url),
    "utf8"
  );
  const driveMigration = readFileSync(
    new URL("../supabase/migrations/0009_drive_folders_links_document_versions.sql", import.meta.url),
    "utf8"
  );
  const trashMigration = readFileSync(
    new URL("../supabase/migrations/0010_trash_retention.sql", import.meta.url),
    "utf8"
  );
  const announcementTrashMigration = readFileSync(
    new URL("../supabase/migrations/0011_announcement_trash_and_access_safety.sql", import.meta.url),
    "utf8"
  );
  const sharedLinksMigration = readFileSync(
    new URL("../supabase/migrations/0012_shared_links.sql", import.meta.url),
    "utf8"
  );

  it("tem RLS para documentos e policy de publicados", () => {
    expect(migration).toContain("alter table public.documents enable row level security");
    expect(migration).toContain("documents_select_published_or_admin");
  });

  it("publicacao cria versao imutavel", () => {
    expect(migration).toContain("create or replace function public.publish_document");
    expect(migration).toContain("insert into public.document_versions");
    expect(migration).toContain("prevent_document_versions_mutation");
  });

  it("checklist nao duplica progresso", () => {
    expect(migration).toContain("unique (user_id, item_id)");
    expect(migration).toContain("on conflict (user_id, item_id) do nothing");
  });

  it("comunicados segmentados respeitam alvos e dispensas", () => {
    expect(announcementMigration).toContain("create table if not exists public.announcement_targets");
    expect(announcementMigration).toContain("create table if not exists public.announcement_dismissals");
    expect(announcementMigration).toContain("create or replace function public.can_read_announcement");
    expect(announcementMigration).toContain("announcements_select_targeted_or_admin");
  });

  it("comunicados podem aparecer como banner agendado", () => {
    expect(bannerMigration).toContain("banner_enabled");
    expect(bannerMigration).toContain("announcements_banner_window_idx");
  });

  it("tem permissoes extras por pasta e recibos esperados", () => {
    expect(receiptsMigration).toContain("create table if not exists public.user_folder_permissions");
    expect(receiptsMigration).toContain("create table if not exists public.content_audience_receipts");
    expect(receiptsMigration).toContain("publish_announcement_with_exclusive_surfaces");
    expect(receiptsMigration).toContain("record_content_view_event");
  });

  it("trilhas por departamento, arquivos e visualizado persistente ficam no banco", () => {
    expect(onboardingFilesMigration).toContain("department_category_id uuid null references public.categories");
    expect(onboardingFilesMigration).toContain("attachment_id uuid null references public.attachments");
    expect(onboardingFilesMigration).toContain("set allowed_mime_types = null");
    expect(onboardingFilesMigration).toContain("create or replace function public.mark_content_as_viewed");
    expect(onboardingFilesMigration).toContain("create or replace function public.create_onboarding_receipts");
  });

  it("sessoes e metricas de atencao ficam persistidas", () => {
    expect(sessionsMigration).toContain("create table if not exists public.content_view_sessions");
    expect(sessionsMigration).toContain("average_session_seconds");
    expect(sessionsMigration).toContain("attention_status");
    expect(sessionsMigration).toContain("create or replace function public.record_content_view_event");
  });

  it("pastas estilo drive tem links separados, versoes e RLS", () => {
    expect(driveMigration).toContain("create table if not exists public.folder_links");
    expect(driveMigration).toContain("create table if not exists public.document_file_versions");
    expect(driveMigration).toContain("create policy folder_links_select_readable");
    expect(driveMigration).toContain("create policy document_file_versions_select_readable");
    expect(driveMigration).toContain("create or replace function public.can_read_folder_link");
    expect(driveMigration).toContain("create or replace function public.can_read_document_version");
    expect(driveMigration).toContain("insert into public.document_file_versions");
  });

  it("lixeira preserva itens por 30 dias e bloqueia leitura normal", () => {
    expect(trashMigration).toContain("trash_expires_at");
    expect(trashMigration).toContain("interval '30 days'");
    expect(trashMigration).toContain("create or replace function public.can_read_category");
    expect(trashMigration).toContain("create or replace function public.can_read_document");
    expect(trashMigration).toContain("create policy attachments_select_readable");
    expect(trashMigration).toContain("deleted_at is null");
    expect(trashMigration).toContain("create policy document_file_versions_select_readable");
  });

  it("comunicados usam lixeira segura e o ultimo admin fica protegido", () => {
    expect(announcementTrashMigration).toContain("alter table public.announcements");
    expect(announcementTrashMigration).toContain("trash_expires_at timestamptz");
    expect(announcementTrashMigration).toContain("a.deleted_at is null");
    expect(announcementTrashMigration).toContain("a.permanently_deleted_at is null");
    expect(announcementTrashMigration).toContain("prevent_last_active_admin_removal_trigger");
  });

  it("links compartilhaveis usam token hash e RLS admin-only", () => {
    expect(sharedLinksMigration).toContain("create table if not exists public.shared_links");
    expect(sharedLinksMigration).toContain("token_hash text not null unique");
    expect(sharedLinksMigration).toContain("resource_type text not null check");
    expect(sharedLinksMigration).toContain("alter table public.shared_links enable row level security");
    expect(sharedLinksMigration).toContain("create policy shared_links_admin_select");
    expect(sharedLinksMigration).toContain("with check (public.is_admin())");
  });
});

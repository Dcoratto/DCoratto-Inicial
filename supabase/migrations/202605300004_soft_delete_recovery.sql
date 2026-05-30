alter table public.catalog_colors
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists deleted_reason text,
  add column if not exists deleted_for_users text[] not null default '{}',
  add column if not exists restored_at timestamptz,
  add column if not exists restored_by text,
  add column if not exists created_by text not null default '',
  add column if not exists updated_by text not null default '',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.catalog_options
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists deleted_reason text,
  add column if not exists deleted_for_users text[] not null default '{}',
  add column if not exists restored_at timestamptz,
  add column if not exists restored_by text;

alter table public.catalog_materials
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists deleted_reason text,
  add column if not exists deleted_for_users text[] not null default '{}',
  add column if not exists restored_at timestamptz,
  add column if not exists restored_by text;

alter table public.document_projects
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists deleted_reason text,
  add column if not exists restored_at timestamptz,
  add column if not exists restored_by text;

alter table public.document_html_versions
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists deleted_reason text,
  add column if not exists deleted_for_users text[] not null default '{}',
  add column if not exists restored_at timestamptz,
  add column if not exists restored_by text;

alter table public.editor_audit_logs
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists deleted_reason text,
  add column if not exists deleted_for_users text[] not null default '{}',
  add column if not exists restored_at timestamptz,
  add column if not exists restored_by text;

create index if not exists catalog_materials_soft_delete_idx
on public.catalog_materials(active, deleted_at, group_key, updated_at desc);

create index if not exists catalog_options_soft_delete_idx
on public.catalog_options(active, deleted_at, group_key, updated_at desc);

create index if not exists catalog_colors_soft_delete_idx
on public.catalog_colors(active, deleted_at, updated_at desc);

create index if not exists document_projects_soft_delete_idx
on public.document_projects(deleted_at, updated_at desc);

create index if not exists document_html_versions_soft_delete_idx
on public.document_html_versions(deleted_at, created_at desc);

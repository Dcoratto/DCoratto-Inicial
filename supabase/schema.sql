create extension if not exists pgcrypto;

create table if not exists public.document_projects (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Projeto Inicial',
  client_name text not null default '',
  contract_number text not null default '',
  factory text not null default '',
  address text not null default '',
  project_code text not null default '',
  document_type text not null default 'projeto_inicial',
  status text not null default 'draft' check (status in ('draft', 'review', 'approved', 'archived')),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.document_environments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.document_projects(id) on delete cascade,
  position integer not null default 0,
  name text not null,
  subtitle text not null default 'Projeto Inicial',
  image_url text,
  image_data text,
  colors text[] not null default '{}',
  tamponamentos text not null default '',
  portas text not null default '',
  puxadores text not null default '',
  notes text[] not null default '{}',
  free_note text not null default '',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.catalog_colors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  hex text not null,
  sort_order integer not null default 0,
  active boolean not null default true
);

create table if not exists public.catalog_options (
  id uuid primary key default gen_random_uuid(),
  group_key text not null,
  label text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  unique (group_key, label)
);

create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.document_projects(id) on delete cascade,
  snapshot jsonb not null,
  reason text not null default 'autosave',
  created_at timestamptz not null default now()
);

create index if not exists document_environments_project_idx on public.document_environments(project_id, position);
create index if not exists document_versions_project_idx on public.document_versions(project_id, created_at desc);
create index if not exists document_projects_updated_idx on public.document_projects(updated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_document_projects_updated_at on public.document_projects;
create trigger set_document_projects_updated_at
before update on public.document_projects
for each row execute function public.set_updated_at();

drop trigger if exists set_document_environments_updated_at on public.document_environments;
create trigger set_document_environments_updated_at
before update on public.document_environments
for each row execute function public.set_updated_at();

alter table public.document_projects enable row level security;
alter table public.document_environments enable row level security;
alter table public.catalog_colors enable row level security;
alter table public.catalog_options enable row level security;
alter table public.document_versions enable row level security;

drop policy if exists "Public read projects" on public.document_projects;
create policy "Public read projects" on public.document_projects for select using (true);

drop policy if exists "Public write projects" on public.document_projects;
create policy "Public write projects" on public.document_projects for all using (true) with check (true);

drop policy if exists "Public read environments" on public.document_environments;
create policy "Public read environments" on public.document_environments for select using (true);

drop policy if exists "Public write environments" on public.document_environments;
create policy "Public write environments" on public.document_environments for all using (true) with check (true);

drop policy if exists "Public read colors" on public.catalog_colors;
create policy "Public read colors" on public.catalog_colors for select using (true);

drop policy if exists "Public read options" on public.catalog_options;
create policy "Public read options" on public.catalog_options for select using (true);

drop policy if exists "Public write versions" on public.document_versions;
create policy "Public write versions" on public.document_versions for all using (true) with check (true);

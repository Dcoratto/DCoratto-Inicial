create extension if not exists pgcrypto;

alter table public.document_environments
  add column if not exists corredicas text not null default '';

create table if not exists public.environment_pages (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null references public.document_environments(id) on delete cascade,
  project_id uuid not null references public.document_projects(id) on delete cascade,
  position integer not null default 0,
  title text not null default '',
  description text not null default '',
  image_url text,
  image_data text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (environment_id, position)
);

create index if not exists environment_pages_environment_idx
  on public.environment_pages(environment_id, position);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as '
begin
  new.updated_at = now();
  return new;
end;
';

drop trigger if exists set_environment_pages_updated_at on public.environment_pages;

create trigger set_environment_pages_updated_at
before update on public.environment_pages
for each row execute function public.set_updated_at();

alter table public.environment_pages enable row level security;

drop policy if exists "Authenticated read environment pages" on public.environment_pages;

create policy "Authenticated read environment pages"
on public.environment_pages
for select
using (auth.role() = 'authenticated');

drop policy if exists "Authenticated write environment pages" on public.environment_pages;

create policy "Authenticated write environment pages"
on public.environment_pages
for all
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

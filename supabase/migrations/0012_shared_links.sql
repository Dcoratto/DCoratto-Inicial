create table if not exists public.shared_links (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null check (resource_type in ('category', 'document', 'folder_link')),
  resource_id uuid not null,
  token_hash text not null unique,
  token_hint text not null,
  is_active boolean not null default true,
  expires_at timestamptz null,
  created_by uuid null references auth.users(id) on delete set null,
  revoked_at timestamptz null,
  revoked_by uuid null references auth.users(id) on delete set null,
  last_accessed_at timestamptz null,
  access_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shared_links_resource_idx
  on public.shared_links(resource_type, resource_id, is_active);

create index if not exists shared_links_active_expiration_idx
  on public.shared_links(is_active, expires_at)
  where is_active = true;

drop trigger if exists set_shared_links_updated_at on public.shared_links;
create trigger set_shared_links_updated_at
before update on public.shared_links
for each row execute function public.set_updated_at();

alter table public.shared_links enable row level security;

drop policy if exists shared_links_admin_select on public.shared_links;
create policy shared_links_admin_select on public.shared_links
  for select to authenticated
  using (public.is_admin());

drop policy if exists shared_links_admin_insert on public.shared_links;
create policy shared_links_admin_insert on public.shared_links
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists shared_links_admin_update on public.shared_links;
create policy shared_links_admin_update on public.shared_links
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

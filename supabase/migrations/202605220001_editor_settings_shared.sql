create table if not exists public.editor_settings (
  settings_key text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.editor_settings
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists updated_by text not null default '',
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_editor_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_editor_settings_updated_at on public.editor_settings;
create trigger trg_editor_settings_updated_at
before update on public.editor_settings
for each row
execute function public.set_editor_settings_updated_at();

alter table public.editor_settings enable row level security;

drop policy if exists "editor_settings_authenticated_select" on public.editor_settings;
create policy "editor_settings_authenticated_select"
on public.editor_settings
for select
to authenticated
using (true);

drop policy if exists "editor_settings_authenticated_insert" on public.editor_settings;
create policy "editor_settings_authenticated_insert"
on public.editor_settings
for insert
to authenticated
with check (true);

drop policy if exists "editor_settings_authenticated_update" on public.editor_settings;
create policy "editor_settings_authenticated_update"
on public.editor_settings
for update
to authenticated
using (true)
with check (true);

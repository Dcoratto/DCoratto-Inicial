create extension if not exists pgcrypto;

create table if not exists public.app_users (
  email text primary key,
  display_name text not null default '',
  role text not null default 'team' check (role in ('owner', 'admin', 'team')),
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.app_users (email, display_name, role, password_hash, active)
values
  ('dcorattoinovacao@gmail.com', 'D''Coratto Inovacao', 'owner', crypt('sob_medida', gen_salt('bf')), true),
  ('rafael@dcoratto.com.br', 'Rafael', 'team', crypt('Dcoratto@Rafael26', gen_salt('bf')), true),
  ('isabela@dcoratto.com.br', 'Isabela', 'team', crypt('Dcoratto@Isabela26', gen_salt('bf')), true),
  ('vinicius@dcoratto.com.br', 'Vinicius', 'team', crypt('Dcoratto@Vinicius26', gen_salt('bf')), true)
on conflict (email) do update set
  display_name = excluded.display_name,
  role = excluded.role,
  active = true,
  updated_at = now();

create or replace function public.verify_app_login(login_email text, login_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  app_user public.app_users%rowtype;
begin
  select *
    into app_user
    from public.app_users
    where lower(email) = lower(trim(login_email))
      and active = true;

  if app_user.email is null or app_user.password_hash <> extensions.crypt(login_password, app_user.password_hash) then
    return jsonb_build_object('ok', false);
  end if;

  return jsonb_build_object(
    'ok', true,
    'user', jsonb_build_object(
      'email', app_user.email,
      'name', app_user.display_name,
      'role', app_user.role,
      'primaryAccountEmail', 'dcorattoinovacao@gmail.com',
      'isPrimary', app_user.email = 'dcorattoinovacao@gmail.com'
    )
  );
end;
$$;

grant execute on function public.verify_app_login(text, text) to anon, authenticated, service_role;

alter table public.editor_settings
  add column if not exists owner_email text not null default 'dcorattoinovacao@gmail.com',
  add column if not exists settings_scope text not null default 'shared';

update public.editor_settings
  set owner_email = 'dcorattoinovacao@gmail.com',
      settings_scope = 'shared'
  where settings_key = 'default';

alter table public.catalog_options
  add column if not exists image_url text,
  add column if not exists image_data text,
  add column if not exists owner_email text not null default 'dcorattoinovacao@gmail.com',
  add column if not exists updated_by text not null default '',
  add column if not exists data jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table public.catalog_materials
  add column if not exists image_url text,
  add column if not exists image_data text,
  add column if not exists owner_email text not null default 'dcorattoinovacao@gmail.com',
  add column if not exists updated_by text not null default '',
  add column if not exists updated_at timestamptz not null default now();

update public.catalog_materials
  set image_url = texture_url
  where image_url is null
    and texture_url is not null
    and (texture_url like 'http%' or texture_url like '/%');

update public.catalog_materials
  set image_data = texture_url
  where image_data is null
    and texture_url like 'data:image/%';

alter table public.document_projects
  add column if not exists owner_email text not null default 'dcorattoinovacao@gmail.com',
  add column if not exists created_by text not null default '',
  add column if not exists updated_by text not null default '';

alter table public.document_html_versions
  add column if not exists owner_email text not null default 'dcorattoinovacao@gmail.com',
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_by_id uuid references public.document_html_versions(id) on delete set null,
  add column if not exists replacement_public_url text;

create index if not exists app_users_active_idx on public.app_users(active, email);
create index if not exists catalog_options_group_idx on public.catalog_options(group_key, sort_order);
create index if not exists document_projects_owner_idx on public.document_projects(owner_email, updated_at desc);
create index if not exists document_html_versions_current_project_idx on public.document_html_versions(project_id, is_current, created_at desc);

drop trigger if exists set_app_users_updated_at on public.app_users;
create trigger set_app_users_updated_at
before update on public.app_users
for each row execute function public.set_updated_at();

drop trigger if exists set_catalog_options_updated_at on public.catalog_options;
create trigger set_catalog_options_updated_at
before update on public.catalog_options
for each row execute function public.set_updated_at();

drop trigger if exists set_catalog_materials_updated_at on public.catalog_materials;
create trigger set_catalog_materials_updated_at
before update on public.catalog_materials
for each row execute function public.set_updated_at();

create or replace function public.unset_other_current_html()
returns trigger
language plpgsql
as $$
begin
  if new.is_current then
    update public.document_html_versions
      set is_current = false,
          superseded_at = coalesce(superseded_at, now()),
          superseded_by_id = new.id,
          replacement_public_url = coalesce(new.data->>'publicUrl', replacement_public_url)
      where project_id = new.project_id
        and id <> new.id
        and shared_with_client = true;

    update public.document_projects
      set current_html_id = new.id,
          owner_email = 'dcorattoinovacao@gmail.com'
      where id = new.project_id;
  end if;
  return new;
end;
$$;

drop trigger if exists set_current_html_version on public.document_html_versions;
create trigger set_current_html_version
after insert or update of is_current on public.document_html_versions
for each row execute function public.unset_other_current_html();

alter table public.app_users enable row level security;

drop policy if exists "Service role app users" on public.app_users;
create policy "Service role app users" on public.app_users
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "Authenticated read catalog options" on public.catalog_options;
create policy "Authenticated read catalog options" on public.catalog_options
for select using (auth.role() = 'authenticated');

drop policy if exists "Authenticated write catalog options" on public.catalog_options;
create policy "Authenticated write catalog options" on public.catalog_options
for all using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated write materials" on public.catalog_materials;
create policy "Authenticated write materials" on public.catalog_materials
for all using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

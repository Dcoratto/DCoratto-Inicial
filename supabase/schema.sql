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

create table if not exists public.document_projects (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Projeto Inicial',
  client_name text not null default '',
  contract_number text not null default '',
  factory text not null default '',
  address text not null default '',
  project_code text not null default '',
  document_type text not null default 'projeto_inicial',
  status text not null default 'draft' check (status in ('draft', 'active', 'review', 'approved', 'archived', 'sold')),
  data jsonb not null default '{}'::jsonb,
  current_html_id uuid,
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

create table if not exists public.environment_photos (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null references public.document_environments(id) on delete cascade,
  project_id uuid not null references public.document_projects(id) on delete cascade,
  position integer not null default 0,
  title text not null default '',
  caption text not null default '',
  layout_key text not null default 'balanced',
  image_url text,
  storage_bucket text not null default 'dcoratto-photos',
  storage_path text,
  image_data text,
  alt_text text not null default '',
  width integer,
  height integer,
  mime_type text,
  file_size integer,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.catalog_colors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  hex text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  deleted_at timestamptz,
  deleted_by text,
  deleted_reason text,
  deleted_for_users text[] not null default '{}',
  restored_at timestamptz,
  restored_by text,
  created_by text not null default '',
  updated_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.catalog_options (
  id uuid primary key default gen_random_uuid(),
  group_key text not null,
  label text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  deleted_at timestamptz,
  deleted_by text,
  deleted_reason text,
  deleted_for_users text[] not null default '{}',
  restored_at timestamptz,
  restored_by text,
  unique (group_key, label)
);

create table if not exists public.catalog_materials (
  id uuid primary key default gen_random_uuid(),
  catalog_key text,
  group_key text not null,
  name text not null,
  code text,
  brand text,
  manufacturer text,
  line_name text,
  quality text,
  material_type text,
  category text,
  hex text,
  texture_url text,
  image_url text,
  image_data text,
  storage_bucket text,
  storage_path text,
  public_url text,
  mime_type text,
  width integer,
  height integer,
  owner_email text not null default 'dcorattoinovacao@gmail.com',
  created_by text not null default '',
  updated_by text not null default '',
  sort_order integer not null default 0,
  active boolean not null default true,
  deleted_at timestamptz,
  deleted_by text,
  deleted_reason text,
  deleted_for_users text[] not null default '{}',
  restored_at timestamptz,
  restored_by text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_key, name),
  unique (catalog_key)
);

alter table public.catalog_materials
  add column if not exists manufacturer text,
  add column if not exists line_name text,
  add column if not exists quality text,
  add column if not exists catalog_key text,
  add column if not exists material_type text,
  add column if not exists category text,
  add column if not exists image_url text,
  add column if not exists image_data text,
  add column if not exists storage_bucket text,
  add column if not exists storage_path text,
  add column if not exists public_url text,
  add column if not exists mime_type text,
  add column if not exists width integer,
  add column if not exists height integer,
  add column if not exists owner_email text not null default 'dcorattoinovacao@gmail.com',
  add column if not exists created_by text not null default '',
  add column if not exists updated_by text not null default '',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.environment_colors (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null references public.document_environments(id) on delete cascade,
  project_id uuid not null references public.document_projects(id) on delete cascade,
  color_id uuid references public.catalog_colors(id),
  name text not null,
  hex text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (environment_id, name)
);

create table if not exists public.environment_materials (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null references public.document_environments(id) on delete cascade,
  project_id uuid not null references public.document_projects(id) on delete cascade,
  group_key text not null,
  material_id uuid references public.catalog_materials(id),
  label text not null,
  value text not null,
  position integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (environment_id, group_key, value)
);

create table if not exists public.environment_notes (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null references public.document_environments(id) on delete cascade,
  project_id uuid not null references public.document_projects(id) on delete cascade,
  note_type text not null default 'observacao' check (note_type in ('observacao', 'anotacao', 'alerta', 'tecnico')),
  body text not null,
  position integer not null default 0,
  show_on_html boolean not null default true,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists public.document_html_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.document_projects(id) on delete cascade,
  version_number integer not null default 1,
  title text not null default 'Portfolio HTML',
  html_content text not null,
  storage_bucket text not null default 'dcoratto-html',
  storage_path text,
  data jsonb not null default '{}'::jsonb,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  unique (project_id, version_number)
);

alter table public.document_html_versions
  add column if not exists shared_with_client boolean not null default false,
  add column if not exists shared_at timestamptz,
  add column if not exists created_by text not null default '',
  add column if not exists assigned_to_email text not null default '',
  add column if not exists share_slug text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists deleted_reason text,
  add column if not exists deleted_for_users text[] not null default '{}',
  add column if not exists restored_at timestamptz,
  add column if not exists restored_by text;

alter table public.document_projects
  add column if not exists owner_email text not null default 'dcorattoinovacao@gmail.com',
  add column if not exists created_by text not null default '',
  add column if not exists updated_by text not null default '',
  add column if not exists assigned_to_email text not null default '',
  add column if not exists last_editor_email text not null default '',
  add column if not exists last_editor_name text not null default '',
  add column if not exists is_draft boolean not null default false,
  add column if not exists draft_owner_email text not null default '',
  add column if not exists draft_saved_at timestamptz,
  add column if not exists deleted_for_users text[] not null default '{}',
  add column if not exists sold_at timestamptz,
  add column if not exists sold_by text,
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists lock_reason text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists deleted_reason text,
  add column if not exists restored_at timestamptz,
  add column if not exists restored_by text;

alter table public.document_environments
  add column if not exists corredicas text not null default '';

create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.document_projects(id) on delete cascade,
  snapshot jsonb not null,
  reason text not null default 'autosave',
  created_at timestamptz not null default now()
);

create table if not exists public.editor_audit_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.document_projects(id) on delete set null,
  event_id uuid unique,
  actor_email text not null default '',
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.editor_audit_logs
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists deleted_reason text,
  add column if not exists deleted_for_users text[] not null default '{}',
  add column if not exists restored_at timestamptz,
  add column if not exists restored_by text;

create table if not exists public.editor_settings (
  id uuid primary key default gen_random_uuid(),
  settings_key text not null unique default 'default',
  payload jsonb not null default '{}'::jsonb,
  updated_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'document_projects_current_html_id_fkey'
  ) then
    alter table public.document_projects
      add constraint document_projects_current_html_id_fkey
      foreign key (current_html_id)
      references public.document_html_versions(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists document_environments_project_idx on public.document_environments(project_id, position);
create index if not exists environment_pages_environment_idx on public.environment_pages(environment_id, position);
create index if not exists environment_photos_environment_idx on public.environment_photos(environment_id, position);
create index if not exists document_html_versions_client_event_idx
  on public.document_html_versions ((data ->> 'eventId'))
  where shared_with_client = true
    and (data ->> 'eventId') is not null;
create index if not exists environment_photos_project_idx on public.environment_photos(project_id, position);
create index if not exists environment_colors_environment_idx on public.environment_colors(environment_id, position);
create index if not exists environment_materials_environment_idx on public.environment_materials(environment_id, group_key, position);
create index if not exists environment_notes_environment_idx on public.environment_notes(environment_id, note_type, position);
create index if not exists document_html_versions_project_idx on public.document_html_versions(project_id, created_at desc);
create index if not exists document_html_versions_created_idx on public.document_html_versions(created_by, created_at desc);
create index if not exists document_html_versions_assigned_idx on public.document_html_versions(assigned_to_email, created_at desc);
create index if not exists document_html_versions_soft_delete_idx on public.document_html_versions(deleted_at, created_at desc);
create index if not exists document_versions_project_idx on public.document_versions(project_id, created_at desc);
create index if not exists document_projects_updated_idx on public.document_projects(updated_at desc);
create index if not exists document_projects_assigned_updated_idx on public.document_projects(assigned_to_email, updated_at desc);
create index if not exists document_projects_status_assigned_updated_idx on public.document_projects(status, assigned_to_email, updated_at desc);
create index if not exists document_projects_draft_owner_updated_idx on public.document_projects(draft_owner_email, updated_at desc) where is_draft = true;
create index if not exists document_projects_soft_delete_idx on public.document_projects(deleted_at, updated_at desc);
create index if not exists catalog_materials_manufacturer_idx on public.catalog_materials(manufacturer, line_name, sort_order);
create index if not exists catalog_materials_filter_idx on public.catalog_materials(group_key, manufacturer, line_name, quality, sort_order);
create index if not exists catalog_materials_soft_delete_idx on public.catalog_materials(active, deleted_at, group_key, updated_at desc);
create index if not exists catalog_options_soft_delete_idx on public.catalog_options(active, deleted_at, group_key, updated_at desc);
create index if not exists catalog_colors_soft_delete_idx on public.catalog_colors(active, deleted_at, updated_at desc);
create unique index if not exists catalog_materials_catalog_key_uidx on public.catalog_materials(catalog_key) where catalog_key is not null;
create index if not exists app_users_active_idx on public.app_users(active, email);
create index if not exists editor_audit_logs_project_idx on public.editor_audit_logs(project_id, created_at desc);
create index if not exists editor_audit_logs_actor_idx on public.editor_audit_logs(actor_email, created_at desc);
create index if not exists document_html_versions_shared_idx on public.document_html_versions(shared_with_client, shared_at desc);
create index if not exists editor_settings_key_idx on public.editor_settings(settings_key);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_app_users_updated_at on public.app_users;
create trigger set_app_users_updated_at
before update on public.app_users
for each row execute function public.set_updated_at();

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

create or replace function public.upsert_app_user(
  manager_email text,
  original_email text,
  user_email text,
  user_display_name text,
  user_role text,
  user_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  manager_user public.app_users%rowtype;
  existing_user public.app_users%rowtype;
  manager_login text := lower(trim(coalesce(manager_email, '')));
  original_login text := lower(trim(coalesce(original_email, '')));
  next_login text := lower(trim(coalesce(user_email, '')));
  next_name text := trim(coalesce(user_display_name, ''));
  next_role text := lower(trim(coalesce(user_role, 'team')));
  next_password text := coalesce(user_password, '');
  saved_user public.app_users%rowtype;
begin
  select *
    into manager_user
    from public.app_users
    where lower(email) = manager_login
      and active = true;

  if manager_login <> 'dcorattoinovacao@gmail.com' and coalesce(manager_user.role, '') not in ('owner', 'admin') then
    raise exception 'forbidden_app_user_management';
  end if;

  if next_login !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or next_name = '' then
    raise exception 'invalid_app_user';
  end if;

  if next_role not in ('owner', 'admin', 'team') then
    next_role := 'team';
  end if;

  if next_login = 'dcorattoinovacao@gmail.com' then
    next_role := 'owner';
  end if;

  if original_login = 'dcorattoinovacao@gmail.com' and next_login <> original_login then
    raise exception 'primary_user_locked';
  end if;

  if original_login <> '' then
    select *
      into existing_user
      from public.app_users
      where lower(email) = original_login;
  else
    select *
      into existing_user
      from public.app_users
      where lower(email) = next_login;
  end if;

  if existing_user.email is null then
    if trim(next_password) = '' then
      raise exception 'password_required';
    end if;

    insert into public.app_users (email, display_name, role, password_hash, active)
    values (next_login, next_name, next_role, extensions.crypt(next_password, extensions.gen_salt('bf')), true)
    returning * into saved_user;
  else
    update public.app_users
      set email = next_login,
          display_name = next_name,
          role = next_role,
          password_hash = case
            when trim(next_password) <> '' then extensions.crypt(next_password, extensions.gen_salt('bf'))
            else password_hash
          end,
          active = true,
          updated_at = now()
      where email = existing_user.email
      returning * into saved_user;
  end if;

  return jsonb_build_object(
    'user', jsonb_build_object(
      'email', saved_user.email,
      'display_name', saved_user.display_name,
      'role', saved_user.role,
      'active', saved_user.active,
      'created_at', saved_user.created_at,
      'updated_at', saved_user.updated_at
    )
  );
end;
$$;

grant execute on function public.verify_app_login(text, text) to anon, authenticated, service_role;
grant execute on function public.upsert_app_user(text, text, text, text, text, text) to service_role;

drop trigger if exists set_document_projects_updated_at on public.document_projects;
create trigger set_document_projects_updated_at
before update on public.document_projects
for each row execute function public.set_updated_at();

drop trigger if exists set_document_environments_updated_at on public.document_environments;
create trigger set_document_environments_updated_at
before update on public.document_environments
for each row execute function public.set_updated_at();

drop trigger if exists set_environment_photos_updated_at on public.environment_photos;
create trigger set_environment_photos_updated_at
before update on public.environment_photos
for each row execute function public.set_updated_at();

drop trigger if exists set_environment_materials_updated_at on public.environment_materials;
create trigger set_environment_materials_updated_at
before update on public.environment_materials
for each row execute function public.set_updated_at();

drop trigger if exists set_catalog_materials_updated_at on public.catalog_materials;
create trigger set_catalog_materials_updated_at
before update on public.catalog_materials
for each row execute function public.set_updated_at();

drop trigger if exists set_environment_notes_updated_at on public.environment_notes;
create trigger set_environment_notes_updated_at
before update on public.environment_notes
for each row execute function public.set_updated_at();

drop trigger if exists set_environment_pages_updated_at on public.environment_pages;
create trigger set_environment_pages_updated_at
before update on public.environment_pages
for each row execute function public.set_updated_at();

drop trigger if exists set_editor_settings_updated_at on public.editor_settings;
create trigger set_editor_settings_updated_at
before update on public.editor_settings
for each row execute function public.set_updated_at();

create or replace function public.unset_other_current_html()
returns trigger
language plpgsql
as $$
begin
  if new.is_current then
    update public.document_html_versions
      set is_current = false
      where project_id = new.project_id
        and id <> new.id;
    update public.document_projects
      set current_html_id = new.id
      where id = new.project_id;
  end if;
  return new;
end;
$$;

drop trigger if exists set_current_html_version on public.document_html_versions;
create trigger set_current_html_version
after insert or update of is_current on public.document_html_versions
for each row execute function public.unset_other_current_html();

alter table public.document_projects enable row level security;
alter table public.document_environments enable row level security;
alter table public.environment_photos enable row level security;
alter table public.environment_colors enable row level security;
alter table public.environment_materials enable row level security;
alter table public.environment_notes enable row level security;
alter table public.environment_pages enable row level security;
alter table public.catalog_colors enable row level security;
alter table public.catalog_options enable row level security;
alter table public.catalog_materials enable row level security;
alter table public.document_html_versions enable row level security;
alter table public.document_versions enable row level security;
alter table public.editor_audit_logs enable row level security;
alter table public.editor_settings enable row level security;

drop policy if exists "Public read projects" on public.document_projects;
create policy "Public read projects" on public.document_projects for select using (true);

drop policy if exists "Public write projects" on public.document_projects;
create policy "Public write projects" on public.document_projects for all using (true) with check (true);

drop policy if exists "Public read environments" on public.document_environments;
create policy "Public read environments" on public.document_environments for select using (true);

drop policy if exists "Public write environments" on public.document_environments;
create policy "Public write environments" on public.document_environments for all using (true) with check (true);

drop policy if exists "Public read environment photos" on public.environment_photos;
create policy "Public read environment photos" on public.environment_photos for select using (true);

drop policy if exists "Public write environment photos" on public.environment_photos;
create policy "Public write environment photos" on public.environment_photos for all using (true) with check (true);

drop policy if exists "Public read environment colors" on public.environment_colors;
create policy "Public read environment colors" on public.environment_colors for select using (true);

drop policy if exists "Public write environment colors" on public.environment_colors;
create policy "Public write environment colors" on public.environment_colors for all using (true) with check (true);

drop policy if exists "Public read environment materials" on public.environment_materials;
create policy "Public read environment materials" on public.environment_materials for select using (true);

drop policy if exists "Public write environment materials" on public.environment_materials;
create policy "Public write environment materials" on public.environment_materials for all using (true) with check (true);

drop policy if exists "Public read environment notes" on public.environment_notes;
create policy "Public read environment notes" on public.environment_notes for select using (true);

drop policy if exists "Public write environment notes" on public.environment_notes;
create policy "Public write environment notes" on public.environment_notes for all using (true) with check (true);

drop policy if exists "Public read colors" on public.catalog_colors;
create policy "Public read colors" on public.catalog_colors for select using (true);

drop policy if exists "Public read options" on public.catalog_options;
create policy "Public read options" on public.catalog_options for select using (true);

drop policy if exists "Public read materials" on public.catalog_materials;
create policy "Public read materials" on public.catalog_materials for select using (true);

drop policy if exists "Public read html versions" on public.document_html_versions;
create policy "Public read html versions" on public.document_html_versions for select using (true);

drop policy if exists "Public write html versions" on public.document_html_versions;
create policy "Public write html versions" on public.document_html_versions for all using (true) with check (true);

drop policy if exists "Public write versions" on public.document_versions;
create policy "Public write versions" on public.document_versions for all using (true) with check (true);

create or replace view public.project_document_payload as
select
  p.id,
  p.title,
  p.client_name,
  p.contract_number,
  p.factory,
  p.address,
  p.project_code,
  p.document_type,
  p.status,
  p.current_html_id,
  p.created_at,
  p.updated_at,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'position', e.position,
          'name', e.name,
          'subtitle', e.subtitle,
          'layout', coalesce(e.data->>'layout', 'balanced'),
          'legacy', jsonb_build_object(
            'colors', e.colors,
            'tamponamentos', e.tamponamentos,
            'portas', e.portas,
            'puxadores', e.puxadores,
            'corredicas', e.corredicas,
            'notes', e.notes,
            'freeNote', e.free_note
          ),
          'photos', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', ph.id,
                'position', ph.position,
                'title', ph.title,
                'caption', ph.caption,
                'layoutKey', ph.layout_key,
                'imageUrl', ph.image_url,
                'storageBucket', ph.storage_bucket,
                'storagePath', ph.storage_path,
                'altText', ph.alt_text,
                'width', ph.width,
                'height', ph.height,
                'mimeType', ph.mime_type,
                'fileSize', ph.file_size
              )
              order by ph.position
            )
            from public.environment_photos ph
            where ph.environment_id = e.id
          ), '[]'::jsonb),
          'colors', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', ec.id,
                'name', ec.name,
                'hex', ec.hex,
                'position', ec.position
              )
              order by ec.position
            )
            from public.environment_colors ec
            where ec.environment_id = e.id
          ), '[]'::jsonb),
          'materials', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', em.id,
                'groupKey', em.group_key,
                'label', em.label,
                'value', em.value,
                'position', em.position,
                'data', em.data
              )
              order by em.position
            )
            from public.environment_materials em
            where em.environment_id = e.id
          ), '[]'::jsonb),
          'notes', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', en.id,
                'type', en.note_type,
                'body', en.body,
                'position', en.position,
                'showOnHtml', en.show_on_html
              )
              order by en.position
            )
            from public.environment_notes en
            where en.environment_id = e.id
          ), '[]'::jsonb),
          'pages', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', ep.id,
                'position', ep.position,
                'title', ep.title,
                'description', ep.description,
                'imageUrl', ep.image_url,
                'imageData', ep.image_data,
                'data', ep.data
              )
              order by ep.position
            )
            from public.environment_pages ep
            where ep.environment_id = e.id
          ), '[]'::jsonb)
        )
        order by e.position
      )
      from public.document_environments e
      where e.project_id = p.id
    ),
    '[]'::jsonb
  ) as environments
from public.document_projects p;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('dcoratto-photos', 'dcoratto-photos', true, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v']),
  ('dcoratto-html', 'dcoratto-html', true, 10485760, array['text/html'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- O upload assinado de arquivos da biblioteca usa o bucket knowledge-assets.
-- Ele pode ser criado por outro modulo; por isso apenas atualizamos quando existir,
-- sem alterar visibilidade, policies ou demais configuracoes do bucket.
do $$
declare
  current_allowed_mime_types text[];
begin
  select allowed_mime_types
    into current_allowed_mime_types
  from storage.buckets
  where id = 'knowledge-assets'
  for update;

  if found then
    update storage.buckets
    set
      file_size_limit = 52428800,
      allowed_mime_types = case
        when current_allowed_mime_types is null then null
        else (
          select array_agg(distinct mime_type)
          from unnest(
            current_allowed_mime_types || array[
              'video/mp4',
              'video/webm',
              'video/quicktime',
              'video/x-m4v'
            ]::text[]
          ) as allowed(mime_type)
        )
      end
    where id = 'knowledge-assets';
  end if;
end
$$;

alter table public.app_users enable row level security;

drop policy if exists "Service role app users" on public.app_users;
create policy "Service role app users" on public.app_users
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "Public read dcoratto storage" on storage.objects;
create policy "Public read dcoratto storage" on storage.objects
for select using (bucket_id in ('dcoratto-photos', 'dcoratto-html'));

drop policy if exists "Public write dcoratto storage" on storage.objects;
create policy "Public write dcoratto storage" on storage.objects
for all using (bucket_id in ('dcoratto-photos', 'dcoratto-html'))
with check (bucket_id in ('dcoratto-photos', 'dcoratto-html'));

-- Harden production access: the React login uses Supabase Auth when configured.
-- Keep storage reads public so previously shared client HTML links remain accessible.
drop policy if exists "Public read projects" on public.document_projects;
drop policy if exists "Public write projects" on public.document_projects;
drop policy if exists "Authenticated read projects" on public.document_projects;
create policy "Authenticated read projects" on public.document_projects for select using (auth.role() = 'authenticated');
drop policy if exists "Authenticated write projects" on public.document_projects;
create policy "Authenticated write projects" on public.document_projects for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "Public read environments" on public.document_environments;
drop policy if exists "Public write environments" on public.document_environments;
drop policy if exists "Authenticated read environments" on public.document_environments;
create policy "Authenticated read environments" on public.document_environments for select using (auth.role() = 'authenticated');
drop policy if exists "Authenticated write environments" on public.document_environments;
create policy "Authenticated write environments" on public.document_environments for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "Public read environment photos" on public.environment_photos;
drop policy if exists "Public write environment photos" on public.environment_photos;
drop policy if exists "Authenticated read environment photos" on public.environment_photos;
create policy "Authenticated read environment photos" on public.environment_photos for select using (auth.role() = 'authenticated');
drop policy if exists "Authenticated write environment photos" on public.environment_photos;
create policy "Authenticated write environment photos" on public.environment_photos for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "Public read environment colors" on public.environment_colors;
drop policy if exists "Public write environment colors" on public.environment_colors;
drop policy if exists "Authenticated read environment colors" on public.environment_colors;
create policy "Authenticated read environment colors" on public.environment_colors for select using (auth.role() = 'authenticated');
drop policy if exists "Authenticated write environment colors" on public.environment_colors;
create policy "Authenticated write environment colors" on public.environment_colors for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "Public read environment materials" on public.environment_materials;
drop policy if exists "Public write environment materials" on public.environment_materials;
drop policy if exists "Authenticated read environment materials" on public.environment_materials;
create policy "Authenticated read environment materials" on public.environment_materials for select using (auth.role() = 'authenticated');
drop policy if exists "Authenticated write environment materials" on public.environment_materials;
create policy "Authenticated write environment materials" on public.environment_materials for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "Public read environment notes" on public.environment_notes;
drop policy if exists "Public write environment notes" on public.environment_notes;
drop policy if exists "Authenticated read environment notes" on public.environment_notes;
create policy "Authenticated read environment notes" on public.environment_notes for select using (auth.role() = 'authenticated');
drop policy if exists "Authenticated write environment notes" on public.environment_notes;
create policy "Authenticated write environment notes" on public.environment_notes for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "Public read colors" on public.catalog_colors;
drop policy if exists "Authenticated read colors" on public.catalog_colors;
create policy "Authenticated read colors" on public.catalog_colors for select using (auth.role() = 'authenticated');

drop policy if exists "Public read options" on public.catalog_options;
drop policy if exists "Authenticated read options" on public.catalog_options;
create policy "Authenticated read options" on public.catalog_options for select using (auth.role() = 'authenticated');

drop policy if exists "Public read materials" on public.catalog_materials;
drop policy if exists "Authenticated read materials" on public.catalog_materials;
create policy "Authenticated read materials" on public.catalog_materials for select using (auth.role() = 'authenticated');

drop policy if exists "Public read html versions" on public.document_html_versions;
drop policy if exists "Public write html versions" on public.document_html_versions;
drop policy if exists "Authenticated read html versions" on public.document_html_versions;
create policy "Authenticated read html versions" on public.document_html_versions for select using (auth.role() = 'authenticated');
drop policy if exists "Authenticated write html versions" on public.document_html_versions;
create policy "Authenticated write html versions" on public.document_html_versions for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "Public write versions" on public.document_versions;
drop policy if exists "Authenticated read versions" on public.document_versions;
create policy "Authenticated read versions" on public.document_versions for select using (auth.role() = 'authenticated');
drop policy if exists "Authenticated write versions" on public.document_versions;
create policy "Authenticated write versions" on public.document_versions for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated read audit logs" on public.editor_audit_logs;
create policy "Authenticated read audit logs" on public.editor_audit_logs for select using (auth.role() = 'authenticated');
drop policy if exists "Authenticated write audit logs" on public.editor_audit_logs;
create policy "Authenticated write audit logs" on public.editor_audit_logs for insert with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated read editor settings" on public.editor_settings;
create policy "Authenticated read editor settings" on public.editor_settings for select using (auth.role() = 'authenticated');
drop policy if exists "Authenticated write editor settings" on public.editor_settings;
create policy "Authenticated write editor settings" on public.editor_settings for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated read environment pages" on public.environment_pages;
create policy "Authenticated read environment pages" on public.environment_pages for select using (auth.role() = 'authenticated');
drop policy if exists "Authenticated write environment pages" on public.environment_pages;
create policy "Authenticated write environment pages" on public.environment_pages for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "Public write dcoratto storage" on storage.objects;
drop policy if exists "Authenticated write dcoratto storage" on storage.objects;
create policy "Authenticated write dcoratto storage" on storage.objects
for all using (bucket_id in ('dcoratto-photos', 'dcoratto-html') and auth.role() = 'authenticated')
with check (bucket_id in ('dcoratto-photos', 'dcoratto-html') and auth.role() = 'authenticated');

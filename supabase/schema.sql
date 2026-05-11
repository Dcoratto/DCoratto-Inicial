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

create table if not exists public.catalog_materials (
  id uuid primary key default gen_random_uuid(),
  group_key text not null,
  name text not null,
  code text,
  brand text,
  hex text,
  texture_url text,
  sort_order integer not null default 0,
  active boolean not null default true,
  data jsonb not null default '{}'::jsonb,
  unique (group_key, name)
);

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

create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.document_projects(id) on delete cascade,
  snapshot jsonb not null,
  reason text not null default 'autosave',
  created_at timestamptz not null default now()
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
create index if not exists environment_photos_environment_idx on public.environment_photos(environment_id, position);
create index if not exists environment_photos_project_idx on public.environment_photos(project_id, position);
create index if not exists environment_colors_environment_idx on public.environment_colors(environment_id, position);
create index if not exists environment_materials_environment_idx on public.environment_materials(environment_id, group_key, position);
create index if not exists environment_notes_environment_idx on public.environment_notes(environment_id, note_type, position);
create index if not exists document_html_versions_project_idx on public.document_html_versions(project_id, created_at desc);
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

drop trigger if exists set_environment_photos_updated_at on public.environment_photos;
create trigger set_environment_photos_updated_at
before update on public.environment_photos
for each row execute function public.set_updated_at();

drop trigger if exists set_environment_materials_updated_at on public.environment_materials;
create trigger set_environment_materials_updated_at
before update on public.environment_materials
for each row execute function public.set_updated_at();

drop trigger if exists set_environment_notes_updated_at on public.environment_notes;
create trigger set_environment_notes_updated_at
before update on public.environment_notes
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
alter table public.catalog_colors enable row level security;
alter table public.catalog_options enable row level security;
alter table public.catalog_materials enable row level security;
alter table public.document_html_versions enable row level security;
alter table public.document_versions enable row level security;

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
  ('dcoratto-photos', 'dcoratto-photos', true, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('dcoratto-html', 'dcoratto-html', true, 10485760, array['text/html'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public read dcoratto storage" on storage.objects;
create policy "Public read dcoratto storage" on storage.objects
for select using (bucket_id in ('dcoratto-photos', 'dcoratto-html'));

drop policy if exists "Public write dcoratto storage" on storage.objects;
create policy "Public write dcoratto storage" on storage.objects
for all using (bucket_id in ('dcoratto-photos', 'dcoratto-html'))
with check (bucket_id in ('dcoratto-photos', 'dcoratto-html'));

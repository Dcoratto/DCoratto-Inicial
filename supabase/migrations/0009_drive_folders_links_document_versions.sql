alter table public.categories
  add column if not exists archived_at timestamptz null,
  add column if not exists deleted_at timestamptz null;

alter table public.documents
  add column if not exists is_active boolean not null default true,
  add column if not exists inactivated_at timestamptz null,
  add column if not exists inactivated_by uuid null references auth.users(id) on delete set null,
  add column if not exists replaced_by_document_id uuid null references public.documents(id) on delete set null,
  add column if not exists deleted_at timestamptz null,
  add column if not exists deleted_by uuid null references auth.users(id) on delete set null;

create index if not exists categories_deleted_active_idx
  on public.categories(deleted_at, is_active);
create index if not exists documents_category_active_idx
  on public.documents(category_id, status, is_active)
  where deleted_at is null;

create table if not exists public.folder_links (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  title text not null,
  url text not null,
  description text null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null,
  archived_at timestamptz null,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists folder_links_category_idx
  on public.folder_links(category_id, sort_order, title)
  where deleted_at is null;
create index if not exists folder_links_active_idx
  on public.folder_links(is_active)
  where deleted_at is null;

drop trigger if exists set_folder_links_updated_at on public.folder_links;
create trigger set_folder_links_updated_at
before update on public.folder_links
for each row execute function public.set_updated_at();

alter table public.folder_links enable row level security;

create table if not exists public.document_file_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  version_number int not null,
  attachment_id uuid null references public.attachments(id) on delete set null,
  storage_path text not null,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  checksum text null,
  notes text null,
  is_current boolean not null default false,
  is_active boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(document_id, version_number)
);

create index if not exists document_file_versions_document_idx
  on public.document_file_versions(document_id, version_number desc);
create index if not exists document_file_versions_document_current_idx
  on public.document_file_versions(document_id, is_current)
  where is_active = true;
create unique index if not exists document_file_versions_one_current_idx
  on public.document_file_versions(document_id)
  where is_current = true and is_active = true;

alter table public.document_file_versions enable row level security;

create or replace function public.can_read_folder_link(p_link_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_admin(), false)
    or exists (
      select 1
      from public.folder_links fl
      where fl.id = p_link_id
        and fl.is_active = true
        and fl.deleted_at is null
        and public.can_read_category(fl.category_id)
    );
$$;

create or replace function public.can_read_category(p_category_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with recursive ancestors as (
    select c.id, c.parent_id, c.is_active, c.access_scope, c.deleted_at
    from public.categories c
    where c.id = p_category_id

    union all

    select parent.id, parent.parent_id, parent.is_active, parent.access_scope, parent.deleted_at
    from public.categories parent
    join ancestors on ancestors.parent_id = parent.id
  ),
  allowed as (
    select public.current_user_department_category_id() as category_id
    union
    select ufp.category_id
    from public.user_folder_permissions ufp
    where ufp.user_id = auth.uid()
  )
  select coalesce(public.is_admin(), false)
    or exists (
      select 1
      from public.categories c
      where c.id = p_category_id
        and c.is_active = true
        and c.deleted_at is null
        and not exists (select 1 from ancestors a where a.deleted_at is not null or a.is_active = false)
        and (
          c.access_scope = 'global'
          or exists (select 1 from ancestors a where a.access_scope = 'global')
          or exists (
            select 1
            from ancestors a
            join allowed on allowed.category_id = a.id
            where allowed.category_id is not null
          )
        )
    );
$$;

create or replace function public.can_read_document_version(p_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_admin(), false)
    or exists (
      select 1
      from public.document_file_versions dfv
      where dfv.id = p_version_id
        and dfv.is_current = true
        and dfv.is_active = true
        and public.can_read_document(dfv.document_id)
    );
$$;

create or replace function public.can_read_document(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_admin(), false)
    or exists (
      select 1
      from public.documents d
      where d.id = p_document_id
        and d.status = 'published'
        and coalesce(d.is_active, true) = true
        and d.deleted_at is null
        and (
          d.category_id is null
          or public.can_read_category(d.category_id)
        )
    );
$$;

drop policy if exists folder_links_select_readable on public.folder_links;
create policy folder_links_select_readable on public.folder_links
  for select to authenticated
  using (public.is_admin() or public.can_read_folder_link(id));

drop policy if exists folder_links_admin_insert on public.folder_links;
create policy folder_links_admin_insert on public.folder_links
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists folder_links_admin_update on public.folder_links;
create policy folder_links_admin_update on public.folder_links
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists document_file_versions_select_readable on public.document_file_versions;
create policy document_file_versions_select_readable on public.document_file_versions
  for select to authenticated
  using (public.is_admin() or public.can_read_document_version(id));

drop policy if exists document_file_versions_admin_insert on public.document_file_versions;
create policy document_file_versions_admin_insert on public.document_file_versions
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists document_file_versions_admin_update on public.document_file_versions;
create policy document_file_versions_admin_update on public.document_file_versions
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant execute on function public.can_read_folder_link(uuid) to authenticated;
grant execute on function public.can_read_document_version(uuid) to authenticated;
grant execute on function public.can_read_category(uuid) to authenticated;

create or replace function public.set_current_document_file_version(
  p_version_id uuid,
  p_actor_id uuid default auth.uid()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document_id uuid;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'admin required';
  end if;

  select document_id
  into v_document_id
  from public.document_file_versions
  where id = p_version_id
    and is_active = true;

  if v_document_id is null then
    raise exception 'version not found';
  end if;

  update public.document_file_versions
  set is_current = false
  where document_id = v_document_id
    and id <> p_version_id;

  update public.document_file_versions
  set is_current = true
  where id = p_version_id;

  update public.documents
  set updated_by = p_actor_id,
      updated_at = now()
  where id = v_document_id;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (
    p_actor_id,
    'document.version_set_current',
    'document_file_version',
    p_version_id,
    jsonb_build_object('documentId', v_document_id)
  );

  return p_version_id;
end;
$$;

grant execute on function public.set_current_document_file_version(uuid, uuid) to authenticated;

do $$
declare
  r record;
begin
  for r in
    select conrelid::regclass as table_name, conname
    from pg_constraint
    where contype = 'c'
      and conrelid in (
        'public.content_view_events'::regclass,
        'public.content_audience_receipts'::regclass
      )
      and pg_get_constraintdef(oid) like '%content_type%'
  loop
    execute format('alter table %s drop constraint if exists %I', r.table_name, r.conname);
  end loop;
end $$;

alter table public.content_view_events
  add constraint content_view_events_content_type_check
  check (content_type in ('document', 'announcement', 'popup', 'banner', 'onboarding', 'folder_link', 'attachment', 'document_version'));

alter table public.content_audience_receipts
  add constraint content_audience_receipts_content_type_check
  check (content_type in ('document', 'announcement', 'popup', 'banner', 'onboarding', 'folder_link', 'attachment', 'document_version'));

insert into public.document_file_versions (
  document_id,
  version_number,
  attachment_id,
  storage_path,
  original_name,
  mime_type,
  size_bytes,
  is_current,
  is_active,
  created_by,
  created_at
)
select distinct on (a.document_id)
  a.document_id,
  1,
  a.id,
  a.storage_path,
  a.original_name,
  a.mime_type,
  a.size_bytes,
  true,
  true,
  a.uploaded_by,
  a.created_at
from public.attachments a
where a.document_id is not null
  and not exists (
    select 1
    from public.document_file_versions existing
    where existing.document_id = a.document_id
  )
order by a.document_id, a.created_at desc
on conflict do nothing;

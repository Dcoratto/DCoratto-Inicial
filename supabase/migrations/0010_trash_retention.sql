alter table public.categories
  add column if not exists deleted_by uuid null references auth.users(id) on delete set null,
  add column if not exists trash_expires_at timestamptz null,
  add column if not exists delete_reason text null,
  add column if not exists restored_at timestamptz null,
  add column if not exists restored_by uuid null references auth.users(id) on delete set null;

alter table public.documents
  add column if not exists trash_expires_at timestamptz null,
  add column if not exists delete_reason text null,
  add column if not exists restored_at timestamptz null,
  add column if not exists restored_by uuid null references auth.users(id) on delete set null;

alter table public.folder_links
  add column if not exists deleted_by uuid null references auth.users(id) on delete set null,
  add column if not exists trash_expires_at timestamptz null,
  add column if not exists delete_reason text null,
  add column if not exists restored_at timestamptz null,
  add column if not exists restored_by uuid null references auth.users(id) on delete set null;

alter table public.attachments
  add column if not exists deleted_at timestamptz null,
  add column if not exists deleted_by uuid null references auth.users(id) on delete set null,
  add column if not exists trash_expires_at timestamptz null,
  add column if not exists delete_reason text null,
  add column if not exists restored_at timestamptz null,
  add column if not exists restored_by uuid null references auth.users(id) on delete set null;

alter table public.document_file_versions
  add column if not exists deleted_at timestamptz null,
  add column if not exists deleted_by uuid null references auth.users(id) on delete set null,
  add column if not exists trash_expires_at timestamptz null,
  add column if not exists delete_reason text null,
  add column if not exists restored_at timestamptz null,
  add column if not exists restored_by uuid null references auth.users(id) on delete set null;

create index if not exists categories_trash_idx on public.categories(deleted_at, trash_expires_at) where deleted_at is not null;
create index if not exists documents_trash_idx on public.documents(deleted_at, trash_expires_at) where deleted_at is not null;
create index if not exists folder_links_trash_idx on public.folder_links(deleted_at, trash_expires_at) where deleted_at is not null;
create index if not exists attachments_trash_idx on public.attachments(deleted_at, trash_expires_at) where deleted_at is not null;
create index if not exists document_file_versions_trash_idx on public.document_file_versions(deleted_at, trash_expires_at) where deleted_at is not null;

update public.categories
set trash_expires_at = deleted_at + interval '30 days'
where deleted_at is not null and trash_expires_at is null;

update public.documents
set trash_expires_at = deleted_at + interval '30 days'
where deleted_at is not null and trash_expires_at is null;

update public.folder_links
set trash_expires_at = deleted_at + interval '30 days'
where deleted_at is not null and trash_expires_at is null;

update public.attachments
set trash_expires_at = deleted_at + interval '30 days'
where deleted_at is not null and trash_expires_at is null;

update public.document_file_versions
set trash_expires_at = deleted_at + interval '30 days'
where deleted_at is not null and trash_expires_at is null;

create or replace function public.trash_expiration_from(p_deleted_at timestamptz)
returns timestamptz
language sql
stable
as $$
  select coalesce(p_deleted_at, now()) + interval '30 days';
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
        and dfv.deleted_at is null
        and public.can_read_document(dfv.document_id)
    );
$$;

drop policy if exists attachments_select_readable on public.attachments;
create policy attachments_select_readable on public.attachments
  for select to authenticated
  using (public.is_admin() or (deleted_at is null and document_id is not null and public.can_read_document(document_id)));

drop policy if exists document_file_versions_select_readable on public.document_file_versions;
create policy document_file_versions_select_readable on public.document_file_versions
  for select to authenticated
  using (public.is_admin() or public.can_read_document_version(id));

grant execute on function public.trash_expiration_from(timestamptz) to authenticated;
grant execute on function public.can_read_category(uuid) to authenticated;
grant execute on function public.can_read_document(uuid) to authenticated;
grant execute on function public.can_read_folder_link(uuid) to authenticated;
grant execute on function public.can_read_document_version(uuid) to authenticated;

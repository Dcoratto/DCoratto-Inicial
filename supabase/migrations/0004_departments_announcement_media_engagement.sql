alter table public.announcements
  add column if not exists popup_media_storage_path text,
  add column if not exists popup_media_original_name text,
  add column if not exists popup_media_mime_type text,
  add column if not exists popup_media_size_bytes bigint,
  add column if not exists popup_media_width int,
  add column if not exists popup_media_height int,
  add column if not exists popup_media_duration_seconds int,
  add column if not exists banner_image_storage_path text,
  add column if not exists banner_image_original_name text,
  add column if not exists banner_image_mime_type text,
  add column if not exists banner_image_size_bytes bigint,
  add column if not exists banner_image_width int,
  add column if not exists banner_image_height int;

create table if not exists public.departments (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists department_id uuid references public.departments(id) on delete set null;

alter table public.categories
  add column if not exists department_id uuid references public.departments(id) on delete set null;

create index if not exists departments_slug_idx on public.departments(slug);
create index if not exists departments_active_order_idx on public.departments(is_active, sort_order, name);
create index if not exists profiles_department_id_idx on public.profiles(department_id);
create index if not exists categories_department_id_idx on public.categories(department_id);

drop trigger if exists set_departments_updated_at on public.departments;
create trigger set_departments_updated_at
before update on public.departments
for each row execute function public.set_updated_at();

insert into public.departments (name, slug)
select distinct
  trim(p.department) as name,
  trim(both '-' from regexp_replace(lower(trim(p.department)), '[^a-z0-9]+', '-', 'g')) as slug
from public.profiles p
where p.department is not null
  and trim(p.department) <> ''
  and trim(both '-' from regexp_replace(lower(trim(p.department)), '[^a-z0-9]+', '-', 'g')) <> ''
on conflict (slug) do nothing;

update public.profiles p
set department_id = d.id
from public.departments d
where p.department_id is null
  and p.department is not null
  and trim(p.department) <> ''
  and d.slug = trim(both '-' from regexp_replace(lower(trim(p.department)), '[^a-z0-9]+', '-', 'g'));

create or replace function public.current_user_department_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select department_id
  from public.profiles
  where id = auth.uid()
  limit 1;
$$;

create or replace function public.can_read_category(p_category_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_admin(), false)
    or exists (
      select 1
      from public.categories c
      where c.id = p_category_id
        and c.is_active = true
        and (
          c.department_id is null
          or c.department_id = public.current_user_department_id()
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
      left join public.categories c on c.id = d.category_id
      where d.id = p_document_id
        and d.status = 'published'
        and (
          d.category_id is null
          or (
            c.is_active = true
            and (
              c.department_id is null
              or c.department_id = public.current_user_department_id()
            )
          )
        )
    );
$$;

grant execute on function public.current_user_department_id() to authenticated;
grant execute on function public.can_read_category(uuid) to authenticated;
grant execute on function public.can_read_document(uuid) to authenticated;

alter table public.departments enable row level security;

drop policy if exists departments_select_allowed on public.departments;
create policy departments_select_allowed on public.departments
  for select to authenticated
  using (public.is_admin() or (is_active = true and id = public.current_user_department_id()));

drop policy if exists departments_admin_insert on public.departments;
create policy departments_admin_insert on public.departments
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists departments_admin_update on public.departments;
create policy departments_admin_update on public.departments
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists departments_admin_delete on public.departments;
create policy departments_admin_delete on public.departments
  for delete to authenticated
  using (public.is_admin());

drop policy if exists categories_select_active_or_admin on public.categories;
drop policy if exists categories_select_allowed_department_or_admin on public.categories;
create policy categories_select_allowed_department_or_admin on public.categories
  for select to authenticated
  using (public.is_admin() or public.can_read_category(id));

drop policy if exists categories_admin_delete on public.categories;
create policy categories_admin_delete on public.categories
  for delete to authenticated
  using (public.is_admin());

drop policy if exists documents_select_published_or_admin on public.documents;
drop policy if exists documents_select_allowed_department_or_admin on public.documents;
create policy documents_select_allowed_department_or_admin on public.documents
  for select to authenticated
  using (public.is_admin() or public.can_read_document(id));

drop policy if exists document_versions_select_readable on public.document_versions;
create policy document_versions_select_readable on public.document_versions
  for select to authenticated
  using (public.is_admin() or public.can_read_document(document_id));

drop policy if exists attachments_select_readable on public.attachments;
create policy attachments_select_readable on public.attachments
  for select to authenticated
  using (public.is_admin() or (document_id is not null and public.can_read_document(document_id)));

create table if not exists public.content_view_events (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_type text not null check (content_type in ('document', 'announcement', 'popup', 'banner', 'onboarding')),
  content_id uuid not null,
  category_id uuid references public.categories(id) on delete set null,
  department_id uuid references public.departments(id) on delete set null,
  event_type text not null check (event_type in ('open', 'heartbeat', 'close', 'manual_viewed', 'auto_viewed', 'admin_marked_viewed')),
  active_seconds int not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.content_view_rollups (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_type text not null,
  content_id uuid not null,
  category_id uuid references public.categories(id) on delete set null,
  department_id uuid references public.departments(id) on delete set null,
  open_count int not null default 0,
  total_active_seconds int not null default 0,
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  is_viewed boolean not null default false,
  viewed_at timestamptz,
  viewed_source text check (viewed_source in ('manual', 'auto', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, content_type, content_id)
);

create index if not exists content_view_events_user_created_idx on public.content_view_events(user_id, created_at desc);
create index if not exists content_view_events_content_created_idx on public.content_view_events(content_type, content_id, created_at desc);
create index if not exists content_view_events_department_created_idx on public.content_view_events(department_id, created_at desc);
create index if not exists content_view_rollups_user_idx on public.content_view_rollups(user_id);
create index if not exists content_view_rollups_content_idx on public.content_view_rollups(content_type, content_id);
create index if not exists content_view_rollups_department_idx on public.content_view_rollups(department_id);
create index if not exists content_view_rollups_is_viewed_idx on public.content_view_rollups(is_viewed);
create index if not exists content_view_rollups_updated_idx on public.content_view_rollups(updated_at desc);

drop trigger if exists set_content_view_rollups_updated_at on public.content_view_rollups;
create trigger set_content_view_rollups_updated_at
before update on public.content_view_rollups
for each row execute function public.set_updated_at();

alter table public.content_view_events enable row level security;
alter table public.content_view_rollups enable row level security;

drop policy if exists content_view_events_admin_select on public.content_view_events;
create policy content_view_events_admin_select on public.content_view_events
  for select to authenticated
  using (public.is_admin());

drop policy if exists content_view_events_insert_own on public.content_view_events;
create policy content_view_events_insert_own on public.content_view_events
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists content_view_rollups_select_own_or_admin on public.content_view_rollups;
create policy content_view_rollups_select_own_or_admin on public.content_view_rollups
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists content_view_rollups_admin_update on public.content_view_rollups;
create policy content_view_rollups_admin_update on public.content_view_rollups
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create or replace function public.record_content_view_event(
  p_content_type text,
  p_content_id uuid,
  p_event_type text,
  p_active_seconds int default 0,
  p_category_id uuid default null,
  p_department_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_target_user uuid := coalesce(p_user_id, auth.uid());
  v_event_id uuid;
  v_seconds int := greatest(0, least(coalesce(p_active_seconds, 0), 60));
  v_is_admin boolean := coalesce(public.is_admin(), false);
  v_viewed_source text := null;
  v_mark_viewed boolean := false;
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;

  if p_event_type = 'admin_marked_viewed' and not v_is_admin then
    raise exception 'admin required';
  end if;

  if p_event_type <> 'admin_marked_viewed' and v_target_user <> v_actor then
    raise exception 'cannot record another user';
  end if;

  if p_event_type in ('manual_viewed', 'auto_viewed', 'admin_marked_viewed') then
    v_mark_viewed := true;
    v_viewed_source := case
      when p_event_type = 'admin_marked_viewed' then 'admin'
      when p_event_type = 'auto_viewed' then 'auto'
      else 'manual'
    end;
  end if;

  insert into public.content_view_events (
    user_id,
    content_type,
    content_id,
    category_id,
    department_id,
    event_type,
    active_seconds,
    metadata
  )
  values (
    v_target_user,
    p_content_type,
    p_content_id,
    p_category_id,
    coalesce(p_department_id, public.current_user_department_id()),
    p_event_type,
    v_seconds,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_event_id;

  insert into public.content_view_rollups (
    user_id,
    content_type,
    content_id,
    category_id,
    department_id,
    open_count,
    total_active_seconds,
    first_opened_at,
    last_opened_at,
    is_viewed,
    viewed_at,
    viewed_source
  )
  values (
    v_target_user,
    p_content_type,
    p_content_id,
    p_category_id,
    coalesce(p_department_id, public.current_user_department_id()),
    case when p_event_type = 'open' then 1 else 0 end,
    case when p_event_type = 'heartbeat' then v_seconds else 0 end,
    case when p_event_type = 'open' then now() else null end,
    case when p_event_type = 'open' then now() else null end,
    v_mark_viewed,
    case when v_mark_viewed then now() else null end,
    v_viewed_source
  )
  on conflict (user_id, content_type, content_id)
  do update set
    category_id = coalesce(excluded.category_id, public.content_view_rollups.category_id),
    department_id = coalesce(excluded.department_id, public.content_view_rollups.department_id),
    open_count = public.content_view_rollups.open_count + case when p_event_type = 'open' then 1 else 0 end,
    total_active_seconds = public.content_view_rollups.total_active_seconds + case when p_event_type = 'heartbeat' then v_seconds else 0 end,
    first_opened_at = coalesce(public.content_view_rollups.first_opened_at, excluded.first_opened_at),
    last_opened_at = case when p_event_type = 'open' then now() else public.content_view_rollups.last_opened_at end,
    is_viewed = public.content_view_rollups.is_viewed or v_mark_viewed,
    viewed_at = case
      when v_mark_viewed and public.content_view_rollups.viewed_at is null then now()
      else public.content_view_rollups.viewed_at
    end,
    viewed_source = case
      when v_mark_viewed and public.content_view_rollups.viewed_source is null then v_viewed_source
      else public.content_view_rollups.viewed_source
    end,
    updated_at = now();

  return v_event_id;
end;
$$;

grant execute on function public.record_content_view_event(text, uuid, text, int, uuid, uuid, jsonb, uuid) to authenticated;

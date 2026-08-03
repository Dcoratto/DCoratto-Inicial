alter table public.categories
  add column if not exists is_department boolean not null default true,
  add column if not exists access_scope text not null default 'department';

alter table public.categories
  drop constraint if exists categories_access_scope_check;

alter table public.categories
  add constraint categories_access_scope_check
  check (access_scope in ('department', 'global'));

alter table public.profiles
  add column if not exists department_category_id uuid references public.categories(id) on delete set null;

alter table public.content_view_events
  add column if not exists department_category_id uuid references public.categories(id) on delete set null;

alter table public.content_view_rollups
  add column if not exists department_category_id uuid references public.categories(id) on delete set null;

create index if not exists profiles_department_category_id_idx on public.profiles(department_category_id);
create index if not exists categories_access_scope_idx on public.categories(access_scope);
create index if not exists content_view_events_department_category_created_idx
  on public.content_view_events(department_category_id, created_at desc);
create index if not exists content_view_rollups_department_category_idx
  on public.content_view_rollups(department_category_id);

insert into public.categories (name, slug, description, sort_order, is_active, is_department, access_scope)
select d.name, d.slug, d.description, d.sort_order, d.is_active, true, 'department'
from public.departments d
where not exists (
  select 1
  from public.categories c
  where c.slug = d.slug
)
on conflict (slug) do nothing;

update public.profiles p
set department_category_id = c.id
from public.categories c
where p.department_category_id is null
  and p.department is not null
  and trim(p.department) <> ''
  and (
    lower(c.name) = lower(trim(p.department))
    or c.slug = trim(both '-' from regexp_replace(lower(trim(p.department)), '[^a-z0-9]+', '-', 'g'))
  );

update public.profiles p
set department_category_id = c.id
from public.departments d
join public.categories c on c.slug = d.slug
where p.department_category_id is null
  and p.department_id = d.id;

create table if not exists public.announcement_target_categories (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (announcement_id, category_id)
);

create index if not exists announcement_target_categories_category_idx
  on public.announcement_target_categories(category_id);

alter table public.announcement_target_categories enable row level security;

drop policy if exists announcement_target_categories_select_readable on public.announcement_target_categories;
create policy announcement_target_categories_select_readable on public.announcement_target_categories
  for select to authenticated
  using (public.is_admin() or public.can_read_category(category_id));

drop policy if exists announcement_target_categories_admin_insert on public.announcement_target_categories;
create policy announcement_target_categories_admin_insert on public.announcement_target_categories
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists announcement_target_categories_admin_delete on public.announcement_target_categories;
create policy announcement_target_categories_admin_delete on public.announcement_target_categories
  for delete to authenticated
  using (public.is_admin());

create or replace function public.current_user_department_category_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    p.department_category_id,
    (
      select c.id
      from public.departments d
      join public.categories c on c.slug = d.slug
      where d.id = p.department_id
      limit 1
    ),
    (
      select c.id
      from public.categories c
      where p.department is not null
        and trim(p.department) <> ''
        and (
          lower(c.name) = lower(trim(p.department))
          or c.slug = trim(both '-' from regexp_replace(lower(trim(p.department)), '[^a-z0-9]+', '-', 'g'))
        )
      limit 1
    )
  )
  from public.profiles p
  where p.id = auth.uid()
  limit 1;
$$;

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

create or replace function public.department_category_for_category(p_category_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  with recursive ancestors as (
    select c.id, c.parent_id, c.access_scope, 0 as depth
    from public.categories c
    where c.id = p_category_id

    union all

    select parent.id, parent.parent_id, parent.access_scope, ancestors.depth + 1
    from public.categories parent
    join ancestors on ancestors.parent_id = parent.id
  )
  select id
  from ancestors
  where coalesce(access_scope, 'department') = 'department'
  order by depth desc
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
      with recursive ancestors as (
        select c.id, c.parent_id, c.is_active, c.access_scope
        from public.categories c
        where c.id = p_category_id

        union all

        select parent.id, parent.parent_id, parent.is_active, parent.access_scope
        from public.categories parent
        join ancestors on ancestors.parent_id = parent.id
      )
      select 1
      from public.categories c
      where c.id = p_category_id
        and c.is_active = true
        and (
          c.access_scope = 'global'
          or exists (
            select 1
            from ancestors a
            where a.id = public.current_user_department_category_id()
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
        and (
          d.category_id is null
          or public.can_read_category(d.category_id)
        )
    );
$$;

create or replace function public.can_read_announcement(p_announcement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_admin(), false)
    or exists (
      select 1
      from public.announcements a
      where a.id = p_announcement_id
        and a.status = 'published'
        and (
          (
            not exists (
              select 1
              from public.announcement_targets at
              where at.announcement_id = a.id
            )
            and not exists (
              select 1
              from public.announcement_target_categories atc
              where atc.announcement_id = a.id
            )
          )
          or exists (
            select 1
            from public.announcement_targets at
            where at.announcement_id = a.id
              and at.user_id = auth.uid()
          )
          or exists (
            select 1
            from public.announcement_target_categories atc
            where atc.announcement_id = a.id
              and public.can_read_category(atc.category_id)
          )
        )
    );
$$;

grant execute on function public.current_user_department_category_id() to authenticated;
grant execute on function public.department_category_for_category(uuid) to authenticated;
grant execute on function public.can_read_category(uuid) to authenticated;
grant execute on function public.can_read_document(uuid) to authenticated;
grant execute on function public.can_read_announcement(uuid) to authenticated;

drop policy if exists categories_select_allowed_department_or_admin on public.categories;
create policy categories_select_allowed_department_or_admin on public.categories
  for select to authenticated
  using (public.is_admin() or public.can_read_category(id));

drop policy if exists documents_select_allowed_department_or_admin on public.documents;
create policy documents_select_allowed_department_or_admin on public.documents
  for select to authenticated
  using (public.is_admin() or public.can_read_document(id));

drop policy if exists announcements_select_targeted_or_admin on public.announcements;
create policy announcements_select_targeted_or_admin on public.announcements
  for select to authenticated
  using (public.can_read_announcement(id));

update public.content_view_events e
set department_category_id = coalesce(public.department_category_for_category(e.category_id), c.id)
from public.departments d
left join public.categories c on c.slug = d.slug
where e.department_category_id is null
  and e.department_id = d.id;

update public.content_view_events
set department_category_id = public.department_category_for_category(category_id)
where department_category_id is null
  and category_id is not null;

update public.content_view_rollups r
set department_category_id = coalesce(public.department_category_for_category(r.category_id), c.id)
from public.departments d
left join public.categories c on c.slug = d.slug
where r.department_category_id is null
  and r.department_id = d.id;

update public.content_view_rollups
set department_category_id = public.department_category_for_category(category_id)
where department_category_id is null
  and category_id is not null;

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
  v_department_category_id uuid;
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

  select coalesce(
    public.department_category_for_category(p_category_id),
    p.department_category_id,
    public.current_user_department_category_id()
  )
  into v_department_category_id
  from public.profiles p
  where p.id = v_target_user
  limit 1;

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
    department_category_id,
    event_type,
    active_seconds,
    metadata
  )
  values (
    v_target_user,
    p_content_type,
    p_content_id,
    p_category_id,
    p_department_id,
    v_department_category_id,
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
    department_category_id,
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
    p_department_id,
    v_department_category_id,
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
    department_category_id = coalesce(excluded.department_category_id, public.content_view_rollups.department_category_id),
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

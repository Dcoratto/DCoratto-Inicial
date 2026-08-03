create table if not exists public.user_folder_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  granted_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, category_id)
);

create index if not exists user_folder_permissions_user_idx
  on public.user_folder_permissions(user_id);
create index if not exists user_folder_permissions_category_idx
  on public.user_folder_permissions(category_id);

alter table public.user_folder_permissions enable row level security;

drop policy if exists user_folder_permissions_admin_all on public.user_folder_permissions;
create policy user_folder_permissions_admin_all on public.user_folder_permissions
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists user_folder_permissions_select_own on public.user_folder_permissions;
create policy user_folder_permissions_select_own on public.user_folder_permissions
  for select to authenticated
  using (user_id = auth.uid());

alter table public.announcements
  add column if not exists popup_active boolean not null default false,
  add column if not exists banner_active boolean not null default false;

create index if not exists announcements_popup_active_idx
  on public.announcements(popup_active, popup_starts_at, popup_ends_at)
  where popup_active = true;
create index if not exists announcements_banner_active_idx
  on public.announcements(banner_active, banner_starts_at, banner_ends_at)
  where banner_active = true;

create table if not exists public.content_audience_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_type text not null check (content_type in ('document', 'announcement', 'popup', 'banner', 'onboarding')),
  content_id uuid not null,
  category_id uuid null references public.categories(id) on delete set null,
  assigned_department_category_id uuid null references public.categories(id) on delete set null,
  assigned_by uuid null references auth.users(id) on delete set null,
  assigned_reason text not null default 'department'
    check (assigned_reason in ('department', 'extra_folder', 'global', 'direct_user', 'admin')),
  required boolean not null default true,
  first_opened_at timestamptz null,
  last_opened_at timestamptz null,
  open_count int not null default 0,
  total_active_seconds int not null default 0,
  is_viewed boolean not null default false,
  viewed_at timestamptz null,
  viewed_source text null check (viewed_source in ('manual', 'auto', 'admin')),
  last_event_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, content_type, content_id)
);

create index if not exists content_audience_receipts_user_idx
  on public.content_audience_receipts(user_id);
create index if not exists content_audience_receipts_content_idx
  on public.content_audience_receipts(content_type, content_id);
create index if not exists content_audience_receipts_department_idx
  on public.content_audience_receipts(assigned_department_category_id);
create index if not exists content_audience_receipts_viewed_idx
  on public.content_audience_receipts(is_viewed);
create index if not exists content_audience_receipts_updated_idx
  on public.content_audience_receipts(updated_at desc);
create index if not exists content_audience_receipts_last_event_idx
  on public.content_audience_receipts(last_event_at desc);

drop trigger if exists set_content_audience_receipts_updated_at on public.content_audience_receipts;
create trigger set_content_audience_receipts_updated_at
before update on public.content_audience_receipts
for each row execute function public.set_updated_at();

alter table public.content_audience_receipts enable row level security;

drop policy if exists content_audience_receipts_select_own_or_admin on public.content_audience_receipts;
create policy content_audience_receipts_select_own_or_admin on public.content_audience_receipts
  for select to authenticated
  using (public.is_admin() or user_id = auth.uid());

drop policy if exists content_audience_receipts_admin_update on public.content_audience_receipts;
create policy content_audience_receipts_admin_update on public.content_audience_receipts
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists content_audience_receipts_insert_own on public.content_audience_receipts;
drop policy if exists content_audience_receipts_admin_insert on public.content_audience_receipts;
create policy content_audience_receipts_admin_insert on public.content_audience_receipts
  for insert to authenticated
  with check (public.is_admin());

alter table public.content_view_events
  add column if not exists view_session_id uuid null;

create index if not exists content_view_events_session_idx
  on public.content_view_events(view_session_id);

create or replace function public.category_is_under(p_category_id uuid, p_allowed_category_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with recursive ancestors as (
    select c.id, c.parent_id
    from public.categories c
    where c.id = p_category_id

    union all

    select parent.id, parent.parent_id
    from public.categories parent
    join ancestors on ancestors.parent_id = parent.id
  )
  select p_allowed_category_id is not null
    and exists (select 1 from ancestors where id = p_allowed_category_id);
$$;

create or replace function public.can_read_category(p_category_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with recursive ancestors as (
    select c.id, c.parent_id, c.is_active, c.access_scope
    from public.categories c
    where c.id = p_category_id

    union all

    select parent.id, parent.parent_id, parent.is_active, parent.access_scope
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

grant execute on function public.category_is_under(uuid, uuid) to authenticated;
grant execute on function public.can_read_category(uuid) to authenticated;
grant execute on function public.can_read_document(uuid) to authenticated;
grant execute on function public.can_read_announcement(uuid) to authenticated;

create or replace function public.create_document_receipts(p_document_id uuid, p_assigned_by uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category_id uuid;
  v_is_global boolean := false;
begin
  if auth.uid() is not null and not coalesce(public.is_admin(), false) then
    raise exception 'admin required';
  end if;

  select d.category_id, coalesce(c.access_scope = 'global', d.category_id is null)
  into v_category_id, v_is_global
  from public.documents d
  left join public.categories c on c.id = d.category_id
  where d.id = p_document_id
    and d.status = 'published';

  if not found then
    return;
  end if;

  insert into public.content_audience_receipts (
    user_id,
    content_type,
    content_id,
    category_id,
    assigned_department_category_id,
    assigned_by,
    assigned_reason
  )
  select
    p.id,
    'document',
    p_document_id,
    v_category_id,
    coalesce(public.department_category_for_category(v_category_id), p.department_category_id),
    p_assigned_by,
    case
      when p.role = 'admin' then 'admin'
      when v_is_global then 'global'
      when public.category_is_under(v_category_id, p.department_category_id) then 'department'
      else 'extra_folder'
    end
  from public.profiles p
  where p.is_active = true
    and (
      p.role = 'admin'
      or v_is_global
      or public.category_is_under(v_category_id, p.department_category_id)
      or exists (
        select 1
        from public.user_folder_permissions ufp
        where ufp.user_id = p.id
          and public.category_is_under(v_category_id, ufp.category_id)
      )
    )
  on conflict (user_id, content_type, content_id)
  do update set
    category_id = coalesce(excluded.category_id, public.content_audience_receipts.category_id),
    assigned_department_category_id = coalesce(
      excluded.assigned_department_category_id,
      public.content_audience_receipts.assigned_department_category_id
    ),
    updated_at = now();
end;
$$;

create or replace function public.create_announcement_receipts(p_announcement_id uuid, p_assigned_by uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_user_targets boolean;
  v_has_category_targets boolean;
  v_has_popup boolean;
  v_has_banner boolean;
begin
  if auth.uid() is not null and not coalesce(public.is_admin(), false) then
    raise exception 'admin required';
  end if;

  select
    exists (select 1 from public.announcement_targets where announcement_id = p_announcement_id),
    exists (select 1 from public.announcement_target_categories where announcement_id = p_announcement_id),
    coalesce(a.popup_enabled, false),
    coalesce(a.banner_enabled, false)
  into v_has_user_targets, v_has_category_targets, v_has_popup, v_has_banner
  from public.announcements a
  where a.id = p_announcement_id
    and a.status = 'published';

  if not found then
    return;
  end if;

  if not v_has_user_targets and not v_has_category_targets then
    insert into public.content_audience_receipts (
      user_id, content_type, content_id, assigned_department_category_id, assigned_by, assigned_reason
    )
    select
      p.id,
      'announcement',
      p_announcement_id,
      p.department_category_id,
      p_assigned_by,
      case when p.role = 'admin' then 'admin' else 'global' end
    from public.profiles p
    where p.is_active = true
    on conflict (user_id, content_type, content_id) do update set updated_at = now();
  end if;

  insert into public.content_audience_receipts (
    user_id, content_type, content_id, assigned_department_category_id, assigned_by, assigned_reason
  )
  select distinct
    p.id,
    'announcement',
    p_announcement_id,
    p.department_category_id,
    p_assigned_by,
    'direct_user'
  from public.announcement_targets at
  join public.profiles p on p.id = at.user_id
  where at.announcement_id = p_announcement_id
    and p.is_active = true
  on conflict (user_id, content_type, content_id) do update set updated_at = now();

  insert into public.content_audience_receipts (
    user_id, content_type, content_id, category_id, assigned_department_category_id, assigned_by, assigned_reason
  )
  select distinct
    p.id,
    'announcement',
    p_announcement_id,
    atc.category_id,
    coalesce(public.department_category_for_category(atc.category_id), p.department_category_id),
    p_assigned_by,
    case
      when p.role = 'admin' then 'admin'
      when public.category_is_under(atc.category_id, p.department_category_id) then 'department'
      else 'extra_folder'
    end
  from public.announcement_target_categories atc
  join public.profiles p on p.is_active = true
  where atc.announcement_id = p_announcement_id
    and (
      p.role = 'admin'
      or public.category_is_under(atc.category_id, p.department_category_id)
      or exists (
        select 1
        from public.user_folder_permissions ufp
        where ufp.user_id = p.id
          and public.category_is_under(atc.category_id, ufp.category_id)
      )
    )
  on conflict (user_id, content_type, content_id) do update set
    category_id = coalesce(excluded.category_id, public.content_audience_receipts.category_id),
    assigned_department_category_id = coalesce(
      excluded.assigned_department_category_id,
      public.content_audience_receipts.assigned_department_category_id
    ),
    updated_at = now();

  insert into public.content_audience_receipts (
    user_id, content_type, content_id, assigned_department_category_id, assigned_by, assigned_reason
  )
  select
    p.id,
    'announcement',
    p_announcement_id,
    p.department_category_id,
    p_assigned_by,
    'admin'
  from public.profiles p
  where p.is_active = true
    and p.role = 'admin'
  on conflict (user_id, content_type, content_id) do update set updated_at = now();

  if v_has_popup then
    insert into public.content_audience_receipts (
      user_id, content_type, content_id, category_id, assigned_department_category_id, assigned_by, assigned_reason
    )
    select user_id, 'popup', content_id, category_id, assigned_department_category_id, assigned_by, assigned_reason
    from public.content_audience_receipts
    where content_type = 'announcement'
      and content_id = p_announcement_id
    on conflict (user_id, content_type, content_id) do update set updated_at = now();
  end if;

  if v_has_banner then
    insert into public.content_audience_receipts (
      user_id, content_type, content_id, category_id, assigned_department_category_id, assigned_by, assigned_reason
    )
    select user_id, 'banner', content_id, category_id, assigned_department_category_id, assigned_by, assigned_reason
    from public.content_audience_receipts
    where content_type = 'announcement'
      and content_id = p_announcement_id
    on conflict (user_id, content_type, content_id) do update set updated_at = now();
  end if;
end;
$$;

create or replace function public.publish_announcement_with_exclusive_surfaces(
  p_announcement_id uuid,
  p_actor_id uuid default auth.uid()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_banner_enabled boolean;
  v_popup_enabled boolean;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'admin required';
  end if;

  select coalesce(banner_enabled, false), coalesce(popup_enabled, false)
  into v_banner_enabled, v_popup_enabled
  from public.announcements
  where id = p_announcement_id;

  if not found then
    raise exception 'announcement not found';
  end if;

  if v_banner_enabled then
    update public.announcements
    set banner_active = false
    where id <> p_announcement_id
      and banner_active = true;
  end if;

  if v_popup_enabled then
    update public.announcements
    set popup_active = false
    where id <> p_announcement_id
      and popup_active = true;
  end if;

  update public.announcements
  set
    status = 'published',
    published_at = coalesce(published_at, now()),
    banner_active = v_banner_enabled,
    popup_active = v_popup_enabled
  where id = p_announcement_id;

  perform public.create_announcement_receipts(p_announcement_id, p_actor_id);

  return p_announcement_id;
end;
$$;

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
  v_seconds int := case
    when p_event_type = 'heartbeat' then greatest(1, least(coalesce(p_active_seconds, 0), 60))
    when p_event_type = 'close' then greatest(0, least(coalesce(p_active_seconds, 0), 60))
    else greatest(0, least(coalesce(p_active_seconds, 0), 60))
  end;
  v_is_admin boolean := coalesce(public.is_admin(), false);
  v_viewed_source text := null;
  v_mark_viewed boolean := false;
  v_department_category_id uuid;
  v_view_session_id uuid := nullif(p_metadata ->> 'viewSessionId', '')::uuid;
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
    metadata,
    view_session_id
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
    coalesce(p_metadata, '{}'::jsonb),
    v_view_session_id
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
    case when p_event_type in ('heartbeat', 'close') then v_seconds else 0 end,
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
    total_active_seconds = public.content_view_rollups.total_active_seconds + case when p_event_type in ('heartbeat', 'close') then v_seconds else 0 end,
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

  insert into public.content_audience_receipts (
    user_id,
    content_type,
    content_id,
    category_id,
    assigned_department_category_id,
    assigned_reason,
    open_count,
    total_active_seconds,
    first_opened_at,
    last_opened_at,
    is_viewed,
    viewed_at,
    viewed_source,
    last_event_at
  )
  values (
    v_target_user,
    p_content_type,
    p_content_id,
    p_category_id,
    v_department_category_id,
    case when v_is_admin then 'admin' else 'direct_user' end,
    case when p_event_type = 'open' then 1 else 0 end,
    case when p_event_type in ('heartbeat', 'close') then v_seconds else 0 end,
    case when p_event_type = 'open' then now() else null end,
    case when p_event_type = 'open' then now() else null end,
    v_mark_viewed,
    case when v_mark_viewed then now() else null end,
    v_viewed_source,
    now()
  )
  on conflict (user_id, content_type, content_id)
  do update set
    category_id = coalesce(excluded.category_id, public.content_audience_receipts.category_id),
    assigned_department_category_id = coalesce(
      excluded.assigned_department_category_id,
      public.content_audience_receipts.assigned_department_category_id
    ),
    open_count = public.content_audience_receipts.open_count + case when p_event_type = 'open' then 1 else 0 end,
    total_active_seconds =
      public.content_audience_receipts.total_active_seconds + case when p_event_type in ('heartbeat', 'close') then v_seconds else 0 end,
    first_opened_at = coalesce(public.content_audience_receipts.first_opened_at, excluded.first_opened_at),
    last_opened_at = case when p_event_type = 'open' then now() else public.content_audience_receipts.last_opened_at end,
    is_viewed = public.content_audience_receipts.is_viewed or v_mark_viewed,
    viewed_at = case
      when v_mark_viewed and public.content_audience_receipts.viewed_at is null then now()
      else public.content_audience_receipts.viewed_at
    end,
    viewed_source = case
      when v_mark_viewed and public.content_audience_receipts.viewed_source is null then v_viewed_source
      else public.content_audience_receipts.viewed_source
    end,
    last_event_at = now(),
    updated_at = now();

  return v_event_id;
end;
$$;

grant execute on function public.create_document_receipts(uuid, uuid) to authenticated;
grant execute on function public.create_announcement_receipts(uuid, uuid) to authenticated;
grant execute on function public.publish_announcement_with_exclusive_surfaces(uuid, uuid) to authenticated;
grant execute on function public.record_content_view_event(text, uuid, text, int, uuid, uuid, jsonb, uuid) to authenticated;

with latest_popup as (
  select id
  from public.announcements
  where status = 'published'
    and popup_enabled = true
    and coalesce(popup_ends_at, now()) >= now()
  order by published_at desc nulls last, created_at desc
  limit 1
)
update public.announcements
set popup_active = id in (select id from latest_popup);

with latest_banner as (
  select id
  from public.announcements
  where status = 'published'
    and banner_enabled = true
    and coalesce(banner_ends_at, now()) >= now()
  order by published_at desc nulls last, created_at desc
  limit 1
)
update public.announcements
set banner_active = id in (select id from latest_banner);

select public.create_announcement_receipts(id, created_by)
from public.announcements
where status = 'published';

select public.create_document_receipts(id, created_by)
from public.documents
where status = 'published';

create table if not exists public.content_view_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_type text not null,
  content_id uuid not null,
  category_id uuid null references public.categories(id) on delete set null,
  view_session_id text not null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz null,
  active_seconds int not null default 0,
  video_duration_seconds int null,
  video_watched_seconds int null,
  video_percent_watched numeric null,
  video_completed boolean not null default false,
  last_heartbeat_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, content_type, content_id, view_session_id)
);

create index if not exists content_view_sessions_user_created_idx
  on public.content_view_sessions(user_id, created_at desc);
create index if not exists content_view_sessions_content_idx
  on public.content_view_sessions(content_type, content_id);
create index if not exists content_view_sessions_category_created_idx
  on public.content_view_sessions(category_id, created_at desc);

drop trigger if exists set_content_view_sessions_updated_at on public.content_view_sessions;
create trigger set_content_view_sessions_updated_at
before update on public.content_view_sessions
for each row execute function public.set_updated_at();

alter table public.content_view_sessions enable row level security;

drop policy if exists content_view_sessions_select_own_or_admin on public.content_view_sessions;
create policy content_view_sessions_select_own_or_admin on public.content_view_sessions
  for select to authenticated
  using (public.is_admin() or user_id = auth.uid());

drop policy if exists content_view_sessions_insert_own on public.content_view_sessions;
create policy content_view_sessions_insert_own on public.content_view_sessions
  for insert to authenticated
  with check (public.is_admin() or user_id = auth.uid());

drop policy if exists content_view_sessions_update_own_or_admin on public.content_view_sessions;
create policy content_view_sessions_update_own_or_admin on public.content_view_sessions
  for update to authenticated
  using (public.is_admin() or user_id = auth.uid())
  with check (public.is_admin() or user_id = auth.uid());

alter table public.content_audience_receipts
  add column if not exists average_session_seconds numeric not null default 0,
  add column if not exists expected_seconds int null,
  add column if not exists video_completed_count int not null default 0,
  add column if not exists max_video_percent_watched numeric null,
  add column if not exists attention_status text null
    check (attention_status is null or attention_status in ('not_opened', 'low_attention', 'partial_attention', 'good_attention', 'completed'));

alter table public.content_view_rollups
  add column if not exists average_session_seconds numeric not null default 0,
  add column if not exists expected_seconds int null,
  add column if not exists video_completed_count int not null default 0,
  add column if not exists max_video_percent_watched numeric null,
  add column if not exists attention_status text null
    check (attention_status is null or attention_status in ('not_opened', 'low_attention', 'partial_attention', 'good_attention', 'completed'));

alter table public.documents
  add column if not exists expected_read_seconds int null;
alter table public.announcements
  add column if not exists expected_read_seconds int null;
alter table public.attachments
  add column if not exists expected_read_seconds int null;
alter table public.onboarding_items
  add column if not exists expected_read_seconds int null;

create or replace function public.attention_status_for(
  p_open_count int,
  p_total_active_seconds int,
  p_is_viewed boolean,
  p_expected_seconds int,
  p_video_completed_count int,
  p_max_video_percent_watched numeric
)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_video_completed_count, 0) > 0 or coalesce(p_max_video_percent_watched, 0) >= 90 then 'completed'
    when coalesce(p_open_count, 0) = 0 then 'not_opened'
    when coalesce(p_is_viewed, false) and coalesce(p_expected_seconds, 0) <= 0 then 'good_attention'
    when coalesce(p_expected_seconds, 0) <= 0 then 'partial_attention'
    when coalesce(p_total_active_seconds, 0)::numeric / greatest(p_expected_seconds, 1) >= 0.8 then 'good_attention'
    when coalesce(p_total_active_seconds, 0)::numeric / greatest(p_expected_seconds, 1) >= 0.4 then 'partial_attention'
    else 'low_attention'
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
  v_view_session_id text := case
    when coalesce(p_metadata ->> 'viewSessionId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then p_metadata ->> 'viewSessionId'
    else gen_random_uuid()::text
  end;
  v_video_duration int := case when (p_metadata ->> 'videoDurationSeconds') ~ '^[0-9]+$' then (p_metadata ->> 'videoDurationSeconds')::int else null end;
  v_video_watched int := case when (p_metadata ->> 'videoWatchedSeconds') ~ '^[0-9]+$' then (p_metadata ->> 'videoWatchedSeconds')::int else null end;
  v_video_percent numeric := case when (p_metadata ->> 'videoPercentWatched') ~ '^[0-9]+(\.[0-9]+)?$' then (p_metadata ->> 'videoPercentWatched')::numeric else null end;
  v_video_completed boolean := coalesce((case when p_metadata ->> 'videoCompleted' in ('true', 'false') then (p_metadata ->> 'videoCompleted')::boolean else null end), false);
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
    nullif(v_view_session_id, '')::uuid
  )
  returning id into v_event_id;

  insert into public.content_view_sessions (
    user_id,
    content_type,
    content_id,
    category_id,
    view_session_id,
    opened_at,
    closed_at,
    active_seconds,
    video_duration_seconds,
    video_watched_seconds,
    video_percent_watched,
    video_completed,
    last_heartbeat_at,
    metadata
  )
  values (
    v_target_user,
    p_content_type,
    p_content_id,
    p_category_id,
    v_view_session_id,
    now(),
    case when p_event_type = 'close' then now() else null end,
    case when p_event_type in ('heartbeat', 'close') then v_seconds else 0 end,
    v_video_duration,
    v_video_watched,
    v_video_percent,
    v_video_completed,
    case when p_event_type = 'heartbeat' then now() else null end,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (user_id, content_type, content_id, view_session_id)
  do update set
    closed_at = case when p_event_type = 'close' then now() else public.content_view_sessions.closed_at end,
    active_seconds = public.content_view_sessions.active_seconds + case when p_event_type in ('heartbeat', 'close') then v_seconds else 0 end,
    video_duration_seconds = coalesce(excluded.video_duration_seconds, public.content_view_sessions.video_duration_seconds),
    video_watched_seconds = greatest(
      coalesce(public.content_view_sessions.video_watched_seconds, 0),
      coalesce(excluded.video_watched_seconds, 0)
    ),
    video_percent_watched = greatest(
      coalesce(public.content_view_sessions.video_percent_watched, 0),
      coalesce(excluded.video_percent_watched, 0)
    ),
    video_completed = public.content_view_sessions.video_completed or excluded.video_completed,
    last_heartbeat_at = case when p_event_type = 'heartbeat' then now() else public.content_view_sessions.last_heartbeat_at end,
    metadata = public.content_view_sessions.metadata || coalesce(excluded.metadata, '{}'::jsonb),
    updated_at = now();

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
    viewed_source,
    video_completed_count,
    max_video_percent_watched
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
    v_viewed_source,
    case when v_video_completed then 1 else 0 end,
    v_video_percent
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
    video_completed_count = public.content_view_rollups.video_completed_count + case when v_video_completed then 1 else 0 end,
    max_video_percent_watched = greatest(
      coalesce(public.content_view_rollups.max_video_percent_watched, 0),
      coalesce(excluded.max_video_percent_watched, 0)
    ),
    average_session_seconds =
      (public.content_view_rollups.total_active_seconds + case when p_event_type in ('heartbeat', 'close') then v_seconds else 0 end)::numeric
      / greatest(public.content_view_rollups.open_count + case when p_event_type = 'open' then 1 else 0 end, 1),
    attention_status = public.attention_status_for(
      public.content_view_rollups.open_count + case when p_event_type = 'open' then 1 else 0 end,
      public.content_view_rollups.total_active_seconds + case when p_event_type in ('heartbeat', 'close') then v_seconds else 0 end,
      public.content_view_rollups.is_viewed or v_mark_viewed,
      public.content_view_rollups.expected_seconds,
      public.content_view_rollups.video_completed_count + case when v_video_completed then 1 else 0 end,
      greatest(coalesce(public.content_view_rollups.max_video_percent_watched, 0), coalesce(excluded.max_video_percent_watched, 0))
    ),
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
    last_event_at,
    video_completed_count,
    max_video_percent_watched
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
    now(),
    case when v_video_completed then 1 else 0 end,
    v_video_percent
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
    video_completed_count = public.content_audience_receipts.video_completed_count + case when v_video_completed then 1 else 0 end,
    max_video_percent_watched = greatest(
      coalesce(public.content_audience_receipts.max_video_percent_watched, 0),
      coalesce(excluded.max_video_percent_watched, 0)
    ),
    average_session_seconds =
      (public.content_audience_receipts.total_active_seconds + case when p_event_type in ('heartbeat', 'close') then v_seconds else 0 end)::numeric
      / greatest(public.content_audience_receipts.open_count + case when p_event_type = 'open' then 1 else 0 end, 1),
    attention_status = public.attention_status_for(
      public.content_audience_receipts.open_count + case when p_event_type = 'open' then 1 else 0 end,
      public.content_audience_receipts.total_active_seconds + case when p_event_type in ('heartbeat', 'close') then v_seconds else 0 end,
      public.content_audience_receipts.is_viewed or v_mark_viewed,
      public.content_audience_receipts.expected_seconds,
      public.content_audience_receipts.video_completed_count + case when v_video_completed then 1 else 0 end,
      greatest(coalesce(public.content_audience_receipts.max_video_percent_watched, 0), coalesce(excluded.max_video_percent_watched, 0))
    ),
    last_event_at = now(),
    updated_at = now();

  return v_event_id;
end;
$$;

grant execute on function public.attention_status_for(int, int, boolean, int, int, numeric) to authenticated;
grant execute on function public.record_content_view_event(text, uuid, text, int, uuid, uuid, jsonb, uuid) to authenticated;

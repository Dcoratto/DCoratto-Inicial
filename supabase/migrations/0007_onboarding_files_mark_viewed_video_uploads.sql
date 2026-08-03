alter table public.onboarding_tracks
  add column if not exists department_category_id uuid null references public.categories(id) on delete set null;

alter table public.onboarding_items
  add column if not exists attachment_id uuid null references public.attachments(id) on delete set null,
  add column if not exists file_storage_path text null,
  add column if not exists file_original_name text null,
  add column if not exists file_mime_type text null,
  add column if not exists file_size_bytes bigint null;

create index if not exists onboarding_tracks_department_category_idx
  on public.onboarding_tracks(department_category_id);
create index if not exists onboarding_items_attachment_idx
  on public.onboarding_items(attachment_id);

update storage.buckets
set allowed_mime_types = null
where id = 'knowledge-assets';

create or replace function public.can_read_onboarding_track(p_track_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_admin(), false)
    or exists (
      select 1
      from public.onboarding_tracks ot
      where ot.id = p_track_id
        and ot.is_active = true
        and (
          ot.department_category_id is null
          or public.can_read_category(ot.department_category_id)
        )
    );
$$;

grant execute on function public.can_read_onboarding_track(uuid) to authenticated;

drop policy if exists onboarding_tracks_select_active_or_admin on public.onboarding_tracks;
create policy onboarding_tracks_select_active_or_admin on public.onboarding_tracks
  for select to authenticated
  using (public.can_read_onboarding_track(id));

drop policy if exists onboarding_items_select_active_track_or_admin on public.onboarding_items;
create policy onboarding_items_select_active_track_or_admin on public.onboarding_items
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.onboarding_tracks ot
      where ot.id = onboarding_items.track_id
        and public.can_read_onboarding_track(ot.id)
    )
  );

create or replace function public.mark_content_as_viewed(
  p_content_type text,
  p_content_id uuid,
  p_category_id uuid default null,
  p_user_id uuid default null,
  p_source text default 'manual'
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_target_user uuid := coalesce(p_user_id, auth.uid());
  v_is_admin boolean := coalesce(public.is_admin(), false);
  v_source text := case when p_source = 'admin' then 'admin' else 'manual' end;
  v_department_category_id uuid;
  v_viewed_at timestamptz;
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;

  if v_target_user <> v_actor and not v_is_admin then
    raise exception 'admin required';
  end if;

  if v_source = 'admin' and not v_is_admin then
    raise exception 'admin required';
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

  insert into public.content_audience_receipts (
    user_id,
    content_type,
    content_id,
    category_id,
    assigned_department_category_id,
    assigned_reason,
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
    case when v_is_admin and v_target_user <> v_actor then 'admin' else 'direct_user' end,
    true,
    now(),
    v_source,
    now()
  )
  on conflict (user_id, content_type, content_id)
  do update set
    category_id = coalesce(excluded.category_id, public.content_audience_receipts.category_id),
    assigned_department_category_id = coalesce(
      excluded.assigned_department_category_id,
      public.content_audience_receipts.assigned_department_category_id
    ),
    is_viewed = true,
    viewed_at = coalesce(public.content_audience_receipts.viewed_at, excluded.viewed_at),
    viewed_source = coalesce(public.content_audience_receipts.viewed_source, excluded.viewed_source),
    last_event_at = now(),
    updated_at = now()
  returning viewed_at into v_viewed_at;

  insert into public.content_view_rollups (
    user_id,
    content_type,
    content_id,
    category_id,
    department_category_id,
    is_viewed,
    viewed_at,
    viewed_source
  )
  values (
    v_target_user,
    p_content_type,
    p_content_id,
    p_category_id,
    v_department_category_id,
    true,
    v_viewed_at,
    v_source
  )
  on conflict (user_id, content_type, content_id)
  do update set
    category_id = coalesce(excluded.category_id, public.content_view_rollups.category_id),
    department_category_id = coalesce(
      excluded.department_category_id,
      public.content_view_rollups.department_category_id
    ),
    is_viewed = true,
    viewed_at = coalesce(public.content_view_rollups.viewed_at, excluded.viewed_at),
    viewed_source = coalesce(public.content_view_rollups.viewed_source, excluded.viewed_source),
    updated_at = now();

  return v_viewed_at;
end;
$$;

grant execute on function public.mark_content_as_viewed(text, uuid, uuid, uuid, text) to authenticated;

create or replace function public.create_onboarding_receipts(p_track_id uuid, p_assigned_by uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_department_category_id uuid;
begin
  if auth.uid() is not null and not coalesce(public.is_admin(), false) then
    raise exception 'admin required';
  end if;

  select department_category_id
  into v_department_category_id
  from public.onboarding_tracks
  where id = p_track_id
    and is_active = true;

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
    'onboarding',
    oi.id,
    v_department_category_id,
    coalesce(v_department_category_id, p.department_category_id),
    p_assigned_by,
    case
      when p.role = 'admin' then 'admin'
      when v_department_category_id is null then 'global'
      when public.category_is_under(v_department_category_id, p.department_category_id) then 'department'
      else 'extra_folder'
    end
  from public.onboarding_items oi
  join public.profiles p on p.is_active = true
  where oi.track_id = p_track_id
    and (
      p.role = 'admin'
      or v_department_category_id is null
      or public.category_is_under(v_department_category_id, p.department_category_id)
      or exists (
        select 1
        from public.user_folder_permissions ufp
        where ufp.user_id = p.id
          and public.category_is_under(v_department_category_id, ufp.category_id)
      )
    )
  on conflict (user_id, content_type, content_id) do update set
    category_id = coalesce(excluded.category_id, public.content_audience_receipts.category_id),
    assigned_department_category_id = coalesce(
      excluded.assigned_department_category_id,
      public.content_audience_receipts.assigned_department_category_id
    ),
    updated_at = now();
end;
$$;

grant execute on function public.create_onboarding_receipts(uuid, uuid) to authenticated;

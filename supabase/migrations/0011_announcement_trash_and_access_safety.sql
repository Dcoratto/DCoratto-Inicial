begin;

alter table public.announcements
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null,
  add column if not exists trash_expires_at timestamptz,
  add column if not exists delete_reason text,
  add column if not exists restored_at timestamptz,
  add column if not exists restored_by uuid references auth.users(id) on delete set null,
  add column if not exists status_before_delete text,
  add column if not exists permanently_deleted_at timestamptz,
  add column if not exists permanently_deleted_by uuid references auth.users(id) on delete set null;

create index if not exists announcements_trash_expires_idx
  on public.announcements (trash_expires_at)
  where deleted_at is not null and permanently_deleted_at is null;

create index if not exists announcements_visible_surfaces_idx
  on public.announcements (status, banner_active, popup_active, published_at desc)
  where deleted_at is null and permanently_deleted_at is null;

create or replace function public.prevent_last_active_admin_removal()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.role = 'admin' and old.is_active = true then
      if not exists (
        select 1
        from public.profiles p
        where p.id <> old.id
          and p.role = 'admin'
          and p.is_active = true
      ) then
        raise exception 'the last active admin cannot be removed';
      end if;
    end if;
    return old;
  end if;

  if old.role = 'admin' and old.is_active = true and (new.role <> 'admin' or new.is_active = false) then
    if not exists (
      select 1
      from public.profiles p
      where p.id <> old.id
        and p.role = 'admin'
        and p.is_active = true
    ) then
      raise exception 'the last active admin cannot be removed';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_last_active_admin_removal_trigger on public.profiles;
create trigger prevent_last_active_admin_removal_trigger
before update of role, is_active or delete on public.profiles
for each row execute function public.prevent_last_active_admin_removal();

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
        and a.deleted_at is null
        and a.permanently_deleted_at is null
        and (
          (
            not exists (
              select 1 from public.announcement_targets at
              where at.announcement_id = a.id
            )
            and not exists (
              select 1 from public.announcement_target_categories atc
              where atc.announcement_id = a.id
            )
          )
          or exists (
            select 1 from public.announcement_targets at
            where at.announcement_id = a.id and at.user_id = auth.uid()
          )
          or exists (
            select 1 from public.announcement_target_categories atc
            where atc.announcement_id = a.id
              and public.can_read_category(atc.category_id)
          )
        )
    );
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
  where id = p_announcement_id
    and deleted_at is null
    and permanently_deleted_at is null;

  if not found then
    raise exception 'announcement not found or unavailable';
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
  where id = p_announcement_id
    and deleted_at is null
    and permanently_deleted_at is null;

  perform public.create_announcement_receipts(p_announcement_id, p_actor_id);
  return p_announcement_id;
end;
$$;

grant execute on function public.can_read_announcement(uuid) to authenticated;
grant execute on function public.publish_announcement_with_exclusive_surfaces(uuid, uuid) to authenticated;

commit;

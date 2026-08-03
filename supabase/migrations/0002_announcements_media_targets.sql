alter table public.announcements
  add column if not exists media_storage_path text,
  add column if not exists media_original_name text,
  add column if not exists media_mime_type text,
  add column if not exists media_size_bytes bigint,
  add column if not exists popup_enabled boolean not null default false,
  add column if not exists popup_starts_at timestamptz,
  add column if not exists popup_ends_at timestamptz;

create table if not exists public.announcement_targets (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

create table if not exists public.announcement_dismissals (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

create index if not exists announcement_targets_user_idx on public.announcement_targets(user_id);
create index if not exists announcement_dismissals_user_idx on public.announcement_dismissals(user_id);
create index if not exists announcements_popup_window_idx on public.announcements(popup_enabled, popup_starts_at, popup_ends_at);

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
          not exists (
            select 1
            from public.announcement_targets at
            where at.announcement_id = a.id
          )
          or exists (
            select 1
            from public.announcement_targets at
            where at.announcement_id = a.id
              and at.user_id = auth.uid()
          )
        )
    );
$$;

grant execute on function public.can_read_announcement(uuid) to authenticated;

alter table public.announcement_targets enable row level security;
alter table public.announcement_dismissals enable row level security;

drop policy if exists announcements_select_published_or_admin on public.announcements;
create policy announcements_select_targeted_or_admin on public.announcements
  for select to authenticated
  using (public.can_read_announcement(id));

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'announcement_targets' and policyname = 'announcement_targets_select_own_or_admin') then
    create policy announcement_targets_select_own_or_admin on public.announcement_targets
      for select to authenticated
      using (user_id = auth.uid() or public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'announcement_targets' and policyname = 'announcement_targets_admin_insert') then
    create policy announcement_targets_admin_insert on public.announcement_targets
      for insert to authenticated
      with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'announcement_targets' and policyname = 'announcement_targets_admin_delete') then
    create policy announcement_targets_admin_delete on public.announcement_targets
      for delete to authenticated
      using (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'announcement_dismissals' and policyname = 'announcement_dismissals_select_own_or_admin') then
    create policy announcement_dismissals_select_own_or_admin on public.announcement_dismissals
      for select to authenticated
      using (user_id = auth.uid() or public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'announcement_dismissals' and policyname = 'announcement_dismissals_insert_own') then
    create policy announcement_dismissals_insert_own on public.announcement_dismissals
      for insert to authenticated
      with check (user_id = auth.uid() and public.can_read_announcement(announcement_id));
  end if;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'knowledge-assets',
  'knowledge-assets',
  false,
  20971520,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'video/mp4']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

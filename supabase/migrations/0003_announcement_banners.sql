alter table public.announcements
  add column if not exists banner_enabled boolean not null default false,
  add column if not exists banner_starts_at timestamptz,
  add column if not exists banner_ends_at timestamptz;

create index if not exists announcements_banner_window_idx
  on public.announcements(banner_enabled, banner_starts_at, banner_ends_at);

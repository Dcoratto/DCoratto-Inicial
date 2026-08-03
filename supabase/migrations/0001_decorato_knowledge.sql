create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  email text unique,
  full_name text,
  role text not null check (role in ('admin', 'viewer')),
  department text,
  is_active boolean not null default true,
  must_change_password boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default extensions.gen_random_uuid(),
  parent_id uuid references public.categories(id) on delete set null,
  name text not null,
  slug text not null unique,
  description text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default extensions.gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  title text not null,
  slug text not null unique,
  summary text,
  content_json jsonb not null default '[]'::jsonb,
  content_text text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  version int not null default 1,
  tags text[] not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.document_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  version int not null,
  title text not null,
  summary text,
  content_json jsonb not null,
  content_text text not null,
  status text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (document_id, version)
);

create table if not exists public.attachments (
  id uuid primary key default extensions.gen_random_uuid(),
  document_id uuid references public.documents(id) on delete cascade,
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.announcements (
  id uuid primary key default extensions.gen_random_uuid(),
  title text not null,
  body text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.onboarding_tracks (
  id uuid primary key default extensions.gen_random_uuid(),
  title text not null,
  description text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.onboarding_items (
  id uuid primary key default extensions.gen_random_uuid(),
  track_id uuid not null references public.onboarding_tracks(id) on delete cascade,
  title text not null,
  description text,
  document_id uuid references public.documents(id) on delete set null,
  video_url text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.onboarding_progress (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.onboarding_items(id) on delete cascade,
  completed_at timestamptz not null default now(),
  unique (user_id, item_id)
);

create table if not exists public.audit_logs (
  id uuid primary key default extensions.gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists public.app_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_agent text,
  ip_address text,
  is_revoked boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists profiles_username_idx on public.profiles(username);
create unique index if not exists profiles_username_lower_idx on public.profiles(lower(username)) where username is not null;
create index if not exists categories_parent_id_idx on public.categories(parent_id);
create index if not exists documents_status_idx on public.documents(status);
create index if not exists documents_category_id_idx on public.documents(category_id);
create index if not exists documents_slug_idx on public.documents(slug);
create index if not exists documents_updated_at_idx on public.documents(updated_at desc);
create index if not exists documents_tags_idx on public.documents using gin(tags);
create index if not exists documents_title_trgm_idx on public.documents using gin(title extensions.gin_trgm_ops);
create index if not exists documents_summary_trgm_idx on public.documents using gin(summary extensions.gin_trgm_ops);
create index if not exists documents_content_trgm_idx on public.documents using gin(content_text extensions.gin_trgm_ops);
create index if not exists documents_fts_idx on public.documents
  using gin(to_tsvector('portuguese', coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(content_text, '')));
create index if not exists announcements_status_published_at_idx on public.announcements(status, published_at desc);
create index if not exists onboarding_items_track_order_idx on public.onboarding_items(track_id, sort_order);
create index if not exists onboarding_progress_user_idx on public.onboarding_progress(user_id);
create index if not exists audit_logs_created_at_idx on public.audit_logs(created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_categories_updated_at on public.categories;
create trigger set_categories_updated_at
before update on public.categories
for each row execute function public.set_updated_at();

drop trigger if exists set_documents_updated_at on public.documents;
create trigger set_documents_updated_at
before update on public.documents
for each row execute function public.set_updated_at();

drop trigger if exists set_announcements_updated_at on public.announcements;
create trigger set_announcements_updated_at
before update on public.announcements
for each row execute function public.set_updated_at();

drop trigger if exists set_onboarding_tracks_updated_at on public.onboarding_tracks;
create trigger set_onboarding_tracks_updated_at
before update on public.onboarding_tracks
for each row execute function public.set_updated_at();

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid()
    and is_active = true
  limit 1;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'admin', false);
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
    );
$$;

create or replace function public.prevent_document_versions_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'document_versions is immutable';
end;
$$;

drop trigger if exists prevent_document_versions_update on public.document_versions;
create trigger prevent_document_versions_update
before update or delete on public.document_versions
for each row execute function public.prevent_document_versions_mutation();

create or replace function public.publish_document(p_document_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.documents%rowtype;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.documents
  set status = 'published',
      version = case
        when published_at is null then greatest(version, 1)
        else version + 1
      end,
      published_at = now(),
      archived_at = null,
      updated_by = auth.uid(),
      updated_at = now()
  where id = p_document_id
  returning * into v_doc;

  if v_doc.id is null then
    raise exception 'document not found' using errcode = 'P0002';
  end if;

  insert into public.document_versions (
    document_id,
    version,
    title,
    summary,
    content_json,
    content_text,
    status,
    created_by
  )
  values (
    v_doc.id,
    v_doc.version,
    v_doc.title,
    v_doc.summary,
    v_doc.content_json,
    v_doc.content_text,
    v_doc.status,
    auth.uid()
  )
  on conflict (document_id, version) do nothing;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'document.publish', 'document', v_doc.id, jsonb_build_object('version', v_doc.version));

  return v_doc.id;
end;
$$;

create or replace function public.archive_document(p_document_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.documents%rowtype;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.documents
  set status = 'archived',
      archived_at = now(),
      updated_by = auth.uid(),
      updated_at = now()
  where id = p_document_id
  returning * into v_doc;

  if v_doc.id is null then
    raise exception 'document not found' using errcode = 'P0002';
  end if;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'document.archive', 'document', v_doc.id, jsonb_build_object('version', v_doc.version));

  return v_doc.id;
end;
$$;

create or replace function public.complete_onboarding_item(p_item_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_progress_id uuid;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
  ) then
    raise exception 'inactive user' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.onboarding_items oi
    join public.onboarding_tracks ot on ot.id = oi.track_id
    where oi.id = p_item_id
      and ot.is_active = true
  ) then
    raise exception 'onboarding item not found' using errcode = 'P0002';
  end if;

  insert into public.onboarding_progress(user_id, item_id)
  values (auth.uid(), p_item_id)
  on conflict (user_id, item_id) do nothing
  returning id into v_progress_id;

  if v_progress_id is null then
    select id into v_progress_id
    from public.onboarding_progress
    where user_id = auth.uid()
      and item_id = p_item_id;
  end if;

  return v_progress_id;
end;
$$;

grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_read_document(uuid) to authenticated;
grant execute on function public.publish_document(uuid) to authenticated;
grant execute on function public.archive_document(uuid) to authenticated;
grant execute on function public.complete_onboarding_item(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.attachments enable row level security;
alter table public.announcements enable row level security;
alter table public.onboarding_tracks enable row level security;
alter table public.onboarding_items enable row level security;
alter table public.onboarding_progress enable row level security;
alter table public.audit_logs enable row level security;
alter table public.app_sessions enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_own_or_admin') then
    create policy profiles_select_own_or_admin on public.profiles
      for select to authenticated
      using (id = auth.uid() or public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_insert_admin') then
    create policy profiles_insert_admin on public.profiles
      for insert to authenticated
      with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_update_admin') then
    create policy profiles_update_admin on public.profiles
      for update to authenticated
      using (public.is_admin())
      with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'categories' and policyname = 'categories_select_active_or_admin') then
    create policy categories_select_active_or_admin on public.categories
      for select to authenticated
      using (is_active = true or public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'categories' and policyname = 'categories_admin_insert') then
    create policy categories_admin_insert on public.categories
      for insert to authenticated
      with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'categories' and policyname = 'categories_admin_update') then
    create policy categories_admin_update on public.categories
      for update to authenticated
      using (public.is_admin())
      with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'documents' and policyname = 'documents_select_published_or_admin') then
    create policy documents_select_published_or_admin on public.documents
      for select to authenticated
      using (status = 'published' or public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'documents' and policyname = 'documents_admin_insert') then
    create policy documents_admin_insert on public.documents
      for insert to authenticated
      with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'documents' and policyname = 'documents_admin_update') then
    create policy documents_admin_update on public.documents
      for update to authenticated
      using (public.is_admin())
      with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'document_versions' and policyname = 'document_versions_select_readable') then
    create policy document_versions_select_readable on public.document_versions
      for select to authenticated
      using (public.is_admin() or public.can_read_document(document_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'document_versions' and policyname = 'document_versions_admin_insert') then
    create policy document_versions_admin_insert on public.document_versions
      for insert to authenticated
      with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'attachments' and policyname = 'attachments_select_readable') then
    create policy attachments_select_readable on public.attachments
      for select to authenticated
      using (public.is_admin() or (document_id is not null and public.can_read_document(document_id)));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'attachments' and policyname = 'attachments_admin_insert') then
    create policy attachments_admin_insert on public.attachments
      for insert to authenticated
      with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'attachments' and policyname = 'attachments_admin_update') then
    create policy attachments_admin_update on public.attachments
      for update to authenticated
      using (public.is_admin())
      with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'announcements' and policyname = 'announcements_select_published_or_admin') then
    create policy announcements_select_published_or_admin on public.announcements
      for select to authenticated
      using (status = 'published' or public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'announcements' and policyname = 'announcements_admin_insert') then
    create policy announcements_admin_insert on public.announcements
      for insert to authenticated
      with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'announcements' and policyname = 'announcements_admin_update') then
    create policy announcements_admin_update on public.announcements
      for update to authenticated
      using (public.is_admin())
      with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'onboarding_tracks' and policyname = 'onboarding_tracks_select_active_or_admin') then
    create policy onboarding_tracks_select_active_or_admin on public.onboarding_tracks
      for select to authenticated
      using (is_active = true or public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'onboarding_tracks' and policyname = 'onboarding_tracks_admin_insert') then
    create policy onboarding_tracks_admin_insert on public.onboarding_tracks
      for insert to authenticated
      with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'onboarding_tracks' and policyname = 'onboarding_tracks_admin_update') then
    create policy onboarding_tracks_admin_update on public.onboarding_tracks
      for update to authenticated
      using (public.is_admin())
      with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'onboarding_items' and policyname = 'onboarding_items_select_active_track_or_admin') then
    create policy onboarding_items_select_active_track_or_admin on public.onboarding_items
      for select to authenticated
      using (
        public.is_admin()
        or exists (
          select 1
          from public.onboarding_tracks ot
          where ot.id = track_id
            and ot.is_active = true
        )
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'onboarding_items' and policyname = 'onboarding_items_admin_insert') then
    create policy onboarding_items_admin_insert on public.onboarding_items
      for insert to authenticated
      with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'onboarding_items' and policyname = 'onboarding_items_admin_update') then
    create policy onboarding_items_admin_update on public.onboarding_items
      for update to authenticated
      using (public.is_admin())
      with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'onboarding_progress' and policyname = 'onboarding_progress_select_own_or_admin') then
    create policy onboarding_progress_select_own_or_admin on public.onboarding_progress
      for select to authenticated
      using (user_id = auth.uid() or public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'onboarding_progress' and policyname = 'onboarding_progress_insert_own') then
    create policy onboarding_progress_insert_own on public.onboarding_progress
      for insert to authenticated
      with check (user_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_logs' and policyname = 'audit_logs_select_admin') then
    create policy audit_logs_select_admin on public.audit_logs
      for select to authenticated
      using (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_sessions' and policyname = 'app_sessions_select_own_or_admin') then
    create policy app_sessions_select_own_or_admin on public.app_sessions
      for select to authenticated
      using (user_id = auth.uid() or public.is_admin());
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

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'knowledge_assets_admin_all') then
    create policy knowledge_assets_admin_all on storage.objects
      for all to authenticated
      using (bucket_id = 'knowledge-assets' and public.is_admin())
      with check (bucket_id = 'knowledge-assets' and public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'knowledge_assets_select_published') then
    create policy knowledge_assets_select_published on storage.objects
      for select to authenticated
      using (
        bucket_id = 'knowledge-assets'
        and (
          public.is_admin()
          or exists (
            select 1
            from public.attachments a
            join public.documents d on d.id = a.document_id
            where a.storage_path = storage.objects.name
              and d.status = 'published'
          )
        )
      );
  end if;
end;
$$;

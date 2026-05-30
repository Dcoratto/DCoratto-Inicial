create extension if not exists pgcrypto;

create table if not exists public.app_users (
  email text primary key,
  display_name text not null default '',
  role text not null default 'team' check (role in ('owner', 'admin', 'team')),
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.app_users (email, display_name, role, password_hash, active)
values
  ('dcorattoinovacao@gmail.com', 'D''Coratto Inovacao', 'owner', extensions.crypt('sob_medida', extensions.gen_salt('bf')), true),
  ('rafael@dcoratto.com.br', 'Rafael', 'team', extensions.crypt('Dcoratto@Rafael26', extensions.gen_salt('bf')), true),
  ('isabela@dcoratto.com.br', 'Isabela', 'team', extensions.crypt('Dcoratto@Isabela26', extensions.gen_salt('bf')), true),
  ('vinicius@dcoratto.com.br', 'Vinicius', 'team', extensions.crypt('Dcoratto@Vinicius26', extensions.gen_salt('bf')), true)
on conflict (email) do update set
  display_name = excluded.display_name,
  role = excluded.role,
  active = true,
  updated_at = now();

create index if not exists app_users_active_idx on public.app_users(active, email);

alter table public.app_users enable row level security;

drop policy if exists "Service role app users" on public.app_users;
create policy "Service role app users" on public.app_users
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create or replace function public.upsert_app_user(
  manager_email text,
  original_email text,
  user_email text,
  user_display_name text,
  user_role text,
  user_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  manager_user public.app_users%rowtype;
  existing_user public.app_users%rowtype;
  manager_login text := lower(trim(coalesce(manager_email, '')));
  original_login text := lower(trim(coalesce(original_email, '')));
  next_login text := lower(trim(coalesce(user_email, '')));
  next_name text := trim(coalesce(user_display_name, ''));
  next_role text := lower(trim(coalesce(user_role, 'team')));
  next_password text := coalesce(user_password, '');
  saved_user public.app_users%rowtype;
begin
  select *
    into manager_user
    from public.app_users
    where lower(email) = manager_login
      and active = true;

  if manager_login <> 'dcorattoinovacao@gmail.com' and coalesce(manager_user.role, '') not in ('owner', 'admin') then
    raise exception 'forbidden_app_user_management';
  end if;

  if next_login !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or next_name = '' then
    raise exception 'invalid_app_user';
  end if;

  if next_role not in ('owner', 'admin', 'team') then
    next_role := 'team';
  end if;

  if next_login = 'dcorattoinovacao@gmail.com' then
    next_role := 'owner';
  end if;

  if original_login = 'dcorattoinovacao@gmail.com' and next_login <> original_login then
    raise exception 'primary_user_locked';
  end if;

  if original_login <> '' then
    select *
      into existing_user
      from public.app_users
      where lower(email) = original_login;
  else
    select *
      into existing_user
      from public.app_users
      where lower(email) = next_login;
  end if;

  if existing_user.email is null then
    if trim(next_password) = '' then
      raise exception 'password_required';
    end if;

    insert into public.app_users (email, display_name, role, password_hash, active)
    values (next_login, next_name, next_role, extensions.crypt(next_password, extensions.gen_salt('bf')), true)
    returning * into saved_user;
  else
    update public.app_users
      set email = next_login,
          display_name = next_name,
          role = next_role,
          password_hash = case
            when trim(next_password) <> '' then extensions.crypt(next_password, extensions.gen_salt('bf'))
            else password_hash
          end,
          active = true,
          updated_at = now()
      where email = existing_user.email
      returning * into saved_user;
  end if;

  return jsonb_build_object(
    'user', jsonb_build_object(
      'email', saved_user.email,
      'display_name', saved_user.display_name,
      'role', saved_user.role,
      'active', saved_user.active,
      'created_at', saved_user.created_at,
      'updated_at', saved_user.updated_at
    )
  );
end;
$$;

grant execute on function public.upsert_app_user(text, text, text, text, text, text) to service_role;

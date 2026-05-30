alter table public.document_projects
  add column if not exists assigned_to_email text not null default '',
  add column if not exists last_editor_email text not null default '',
  add column if not exists last_editor_name text not null default '',
  add column if not exists is_draft boolean not null default false,
  add column if not exists draft_owner_email text not null default '',
  add column if not exists draft_saved_at timestamptz,
  add column if not exists deleted_for_users text[] not null default '{}',
  add column if not exists sold_at timestamptz,
  add column if not exists sold_by text,
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists lock_reason text;

alter table public.document_projects
  drop constraint if exists document_projects_status_check;

alter table public.document_projects
  add constraint document_projects_status_check
  check (status in ('draft', 'active', 'review', 'approved', 'archived', 'sold'));

update public.document_projects
set owner_email = coalesce(nullif(owner_email, ''), 'dcorattoinovacao@gmail.com'),
    created_by = coalesce(nullif(created_by, ''), nullif(data->'actor'->>'email', ''), nullif(updated_by, ''), ''),
    updated_by = coalesce(nullif(updated_by, ''), nullif(data->'actor'->>'email', ''), nullif(created_by, ''), ''),
    assigned_to_email = coalesce(nullif(assigned_to_email, ''), nullif(created_by, ''), nullif(updated_by, ''), nullif(data->'actor'->>'email', '')),
    last_editor_email = coalesce(nullif(last_editor_email, ''), nullif(updated_by, ''), nullif(data->'actor'->>'email', ''), nullif(created_by, '')),
    last_editor_name = coalesce(nullif(last_editor_name, ''), data->'actor'->>'name', ''),
    draft_owner_email = coalesce(nullif(draft_owner_email, ''), nullif(created_by, ''), nullif(updated_by, ''), nullif(data->'actor'->>'email', '')),
    is_draft = coalesce(is_draft, false) or status = 'draft',
    draft_saved_at = case
      when (coalesce(is_draft, false) or status = 'draft') and draft_saved_at is null then updated_at
      else draft_saved_at
    end;

alter table public.document_html_versions
  add column if not exists assigned_to_email text not null default '';

update public.document_html_versions h
set assigned_to_email = coalesce(nullif(h.assigned_to_email, ''), nullif(p.assigned_to_email, ''), nullif(h.created_by, ''), nullif(p.created_by, ''))
from public.document_projects p
where h.project_id = p.id
  and coalesce(h.assigned_to_email, '') = '';

create index if not exists document_projects_assigned_updated_idx
on public.document_projects(assigned_to_email, updated_at desc);

create index if not exists document_projects_status_assigned_updated_idx
on public.document_projects(status, assigned_to_email, updated_at desc);

create index if not exists document_projects_draft_owner_updated_idx
on public.document_projects(draft_owner_email, updated_at desc)
where is_draft = true;

create index if not exists document_html_versions_created_idx
on public.document_html_versions(created_by, created_at desc);

create index if not exists document_html_versions_assigned_idx
on public.document_html_versions(assigned_to_email, created_at desc);

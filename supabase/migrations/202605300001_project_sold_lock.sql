alter table public.document_projects
  drop constraint if exists document_projects_status_check;

alter table public.document_projects
  add constraint document_projects_status_check
  check (status in ('draft', 'review', 'approved', 'archived', 'sold'));

create index if not exists document_projects_status_idx
on public.document_projects(status, updated_at desc);

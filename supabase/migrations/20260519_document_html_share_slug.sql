alter table public.document_html_versions
  add column if not exists share_slug text;

create index if not exists document_html_versions_share_slug_idx
  on public.document_html_versions(share_slug)
  where share_slug is not null;

alter table public.document_html_versions
  add column if not exists shared_with_client boolean not null default false,
  add column if not exists shared_at timestamptz,
  add column if not exists created_by text not null default '',
  add column if not exists share_slug text;

update public.document_html_versions
set
  share_slug = coalesce(share_slug, nullif(data->>'shareSlug', '')),
  shared_with_client = shared_with_client
    or case when lower(data->>'sharedWithClient') in ('true', '1', 'yes') then true else false end,
  shared_at = coalesce(
    shared_at,
    case when nullif(data->>'sharedAt', '') is not null then (data->>'sharedAt')::timestamptz else null end
  ),
  created_by = coalesce(nullif(created_by, ''), data->>'createdBy', '')
where
  share_slug is null
  or shared_at is null
  or created_by = ''
  or shared_with_client is false;

create index if not exists document_html_versions_share_slug_idx
  on public.document_html_versions(share_slug)
  where share_slug is not null;

create index if not exists document_html_versions_shared_idx
  on public.document_html_versions(shared_with_client, shared_at desc);

create index if not exists document_html_versions_storage_path_idx
  on public.document_html_versions(storage_path)
  where storage_path is not null;

drop policy if exists "Public read shared html versions" on public.document_html_versions;
create policy "Public read shared html versions"
on public.document_html_versions
for select
using (shared_with_client = true);

drop policy if exists "Public read dcoratto html storage" on storage.objects;
create policy "Public read dcoratto html storage"
on storage.objects
for select
using (bucket_id = 'dcoratto-html');

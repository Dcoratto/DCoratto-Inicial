update public.document_projects
set updated_by = coalesce(nullif(updated_by, ''), data->'actor'->>'email', created_by, ''),
    created_by = coalesce(nullif(created_by, ''), data->'actor'->>'email', updated_by, ''),
    owner_email = coalesce(nullif(owner_email, ''), data->>'ownerEmail', 'dcorattoinovacao@gmail.com')
where document_type = 'projeto_inicial'
  and (
    coalesce(updated_by, '') = ''
    or coalesce(created_by, '') = ''
    or coalesce(owner_email, '') = ''
  );

update public.document_html_versions
set created_by = coalesce(nullif(created_by, ''), data->>'createdBy', ''),
    owner_email = coalesce(nullif(owner_email, ''), data->>'ownerEmail', 'dcorattoinovacao@gmail.com')
where coalesce(created_by, '') = ''
   or coalesce(owner_email, '') = '';

create index if not exists document_projects_updated_by_idx
on public.document_projects(updated_by, updated_at desc)
where document_type = 'projeto_inicial';

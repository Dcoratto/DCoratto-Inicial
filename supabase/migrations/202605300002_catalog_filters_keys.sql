alter table public.catalog_materials
  add column if not exists catalog_key text,
  add column if not exists material_type text,
  add column if not exists category text,
  add column if not exists storage_bucket text,
  add column if not exists storage_path text,
  add column if not exists public_url text,
  add column if not exists mime_type text,
  add column if not exists width integer,
  add column if not exists height integer,
  add column if not exists created_by text not null default '';

update public.catalog_materials
set catalog_key = lower(regexp_replace(
      regexp_replace(
        coalesce(group_key, '') || ':' || coalesce(manufacturer, '') || ':' || coalesce(line_name, '') || ':' || coalesce(quality, '') || ':' || coalesce(name, ''),
        '[^a-zA-Z0-9]+',
        '-',
        'g'
      ),
      '(^-|-$)',
      '',
      'g'
    ))
where catalog_key is null or catalog_key = '';

update public.catalog_materials
set public_url = coalesce(nullif(public_url, ''), nullif(image_url, ''), nullif(texture_url, '')),
    material_type = coalesce(nullif(material_type, ''), nullif(quality, '')),
    category = coalesce(nullif(category, ''), group_key),
    storage_bucket = coalesce(nullif(storage_bucket, ''), 'dcoratto-photos'),
    mime_type = case
      when coalesce(public_url, image_url, texture_url, '') ilike '%.webp%' then 'image/webp'
      else mime_type
    end,
    created_by = coalesce(nullif(created_by, ''), nullif(updated_by, ''), 'dcorattoinovacao@gmail.com')
where true;

with duplicated as (
  select id,
         catalog_key,
         row_number() over (partition by catalog_key order by updated_at desc nulls last, created_at desc nulls last, id) as rn
  from public.catalog_materials
  where catalog_key is not null and catalog_key <> ''
)
update public.catalog_materials cm
set catalog_key = duplicated.catalog_key || '-' || left(cm.id::text, 8)
from duplicated
where cm.id = duplicated.id
  and duplicated.rn > 1;

create unique index if not exists catalog_materials_catalog_key_uidx
on public.catalog_materials(catalog_key)
where catalog_key is not null;

create index if not exists catalog_materials_filter_idx
on public.catalog_materials(group_key, manufacturer, line_name, quality, sort_order);

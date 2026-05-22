insert into public.editor_settings (settings_key, payload, updated_by)
values ('default', '{}'::jsonb, 'catalog-recovery')
on conflict (settings_key) do nothing;

with recovered_catalog as (
  select coalesce(
    jsonb_agg(
      coalesce(data, '{}'::jsonb) || jsonb_build_object(
        'id', coalesce(data->>'id', lower(regexp_replace(group_key || '-' || name, '[^a-zA-Z0-9]+', '-', 'g'))),
        'type', coalesce(
          nullif(data->>'type', ''),
          case group_key
            when 'color' then 'color'
            when 'boa_vista_cores' then 'color'
            when 'madeira' then 'color'
            when 'laca' then 'color'
            when 'puxador' then 'handle'
            when 'porta' then 'door'
            when 'corredica' then 'slide'
            else ''
          end
        ),
        'manufacturer', coalesce(nullif(data->>'manufacturer', ''), manufacturer, ''),
        'line', coalesce(nullif(data->>'line', ''), line_name, ''),
        'name', coalesce(nullif(data->>'name', ''), name),
        'quality', coalesce(nullif(data->>'quality', ''), quality, ''),
        'hex', coalesce(nullif(data->>'hex', ''), hex, '#b8976a'),
        'textureUrl', coalesce(nullif(data->>'textureUrl', ''), image_data, image_url, texture_url, ''),
        'source', coalesce(nullif(data->>'source', ''), 'shared')
      )
      order by sort_order, name
    ) filter (
      where name <> ''
        and coalesce(
          nullif(data->>'type', ''),
          case group_key
            when 'color' then 'color'
            when 'boa_vista_cores' then 'color'
            when 'madeira' then 'color'
            when 'laca' then 'color'
            when 'puxador' then 'handle'
            when 'porta' then 'door'
            when 'corredica' then 'slide'
            else ''
          end
        ) <> ''
    ),
    '[]'::jsonb
  ) as items
  from public.catalog_materials
  where active = true
    and owner_email = 'dcorattoinovacao@gmail.com'
),
recovered_options as (
  select coalesce(jsonb_object_agg(group_key, labels), '{}'::jsonb) as options
  from (
    select group_key, jsonb_agg(label order by sort_order, label) as labels
    from public.catalog_options
    where active = true
      and group_key in ('tampon', 'porta', 'puxador', 'corredica')
    group by group_key
  ) grouped_options
),
merged_catalog as (
  select coalesce(jsonb_agg(item), '[]'::jsonb) as items
  from (
    select distinct on (
      lower(coalesce(item->>'id', '')),
      lower(coalesce(item->>'type', '')),
      lower(coalesce(item->>'manufacturer', '')),
      lower(coalesce(item->>'line', '')),
      lower(coalesce(item->>'name', '')),
      lower(coalesce(item->>'quality', ''))
    ) item
    from public.editor_settings es
    cross join recovered_catalog rc
    cross join jsonb_array_elements(coalesce(es.payload->'catalogItems', '[]'::jsonb) || rc.items) item
    where es.settings_key = 'default'
      and coalesce(item->>'name', '') <> ''
    order by
      lower(coalesce(item->>'id', '')),
      lower(coalesce(item->>'type', '')),
      lower(coalesce(item->>'manufacturer', '')),
      lower(coalesce(item->>'line', '')),
      lower(coalesce(item->>'name', '')),
      lower(coalesce(item->>'quality', ''))
  ) deduped
)
update public.editor_settings es
set payload = coalesce(es.payload, '{}'::jsonb)
  || jsonb_build_object(
    'catalogItems', mc.items,
    'materialOptions', coalesce(es.payload->'materialOptions', '{}'::jsonb) || ro.options
  ),
  updated_by = 'catalog-recovery'
from merged_catalog mc, recovered_options ro
where es.settings_key = 'default';

insert into public.editor_settings (settings_key, payload, updated_by)
values ('default', '{}'::jsonb, 'settings-source-of-truth')
on conflict (settings_key) do nothing;

with settings as (
  select payload
  from public.editor_settings
  where settings_key = 'default'
    and payload ? 'catalogItems'
),
active_materials as (
  select
    case item->>'type'
      when 'color' then 'color'
      when 'handle' then 'puxador'
      when 'door' then 'porta'
      when 'slide' then 'corredica'
      else coalesce(nullif(item->>'type', ''), 'material')
    end as group_key,
    item->>'name' as name
  from settings
  cross join jsonb_array_elements(coalesce(payload->'catalogItems', '[]'::jsonb)) item
  where coalesce(item->>'name', '') <> ''
),
managed_material_groups as (
  select unnest(array['color', 'puxador', 'porta', 'corredica']) as group_key
)
update public.catalog_materials cm
set active = false,
    updated_by = 'settings-source-of-truth'
where cm.owner_email = 'dcorattoinovacao@gmail.com'
  and cm.group_key in (select group_key from managed_material_groups)
  and exists (select 1 from settings)
  and not exists (
    select 1
    from active_materials am
    where am.group_key = cm.group_key
      and am.name = cm.name
  );

with settings as (
  select payload
  from public.editor_settings
  where settings_key = 'default'
    and payload ? 'materialOptions'
),
active_options as (
  select option_group.key as group_key, option_label.value #>> '{}' as label
  from settings
  cross join jsonb_each(coalesce(payload->'materialOptions', '{}'::jsonb)) option_group
  cross join jsonb_array_elements(coalesce(option_group.value, '[]'::jsonb)) option_label
  where coalesce(option_label.value #>> '{}', '') <> ''
),
managed_option_groups as (
  select unnest(array['tampon', 'porta', 'puxador', 'corredica']) as group_key
)
update public.catalog_options co
set active = false,
    updated_by = 'settings-source-of-truth'
where co.owner_email = 'dcorattoinovacao@gmail.com'
  and co.group_key in (select group_key from managed_option_groups)
  and exists (select 1 from settings)
  and not exists (
    select 1
    from active_options ao
    where ao.group_key = co.group_key
      and ao.label = co.label
  );

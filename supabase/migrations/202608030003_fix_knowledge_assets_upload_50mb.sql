-- Corrige o bucket realmente usado pelo upload assinado mostrado no navegador:
-- storage/v1/object/upload/sign/knowledge-assets/...
--
-- Preserva visibilidade, policies e MIME types existentes. Caso o bucket ja tenha
-- restricao de MIME, apenas acrescenta os formatos de video aceitos pelo upload.
do $$
declare
  current_allowed_mime_types text[];
begin
  select allowed_mime_types
    into current_allowed_mime_types
  from storage.buckets
  where id = 'knowledge-assets'
  for update;

  if not found then
    raise notice 'Bucket knowledge-assets nao encontrado; nenhuma configuracao foi alterada.';
    return;
  end if;

  update storage.buckets
  set
    file_size_limit = 52428800,
    allowed_mime_types = case
      -- NULL significa sem restricao por MIME. Preserve esse comportamento.
      when current_allowed_mime_types is null then null
      else (
        select array_agg(distinct mime_type)
        from unnest(
          current_allowed_mime_types || array[
            'video/mp4',
            'video/webm',
            'video/quicktime',
            'video/x-m4v'
          ]::text[]
        ) as allowed(mime_type)
      )
    end
  where id = 'knowledge-assets';
end
$$;

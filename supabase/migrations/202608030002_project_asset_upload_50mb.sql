-- Mantem o bucket de midias do projeto com limite de 50 MiB por arquivo
-- e libera os formatos de video usados pelo editor e pelo link do cliente.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dcoratto-photos',
  'dcoratto-photos',
  true,
  52428800,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-m4v'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

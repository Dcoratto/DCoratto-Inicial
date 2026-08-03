-- Mantem o limite do bucket alinhado ao limite de 50 MB validado pela aplicacao.
update storage.buckets
set file_size_limit = 52428800
where id = 'knowledge-assets';

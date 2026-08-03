-- Accelerates idempotent client-link retries without scanning all HTML versions.
create index if not exists document_html_versions_client_event_idx
  on public.document_html_versions ((data ->> 'eventId'))
  where shared_with_client = true
    and (data ->> 'eventId') is not null;

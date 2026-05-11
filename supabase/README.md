# Supabase

Este diretorio contem a estrutura persistente do construtor D'coratto.

## Ordem para rodar no Supabase SQL Editor

1. Execute `schema.sql`.
2. Execute `seed.sql`.
3. Copie `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` do projeto Supabase para `.env.local`.

## Tabelas principais

- `document_projects`: cabecalho do projeto, cliente, contrato e estado geral.
- `document_environments`: ambientes configurados no construtor.
- `environment_photos`: fotos ilimitadas do mural por ambiente, com ordem, titulo, legenda, layout e caminho no Storage.
- `environment_colors`: cores selecionadas por ambiente de forma normalizada.
- `environment_materials`: materiais, portas, puxadores e tamponamentos por ambiente.
- `environment_notes`: observacoes, anotacoes e alertas por ambiente.
- `document_html_versions`: HTML final persistido, versionado e marcavel como atual.
- `document_versions`: snapshots gerais de autosave.
- `catalog_colors`, `catalog_options`, `catalog_materials`: catalogos reaproveitaveis pelo construtor.
- `project_document_payload`: view agregada para renderizar o HTML final a partir de um unico payload.

## Buckets de Storage

O `schema.sql` cria/configura:

- `dcoratto-photos`: imagens dos ambientes.
- `dcoratto-html`: HTML final entregue ao cliente.

## Observacao de seguranca

As policies atuais estao abertas para acelerar o desenvolvimento local. Antes de producao, devemos trocar para policies autenticadas por usuario/organizacao.

## Fluxo persistente esperado

1. O construtor salva `document_projects` e `document_environments`.
2. As selecoes tecnicas sao gravadas em `environment_materials`, `environment_colors` e `environment_notes`.
3. As fotos sao enviadas para o bucket `dcoratto-photos` e registradas em `environment_photos`.
4. O preview le `project_document_payload`.
5. O HTML final gerado e salvo em `document_html_versions` e no bucket `dcoratto-html`.
6. A versao atual fica apontada em `document_projects.current_html_id`.

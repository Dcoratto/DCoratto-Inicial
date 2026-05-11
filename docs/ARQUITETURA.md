# Arquitetura do Construtor D'coratto

## Fonte oficial do frontend

O arquivo oficial do frontend e ponto de partida visual e funcional e:

`public/editor_projeto_inicial.html`

Ele foi copiado do HTML recebido via WhatsApp:

`editor_projeto_inicial - HTML.html`

Por enquanto, esse HTML deve ser tratado como fonte de verdade da interface. Qualquer evolucao do app deve trabalhar em cima dele, sem recriar a experiencia visual do zero.

## Objetivo do construtor

O construtor deve capturar dados estruturados de projeto inicial e persistir tudo no Supabase com robustez:

- dados do cliente;
- contrato;
- fabrica/promob;
- endereco da obra;
- ambientes;
- imagens dos ambientes;
- cores por ambiente;
- tamponamentos;
- portas;
- puxadores;
- observacoes padrao;
- observacoes livres;
- versoes/snapshots do documento.

## Padrao do documento final

O documento final deve seguir o padrao do portfolio estruturado:

- cada ambiente ocupa secoes previsiveis;
- titulo do ambiente em posicao padrao;
- cores sempre no mesmo bloco;
- observacoes sempre no mesmo bloco;
- especificacoes tecnicas sempre na mesma hierarquia visual;
- preview serve para finalizar ajustes antes de gerar o PDF.

Mesmo quando os conteudos mudarem, a posicao e a hierarquia visual devem continuar padronizadas.

## Papel do Supabase

Supabase sera a fonte persistente e confiavel. O frontend nao deve depender apenas de estado local do navegador.

Camadas previstas:

- `document_projects`: cabecalho e metadados do projeto;
- `document_environments`: dados estruturados por ambiente;
- `catalog_colors`: catalogo de cores;
- `catalog_options`: opcoes padrao de portas, puxadores, tamponamentos e observacoes;
- `document_versions`: snapshots de autosave e historico.

## Direcao de implementacao

1. Manter o HTML oficial carregado no front.
2. Mapear os campos do HTML para um modelo de dados estruturado.
3. Persistir cada alteracao relevante no Supabase.
4. Criar um preview de documento final que consome os mesmos dados.
5. Ajustar o preview para ficar igual ao portfolio estruturado.
6. Gerar PDF a partir do preview final.

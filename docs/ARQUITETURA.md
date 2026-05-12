# Arquitetura do Construtor D'coratto

## Estrutura oficial do frontend

O ponto de entrada do front e o `index.html` na raiz. Ele carrega a aplicacao React em `src/main.jsx`.

A casca React exibe o construtor e o preview dentro de iframes. Por isso, os HTMLs grandes ficam em `public/`, onde o Vite os publica diretamente por URL:

`public/editor_projeto_inicial.html`

`public/portfolio_document.html`

No build, o Vite copia esses arquivos para `dist/`. Em producao, o servidor Node serve apenas o conteudo gerado em `dist/`.

Nao deve existir outro `editor_projeto_inicial.html` na raiz do projeto. Isso cria ambiguidade no deploy e pode fazer a producao servir uma copia antiga. Qualquer evolucao visual ou funcional do construtor deve ser feita em `public/editor_projeto_inicial.html`.

Arquivos de referencia, como PDFs de catalogo, devem ficar em `docs/referencias/`. Assets usados pelo app em runtime devem ficar em `public/`.

## Objetivo do construtor

O construtor deve capturar dados estruturados de projeto inicial e persistir tudo no Supabase com robustez:

- dados do cliente;
- contrato;
- fabrica/promob;
- endereco da obra;
- ambientes;
- imagens dos ambientes;
- mural com 1 a 5 fotos por ambiente;
- cores por ambiente;
- tamponamentos;
- portas;
- puxadores;
- observacoes padrao;
- observacoes livres;
- versoes/snapshots do documento.

## Padrao do documento final

O documento final sera HTML navegavel, nao PDF fechado. Ele deve seguir o padrao do portfolio estruturado:

- cada ambiente ocupa secoes previsiveis;
- titulo do ambiente em posicao padrao;
- cores sempre no mesmo bloco;
- observacoes sempre no mesmo bloco;
- especificacoes tecnicas sempre na mesma hierarquia visual;
- fotos do ambiente ficam em um mural ornamentado;
- ao clicar em uma foto, ela expande em lightbox;
- preview serve para finalizar ajustes antes de publicar/entregar o HTML.

Mesmo quando os conteudos mudarem, a posicao e a hierarquia visual devem continuar padronizadas.

## Padrao do mural por ambiente

Cada ambiente pode ter fotos ilimitadas. O preview oferece sugestoes de layout conforme a quantidade enviada.

- 1 foto: ocupa o mural inteiro;
- 2 fotos: divide o mural ao meio;
- 3 fotos: uma imagem maior e duas imagens de apoio;
- 4 fotos: grade equilibrada 2x2;
- 5 fotos: composicao editorial com imagem principal e apoios.
- acima de 5 fotos: grade fluida ou composicao editorial repetivel, sempre mantendo ritmo visual.

Ao passar o mouse sobre uma foto, ela deve ter movimento sutil e revelar a legenda pequena, como `Vista 1`, `Vista 2`, etc. Ao clicar, a imagem deve expandir em lightbox.

As informacoes selecionadas no construtor aparecem exclusivamente no painel direito do ambiente:

- tamponamentos;
- portas;
- puxadores;
- cores;
- observacoes.

## Papel do Supabase

Supabase sera a fonte persistente e confiavel. O frontend nao deve depender apenas de estado local do navegador.

Camadas previstas:

- `document_projects`: cabecalho e metadados do projeto;
- `document_environments`: dados estruturados por ambiente;
- `environment_photos`: fotos ordenadas por ambiente, com titulo e imagem;
- `environment_colors`: cores normalizadas por ambiente;
- `environment_materials`: materiais e especificacoes tecnicas por ambiente;
- `environment_notes`: observacoes/anotacoes por ambiente;
- `document_html_versions`: HTML final persistido e versionado;
- `catalog_colors`: catalogo de cores;
- `catalog_options`: opcoes padrao de portas, puxadores, tamponamentos e observacoes;
- `document_versions`: snapshots de autosave e historico.

## Direcao de implementacao

1. Manter o HTML oficial carregado no front.
2. Mapear os campos do HTML para um modelo de dados estruturado.
3. Persistir cada alteracao relevante no Supabase.
4. Criar um preview de documento final que consome os mesmos dados.
5. Ajustar o preview para ficar igual ao portfolio estruturado.
6. Gerar HTML final navegavel a partir do preview.

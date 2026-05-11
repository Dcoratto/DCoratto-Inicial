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

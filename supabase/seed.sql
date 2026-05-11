insert into public.catalog_colors (name, hex, sort_order) values
  ('BEGE DUNAS', '#c8b89a', 10),
  ('CARVALHO JARI', '#a0784a', 20),
  ('BRANCO SNOW', '#f5f3ef', 30),
  ('CINZA SAGRADO', '#8a8a8a', 40),
  ('GRAFITE', '#4a4a4a', 50),
  ('OFF WHITE', '#f0ede6', 60),
  ('MACADAMIA', '#c4a882', 70),
  ('PRETO PIANO', '#1a1a1a', 80),
  ('NOGUEIRA', '#6b4c32', 90),
  ('AREIA', '#d4c4a8', 100)
on conflict (name) do update set
  hex = excluded.hex,
  sort_order = excluded.sort_order,
  active = true;

insert into public.catalog_options (group_key, label, sort_order) values
  ('tamponamentos', '15mm', 10),
  ('tamponamentos', '25mm', 20),
  ('tamponamentos', '15mm e 25mm', 30),
  ('tamponamentos', '6mm', 40),
  ('tamponamentos', '15mm e 6mm', 50),
  ('portas', 'LISA', 10),
  ('portas', 'CAVA 45°', 20),
  ('portas', 'PASSANTE', 30),
  ('portas', 'FRISO', 40),
  ('portas', 'ROMEU E JULIETA', 50),
  ('portas', 'AMERICANA', 60),
  ('portas', 'ESPELHO', 70),
  ('puxadores', 'CAVA 45°', 10),
  ('puxadores', 'GARD 256mm', 20),
  ('puxadores', 'PASSANTE', 30),
  ('puxadores', 'LISA PASSANTE', 40),
  ('puxadores', 'EMBUTIDO', 50),
  ('puxadores', 'PUXADOR J', 60),
  ('puxadores', 'PUXADOR L', 70),
  ('observacoes', 'Apenas Marcenaria considerado no ambiente', 10),
  ('observacoes', 'Apenas Marcenaria e serralheria considerados no ambiente', 20),
  ('observacoes', 'Leds nao inclusos', 30),
  ('observacoes', 'Considerar cavas para instalacao de LEDS', 40),
  ('observacoes', 'Eletrodomesticos nao inclusos', 50)
on conflict (group_key, label) do update set
  sort_order = excluded.sort_order,
  active = true;

insert into public.catalog_materials (group_key, name, code, brand, hex, sort_order) values
  ('madeira', 'CARVALHO JARI', 'CARVALHO-JARI', 'Dcoratto', '#a0784a', 10),
  ('madeira', 'NOGUEIRA', 'NOGUEIRA', 'Dcoratto', '#6b4c32', 20),
  ('madeira', 'BEGE DUNAS', 'BEGE-DUNAS', 'Dcoratto', '#c8b89a', 30),
  ('laca', 'GRAFITE', 'GRAFITE', 'Dcoratto', '#4a4a4a', 40),
  ('laca', 'BRANCO SNOW', 'BRANCO-SNOW', 'Dcoratto', '#f5f3ef', 50),
  ('laca', 'OFF WHITE', 'OFF-WHITE', 'Dcoratto', '#f0ede6', 60),
  ('puxador', 'CAVA 45°', 'CAVA-45', 'Dcoratto', null, 70),
  ('puxador', 'PASSANTE', 'PASSANTE', 'Dcoratto', null, 80),
  ('porta', 'LISA', 'LISA', 'Dcoratto', null, 90),
  ('porta', 'FRISO', 'FRISO', 'Dcoratto', null, 100),
  ('tamponamento', '15mm', '15MM', 'Dcoratto', null, 110),
  ('tamponamento', '25mm', '25MM', 'Dcoratto', null, 120)
on conflict (group_key, name) do update set
  code = excluded.code,
  brand = excluded.brand,
  hex = excluded.hex,
  sort_order = excluded.sort_order,
  active = true;

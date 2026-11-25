-- Identidade do campeonato escolar, no mesmo modelo dos campeonatos do sistema: logo, responsavel e patrocinadores.
-- As imagens ficam no bucket publico 'marcas' (pasta escola/<campeonato>/), onde so a Secretaria grava (politica marcas_secretaria).
alter table esc_campeonatos
  add column logo_path     text,
  add column responsavel   text check (length(responsavel) <= 60),
  add column patrocinadores jsonb not null default '[]' check (jsonb_typeof(patrocinadores) = 'array' and jsonb_array_length(patrocinadores) <= 12);   -- [{nome, logo_path}]

-- COMO DESFAZER: alter table esc_campeonatos drop column logo_path, drop column responsavel, drop column patrocinadores;

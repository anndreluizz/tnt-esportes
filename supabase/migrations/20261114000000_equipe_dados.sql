-- Equipe mais completa: escudo, responsável/técnico (com WhatsApp, só a Secretaria vê), cores do uniforme.
-- Bairro vira opcional (texto livre: bairro, comunidade, escola...).
alter table equipes
  alter column bairro drop not null,
  add column escudo_path          text,
  add column responsavel          text check (length(responsavel) <= 60),
  add column responsavel_telefone text check (length(responsavel_telefone) <= 20),
  add column cores                text check (length(cores) <= 40);

-- portal: escudo e cores são públicos; responsável e telefone, não
create or replace view equipes_publico as select id, campeonato_id, nome, bairro, pote, grupo, escudo_path, cores from equipes;

-- página do link de inscrição mostra o escudo da equipe
create or replace function link_inscricao(t uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('equipe_id', e.id, 'equipe', e.nome, 'escudo', e.escudo_path, 'campeonato', c.nome, 'modalidade', c.modalidade, 'categoria', c.categoria,
    'idade_min', c.idade_min, 'idade_max', c.idade_max, 'inicio', c.inicio, 'local', c.local, 'logo', c.logo_path,
    'patrocinadores', c.patrocinadores, 'inscricao_ate', c.inscricao_ate, 'max_atletas', c.max_atletas, 'aberta', inscricoes_abertas(c),
    'inscritos', (select coalesce(jsonb_agg(jsonb_build_object('nome', a.nome, 'numero', a.numero) order by a.numero), '[]')
                  from atletas a where a.equipe_id = e.id))
  from equipes e join campeonatos c on c.id = e.campeonato_id where e.link_token = t
$$;

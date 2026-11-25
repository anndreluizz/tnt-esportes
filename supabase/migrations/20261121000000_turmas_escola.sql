-- Campeonato interno da escola (07 a 09/12/2026): organizado POR TURMA, em varias modalidades.
-- Tabelas NOVAS com prefixo esc_: nao alteram nada do motor de campeonatos/equipes/jogos que ja existe.
-- Regras em aberto (nao decididas aqui): ver PENDENCIAS.md. Procure por "TODO" neste arquivo.

create table esc_campeonatos (
  id     uuid primary key default gen_random_uuid(),
  nome   text not null check (length(nome) between 5 and 80),
  inicio date not null,
  fim    date not null,
  local  text not null default 'A definir' check (length(local) <= 80),
  inscricoes_abertas boolean not null default true,   -- professores so inscrevem alunos enquanto aberto
  check (fim >= inicio)
);

-- Regras editaveis por modalidade. Futsal: 5 em quadra + reservas, 2 tempos de 10 min, SEM pontuacao (confronto: mata-mata, empate vai a penaltis).
-- TODO: confirmar o maximo de reservas por time e as regras da queimada.
create table esc_modalidades (
  id                  uuid primary key default gen_random_uuid(),
  campeonato_id       uuid not null references esc_campeonatos on delete cascade,
  nome                text not null check (length(nome) between 3 and 30),
  jogadores_por_time  smallint not null default 5   check (jogadores_por_time between 1 and 30),   -- em quadra
  reservas_max        smallint not null default 5   check (reservas_max between 0 and 30),
  tempos              smallint not null default 2   check (tempos between 1 and 4),
  tempo_min           smallint not null default 10  check (tempo_min between 1 and 90),
  outras_regras       jsonb not null default '{}',
  unique (campeonato_id, nome)
);

-- O nome e dado livre ("1º ano 2", "2º ano 2"...). TODO: confirmar o nome exato das turmas com a escola.
create table esc_turmas (
  id            uuid primary key default gen_random_uuid(),
  campeonato_id uuid not null references esc_campeonatos on delete cascade,
  nome          text not null check (length(nome) between 2 and 40),
  unique (campeonato_id, nome),
  unique (id, campeonato_id)
);

create table esc_times (
  id            uuid primary key default gen_random_uuid(),
  campeonato_id uuid not null,
  turma_id      uuid not null,
  modalidade_id uuid not null references esc_modalidades on delete cascade,
  genero        text not null check (genero in ('masculino', 'feminino')),
  nome          text not null check (length(nome) between 2 and 40),
  token         uuid not null unique default gen_random_uuid(),   -- link secreto do professor do time (nunca exposto por select)
  foreign key (turma_id, campeonato_id) references esc_turmas (id, campeonato_id) on delete cascade,
  unique (id, turma_id, modalidade_id, genero),
  unique (turma_id, modalidade_id, genero, nome)
);

-- Elenco: quem o professor inscreve. Nomes visiveis ao publico (decisao do organizador; menores de idade: a escola deve autorizar).
create table esc_jogadores (
  id      uuid primary key default gen_random_uuid(),
  time_id uuid not null references esc_times on delete cascade,
  nome    text not null check (length(nome) between 2 and 80)
);
create unique index on esc_jogadores (time_id, lower(nome));

-- Mata-mata: sem pontos. Empate nos tempos regulares decide-se por penaltis. Colete: o lado A usa colete_a, o lado B o outro.
-- Cada partida guarda turma/modalidade/genero e referencia os dois times com essas mesmas colunas:
-- o proprio banco impede jogo entre turmas, modalidades ou generos diferentes.
create table esc_partidas (
  id            uuid primary key default gen_random_uuid(),
  turma_id      uuid not null,
  modalidade_id uuid not null,
  genero        text not null,
  time_a_id     uuid not null,
  time_b_id     uuid not null,
  placar_a      smallint check (placar_a >= 0),
  placar_b      smallint check (placar_b >= 0),
  penaltis_a    smallint check (penaltis_a >= 0),
  penaltis_b    smallint check (penaltis_b >= 0),
  fase          text not null default 'final' check (length(fase) between 3 and 30),   -- TODO: fases (quartas, semifinal, final...) conforme o numero de times
  colete_a      text not null default 'azul' check (colete_a in ('azul', 'vermelho')),
  vencedor_id   uuid,   -- calculado pelo gatilho; nulo = nao jogada ou empate
  foreign key (time_a_id, turma_id, modalidade_id, genero) references esc_times (id, turma_id, modalidade_id, genero) on delete cascade,
  foreign key (time_b_id, turma_id, modalidade_id, genero) references esc_times (id, turma_id, modalidade_id, genero) on delete cascade,
  check (time_a_id <> time_b_id),
  check ((placar_a is null) = (placar_b is null)),
  check ((penaltis_a is null) = (penaltis_b is null)),
  check (penaltis_a is null or (placar_a = placar_b and penaltis_a <> penaltis_b))   -- penaltis so no empate e nunca empatam
);
create unique index on esc_partidas (least(time_a_id, time_b_id), greatest(time_a_id, time_b_id), fase);   -- um confronto por par e fase

/* ---------------- regras de cadastro ---------------- */
create function esc_time_antes_gravar() returns trigger language plpgsql as $$
begin
  if (select campeonato_id from esc_modalidades where id = new.modalidade_id) is distinct from new.campeonato_id then
    raise exception 'modalidade e turma sao de campeonatos diferentes';
  end if;
  return new;
end $$;
create trigger esc_time_antes_gravar before insert or update on esc_times for each row execute function esc_time_antes_gravar();

create function esc_partida_antes_gravar() returns trigger language plpgsql as $$
begin
  new.vencedor_id := case
    when new.placar_a is null then null
    when new.placar_a > new.placar_b then new.time_a_id
    when new.placar_a < new.placar_b then new.time_b_id
    when new.penaltis_a is null then null            -- empate sem penaltis ainda: sem vencedor
    when new.penaltis_a > new.penaltis_b then new.time_a_id
    else new.time_b_id end;
  return new;
end $$;
create trigger esc_partida_antes_gravar before insert or update on esc_partidas for each row execute function esc_partida_antes_gravar();

create function esc_jogador_antes_gravar() returns trigger language plpgsql as $$
begin
  if (select count(*) from esc_jogadores where time_id = new.time_id and id is distinct from new.id)
     >= (select m.jogadores_por_time + m.reservas_max from esc_times t join esc_modalidades m on m.id = t.modalidade_id where t.id = new.time_id) then
    raise exception 'elenco cheio (titulares + reservas)';
  end if;
  return new;
end $$;
create trigger esc_jogador_antes_gravar before insert or update on esc_jogadores for each row execute function esc_jogador_antes_gravar();

/* ---------------- campeao da turma ---------------- */
-- Campeao por turma + modalidade + genero = vencedor da partida de fase 'final' (se ja decidida).
create function esc_campeoes_turma(p_campeonato uuid) returns table (turma_id uuid, modalidade_id uuid, genero text, campeao_id uuid)
language sql stable security invoker as $$
  select p.turma_id, p.modalidade_id, p.genero, p.vencedor_id
  from esc_partidas p join esc_turmas t on t.id = p.turma_id
  where t.campeonato_id = p_campeonato and p.fase = 'final' and p.vencedor_id is not null
$$;

-- Titulo da TURMA (separado do campeao por genero, de proposito).
-- TODO: definir regra de titulo (so o masculino vale? a turma precisa vencer tambem o feminino?).
-- Enquanto isso devolve os campeoes por genero, sem decidir o titulo da turma.
create function esc_titulo_turma(p_campeonato uuid) returns table (turma_id uuid, modalidade_id uuid, genero text, campeao_id uuid)
language sql stable security invoker as $$ select * from esc_campeoes_turma(p_campeonato) $$;

/* ---------------- permissoes: leitura publica, escrita so da Secretaria ---------------- */
alter table esc_campeonatos enable row level security;
alter table esc_modalidades enable row level security;
alter table esc_turmas      enable row level security;
alter table esc_times       enable row level security;
alter table esc_jogadores   enable row level security;
alter table esc_partidas    enable row level security;

revoke all on esc_campeonatos, esc_modalidades, esc_turmas, esc_times, esc_jogadores, esc_partidas from anon, authenticated;
grant select on esc_campeonatos, esc_modalidades, esc_turmas, esc_jogadores, esc_partidas to anon, authenticated;
grant select (id, campeonato_id, turma_id, modalidade_id, genero, nome) on esc_times to anon, authenticated;   -- sem a coluna token
grant insert, update, delete on esc_campeonatos, esc_modalidades, esc_turmas, esc_times, esc_jogadores, esc_partidas to authenticated;

create policy publico    on esc_campeonatos for select using (true);
create policy publico    on esc_modalidades for select using (true);
create policy publico    on esc_turmas      for select using (true);
create policy publico    on esc_times       for select using (true);
create policy publico    on esc_jogadores   for select using (true);
create policy publico    on esc_partidas    for select using (true);
create policy secretaria on esc_campeonatos for all to authenticated using (e_secretaria()) with check (e_secretaria());
create policy secretaria on esc_modalidades for all to authenticated using (e_secretaria()) with check (e_secretaria());
create policy secretaria on esc_turmas      for all to authenticated using (e_secretaria()) with check (e_secretaria());
create policy secretaria on esc_times       for all to authenticated using (e_secretaria()) with check (e_secretaria());
create policy secretaria on esc_jogadores   for all to authenticated using (e_secretaria()) with check (e_secretaria());
create policy secretaria on esc_partidas    for all to authenticated using (e_secretaria()) with check (e_secretaria());

/* ---------------- professor: inscreve alunos pelo link secreto do time (sem login) ---------------- */
create function esc_meu_time(p_token uuid) returns table (time_id uuid, time_nome text, turma_nome text, modalidade_nome text, genero text, vagas int, inscricoes_abertas boolean)
language sql stable security definer set search_path = public as $$
  select t.id, t.nome, u.nome, m.nome, t.genero, m.jogadores_por_time + m.reservas_max, c.inscricoes_abertas
  from esc_times t join esc_turmas u on u.id = t.turma_id join esc_modalidades m on m.id = t.modalidade_id join esc_campeonatos c on c.id = t.campeonato_id
  where t.token = p_token
$$;

create function esc_inscrever_jogador(p_token uuid, p_nome text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_time uuid; v_id uuid;
begin
  select t.id into v_time from esc_times t join esc_campeonatos c on c.id = t.campeonato_id where t.token = p_token and c.inscricoes_abertas;
  if v_time is null then raise exception 'link invalido ou inscricoes encerradas'; end if;
  insert into esc_jogadores (time_id, nome) values (v_time, btrim(p_nome)) returning id into v_id;
  return v_id;
end $$;

create function esc_remover_jogador(p_token uuid, p_jogador uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from esc_jogadores j using esc_times t, esc_campeonatos c
   where j.id = p_jogador and t.id = j.time_id and t.token = p_token and c.id = t.campeonato_id and c.inscricoes_abertas;
  if not found then raise exception 'link invalido, jogador inexistente ou inscricoes encerradas'; end if;
end $$;

-- Links dos professores: so a Secretaria enxerga os tokens.
create function esc_links_times(p_campeonato uuid) returns table (time_id uuid, token uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if not e_secretaria() then raise exception 'apenas a Secretaria'; end if;
  return query select t.id, t.token from esc_times t where t.campeonato_id = p_campeonato;
end $$;

revoke execute on function esc_campeoes_turma(uuid), esc_titulo_turma(uuid), esc_time_antes_gravar(), esc_partida_antes_gravar(), esc_jogador_antes_gravar(),
  esc_meu_time(uuid), esc_inscrever_jogador(uuid, text), esc_remover_jogador(uuid, uuid), esc_links_times(uuid) from public;
grant execute on function esc_campeoes_turma(uuid), esc_titulo_turma(uuid), esc_meu_time(uuid), esc_inscrever_jogador(uuid, text), esc_remover_jogador(uuid, uuid) to anon, authenticated;
grant execute on function esc_links_times(uuid) to authenticated;

-- COMO DESFAZER (so tabelas novas, nada existente e tocado):
--   drop function esc_titulo_turma(uuid), esc_campeoes_turma(uuid);
--   drop function esc_meu_time(uuid), esc_inscrever_jogador(uuid, text), esc_remover_jogador(uuid, uuid), esc_links_times(uuid), esc_jogador_antes_gravar();
--   drop table esc_partidas, esc_jogadores, esc_times, esc_turmas, esc_modalidades, esc_campeonatos cascade;
--   drop function esc_time_antes_gravar(), esc_partida_antes_gravar();

-- Link por TURMA: o professor responsavel pela turma (ex.: '2º ano 01') organiza os times A/B/C... da sua turma, masculino e feminino, num link so.
-- A turma de um time e o prefixo do nome ('2º ano 01 - A' -> '2º ano 01'). Reaproveita as regras dos links por time (elenco, inscricoes abertas).
create table esc_turma_links (
  campeonato_id uuid not null references esc_campeonatos (id) on delete cascade,
  origem        text not null check (length(origem) between 2 and 40),
  token         uuid not null unique default gen_random_uuid(),
  primary key (campeonato_id, origem)
);
alter table esc_turma_links enable row level security;
revoke all on esc_turma_links from anon, authenticated;

create function esc_origem(p_nome text) returns text language sql immutable as $$ select regexp_replace(p_nome, ' - [^ ]+$', '') $$;

-- Secretaria: cria (se faltar) e lista o link de cada turma, com professor e contagens
create function esc_links_turmas(p_campeonato uuid) returns table (origem text, token uuid, professor text, times int, alunos int)
language plpgsql security definer set search_path = public as $$
begin
  if not e_secretaria() then raise exception 'apenas a Secretaria'; end if;
  insert into esc_turma_links (campeonato_id, origem)
    select distinct p_campeonato, esc_origem(t.nome) from esc_times t where t.campeonato_id = p_campeonato and t.nome ~ ' - [^ ]+$' on conflict do nothing;
  return query select l.origem, l.token,
    (select max(t.professor) from esc_times t where t.campeonato_id = l.campeonato_id and t.nome ~ ' - [^ ]+$' and esc_origem(t.nome) = l.origem),
    (select count(*)::int from esc_times t where t.campeonato_id = l.campeonato_id and t.nome ~ ' - [^ ]+$' and esc_origem(t.nome) = l.origem),
    (select count(*)::int from esc_jogadores j join esc_times t on t.id = j.time_id where t.campeonato_id = l.campeonato_id and t.nome ~ ' - [^ ]+$' and esc_origem(t.nome) = l.origem)
  from esc_turma_links l where l.campeonato_id = p_campeonato order by l.origem;
end $$;

create function esc_turma_meu(p_token uuid) returns table (origem text, professor text, inscricoes_abertas boolean)
language sql stable security definer set search_path = public as $$
  select l.origem, (select max(t.professor) from esc_times t where t.campeonato_id = l.campeonato_id and t.nome ~ ' - [^ ]+$' and esc_origem(t.nome) = l.origem), c.inscricoes_abertas
  from esc_turma_links l join esc_campeonatos c on c.id = l.campeonato_id where l.token = p_token
$$;

create function esc_turma_times(p_token uuid) returns table (time_id uuid, time_nome text, modalidade_nome text, genero text, vagas int)
language sql stable security definer set search_path = public as $$
  select t.id, t.nome, m.nome, t.genero, m.jogadores_por_time + m.reservas_max
  from esc_turma_links l join esc_times t on t.campeonato_id = l.campeonato_id and t.nome ~ ' - [^ ]+$' and esc_origem(t.nome) = l.origem
  join esc_modalidades m on m.id = t.modalidade_id where l.token = p_token order by m.nome, t.genero, t.nome
$$;

create function esc_turma_candidatos(p_token uuid) returns table (nome text)
language sql stable security definer set search_path = public as $$
  select c.nome from esc_turma_links l join esc_candidatos c on c.campeonato_id = l.campeonato_id and c.origem = l.origem where l.token = p_token order by c.nome
$$;

create function esc_turma_inscrever(p_token uuid, p_time uuid, p_nome text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select t.token into v from esc_turma_links l join esc_times t on t.campeonato_id = l.campeonato_id and t.nome ~ ' - [^ ]+$' and esc_origem(t.nome) = l.origem
   where l.token = p_token and t.id = p_time;
  if v is null then raise exception 'link invalido'; end if;
  return esc_inscrever_jogador(v, p_nome);
end $$;

create function esc_turma_remover(p_token uuid, p_jogador uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select t.token into v from esc_turma_links l join esc_times t on t.campeonato_id = l.campeonato_id and t.nome ~ ' - [^ ]+$' and esc_origem(t.nome) = l.origem
   join esc_jogadores j on j.time_id = t.id where l.token = p_token and j.id = p_jogador;
  if v is null then raise exception 'link invalido'; end if;
  perform esc_remover_jogador(v, p_jogador);
end $$;

-- o professor da turma escreve o proprio nome: vale para todos os times da turma
create function esc_turma_definir_professor(p_token uuid, p_nome text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update esc_times t set professor = btrim(regexp_replace(p_nome, '\s+', ' ', 'g'))
   from esc_turma_links l join esc_campeonatos c on c.id = l.campeonato_id
   where l.token = p_token and c.inscricoes_abertas and t.campeonato_id = l.campeonato_id and t.nome ~ ' - [^ ]+$' and esc_origem(t.nome) = l.origem;
  if not found then raise exception 'link invalido ou inscricoes encerradas'; end if;
end $$;

revoke execute on function esc_links_turmas(uuid), esc_turma_meu(uuid), esc_turma_times(uuid), esc_turma_candidatos(uuid), esc_turma_inscrever(uuid, uuid, text),
  esc_turma_remover(uuid, uuid), esc_turma_definir_professor(uuid, text) from public;
grant execute on function esc_turma_meu(uuid), esc_turma_times(uuid), esc_turma_candidatos(uuid), esc_turma_inscrever(uuid, uuid, text),
  esc_turma_remover(uuid, uuid), esc_turma_definir_professor(uuid, text) to anon, authenticated;
grant execute on function esc_links_turmas(uuid) to authenticated;

-- COMO DESFAZER: drop function esc_turma_definir_professor(uuid, text), esc_turma_remover(uuid, uuid), esc_turma_inscrever(uuid, uuid, text), esc_turma_candidatos(uuid),
--   esc_turma_times(uuid), esc_turma_meu(uuid), esc_links_turmas(uuid), esc_origem(text); drop table esc_turma_links;

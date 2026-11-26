-- Queimada: UM time por turma, meninos e meninas juntos ('misto'), sem limite de jogadores (a maior turma tem 29 alunos; o banco aceita ate 30).
-- Todos os alunos da lista da turma entram nesse time. Regra do jogo: vence quem eliminar todos primeiro; se o tempo (10 min) acabar, vence quem eliminou mais.

-- 1) genero 'misto' nos times (partidas herdam o genero do time, entao o jogo misto tambem passa)
alter table esc_times drop constraint esc_times_genero_check;
alter table esc_times add constraint esc_times_genero_check check (genero in ('masculino', 'feminino', 'misto'));

-- 2) capacidade da queimada: 30 na lista, sem reservas (o limite real e a propria turma)
update esc_modalidades set jogadores_por_time = 30, reservas_max = 0 where nome = 'Queimada';

-- 3) Professor da turma: cria (se faltar) o time misto da turma, passa para ele quem estava nos times separados e
--    coloca todos os alunos da lista. So funciona com inscricoes abertas e enquanto a turma nao tem jogo de queimada.
create function esc_turma_queimada_unica(p_token uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l esc_turma_links; m uuid; base esc_times; v_time uuid;
begin
  select ll.* into l from esc_turma_links ll join esc_campeonatos c on c.id = ll.campeonato_id where ll.token = p_token and c.inscricoes_abertas;
  if not found then raise exception 'link invalido ou inscricoes encerradas'; end if;
  select id into m from esc_modalidades where campeonato_id = l.campeonato_id and nome = 'Queimada';
  if m is null then return; end if;
  select t.* into base from esc_times t where t.campeonato_id = l.campeonato_id and t.nome ~ ' - [^ ]+$' and esc_origem(t.nome) = l.origem order by t.nome limit 1;
  if not found then return; end if;
  if exists (select 1 from esc_partidas p join esc_times t on t.id in (p.time_a_id, p.time_b_id)
              where t.turma_id = base.turma_id and t.modalidade_id = m and t.genero <> 'misto') then
    raise exception 'time ja tem jogo';
  end if;
  select id into v_time from esc_times where turma_id = base.turma_id and modalidade_id = m and genero = 'misto';
  if v_time is null then
    insert into esc_times (campeonato_id, turma_id, modalidade_id, genero, nome, professor)
      values (l.campeonato_id, base.turma_id, m, 'misto', l.origem || ' - A', base.professor) returning id into v_time;
  end if;
  -- quem ja estava nos times separados passa para o misto (sem repetir nome)
  insert into esc_jogadores (time_id, nome)
    select distinct on (lower(j.nome)) v_time, j.nome from esc_jogadores j join esc_times t on t.id = j.time_id
     where t.turma_id = base.turma_id and t.modalidade_id = m and t.genero <> 'misto'
       and not exists (select 1 from esc_jogadores k where k.time_id = v_time and lower(k.nome) = lower(j.nome))
     order by lower(j.nome), j.id;
  delete from esc_jogadores j using esc_times t
   where j.time_id = t.id and t.turma_id = base.turma_id and t.modalidade_id = m and t.genero <> 'misto';
  -- toda a lista da turma entra no time (um nome so, mesmo que venha com maiusculas diferentes)
  insert into esc_jogadores (time_id, nome)
    select distinct on (lower(c.nome)) v_time, c.nome from esc_candidatos c
     where c.campeonato_id = l.campeonato_id and c.origem = l.origem
       and not exists (select 1 from esc_jogadores k where k.time_id = v_time and lower(k.nome) = lower(c.nome))
     order by lower(c.nome), c.nome;
  -- os times separados de queimada ficam sem nada: sai
  delete from esc_times t where t.turma_id = base.turma_id and t.modalidade_id = m and t.genero <> 'misto';
end $$;

revoke execute on function esc_turma_queimada_unica(uuid) from public;
grant execute on function esc_turma_queimada_unica(uuid) to anon, authenticated;

-- COMO DESFAZER: drop function esc_turma_queimada_unica(uuid);
--   update esc_modalidades set jogadores_por_time = 10, reservas_max = 0 where nome = 'Queimada';
--   alter table esc_times drop constraint esc_times_genero_check; alter table esc_times add constraint esc_times_genero_check check (genero in ('masculino', 'feminino'));

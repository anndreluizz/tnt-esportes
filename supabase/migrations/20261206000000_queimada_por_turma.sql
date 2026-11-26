-- Queimada: UM time misto por TURMA DE ORIGEM (1º ano 01, 1º ano 02...), com todos os alunos da lista. Sem limite prático (reservas 30 + titulares 30).
-- Correção: a versão anterior mexia em todos os times da SÉRIE (1º ano inteiro), e por isso misturava turmas da mesma série.
-- Agora tudo é filtrado pela turma de origem (esc_origem(nome) = origem da turma).

-- 1) capacidade: sem limite prático
update esc_modalidades set jogadores_por_time = 30, reservas_max = 30 where nome = 'Queimada';

-- 2) função corrigida (create or replace mantém as permissões)
create or replace function esc_turma_queimada_unica(p_token uuid) returns void
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
              where t.turma_id = base.turma_id and t.modalidade_id = m and t.genero <> 'misto' and esc_origem(t.nome) = l.origem) then
    raise exception 'time ja tem jogo';
  end if;
  select t.id into v_time from esc_times t where t.turma_id = base.turma_id and t.modalidade_id = m and t.genero = 'misto' and esc_origem(t.nome) = l.origem;
  if v_time is null then
    insert into esc_times (campeonato_id, turma_id, modalidade_id, genero, nome, professor)
      values (l.campeonato_id, base.turma_id, m, 'misto', l.origem || ' - A', base.professor) returning id into v_time;
  end if;
  -- quem estava nos times separados DESTA turma passa para o misto (sem repetir nome)
  insert into esc_jogadores (time_id, nome)
    select distinct on (lower(j.nome)) v_time, j.nome from esc_jogadores j join esc_times t on t.id = j.time_id
     where t.turma_id = base.turma_id and t.modalidade_id = m and t.genero <> 'misto' and esc_origem(t.nome) = l.origem
       and not exists (select 1 from esc_jogadores k where k.time_id = v_time and lower(k.nome) = lower(j.nome))
     order by lower(j.nome), j.id;
  delete from esc_jogadores j using esc_times t
   where j.time_id = t.id and t.turma_id = base.turma_id and t.modalidade_id = m and t.genero <> 'misto' and esc_origem(t.nome) = l.origem;
  -- toda a lista desta turma entra no time (um nome so)
  insert into esc_jogadores (time_id, nome)
    select distinct on (lower(c.nome)) v_time, c.nome from esc_candidatos c
     where c.campeonato_id = l.campeonato_id and c.origem = l.origem
       and not exists (select 1 from esc_jogadores k where k.time_id = v_time and lower(k.nome) = lower(c.nome))
     order by lower(c.nome), c.nome;
  -- os times separados de queimada DESTA turma ficam sem nada: saem
  delete from esc_times t where t.turma_id = base.turma_id and t.modalidade_id = m and t.genero <> 'misto' and esc_origem(t.nome) = l.origem;
end $$;

-- 3) limpeza: quem entrou num time misto que nao e da lista daquela turma sai (so afeta times 'misto' de queimada)
delete from esc_jogadores j using esc_times t, esc_modalidades m
 where j.time_id = t.id and m.id = t.modalidade_id and m.nome = 'Queimada' and t.genero = 'misto'
   and not exists (select 1 from esc_candidatos c where c.campeonato_id = t.campeonato_id and c.origem = esc_origem(t.nome) and lower(c.nome) = lower(j.nome));

-- 4) formacao das turmas de 1º ao 5º ano (a Queimada comeca por elas)
select esc_turma_queimada_unica(l.token) from esc_turma_links l join esc_campeonatos c on c.id = l.campeonato_id
 where c.nome like 'II Jogos%' and l.origem in ('1º ano 01','1º ano 02','2º ano 01','2º ano 02','3º ano 01','3º ano 02','4º ano 01','4º ano 02','5º ano 01','5º ano 02');

-- COMO DESFAZER: nao ha como desfazer a formacao sem apagar os times mistos; o codigo anterior esta no commit 9538c40 (migration 20261205).

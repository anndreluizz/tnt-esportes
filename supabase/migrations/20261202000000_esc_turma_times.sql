-- Professor da turma cria e exclui times, e a turma pode ter mais de um professor responsavel (nomes separados por " / ").
-- Mesmas travas dos outros links da turma: so com inscricoes abertas e so nos times da propria turma.
alter table esc_times drop constraint esc_times_professor_check;
alter table esc_times add constraint esc_times_professor_check check (professor is null or length(professor) between 3 and 200);

-- Novo time: a proxima letra livre da serie (mesma regra dos nomes ja criados: 1º ano 01 - A, 1º ano 02 - B, ...), herdando o professor da turma
create function esc_turma_criar_time(p_token uuid, p_modalidade text, p_genero text) returns uuid
language plpgsql security definer set search_path = public as $$
declare l esc_turma_links; m uuid; base esc_times; v_letra text; v_id uuid;
begin
  select ll.* into l from esc_turma_links ll join esc_campeonatos c on c.id = ll.campeonato_id where ll.token = p_token and c.inscricoes_abertas;
  if not found then raise exception 'link invalido ou inscricoes encerradas'; end if;
  if p_genero not in ('masculino', 'feminino') then raise exception 'check genero'; end if;
  select id into m from esc_modalidades where campeonato_id = l.campeonato_id and nome = p_modalidade;
  if m is null then raise exception 'link invalido: modalidade'; end if;
  select t.* into base from esc_times t where t.campeonato_id = l.campeonato_id and t.nome ~ ' - [^ ]+$' and esc_origem(t.nome) = l.origem order by t.nome limit 1;
  if not found then raise exception 'link invalido: turma sem times'; end if;
  select chr(n) into v_letra from generate_series(65, 90) n
   where not exists (select 1 from esc_times t where t.turma_id = base.turma_id and t.modalidade_id = m and t.genero = p_genero and t.nome ~ ' - [^ ]+$' and regexp_replace(t.nome, '^.* - ', '') = chr(n))
   order by n limit 1;
  if v_letra is null then raise exception 'sem letra'; end if;
  insert into esc_times (campeonato_id, turma_id, modalidade_id, genero, nome, professor)
    values (l.campeonato_id, base.turma_id, m, p_genero, l.origem || ' - ' || v_letra,
            (select max(t.professor) from esc_times t where t.campeonato_id = l.campeonato_id and t.nome ~ ' - [^ ]+$' and esc_origem(t.nome) = l.origem))
    returning id into v_id;
  return v_id;
end $$;

-- Excluir time: os alunos dele saem junto (voltam para a lista da turma). Nao exclui time com jogo sorteado nem o ultimo time da turma.
create function esc_turma_excluir_time(p_token uuid, p_time uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l esc_turma_links;
begin
  select ll.* into l from esc_turma_links ll join esc_campeonatos c on c.id = ll.campeonato_id
   join esc_times t on t.campeonato_id = ll.campeonato_id and t.nome ~ ' - [^ ]+$' and esc_origem(t.nome) = ll.origem
   where ll.token = p_token and t.id = p_time and c.inscricoes_abertas;
  if not found then raise exception 'link invalido ou inscricoes encerradas'; end if;
  if exists (select 1 from esc_partidas where time_a_id = p_time or time_b_id = p_time) then raise exception 'time ja tem jogo'; end if;
  if (select count(*) from esc_times t where t.campeonato_id = l.campeonato_id and t.nome ~ ' - [^ ]+$' and esc_origem(t.nome) = l.origem) <= 1 then raise exception 'ultimo time'; end if;
  delete from esc_times where id = p_time;
end $$;

revoke execute on function esc_turma_criar_time(uuid, text, text), esc_turma_excluir_time(uuid, uuid) from public;
grant execute on function esc_turma_criar_time(uuid, text, text), esc_turma_excluir_time(uuid, uuid) to anon, authenticated;

-- COMO DESFAZER: drop function esc_turma_criar_time(uuid, text, text), esc_turma_excluir_time(uuid, uuid);
--   alter table esc_times drop constraint esc_times_professor_check;
--   alter table esc_times add constraint esc_times_professor_check check (professor is null or length(professor) between 3 and 60);  (antes, encurte os nomes maiores que 60)

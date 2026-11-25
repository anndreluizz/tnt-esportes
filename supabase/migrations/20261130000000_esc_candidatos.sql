-- Lista da turma (privada) para o professor escolher os alunos do time: os nomes vem do portal da escola e NAO aparecem no portal publico.
-- Quem enxerga: so a funcao esc_candidatos_time, com o link secreto do time. A tabela nao tem nenhum acesso para anon/authenticated.
create table esc_candidatos (
  id            uuid primary key default gen_random_uuid(),
  campeonato_id uuid not null references esc_campeonatos (id) on delete cascade,
  origem        text not null check (length(origem) between 2 and 40),   -- turma de origem, igual ao prefixo do nome do time (ex.: '1º ano 01')
  nome          text not null check (length(btrim(nome)) between 2 and 80),
  unique (campeonato_id, origem, nome)
);
alter table esc_candidatos enable row level security;
revoke all on esc_candidatos from anon, authenticated;

-- alunos da turma do time que ainda nao estao em nenhum time da mesma modalidade
create function esc_candidatos_time(p_token uuid) returns table (nome text)
language sql stable security definer set search_path = public as $$
  select c.nome from esc_times t
  join esc_candidatos c on c.campeonato_id = t.campeonato_id and c.origem = regexp_replace(t.nome, ' - [^ ]+$', '')
  where t.token = p_token
    and not exists (select 1 from esc_jogadores j join esc_times t2 on t2.id = j.time_id
                    where t2.campeonato_id = t.campeonato_id and t2.modalidade_id = t.modalidade_id and lower(btrim(j.nome)) = lower(btrim(c.nome)))
  order by c.nome
$$;
revoke execute on function esc_candidatos_time(uuid) from public;
grant execute on function esc_candidatos_time(uuid) to anon, authenticated;

-- COMO DESFAZER: drop function esc_candidatos_time(uuid); drop table esc_candidatos;

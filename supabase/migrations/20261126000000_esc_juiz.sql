-- Juiz do campeonato escolar: um link secreto (sem login) para lancar placar e penaltis direto.
-- O token fica em tabela propria, sem nenhum acesso para anon/authenticated (RLS ligada, sem policy, sem grant).
-- So a Secretaria ve o link (esc_juiz_link); quem tem o link grava o resultado pela funcao esc_juiz_placar.
create table esc_juiz (
  campeonato_id uuid primary key references esc_campeonatos (id) on delete cascade,
  token         uuid not null unique default gen_random_uuid()
);
alter table esc_juiz enable row level security;
revoke all on esc_juiz from anon, authenticated;

create function esc_juiz_link(p_campeonato uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not e_secretaria() then raise exception 'apenas a Secretaria'; end if;
  insert into esc_juiz (campeonato_id) values (p_campeonato) on conflict (campeonato_id) do nothing;
  select token into v from esc_juiz where campeonato_id = p_campeonato;
  return v;
end $$;

create function esc_juiz_valido(p_token uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select campeonato_id from esc_juiz where token = p_token
$$;

-- p_pa/p_pb nulos = limpar o resultado. As regras (penaltis so no empate, nunca iguais) sao do proprio esc_partidas.
create function esc_juiz_placar(p_token uuid, p_partida uuid, p_pa int, p_pb int, p_ea int, p_eb int) returns void
language plpgsql security definer set search_path = public as $$
begin
  update esc_partidas p set placar_a = p_pa, placar_b = p_pb, penaltis_a = p_ea, penaltis_b = p_eb
   from esc_turmas u join esc_juiz j on j.campeonato_id = u.campeonato_id
   where p.id = p_partida and u.id = p.turma_id and j.token = p_token;
  if not found then raise exception 'link invalido'; end if;
end $$;

revoke execute on function esc_juiz_link(uuid), esc_juiz_valido(uuid), esc_juiz_placar(uuid, uuid, int, int, int, int) from public;
grant execute on function esc_juiz_valido(uuid), esc_juiz_placar(uuid, uuid, int, int, int, int) to anon, authenticated;
grant execute on function esc_juiz_link(uuid) to authenticated;

-- COMO DESFAZER: drop function esc_juiz_placar(uuid, uuid, int, int, int, int), esc_juiz_valido(uuid), esc_juiz_link(uuid); drop table esc_juiz;

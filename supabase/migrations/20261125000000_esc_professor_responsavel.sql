-- Professor responsavel pelo time: o proprio professor preenche o nome pelo link secreto do time.
-- So a Secretaria (esc_links_times) e o dono do link (esc_meu_time) enxergam o nome: a coluna nao tem select para anon/authenticated.
alter table esc_times add column professor text check (professor is null or length(professor) between 3 and 60);

drop function esc_meu_time(uuid);
create function esc_meu_time(p_token uuid) returns table (time_id uuid, time_nome text, turma_nome text, modalidade_nome text, genero text, vagas int, inscricoes_abertas boolean, professor text)
language sql stable security definer set search_path = public as $$
  select t.id, t.nome, u.nome, m.nome, t.genero, m.jogadores_por_time + m.reservas_max, c.inscricoes_abertas, t.professor
  from esc_times t join esc_turmas u on u.id = t.turma_id join esc_modalidades m on m.id = t.modalidade_id join esc_campeonatos c on c.id = t.campeonato_id
  where t.token = p_token
$$;

drop function esc_links_times(uuid);
create function esc_links_times(p_campeonato uuid) returns table (time_id uuid, token uuid, professor text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not e_secretaria() then raise exception 'apenas a Secretaria'; end if;
  return query select t.id, t.token, t.professor from esc_times t where t.campeonato_id = p_campeonato;
end $$;

create function esc_definir_professor(p_token uuid, p_nome text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update esc_times t set professor = btrim(regexp_replace(p_nome, '\s+', ' ', 'g'))
   from esc_campeonatos c where t.token = p_token and c.id = t.campeonato_id and c.inscricoes_abertas;
  if not found then raise exception 'link invalido ou inscricoes encerradas'; end if;
end $$;

revoke execute on function esc_meu_time(uuid), esc_links_times(uuid), esc_definir_professor(uuid, text) from public;
grant execute on function esc_meu_time(uuid), esc_definir_professor(uuid, text) to anon, authenticated;
grant execute on function esc_links_times(uuid) to authenticated;

-- COMO DESFAZER: alter table esc_times drop column professor; drop function esc_definir_professor(uuid, text);
--   (e recriar esc_meu_time/esc_links_times sem a coluna professor, como em 20261121000000_turmas_escola.sql)

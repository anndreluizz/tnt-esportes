-- Secretaria corrige o nome de um professor (em todas as turmas e no WhatsApp dele). Nao muda o WhatsApp.
create function esc_secretaria_renomear_professor(p_campeonato uuid, p_antigo text, p_novo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_novo text := btrim(regexp_replace(coalesce(p_novo, ''), '\s+', ' ', 'g')); v_antigo text := btrim(coalesce(p_antigo, ''));
begin
  if not e_secretaria() then raise exception 'apenas a Secretaria'; end if;
  if length(v_novo) not between 3 and 60 then raise exception 'check nome'; end if;
  update esc_times t set professor = array_to_string(array(
      select case when lower(x) = lower(v_antigo) then v_novo else x end from unnest(string_to_array(t.professor, ' / ')) x), ' / ')
   where t.campeonato_id = p_campeonato and t.professor is not null and t.professor ilike '%' || v_antigo || '%';
  delete from esc_prof_contatos a using esc_prof_contatos b
   where a.campeonato_id = p_campeonato and lower(a.nome) = lower(v_antigo) and b.campeonato_id = a.campeonato_id and b.origem = a.origem and lower(b.nome) = lower(v_novo);
  update esc_prof_contatos set nome = v_novo where campeonato_id = p_campeonato and lower(nome) = lower(v_antigo);
end $$;

revoke execute on function esc_secretaria_renomear_professor(uuid, text, text) from public;
grant execute on function esc_secretaria_renomear_professor(uuid, text, text) to authenticated;

-- COMO DESFAZER: drop function esc_secretaria_renomear_professor(uuid, text, text);

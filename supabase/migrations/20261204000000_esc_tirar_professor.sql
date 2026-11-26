-- Secretaria: tira um professor de UMA turma (os outros times/turmas dele continuam). O WhatsApp dele na turma tambem sai.
-- Professor com mais de uma turma aparece assim: o nome fica em cada turma (separado por " / ").
create function esc_secretaria_tirar_professor(p_campeonato uuid, p_origem text, p_nome text) returns void
language plpgsql security definer set search_path = public as $$
declare v_nome text := btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g'));
begin
  if not e_secretaria() then raise exception 'apenas a Secretaria'; end if;
  update esc_times t set professor = nullif(array_to_string(array(
      select x from unnest(string_to_array(t.professor, ' / ')) x where x <> v_nome), ' / '), '')
   where t.campeonato_id = p_campeonato and t.nome ~ ' - [^ ]+$' and esc_origem(t.nome) = p_origem and t.professor is not null;
  if not found then raise exception 'turma sem times'; end if;
  delete from esc_prof_contatos where campeonato_id = p_campeonato and origem = p_origem and nome = v_nome;
end $$;

revoke execute on function esc_secretaria_tirar_professor(uuid, text, text) from public;
grant execute on function esc_secretaria_tirar_professor(uuid, text, text) to authenticated;

-- COMO DESFAZER: drop function esc_secretaria_tirar_professor(uuid, text, text);

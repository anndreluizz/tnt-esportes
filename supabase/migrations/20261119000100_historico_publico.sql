-- HISTÓRICO DAS PARTIDAS (decisão da Secretaria, 14/11/2026): o público pode ver resultados e fatos esportivos da partida,
-- mas NÃO os motivos internos das alterações, quem fez a alteração, nem observações administrativas.
-- A Secretaria continua lendo o histórico completo na tabela "historico".
--
-- Antes: historico_publico mostrava quem, o que e o motivo de todo registro ligado a um jogo.
-- Agora: só jogo, texto e data, e só estes tipos de registro:
--   "Súmula confirmada", "Correção confirmada", "Jogo adiado", "Jogo alterado" (data/horário/local), "W.O.".
-- Ficam de fora do portal: "Súmula reaberta para correção" (motivo administrativo) e "Evento desfeito" (cita o nome do atleta).
-- A lista é explícita: tipos novos de registro NÃO ficam públicos por padrão.
-- Não apaga nem altera nenhum dado (a tabela historico não é tocada): só recria a view, que perde as colunas quem e motivo.

drop view historico_publico;
create view historico_publico as
  select jogo_id, o_que, em
  from historico
  where jogo_id is not null
    and o_que ~ '^(Súmula confirmada|Correção confirmada|Jogo adiado|Jogo alterado|W\.O\.)';
grant select on historico_publico to anon, authenticated;
-- A view recriada ganha de novo os privilégios automáticos do Supabase (REFERENCES, TRIGGER, TRUNCATE); o público só deve ter SELECT.
revoke references, trigger, truncate on historico_publico from anon, authenticated;

-- COMO DESFAZER:
--   drop view historico_publico;
--   create view historico_publico as select jogo_id, quem, o_que, motivo, em from historico where jogo_id is not null;
--   grant select on historico_publico to anon, authenticated;
--   revoke references, trigger, truncate on historico_publico from anon, authenticated;

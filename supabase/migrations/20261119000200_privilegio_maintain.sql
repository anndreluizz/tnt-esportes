-- RETIRA O PRIVILÉGIO MAINTAIN do público e FECHA A CAUSA dos privilégios a mais (achado em 14/11/2026, lendo as permissões brutas em produção).
-- O Supabase aplica automaticamente "Dxtm" (TRUNCATE, REFERENCES, TRIGGER e MAINTAIN) para anon e authenticated em todo objeto novo
-- criado pelo usuário postgres no esquema public. Nas migrations anteriores retiramos TRUNCATE, REFERENCES e TRIGGER, mas não o MAINTAIN
-- (privilégio do Postgres 17 para VACUUM, ANALYZE, REINDEX, CLUSTER e LOCK TABLE), e a visão information_schema não o mostra.
-- Resultado em produção: o público tinha SELECT + MAINTAIN em campeonatos_publico, jogos_publico, historico_publico e sorteios_cancelados.
-- Na prática não dá para explorar pela API pública (ela só faz select, insert, update, delete e rpc), mas o público deve ter só SELECT.
--
-- 1) Retira o MAINTAIN dos quatro objetos.
-- 2) Muda os privilégios automáticos: daqui para frente, objetos novos criados por postgres em public NÃO nascem com esses quatro privilégios
--    para anon e authenticated. Cada migration continua concedendo explicitamente só o que precisa (como a primeira migration já faz).
-- Só retira permissões: não apaga nem altera dado nenhum e não afeta a leitura do portal (que usa SELECT).

revoke maintain on campeonatos_publico, jogos_publico, historico_publico, sorteios_cancelados from anon, authenticated;
alter default privileges for role postgres in schema public revoke truncate, references, trigger, maintain on tables from anon, authenticated;

-- COMO DESFAZER (não recomendado):
--   grant maintain on campeonatos_publico, jogos_publico, historico_publico, sorteios_cancelados to anon, authenticated;
--   alter default privileges for role postgres in schema public grant truncate, references, trigger, maintain on tables to anon, authenticated;

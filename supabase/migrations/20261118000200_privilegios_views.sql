-- CORRIGE PRIVILÉGIOS A MAIS nas views públicas criadas em 20261118000000 (achado em 14/11/2026, conferindo produção).
-- O Supabase concede privilégios automáticos a todo objeto novo do esquema public. As views campeonatos_publico e jogos_publico
-- ganharam REFERENCES, TRIGGER e TRUNCATE para anon e authenticated, além do SELECT que a migration concedeu.
-- Em views esses três privilégios não têm efeito prático, mas o público só deve ter SELECT. (Mesmo padrão já corrigido em
-- sorteios_cancelados na migration 20261117000000.)
-- Só retira permissões: não apaga nem altera dado nenhum e não afeta a leitura do portal (que usa SELECT).
revoke references, trigger, truncate on campeonatos_publico, jogos_publico from anon, authenticated;

-- COMO DESFAZER (não recomendado):
--   grant references, trigger, truncate on campeonatos_publico, jogos_publico to anon, authenticated;

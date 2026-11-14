-- PRIVACIDADE, PARTE 2 de 2 (restringe a leitura direta das tabelas). Só aplicar DEPOIS da parte 1 e depois do site novo estar publicado,
-- senão o site antigo, que ainda lê campeonatos e jogos direto, deixa de mostrar o portal.
-- O público (anon) passa a ler só as views; a Secretaria vê tudo; o árbitro vê só os próprios jogos; o representante da equipe, só o próprio campeonato.
-- Não apaga nem altera nenhum dado.

-- 2) O público deixa de ler as tabelas-base
revoke select on campeonatos, jogos from anon;

-- 3) Quem está logado lê a tabela-base só do que precisa (a Secretaria já tem acesso total pela política "secretaria")
drop policy publico on campeonatos;
create policy equipe_ve on campeonatos for select to authenticated
  using (exists (select 1 from equipes e where e.id = minha_equipe() and e.campeonato_id = campeonatos.id));
-- (a regra de inscrição de atletas consulta campeonatos com o usuário da equipe: ela continua enxergando o próprio)

drop policy publico on jogos;
create policy secretaria_le on jogos for select to authenticated using (e_secretaria());
create policy arbitro_le on jogos for select to authenticated using (arbitro_id = (select auth.uid()));

-- COMO DESFAZER (se algo der errado; não perde dado nenhum):
--   grant select on campeonatos, jogos to anon;
--   drop policy equipe_ve on campeonatos;  create policy publico on campeonatos for select using (true);
--   drop policy secretaria_le on jogos;  drop policy arbitro_le on jogos;  create policy publico on jogos for select using (true);

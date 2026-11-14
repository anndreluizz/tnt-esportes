-- Sincroniza o repositório com o que já está no banco de produção (conferido em 14/11/2026).
-- Estas mudanças foram feitas direto no painel durante a revisão de 10/11 e não tinham migration.
-- No banco real, tudo abaixo já existe: rodar de novo não muda nada (é idempotente).
-- A única parte que ainda NÃO estava no banco é o revoke do fim (privilégios a mais em sorteios_cancelados).

-- 1) Funções com caminho de busca fixo (alerta "function search_path mutable" do Advisor)
create or replace function inscricoes_abertas(c campeonatos) returns boolean language sql stable set search_path = public as $$
  select c.status <> 'encerrado'
    and (c.inscricao_ate is null or c.inscricao_ate >= (now() at time zone 'America/Manaus')::date)
    and (c.regras->>'inscricao_rodada' is null or c.status = 'inscricoes'
         or exists (select 1 from jogos j where j.campeonato_id = c.id and j.fase = 'grupos' and j.status <> 'encerrado'
                    and j.rodada <= (c.regras->>'inscricao_rodada')::int))
$$;

-- 2) Regras de acesso com (select auth.uid()): o Postgres calcula uma vez por consulta, e não por linha
drop policy if exists proprio on perfis;
create policy proprio on perfis for select to authenticated using (id = (select auth.uid()) or e_secretaria());

drop policy if exists arbitro_ve on atletas;
create policy arbitro_ve on atletas for select to authenticated using (exists (
  select 1 from jogos where jogos.arbitro_id = (select auth.uid()) and (atletas.equipe_id = jogos.mandante_id or atletas.equipe_id = jogos.visitante_id)));

-- 3) Índices nas chaves estrangeiras (alerta "unindexed foreign keys" do Advisor)
create index if not exists eventos_atleta_id_idx on eventos (atleta_id);
create index if not exists eventos_equipe_id_idx on eventos (equipe_id);
create index if not exists historico_campeonato_id_idx on historico (campeonato_id);
create index if not exists historico_jogo_id_idx on historico (jogo_id);
create index if not exists jogos_arbitro_id_idx on jogos (arbitro_id);
create index if not exists jogos_mandante_id_idx on jogos (mandante_id);
create index if not exists jogos_visitante_id_idx on jogos (visitante_id);
create index if not exists jogos_wo_ausente_id_idx on jogos (wo_ausente_id);
create index if not exists perfis_equipe_id_idx on perfis (equipe_id);
create index if not exists sorteios_cancelados_campeonato_id_idx on sorteios_cancelados (campeonato_id);
create index if not exists suspensoes_atleta_id_idx on suspensoes (atleta_id);

-- 4) sorteios_cancelados foi criada depois do "revoke all" da primeira migration e ganhou os privilégios
-- padrão do Supabase. O portal só precisa de SELECT (a escrita é feita pela função cancelar_sorteio).
revoke truncate, references, trigger on sorteios_cancelados from anon, authenticated;

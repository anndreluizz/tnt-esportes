-- Regra editável "novos atletas até o fim da rodada X" (regras->>'inscricao_rodada'; vazio = sem limite).
-- Vale para o link de inscrição e para o representante da equipe. A Secretaria sempre pode inscrever.
create or replace function inscricoes_abertas(c campeonatos) returns boolean language sql stable as $$
  select c.status <> 'encerrado'
    and (c.inscricao_ate is null or c.inscricao_ate >= (now() at time zone 'America/Manaus')::date)
    and (c.regras->>'inscricao_rodada' is null or c.status = 'inscricoes'
         or exists (select 1 from jogos j where j.campeonato_id = c.id and j.fase = 'grupos' and j.status <> 'encerrado'
                    and j.rodada <= (c.regras->>'inscricao_rodada')::int))
$$;
grant execute on function inscricoes_abertas(campeonatos) to authenticated;

drop policy equipe_inscreve on atletas;
create policy equipe_inscreve on atletas for insert to authenticated with check (
  equipe_id = minha_equipe()
  and (select inscricoes_abertas(c) from equipes e join campeonatos c on c.id = e.campeonato_id where e.id = equipe_id));

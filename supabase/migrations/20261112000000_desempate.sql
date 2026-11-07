-- Desempate editável por campeonato (regras->'desempate': lista em ordem; padrão vitórias, saldo, gols).
-- Critérios: confronto (pontos só nos jogos entre equipes empatadas em pontos), vitorias, saldo, gols. Por último, nome.
-- Igual ao standings() do regras.js.
create or replace view classificacao as
with r as (
  select j.campeonato_id, j.mandante_id as equipe_id, j.visitante_id as adversario, p.gols_mandante as gp, p.gols_visitante as gc
  from jogos j join placar p on p.jogo_id = j.id where j.fase = 'grupos' and j.status = 'encerrado'
  union all
  select j.campeonato_id, j.visitante_id, j.mandante_id, p.gols_visitante, p.gols_mandante
  from jogos j join placar p on p.jogo_id = j.id where j.fase = 'grupos' and j.status = 'encerrado'
), t as (
  select q.campeonato_id, q.grupo, q.id as equipe_id, q.nome,
    count(r.equipe_id)::int as j,
    count(*) filter (where r.gp > r.gc)::int as v,
    count(*) filter (where r.gp = r.gc)::int as e,
    count(*) filter (where r.gp < r.gc)::int as d,
    coalesce(sum(r.gp), 0)::int as gp, coalesce(sum(r.gc), 0)::int as gc
  from equipes q left join r on r.equipe_id = q.id
  where q.grupo is not null group by q.id
), p as (
  select t.*, t.v * x.pv + t.e * x.pe as pontos, x.pv, x.pe,
    case when x.regras ? 'desempate' then x.regras->'desempate' else '["vitorias", "saldo", "gols"]'::jsonb end as crit
  from t cross join lateral (select regras, coalesce((regras->>'vitoria')::int, 3) as pv, coalesce((regras->>'empate')::int, 1) as pe
                             from campeonatos where id = t.campeonato_id) x
), h as (   -- confronto direto
  select a.equipe_id, sum(case when r.gp > r.gc then a.pv when r.gp = r.gc then a.pe else 0 end)::int as cd
  from p a join r on r.equipe_id = a.equipe_id
           join p b on b.equipe_id = r.adversario and b.campeonato_id = a.campeonato_id and b.grupo = a.grupo and b.pontos = a.pontos
  group by a.equipe_id
), k as (
  select p.*, coalesce(h.cd, 0) as cd from p left join h on h.equipe_id = p.equipe_id
)
select k.campeonato_id, k.grupo, k.equipe_id, k.nome, k.j, k.v, k.e, k.d, k.gp, k.gc, k.pontos, k.gp - k.gc as saldo,
  row_number() over (partition by k.campeonato_id, k.grupo order by k.pontos desc,
    (case k.crit->>0 when 'confronto' then k.cd when 'vitorias' then k.v when 'saldo' then k.gp - k.gc when 'gols' then k.gp else 0 end) desc,
    (case k.crit->>1 when 'confronto' then k.cd when 'vitorias' then k.v when 'saldo' then k.gp - k.gc when 'gols' then k.gp else 0 end) desc,
    (case k.crit->>2 when 'confronto' then k.cd when 'vitorias' then k.v when 'saldo' then k.gp - k.gc when 'gols' then k.gp else 0 end) desc,
    (case k.crit->>3 when 'confronto' then k.cd when 'vitorias' then k.v when 'saldo' then k.gp - k.gc when 'gols' then k.gp else 0 end) desc,
    k.nome)::int as posicao
from k;

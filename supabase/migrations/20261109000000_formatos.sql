-- Formatos (grupos + mata-mata, pontos corridos, mata-mata) e regras configuráveis por campeonato.
-- regras (jsonb): tempo, vitoria, empate, amarelos, vermelho, wo, faltas, grupos, returno, terceiro. O que faltar usa o padrão.

alter table campeonatos
  add column formato text not null default 'grupos' check (formato in ('grupos', 'pontos', 'mata')),
  add column regras  jsonb not null default '{}';

-- até 8 grupos; mata-mata com oitavas/quartas; no mata-mata direto a equipe já vem definida (sem vaga) ou passa de folga
alter table equipes drop constraint equipes_grupo_check, add constraint equipes_grupo_check check (grupo between 'A' and 'H');
alter table jogos drop constraint jogos_fase_check,
  add constraint jogos_fase_check check (fase in ('grupos', 'oitavas', 'quartas', 'semi', 'terceiro', 'final')),
  drop constraint jogos_check,
  add constraint jogos_lados_check check (fase = 'grupos' or ((vaga_mandante is not null or mandante_id is not null) and (vaga_visitante is not null or visitante_id is not null)));

-- placar do W.O. conforme a regra do campeonato
create or replace view placar as
select j.id as jogo_id,
  case when j.wo_ausente_id is null then (select count(*) from eventos e where e.jogo_id = j.id and e.tipo = 'gol' and e.equipe_id = j.mandante_id)
       when j.wo_ausente_id = j.mandante_id then 0 else w.gols end::int as gols_mandante,
  case when j.wo_ausente_id is null then (select count(*) from eventos e where e.jogo_id = j.id and e.tipo = 'gol' and e.equipe_id = j.visitante_id)
       when j.wo_ausente_id = j.visitante_id then 0 else w.gols end::int as gols_visitante
from jogos j cross join lateral (select coalesce((c.regras->>'wo')::int, 3) as gols from campeonatos c where c.id = j.campeonato_id) w;

-- pontos por vitória e empate conforme a regra; desempate igual ao regras.js
create or replace view classificacao as
with r as (
  select j.mandante_id as equipe_id, p.gols_mandante as gp, p.gols_visitante as gc from jogos j join placar p on p.jogo_id = j.id where j.fase = 'grupos' and j.status = 'encerrado'
  union all
  select j.visitante_id, p.gols_visitante, p.gols_mandante from jogos j join placar p on p.jogo_id = j.id where j.fase = 'grupos' and j.status = 'encerrado'
), t as (
  select q.campeonato_id, q.grupo, q.id as equipe_id, q.nome,
    count(r.equipe_id)::int as j,
    count(*) filter (where r.gp > r.gc)::int as v,
    count(*) filter (where r.gp = r.gc)::int as e,
    count(*) filter (where r.gp < r.gc)::int as d,
    coalesce(sum(r.gp), 0)::int as gp, coalesce(sum(r.gc), 0)::int as gc
  from equipes q left join r on r.equipe_id = q.id
  where q.grupo is not null group by q.id
)
select t.*, t.v * pts.pv + t.e * pts.pe as pontos, t.gp - t.gc as saldo,
  row_number() over (partition by t.campeonato_id, t.grupo order by t.v * pts.pv + t.e * pts.pe desc, t.v desc, t.gp - t.gc desc, t.gp desc, t.nome)::int as posicao
from t cross join lateral (select coalesce((regras->>'vitoria')::int, 3) as pv, coalesce((regras->>'empate')::int, 1) as pe from campeonatos where id = t.campeonato_id) pts;

create or replace function vaga_equipe(c uuid, vaga text) returns uuid language plpgsql stable security definer set search_path = public as $$
begin
  if vaga ~ '^[1-9][A-H]$' then
    if not grupo_encerrado(c, substr(vaga, 2, 1)) then return null; end if;
    return (select equipe_id from classificacao where campeonato_id = c and grupo = substr(vaga, 2, 1) and posicao = substr(vaga, 1, 1)::int);
  end if;
  return vencedor(substr(vaga, 3)::uuid, left(vaga, 1) = 'P');
end $$;

-- lado sem vaga = equipe já definida (mata-mata direto ou folga): não mexe
create or replace function resolver_mata_mata(c uuid) returns void language plpgsql security definer set search_path = public as $$
declare k jogos;
begin
  for k in select * from jogos where campeonato_id = c and fase <> 'grupos' and status <> 'encerrado'
             and not exists (select 1 from eventos where jogo_id = jogos.id) order by data, hora loop
    update jogos set mandante_id  = case when k.vaga_mandante  is null then k.mandante_id  else vaga_equipe(c, k.vaga_mandante)  end,
                     visitante_id = case when k.vaga_visitante is null then k.visitante_id else vaga_equipe(c, k.vaga_visitante) end
    where id = k.id;
  end loop;
end $$;

-- em qualquer formato, o campeonato termina quando o último jogo termina
create function encerrar_se_acabou(c uuid) returns void language sql security definer set search_path = public as $$
  update campeonatos set status = 'encerrado' where id = c and status = 'andamento'
    and not exists (select 1 from jogos where campeonato_id = c and status <> 'encerrado')
$$;
revoke execute on function encerrar_se_acabou(uuid) from public;

create or replace function confirmar_sumula(j uuid, pen_m int, pen_v int, obs text, assin jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare m jogos; p placar;
begin
  select * into m from jogos where id = j for update;
  if not found then raise exception 'Jogo não encontrado'; end if;
  if m.status = 'encerrado' then return m.hash; end if;   -- reenvio do celular: não faz nada de novo
  if not pode_apitar(j) then raise exception 'Sem permissão para esta súmula' using errcode = '42501'; end if;
  select * into p from placar where jogo_id = j;
  if m.fase <> 'grupos' and p.gols_mandante = p.gols_visitante then
    if pen_m is null or pen_v is null or pen_m = pen_v then raise exception 'Informe os pênaltis (não pode empatar)'; end if;
  else pen_m := null; pen_v := null; end if;
  if not (assin ? 'arbitro' and assin ? 'mandante' and assin ? 'visitante') then raise exception 'Faltam assinaturas'; end if;
  update jogos set status = 'encerrado', pen_mandante = pen_m, pen_visitante = pen_v,
                   observacoes = left(coalesce(obs, ''), 600), assinaturas = assin where id = j;
  update jogos set hash = hash_sumula(j) where id = j;
  perform registrar(m.campeonato_id, j, case when m.status = 'correcao' then 'Correção confirmada: ' else 'Súmula confirmada: ' end || resumo_jogo(j));
  perform resolver_mata_mata(m.campeonato_id);
  perform encerrar_se_acabou(m.campeonato_id);
  return (select hash from jogos where id = j);
end $$;

create or replace function reabrir_sumula(j uuid, motivo text) returns void language plpgsql security definer set search_path = public as $$
declare m jogos;
begin
  perform exigir_secretaria(motivo);
  select * into m from jogos where id = j for update;
  if m.status <> 'encerrado' then raise exception 'A súmula não está encerrada'; end if;
  -- não deixa mexer num resultado que já decidiu um jogo do mata-mata em andamento
  if exists (select 1 from jogos k where k.campeonato_id = m.campeonato_id and k.fase <> 'grupos' and k.id <> j
             and (k.status <> 'agendado' or exists (select 1 from eventos where jogo_id = k.id))
             and (m.fase = 'grupos' or j::text in (substr(k.vaga_mandante, 3), substr(k.vaga_visitante, 3)))) then
    raise exception 'O mata-mata que depende deste jogo já começou';
  end if;
  update jogos set status = 'correcao', hash = null, assinaturas = '{}', wo_ausente_id = null where id = j;
  update campeonatos set status = 'andamento' where id = m.campeonato_id and status = 'encerrado';
  perform registrar(m.campeonato_id, j, 'Súmula reaberta para correção: ' || resumo_jogo(j), motivo);
  perform resolver_mata_mata(m.campeonato_id);
end $$;

create or replace function registrar_wo(j uuid, ausente uuid, motivo text) returns void language plpgsql security definer set search_path = public as $$
declare m jogos;
begin
  perform exigir_secretaria(motivo);
  select * into m from jogos where id = j for update;
  if m.status = 'encerrado' or ausente not in (m.mandante_id, m.visitante_id) then raise exception 'W.O. inválido para este jogo'; end if;
  delete from eventos where jogo_id = j;
  update jogos set wo_ausente_id = ausente, status = 'encerrado' where id = j;
  update jogos set hash = hash_sumula(j) where id = j;
  perform registrar(m.campeonato_id, j, 'W.O.: ' || (select nome from equipes where id = ausente) || ' não compareceu · ' || resumo_jogo(j), motivo);
  perform resolver_mata_mata(m.campeonato_id);
  perform encerrar_se_acabou(m.campeonato_id);
end $$;

-- sorteio: qualquer quantidade de grupos (no mata-mata e nos pontos corridos vem tudo no grupo A, na ordem do sorteio)
create or replace function aplicar_sorteio(c uuid, g jsonb, jogos_novos jsonb) returns void language plpgsql security definer set search_path = public as $$
declare todas uuid[]; sorteadas uuid[];
begin
  perform exigir_secretaria();
  if (select revelado_em from sorteios where campeonato_id = c) is null then raise exception 'Revele a semente antes'; end if;
  if (select status from campeonatos where id = c) <> 'inscricoes' then raise exception 'Tabela já gerada'; end if;
  if exists (select 1 from jsonb_object_keys(g) k where k !~ '^[A-H]$') then raise exception 'Grupo inválido'; end if;
  select array_agg(id order by id) into todas from equipes where campeonato_id = c;
  select array_agg(x::uuid order by x::uuid) into sorteadas from jsonb_each(g) e, jsonb_array_elements_text(e.value) x;
  if todas is distinct from sorteadas then raise exception 'Os grupos precisam ter todas as equipes do campeonato, uma vez cada'; end if;
  update equipes q set grupo = (select e.key from jsonb_each(g) e where e.value ? q.id::text) where campeonato_id = c;
  insert into jogos (id, campeonato_id, fase, rodada, grupo, titulo, mandante_id, visitante_id, vaga_mandante, vaga_visitante, data, hora)
    select id, c, fase, rodada, grupo, titulo, mandante_id, visitante_id, vaga_mandante, vaga_visitante, data, hora
    from jsonb_to_recordset(jogos_novos) as x(id uuid, fase text, rodada smallint, grupo char(1), titulo text, mandante_id uuid, visitante_id uuid,
                                               vaga_mandante text, vaga_visitante text, data date, hora text);
  if exists (select 1 from jogos where campeonato_id = c and fase = 'grupos'
             and (mandante_id not in (select id from equipes where campeonato_id = c and grupo = jogos.grupo)
               or visitante_id not in (select id from equipes where campeonato_id = c and grupo = jogos.grupo))) then
    raise exception 'Jogo com equipe fora do grupo';
  end if;
  if exists (select 1 from jogos where campeonato_id = c and fase <> 'grupos'
             and (mandante_id not in (select id from equipes where campeonato_id = c) or visitante_id not in (select id from equipes where campeonato_id = c))) then
    raise exception 'Jogo com equipe de outro campeonato';
  end if;
  update sorteios set grupos = g where campeonato_id = c;
  update campeonatos set status = 'andamento' where id = c;
  perform registrar(c, null, 'Sorteio aplicado: ' || jsonb_array_length(jogos_novos) || ' jogos gerados');
end $$;

-- TNT Esportes · banco de dados (Supabase / Postgres)
-- Regra geral: o portal público lê só o que é seguro (views *_publico); toda mudança de resultado
-- passa por função que confere permissão e grava no histórico. Nada de resultado é editado "na mão".

create extension if not exists pgcrypto;

/* ============================== perfis ============================== */
create type papel as enum ('secretaria', 'arbitro', 'equipe');

create table perfis (
  id        uuid primary key references auth.users on delete cascade,
  nome      text not null check (length(nome) between 2 and 60),
  papel     papel not null,
  equipe_id uuid,                                   -- só para papel 'equipe' (fk abaixo)
  check ((papel = 'equipe') = (equipe_id is not null))
);

create function meu_papel() returns papel language sql stable security definer set search_path = public
as $$ select papel from perfis where id = auth.uid() $$;
create function e_secretaria() returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(meu_papel() = 'secretaria', false) $$;
create function minha_equipe() returns uuid language sql stable security definer set search_path = public
as $$ select equipe_id from perfis where id = auth.uid() $$;

/* ============================== cadastro ============================== */
create table campeonatos (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null check (length(nome) between 5 and 80),
  modalidade text not null check (modalidade in ('Futsal', 'Futebol society', 'Futebol de campo')),
  categoria  text not null default 'Livre' check (length(categoria) <= 20),
  idade_min  int  not null check (idade_min between 5 and 80),
  idade_max  int  check (idade_max is null or idade_max between idade_min and 99),
  inicio     date not null,
  local      text not null default 'A definir',
  status     text not null default 'inscricoes' check (status in ('inscricoes', 'andamento', 'encerrado')),
  criado_em  timestamptz not null default now()
);

create table equipes (
  id            uuid primary key default gen_random_uuid(),
  campeonato_id uuid not null references campeonatos on delete cascade,
  nome          text not null check (length(nome) between 3 and 40),
  bairro        text not null,
  pote          smallint not null default 2 check (pote in (1, 2)),   -- 1 = cabeça de chave
  grupo         char(1) check (grupo in ('A', 'B')),
  codigo        text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 8)),  -- acesso do representante
  unique (campeonato_id, nome)
);
alter table perfis add foreign key (equipe_id) references equipes on delete cascade;

create table atletas (
  id            uuid primary key default gen_random_uuid(),
  equipe_id     uuid not null references equipes on delete cascade,
  nome          text not null check (length(nome) between 3 and 50),
  numero        smallint not null check (numero between 1 and 99),
  nascimento    date not null,
  bairro        text not null,
  autorizacao   boolean not null default false,   -- autorização do responsável (menor de 18)
  aprovado      boolean not null default false,   -- conferido pela Secretaria
  consentimento boolean not null check (consentimento),   -- LGPD: sem consentimento não entra
  foto_path     text,                             -- arquivo no bucket privado "fotos"
  criado_em     timestamptz not null default now(),
  unique (equipe_id, numero)
);

-- aprovado | pendente | analise | bloqueado — idade conferida na data de início do campeonato
create function situacao_atleta(a atletas) returns text language sql stable security definer set search_path = public as $$
  select case
    when x.idade < c.idade_min or (c.idade_max is not null and x.idade > c.idade_max) then 'bloqueado'
    when x.idade < 18 and not a.autorizacao then 'pendente'
    when not a.aprovado then 'analise'
    else 'aprovado' end
  from equipes e join campeonatos c on c.id = e.campeonato_id,
       lateral (select extract(year from age(c.inicio, a.nascimento))::int as idade) x
  where e.id = a.equipe_id
$$;

-- equipe não aprova o próprio atleta
create function atleta_antes_gravar() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not e_secretaria() then new.aprovado := false; end if;
  return new;
end $$;
create trigger atleta_antes_gravar before insert or update on atletas for each row execute function atleta_antes_gravar();

/* ============================== jogos ============================== */
create table jogos (
  id             uuid primary key default gen_random_uuid(),
  campeonato_id  uuid not null references campeonatos on delete cascade,
  fase           text not null check (fase in ('grupos', 'semi', 'terceiro', 'final')),
  rodada         smallint,
  grupo          char(1),
  titulo         text,
  mandante_id    uuid references equipes,
  visitante_id   uuid references equipes,
  vaga_mandante  text,      -- mata-mata: '1A', 'V:<jogo>' (vencedor), 'P:<jogo>' (perdedor)
  vaga_visitante text,
  data           date not null,
  hora           text not null check (hora ~ '^\d{2}h\d{2}$'),
  status         text not null default 'agendado' check (status in ('agendado', 'encerrado', 'correcao')),
  arbitro_id     uuid references perfis,
  pen_mandante   smallint check (pen_mandante between 0 and 30),
  pen_visitante  smallint check (pen_visitante between 0 and 30),
  wo_ausente_id  uuid references equipes,
  adiado         boolean not null default false,
  observacoes    text not null default '' check (length(observacoes) <= 600),
  assinaturas    jsonb not null default '{}',     -- caminhos no bucket privado "assinaturas"
  hash           text,                            -- código de autenticidade (SHA-256 da súmula)
  check (fase = 'grupos' or (vaga_mandante is not null and vaga_visitante is not null))
);
create index on jogos (campeonato_id);

create table eventos (
  id             uuid primary key,                 -- gerado no celular: reenviar não duplica
  jogo_id        uuid not null references jogos on delete cascade,
  tipo           text not null check (tipo in ('gol', 'amarelo', 'vermelho', 'falta')),
  equipe_id      uuid not null references equipes,
  atleta_id      uuid references atletas,
  minuto         smallint not null check (minuto between 0 and 130),
  tempo          smallint not null check (tempo in (1, 2)),
  registrado_em  timestamptz not null default now(),
  registrado_por uuid default auth.uid(),
  check (tipo = 'falta' or atleta_id is not null)
);
create index on eventos (jogo_id);

create table suspensoes (
  id        bigint generated always as identity primary key,
  atleta_id uuid not null references atletas on delete cascade,
  jogo_ids  uuid[] not null,
  motivo    text not null,
  criado_em timestamptz not null default now()
);

create table historico (
  id            bigint generated always as identity primary key,
  campeonato_id uuid references campeonatos on delete cascade,
  jogo_id       uuid references jogos on delete cascade,
  quem          text not null,
  o_que         text not null,
  motivo        text,
  em            timestamptz not null default now()
);

create table sorteios (
  campeonato_id   uuid primary key references campeonatos on delete cascade,
  hash            text not null check (hash ~ '^[0-9a-f]{64}$'),   -- publicado ANTES do sorteio
  semente         text check (semente ~ '^[0-9a-f]{16}$'),         -- revelada depois
  entrada_publica text,       -- números ditos em público na hora (ex.: pelos capitães)
  grupos          jsonb,
  publicado_em    timestamptz not null default now(),
  revelado_em     timestamptz
);

/* ============================== regras ============================== */
create function registrar(c uuid, j uuid, o_que text, motivo text default null) returns void
language sql security definer set search_path = public as $$
  insert into historico (campeonato_id, jogo_id, quem, o_que, motivo)
  values (c, j, coalesce((select nome || ' (' || papel || ')' from perfis where id = auth.uid()), 'sistema'), o_que, motivo)
$$;

create view placar as
select j.id as jogo_id,
  case when j.wo_ausente_id is null then (select count(*) from eventos e where e.jogo_id = j.id and e.tipo = 'gol' and e.equipe_id = j.mandante_id)
       when j.wo_ausente_id = j.mandante_id then 0 else 3 end::int as gols_mandante,
  case when j.wo_ausente_id is null then (select count(*) from eventos e where e.jogo_id = j.id and e.tipo = 'gol' and e.equipe_id = j.visitante_id)
       when j.wo_ausente_id = j.visitante_id then 0 else 3 end::int as gols_visitante
from jogos j;

create function vencedor(j uuid, perdedor boolean default false) returns uuid language sql stable security definer set search_path = public as $$
  select case when w is null then null when perdedor then (case when w = m.mandante_id then m.visitante_id else m.mandante_id end) else w end
  from jogos m join placar p on p.jogo_id = m.id,
  lateral (select case
    when m.status <> 'encerrado' then null
    when p.gols_mandante > p.gols_visitante then m.mandante_id
    when p.gols_mandante < p.gols_visitante then m.visitante_id
    when m.pen_mandante > m.pen_visitante then m.mandante_id
    when m.pen_mandante < m.pen_visitante then m.visitante_id end as w) x
  where m.id = j
$$;

-- desempate: pontos, vitórias, saldo, gols marcados, ordem alfabética (igual ao regras.js)
create view classificacao as   -- roda com permissão do dono: lê equipes sem expor o código
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
select t.*, v * 3 + e as pontos, gp - gc as saldo,
  row_number() over (partition by campeonato_id, grupo order by v * 3 + e desc, v desc, gp - gc desc, gp desc, nome)::int as posicao
from t;

create function grupo_encerrado(c uuid, g text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from jogos where campeonato_id = c and fase = 'grupos' and grupo = g)
     and not exists (select 1 from jogos where campeonato_id = c and fase = 'grupos' and grupo = g and status <> 'encerrado')
$$;

create function vaga_equipe(c uuid, vaga text) returns uuid language plpgsql stable security definer set search_path = public as $$
begin
  if vaga ~ '^[12][AB]$' then
    if not grupo_encerrado(c, substr(vaga, 2, 1)) then return null; end if;
    return (select equipe_id from classificacao where campeonato_id = c and grupo = substr(vaga, 2, 1) and posicao = substr(vaga, 1, 1)::int);
  end if;
  return vencedor(substr(vaga, 3)::uuid, left(vaga, 1) = 'P');
end $$;

-- preenche os times do mata-mata que ainda não começou
create function resolver_mata_mata(c uuid) returns void language plpgsql security definer set search_path = public as $$
declare k jogos;
begin
  for k in select * from jogos where campeonato_id = c and fase <> 'grupos' and status <> 'encerrado'
             and not exists (select 1 from eventos where jogo_id = jogos.id) order by data, hora loop
    update jogos set mandante_id = vaga_equipe(c, k.vaga_mandante), visitante_id = vaga_equipe(c, k.vaga_visitante) where id = k.id;
  end loop;
end $$;

create function resumo_jogo(j uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce(a.nome, '?') || ' ' || p.gols_mandante || ' × ' || p.gols_visitante || ' ' || coalesce(b.nome, '?')
    || coalesce(' (pênaltis ' || m.pen_mandante || '×' || m.pen_visitante || ')', '')
  from jogos m join placar p on p.jogo_id = m.id left join equipes a on a.id = m.mandante_id left join equipes b on b.id = m.visitante_id
  where m.id = j
$$;

-- código de autenticidade: muda se qualquer dado da súmula mudar
create function hash_sumula(j uuid) returns text language sql stable security definer set search_path = public, extensions as $$
  select encode(digest(jsonb_build_object(
    'jogo', m.id, 'mandante', m.mandante_id, 'visitante', m.visitante_id,
    'placar', jsonb_build_array(p.gols_mandante, p.gols_visitante),
    'penaltis', jsonb_build_array(m.pen_mandante, m.pen_visitante), 'wo', m.wo_ausente_id, 'obs', m.observacoes,
    'eventos', coalesce((select jsonb_agg(jsonb_build_array(e.tipo, e.equipe_id, e.atleta_id, e.minuto, e.tempo) order by e.tempo, e.minuto, e.id)
                         from eventos e where e.jogo_id = m.id), '[]'))::text, 'sha256'), 'hex')
  from jogos m join placar p on p.jogo_id = m.id where m.id = j
$$;

create function pode_apitar(j uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from jogos where id = j and status in ('agendado', 'correcao')
                 and mandante_id is not null and visitante_id is not null
                 and (arbitro_id = auth.uid() or e_secretaria()))
$$;

-- evento só de quem está no jogo, com atleta da equipe e inscrição aprovada
-- ponytail: suspensão por cartões é bloqueada só no celular (regras.js); validar aqui quando a regra for oficializada
create function evento_antes_gravar() returns trigger language plpgsql security definer set search_path = public as $$
declare m jogos; a atletas;
begin
  select * into m from jogos where id = new.jogo_id;
  if new.equipe_id not in (m.mandante_id, m.visitante_id) then raise exception 'Equipe não está neste jogo'; end if;
  if new.atleta_id is not null then
    select * into a from atletas where id = new.atleta_id;
    if a.equipe_id <> new.equipe_id then raise exception 'Atleta não é desta equipe'; end if;
    if situacao_atleta(a) <> 'aprovado' then raise exception 'Atleta com inscrição irregular'; end if;
    if exists (select 1 from suspensoes s where s.atleta_id = a.id and new.jogo_id = any (s.jogo_ids)) then
      raise exception 'Atleta suspenso nesta partida'; end if;
  end if;
  return new;
end $$;
create trigger evento_antes_gravar before insert on eventos for each row execute function evento_antes_gravar();

create function evento_desfeito() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform registrar((select campeonato_id from jogos where id = old.jogo_id), old.jogo_id,
    'Evento desfeito: ' || old.tipo || coalesce(' de ' || (select nome from atletas where id = old.atleta_id), '') || ' (' || old.minuto || ''')');
  return old;
end $$;
create trigger evento_desfeito after delete on eventos for each row execute function evento_desfeito();

/* ============================== ações (chamadas pelo app) ============================== */
create function confirmar_sumula(j uuid, pen_m int, pen_v int, obs text, assin jsonb) returns text
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
  if m.fase = 'final' then update campeonatos set status = 'encerrado' where id = m.campeonato_id; end if;
  return (select hash from jogos where id = j);
end $$;

create function exigir_secretaria(motivo text default 'xxxxx') returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not e_secretaria() then raise exception 'Só a Secretaria pode fazer isso' using errcode = '42501'; end if;
  if length(trim(coalesce(motivo, ''))) < 5 then raise exception 'Informe o motivo'; end if;
end $$;

create function reabrir_sumula(j uuid, motivo text) returns void language plpgsql security definer set search_path = public as $$
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
  if m.fase = 'final' then update campeonatos set status = 'andamento' where id = m.campeonato_id; end if;
  perform registrar(m.campeonato_id, j, 'Súmula reaberta para correção: ' || resumo_jogo(j), motivo);
  perform resolver_mata_mata(m.campeonato_id);
end $$;

create function registrar_wo(j uuid, ausente uuid, motivo text) returns void language plpgsql security definer set search_path = public as $$
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
  if m.fase = 'final' then update campeonatos set status = 'encerrado' where id = m.campeonato_id; end if;
end $$;

create function adiar_jogo(j uuid, nova_data date, nova_hora text, motivo text) returns void language plpgsql security definer set search_path = public as $$
declare m jogos;
begin
  perform exigir_secretaria(motivo);
  select * into m from jogos where id = j for update;
  if m.status = 'encerrado' then raise exception 'Jogo já encerrado'; end if;
  update jogos set data = nova_data, hora = nova_hora, adiado = true where id = j;
  perform registrar(m.campeonato_id, j, 'Jogo adiado de ' || to_char(m.data, 'DD/MM') || ' ' || m.hora || ' para ' || to_char(nova_data, 'DD/MM') || ' ' || nova_hora, motivo);
end $$;

create function aplicar_suspensao(a uuid, n int, motivo text) returns void language plpgsql security definer set search_path = public as $$
declare at atletas; ids uuid[]; c uuid;
begin
  perform exigir_secretaria(motivo);
  select * into at from atletas where id = a;
  select campeonato_id into c from equipes where id = at.equipe_id;
  select array_agg(id) into ids from (select id from jogos where status <> 'encerrado' and at.equipe_id in (mandante_id, visitante_id)
                                      order by data, hora limit greatest(1, least(n, 5))) x;
  if ids is null then raise exception 'A equipe não tem próximos jogos definidos'; end if;
  insert into suspensoes (atleta_id, jogo_ids, motivo) values (a, ids, motivo);
  perform registrar(c, null, 'Suspensão de ' || cardinality(ids) || ' jogo(s): ' || at.nome, motivo);
end $$;

-- representante entra com o código que a Secretaria passou
create function vincular_equipe(cod text, nome text) returns uuid language plpgsql security definer set search_path = public as $$
declare e equipes;
begin
  if auth.uid() is null then raise exception 'Faça login primeiro'; end if;
  if exists (select 1 from perfis where id = auth.uid()) then raise exception 'Este usuário já tem perfil'; end if;
  select * into e from equipes where codigo = upper(trim(cod));
  if not found then raise exception 'Código de equipe inválido'; end if;
  insert into perfis (id, nome, papel, equipe_id) values (auth.uid(), nome, 'equipe', e.id);
  perform registrar(e.campeonato_id, null, 'Representante vinculado à equipe ' || e.nome);
  return e.id;
end $$;

/* sorteio auditável: 1) publica o hash  2) sorteia em público  3) revela semente + entrada pública  4) gera a tabela.
   A semente final é sha256(semente || entrada_publica): como a entrada pública só é conhecida na hora,
   ninguém consegue escolher antes uma semente que favoreça alguém. */
create function publicar_compromisso(c uuid, h text) returns void language plpgsql security definer set search_path = public as $$
begin
  perform exigir_secretaria();
  if (select status from campeonatos where id = c) <> 'inscricoes' then raise exception 'Inscrições já encerradas'; end if;
  insert into sorteios (campeonato_id, hash) values (c, lower(h));   -- só um compromisso por campeonato
  perform registrar(c, null, 'Compromisso do sorteio publicado: ' || left(lower(h), 16) || '…');
end $$;

create function revelar_semente(c uuid, s text, entrada text) returns text language plpgsql security definer set search_path = public, extensions as $$
declare r sorteios;
begin
  perform exigir_secretaria();
  select * into r from sorteios where campeonato_id = c for update;
  if r.revelado_em is not null then raise exception 'Semente já revelada'; end if;
  if encode(digest(lower(s), 'sha256'), 'hex') <> r.hash then raise exception 'A semente não confere com o compromisso publicado'; end if;
  if length(trim(coalesce(entrada, ''))) < 3 then raise exception 'Informe a entrada pública do sorteio'; end if;
  update sorteios set semente = lower(s), entrada_publica = trim(entrada), revelado_em = now() where campeonato_id = c;
  perform registrar(c, null, 'Semente revelada: ' || lower(s) || ' · entrada pública: ' || trim(entrada));
  return left(encode(digest(lower(s) || trim(entrada), 'sha256'), 'hex'), 16);   -- semente final usada no sorteio
end $$;

-- grupos e jogos montados pelo app (regras.js); qualquer pessoa refaz e confere no portal com a semente final
create function aplicar_sorteio(c uuid, g jsonb, jogos_novos jsonb) returns void language plpgsql security definer set search_path = public as $$
declare todas uuid[]; sorteadas uuid[];
begin
  perform exigir_secretaria();
  if (select revelado_em from sorteios where campeonato_id = c) is null then raise exception 'Revele a semente antes'; end if;
  if (select status from campeonatos where id = c) <> 'inscricoes' then raise exception 'Tabela já gerada'; end if;
  select array_agg(id order by id) into todas from equipes where campeonato_id = c;
  select array_agg(x::uuid order by x::uuid) into sorteadas from (select jsonb_array_elements_text(g->'A') x union all select jsonb_array_elements_text(g->'B')) y;
  if todas is distinct from sorteadas then raise exception 'Os grupos precisam ter todas as equipes do campeonato, uma vez cada'; end if;
  update equipes set grupo = case when g->'A' ? id::text then 'A' else 'B' end where campeonato_id = c;
  insert into jogos (id, campeonato_id, fase, rodada, grupo, titulo, mandante_id, visitante_id, vaga_mandante, vaga_visitante, data, hora)
    select id, c, fase, rodada, grupo, titulo, mandante_id, visitante_id, vaga_mandante, vaga_visitante, data, hora
    from jsonb_to_recordset(jogos_novos) as x(id uuid, fase text, rodada smallint, grupo char(1), titulo text, mandante_id uuid, visitante_id uuid,
                                               vaga_mandante text, vaga_visitante text, data date, hora text);
  if exists (select 1 from jogos where campeonato_id = c and fase = 'grupos'
             and (mandante_id not in (select id from equipes where campeonato_id = c and grupo = jogos.grupo)
               or visitante_id not in (select id from equipes where campeonato_id = c and grupo = jogos.grupo))) then
    raise exception 'Jogo com equipe fora do grupo';
  end if;
  update sorteios set grupos = g where campeonato_id = c;
  update campeonatos set status = 'andamento' where id = c;
  perform registrar(c, null, 'Sorteio aplicado: ' || jsonb_array_length(jogos_novos) || ' jogos gerados');
end $$;

-- portal: "Conferir uma súmula" pelo código impresso
create function conferir_sumula(codigo text) returns table (jogo_id uuid, campeonato text, resumo text, autentica boolean)
language sql stable security definer set search_path = public as $$
  select m.id, c.nome, resumo_jogo(m.id), m.hash = hash_sumula(m.id)
  from jogos m join campeonatos c on c.id = m.campeonato_id
  where length(regexp_replace(lower(codigo), '[^0-9a-f]', '', 'g')) >= 8
    and m.hash like regexp_replace(lower(codigo), '[^0-9a-f]', '', 'g') || '%'
  limit 1
$$;

/* ============================== portal público (LGPD: sem nascimento, foto ou código) ============================== */
create view equipes_publico as select id, campeonato_id, nome, bairro, pote, grupo from equipes;
create view atletas_publico as
  select a.id, a.equipe_id, a.nome, a.numero from atletas a where situacao_atleta(a) = 'aprovado';
create view historico_publico as select jogo_id, quem, o_que, motivo, em from historico where jogo_id is not null;
create view sorteios_publico as select campeonato_id, hash, semente, entrada_publica, grupos, publicado_em, revelado_em from sorteios;

/* ============================== acesso (RLS) ============================== */
alter table perfis      enable row level security;
alter table campeonatos enable row level security;
alter table equipes     enable row level security;
alter table atletas     enable row level security;
alter table jogos       enable row level security;
alter table eventos     enable row level security;
alter table suspensoes  enable row level security;
alter table historico   enable row level security;
alter table sorteios    enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- leitura pública
grant select on campeonatos, jogos, eventos, placar, classificacao,
                equipes_publico, atletas_publico, historico_publico, sorteios_publico to anon, authenticated;
create policy publico on campeonatos for select using (true);
create policy publico on jogos       for select using (true);
create policy publico on eventos     for select using (true);

-- perfis
grant select, insert, update, delete on perfis to authenticated;
create policy proprio on perfis for select to authenticated using (id = auth.uid() or e_secretaria());
create policy secretaria on perfis for all to authenticated using (e_secretaria()) with check (e_secretaria());

-- cadastro: Secretaria gerencia; equipe vê a si mesma e inscreve atletas (sempre entram "em análise")
grant insert, update, delete on campeonatos to authenticated;
create policy secretaria on campeonatos for all to authenticated using (e_secretaria()) with check (e_secretaria());

grant select, insert, update, delete on equipes to authenticated;
create policy secretaria on equipes for all to authenticated using (e_secretaria()) with check (e_secretaria());
create policy propria on equipes for select to authenticated using (id = minha_equipe());

grant select, insert, update, delete on atletas to authenticated;
create policy secretaria on atletas for all to authenticated using (e_secretaria()) with check (e_secretaria());
create policy equipe_ve on atletas for select to authenticated using (equipe_id = minha_equipe());
create policy equipe_inscreve on atletas for insert to authenticated with check (
  equipe_id = minha_equipe()
  and (select c.status from equipes e join campeonatos c on c.id = e.campeonato_id where e.id = equipe_id) <> 'encerrado');
create policy arbitro_ve on atletas for select to authenticated using (exists (
  select 1 from jogos where arbitro_id = auth.uid() and atletas.equipe_id in (mandante_id, visitante_id)));

-- jogos: a Secretaria só escala árbitro direto; resultado muda só pelas funções acima
grant update (arbitro_id) on jogos to authenticated;
create policy secretaria on jogos for update to authenticated using (e_secretaria()) with check (e_secretaria());

-- eventos: árbitro escalado (ou Secretaria) registra e desfaz enquanto a súmula está aberta
grant insert, delete on eventos to authenticated;
create policy apita on eventos for insert to authenticated with check (pode_apitar(jogo_id));
create policy desfaz on eventos for delete to authenticated using (pode_apitar(jogo_id));

grant select on suspensoes to authenticated;
create policy le on suspensoes for select to authenticated using (true);
grant select on historico to authenticated;
create policy secretaria on historico for select to authenticated using (e_secretaria());

-- funções usadas nas regras de acesso e as que o app chama
grant execute on function e_secretaria(), minha_equipe(), pode_apitar(uuid) to anon, authenticated;
grant execute on function situacao_atleta(atletas), vencedor(uuid, boolean), conferir_sumula(text) to anon, authenticated;
grant execute on function confirmar_sumula(uuid, int, int, text, jsonb), reabrir_sumula(uuid, text),
  registrar_wo(uuid, uuid, text), adiar_jogo(uuid, date, text, text), aplicar_suspensao(uuid, int, text),
  vincular_equipe(text, text), publicar_compromisso(uuid, text), revelar_semente(uuid, text, text),
  aplicar_sorteio(uuid, jsonb, jsonb), meu_papel() to authenticated;

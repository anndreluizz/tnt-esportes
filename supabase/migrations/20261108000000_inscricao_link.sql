-- Campeonato mais completo e inscrição de atletas por link (sem precisar de conta).

-- campeonato: logo, responsável, patrocinadores e regras da inscrição
alter table campeonatos
  add column logo_path            text,
  add column responsavel          text check (length(responsavel) <= 60),
  add column responsavel_telefone text check (length(responsavel_telefone) <= 20),
  add column patrocinadores       jsonb not null default '[]',   -- [{nome, logo_path}]
  add column inscricao_ate        date,
  add column max_atletas          smallint not null default 20 check (max_atletas between 5 and 40);

-- cada equipe tem um link secreto de inscrição (diferente do código do representante)
alter table equipes add column link_token uuid not null unique default gen_random_uuid();

-- atleta: mais dados e documento (RG) em arquivo privado, só a Secretaria vê
alter table atletas
  add column apelido              text check (length(apelido) <= 30),
  add column posicao              text check (length(posicao) <= 20),
  add column telefone             text check (length(telefone) <= 20),
  add column responsavel          text check (length(responsavel) <= 60),
  add column responsavel_telefone text check (length(responsavel_telefone) <= 20),
  add column rg_frente_path       text,
  add column rg_verso_path        text,
  add column origem               text not null default 'secretaria' check (origem in ('secretaria', 'equipe', 'link'));

create function inscricoes_abertas(c campeonatos) returns boolean language sql stable as $$
  select c.status <> 'encerrado' and (c.inscricao_ate is null or c.inscricao_ate >= (now() at time zone 'America/Manaus')::date)
$$;

-- página do link: dados do campeonato e da equipe, e quem já foi inscrito (só nome e número)
create function link_inscricao(t uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('equipe_id', e.id, 'equipe', e.nome, 'campeonato', c.nome, 'modalidade', c.modalidade, 'categoria', c.categoria,
    'idade_min', c.idade_min, 'idade_max', c.idade_max, 'inicio', c.inicio, 'local', c.local, 'logo', c.logo_path,
    'patrocinadores', c.patrocinadores, 'inscricao_ate', c.inscricao_ate, 'max_atletas', c.max_atletas, 'aberta', inscricoes_abertas(c),
    'inscritos', (select coalesce(jsonb_agg(jsonb_build_object('nome', a.nome, 'numero', a.numero) order by a.numero), '[]')
                  from atletas a where a.equipe_id = e.id))
  from equipes e join campeonatos c on c.id = e.campeonato_id where e.link_token = t
$$;

-- inscrição pelo link: entra sempre "em análise"; arquivos só da pasta <equipe>/<link>/
create function inscrever_pelo_link(t uuid, a jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare e equipes; c campeonatos; pasta text; novo uuid := coalesce((a->>'id')::uuid, gen_random_uuid());
begin
  select * into e from equipes where link_token = t;
  if not found then raise exception 'Link de inscrição inválido'; end if;
  select * into c from campeonatos where id = e.campeonato_id;
  if not inscricoes_abertas(c) then raise exception 'As inscrições deste campeonato estão encerradas'; end if;
  if (select count(*) from atletas where equipe_id = e.id) >= c.max_atletas then
    raise exception 'A equipe já tem o máximo de % atletas', c.max_atletas; end if;
  if not coalesce((a->>'consentimento')::boolean, false) then raise exception 'É preciso aceitar o uso dos dados (LGPD)'; end if;
  pasta := e.id || '/' || t || '/';
  if a->>'foto_path' is null or a->>'rg_frente_path' is null or a->>'rg_verso_path' is null then
    raise exception 'Envie a foto do atleta e o documento (frente e verso)'; end if;
  if not (a->>'foto_path' like pasta || '%' and a->>'rg_frente_path' like pasta || '%' and a->>'rg_verso_path' like pasta || '%') then
    raise exception 'Arquivo inválido'; end if;
  insert into atletas (id, equipe_id, nome, apelido, numero, nascimento, bairro, posicao, telefone, responsavel, responsavel_telefone,
                       consentimento, foto_path, rg_frente_path, rg_verso_path, origem)
  values (novo, e.id, trim(a->>'nome'), nullif(trim(a->>'apelido'), ''), (a->>'numero')::smallint, (a->>'nascimento')::date,
          coalesce(nullif(a->>'bairro', ''), 'Centro'), nullif(a->>'posicao', ''), nullif(trim(a->>'telefone'), ''),
          nullif(trim(a->>'responsavel'), ''), nullif(trim(a->>'responsavel_telefone'), ''), true,
          a->>'foto_path', a->>'rg_frente_path', a->>'rg_verso_path', 'link');
  perform registrar(c.id, null, 'Atleta inscrito pelo link: ' || trim(a->>'nome') || ' (' || e.nome || ')');
  return novo;
end $$;

revoke execute on function inscricoes_abertas(campeonatos), link_inscricao(uuid), inscrever_pelo_link(uuid, jsonb) from public;
grant execute on function link_inscricao(uuid), inscrever_pelo_link(uuid, jsonb) to anon, authenticated;

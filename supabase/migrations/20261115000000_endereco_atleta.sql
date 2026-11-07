-- Endereço do atleta (rua e número ou comunidade, bairro livre, município). Só a Secretaria e a própria equipe veem;
-- o portal público (atletas_publico) continua só com nome e número.
alter table atletas
  add column endereco  text check (length(endereco) <= 100),
  add column municipio text check (length(municipio) <= 40);

create or replace function inscrever_pelo_link(t uuid, a jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare e equipes; c campeonatos; pasta text; novo uuid := coalesce((a->>'id')::uuid, gen_random_uuid());
begin
  select * into e from equipes where link_token = t;
  if not found then raise exception 'Link de inscrição inválido'; end if;
  select * into c from campeonatos where id = e.campeonato_id;
  if not inscricoes_abertas(c) then raise exception 'As inscrições deste campeonato estão encerradas'; end if;
  if (select count(*) from atletas where equipe_id = e.id) >= c.max_atletas then
    raise exception 'A equipe já tem o máximo de % atletas', c.max_atletas; end if;
  if not coalesce((a->>'consentimento')::boolean, false) then raise exception 'É preciso aceitar o uso dos dados (LGPD)'; end if;
  if length(trim(coalesce(a->>'endereco', ''))) < 3 or length(trim(coalesce(a->>'bairro', ''))) < 2 or length(trim(coalesce(a->>'municipio', ''))) < 2 then
    raise exception 'Informe o endereço, o bairro ou comunidade e o município'; end if;
  pasta := e.id || '/' || t || '/';
  if a->>'foto_path' is null or a->>'rg_frente_path' is null or a->>'rg_verso_path' is null then
    raise exception 'Envie a foto do atleta e o documento (frente e verso)'; end if;
  if not (a->>'foto_path' like pasta || '%' and a->>'rg_frente_path' like pasta || '%' and a->>'rg_verso_path' like pasta || '%') then
    raise exception 'Arquivo inválido'; end if;
  insert into atletas (id, equipe_id, nome, apelido, numero, nascimento, endereco, bairro, municipio, posicao, telefone, responsavel, responsavel_telefone,
                       consentimento, foto_path, rg_frente_path, rg_verso_path, origem)
  values (novo, e.id, trim(a->>'nome'), nullif(trim(a->>'apelido'), ''), (a->>'numero')::smallint, (a->>'nascimento')::date,
          left(trim(a->>'endereco'), 100), left(trim(a->>'bairro'), 60), left(nullif(trim(a->>'municipio'), ''), 40),
          nullif(a->>'posicao', ''), nullif(trim(a->>'telefone'), ''),
          nullif(trim(a->>'responsavel'), ''), nullif(trim(a->>'responsavel_telefone'), ''), true,
          a->>'foto_path', a->>'rg_frente_path', a->>'rg_verso_path', 'link');
  perform registrar(c.id, null, 'Atleta inscrito pelo link: ' || trim(a->>'nome') || ' (' || e.nome || ')');
  return novo;
end $$;

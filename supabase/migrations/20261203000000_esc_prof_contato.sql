-- WhatsApp de cada professor: quem adiciona o professor na pagina da turma informa o numero; so a Secretaria le (para enviar o link do professor pelo WhatsApp).
-- O numero nunca aparece em tela publica nem no portal: a tabela nao tem acesso para anon/authenticated, so as funcoes abaixo.
create table esc_prof_contatos (
  campeonato_id uuid not null references esc_campeonatos (id) on delete cascade,
  origem        text not null,
  nome          text not null check (length(nome) between 3 and 60),
  telefone      text not null check (telefone ~ '^55[0-9]{10,11}$'),   -- so digitos, com 55 na frente (ex.: 5592999999999)
  primary key (campeonato_id, origem, nome)
);
alter table esc_prof_contatos enable row level security;
revoke all on esc_prof_contatos from anon, authenticated;

-- Link da turma (com inscricoes abertas): guarda o WhatsApp do professor. Aceita com ou sem 55, com espacos, parenteses ou tracos.
create function esc_turma_contato(p_token uuid, p_nome text, p_telefone text) returns void
language plpgsql security definer set search_path = public as $$
declare l esc_turma_links; v_tel text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'); v_nome text := btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g'));
begin
  if length(v_tel) in (10, 11) then v_tel := '55' || v_tel; end if;
  if v_tel !~ '^55[0-9]{10,11}$' then raise exception 'check telefone'; end if;
  if length(v_nome) not between 3 and 60 then raise exception 'check nome'; end if;
  select ll.* into l from esc_turma_links ll join esc_campeonatos c on c.id = ll.campeonato_id where ll.token = p_token and c.inscricoes_abertas;
  if not found then raise exception 'link invalido ou inscricoes encerradas'; end if;
  insert into esc_prof_contatos (campeonato_id, origem, nome, telefone) values (l.campeonato_id, l.origem, v_nome, v_tel)
    on conflict (campeonato_id, origem, nome) do update set telefone = excluded.telefone;
end $$;

-- Secretaria: nome e WhatsApp de cada professor, por turma
create function esc_contatos_prof(p_campeonato uuid) returns table (origem text, nome text, telefone text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not e_secretaria() then raise exception 'apenas a Secretaria'; end if;
  return query select c.origem, c.nome, c.telefone from esc_prof_contatos c where c.campeonato_id = p_campeonato order by c.origem, c.nome;
end $$;

revoke execute on function esc_turma_contato(uuid, text, text), esc_contatos_prof(uuid) from public;
grant execute on function esc_turma_contato(uuid, text, text) to anon, authenticated;
grant execute on function esc_contatos_prof(uuid) to authenticated;

-- COMO DESFAZER: drop function esc_turma_contato(uuid, text, text), esc_contatos_prof(uuid); drop table esc_prof_contatos;

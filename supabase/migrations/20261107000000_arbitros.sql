-- Árbitro cria a conta no app; a Secretaria libera pelo e-mail (sem precisar ver a lista de usuários do sistema).
create function liberar_arbitro(email_arbitro text, nome_arbitro text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  perform exigir_secretaria();
  if length(trim(coalesce(nome_arbitro, ''))) < 2 then raise exception 'Informe o nome do árbitro'; end if;
  select id into u from auth.users where lower(email) = lower(trim(email_arbitro));
  if u is null then raise exception 'Nenhuma conta com esse e-mail. Peça ao árbitro para criar a conta no app primeiro.'; end if;
  if exists (select 1 from perfis where id = u) then raise exception 'Essa conta já tem acesso ao sistema.'; end if;
  insert into perfis (id, nome, papel) values (u, trim(nome_arbitro), 'arbitro');
  perform registrar(null, null, 'Árbitro liberado: ' || trim(nome_arbitro));
end $$;
revoke execute on function liberar_arbitro(text, text) from public, anon;
grant execute on function liberar_arbitro(text, text) to authenticated;

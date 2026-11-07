-- 1) A Secretaria libera contas de árbitro ou de outra pessoa da Secretaria pelo e-mail (a equipe entra pelo código).
-- 2) Suspensão automática por cartões (regra do campeonato) conferida também pelo banco, não só no celular do árbitro.

create function liberar_acesso(email_conta text, nome_conta text, papel_conta papel) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  perform exigir_secretaria();
  if papel_conta = 'equipe' then raise exception 'O representante da equipe entra com o código da equipe'; end if;
  if length(trim(coalesce(nome_conta, ''))) < 2 then raise exception 'Informe o nome'; end if;
  select id into u from auth.users where lower(email) = lower(trim(email_conta));
  if u is null then raise exception 'Nenhuma conta com esse e-mail. Peça para a pessoa criar a conta no app primeiro.'; end if;
  if exists (select 1 from perfis where id = u) then raise exception 'Essa conta já tem acesso ao sistema.'; end if;
  insert into perfis (id, nome, papel) values (u, trim(nome_conta), papel_conta);
  perform registrar(null, null, case papel_conta when 'secretaria' then 'Acesso de Secretaria liberado: ' else 'Árbitro liberado: ' end || trim(nome_conta));
end $$;
revoke execute on function liberar_acesso(text, text, papel) from public, anon;
grant execute on function liberar_acesso(text, text, papel) to authenticated;

-- mesma regra do regras.js (discipline): N amarelos = 1 jogo; vermelho = X jogos; conta na ordem dos jogos da equipe
create function suspensao_automatica(a uuid, j uuid) returns text language plpgsql stable security definer set search_path = public as $$
declare t uuid; c campeonatos; lim int; verm int; y int := 0; pend int := 0; motivo text; m record; e record;
begin
  select equipe_id into t from atletas where id = a;
  select cp.* into c from campeonatos cp join jogos jj on jj.campeonato_id = cp.id where jj.id = j;
  lim := coalesce((c.regras->>'amarelos')::int, 3); verm := coalesce((c.regras->>'vermelho')::int, 1);
  for m in select id, status from jogos where campeonato_id = c.id and t in (mandante_id, visitante_id) order by data, hora, id loop
    if pend > 0 then
      if m.id = j then return motivo; end if;
      pend := pend - 1; continue;
    end if;
    if m.id = j or m.status <> 'encerrado' then return null; end if;
    for e in select tipo from eventos where jogo_id = m.id and atleta_id = a and tipo in ('amarelo', 'vermelho') order by tempo, minuto loop
      if e.tipo = 'vermelho' then pend := verm; motivo := 'cartão vermelho'; end if;
      if e.tipo = 'amarelo' then y := y + 1;
        if y >= lim then y := 0; pend := greatest(pend, 1); motivo := lim || ' cartões amarelos'; end if;
      end if;
    end loop;
  end loop;
  return null;
end $$;
revoke execute on function suspensao_automatica(uuid, uuid) from public;

-- evento só de quem está no jogo, com atleta da equipe, inscrição aprovada e sem suspensão
create or replace function evento_antes_gravar() returns trigger language plpgsql security definer set search_path = public as $$
declare m jogos; a atletas; s text;
begin
  select * into m from jogos where id = new.jogo_id;
  if new.equipe_id not in (m.mandante_id, m.visitante_id) then raise exception 'Equipe não está neste jogo'; end if;
  if new.atleta_id is not null then
    select * into a from atletas where id = new.atleta_id;
    if a.equipe_id <> new.equipe_id then raise exception 'Atleta não é desta equipe'; end if;
    if situacao_atleta(a) <> 'aprovado' then raise exception 'Atleta com inscrição irregular'; end if;
    if exists (select 1 from suspensoes x where x.atleta_id = a.id and new.jogo_id = any (x.jogo_ids)) then
      raise exception 'Atleta suspenso nesta partida (decisão da comissão)'; end if;
    s := suspensao_automatica(a.id, new.jogo_id);
    if s is not null then raise exception 'Atleta suspenso nesta partida (%)', s; end if;
  end if;
  return new;
end $$;

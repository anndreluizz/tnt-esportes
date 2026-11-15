-- AUDITORIA DE ALTERAÇÕES (decisão da Secretaria, 14/11/2026).
-- Antes: só as funções do banco gravavam em "historico" (súmula, W.O., sorteio, acessos...). Criar, editar e excluir campeonato, equipe e atleta,
-- aprovar inscrição e escalar árbitro NÃO deixavam registro (foi assim que a lista de patrocinadores ficou vazia sem ninguém saber como).
--
-- O que esta migration faz:
--  1) Cria a tabela "auditoria": só acréscimo, lida só pela Secretaria, sem vínculo que a apague (sobrevive à exclusão do campeonato, da equipe ou do atleta).
--  2) Grava quem (id do usuário + nome e papel no momento), quando, o quê, e o antes/depois APENAS de colunas que não são dados pessoais.
--     Atletas: nunca nome, nascimento, telefone, endereço, responsável, foto nem documento (aparece só o NOME da coluna que mudou).
--     Equipes: nunca o telefone do responsável, o código da equipe nem o link de inscrição (são credenciais).
--  3) Gatilhos em campeonatos, equipes, atletas, perfis e, em jogos, só na troca de árbitro. O resto de jogos já é registrado pelas funções.
--  4) Sem duplicidade: as funções que já gravam em "historico" (inscrição pelo link, sorteio, cancelamento do sorteio, vínculo de equipe, liberação
--     de acesso) ficam marcadas com application_name = 'tnt_ja_registrado', e o gatilho não registra de novo o que elas fazem.
--  5) "historico" ganha a coluna usuario_id (opcional) e registrar() passa a preenchê-la. Nada do histórico existente é alterado.
-- Não preenche o passado: só o que acontecer depois da migration entra. Não mexe no portal público (nenhuma view pública nova).
-- Repetível: pode rodar de novo sem erro e sem mudar nada.
--
-- Limite: quem tem acesso de administrador ao banco (editor SQL) ainda pode desligar gatilhos. O que a migration garante é que ninguém pelo app,
-- nem a Secretaria, consegue escrever, alterar ou apagar a auditoria, e que mudanças feitas pelo editor SQL também são registradas (origem "administrador").

-- 1) historico: quem fez, por id (a coluna "quem" continua com o texto de sempre)
alter table historico add column if not exists usuario_id uuid;
create or replace function registrar(c uuid, j uuid, o_que text, motivo text default null) returns void
language sql security definer set search_path = public as $$
  insert into historico (campeonato_id, jogo_id, quem, o_que, motivo, usuario_id)
  values (c, j, coalesce((select nome || ' (' || papel || ')' from perfis where id = auth.uid()), 'sistema'), o_que, motivo, auth.uid())
$$;

-- 2) a tabela. Sem chaves estrangeiras de propósito: apagar o campeonato, a equipe, o atleta ou a conta NÃO apaga o registro.
create table if not exists auditoria (
  id             bigint generated always as identity primary key,
  em             timestamptz not null default now(),
  usuario_id     uuid,
  usuario_nome   text,
  usuario_papel  text,
  origem         text not null check (origem in ('app', 'visitante', 'sistema', 'administrador')),
  tabela         text not null,
  operacao       text not null check (operacao in ('INSERT', 'UPDATE', 'DELETE')),
  registro_id    text not null,
  campeonato_id  uuid,
  resumo         text not null,
  alteradas      text[],     -- nomes de TODAS as colunas que mudaram (sem valores)
  antes          jsonb,      -- só colunas permitidas (auditoria_colunas)
  depois         jsonb
);
create index if not exists auditoria_em_idx on auditoria (em desc);
create index if not exists auditoria_campeonato_idx on auditoria (campeonato_id, em desc);
create index if not exists auditoria_usuario_idx on auditoria (usuario_id, em desc);
create index if not exists auditoria_tabela_idx on auditoria (tabela, em desc);

alter table auditoria enable row level security;
revoke all on auditoria from public, anon, authenticated;
revoke all on sequence auditoria_id_seq from public, anon, authenticated;
grant select on auditoria to authenticated;
drop policy if exists secretaria on auditoria;
create policy secretaria on auditoria for select to authenticated using (e_secretaria());

-- 3) ninguém altera nem apaga a auditoria (nem a Secretaria, nem pelo app, nem por engano no editor SQL)
create or replace function auditoria_imutavel() returns trigger language plpgsql set search_path = public as $$
begin raise exception 'A auditoria não pode ser alterada nem apagada'; end $$;
drop trigger if exists auditoria_sem_alterar on auditoria;
create trigger auditoria_sem_alterar before update or delete on auditoria for each row execute function auditoria_imutavel();
drop trigger if exists auditoria_sem_truncar on auditoria;
create trigger auditoria_sem_truncar before truncate on auditoria for each statement execute function auditoria_imutavel();

-- 4) lista de colunas cujo valor pode ser guardado. Coluna que não está aqui (inclusive as que forem criadas no futuro) nunca tem o valor guardado.
create or replace function auditoria_colunas(t text) returns text[] language sql immutable set search_path = public as $$
  select case t
    when 'campeonatos' then array['nome', 'modalidade', 'categoria', 'idade_min', 'idade_max', 'inicio', 'local', 'status', 'formato', 'regras', 'inscricao_ate', 'max_atletas', 'patrocinadores', 'logo_path']
    when 'equipes'     then array['campeonato_id', 'nome', 'bairro', 'pote', 'grupo', 'cores', 'escudo_path']
    when 'atletas'     then array['equipe_id', 'numero', 'aprovado', 'autorizacao']
    when 'perfis'      then array['papel', 'equipe_id']
    when 'jogos'       then array['arbitro_id']
    else array[]::text[] end
$$;

-- 5) o gatilho
create or replace function auditar() returns trigger language plpgsql security definer set search_path = public as $$
declare
  vo jsonb := case when TG_OP <> 'INSERT' then to_jsonb(OLD) end;
  vn jsonb := case when TG_OP <> 'DELETE' then to_jsonb(NEW) end;
  r jsonb := coalesce(vn, vo);
  cols text[] := auditoria_colunas(TG_TABLE_NAME);
  retorno record := case when TG_OP = 'DELETE' then OLD else NEW end;
  alt text[]; antes jsonb; depois jsonb; camp uuid; resumo text; eq text; base text;
  uid uuid := auth.uid(); nome text; papel text; origem text; n_eq int; n_at int; n_jg int; n_ev int;
begin
  -- a função que está rodando já grava em "historico": não registra de novo
  if current_setting('application_name', true) = 'tnt_ja_registrado' then return retorno; end if;

  if TG_OP = 'UPDATE' then
    select coalesce(array_agg(k order by k), '{}') into alt from jsonb_object_keys(vn) k where vn -> k is distinct from vo -> k;
    if cardinality(alt) = 0 then return retorno; end if;
    if TG_TABLE_NAME = 'jogos' and not ('arbitro_id' = any (alt)) then return retorno; end if;
  end if;

  -- exclusão em cascata (o pai já foi excluído): o registro do pai já diz quantos filhos saíram junto
  if TG_OP = 'DELETE' and (
       (TG_TABLE_NAME = 'atletas' and not exists (select 1 from equipes where id = (vo ->> 'equipe_id')::uuid))
    or (TG_TABLE_NAME = 'equipes' and not exists (select 1 from campeonatos where id = (vo ->> 'campeonato_id')::uuid))
    or (TG_TABLE_NAME = 'perfis' and vo ->> 'equipe_id' is not null and not exists (select 1 from equipes where id = (vo ->> 'equipe_id')::uuid))) then
    return retorno;
  end if;

  if vo is not null then select coalesce(jsonb_object_agg(k, vo -> k), '{}') into antes from unnest(cols) k where TG_OP = 'DELETE' or k = any (alt); end if;
  if vn is not null then select coalesce(jsonb_object_agg(k, vn -> k), '{}') into depois from unnest(cols) k where TG_OP = 'INSERT' or k = any (alt); end if;

  camp := case TG_TABLE_NAME
    when 'campeonatos' then (r ->> 'id')::uuid
    when 'equipes' then (r ->> 'campeonato_id')::uuid
    when 'jogos' then (r ->> 'campeonato_id')::uuid
    else (select e.campeonato_id from equipes e where e.id = (r ->> 'equipe_id')::uuid) end;

  if uid is not null then
    select p.nome, p.papel::text into nome, papel from perfis p where p.id = uid; origem := 'app';
  elsif current_setting('application_name', true) ilike 'pg_cron%' then origem := 'sistema';
  elsif current_setting('role', true) = 'anon' then origem := 'visitante';
  else origem := 'administrador'; end if;

  -- resumo em texto: só equipe, camisa, nome do campeonato e nomes de colunas; nunca dado pessoal
  if TG_TABLE_NAME = 'campeonatos' then
    if TG_OP = 'INSERT' then resumo := 'Campeonato criado: ' || (r ->> 'nome');
    elsif TG_OP = 'UPDATE' then resumo := 'Campeonato alterado: ' || (r ->> 'nome') || ' · campos: ' || array_to_string(alt, ', ');
    else
      select count(*) into n_eq from equipes where campeonato_id = (vo ->> 'id')::uuid;
      select count(*) into n_at from atletas a join equipes e on e.id = a.equipe_id where e.campeonato_id = (vo ->> 'id')::uuid;
      select count(*) into n_jg from jogos where campeonato_id = (vo ->> 'id')::uuid;
      select count(*) into n_ev from eventos v join jogos j on j.id = v.jogo_id where j.campeonato_id = (vo ->> 'id')::uuid;
      resumo := 'Campeonato excluído: ' || (r ->> 'nome') || ' (' || n_eq || ' equipes, ' || n_at || ' atletas, ' || n_jg || ' jogos e ' || n_ev || ' eventos removidos junto)';
    end if;
  elsif TG_TABLE_NAME = 'equipes' then
    if TG_OP = 'INSERT' then resumo := 'Equipe criada: ' || (r ->> 'nome');
    elsif TG_OP = 'UPDATE' then resumo := 'Equipe alterada: ' || (r ->> 'nome') || ' · campos: ' || array_to_string(alt, ', ');
    else
      select count(*) into n_at from atletas where equipe_id = (vo ->> 'id')::uuid;
      resumo := 'Equipe excluída: ' || (r ->> 'nome') || ' (' || n_at || ' atletas removidos junto)';
    end if;
  elsif TG_TABLE_NAME = 'atletas' then
    select e.nome into eq from equipes e where e.id = (r ->> 'equipe_id')::uuid;
    base := 'equipe ' || coalesce(eq, '?') || ', camisa ' || (r ->> 'numero');
    if TG_OP = 'INSERT' then resumo := 'Atleta cadastrado: ' || base;
    elsif TG_OP = 'DELETE' then resumo := 'Atleta removido: ' || base;
    else
      resumo := case
        when 'aprovado' = any (alt) then case when (vn ->> 'aprovado')::boolean then 'Atleta aprovado: ' else 'Aprovação do atleta retirada: ' end
        when 'autorizacao' = any (alt) then case when (vn ->> 'autorizacao')::boolean then 'Autorização do responsável concedida: ' else 'Autorização do responsável retirada: ' end
        else 'Dados do atleta alterados: ' end || base || ' · campos: ' || array_to_string(alt, ', ');
    end if;
  elsif TG_TABLE_NAME = 'perfis' then
    resumo := case TG_OP when 'INSERT' then 'Acesso criado: ' || (r ->> 'papel') when 'DELETE' then 'Acesso removido: ' || (r ->> 'papel')
              else 'Acesso alterado: ' || (r ->> 'papel') || ' · campos: ' || array_to_string(alt, ', ') end;
  else   -- jogos: troca de árbitro
    resumo := 'Árbitro ' || case when vo ->> 'arbitro_id' is null then 'escalado' when vn ->> 'arbitro_id' is null then 'retirado' else 'trocado' end || ' no jogo: '
      || coalesce((select m.nome || ' x ' || v.nome from equipes m, equipes v where m.id = (r ->> 'mandante_id')::uuid and v.id = (r ->> 'visitante_id')::uuid), 'a definir');
  end if;

  insert into auditoria (usuario_id, usuario_nome, usuario_papel, origem, tabela, operacao, registro_id, campeonato_id, resumo, alteradas, antes, depois)
  values (uid, nome, papel, origem, TG_TABLE_NAME, TG_OP, r ->> 'id', camp, coalesce(resumo, 'Alteração em ' || TG_TABLE_NAME), alt, antes, depois);   -- coalesce: um texto nulo nunca pode bloquear a gravação do usuário
  return retorno;
end $$;
revoke execute on function auditar(), auditoria_colunas(text), auditoria_imutavel() from public, anon, authenticated;

-- inserir e alterar: depois da gravação (vê o valor final, inclusive o que outro gatilho ajustou); excluir: antes (a linha ainda existe)
drop trigger if exists auditoria_depois on campeonatos;
create trigger auditoria_depois after insert or update on campeonatos for each row execute function auditar();
drop trigger if exists auditoria_antes_excluir on campeonatos;
create trigger auditoria_antes_excluir before delete on campeonatos for each row execute function auditar();
drop trigger if exists auditoria_depois on equipes;
create trigger auditoria_depois after insert or update on equipes for each row execute function auditar();
drop trigger if exists auditoria_antes_excluir on equipes;
create trigger auditoria_antes_excluir before delete on equipes for each row execute function auditar();
drop trigger if exists auditoria_depois on atletas;
create trigger auditoria_depois after insert or update on atletas for each row execute function auditar();
drop trigger if exists auditoria_antes_excluir on atletas;
create trigger auditoria_antes_excluir before delete on atletas for each row execute function auditar();
drop trigger if exists auditoria_depois on perfis;
create trigger auditoria_depois after insert or update on perfis for each row execute function auditar();
drop trigger if exists auditoria_antes_excluir on perfis;
create trigger auditoria_antes_excluir before delete on perfis for each row execute function auditar();
drop trigger if exists auditoria_depois on jogos;
create trigger auditoria_depois after update of arbitro_id on jogos for each row execute function auditar();

-- 6) sem duplicidade: estas funções já gravam em "historico" (e fazem várias alterações em tabelas auditadas de uma vez)
--    ALTER FUNCTION ... SET vale só enquanto a função roda e não muda o corpo dela. ATENÇÃO: um "create or replace function" futuro dessas funções
--    apaga esta marca; o teste testar-auditoria.mjs confere que ela continua lá.
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'public'::regnamespace
           and p.proname in ('inscrever_pelo_link', 'aplicar_sorteio', 'cancelar_sorteio', 'vincular_equipe', 'liberar_acesso')
  loop execute format('alter function %s set application_name = ''tnt_ja_registrado''', f); end loop;
end $$;

-- COMO DESFAZER (executável: o teste testar-reversao-auditoria.mjs roda exatamente as linhas abaixo que começam com "--   ").
-- ANTES de desfazer, guarde os registros, porque a tabela some: no editor SQL, "select to_jsonb(a) from auditoria a order by id" e salve o resultado fora do banco.
-- Não mexe em campeonatos, equipes, atletas, jogos, perfis nem no histórico existente. A coluna historico.usuario_id fica (opcional e inofensiva);
-- para removê-la também: alter table historico drop column usuario_id;
--   begin;
--   drop trigger if exists auditoria_depois on campeonatos;
--   drop trigger if exists auditoria_antes_excluir on campeonatos;
--   drop trigger if exists auditoria_depois on equipes;
--   drop trigger if exists auditoria_antes_excluir on equipes;
--   drop trigger if exists auditoria_depois on atletas;
--   drop trigger if exists auditoria_antes_excluir on atletas;
--   drop trigger if exists auditoria_depois on perfis;
--   drop trigger if exists auditoria_antes_excluir on perfis;
--   drop trigger if exists auditoria_depois on jogos;
--   do $$
--   declare f regprocedure;
--   begin
--     for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'public'::regnamespace
--              and p.proname in ('inscrever_pelo_link', 'aplicar_sorteio', 'cancelar_sorteio', 'vincular_equipe', 'liberar_acesso')
--     loop execute format('alter function %s reset application_name', f); end loop;
--   end $$;
--   create or replace function registrar(c uuid, j uuid, o_que text, motivo text default null) returns void
--   language sql security definer set search_path = public as $$
--     insert into historico (campeonato_id, jogo_id, quem, o_que, motivo)
--     values (c, j, coalesce((select nome || ' (' || papel || ')' from perfis where id = auth.uid()), 'sistema'), o_que, motivo)
--   $$;
--   drop table if exists auditoria;
--   drop function if exists auditar();
--   drop function if exists auditoria_colunas(text);
--   drop function if exists auditoria_imutavel();
--   commit;

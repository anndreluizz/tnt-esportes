-- LGPD: o documento (RG) é apagado quando o campeonato termina, mesmo que ninguém da Secretaria abra o sistema.
-- Roda todo dia às 03:00 de Manaus (07:00 UTC). Não roda no teste local (PGlite não tem storage, pg_cron nem pg_net).
-- ANTES de aplicar, guarde a service_role key no Vault (veja o LEIAME, passo 5).
--
-- O Supabase não deixa apagar arquivo direto da tabela storage.objects, então a função pede à API do Storage
-- (pg_net). A busca é pela pasta documentos/<equipe>/..., e não pelas colunas do atleta: se um pedido falhar,
-- o arquivo continua lá e é apagado no dia seguinte; e pega também RG enviado e nunca ligado a um atleta.

create extension if not exists pg_net;
create extension if not exists pg_cron;

create function public.limpar_documentos_encerrados() returns integer
language plpgsql security definer set search_path = public as $$
declare
  chave text := (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key');
  base  text := 'https://alebsgxaswcjifwkwebe.supabase.co/storage/v1/object/documentos/';
  o record; n int := 0;
begin
  if chave is null then raise exception 'Falta o segredo service_role_key no Vault'; end if;
  for o in
    select s.name from storage.objects s
    join equipes e on e.id::text = (storage.foldername(s.name))[1]
    join campeonatos c on c.id = e.campeonato_id
    where s.bucket_id = 'documentos' and c.status = 'encerrado'
  loop
    perform net.http_delete(url := base || o.name, headers := jsonb_build_object('apikey', chave));
    n := n + 1;
  end loop;
  update atletas a set rg_frente_path = null, rg_verso_path = null
  from equipes e join campeonatos c on c.id = e.campeonato_id
  where e.id = a.equipe_id and c.status = 'encerrado' and (a.rg_frente_path is not null or a.rg_verso_path is not null);
  return n;   -- quantos arquivos foram pedidos para apagar
end $$;
revoke execute on function public.limpar_documentos_encerrados() from public, anon, authenticated;

select cron.schedule('limpar-documentos', '0 7 * * *', 'select public.limpar_documentos_encerrados()');

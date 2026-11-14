-- Arquivos da inscrição por link e das marcas do campeonato. Não roda no teste local (PGlite não tem o schema storage).
--   fotos/<equipe>/<link>/<atleta>-foto.jpg        → quem tem o link envia; leitura como nas outras fotos
--   documentos/<equipe>/<link>/<atleta>-rg-*.jpg   → quem tem o link envia; SÓ a Secretaria lê (LGPD)
--   marcas/<campeonato>/...                        → logos do campeonato e dos patrocinadores, públicas

-- Repetível: rodar este arquivo de novo não dá erro e deixa as políticas exatamente como estão aqui (cada política é apagada e recriada com a
-- MESMA definição; um bucket já existente NÃO é alterado: 'on conflict do nothing'). Isso também desfaz qualquer mudança manual nas políticas.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos', 'documentos', false, 3145728, array['image/jpeg', 'image/png', 'image/webp']),
       ('marcas', 'marcas', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create or replace function public.pasta_do_link(name text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from equipes e where e.id::text = (storage.foldername(name))[1] and e.link_token::text = (storage.foldername(name))[2])
$$;
revoke execute on function public.pasta_do_link(text) from public;
grant execute on function public.pasta_do_link(text) to anon, authenticated;

drop policy if exists fotos_link on storage.objects;
create policy fotos_link on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'fotos' and public.pasta_do_link(name));
drop policy if exists documentos_link on storage.objects;
create policy documentos_link on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'documentos' and public.pasta_do_link(name));
drop policy if exists documentos_secretaria on storage.objects;
create policy documentos_secretaria on storage.objects for all to authenticated
  using (bucket_id = 'documentos' and public.e_secretaria()) with check (bucket_id = 'documentos' and public.e_secretaria());
drop policy if exists marcas_secretaria on storage.objects;
create policy marcas_secretaria on storage.objects for all to authenticated
  using (bucket_id = 'marcas' and public.e_secretaria()) with check (bucket_id = 'marcas' and public.e_secretaria());

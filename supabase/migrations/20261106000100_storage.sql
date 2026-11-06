-- Arquivos privados (Supabase Storage). Não roda no teste local (PGlite não tem o schema storage).
--   fotos/<equipe_id>/<atleta_id>.jpg       → Secretaria, a própria equipe e o árbitro do jogo
--   assinaturas/<jogo_id>/<quem>.png        → quem apita o jogo grava; Secretaria e árbitro leem

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 2097152, array['image/jpeg', 'image/png', 'image/webp']),
       ('assinaturas', 'assinaturas', false, 524288, array['image/png'])
on conflict (id) do nothing;

create policy fotos_secretaria on storage.objects for all to authenticated
  using (bucket_id = 'fotos' and public.e_secretaria()) with check (bucket_id = 'fotos' and public.e_secretaria());
create policy fotos_equipe on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = public.minha_equipe()::text);
create policy fotos_equipe_envia on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = public.minha_equipe()::text);
create policy fotos_arbitro on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and exists (select 1 from public.jogos j where j.arbitro_id = auth.uid()
         and (storage.foldername(name))[1] in (j.mandante_id::text, j.visitante_id::text)));

create policy assinaturas_grava on storage.objects for insert to authenticated
  with check (bucket_id = 'assinaturas' and public.pode_apitar(((storage.foldername(name))[1])::uuid));
create policy assinaturas_le on storage.objects for select to authenticated
  using (bucket_id = 'assinaturas' and (public.e_secretaria() or exists (
         select 1 from public.jogos j where j.id::text = (storage.foldername(name))[1] and j.arbitro_id = auth.uid())));

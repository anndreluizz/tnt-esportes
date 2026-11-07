-- 1) Local de cada jogo (vazio = local do campeonato) e alteração de data, hora e local com motivo no histórico.
-- 2) Cancelar o sorteio antes de gerar a tabela. Fica registrado em público (com semente e motivo):
--    ninguém consegue cancelar e sortear de novo "até gostar" sem que todos vejam.

alter table jogos add column local text check (length(local) <= 60);

create function alterar_jogo(j uuid, nova_data date, nova_hora text, novo_local text, motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare m jogos; antes text; depois text;
begin
  perform exigir_secretaria(motivo);
  select * into m from jogos where id = j for update;
  if m.status = 'encerrado' then raise exception 'Jogo já encerrado'; end if;
  if nova_hora !~ '^\d{2}h\d{2}$' then raise exception 'Horário inválido'; end if;
  antes := to_char(m.data, 'DD/MM') || ' ' || m.hora || coalesce(' · ' || m.local, '');
  depois := to_char(nova_data, 'DD/MM') || ' ' || nova_hora || coalesce(' · ' || nullif(trim(novo_local), ''), '');
  update jogos set data = nova_data, hora = nova_hora, local = nullif(trim(novo_local), ''),
                   adiado = adiado or (nova_data, nova_hora) is distinct from (m.data, m.hora) where id = j;
  perform registrar(m.campeonato_id, j, 'Jogo alterado de ' || antes || ' para ' || depois, motivo);
end $$;
revoke execute on function alterar_jogo(uuid, date, text, text, text) from public, anon;
grant execute on function alterar_jogo(uuid, date, text, text, text) to authenticated;

create table sorteios_cancelados (
  id              bigint generated always as identity primary key,
  campeonato_id   uuid not null references campeonatos on delete cascade,
  hash            text not null,
  semente         text,
  entrada_publica text,
  motivo          text not null,
  cancelado_em    timestamptz not null default now()
);
alter table sorteios_cancelados enable row level security;
grant select on sorteios_cancelados to anon, authenticated;
create policy publico on sorteios_cancelados for select using (true);

create function cancelar_sorteio(c uuid, motivo text) returns void language plpgsql security definer set search_path = public as $$
declare s sorteios;
begin
  perform exigir_secretaria(motivo);
  if (select status from campeonatos where id = c) <> 'inscricoes' then
    raise exception 'A tabela já foi gerada: o sorteio não pode mais ser cancelado'; end if;
  delete from sorteios where campeonato_id = c returning * into s;
  if s.campeonato_id is null then raise exception 'Não há sorteio para cancelar'; end if;
  insert into sorteios_cancelados (campeonato_id, hash, semente, entrada_publica, motivo) values (c, s.hash, s.semente, s.entrada_publica, trim(motivo));
  perform registrar(c, null, 'Sorteio cancelado antes de gerar a tabela', motivo);
end $$;
revoke execute on function cancelar_sorteio(uuid, text) from public, anon;
grant execute on function cancelar_sorteio(uuid, text) to authenticated;

-- a tabela gerada pelo app agora traz o local de cada jogo
create or replace function aplicar_sorteio(c uuid, g jsonb, jogos_novos jsonb) returns void language plpgsql security definer set search_path = public as $$
declare todas uuid[]; sorteadas uuid[];
begin
  perform exigir_secretaria();
  if (select revelado_em from sorteios where campeonato_id = c) is null then raise exception 'Revele a semente antes'; end if;
  if (select status from campeonatos where id = c) <> 'inscricoes' then raise exception 'Tabela já gerada'; end if;
  if exists (select 1 from jsonb_object_keys(g) k where k !~ '^[A-H]$') then raise exception 'Grupo inválido'; end if;
  select array_agg(id order by id) into todas from equipes where campeonato_id = c;
  select array_agg(x::uuid order by x::uuid) into sorteadas from jsonb_each(g) e, jsonb_array_elements_text(e.value) x;
  if todas is distinct from sorteadas then raise exception 'Os grupos precisam ter todas as equipes do campeonato, uma vez cada'; end if;
  update equipes q set grupo = (select e.key from jsonb_each(g) e where e.value ? q.id::text) where campeonato_id = c;
  insert into jogos (id, campeonato_id, fase, rodada, grupo, titulo, mandante_id, visitante_id, vaga_mandante, vaga_visitante, data, hora, local)
    select id, c, fase, rodada, grupo, titulo, mandante_id, visitante_id, vaga_mandante, vaga_visitante, data, hora, nullif(local, '')
    from jsonb_to_recordset(jogos_novos) as x(id uuid, fase text, rodada smallint, grupo char(1), titulo text, mandante_id uuid, visitante_id uuid,
                                               vaga_mandante text, vaga_visitante text, data date, hora text, local text);
  if exists (select 1 from jogos where campeonato_id = c and fase = 'grupos'
             and (mandante_id not in (select id from equipes where campeonato_id = c and grupo = jogos.grupo)
               or visitante_id not in (select id from equipes where campeonato_id = c and grupo = jogos.grupo))) then
    raise exception 'Jogo com equipe fora do grupo';
  end if;
  if exists (select 1 from jogos where campeonato_id = c and fase <> 'grupos'
             and (mandante_id not in (select id from equipes where campeonato_id = c) or visitante_id not in (select id from equipes where campeonato_id = c))) then
    raise exception 'Jogo com equipe de outro campeonato';
  end if;
  update sorteios set grupos = g where campeonato_id = c;
  update campeonatos set status = 'andamento' where id = c;
  perform registrar(c, null, 'Sorteio aplicado: ' || jsonb_array_length(jogos_novos) || ' jogos gerados');
end $$;

-- Juizes do campeonato escolar: a Secretaria cadastra os nomes e escala um juiz em cada jogo (aparece no portal).
-- Sem login: quem lanca o placar continua pelo link unico (esc_juiz_placar).
create table esc_juizes (
  id            uuid primary key default gen_random_uuid(),
  campeonato_id uuid not null references esc_campeonatos (id) on delete cascade,
  nome          text not null check (length(btrim(nome)) between 3 and 60),
  unique (campeonato_id, nome)
);
alter table esc_partidas add column juiz_id uuid references esc_juizes (id) on delete set null;   -- juiz que apita o jogo

-- o juiz escalado tem de ser do mesmo campeonato do jogo
create function esc_partida_juiz() returns trigger language plpgsql as $$
begin
  if new.juiz_id is not null and (select campeonato_id from esc_juizes where id = new.juiz_id) is distinct from (select campeonato_id from esc_turmas where id = new.turma_id) then
    raise exception 'juiz de outro campeonato';
  end if;
  return new;
end $$;
create trigger esc_partida_juiz before insert or update on esc_partidas for each row execute function esc_partida_juiz();

alter table esc_juizes enable row level security;
grant select on esc_juizes to anon, authenticated;
grant insert, update, delete on esc_juizes to authenticated;
create policy publico    on esc_juizes for select using (true);
create policy secretaria on esc_juizes for all to authenticated using (e_secretaria()) with check (e_secretaria());

-- COMO DESFAZER: drop trigger esc_partida_juiz on esc_partidas; drop function esc_partida_juiz(); alter table esc_partidas drop column juiz_id; drop table esc_juizes;

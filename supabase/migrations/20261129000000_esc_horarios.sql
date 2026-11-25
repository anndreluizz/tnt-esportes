-- Programacao por horario dos jogos escolares: dia, hora de inicio e quadra. O sistema monta a agenda (a Secretaria confere antes de aplicar).
alter table esc_partidas
  add column data   date,
  add column hora   time,
  add column quadra smallint check (quadra between 1 and 9),
  add constraint esc_partida_horario_completo check ((data is null) = (hora is null) and (data is null or quadra is not null));
create unique index esc_partida_horario_unico on esc_partidas (data, hora, quadra) where data is not null;   -- dois jogos nao comecam juntos na mesma quadra

-- COMO DESFAZER: drop index esc_partida_horario_unico; alter table esc_partidas drop column data, drop column hora, drop column quadra;

-- Queimada: sem penaltis e sem empate no placar final. Se empatar no tempo, joga mais 5 minutos (repete ate ter vencedor) e so entao o juiz lanca o placar.
-- Futsal continua igual (empate vai a penaltis, que nao podem empatar).
create or replace function esc_partida_antes_gravar() returns trigger language plpgsql as $$
begin
  if new.placar_a is not null and exists (select 1 from esc_modalidades m where m.id = new.modalidade_id and m.nome = 'Queimada') then
    if new.penaltis_a is not null then
      raise exception 'queimada sem penaltis: se empatar, joga mais 5 minutos' using errcode = '23514';
    end if;
    if new.placar_a = new.placar_b then
      raise exception 'queimada empatada: joguem mais 5 minutos e lancem o placar final (sem empate)' using errcode = '23514';
    end if;
  end if;
  new.vencedor_id := case
    when new.placar_a is null then null
    when new.placar_a > new.placar_b then new.time_a_id
    when new.placar_a < new.placar_b then new.time_b_id
    when new.penaltis_a is null then null            -- empate sem penaltis ainda: sem vencedor
    when new.penaltis_a > new.penaltis_b then new.time_a_id
    else new.time_b_id end;
  return new;
end $$;

-- COMO DESFAZER: recriar esc_partida_antes_gravar() como em 20261121000000_turmas_escola.sql (sem o bloco da queimada).

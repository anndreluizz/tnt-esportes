-- PRIVACIDADE DE MENORES (decisão da Secretaria, 14/11/2026; LGPD):
-- no portal público, atleta menor de 18 anos aparece só com o primeiro nome e a inicial do último sobrenome
-- ("Maria Clara Souza Lima" -> "Maria L."). Maiores de 18 continuam com o nome completo.
-- A idade é a do início do campeonato (a mesma regra de elegibilidade usada em situacao_atleta).
-- Continua valendo: só atletas APROVADOS aparecem, e a view não tem data de nascimento, documentos nem contatos.
-- A Secretaria e o representante da própria equipe leem a tabela atletas e veem o nome completo.
-- Não apaga nem altera dado nenhum: só troca a definição da view (mesmas colunas, mesma ordem, mesmos tipos).

create or replace view atletas_publico as
  select a.id, a.equipe_id,
         case when i.idade < 18 then
                case when trim(a.nome) ~ '\s'
                     then split_part(trim(a.nome), ' ', 1) || ' ' || upper(left((regexp_match(trim(a.nome), '(\S+)$'))[1], 1)) || '.'
                     else trim(a.nome) end
              else a.nome end as nome,
         a.numero
  from atletas a
  join equipes e on e.id = a.equipe_id
  join campeonatos c on c.id = e.campeonato_id,
  lateral (select extract(year from age(c.inicio, a.nascimento))::int as idade) i
  where situacao_atleta(a) = 'aprovado';

-- COMO DESFAZER:
--   create or replace view atletas_publico as select a.id, a.equipe_id, a.nome, a.numero from atletas a where situacao_atleta(a) = 'aprovado';

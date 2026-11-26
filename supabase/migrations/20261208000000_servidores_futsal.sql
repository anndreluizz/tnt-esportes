-- Futsal entre EJAI, Funcionarios e Professores: um grupo so (serie 'Servidores').
-- Funcionarios e Professores: o responsavel usa o proprio link para criar/excluir times e escolher os nomes (ele ve a lista toda).
-- Os times do EJAI (futsal) entram no grupo so se ainda nao tiverem jogo.

-- 1) grupo
insert into esc_turmas (campeonato_id, nome)
  select c.id, 'Servidores' from esc_campeonatos c
   where c.nome like 'II Jogos%' and not exists (select 1 from esc_turmas t where t.campeonato_id = c.id and t.nome = 'Servidores');

-- 2) times do EJAI de futsal passam para o grupo (sem jogo)
update esc_times t set turma_id = s.id
  from esc_turmas s, esc_modalidades m
 where s.campeonato_id = t.campeonato_id and s.nome = 'Servidores'
   and m.id = t.modalidade_id and m.nome = 'Futsal' and esc_origem(t.nome) = 'EJAI'
   and not exists (select 1 from esc_partidas p where p.time_a_id = t.id or p.time_b_id = t.id);

-- 3) um time inicial de cada origem (o responsavel cria os outros pelo link)
insert into esc_times (campeonato_id, turma_id, modalidade_id, genero, nome, professor)
  select s.campeonato_id, s.id, m.id, 'masculino', 'Funcionários - A', null
    from esc_turmas s join esc_modalidades m on m.campeonato_id = s.campeonato_id and m.nome = 'Futsal'
   where s.nome = 'Servidores' and not exists (select 1 from esc_times t where t.turma_id = s.id and esc_origem(t.nome) = 'Funcionários');
insert into esc_times (campeonato_id, turma_id, modalidade_id, genero, nome, professor)
  select s.campeonato_id, s.id, m.id, 'masculino', 'Professores - A', null
    from esc_turmas s join esc_modalidades m on m.campeonato_id = s.campeonato_id and m.nome = 'Futsal'
   where s.nome = 'Servidores' and not exists (select 1 from esc_times t where t.turma_id = s.id and esc_origem(t.nome) = 'Professores');

-- 4) links (um por origem)
insert into esc_turma_links (campeonato_id, origem)
  select c.id, o from esc_campeonatos c, unnest(array['Funcionários', 'Professores']) o
   where c.nome like 'II Jogos%'
  on conflict do nothing;

-- 5) nomes (funcionarios e professores) e WhatsApp dos responsaveis NAO ficam no repositorio (dados pessoais): foram carregados direto no banco.

-- COMO DESFAZER: apagar os times 'Funcionários - *' e 'Professores - *', os candidatos e links dessas origens, o grupo 'Servidores'
-- e devolver os times do EJAI para a serie 'EJAI'.

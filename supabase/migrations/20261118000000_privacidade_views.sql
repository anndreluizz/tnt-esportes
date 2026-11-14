-- PRIVACIDADE, PARTE 1 de 2 (só adiciona; nada deixa de funcionar) (decisão da Secretaria, 14/11/2026): o público não pode ler telefone de responsável,
-- assinaturas nem observações internas das súmulas. Antes, "campeonatos" e "jogos" tinham leitura pública total
-- (qualquer pessoa lia essas colunas direto pela API).
--
-- Agora:
--  - o público (anon) lê apenas as views campeonatos_publico e jogos_publico, que listam as colunas permitidas;
--  - colunas novas NÃO ficam públicas por padrão (lista explícita, não "select *");
--  - a Secretaria continua vendo tudo; o árbitro vê só os próprios jogos; o representante da equipe vê só o próprio campeonato.
-- A conferência pública de súmula (conferir_sumula) não muda: ela já devolve só jogo, campeonato, resumo e autenticidade.
-- Não apaga nem altera nenhum dado.

-- Ordem de aplicação em produção: parte 1 -> publicar o site novo (lê pelas views) -> parte 2.

-- 1) Views públicas (mesmo padrão das demais: rodam com as permissões do dono)
create view campeonatos_publico as
  select id, nome, modalidade, categoria, idade_min, idade_max, inicio, local, status, criado_em,
         logo_path, responsavel, patrocinadores, inscricao_ate, max_atletas, formato, regras
  from campeonatos;   -- fora: responsavel_telefone

create view jogos_publico as
  select id, campeonato_id, fase, rodada, grupo, titulo, mandante_id, visitante_id, vaga_mandante, vaga_visitante,
         data, hora, status, arbitro_id, pen_mandante, pen_visitante, wo_ausente_id, adiado, hash, local
  from jogos;         -- fora: observacoes, assinaturas

grant select on campeonatos_publico, jogos_publico to anon, authenticated;

// cd supabase && npm run test:auditoria   (ou: node testar-auditoria.mjs)
// Auditoria de alterações: cada operação gera exatamente um registro certo, sem dado pessoal, sem duplicar o histórico, inalterável e só para a Secretaria.
// 100% local (PGlite): não usa rede nem Supabase.
import { readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { criaBanco, semeia, como, dono, q as qq } from './volume.mjs'

let total = 0, falhas = 0
const ok = (cond, msg) => { total++; if (!cond) { falhas++; console.error('  FALHOU:', msg) } }
const secao = t => console.log('\n' + t)
const db = await criaBanco(), q = (s, p) => qq(db, s, p)
const erro = async (sql, p, trecho, msg) => { try { await db.query(sql, p); ok(false, msg + ' (deveria dar erro)') } catch (e) { ok(!trecho || e.message.includes(trecho), `${msg}: "${e.message}"`) } }
const sha = s => createHash('sha256').update(s).digest('hex')
const SEC = randomUUID(), ARB = randomUUID(), REP = randomUUID(), U2 = randomUUID(), U3 = randomUUID()

// ---- preparação (como administrador) ----
await dono(db)
await db.exec(`insert into auth.users values ('${SEC}', 'ana@teste.local'), ('${ARB}', 'joao@teste.local'), ('${REP}', 'rep@teste.local'), ('${U2}', 'novo.rep@teste.local'), ('${U3}', 'novo.arbitro@teste.local')`)
await db.exec(`insert into campeonatos (id, nome, modalidade, idade_min, inicio) values ('${randomUUID()}', 'Campeonato Base', 'Futsal', 15, '2027-05-01')`)   // só para existir um campeonato
await db.exec(`insert into perfis (id, nome, papel) values ('${SEC}', 'Ana Souza', 'secretaria'), ('${ARB}', 'João Paulo', 'arbitro')`)
// cada bloco olha só o que foi gravado depois da última marca
let marca = (await q(`select coalesce(max(id), 0)::int m from auditoria`))[0].m
// lê a auditoria como administrador e devolve o teste ao perfil em que estava (usuário e papel), para não mascarar quem fez cada alteração
const comoAdmin = async fn => {
  const [{ u, s }] = await q(`select current_user u, coalesce(current_setting('request.jwt.claim.sub', true), '') s`)
  await db.exec('reset role')
  try { return await fn() } finally { await db.exec(`select set_config('request.jwt.claim.sub', '${s}', false)`); if (u !== 'postgres') await db.exec(`set role ${u}`) }
}
const novos = () => comoAdmin(async () => { const r = await q(`select * from auditoria where id > $1 order by id`, [marca]); marca = (await q(`select coalesce(max(id), 0)::int m from auditoria`))[0].m; return r })
const tudo = () => comoAdmin(async () => JSON.stringify(await q(`select * from auditoria`)))

secao('Estrutura e permissões')
ok((await q(`select count(*)::int c from auditoria`))[0].c >= 3, 'a carga inicial (feita como administrador) já aparece na auditoria')
ok((await q(`select count(*)::int c from auditoria where origem = 'administrador' and usuario_id is null`))[0].c >= 3, 'alterações feitas pelo editor SQL ficam com origem "administrador" e sem usuário')
ok((await q(`select relrowsecurity r from pg_class where relname = 'auditoria'`))[0].r === true, 'a tabela auditoria tem RLS ligada')
const pr = await q(`select r.rolname papel, a.privilege_type p from pg_class c, aclexplode(c.relacl) a join pg_roles r on r.oid = a.grantee where c.relname = 'auditoria' and r.rolname in ('anon', 'authenticated')`)
ok(pr.length === 1 && pr[0].papel === 'authenticated' && pr[0].p === 'SELECT', 'só usuários logados têm SELECT na auditoria; ninguém tem INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER nem MAINTAIN')

secao('Campeonato: criar, editar (patrocinadores), excluir')
await como(db, SEC)
const C = randomUUID()
await q(`insert into campeonatos (id, nome, modalidade, idade_min, inicio, responsavel, responsavel_telefone, patrocinadores) values ($1, 'Copa Auditada', 'Futsal', 15, '2027-05-01', 'Responsavel Secreto', '97 91111-2222', $2)`,
  [C, JSON.stringify([{ nome: 'Padaria Boa', logo_path: 'x/a.png' }, { nome: 'Loja Nova', logo_path: 'x/b.png' }])])
let n = await novos()
ok(n.length === 1 && n[0].operacao === 'INSERT' && n[0].tabela === 'campeonatos' && n[0].resumo === 'Campeonato criado: Copa Auditada', 'criar campeonato gera 1 registro')
ok(n[0].usuario_id === SEC && n[0].usuario_nome === 'Ana Souza' && n[0].usuario_papel === 'secretaria' && n[0].origem === 'app' && n[0].campeonato_id === C, 'o registro tem quem (id, nome e papel), origem "app" e o campeonato')
ok(n[0].depois.patrocinadores.length === 2 && !('responsavel' in n[0].depois) && !('responsavel_telefone' in n[0].depois), 'guarda os patrocinadores, mas não o responsável nem o telefone')
await q(`update campeonatos set patrocinadores = '[]' where id = $1`, [C])
n = await novos()
ok(n.length === 1 && n[0].operacao === 'UPDATE' && n[0].alteradas.join() === 'patrocinadores' && n[0].antes.patrocinadores.length === 2 && n[0].depois.patrocinadores.length === 0, 'esvaziar os patrocinadores fica registrado, com a lista de antes e de depois e quem fez')
await q(`update campeonatos set responsavel_telefone = '97 90000-0000', nome = 'Copa Auditada 2', local = 'Quadra B' where id = $1`, [C])
n = await novos()
ok(n.length === 1 && n[0].alteradas.join() === 'local,nome,responsavel_telefone' && n[0].depois.nome === 'Copa Auditada 2' && n[0].depois.local === 'Quadra B' && !('responsavel_telefone' in n[0].depois) && !('responsavel_telefone' in n[0].antes), 'o telefone aparece só como nome de coluna alterada, nunca o valor')
await q(`update campeonatos set nome = nome where id = $1`, [C])
ok((await novos()).length === 0, 'gravar sem mudar nada não gera registro')
await q(`update campeonatos set logo_path = 'x/logo.png' where id = $1`, [C])
ok((await novos())[0].depois.logo_path === 'x/logo.png', 'trocar a logo fica registrado')

secao('Equipe: criar, editar, excluir (e cascata)')
const E1 = randomUUID(), E2 = randomUUID()
await q(`insert into equipes (id, campeonato_id, nome, bairro, responsavel, responsavel_telefone, cores) values ($1, $2, 'Time Azul', 'Centro', 'Coach Secreto', '97 93333-4444', 'azul'), ($3, $2, 'Time Verde', 'Porto', null, null, null)`, [E1, C, E2])
n = await novos()
ok(n.length === 2 && n.every(x => x.operacao === 'INSERT' && x.tabela === 'equipes' && x.campeonato_id === C) && n[0].resumo === 'Equipe criada: Time Azul', 'criar equipes gera 1 registro por equipe')
const { codigo: COD, link_token: LINK } = (await q(`select codigo, link_token from equipes where id = $1`, [E1]))[0]
await q(`update equipes set cores = 'azul e branco', pote = 1 where id = $1`, [E1])
n = await novos()
ok(n.length === 1 && n[0].alteradas.join() === 'cores,pote' && n[0].depois.pote === 1, 'editar equipe fica registrado')
await q(`update equipes set escudo_path = 'c/escudo.png' where id = $1`, [E1])
ok((await novos())[0].depois.escudo_path === 'c/escudo.png', 'trocar o escudo fica registrado')

secao('Atleta: sem nenhum dado pessoal')
const A1 = randomUUID(), A2 = randomUUID(), A3 = randomUUID()
const atleta = (id, eq, nome, num, nasc) => q(`insert into atletas (id, equipe_id, nome, numero, nascimento, bairro, autorizacao, aprovado, consentimento, foto_path, telefone, endereco, municipio, responsavel, responsavel_telefone, apelido, rg_frente_path, rg_verso_path)
  values ($1, $2, $3, $4, $5, 'Bairro Secreto', true, false, true, 'pasta/foto-secreta.jpg', '97 98888-7777', 'Rua Secreta, 99', 'Tonantins', 'Maria Responsavel', '97 97777-6666', 'Apelido Secreto', 'pasta/rg-f.jpg', 'pasta/rg-v.jpg')`, [id, eq, nome, num, nasc])
await atleta(A1, E1, 'Joao Pedro Silva Menor', 7, '2012-03-04'); await atleta(A2, E1, 'Carlos Maior Adulto', 8, '1990-01-01'); await atleta(A3, E2, 'Outro Atleta Teste', 9, '1995-05-05')
n = await novos()
ok(n.length === 3 && n[0].resumo === 'Atleta cadastrado: equipe Time Azul, camisa 7', 'cadastrar atleta: resumo só com equipe e camisa')
ok(Object.keys(n[0].depois).sort().join() === 'aprovado,autorizacao,equipe_id,numero', 'só 4 colunas não pessoais têm valor guardado: equipe, camisa, aprovado e autorização')
await q(`update atletas set aprovado = true where id = $1`, [A1])
n = await novos()
ok(n.length === 1 && n[0].resumo === 'Atleta aprovado: equipe Time Azul, camisa 7 · campos: aprovado' && n[0].antes.aprovado === false && n[0].depois.aprovado === true && n[0].usuario_id === SEC, 'aprovar atleta: quem aprovou, e antes e depois')
await q(`update atletas set aprovado = false where id = $1`, [A1])
ok((await novos())[0].resumo.startsWith('Aprovação do atleta retirada'), 'retirar a aprovação fica registrado')
await q(`update atletas set autorizacao = false where id = $1`, [A1])
ok((await novos())[0].resumo.startsWith('Autorização do responsável retirada'), 'retirar a autorização do responsável fica registrado')
await q(`update atletas set nome = 'Joao Pedro Silva Trocado', telefone = '97 90000-1111', endereco = 'Rua Nova, 1', nascimento = '2011-01-01', numero = 10 where id = $1`, [A1])
n = await novos()
ok(n.length === 1 && n[0].alteradas.join() === 'endereco,nascimento,nome,numero,telefone' && Object.keys(n[0].depois).join() === 'numero', 'editar dados: aparecem os nomes das colunas, mas só a camisa tem valor guardado')
await q(`update atletas set rg_frente_path = null, rg_verso_path = null where id = $1`, [A1])
n = await novos()
ok(n.length === 1 && n[0].alteradas.join() === 'rg_frente_path,rg_verso_path' && n[0].depois && Object.keys(n[0].depois).length === 0, 'remover o documento (LGPD) fica registrado, sem o caminho dos arquivos')
await q(`delete from atletas where id = $1`, [A2])
n = await novos()
ok(n.length === 1 && n[0].operacao === 'DELETE' && n[0].resumo === 'Atleta removido: equipe Time Azul, camisa 8' && n[0].registro_id === A2, 'rejeitar (excluir) atleta fica registrado')
const json = await tudo()
const segredos = ['Joao Pedro', 'Carlos Maior', 'Outro Atleta', '2012-03-04', '2011-01-01', '1990-01-01', '97 98888-7777', '97 90000-1111', 'Rua Secreta', 'Rua Nova', 'Bairro Secreto', 'Maria Responsavel', '97 97777-6666', 'Apelido Secreto',
  'foto-secreta', 'rg-f.jpg', 'rg-v.jpg', 'Coach Secreto', '97 93333-4444', 'Responsavel Secreto', '97 91111-2222', '97 90000-0000', COD, LINK]
ok(segredos.every(s => !json.includes(s)), `nenhum dado pessoal nem credencial em toda a auditoria (conferidos ${segredos.length}: nomes, nascimento, telefones, endereço, responsáveis, fotos, RG, código e link da equipe)`)

secao('Representante da equipe')
await dono(db); await db.exec(`insert into perfis (id, nome, papel, equipe_id) values ('${REP}', 'Rep Time Azul', 'equipe', '${E1}')`); await novos()
await como(db, REP)
const A4 = randomUUID()
await q(`insert into atletas (id, equipe_id, nome, numero, nascimento, bairro, autorizacao, aprovado, consentimento, foto_path) values ($1, $2, 'Inscrito Pelo Rep', 11, '1998-02-02', 'Centro', true, true, true, 'f/x.jpg')`, [A4, E1])
n = await novos()
ok(n.length === 1 && n[0].usuario_id === REP && n[0].usuario_papel === 'equipe' && n[0].origem === 'app' && n[0].depois.aprovado === false, 'inscrição feita pela equipe: registra o representante e mostra que entrou sem aprovação (a equipe não se aprova)')
ok(!(await tudo()).includes('Inscrito Pelo Rep'), 'o nome do atleta inscrito pela equipe também não é guardado')

secao('Árbitro escalado no jogo')
await dono(db)
const J = randomUUID()
await db.exec(`insert into jogos (id, campeonato_id, fase, rodada, grupo, mandante_id, visitante_id, data, hora) values ('${J}', '${C}', 'grupos', 1, 'A', '${E1}', '${E2}', '2027-05-02', '19h00')`)
ok((await novos()).length === 0, 'criar jogo não gera registro (a tabela é gerada pelo sorteio, que já tem o próprio registro)')
await como(db, SEC)
await q(`update jogos set arbitro_id = $1 where id = $2`, [ARB, J])
n = await novos()
ok(n.length === 1 && n[0].resumo === 'Árbitro escalado no jogo: Time Azul x Time Verde' && n[0].depois.arbitro_id === ARB && n[0].usuario_id === SEC, 'escalar árbitro fica registrado com quem escalou')
await q(`select alterar_jogo($1, '2027-05-03', '20h00', 'Quadra B', 'quadra ocupada')`, [J])
ok((await novos()).length === 0, 'alterar data e horário do jogo (função alterar_jogo) não duplica: 0 registros na auditoria, o histórico já tem o seu')
await q(`update jogos set arbitro_id = null where id = $1`, [J])
ok((await novos())[0].resumo.startsWith('Árbitro retirado'), 'retirar o árbitro fica registrado')

secao('Sem registros duplicados (funções que já gravam no histórico)')
await como(db, null)
const atl = (o = {}) => ({ nome: 'Pelo Link Teste', numero: 21, nascimento: '2000-02-02', consentimento: true, telefone: '97 99999-0000', endereco: 'Rua da Matriz, 120', bairro: 'Centro', municipio: 'Tonantins',
  foto_path: `${E1}/${LINK}/f.jpg`, rg_frente_path: `${E1}/${LINK}/rf.jpg`, rg_verso_path: `${E1}/${LINK}/rv.jpg`, ...o })
await dono(db)
const hist0 = (await q(`select count(*)::int c from historico`))[0].c
await como(db, null)
await q(`select inscrever_pelo_link($1, $2)`, [LINK, atl()])
ok((await novos()).length === 0, 'inscrição pelo link: 0 registros na auditoria (o histórico já tem o seu)')
await dono(db)
ok((await q(`select count(*)::int c from historico`))[0].c === hist0 + 1, 'e o histórico continua gravando a inscrição pelo link')
// sorteio: aplicar e cancelar mexem em equipes (grupo), campeonato (status) e jogos de uma vez
await como(db, SEC)
const P = randomUUID(), PE = [randomUUID(), randomUUID(), randomUUID()], sem = 'ab12cd34ef56ab78'
await q(`insert into campeonatos (id, nome, modalidade, idade_min, inicio, formato) values ($1, 'Copa Pontos Auditada', 'Futsal', 15, '2027-06-01', 'pontos')`, [P])
for (const [i, e] of PE.entries()) await q(`insert into equipes (id, campeonato_id, nome, bairro) values ($1, $2, $3, 'Centro')`, [e, P, 'Pontos ' + i])
await novos()
await q(`select publicar_compromisso($1, $2)`, [P, sha(sem)]); await q(`select revelar_semente($1, $2, '1 2 3')`, [P, sem])
const jg = (a, b, r) => ({ id: randomUUID(), fase: 'grupos', rodada: r, grupo: 'A', titulo: null, mandante_id: a, visitante_id: b, vaga_mandante: null, vaga_visitante: null, data: '2027-06-0' + r, hora: '19h00' })
await q(`select aplicar_sorteio($1, $2, $3)`, [P, { A: PE }, [jg(PE[0], PE[1], 1), jg(PE[0], PE[2], 2), jg(PE[1], PE[2], 3)]])
ok((await novos()).length === 0, 'aplicar o sorteio (grupo de 3 equipes + status do campeonato + jogos): 0 registros na auditoria; o histórico tem "Sorteio aplicado"')
await dono(db)
ok((await q(`select count(*)::int c from historico where o_que like 'Sorteio aplicado%'`))[0].c === 1, 'o histórico tem o registro do sorteio aplicado')
await como(db, SEC)
// cancelar: só antes de gerar a tabela (outro campeonato, com o sorteio apenas publicado)
const P2 = randomUUID(), P2E = [randomUUID(), randomUUID()], sem2 = 'cd34ef56ab78ab12'
await q(`insert into campeonatos (id, nome, modalidade, idade_min, inicio, formato) values ($1, 'Copa Sorteio Cancelado', 'Futsal', 15, '2027-06-01', 'pontos')`, [P2])
for (const [i, e] of P2E.entries()) await q(`insert into equipes (id, campeonato_id, nome, bairro) values ($1, $2, $3, 'Centro')`, [e, P2, 'Cancela ' + i])
await q(`select publicar_compromisso($1, $2)`, [P2, sha(sem2)]); await q(`select revelar_semente($1, $2, '4 5 6')`, [P2, sem2])
await novos()
await q(`select cancelar_sorteio($1, 'faltou cadastrar uma equipe')`, [P2])
ok((await novos()).length === 0, 'cancelar o sorteio: 0 registros na auditoria')
await dono(db)
ok((await q(`select count(*)::int c from historico where o_que like 'Sorteio cancelado%'`))[0].c === 1, 'o histórico tem o registro do sorteio cancelado')
await como(db, SEC)
await q(`update equipes set bairro = 'Novo Bairro' where id = $1`, [PE[0]])
ok((await novos()).length === 1, 'depois da função, uma edição direta na equipe volta a ser auditada (a marca vale só enquanto a função roda)')
// vínculo de equipe e liberação de acesso
await dono(db)
const codRep = (await q(`select codigo from equipes where id = $1`, [E2]))[0].codigo
await como(db, U2)
await q(`select vincular_equipe($1, 'Rep Time Verde')`, [codRep])
ok((await novos()).length === 0, 'vincular representante à equipe: 0 registros na auditoria (o histórico tem "Representante vinculado")')
await como(db, SEC)
await q(`select liberar_acesso('novo.arbitro@teste.local', 'Novo Arbitro', 'arbitro')`)
ok((await novos()).length === 0, 'liberar acesso de árbitro: 0 registros na auditoria (o histórico tem "Árbitro liberado")')
await q(`update perfis set nome = 'Nome Mudado Secreto' where id = $1`, [U3])
n = await novos()
ok(n.length === 1 && n[0].alteradas.join() === 'nome' && Object.keys(n[0].depois).length === 0 && !JSON.stringify(n).includes('Nome Mudado Secreto'), 'mudar o nome de um perfil fica registrado só como "campo nome alterado", sem o valor')
await q(`update perfis set papel = 'secretaria' where id = $1`, [U3])
n = await novos()
ok(n.length === 1 && n[0].tabela === 'perfis' && n[0].alteradas.join() === 'papel' && n[0].antes.papel === 'arbitro' && n[0].depois.papel === 'secretaria', 'mudar o papel de um acesso (árbitro → Secretaria) fica registrado')
const flags = await q(`select p.proname, p.proconfig::text c from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('inscrever_pelo_link', 'aplicar_sorteio', 'cancelar_sorteio', 'vincular_equipe', 'liberar_acesso')`)
ok(flags.length >= 5 && flags.every(f => f.c.includes('tnt.ja_registrado=on')), 'as 5 funções que já gravam no histórico continuam marcadas (um create or replace futuro que apague a marca quebra este teste)')

secao('Exclusão: a auditoria sobrevive')
const antesDel = (await q(`select count(*)::int c from auditoria`))[0].c
// equipe com atletas: 1 registro da equipe, sem um registro por atleta (cascata)
await como(db, SEC)
const E3 = randomUUID(); await q(`insert into equipes (id, campeonato_id, nome, bairro) values ($1, $2, 'Time Cascata', 'Centro')`, [E3, C])
for (let k = 1; k <= 3; k++) await atleta(randomUUID(), E3, 'Cascata Atleta ' + k, k, '1990-01-01')
await novos()
await q(`delete from equipes where id = $1`, [E3])
n = await novos()
ok(n.length === 1 && n[0].resumo === 'Equipe excluída: Time Cascata (3 atletas removidos junto)' && n[0].campeonato_id === C, 'excluir equipe com 3 atletas: 1 registro, que diz quantos saíram junto (sem 1 registro por atleta)')
// campeonato inteiro, com jogos e eventos
await dono(db)
const K = randomUUID(), KE = [randomUUID(), randomUUID()], KJ = randomUUID(), KA = randomUUID()
await db.exec(`insert into campeonatos (id, nome, modalidade, idade_min, inicio) values ('${K}', 'Copa Que Sera Excluida', 'Futsal', 15, '2027-07-01')`)
for (const e of KE) await db.exec(`insert into equipes (id, campeonato_id, nome, bairro) values ('${e}', '${K}', 'KE ${e.slice(0, 4)}', 'Centro')`)
await como(db, SEC); await atleta(KA, KE[0], 'Atleta Do Campeonato Excluido', 5, '1990-01-01'); await dono(db)
await db.exec(`insert into jogos (id, campeonato_id, fase, rodada, grupo, mandante_id, visitante_id, data, hora, arbitro_id) values ('${KJ}', '${K}', 'grupos', 1, 'A', '${KE[0]}', '${KE[1]}', '2027-07-02', '19h00', '${ARB}')`)
await novos()
await como(db, SEC)
await q(`delete from campeonatos where id = $1`, [K])
n = await novos()
ok(n.length === 1 && n[0].operacao === 'DELETE' && n[0].campeonato_id === K && /2 equipes, 1 atletas, 1 jogos e 0 eventos removidos junto/.test(n[0].resumo), 'excluir campeonato: 1 registro com a contagem do que saiu junto (equipes, atletas, jogos e eventos)')
await dono(db)
ok((await q(`select count(*)::int c from auditoria where campeonato_id = $1`, [K]))[0].c >= 3, 'os registros do campeonato excluído continuam lá (criação das equipes, do atleta e a própria exclusão)')
ok((await q(`select count(*)::int c from campeonatos where id = $1`, [K]))[0].c === 0 && (await q(`select count(*)::int c from auditoria where registro_id = $1`, [KE[0]]))[0].c >= 1, 'o campeonato sumiu e os registros das equipes dele continuam')
ok(!(await tudo()).includes('Atleta Do Campeonato Excluido') && !(await tudo()).includes('Cascata Atleta'), 'nenhum nome de atleta aparece, nem nas exclusões em cascata')
// conta excluída: o registro continua com o nome do momento
await dono(db)
const arbRow = (await q(`select count(*)::int c from auditoria where usuario_id = $1`, [SEC]))[0].c
await db.exec(`delete from perfis where id = '${U3}'`)
n = await novos()
ok(n.length === 1 && n[0].resumo === 'Acesso removido: secretaria' && n[0].origem === 'administrador', 'remover um acesso fica registrado (feito aqui como administrador)')
ok((await q(`select count(*)::int c from auditoria where usuario_id = $1`, [SEC]))[0].c === arbRow, 'os registros de quem fez continuam com id e nome do momento')

secao('Origem: app, sistema e administrador')
await dono(db)
await db.exec(`update campeonatos set local = 'Via Editor SQL' where id = '${C}'`)
n = await novos()
ok(n.length === 1 && n[0].origem === 'administrador' && n[0].usuario_id === null && n[0].usuario_nome === null, 'alteração pelo editor SQL: origem "administrador", sem usuário')
await db.exec(`set application_name = 'pg_cron'`)
await db.exec(`update campeonatos set local = 'Via Rotina' where id = '${C}'`)
await db.exec(`reset application_name`)
ok((await novos())[0].origem === 'sistema', 'alteração por rotina automática (pg_cron): origem "sistema"')

secao('Inalterável e só para a Secretaria')
const alvo = (await q(`select id from auditoria order by id limit 1`))[0].id
await erro(`update auditoria set resumo = 'adulterado' where id = $1`, [alvo], 'não pode ser alterada', 'nem o administrador altera um registro (gatilho)')
await erro(`delete from auditoria where id = $1`, [alvo], 'não pode ser alterada', 'nem o administrador apaga um registro (gatilho)')
await erro(`truncate auditoria`, [], 'não pode ser alterada', 'nem o administrador limpa a tabela (gatilho)')
await como(db, SEC)
ok((await q(`select count(*)::int c from auditoria`))[0].c > 20, 'a Secretaria lê a auditoria')
await erro(`insert into auditoria (origem, tabela, operacao, registro_id, resumo) values ('app', 'x', 'INSERT', '1', 'falso')`, [], 'permission denied', 'a Secretaria não escreve na auditoria')
await erro(`update auditoria set resumo = 'x'`, [], 'permission denied', 'a Secretaria não altera a auditoria')
await erro(`delete from auditoria`, [], 'permission denied', 'a Secretaria não apaga a auditoria')
await erro(`truncate auditoria`, [], 'permission denied', 'a Secretaria não limpa a auditoria')
for (const [nome, uid] of [['árbitro', ARB], ['representante de equipe', REP]]) {
  await como(db, uid)
  ok((await q(`select count(*)::int c from auditoria`))[0].c === 0, `${nome} não vê nenhum registro da auditoria`)
  await erro(`insert into auditoria (origem, tabela, operacao, registro_id, resumo) values ('app', 'x', 'INSERT', '1', 'falso')`, [], 'permission denied', `${nome} não escreve na auditoria`)
}
await como(db, null)
await erro(`select count(*) from auditoria`, [], 'permission denied', 'visitante (portal público) não lê a auditoria')
await erro(`select * from historico`, [], 'permission denied', 'e continua sem ler o histórico completo')

secao('Histórico preservado e portal público intacto')
await dono(db)
const h = (await q(`select quem, usuario_id from historico where o_que like 'Árbitro liberado%' order by id desc limit 1`))[0]
ok(h.quem === 'Ana Souza (secretaria)' && h.usuario_id === SEC, 'o histórico grava "quem" como antes e agora também o id do usuário')
ok(Object.keys((await q(`select * from historico_publico limit 1`).then(r => r.length ? r : [{ jogo_id: 1, o_que: 1, em: 1 }]))[0]).join() === 'jogo_id,o_que,em', 'historico_publico continua com só jogo, texto e data')
ok((await q(`select count(*)::int c from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v' and pg_get_viewdef(c.oid) ilike '%auditoria%'`))[0].c === 0, 'nenhuma view do esquema public lê a auditoria')

secao('Migration repetível')
const retrato = async () => JSON.stringify([
  await q(`select tgname, tgrelid::regclass::text t from pg_trigger where not tgisinternal and tgfoid in ('auditar'::regproc, 'auditoria_imutavel'::regproc) order by 1, 2`),
  await q(`select policyname, cmd, roles::text, qual from pg_policies where tablename = 'auditoria'`),
  await q(`select p.proname, p.proconfig::text c from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('inscrever_pelo_link', 'aplicar_sorteio', 'cancelar_sorteio', 'vincular_equipe', 'liberar_acesso') order by 1`),
  await q(`select column_name, data_type from information_schema.columns where table_name = 'auditoria' order by ordinal_position`),
  await q(`select r.rolname, a.privilege_type from pg_class c, aclexplode(c.relacl) a join pg_roles r on r.oid = a.grantee where c.relname = 'auditoria' order by 1, 2`)])
const antes = await retrato(), linhas = (await q(`select count(*)::int c from auditoria`))[0].c
let e2 = null
try { await db.exec(readFileSync(new URL('migrations/20261120000000_auditoria.sql', import.meta.url), 'utf8')) } catch (e) { e2 = e.message }
ok(e2 === null, 'rodar a migration de novo não dá erro' + (e2 ? ': ' + e2 : ''))
ok(await retrato() === antes && (await q(`select count(*)::int c from auditoria`))[0].c === linhas, 'rodar de novo deixa gatilhos, permissões, colunas e marcas exatamente iguais, e não mexe nos registros')

secao('Volume (16 equipes, 300 atletas, 120 jogos, 1.235 eventos)')
const db2 = await criaBanco(), t0 = Date.now(), M = await semeia(db2)
const todos = await qq(db2, `select * from auditoria`), txt = JSON.stringify(todos)
const nomes = await qq(db2, `select nome from atletas`)
ok(todos.filter(r => r.tabela === 'atletas' && r.operacao === 'INSERT').length === 300, 'os 300 cadastros de atletas da carga foram auditados (quem: a Secretaria)')
ok(nomes.every(a => !txt.includes(a.nome)), 'nenhum dos 300 nomes de atletas (15 menores) aparece na auditoria')
ok(todos.every(r => r.tabela !== 'eventos' && r.tabela !== 'jogos'), 'os 1.235 eventos e as 112 súmulas não geram registro (já estão no histórico e nas súmulas)')
console.log(`  (carga de volume com auditoria em ${((Date.now() - t0) / 1000).toFixed(1)} s)`)

console.log(falhas ? `\n${falhas} de ${total} verificações da auditoria falharam` : `\nok: ${total} verificações da auditoria`)
process.exit(falhas ? 1 : 0)

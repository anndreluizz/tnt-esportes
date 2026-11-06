// cd supabase && npm install && node testar.mjs
// Roda a migração num Postgres de verdade (PGlite) e testa as regras com cada perfil, inclusive tentativas indevidas.
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'

const db = new PGlite({ extensions: { pgcrypto } })
// o que o Supabase já traz pronto: schema auth, auth.uid() e os papéis anon/authenticated
await db.exec(`
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin; create role authenticated nologin;
  grant usage on schema public, auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;`)
for (const f of readdirSync(new URL('migrations', import.meta.url)).sort().filter(f => !f.endsWith('_storage.sql')))
  await db.exec(readFileSync(new URL('migrations/' + f, import.meta.url), 'utf8'))

let falhas = 0, total = 0
const ok = (cond, msg) => { total++; if (!cond) { falhas++; console.error('  FALHOU:', msg) } }
const como = async (uid) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false); set role ${uid ? 'authenticated' : 'anon'};`)
const q = async (sql, p) => (await db.query(sql, p)).rows
const erro = async (sql, p, trecho, msg) => {
  try { await db.query(sql, p); ok(false, msg + ' (deveria dar erro)') }
  catch (e) { ok(!trecho || e.message.includes(trecho), `${msg}: "${e.message}"`) }
}
const sha = s => createHash('sha256').update(s).digest('hex')

// usuários
const [SEC, ARB, REP, OUTRO] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
await como(null); await db.exec('reset role')
for (const u of [SEC, ARB, REP, OUTRO]) await db.query('insert into auth.users values ($1)', [u])
await db.query(`insert into perfis (id, nome, papel) values ($1, 'Ana Souza', 'secretaria'), ($2, 'João Paulo', 'arbitro')`, [SEC, ARB])

process.on('unhandledRejection', e => { console.error('ERRO:', e.message, e.where ? '\n  em: ' + e.where.split('\n')[0] : ''); process.exit(1) })
console.log("Cadastro e inscrição")
await como(SEC)
const [{ id: C }] = await q(`insert into campeonatos (nome, modalidade, idade_min, inicio) values ('Copa Teste 2027', 'Futsal', 15, '2027-03-06') returning id`)
const T = {}
for (const [k, pote] of [['a1', 1], ['a2', 1], ['b1', 2], ['b2', 2]])
  T[k] = (await q(`insert into equipes (campeonato_id, nome, bairro, pote) values ($1, $2, 'Centro', $3) returning id, codigo`, [C, 'Equipe ' + k, pote]))[0]
const A = {}
for (const k in T) A[k] = (await q(`insert into atletas (equipe_id, nome, numero, nascimento, bairro, autorizacao, aprovado, consentimento)
  values ($1, $2, 10, '1998-01-01', 'Centro', true, true, true) returning id`, [T[k].id, 'Atleta ' + k]))[0].id

await como(REP)
await q(`select vincular_equipe($1, 'Carlos')`, [T.a1.codigo.toLowerCase()])
ok((await q(`select meu_papel() p`))[0].p === 'equipe', 'representante vinculado pelo código')
const [nov] = await q(`insert into atletas (equipe_id, nome, numero, nascimento, bairro, aprovado, consentimento) values ($1, 'Menor Sem Papel', 7, '2010-05-01', 'Centro', true, true) returning id, aprovado`, [T.a1.id])
ok(nov.aprovado === false, 'equipe não consegue se auto-aprovar')
ok((await q(`select situacao_atleta(a) s from atletas a where id = $1`, [nov.id]))[0].s === 'pendente', 'menor sem autorização fica pendente')
await erro(`insert into atletas (equipe_id, nome, numero, nascimento, bairro, consentimento) values ($1, 'Intruso', 8, '1999-01-01', 'Centro', true)`, [T.b1.id], 'row-level security', 'equipe não inscreve em outra equipe')
await erro(`insert into atletas (equipe_id, nome, numero, nascimento, bairro, consentimento) values ($1, 'Sem LGPD', 9, '1999-01-01', 'Centro', false)`, [T.a1.id], 'check', 'sem consentimento não entra')
ok((await q(`update atletas set aprovado = true where id = $1 returning id`, [nov.id])).length === 0, 'equipe não altera inscrição depois de enviada')
ok((await q(`select * from atletas`)).every(a => a.equipe_id === T.a1.id), 'equipe só vê os próprios atletas')

console.log('LGPD e acesso público')
await como(null)
await erro(`select nascimento from atletas`, [], 'permission denied', 'público não lê data de nascimento')
await erro(`select codigo from equipes`, [], 'permission denied', 'público não lê o código das equipes')
ok((await q(`select * from atletas_publico`)).length === 4, 'portal mostra só atletas aprovados')
ok(!('nascimento' in (await q(`select * from atletas_publico limit 1`))[0]), 'portal sem data de nascimento')
await erro(`insert into campeonatos (nome, modalidade, idade_min, inicio) values ('Hacker Cup', 'Futsal', 5, '2027-01-01')`, [], 'permission denied', 'público não cria campeonato')

console.log('Sorteio auditável')
const semente = 'a1b2c3d4e5f60718'
await como(REP)
await erro(`select publicar_compromisso($1, $2)`, [C, sha(semente)], 'Secretaria', 'equipe não publica sorteio')
await como(SEC)
await q(`select publicar_compromisso($1, $2)`, [C, sha(semente)])
await erro(`select publicar_compromisso($1, $2)`, [C, sha('ffffffffffffffff')], 'duplicate', 'não dá para trocar o compromisso depois de publicado')
await erro(`select revelar_semente($1, 'ffffffffffffffff', '7 21 3')`, [C], 'não confere', 'semente diferente da publicada é recusada')
const [{ s: final }] = await q(`select revelar_semente($1, $2, '7 21 3') s`, [C, semente])
ok(final === sha(semente + '7 21 3').slice(0, 16), 'semente final = sha256(semente + entrada pública)')
const J = Object.fromEntries(['ga', 'gb', 's1', 's2', 't3', 'f'].map(k => [k, randomUUID()]))
const jogo = (id, fase, extra) => ({ id, fase, rodada: null, grupo: null, titulo: null, mandante_id: null, visitante_id: null, vaga_mandante: null, vaga_visitante: null, data: '2027-03-06', hora: '19h00', ...extra })
const jogos = [
  jogo(J.ga, 'grupos', { rodada: 1, grupo: 'A', mandante_id: T.a1.id, visitante_id: T.a2.id }),
  jogo(J.gb, 'grupos', { rodada: 1, grupo: 'B', mandante_id: T.b1.id, visitante_id: T.b2.id, hora: '20h00' }),
  jogo(J.s1, 'semi', { titulo: 'Semifinal 1', vaga_mandante: '1A', vaga_visitante: '2B', data: '2027-03-13' }),
  jogo(J.s2, 'semi', { titulo: 'Semifinal 2', vaga_mandante: '1B', vaga_visitante: '2A', data: '2027-03-13', hora: '20h00' }),
  jogo(J.t3, 'terceiro', { titulo: 'Disputa de 3º lugar', vaga_mandante: 'P:' + J.s1, vaga_visitante: 'P:' + J.s2, data: '2027-03-20', hora: '18h30' }),
  jogo(J.f, 'final', { titulo: 'Final', vaga_mandante: 'V:' + J.s1, vaga_visitante: 'V:' + J.s2, data: '2027-03-20', hora: '20h00' }),
]
await erro(`select aplicar_sorteio($1, $2, $3)`, [C, { A: [T.a1.id], B: [T.b1.id, T.b2.id] }, jogos], 'todas as equipes', 'grupos incompletos são recusados')
await q(`select aplicar_sorteio($1, $2, $3)`, [C, { A: [T.a1.id, T.a2.id], B: [T.b1.id, T.b2.id] }, jogos])
ok((await q(`select status from campeonatos where id = $1`, [C]))[0].status === 'andamento', 'sorteio aplicado gera a tabela')

console.log('Súmula')
await q(`update jogos set arbitro_id = $1 where campeonato_id = $2`, [ARB, C])
await erro(`update jogos set status = 'encerrado' where id = $1`, [J.ga], 'permission denied', 'Secretaria não muda resultado "na mão"')
const ev = (id, jogo, tipo, equipe, atleta, min = 5) => q(`insert into eventos (id, jogo_id, tipo, equipe_id, atleta_id, minuto, tempo) values ($1,$2,$3,$4,$5,$6,1) on conflict (id) do nothing`, [id, jogo, tipo, equipe, atleta, min])
await como(OUTRO)
await erro(`insert into eventos (id, jogo_id, tipo, equipe_id, atleta_id, minuto, tempo) values ($1,$2,'gol',$3,$4,3,1)`, [randomUUID(), J.ga, T.a1.id, A.a1], 'row-level security', 'quem não é o árbitro não registra gol')
await como(ARB)
const g1 = randomUUID()
await ev(g1, J.ga, 'gol', T.a1.id, A.a1); await ev(g1, J.ga, 'gol', T.a1.id, A.a1)   // celular reenviou o mesmo evento
ok((await q(`select count(*)::int n from eventos where jogo_id = $1`, [J.ga]))[0].n === 1, 'evento reenviado sem internet não duplica')
await erro(`insert into eventos (id, jogo_id, tipo, equipe_id, atleta_id, minuto, tempo) values ($1,$2,'gol',$3,$4,3,1)`, [randomUUID(), J.ga, T.a1.id, A.a2], 'não é desta equipe', 'atleta de outra equipe é recusado')
await erro(`insert into eventos (id, jogo_id, tipo, equipe_id, atleta_id, minuto, tempo) values ($1,$2,'gol',$3,$4,3,1)`, [randomUUID(), J.ga, T.a1.id, nov.id], 'irregular', 'atleta com inscrição pendente é recusado')
const tmp = randomUUID(); await ev(tmp, J.ga, 'amarelo', T.a2.id, A.a2); await q(`delete from eventos where id = $1`, [tmp])
await erro(`select confirmar_sumula($1, null, null, '', '{}')`, [J.ga], 'assinaturas', 'súmula sem assinaturas é recusada')
const assin = { arbitro: 'x.png', mandante: 'y.png', visitante: 'z.png' }
const [{ h }] = await q(`select confirmar_sumula($1, null, null, 'Jogo tranquilo', $2) h`, [J.ga, assin])
ok(/^[0-9a-f]{64}$/.test(h), 'súmula confirmada gera código de autenticidade')
ok((await q(`select confirmar_sumula($1, null, null, '', $2) h`, [J.ga, assin]))[0].h === h, 'confirmar de novo (reenvio) não muda nada')
await erro(`insert into eventos (id, jogo_id, tipo, equipe_id, atleta_id, minuto, tempo) values ($1,$2,'gol',$3,$4,9,1)`, [randomUUID(), J.ga, T.a1.id, A.a1], 'row-level security', 'súmula confirmada não aceita evento novo')
await ev(randomUUID(), J.gb, 'gol', T.b2.id, A.b2)
await q(`select confirmar_sumula($1, null, null, '', $2)`, [J.gb, assin])

console.log('Classificação e mata-mata')
await como(null)
const cl = await q(`select grupo, nome, pontos, posicao from classificacao where campeonato_id = $1 order by grupo, posicao`, [C])
ok(cl.map(r => r.nome + ':' + r.pontos).join() === 'Equipe a1:3,Equipe a2:0,Equipe b2:3,Equipe b1:0', 'classificação calculada no banco')
const semis = await q(`select id, mandante_id, visitante_id from jogos where fase = 'semi' order by titulo`)
ok(semis[0].mandante_id === T.a1.id && semis[0].visitante_id === T.b1.id, 'semifinal 1 = 1º A × 2º B')
ok(semis[1].mandante_id === T.b2.id && semis[1].visitante_id === T.a2.id, 'semifinal 2 = 1º B × 2º A')
ok((await q(`select * from historico_publico`)).length >= 3, 'histórico de jogos é público')
await erro(`select * from historico`, [], 'permission denied', 'histórico completo é só da Secretaria')
const conf = await q(`select * from conferir_sumula($1)`, [h.slice(0, 12).toUpperCase().match(/.{4}/g).join('-')])
ok(conf[0]?.autentica === true && conf[0].resumo === 'Equipe a1 1 × 0 Equipe a2', 'qualquer pessoa confere a súmula pelo código')

await como(ARB)
await erro(`select confirmar_sumula($1, null, null, '', $2)`, [J.s1, assin], 'pênaltis', 'empate no mata-mata exige pênaltis')
await erro(`select confirmar_sumula($1, 3, 3, '', $2)`, [J.s1, assin], 'pênaltis', 'pênaltis empatados são recusados')
await q(`select confirmar_sumula($1, 4, 2, '', $2)`, [J.s1, assin])
await ev(randomUUID(), J.s2, 'gol', T.a2.id, A.a2)
await q(`select confirmar_sumula($1, null, null, '', $2)`, [J.s2, assin])
const [fin] = await q(`select mandante_id, visitante_id from jogos where id = $1`, [J.f])
ok(fin.mandante_id === T.a1.id && fin.visitante_id === T.a2.id, 'final = vencedores das semis (pênaltis contam)')

console.log('Correções e W.O.')
await erro(`select reabrir_sumula($1, 'gol errado')`, [J.ga], 'Secretaria', 'árbitro não reabre súmula')
await como(SEC)
await erro(`select reabrir_sumula($1, 'ok')`, [J.ga], 'motivo', 'reabrir exige motivo')
await erro(`select reabrir_sumula($1, 'gol atribuído errado')`, [J.ga], 'já começou', 'não reabre jogo de grupo com mata-mata já jogado')
await q(`select reabrir_sumula($1, 'gol atribuído ao atleta errado')`, [J.s2])
ok((await q(`select motivo from historico where o_que like 'Súmula reaberta%'`))[0]?.motivo === 'gol atribuído ao atleta errado', 'correção fica no histórico com motivo')
ok((await q(`select mandante_id from jogos where id = $1`, [J.f]))[0].mandante_id === T.a1.id && (await q(`select visitante_id from jogos where id = $1`, [J.f]))[0].visitante_id === null, 'final volta a esperar o vencedor da semi reaberta')
await q(`select registrar_wo($1, $2, 'equipe não compareceu no horário')`, [J.s2, T.b2.id])
await q(`select registrar_wo($1, $2, 'equipe desistiu da disputa de 3º')`, [J.t3, T.b1.id])
await como(ARB)
await ev(randomUUID(), J.f, 'gol', T.a2.id, A.a2)
await q(`select confirmar_sumula($1, null, null, '', $2)`, [J.f, assin])
await como(null)
ok((await q(`select status from campeonatos where id = $1`, [C]))[0].status === 'encerrado', 'final confirmada encerra o campeonato')
ok((await q(`select vencedor($1) v`, [J.f]))[0].v === T.a2.id, 'campeão definido')

console.log(falhas ? `\n${falhas} de ${total} verificações falharam` : `\nok: ${total} verificações`)
process.exit(falhas ? 1 : 0)

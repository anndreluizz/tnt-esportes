// cd supabase && npm install && node testar.mjs
// Roda a migração num Postgres de verdade (PGlite) e testa as regras com cada perfil, inclusive tentativas indevidas.
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'

const db = new PGlite({ extensions: { pgcrypto } })
// o que o Supabase já traz pronto: schema auth, auth.uid() e os papéis anon/authenticated
await db.exec(`
  create schema auth; create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin; create role authenticated nologin;
  grant usage on schema public, auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;`)
for (const f of readdirSync(new URL('migrations', import.meta.url)).sort().filter(f => !f.includes('_storage')))
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

console.log('Inscrição por link')
await como(SEC)
const [{ link_token: LINK }] = await q(`select link_token from equipes where id = $1`, [T.b1.id])
await como(null)
await erro(`select codigo from equipes`, [], 'permission denied', 'público não lê o link nem o código das equipes')
ok(!('link_token' in (await q(`select * from equipes_publico limit 1`))[0]), 'link não aparece no portal')
const info = (await q(`select link_inscricao($1) i`, [LINK]))[0].i
ok(info.equipe === 'Equipe b1' && info.aberta === true && info.inscritos.length === 1, 'link mostra a equipe e quem já foi inscrito')
ok((await q(`select link_inscricao($1) i`, [randomUUID()]))[0].i === null, 'link inventado não mostra nada')
const pasta = `${T.b1.id}/${LINK}/`, arq = k => pasta + k + '.jpg'
const atl = (o = {}) => ({ nome: 'Pelo Link', numero: 12, nascimento: '2000-02-02', consentimento: true, telefone: '97 99999-0000', endereco: 'Rua da Matriz, 120', bairro: 'Centro', municipio: 'Tonantins',
  foto_path: arq('f'), rg_frente_path: arq('rf'), rg_verso_path: arq('rv'), ...o })
await erro(`select inscrever_pelo_link($1, $2)`, [randomUUID(), atl()], 'inválido', 'link inventado não inscreve')
await erro(`select inscrever_pelo_link($1, $2)`, [LINK, atl({ rg_verso_path: null })], 'documento', 'sem o documento não inscreve')
await erro(`select inscrever_pelo_link($1, $2)`, [LINK, atl({ foto_path: `${T.a1.id}/${LINK}/f.jpg` })], 'Arquivo inválido', 'arquivo de outra pasta é recusado')
await erro(`select inscrever_pelo_link($1, $2)`, [LINK, atl({ consentimento: false })], 'LGPD', 'sem consentimento não inscreve')
await erro(`select inscrever_pelo_link($1, $2)`, [LINK, atl({ endereco: '' })], 'endereço', 'sem endereço não inscreve')
await erro(`select inscrever_pelo_link($1, $2)`, [LINK, atl({ municipio: '' })], 'município', 'sem município não inscreve')
await erro(`select inscrever_pelo_link($1, $2)`, [LINK, atl({ numero: 10 })], 'duplicate', 'número de camisa repetido é recusado')
const [{ id: viaLink }] = await q(`select inscrever_pelo_link($1, $2) id`, [LINK, atl({ aprovado: true })])
await como(SEC)
const [ln] = await q(`select aprovado, origem, telefone, rg_frente_path, endereco, municipio, situacao_atleta(a) s from atletas a where id = $1`, [viaLink])
ok(ln.endereco === 'Rua da Matriz, 120' && ln.municipio === 'Tonantins', 'endereço e município guardados')
ok(ln.aprovado === false && ln.origem === 'link' && ln.s === 'analise' && ln.rg_frente_path === arq('rf'), 'inscrito pelo link entra em análise')
await q(`update campeonatos set max_atletas = 5 where id = $1`, [C])
await como(null)
for (const n of [13, 14, 15]) await q(`select inscrever_pelo_link($1, $2)`, [LINK, atl({ numero: n, nome: 'Atleta ' + n })])
await erro(`select inscrever_pelo_link($1, $2)`, [LINK, atl({ numero: 16 })], 'máximo', 'respeita o máximo de atletas da equipe')
await como(SEC); await q(`update campeonatos set inscricao_ate = '2020-01-01', max_atletas = 20 where id = $1`, [C])
await como(null)
await erro(`select inscrever_pelo_link($1, $2)`, [LINK, atl({ numero: 17 })], 'encerradas', 'depois do prazo o link não inscreve')
ok((await q(`select link_inscricao($1) i`, [LINK]))[0].i.aberta === false, 'página do link mostra inscrições encerradas')
await como(SEC); await q(`update campeonatos set inscricao_ate = null where id = $1`, [C]); await q(`delete from atletas where equipe_id = $1 and origem = 'link'`, [T.b1.id])

console.log('LGPD e acesso público')
await como(null)
await erro(`select nascimento from atletas`, [], 'permission denied', 'público não lê data de nascimento')
await erro(`select codigo from equipes`, [], 'permission denied', 'público não lê o código das equipes')
ok((await q(`select * from atletas_publico`)).length === 4, 'portal mostra só atletas aprovados')
ok(!('nascimento' in (await q(`select * from atletas_publico limit 1`))[0]), 'portal sem data de nascimento')
ok(!('endereco' in (await q(`select * from atletas_publico limit 1`))[0]), 'portal sem endereço do atleta')
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
const semis = await q(`select id, mandante_id, visitante_id from jogos_publico where fase = 'semi' order by titulo`)
ok(semis[0].mandante_id === T.a1.id && semis[0].visitante_id === T.b1.id, 'semifinal 1 = 1º A × 2º B')
ok(semis[1].mandante_id === T.b2.id && semis[1].visitante_id === T.a2.id, 'semifinal 2 = 1º B × 2º A')
ok((await q(`select * from historico_publico where o_que like 'Súmula confirmada%'`)).length >= 1, 'o histórico público mostra as súmulas confirmadas (sem autor nem motivo)')
await erro(`select * from historico`, [], 'permission denied', 'histórico completo é só da Secretaria')
const conf = await q(`select * from conferir_sumula($1)`, [h.slice(0, 12).toUpperCase().match(/.{4}/g).join('-')])
ok(conf[0]?.autentica === true && conf[0].resumo === 'Equipe a1 1 × 0 Equipe a2', 'qualquer pessoa confere a súmula pelo código')

await como(ARB)
await erro(`select confirmar_sumula($1, null, null, '', $2)`, [J.s1, assin], 'pênaltis', 'empate no mata-mata exige pênaltis')
await erro(`select confirmar_sumula($1, 3, 3, '', $2)`, [J.s1, assin], 'pênaltis', 'pênaltis empatados são recusados')
await q(`select confirmar_sumula($1, 4, 2, '', $2)`, [J.s1, assin])
await ev(randomUUID(), J.s2, 'gol', T.a2.id, A.a2)
await q(`select confirmar_sumula($1, null, null, '', $2)`, [J.s2, assin])
const [fin] = await q(`select mandante_id, visitante_id from jogos_publico where id = $1`, [J.f])
ok(fin.mandante_id === T.a1.id && fin.visitante_id === T.a2.id, 'final = vencedores das semis (pênaltis contam)')

console.log('Correções e W.O.')
await erro(`select reabrir_sumula($1, 'gol errado')`, [J.ga], 'Secretaria', 'árbitro não reabre súmula')
await como(SEC)
await erro(`select reabrir_sumula($1, 'ok')`, [J.ga], 'motivo', 'reabrir exige motivo')
await erro(`select reabrir_sumula($1, 'gol atribuído errado')`, [J.ga], 'já começou', 'não reabre jogo de grupo com mata-mata já jogado')
await q(`select reabrir_sumula($1, 'gol atribuído ao atleta errado')`, [J.s2])
ok((await q(`select motivo from historico where o_que like 'Súmula reaberta%'`))[0]?.motivo === 'gol atribuído ao atleta errado', 'correção fica no histórico com motivo')
ok((await q(`select mandante_id from jogos_publico where id = $1`, [J.f]))[0].mandante_id === T.a1.id && (await q(`select visitante_id from jogos_publico where id = $1`, [J.f]))[0].visitante_id === null, 'final volta a esperar o vencedor da semi reaberta')
await q(`select registrar_wo($1, $2, 'equipe não compareceu no horário')`, [J.s2, T.b2.id])
await q(`select registrar_wo($1, $2, 'equipe desistiu da disputa de 3º')`, [J.t3, T.b1.id])
await como(ARB)
await ev(randomUUID(), J.f, 'gol', T.a2.id, A.a2)
await q(`select confirmar_sumula($1, null, null, '', $2)`, [J.f, assin])
console.log('Formatos e regras')
// monta um campeonato, sorteia e gera os jogos como o app faz (aplicar_sorteio)
const novoCamp = async (formato, regras, nomes) => {
  await como(SEC)
  const [{ id }] = await q(`insert into campeonatos (nome, modalidade, idade_min, inicio, formato, regras) values ($1, 'Futsal', 15, '2027-05-01', $2, $3) returning id`, ['Copa ' + formato, formato, regras])
  const eq = []
  for (const n of nomes) {
    const [t] = await q(`insert into equipes (campeonato_id, nome, bairro) values ($1, $2, 'Centro') returning id`, [id, n])
    const [{ id: a }] = await q(`insert into atletas (equipe_id, nome, numero, nascimento, bairro, autorizacao, aprovado, consentimento) values ($1, $2, 9, '1990-01-01', 'Centro', true, true, true) returning id`, [t.id, 'Atl ' + n])
    eq.push({ id: t.id, a })
  }
  const sem = 'ab12cd34ef56ab78'
  await q(`select publicar_compromisso($1, $2)`, [id, sha(sem)]); await q(`select revelar_semente($1, $2, '1 2 3')`, [id, sem])
  return { id, eq }
}
const jg = (o) => ({ id: randomUUID(), fase: 'grupos', rodada: 1, grupo: 'A', titulo: null, mandante_id: null, visitante_id: null, vaga_mandante: null, vaga_visitante: null, data: '2027-05-01', hora: '19h00', ...o })
const apita = async (cid, jid, gols) => {   // gols: equipes que marcam, na ordem
  await como(SEC); await q(`update jogos set arbitro_id = $1 where id = $2`, [ARB, jid]); await como(ARB)
  for (const g of gols) await ev(randomUUID(), jid, 'gol', g.id, g.a)
  return q(`select confirmar_sumula($1, null, null, '', $2)`, [jid, assin])
}
// pontos corridos: 3 equipes, vitória vale 2, W.O. 5 × 0, termina sozinho no último jogo
const PC = await novoCamp('pontos', { vitoria: 2, wo: 5 }, ['PC Um', 'PC Dois', 'PC Tres'])
const [x, y, z] = PC.eq, jpc = [jg({ mandante_id: x.id, visitante_id: y.id }), jg({ mandante_id: y.id, visitante_id: z.id, rodada: 2 }), jg({ mandante_id: z.id, visitante_id: x.id, rodada: 3 })]
await q(`select aplicar_sorteio($1, $2, $3)`, [PC.id, { A: [x.id, y.id, z.id] }, jpc])
await apita(PC.id, jpc[0].id, [x])
await como(SEC); await q(`select registrar_wo($1, $2, 'equipe não apareceu')`, [jpc[1].id, z.id])
ok((await q(`select gols_mandante m, gols_visitante v from placar where jogo_id = $1`, [jpc[1].id]))[0].m === 5, 'W.O. com o placar da regra (5 × 0)')
ok((await q(`select status from campeonatos where id = $1`, [PC.id]))[0].status === 'andamento', 'pontos corridos não termina antes do último jogo')
await apita(PC.id, jpc[2].id, [z])
const cpc = await q(`select nome, pontos from classificacao where campeonato_id = $1 order by posicao`, [PC.id])
ok(cpc.map(r => r.nome + ':' + r.pontos).join() === 'PC Dois:2,PC Tres:2,PC Um:2' || cpc.every(r => r.pontos === 2), 'vitória vale 2 pontos na classificação')
ok((await q(`select status from campeonatos_publico where id = $1`, [PC.id]))[0].status === 'encerrado', 'pontos corridos termina sozinho no último jogo')
await como(SEC); await q(`select reabrir_sumula($1, 'gol anulado pela comissão')`, [jpc[2].id])
ok((await q(`select status from campeonatos where id = $1`, [PC.id]))[0].status === 'andamento', 'reabrir o último jogo reabre o campeonato')
// mata-mata com 3 equipes: o cabeça de chave tem folga e entra direto na final
const MM = await novoCamp('mata', { terceiro: false }, ['MM Um', 'MM Dois', 'MM Tres'])
const [m1, m2, m3] = MM.eq, semiMM = jg({ fase: 'semi', grupo: null, rodada: null, titulo: 'Semifinal 1', mandante_id: m2.id, visitante_id: m3.id })
const finMM = jg({ fase: 'final', grupo: null, rodada: null, titulo: 'Final', mandante_id: m1.id, vaga_visitante: 'V:' + semiMM.id, data: '2027-05-08', hora: '20h00' })
await erro(`select aplicar_sorteio($1, $2, $3)`, [MM.id, { Z: [m1.id, m2.id, m3.id] }, [semiMM, finMM]], 'Grupo inválido', 'grupo fora de A–H é recusado')
await q(`select aplicar_sorteio($1, $2, $3)`, [MM.id, { A: [m1.id, m2.id, m3.id] }, [semiMM, finMM]])
await apita(MM.id, semiMM.id, [m3])
const [f1] = await q(`select mandante_id, visitante_id from jogos_publico where id = $1`, [finMM.id])
ok(f1.mandante_id === m1.id && f1.visitante_id === m3.id, 'mata-mata: folga mantém o cabeça de chave e o vencedor da semiMM entra na final')
await apita(MM.id, finMM.id, [m1])
ok((await q(`select status from campeonatos_publico where id = $1`, [MM.id]))[0].status === 'encerrado' && (await q(`select vencedor($1) v`, [finMM.id]))[0].v === m1.id, 'mata-mata termina na final com o campeão')
// 4 grupos: vaga "1C" é aceita
await db.exec('reset role')   // função interna (não exposta ao app)
ok((await q(`select vaga_equipe($1, '1C') v`, [MM.id]))[0].v === null, 'vagas de grupos C e D funcionam (4 grupos)')

console.log('Suspensão automática no banco')
const SU = await novoCamp('pontos', { vermelho: 1, returno: true }, ['SU Um', 'SU Dois'])
const [su1, su2] = SU.eq
const ja = jg({ mandante_id: su1.id, visitante_id: su2.id, data: '2027-06-01' }), jb = jg({ mandante_id: su2.id, visitante_id: su1.id, rodada: 2, data: '2027-06-08' })
const jc = jg({ mandante_id: su1.id, visitante_id: su2.id, rodada: 3, data: '2027-06-15' })
await como(SEC); await q(`select aplicar_sorteio($1, $2, $3)`, [SU.id, { A: [su1.id, su2.id] }, [ja, jb, jc]])
await q(`update jogos set arbitro_id = $1 where campeonato_id = $2`, [ARB, SU.id])
await como(ARB)
await q(`insert into eventos (id, jogo_id, tipo, equipe_id, atleta_id, minuto, tempo) values ($1, $2, 'vermelho', $3, $4, 10, 1)`, [randomUUID(), ja.id, su1.id, su1.a])
await q(`select confirmar_sumula($1, null, null, '', $2)`, [ja.id, assin])
await erro(`insert into eventos (id, jogo_id, tipo, equipe_id, atleta_id, minuto, tempo) values ($1, $2, 'gol', $3, $4, 3, 1)`, [randomUUID(), jb.id, su1.id, su1.a], 'suspenso', 'banco recusa atleta suspenso por vermelho no jogo seguinte')
await ev(randomUUID(), jb.id, 'gol', su2.id, su2.a)
await q(`select confirmar_sumula($1, null, null, '', $2)`, [jb.id, assin])
await ev(randomUUID(), jc.id, 'gol', su1.id, su1.a)
ok((await q(`select count(*)::int n from eventos where jogo_id = $1`, [jc.id]))[0].n === 1, 'depois de cumprir a suspensão o atleta volta a jogar')
// regra "novos atletas até o fim da rodada X": rodadas 1 e 2 já terminaram, a 3 está em jogo
await como(SEC)
const [{ link_token: LSU }] = await q(`select link_token from equipes where id = $1`, [su1.id])
const novoLink = n => ({ nome: 'Reforço ' + n, numero: n, nascimento: '1995-02-02', consentimento: true, endereco: 'Comunidade São José', bairro: 'Zona rural', municipio: 'Santo Antônio do Içá', foto_path: `${su1.id}/${LSU}/f${n}.jpg`, rg_frente_path: `${su1.id}/${LSU}/a${n}.jpg`, rg_verso_path: `${su1.id}/${LSU}/b${n}.jpg` })
await q(`update campeonatos set regras = regras || '{"inscricao_rodada": 2}' where id = $1`, [SU.id])
await como(null)
await erro(`select inscrever_pelo_link($1, $2)`, [LSU, novoLink(30)], 'encerradas', 'depois da rodada limite o link não inscreve')
await como(SEC); await q(`update campeonatos set regras = regras || '{"inscricao_rodada": 3}' where id = $1`, [SU.id])
await como(null)
ok(!!(await q(`select inscrever_pelo_link($1, $2) id`, [LSU, novoLink(31)]))[0].id, 'limite editável: aumentando para a rodada 3, volta a inscrever')
await como(SEC)
ok((await q(`insert into atletas (equipe_id, nome, numero, nascimento, bairro, consentimento) values ($1, 'Pela Secretaria', 32, '1995-01-01', 'Centro', true) returning id`, [su1.id])).length === 1, 'Secretaria inscreve mesmo fora do prazo')

console.log('Desempate editável')
// X e Y empatam com 3 pontos; X venceu o jogo entre eles, mas Y tem saldo melhor
const DE = await novoCamp('pontos', {}, ['DE W', 'DE X', 'DE Y', 'DE Z'])
const [dw, dx, dy, dz] = DE.eq, dj = (a, b, k) => jg({ mandante_id: a.id, visitante_id: b.id, rodada: k, data: `2027-07-0${k}` })
const des = [dj(dx, dy, 1), dj(dy, dw, 2), dj(dy, dz, 3), dj(dx, dw, 4), dj(dx, dz, 5), dj(dw, dz, 6)]
await como(SEC); await q(`select aplicar_sorteio($1, $2, $3)`, [DE.id, { A: [dw.id, dx.id, dy.id, dz.id] }, des])
for (const [k, gols] of [[0, [dx]], [1, [dy, dy, dy, dy, dy]], [2, [dz]], [3, [dw]], [4, [dz]], [5, []]]) await apita(DE.id, des[k].id, gols)
const ordem = async () => (await q(`select nome from classificacao where campeonato_id = $1 order by posicao`, [DE.id])).map(r => r.nome).join()
ok(await ordem() === 'DE Z,DE W,DE Y,DE X', 'padrão (vitórias, saldo, gols): Y na frente de X pelo saldo')
await como(SEC); await q(`update campeonatos set regras = '{"desempate": ["confronto", "saldo"]}' where id = $1`, [DE.id])
ok(await ordem() === 'DE Z,DE W,DE X,DE Y', 'com confronto direto primeiro: X passa Y (venceu o jogo entre eles)')

console.log('Jogos e sorteio')
// cancelar sorteio: só antes da tabela, fica público com o motivo
await como(SEC)
const [{ id: CS }] = await q(`insert into campeonatos (nome, modalidade, idade_min, inicio) values ('Copa Cancela', 'Futsal', 15, '2027-08-01') returning id`)
await q(`select publicar_compromisso($1, $2)`, [CS, sha('1111222233334444')])
await erro(`select cancelar_sorteio($1, 'ok')`, [CS], 'motivo', 'cancelar sorteio exige motivo')
await como(ARB); await erro(`select cancelar_sorteio($1, 'equipe faltando')`, [CS], 'Secretaria', 'só a Secretaria cancela sorteio')
await como(SEC); await q(`select cancelar_sorteio($1, 'faltou cadastrar uma equipe')`, [CS])
await como(null)
ok((await q(`select motivo from sorteios_cancelados where campeonato_id = $1`, [CS]))[0]?.motivo === 'faltou cadastrar uma equipe', 'sorteio cancelado fica público com o motivo')
await como(SEC)
await q(`select publicar_compromisso($1, $2)`, [CS, sha('5555666677778888')])
ok((await q(`select count(*)::int n from sorteios_publico where campeonato_id = $1`, [CS]))[0].n === 1, 'depois de cancelar, dá para publicar um novo compromisso')
await erro(`select cancelar_sorteio($1, 'mudar o resultado')`, [C], 'já foi gerada', 'depois da tabela o sorteio não pode ser cancelado')
// alterar data, hora e local de um jogo
const [ja1] = await q(`select id from jogos where campeonato_id = $1 and status <> 'encerrado' limit 1`, [SU.id])
await q(`select alterar_jogo($1, '2027-09-10', '18h30', 'Ginásio do Bairro Novo', 'quadra em reforma')`, [ja1.id])
const [ja2] = await q(`select data::text, hora, local, adiado from jogos where id = $1`, [ja1.id])
ok(ja2.hora === '18h30' && ja2.local === 'Ginásio do Bairro Novo' && ja2.adiado === true, 'Secretaria altera data, hora e local do jogo')
ok((await q(`select motivo from historico where jogo_id = $1 order by em desc limit 1`, [ja1.id]))[0].motivo === 'quadra em reforma', 'alteração do jogo fica no histórico com motivo')
await como(ARB); await erro(`select alterar_jogo($1, '2027-09-11', '18h30', '', 'quero mudar')`, [ja1.id], 'Secretaria', 'árbitro não altera jogo')

console.log('Dados da equipe')
await como(SEC)
const [eqd] = await q(`insert into equipes (campeonato_id, nome, escudo_path, responsavel, responsavel_telefone, cores) values ($1, 'Sem Bairro FC', 'x/escudo.png', 'Técnico João', '97 98888-1111', 'verde e branco') returning id, bairro`, [CS])
ok(eqd.bairro === null, 'equipe sem bairro é aceita')
await como(null)
const [pubE] = await q(`select * from equipes_publico where id = $1`, [eqd.id])
ok(pubE.escudo_path === 'x/escudo.png' && pubE.cores === 'verde e branco', 'portal mostra escudo e cores da equipe')
ok(!('responsavel' in pubE) && !('responsavel_telefone' in pubE), 'portal não mostra responsável nem telefone da equipe')

console.log('Acesso de árbitros')
const NOVO = randomUUID()
await db.exec('reset role'); await db.query(`insert into auth.users values ($1, 'Novo.Arbitro@exemplo.com')`, [NOVO])
await como(ARB)
await erro(`select liberar_arbitro('novo.arbitro@exemplo.com', 'Pedro')`, [], 'Secretaria', 'árbitro não libera outro árbitro')
await como(null)
await erro(`select liberar_arbitro('novo.arbitro@exemplo.com', 'Pedro')`, [], 'permission denied', 'público não libera árbitro')
await como(SEC)
await erro(`select liberar_arbitro('ninguem@exemplo.com', 'Pedro')`, [], 'Nenhuma conta', 'e-mail sem conta é avisado')
await q(`select liberar_arbitro(' NOVO.arbitro@exemplo.com ', 'Pedro Lima')`)
ok((await q(`select papel, nome from perfis where id = $1`, [NOVO]))[0]?.papel === 'arbitro', 'Secretaria libera árbitro pelo e-mail')
await erro(`select liberar_arbitro('novo.arbitro@exemplo.com', 'Pedro')`, [], 'já tem acesso', 'não libera duas vezes')
const SEC2 = randomUUID()
await db.exec('reset role'); await db.query(`insert into auth.users values ($1, 'outra.pessoa@exemplo.com')`, [SEC2])
await como(ARB)
await erro(`select liberar_acesso('outra.pessoa@exemplo.com', 'Maria', 'secretaria')`, [], 'Secretaria', 'árbitro não cria administrador')
await como(SEC)
await erro(`select liberar_acesso('outra.pessoa@exemplo.com', 'Maria', 'equipe')`, [], 'código', 'equipe não é liberada por e-mail')
await q(`select liberar_acesso('outra.pessoa@exemplo.com', 'Maria Lima', 'secretaria')`)
await como(SEC2)
ok((await q(`select e_secretaria() s`))[0].s === true, 'segunda conta da Secretaria funciona')

await como(null)
ok((await q(`select status from campeonatos_publico where id = $1`, [C]))[0].status === 'encerrado', 'final confirmada encerra o campeonato')
ok((await q(`select vencedor($1) v`, [J.f]))[0].v === T.a2.id, 'campeão definido')

console.log("Histórico das partidas no portal público")
await db.exec('reset role')
const jh = (await q(`select id from jogos where campeonato_id = $1 limit 1`, [C]))[0].id
const reg = (o, m) => q(`insert into historico (campeonato_id, jogo_id, quem, o_que, motivo) values ($1, $2, 'Ana Souza (secretaria)', $3, $4)`, [C, jh, o, m])
await reg('Súmula confirmada: Time A 2 × 1 Time B', null)
await reg('Correção confirmada: Time A 2 × 2 Time B', null)
await reg('Jogo adiado de 06/03 18h00 para 07/03 19h00', 'MOTIVO-INTERNO-CHUVA')
await reg('Jogo alterado de 06/03 18h00 para 06/03 19h00 · Campo X', 'MOTIVO-INTERNO-CAMPO')
await reg('W.O.: Time B não compareceu · Time A 3 × 0 Time B', 'MOTIVO-INTERNO-WO')
await reg('Súmula reaberta para correção: Time A 2 × 1 Time B', 'MOTIVO-INTERNO-REABERTURA')
await reg('Evento desfeito: gol de Fulano Silva Sauro (12\')', null)
await q(`insert into historico (campeonato_id, jogo_id, quem, o_que, motivo) values ($1, null, 'Ana Souza (secretaria)', 'Suspensão de 1 jogo(s): Fulano Silva', 'MOTIVO-INTERNO-SUSP')`, [C])
await como(null)
const hp = await q(`select * from historico_publico`)
const textoPublico = JSON.stringify(hp)
ok(Object.keys(hp[0]).sort().join() === 'em,jogo_id,o_que', 'historico_publico só tem jogo, texto e data (sem quem nem motivo)')
ok(['Súmula confirmada', 'Correção confirmada', 'Jogo adiado', 'Jogo alterado', 'W.O.'].every(t => hp.some(x => x.o_que.startsWith(t))), 'o público vê resultados, correções confirmadas, adiamentos, alterações de horário e W.O.')
ok(!textoPublico.includes('MOTIVO-INTERNO') && !textoPublico.includes('Ana Souza'), 'nenhum motivo interno nem nome de servidor aparece no portal')
ok(!hp.some(x => x.o_que.startsWith('Súmula reaberta')), 'reabertura administrativa da súmula não aparece no portal')
ok(!textoPublico.includes('Fulano') && !hp.some(x => x.o_que.startsWith('Evento desfeito')), 'registro com nome de atleta (evento desfeito) não aparece no portal')
await erro(`select motivo from historico`, [], 'permission denied', 'público não lê a tabela historico')
await como(SEC)
const completo = await q(`select quem, o_que, motivo from historico where jogo_id = $1`, [jh])
ok(completo.some(x => x.motivo === 'MOTIVO-INTERNO-REABERTURA') && completo.some(x => x.o_que.startsWith('Evento desfeito')) && completo.every(x => x.quem), 'Secretaria continua lendo o histórico completo, com autor e motivo')
await como(REP)
ok((await q(`select count(*)::int n from historico`))[0].n === 0 && !JSON.stringify(await q(`select * from historico_publico`)).includes('MOTIVO-INTERNO'), 'representante de equipe não lê o histórico interno')
await como(ARB)
ok((await q(`select count(*)::int n from historico`))[0].n === 0, 'árbitro não lê o histórico interno')

console.log("Privacidade do portal público")
await como(SEC); await q(`update campeonatos set responsavel = 'Fulano', responsavel_telefone = '97999990000' where id = $1`, [C])
await db.exec('reset role')
const jobs = (await q(`select id, hash from jogos where id = $1`, [J.ga]))[0]
ok((await q(`select observacoes o, assinaturas a from jogos where id = $1`, [J.ga]))[0].o === 'Jogo tranquilo', 'preparação: o jogo tem observação interna e assinaturas')
await como(null)
await erro(`select responsavel_telefone from campeonatos`, [], 'permission denied', 'público não lê o telefone do responsável')
await erro(`select * from campeonatos`, [], 'permission denied', 'público não lê a tabela de campeonatos')
await erro(`select observacoes from jogos`, [], 'permission denied', 'público não lê as observações internas')
await erro(`select assinaturas from jogos`, [], 'permission denied', 'público não lê as assinaturas')
await erro(`select * from jogos`, [], 'permission denied', 'público não lê a tabela de jogos')
const [cpub] = await q(`select * from campeonatos_publico where id = $1`, [C])
ok(cpub.nome && cpub.responsavel === 'Fulano' && !('responsavel_telefone' in cpub), 'campeonatos_publico mostra o campeonato sem o telefone')
const [jpub] = await q(`select * from jogos_publico where id = $1`, [J.ga])
ok(jpub.status === 'encerrado' && jpub.hash && !('observacoes' in jpub) && !('assinaturas' in jpub), 'jogos_publico mostra o jogo sem observações nem assinaturas')
const confPub = await q(`select * from conferir_sumula($1)`, [jobs.hash])
ok(confPub.length === 1 && confPub[0].autentica === true && Object.keys(confPub[0]).sort().join() === 'autentica,campeonato,jogo_id,resumo', 'conferência pública da súmula continua e devolve só o permitido')
await como(ARB)
const meusJogos = (await q(`select count(*)::int n from jogos`))[0].n
await db.exec('reset role')
const deleARB = (await q(`select count(*)::int n from jogos where arbitro_id = $1`, [ARB]))[0].n, todos = (await q(`select count(*)::int n from jogos`))[0].n
await como(ARB)
ok(meusJogos === deleARB && deleARB > 0, 'árbitro lê, na tabela, só os próprios jogos')
ok((await q(`select count(*)::int n from campeonatos`))[0].n === 0, 'árbitro não lê a tabela de campeonatos (usa a view pública)')
ok((await q(`select count(*)::int n from campeonatos_publico`))[0].n > 0, 'árbitro lê os campeonatos pela view pública')
await como(REP)
const camps = await q(`select id, responsavel_telefone from campeonatos`)
ok(camps.length === 1 && camps[0].id === C, 'representante lê só o próprio campeonato na tabela')
ok((await q(`select count(*)::int n from jogos`))[0].n === 0, 'representante não lê a tabela de jogos (usa a view pública)')
ok((await q(`select count(*)::int n from jogos_publico`))[0].n === todos, 'representante lê todos os jogos pela view pública')
await como(OUTRO)
ok((await q(`select count(*)::int n from campeonatos`))[0].n === 0 && (await q(`select count(*)::int n from jogos`))[0].n === 0, 'usuário logado sem perfil não lê as tabelas de campeonatos e jogos')
await como(SEC)
ok((await q(`select count(*)::int n from jogos`))[0].n === todos && (await q(`select responsavel_telefone t from campeonatos where id = $1`, [C]))[0].t === '97999990000', 'Secretaria continua vendo tudo, inclusive o telefone')

console.log(falhas ? `\n${falhas} de ${total} verificações falharam` : `\nok: ${total} verificações`)
process.exit(falhas ? 1 : 0)

// cd supabase && npm test   (ou: node testar-volume.mjs)
// Camada 1: as regras REAIS do banco com volume (16 equipes, 300 atletas, 120 jogos, mais de 1.200 eventos), 100% local (PGlite).
// Cada resultado do banco é conferido contra um cálculo independente feito aqui, a partir dos eventos brutos.
import { readFileSync } from 'node:fs'
import { createHash, webcrypto } from 'node:crypto'
import vm from 'node:vm'
import { criaBanco, semeia, como, dono, q as qq, uid, SEC, ARB, REP, CAMP, ASSIN } from './volume.mjs'

let total = 0, falhas = 0
const ok = (cond, msg) => { total++; if (!cond) { falhas++; console.error('  FALHOU:', msg) } }
const secao = t => console.log('\n' + t)
const db = await criaBanco(), q = (s, p) => qq(db, s, p)
const erro = async (sql, p, trecho, msg) => { try { await db.query(sql, p); ok(false, msg + ' (deveria dar erro)') } catch (e) { ok(!trecho || e.message.includes(trecho), `${msg}: "${e.message}"`) } }
const sha = s => createHash('sha256').update(s).digest('hex')

secao('Carga de volume')
const t0 = Date.now(), M = await semeia(db)
const cont = (await q(`select (select count(*) from equipes where campeonato_id = $1)::int eq, (select count(*) from atletas)::int at, (select count(*) from jogos)::int jg,
  (select count(*) from eventos)::int ev, (select count(*) from jogos where status = 'encerrado')::int enc, (select count(*) from jogos where status = 'agendado')::int agd`, [CAMP]))[0]
ok(cont.eq === 16 && cont.at === 300 && cont.jg === 120, `16 equipes, 300 atletas e 120 jogos (${cont.eq}/${cont.at}/${cont.jg})`)
ok(cont.ev >= 1200, `mais de 1.200 eventos (${cont.ev}), acima do limite de 1.000 linhas do Supabase`)
ok(cont.enc === 112 && cont.agd === 8, '112 súmulas confirmadas (rodadas 1 a 14) e 8 jogos agendados (rodada 15)')
ok((await q(`select count(*)::int c from jogos where status = 'encerrado' and hash ~ '^[0-9a-f]{64}$' and assinaturas ? 'arbitro' and assinaturas ? 'mandante' and assinaturas ? 'visitante'`))[0].c === 112, 'toda súmula confirmada tem código de autenticidade (SHA-256) e as 3 assinaturas')
ok(M.vermelhos.length === 3 && (await q(`select count(*)::int c from eventos where tipo = 'vermelho'`))[0].c === 3, '3 cartões vermelhos na rodada 14')

// ---- cálculo independente da classificação, a partir dos eventos brutos ----
const classifica = async () => {
  const ev = await q(`select e.jogo_id, e.equipe_id, e.tipo from eventos e join jogos j on j.id = e.jogo_id where e.tipo = 'gol' and j.status = 'encerrado' and j.fase = 'grupos'`)
  const gj = {}; for (const e of ev) (gj[e.jogo_id] ??= {})[e.equipe_id] = (gj[e.jogo_id][e.equipe_id] ?? 0) + 1
  const jogos = await q(`select j.id, j.mandante_id m, j.visitante_id v, j.wo_ausente_id wo, j.grupo, j.campeonato_id from jogos j where status = 'encerrado' and fase = 'grupos'`)
  const t = {}
  for (const j of jogos) {
    const gm = j.wo ? (j.wo === j.m ? 0 : 3) : gj[j.id]?.[j.m] ?? 0, gv = j.wo ? (j.wo === j.v ? 0 : 3) : gj[j.id]?.[j.v] ?? 0
    for (const [id, gp, gc] of [[j.m, gm, gv], [j.v, gv, gm]]) {
      const x = t[id] ??= { id, grupo: j.grupo, J: 0, V: 0, E: 0, D: 0, GP: 0, GC: 0 }
      x.J++; x.GP += gp; x.GC += gc; gp > gc ? x.V++ : gp === gc ? x.E++ : x.D++
    }
  }
  const nomes = Object.fromEntries((await q(`select id, nome from equipes`)).map(e => [e.id, e.nome]))
  return Object.values(t).map(x => ({ ...x, P: x.V * 3 + x.E, SG: x.GP - x.GC, nome: nomes[x.id] }))
    .sort((a, b) => a.grupo.localeCompare(b.grupo) || b.P - a.P || b.V - a.V || b.SG - a.SG || b.GP - a.GP || a.nome.localeCompare(b.nome))
}
const daView = async cid => (await q(`select equipe_id id, pontos, v, e, d, gp, gc, saldo, grupo from classificacao where campeonato_id = $1 and j > 0 order by grupo, posicao`, [cid]))
const igual = (esperado, view) => esperado.length === view.length && esperado.every((x, i) => view[i].id === x.id && view[i].pontos === x.P && view[i].v === x.V && view[i].e === x.E && view[i].d === x.D && view[i].gp === x.GP && view[i].gc === x.GC)

secao('Classificação (view do banco × cálculo independente)')
ok(igual(await classifica(), await daView(CAMP)), 'tabela de 16 equipes após 14 rodadas: posição, pontos, V/E/D e gols iguais ao cálculo independente')
const gols = (await q(`select count(*)::int c from eventos e join jogos j on j.id = e.jogo_id where e.tipo = 'gol' and j.status = 'encerrado'`))[0].c
ok((await q(`select sum(gols_mandante + gols_visitante)::int s from placar p join jogos j on j.id = p.jogo_id where j.status = 'encerrado'`))[0].s === gols, `a soma dos placares (view placar) é igual aos gols dos eventos (${gols})`)

secao('Súmula: confirmar, reenviar, reabrir')
const j1 = M.jogos[0]
await como(db, ARB)
const [{ h }] = await q(`select hash h from jogos where id = $1`, [j1.id])
ok((await q(`select confirmar_sumula($1, null, null, '', $2) h`, [j1.id, ASSIN]))[0].h === h, 'reenviar a súmula já confirmada devolve o mesmo código e não muda nada')
await erro(`insert into eventos (id, jogo_id, tipo, equipe_id, atleta_id, minuto, tempo) values ($1, $2, 'gol', $3, $4, 5, 1)`, [uid(6, 90001), j1.id, j1.m, M.at[j1.m][0]], '', 'jogo encerrado não aceita novo evento')
await erro(`select reabrir_sumula($1, 'quero mudar o placar')`, [j1.id], 'Secretaria', 'árbitro não reabre súmula')
await como(db, SEC)
await erro(`select reabrir_sumula($1, 'x')`, [j1.id], 'motivo', 'reabrir exige motivo')
await q(`select reabrir_sumula($1, 'placar anotado errado')`, [j1.id])
ok((await q(`select status from jogos where id = $1`, [j1.id]))[0].status === 'correcao', 'Secretaria reabre a súmula com motivo (status correção)')
await como(db, ARB)
await q(`select confirmar_sumula($1, null, null, '', $2)`, [j1.id, ASSIN])
ok((await q(`select status from jogos where id = $1`, [j1.id]))[0].status === 'encerrado', 'a correção é confirmada de novo')
ok(igual(await classifica(), await daView(CAMP)), 'depois de reabrir e confirmar, a classificação continua igual ao cálculo independente')

secao('Suspensão automática por cartão vermelho (rodada 15)')
const r15 = team => M.jogos.find(j => j.rodada === 15 && (j.m === team || j.v === team))
for (const { atleta, equipe } of M.vermelhos) {
  const jg = r15(equipe)
  await como(db, ARB)
  await erro(`insert into eventos (id, jogo_id, tipo, equipe_id, atleta_id, minuto, tempo) values ($1, $2, 'gol', $3, $4, 10, 1)`, [uid(6, 91000 + M.vermelhos.indexOf(M.vermelhos.find(v => v.atleta === atleta))), jg.id, equipe, atleta], 'suspenso', 'atleta com vermelho na rodada anterior não pode jogar na seguinte')
  await dono(db)   // função interna (só o banco chama); aqui conferimos o resultado dela
  ok((await q(`select suspensao_automatica($1, $2) s`, [atleta, jg.id]))[0].s === 'cartão vermelho', 'o banco informa o motivo da suspensão')
  ok((await q(`select suspensao_automatica($1, $2) s`, [M.at[equipe][0], jg.id]))[0].s === null, 'colega de equipe sem cartão não é suspenso')
}
await como(db, ARB)
const livre = M.vermelhos[0], jgS = r15(livre.equipe)
await q(`insert into eventos (id, jogo_id, tipo, equipe_id, atleta_id, minuto, tempo) values ($1, $2, 'gol', $3, $4, 12, 1)`, [uid(6, 91100), jgS.id, livre.equipe, M.at[livre.equipe][0]])
ok(true, 'colega de equipe sem cartão registra gol normalmente')
await q(`delete from eventos where id = $1`, [uid(6, 91100)])

secao('W.O.')
const alvoWO = M.jogos.find(j => j.rodada === 15 && !M.vermelhos.some(v => v.equipe === j.m || v.equipe === j.v))
await como(db, ARB)
await erro(`select registrar_wo($1, $2, 'equipe não compareceu')`, [alvoWO.id, alvoWO.v], 'Secretaria', 'árbitro não registra W.O.')
await como(db, SEC)
await erro(`select registrar_wo($1, $2, 'x')`, [alvoWO.id, alvoWO.v], 'motivo', 'W.O. exige motivo')
await q(`select registrar_wo($1, $2, 'equipe não compareceu no horário')`, [alvoWO.id, alvoWO.v])
const wo = (await q(`select j.status, j.wo_ausente_id, p.gols_mandante gm, p.gols_visitante gv from jogos j join placar p on p.jogo_id = j.id where j.id = $1`, [alvoWO.id]))[0]
ok(wo.status === 'encerrado' && wo.wo_ausente_id === alvoWO.v && wo.gm === 3 && wo.gv === 0, 'W.O.: jogo encerrado, ausente registrado, placar 3 × 0')
ok(igual(await classifica(), await daView(CAMP)), 'a classificação conta o W.O. (3 gols) exatamente como o cálculo independente')
ok((await q(`select count(*)::int c from historico where o_que ilike '%W.O.%'`))[0].c >= 1, 'o W.O. fica no histórico')

secao('Portal público com volume (visitante sem login)')
await como(db, null)
await erro(`select count(*) from atletas`, [], 'permission denied', 'visitante não lê a tabela de atletas')
await erro(`select count(*) from jogos`, [], 'permission denied', 'visitante não lê a tabela de jogos')
await erro(`select count(*) from equipes`, [], 'permission denied', 'visitante não lê a tabela de equipes')
const pub = await q(`select * from atletas_publico`)
ok(pub.length === 300, `atletas_publico mostra os 300 atletas aprovados (${pub.length})`)
ok(!Object.keys(pub[0]).some(c => /nasc|telefone|respons|rg_|endereco|municipio|autoriz|consent|foto_path/.test(c)), 'atletas_publico não expõe nascimento, telefone, responsável, documento nem endereço')
const menorSet = new Set(M.menores)
ok(pub.filter(a => menorSet.has(a.id)).every(a => /^\S+ \S\.$/.test(a.nome)) && pub.filter(a => !menorSet.has(a.id)).every(a => a.nome.split(' ').length === 4), 'os 15 menores aparecem só como "Primeiro-nome S."; os maiores com o nome completo')
const jp = await q(`select * from jogos_publico`)
ok(jp.length === 120 && !Object.keys(jp[0]).some(c => /observ|assinat/.test(c)) && !JSON.stringify(jp).includes('OBSERVACAO INTERNA'), 'jogos_publico: 120 jogos, sem observações nem assinaturas')
ok(!Object.keys((await q(`select * from equipes_publico limit 1`))[0]).some(c => /codigo|link_token|telefone|respons/.test(c)), 'equipes_publico não expõe código, link nem telefone do responsável')
ok((await q(`select count(*)::int c from eventos`))[0].c === cont.ev, 'o visitante lê todos os eventos (artilharia e placares públicos)')
const hp = await q(`select * from historico_publico`)
ok(hp.length > 0 && !JSON.stringify(hp).includes('Arbitro Teste') && !JSON.stringify(hp).includes('Secretaria Teste') && Object.keys(hp[0]).join() === 'jogo_id,o_que,em', 'historico_publico: só jogo, texto esportivo e data, sem autor')
ok((await q(`select count(*)::int c from classificacao where campeonato_id = $1`, [CAMP]))[0].c === 16, 'o visitante lê a classificação das 16 equipes')

secao('Perfis com volume')
await como(db, REP)
ok((await q(`select count(*)::int c from atletas`))[0].c === 19 && (await q(`select count(*)::int c from atletas where nascimento is not null`))[0].c === 19, 'representante vê só os 19 atletas da própria equipe, com os dados completos')
await erro(`insert into eventos (id, jogo_id, tipo, equipe_id, atleta_id, minuto, tempo) values ($1, $2, 'gol', $3, $4, 1, 1)`, [uid(6, 92000), r15(M.eq[0]).id, M.eq[0], M.at[M.eq[0]][0]], '', 'representante não registra evento')
await como(db, SEC)
ok((await q(`select count(*)::int c from atletas`))[0].c === 300, 'Secretaria vê os 300 atletas')

// ---- sorteio, grupos, tabela e mata-mata de um segundo campeonato com 16 equipes ----
secao('Sorteio, grupos, tabela e mata-mata (16 equipes, 4 grupos)')
const ctx = vm.createContext({ crypto: webcrypto, TextEncoder, console })
for (const f of ['regras.js', 'dados.js']) vm.runInContext(readFileSync(new URL('../js/' + f, import.meta.url), 'utf8'), ctx, { filename: f })
await como(db, SEC)
const B = uid(2, 2), eqB = [], atB = {}
await db.query(`insert into campeonatos (id, nome, modalidade, idade_min, inicio, formato, regras) values ($1, 'Copa Volume Grupos', 'Futsal', 15, '2027-05-01', 'grupos', '{"grupos": 4, "classificam": 2}')`, [B])
for (let i = 1; i <= 16; i++) {
  const id = uid(3, 100 + i); eqB.push(id)
  await db.query(`insert into equipes (id, campeonato_id, nome, bairro, pote) values ($1, $2, $3, 'Centro', $4)`, [id, B, 'Grupo Time ' + String(i).padStart(2, '0'), i <= 4 ? 1 : 2])
  atB[id] = uid(4, 1000 + i)
  await db.query(`insert into atletas (id, equipe_id, nome, numero, nascimento, bairro, autorizacao, aprovado, consentimento, foto_path) values ($1, $2, $3, 9, '1990-01-01', 'Centro', true, true, true, 'f/x.jpg')`, [atB[id], id, 'Atleta Grupo ' + i])
}
const semente = 'a1b2c3d4e5f60718'
await q(`select publicar_compromisso($1, $2)`, [B, sha(semente)])
const [{ s: finalSeed }] = await q(`select revelar_semente($1, $2, '7 21 3') s`, [B, semente])
ok(finalSeed === sha(semente + '7 21 3').slice(0, 16), 'semente final = sha256(semente + entrada pública)')
const cB = vm.runInContext(`champBase({id: 'B', sport: 'Futsal', format: 'grupos', rules: {grupos: 4, classificam: 2}, start: '2027-05-01', teams: ${JSON.stringify(eqB.map((id, i) => ({ id, name: 'Grupo Time ' + String(i + 1).padStart(2, '0'), pot: i < 4 ? 1 : 2 })))}})`, ctx)
const grupos = vm.runInContext(`drawGroups(${JSON.stringify(cB.teams)}, '${finalSeed}', 4)`, ctx)
ok(Object.keys(grupos).join() === 'A,B,C,D' && Object.values(grupos).every(g => g.length === 4), 'o sorteio do app forma 4 grupos de 4 equipes')
ok(JSON.stringify(vm.runInContext(`drawGroups(${JSON.stringify(cB.teams)}, '${finalSeed}', 4)`, ctx)) === JSON.stringify(grupos), 'o mesmo sorteio repetido dá os mesmos grupos (auditável)')
const ms = vm.runInContext(`buildFixtures(${JSON.stringify(cB)}, ${JSON.stringify(grupos)}, '2027-05-01')`, ctx)
const idj = Object.fromEntries(ms.map((m, i) => [m.id, uid(5, 5000 + i)])), vaga = s => s && s.replace(/^([VP]):(.+)$/, (_, k, x) => `${k}:${idj[x]}`)
await q(`select aplicar_sorteio($1, $2, $3)`, [B, grupos, ms.map(m => ({ id: idj[m.id], fase: m.phase, rodada: m.round, grupo: m.group, titulo: m.title, mandante_id: m.home, visitante_id: m.away,
  vaga_mandante: vaga(m.slotH), vaga_visitante: vaga(m.slotA), data: m.date, hora: m.time, local: m.local }))])
const porFase = Object.fromEntries((await q(`select fase, count(*)::int c from jogos where campeonato_id = $1 group by fase`, [B])).map(x => [x.fase, x.c]))
ok(porFase.grupos === 24 && porFase.quartas === 4 && porFase.semi === 2 && porFase.terceiro === 1 && porFase.final === 1, `tabela gerada pelo banco: 24 jogos de grupos + 4 quartas + 2 semis + 3º lugar + final (${JSON.stringify(porFase)})`)
const grpDB = Object.fromEntries((await q(`select grupo, array_agg(id order by nome) ids from equipes where campeonato_id = $1 group by grupo`, [B])).map(x => [x.grupo, x.ids]))
ok(Object.keys(grupos).every(g => JSON.stringify([...grupos[g]].sort()) === JSON.stringify([...grpDB[g]].sort())), 'os grupos gravados no banco são os do sorteio')

// joga: o árbitro apita todos os jogos que já têm as duas equipes
let seq = 0
const joga = async (j, gm, gv) => {
  await como(db, SEC); await db.query(`update jogos set arbitro_id = $1 where id = $2`, [ARB, j.id]); await como(db, ARB)
  for (const [eqp, n] of [[j.mandante_id, gm], [j.visitante_id, gv]]) for (let k = 0; k < n; k++)
    await db.query(`insert into eventos (id, jogo_id, tipo, equipe_id, atleta_id, minuto, tempo) values ($1, $2, 'gol', $3, $4, $5, 1)`, [uid(6, 200000 + ++seq), j.id, eqp, atB[eqp], 5 + k])
  await db.query(`select confirmar_sumula($1, null, null, '', $2)`, [j.id, ASSIN])
}
const gj = await q(`select id, mandante_id, visitante_id from jogos where campeonato_id = $1 and fase = 'grupos' order by rodada, id`, [B])
for (const [i, j] of gj.entries()) await joga(j, i % 3, (i * 2 + 1) % 4)
await dono(db)
const esperadoB = (await classifica()).filter(x => eqB.includes(x.id))
const viewB = await daView(B)
ok(igual(esperadoB, viewB), 'classificação dos 4 grupos (view do banco) igual ao cálculo independente')
const top = {}; for (const x of esperadoB) (top[x.grupo] ??= []).push(x.id)
const quartas = await q(`select vaga_mandante vm, vaga_visitante vv, mandante_id m, visitante_id v from jogos where campeonato_id = $1 and fase = 'quartas'`, [B])
ok(quartas.every(j => j.m === top[j.vm[1]][+j.vm[0] - 1] && j.v === top[j.vv[1]][+j.vv[0] - 1]), 'o banco coloca nas quartas exatamente 1º e 2º de cada grupo, como no cálculo independente')
for (let guarda = 0; guarda < 20; guarda++) {
  await dono(db)
  const prox = (await q(`select id, mandante_id, visitante_id from jogos where campeonato_id = $1 and status = 'agendado' and mandante_id is not null and visitante_id is not null order by data, hora, id limit 1`, [B]))[0]
  if (!prox) break
  await joga(prox, 2, 1)
}
await dono(db)
const fim = (await q(`select (select status from campeonatos where id = $1) st, (select count(*)::int from jogos where campeonato_id = $1 and status = 'encerrado') enc, (select hash from jogos where campeonato_id = $1 and fase = 'final') hf`, [B]))[0]
ok(fim.enc === 32 && fim.st === 'encerrado' && /^[0-9a-f]{64}$/.test(fim.hf), 'mata-mata até a final: 32 jogos encerrados, final com código de súmula e campeonato encerrado automaticamente')

console.log(`\n(carga de volume em ${((Date.now() - t0) / 1000).toFixed(1)} s)`)
console.log(falhas ? `${falhas} de ${total} verificações de volume falharam` : `ok: ${total} verificações de volume`)
process.exit(falhas ? 1 : 0)

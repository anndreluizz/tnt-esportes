// cd supabase && node testar-volume-app.mjs
// Camada 2: roda o app de verdade (js/regras.js, dados.js, app.js, api.js → loadAll, classificação, artilharia, disciplina) sobre os dados de volume
// e compara com o que o BANCO calcula. 100% local: PGlite + um cliente Supabase de mentira que devolve as linhas.
//
// Duas execuções:
//  1) SEM limite de linhas: o app tem que bater exatamente com o banco (valida a lógica do app).
//  2) COM o limite de 1.000 linhas por consulta (o "Max rows" padrão do Supabase/PostgREST; mude com LIMITE_LINHAS=n): mede se o app erra.
//     Hoje o app não pagina, então este caso mostra um ACHADO. Ele só derruba o teste com LIMITE_ESTRITO=1 (para usar quando houver a correção).
import { readFileSync } from 'node:fs'
import { createHash, webcrypto } from 'node:crypto'
import vm from 'node:vm'
import { criaBanco, semeia, como, dono, q as qq, SEC, CAMP } from './volume.mjs'

const LIMITE = +(process.env.LIMITE_LINHAS || 1000), ESTRITO = !!process.env.LIMITE_ESTRITO
let total = 0, falhas = 0
const ok = (cond, msg) => { total++; if (!cond) { falhas++; console.error('  FALHOU:', msg) } }
const db = await criaBanco(), q = (s, p) => qq(db, s, p)
const M = await semeia(db)

// ---- o que o banco devolve (como o PostgREST: JSON, na ordem física, sem ORDER BY) ----
const exporta = async (uid, tabelas) => {
  await como(db, uid); const out = {}
  for (const t of tabelas) out[t] = (await q(`select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) j from (select * from ${t}) x`))[0].j
  await dono(db); return out
}
const TAB = {
  publico: await exporta(null, ['campeonatos_publico', 'equipes_publico', 'atletas_publico', 'jogos_publico', 'eventos', 'sorteios_publico', 'historico_publico', 'sorteios_cancelados']),
  secretaria: await exporta(SEC, ['campeonatos', 'equipes', 'atletas', 'jogos', 'eventos', 'sorteios_publico', 'historico', 'suspensoes', 'perfis', 'sorteios_cancelados']),
}

// ---- verdade calculada pelo banco ----
await dono(db)
const verdade = {
  classificacao: (await q(`select equipe_id id, pontos, v, e, d, gp, gc from classificacao where campeonato_id = $1 order by posicao`, [CAMP])),
  placar: Object.fromEntries((await q(`select p.jogo_id, p.gols_mandante gm, p.gols_visitante gv from placar p join jogos j on j.id = p.jogo_id where j.status = 'encerrado'`)).map(x => [x.jogo_id, [x.gm, x.gv]])),
  gols: Object.fromEntries((await q(`select e.atleta_id id, count(*)::int n from eventos e join jogos j on j.id = e.jogo_id where e.tipo = 'gol' and j.status = 'encerrado' and e.atleta_id is not null group by 1`)).map(x => [x.id, x.n])),
  eventos: (await q(`select count(*)::int c from eventos`))[0].c,
  suspensos: M.vermelhos.map(v => ({ atleta: v.atleta, jogo: M.jogos.find(j => j.rodada === 15 && (j.m === v.equipe || j.v === v.equipe)).id })),
}

// ---- o app de verdade, em um sandbox ----
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8')
const el = () => ({ innerHTML: '', className: '', hidden: false, value: '', classList: { add() {}, remove() {}, toggle() {} }, replaceChildren() {} }), els = {}
const ctx = vm.createContext({ crypto: webcrypto, TextEncoder, console, setInterval() {}, setTimeout, clearTimeout, scrollTo() {}, print() {}, SUPABASE_URL: 'http://localhost',
  localStorage: { getItem: () => null, setItem() {} }, navigator: {}, location: { protocol: 'file:', hash: '' },
  document: { querySelector: s => els[s] ??= el(), querySelectorAll: () => [], getElementById: () => null, addEventListener() {}, body: el(), fonts: { load: () => Promise.resolve() },
    createElement: () => ({ getContext: () => new Proxy({}, { get: (t, k) => k === 'measureText' ? () => ({ width: 0 }) : /Gradient$/.test(k) ? () => ({ addColorStop() {} }) : () => {}, set: () => true }) }) } })
for (const f of ['js/regras.js', 'js/dados.js', 'js/app.js', 'js/api.js']) vm.runInContext(read(f), ctx, { filename: f })
const run = code => vm.runInContext(code, ctx)

// cliente Supabase de mentira: as consultas do loadAll devolvem as linhas, cortadas em `cap` (como o PostgREST)
const sbFalso = (tabelas, cap) => ({
  from: t => {
    if (!tabelas[t]) throw new Error('o app consultou uma fonte inesperada: ' + t)
    const st = { rows: [...tabelas[t]], lim: cap }
    const ch = {
      select: () => ch, eq: (c, v) => { st.rows = st.rows.filter(r => r[c] === v); return ch },
      order: (c, o) => { const s = o?.ascending === false ? -1 : 1; st.rows.sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * s); return ch },
      limit: n => { st.lim = Math.min(n, cap); return ch },
      then: (f, g) => Promise.resolve({ data: st.rows.slice(0, st.lim), error: null }).then(f, g) }
    return ch
  },
  storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }), list: async () => ({ data: [], error: null }), remove: async () => ({ data: [], error: null }) }) } })
globalThis.__tab = TAB

const mede = async (perfil, cap) => {
  ctx.__sb = sbFalso(TAB[perfil], cap)
  run(`sb = __sb; S.session = ${perfil === 'secretaria' ? `{role: 'secretaria', uid: '${SEC}', name: 'Secretaria'}` : `{role: 'publico'}`}`)
  await run('loadAll()')
  const r = JSON.parse(run(`JSON.stringify((() => { const c = S.champs.find(x => x.id === '${CAMP}'), d = discipline(c)
    return {
      eventos: c.matches.reduce((n, m) => n + m.events.length, 0),
      tabela: standings(c, 'A').map(x => ({id: x.t.id, pontos: x.P, v: x.V, e: x.E, d: x.D, gp: x.GP, gc: x.GC})),
      placar: Object.fromEntries(c.matches.filter(isDone).map(m => [m.id, score(m)])),
      gols: Object.fromEntries(scorers(c).map(s => [s.p.id, s.n])),
      susp: ${JSON.stringify(verdade.suspensos)}.map(s => !!(d.susp[s.jogo] && d.susp[s.jogo][s.atleta])),
      jogos: c.matches.length, atletas: c.players.length } })())`))
  const difTabela = r.tabela.filter((x, i) => JSON.stringify(x) !== JSON.stringify(verdade.classificacao[i])).length
  const difPlacar = Object.keys(verdade.placar).filter(j => JSON.stringify(r.placar[j]) !== JSON.stringify(verdade.placar[j])).length
  const ids = new Set([...Object.keys(verdade.gols), ...Object.keys(r.gols)])
  const difGols = [...ids].filter(a => (r.gols[a] ?? 0) !== (verdade.gols[a] ?? 0)).length
  return { ...r, difTabela, difPlacar, difGols, suspOk: r.susp.filter(Boolean).length }
}

console.log(`Eventos no banco: ${verdade.eventos}. Jogos: ${M.jogos.length}. Atletas: ${M.total.atletas}. Limite de linhas simulado: ${LIMITE}.`)
for (const perfil of ['publico', 'secretaria']) {
  console.log(`\nApp como ${perfil}`)
  const livre = await mede(perfil, Infinity)
  ok(livre.eventos === verdade.eventos && livre.jogos === 120 && livre.atletas === 300, `sem limite: o app carrega todos os ${verdade.eventos} eventos, 120 jogos e 300 atletas`)
  ok(livre.difTabela === 0, 'sem limite: classificação do app (16 equipes) igual à view do banco')
  ok(livre.difPlacar === 0, 'sem limite: os 112 placares do app iguais ao do banco')
  ok(livre.difGols === 0, 'sem limite: artilharia do app (gols por atleta) igual à do banco')
  ok(livre.suspOk === 3, 'sem limite: o app mostra os 3 suspensos por cartão vermelho na rodada seguinte')

  const cort = await mede(perfil, LIMITE)
  const perdidos = verdade.eventos - cort.eventos
  console.log(`  Com limite de ${LIMITE} linhas: o app recebeu ${cort.eventos} de ${verdade.eventos} eventos (${perdidos} perdidos, sem aviso).`)
  console.log(`  → linhas da classificação erradas: ${cort.difTabela} de 16 · placares errados: ${cort.difPlacar} de ${Object.keys(verdade.placar).length} · atletas com gols errados: ${cort.difGols} · suspensos por vermelho que o app mostra: ${cort.suspOk} de 3`)
  const erra = perdidos > 0 && (cort.difTabela + cort.difPlacar + cort.difGols > 0 || cort.suspOk < 3)
  if (ESTRITO) ok(!erra && perdidos === 0, `com limite: o app não pode perder eventos nem errar resultados`)
  else if (erra) console.log('  ACHADO: com mais eventos que o limite, o app mostra classificação, placares, artilharia ou suspensões diferentes do banco. (Não falha o teste; use LIMITE_ESTRITO=1 para falhar.)')
  else ok(perdidos === 0, 'com limite: nada foi perdido')
}
console.log(falhas ? `\n${falhas} de ${total} verificações do app falharam` : `\nok: ${total} verificações do app sobre o volume (o ACHADO acima, se houver, não conta como falha)`)
process.exit(falhas ? 1 : 0)

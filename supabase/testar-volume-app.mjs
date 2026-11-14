// cd supabase && node testar-volume-app.mjs
// Camada 2: roda o app de verdade (js/regras.js, dados.js, app.js, api.js → loadAll, classificação, artilharia, disciplina) sobre os dados de volume
// e compara com o que o BANCO calcula. 100% local: PGlite + um cliente Supabase de mentira que devolve as linhas.
//
// O app lê o banco em páginas (api.js: lerTudo) e confere o total. Este teste prova que, mesmo com o limite de 1.000 linhas por consulta
// (o "Max rows" padrão do Supabase; LIMITE_LINHAS=n muda), e com limites menores, o app mostra exatamente o que o banco calcula, e que uma
// leitura incompleta é detectada e informada. LIMITE_ESTRITO=0 só mostra o resultado sem falhar (o padrão agora é falhar).
import { readFileSync } from 'node:fs'
import { createHash, webcrypto } from 'node:crypto'
import vm from 'node:vm'
import { criaBanco, semeia, como, dono, q as qq, SEC, CAMP } from './volume.mjs'

const LIMITE = +(process.env.LIMITE_LINHAS || 1000), ESTRITO = process.env.LIMITE_ESTRITO !== '0'
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

// cliente Supabase de mentira, como o PostgREST: ordem pedida, range, contagem exata e teto de linhas por resposta (cap).
// modo: 'normal' | 'semContagem' (sem count) | 'ignoraRange' (devolve sempre as primeiras linhas) | 'cortaSempre' (nunca passa de cap linhas no total)
const sbFalso = (tabelas, cap, modo = 'normal') => ({
  from: t => {
    if (!tabelas[t]) throw new Error('o app consultou uma fonte inesperada: ' + t)
    const st = { filtros: [], ordens: [], de: 0, ate: Infinity, contar: false }
    const ch = {
      select: (c, o) => { st.contar = o?.count === 'exact'; return ch }, eq: (c, v) => { st.filtros.push([c, v]); return ch },
      order: (c, o) => { st.ordens.push([c, o?.ascending === false ? -1 : 1]); return ch },
      limit: n => { st.ate = Math.min(st.ate, st.de + n - 1); return ch }, range: (a, b) => { st.de = a; st.ate = b; return ch },
      then: (f, g) => {
        let rows = tabelas[t].filter(r => st.filtros.every(([c, v]) => r[c] === v))
        if (st.ordens.length) rows = [...rows].sort((a, b) => { for (const [c, s] of st.ordens) { if (a[c] !== b[c]) return (a[c] > b[c] ? 1 : -1) * s } return 0 })
        const total = rows.length
        const de = modo === 'ignoraRange' ? 0 : st.de, ate = modo === 'ignoraRange' ? cap - 1 : st.ate
        let fatia = rows.slice(de, ate + 1).slice(0, cap)
        if (modo === 'cortaSempre') fatia = rows.slice(0, cap).slice(de, ate + 1)
        return Promise.resolve({ data: fatia, error: null, count: st.contar && modo !== 'semContagem' ? total : null }).then(f, g)
      } }
    return ch
  },
  storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }), list: async () => ({ data: [], error: null }), remove: async () => ({ data: [], error: null }) }) } })

const mede = async (perfil, cap, modo) => {
  ctx.__sb = sbFalso(TAB[perfil], cap, modo)
  run(`sb = __sb; S.session = ${perfil === 'secretaria' ? `{role: 'secretaria', uid: '${SEC}', name: 'Secretaria'}` : `{role: 'publico'}`}`)
  await run('loadAll()')
  const r = JSON.parse(run(`JSON.stringify((() => { const c = S.champs.find(x => x.id === '${CAMP}'), d = discipline(c)
    return {
      eventos: c.matches.reduce((n, m) => n + m.events.length, 0),
      tabela: standings(c, 'A').map(x => ({id: x.t.id, pontos: x.P, v: x.V, e: x.E, d: x.D, gp: x.GP, gc: x.GC})),
      placar: Object.fromEntries(c.matches.filter(isDone).map(m => [m.id, score(m)])),
      gols: Object.fromEntries(scorers(c).map(s => [s.p.id, s.n])),
      susp: ${JSON.stringify(verdade.suspensos)}.map(s => !!(d.susp[s.jogo] && d.susp[s.jogo][s.atleta])),
      jogos: c.matches.length, atletas: c.players.length, incompleto: S.incompleto, aviso: avisoLeitura() } })())`))
  const difTabela = r.tabela.filter((x, i) => JSON.stringify(x) !== JSON.stringify(verdade.classificacao[i])).length
  const difPlacar = Object.keys(verdade.placar).filter(j => JSON.stringify(r.placar[j]) !== JSON.stringify(verdade.placar[j])).length
  const ids = new Set([...Object.keys(verdade.gols), ...Object.keys(r.gols)])
  const difGols = [...ids].filter(a => (r.gols[a] ?? 0) !== (verdade.gols[a] ?? 0)).length
  return { ...r, difTabela, difPlacar, difGols, suspOk: r.susp.filter(Boolean).length }
}
const resumo = r => `eventos ${r.eventos}/${verdade.eventos}, classificação errada ${r.difTabela}/16, placares errados ${r.difPlacar}/${Object.keys(verdade.placar).length}, gols errados ${r.difGols}, suspensos ${r.suspOk}/3`
const igualAoBanco = r => r.eventos === verdade.eventos && r.jogos === 120 && r.atletas === 300 && r.difTabela === 0 && r.difPlacar === 0 && r.difGols === 0 && r.suspOk === 3

console.log(`Eventos no banco: ${verdade.eventos}. Jogos: ${M.jogos.length}. Atletas: ${M.total.atletas}. Limite de linhas simulado: ${LIMITE}.`)
for (const perfil of ['publico', 'secretaria']) {
  console.log(`
App como ${perfil}`)
  for (const cap of [Infinity, LIMITE, 500, 250]) {
    const r = await mede(perfil, cap)
    const nome = cap === Infinity ? 'sem limite' : `limite de ${cap} linhas`
    console.log(`  ${nome}: ${resumo(r)}`)
    ok(igualAoBanco(r), `${nome}: eventos, classificação (16), placares (112), artilharia e suspensões (3) iguais aos do banco`)
    ok((r.incompleto ?? []).length === 0 && r.aviso === '', `${nome}: leitura completa, sem aviso falso`)
  }
  // servidor sem contagem exata: o app ainda lê tudo (para quando a página vem curta)
  ok(igualAoBanco(await mede(perfil, LIMITE, 'semContagem')), 'sem contagem exata do servidor: o app ainda lê tudo e bate com o banco')
  // leitura incompleta: o app tem que perceber e avisar, não mostrar números errados em silêncio
  for (const modo of ['cortaSempre', 'ignoraRange']) {
    const r = await mede(perfil, LIMITE, modo)
    ok((r.incompleto ?? []).includes('eventos') && /Leitura incompleta do banco/.test(r.aviso) && r.aviso.includes('eventos'), `servidor que corta (${modo}): o app detecta a leitura incompleta de eventos e mostra o aviso`)
  }
}
// cópia de segurança e verificação de imagens usam leitura estrita: incompleta = erro, nunca arquivo pela metade
ctx.__sb = sbFalso(TAB.secretaria, LIMITE, 'cortaSempre'); run('sb = __sb')
let negou = null; try { await run("ler('eventos', POR_ID, '*', null, true)") } catch (e) { negou = e.message }
ok(/Leitura incompleta de eventos/.test(negou || ''), `leitura estrita incompleta é recusada (${negou})`)
ctx.__sb = sbFalso(TAB.secretaria, LIMITE); run('sb = __sb')
ok((await run("ler('eventos', POR_ID, '*', null, true)")).length === verdade.eventos, 'leitura estrita completa devolve todos os eventos (cópia de segurança)')
ok((await run("ler('eventos', POR_ID)")).map(e => e.id).filter((x, i, a) => a.indexOf(x) !== i).length === 0, 'a leitura em páginas não repete nem pula linhas')
console.log(falhas ? `
${falhas} de ${total} verificações do app falharam` : `
ok: ${total} verificações do app sobre o volume`)
process.exit(falhas && ESTRITO ? 1 : 0)

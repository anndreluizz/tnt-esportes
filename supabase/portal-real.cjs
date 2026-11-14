// node supabase/portal-real.cjs
// Roda o loadAll REAL do aplicativo contra o banco de produção, como visitante sem login (só a chave pública).
// Só leituras. Mostra contagens e confere que nenhum dado vetado chega ao navegador do público.
const fs = require('fs'), vm = require('vm'), {createHash} = require('crypto')
const read = f => fs.readFileSync(__dirname + '/../' + f, 'utf8')
const cfg = read('js/config.js')
const URL_ = /SUPABASE_URL\s*=\s*'([^']+)'/.exec(cfg)[1], KEY = /SUPABASE_KEY\s*=\s*'([^']+)'/.exec(cfg)[1]

// cliente mínimo no lugar do supabase-js: traduz select/order/limit/eq em chamadas REST reais
const sb = {
  from: t => {
    const p = {select: '*'}
    const ch = {
      select: c => (p.select = c, ch), order: (c, o) => (p.order = c + (o && o.ascending === false ? '.desc' : '.asc'), ch),
      limit: n => (p.limit = n, ch), eq: (c, v) => (p['_' + c] = 'eq.' + v, ch),
      then: (res, rej) => {
        const qs = Object.entries(p).map(([k, v]) => (k[0] === '_' ? k.slice(1) : k) + '=' + encodeURIComponent(v)).join('&')
        return fetch(`${URL_}/rest/v1/${t}?${qs}`, {headers: {apikey: KEY, Authorization: 'Bearer ' + KEY}})
          .then(async r => { const corpo = await r.json().catch(() => null); return r.ok ? {data: corpo, error: null} : {data: null, error: {code: String(r.status), message: (corpo && corpo.message) || 'HTTP ' + r.status}} })
          .then(res, rej)
      }}
    return ch
  },
  storage: {from: () => ({createSignedUrls: async () => ({data: []})})}}

const el = () => ({innerHTML: '', className: '', hidden: false, value: '', classList: {add() {}, remove() {}, toggle() {}}, replaceChildren() {}})
const els = {}
const ctx = vm.createContext({
  crypto: require('crypto'), TextEncoder, console, setInterval() {}, setTimeout, clearTimeout, scrollTo() {}, print() {}, fetch,
  localStorage: {getItem: () => null, setItem() {}}, navigator: {}, location: {protocol: 'https:', hash: ''},
  document: {querySelector: s => els[s] ??= el(), querySelectorAll: () => [], getElementById: () => null, addEventListener() {}, body: el(), fonts: {load: () => Promise.resolve()}}})
vm.runInContext(read('js/config.js'), ctx, {filename: 'js/config.js'})
for (const f of ['js/regras.js', 'js/dados.js', 'js/app.js', 'js/api.js']) vm.runInContext(read(f), ctx, {filename: f})
ctx.__sb = sb
const run = c => vm.runInContext(c, ctx)
run('sb = __sb')

;(async () => {
  run(`S.session = {role: 'publico'}`)
  await run('loadAll()')
  const r = JSON.parse(run(`JSON.stringify({campeonatos: S.champs.map(c => ({nome: c.name, equipes: c.teams.length, jogos: c.matches.length, atletas: c.players.length,
    telefoneChegou: !!c.responsiblePhone, notasChegaram: c.matches.some(m => m.notes), assinaturasChegaram: c.matches.some(m => Object.keys(m.signatures).length)}))})`))
  let falhas = 0
  const ok = (cond, msg) => { console.log((cond ? '  ok      ' : '  FALHOU  ') + msg); if (!cond) falhas++ }
  console.log('loadAll real, como visitante, contra a produção:')
  ok(r.campeonatos.length >= 1, `carregou ${r.campeonatos.length} campeonato(s): ${r.campeonatos.map(c => c.nome + ' (' + c.equipes + ' equipe(s), ' + c.jogos + ' jogo(s))').join('; ')}`)
  ok(r.campeonatos.every(c => !c.telefoneChegou), 'o telefone do responsável NÃO chegou ao navegador do público')
  ok(r.campeonatos.every(c => !c.notasChegaram && !c.assinaturasChegaram), 'observações e assinaturas das súmulas NÃO chegaram ao navegador do público')
  console.log(falhas ? `\n${falhas} verificações falharam` : '\nok')
  process.exit(falhas ? 1 : 0)
})().catch(e => { console.error('ERRO:', e.message); process.exit(1) })

// Regras do campeonato. Só lógica, sem tela: tudo recebe o campeonato (c) como parâmetro.

const SPORTS = {
  'Futsal':           {half: 20, fouls: 5},
  'Futebol society':  {half: 25, fouls: null},
  'Futebol de campo': {half: 45, fouls: null},
}
const PHASES = {grupos: 'Fase de grupos', semi: 'Semifinal', terceiro: 'Disputa de 3º lugar', final: 'Final'}
const TIMES = ['19h00', '20h00', '21h00', '18h00']

const isDone = m => m.status === 'encerrado'
const byDate = (a, b) => (a.date + a.time).localeCompare(b.date + b.time) || a.id.localeCompare(b.id, undefined, {numeric: true})
const T = (c, id) => c.teams.find(t => t.id === id)
const P = (c, id) => c.players.find(p => p.id === id) || {name: '(atleta removido)', num: 0, team: ''}
const findMatch = (c, id) => c.matches.find(m => m.id === id)

function goals(m) { return [m.home, m.away].map(t => m.events.filter(e => e.type === 'gol' && e.team === t).length) }
function score(m) { return m.wo ? (m.wo === m.home ? [0, 3] : [3, 0]) : goals(m) }
function winner(m) {
  if (!isDone(m)) return null
  const [h, a] = score(m)
  if (h !== a) return h > a ? m.home : m.away
  return m.pen ? (m.pen[0] > m.pen[1] ? m.home : m.away) : null
}
function loser(m) { const w = winner(m); return w && (w === m.home ? m.away : m.home) }
const champion = c => { const f = c.matches.find(m => m.phase === 'final'); return f ? winner(f) : null }

/* ---------- inscrição ---------- */
function ageAt(birth, ref) {
  const [y, mo, d] = birth.split('-').map(Number), [ry, rm, rd] = ref.split('-').map(Number)
  return ry - y - (rm < mo || (rm === mo && rd < d) ? 1 : 0)
}
function insc(c, p) {
  const a = ageAt(p.birth, c.start)
  if (a < c.minAge) return ['bloqueado', `Abaixo da faixa etária (${a} anos)`]
  if (c.maxAge && a > c.maxAge) return ['bloqueado', `Acima da faixa etária (${a} anos)`]
  if (a < 18 && !p.auth) return ['pendente', 'Sem autorização do responsável']
  if (!p.approved) return ['analise', 'Aguardando aprovação da Secretaria']
  return ['aprovado', '']
}
function teamInsc(c, t) {
  const st = c.players.filter(p => p.team === t.id).map(p => insc(c, p)[0])
  const n = k => st.filter(s => s === k).length
  const parts = [[n('bloqueado'), 'fora da faixa etária'], [n('pendente'), 'sem autorização do responsável'], [n('analise'), 'aguardando aprovação']]
    .filter(([k]) => k).map(([k, txt]) => `${k} atleta${k > 1 ? 's' : ''} ${txt}`)
  const status = n('bloqueado') ? 'bloqueado' : n('pendente') ? 'pendente' : n('analise') ? 'analise' : 'aprovado'
  return [status, parts.join(' · ') || (st.length ? 'Elenco completo e aprovado' : 'Nenhum atleta inscrito')]
}

/* ---------- classificação ---------- */
function standings(c, g) {
  const rows = c.teams.filter(t => t.group === g).map(t => ({t, P: 0, J: 0, V: 0, E: 0, D: 0, GP: 0, GC: 0, SG: 0}))
  const r = id => rows.find(x => x.t.id === id)
  for (const m of c.matches) if (m.phase === 'grupos' && m.group === g && isDone(m)) {
    const [h, a] = score(m), H = r(m.home), A = r(m.away)
    H.J++; A.J++; H.GP += h; H.GC += a; A.GP += a; A.GC += h
    if (h > a) { H.V++; A.D++ } else if (h < a) { A.V++; H.D++ } else { H.E++; A.E++ }
  }
  rows.forEach(x => { x.P = x.V * 3 + x.E; x.SG = x.GP - x.GC })
  // desempate: pontos, vitórias, saldo, gols marcados, ordem alfabética
  return rows.sort((a, b) => b.P - a.P || b.V - a.V || b.SG - a.SG || b.GP - a.GP || a.t.name.localeCompare(b.t.name))
}
const groupMatches = (c, g) => c.matches.filter(m => m.phase === 'grupos' && m.group === g)
const groupDone = (c, g) => { const ms = groupMatches(c, g); return ms.length > 0 && ms.every(isDone) }

/* ---------- mata-mata: vagas "1A", "V:<jogo>" (vencedor), "P:<jogo>" (perdedor) ---------- */
function slotTeam(c, s) {
  const g = s.match(/^(\d)([A-Z])$/)
  if (g) return groupDone(c, g[2]) ? standings(c, g[2])[g[1] - 1]?.t.id ?? null : null
  const [k, id] = s.split(':'), m = findMatch(c, id)
  return m ? (k === 'V' ? winner(m) : loser(m)) : null
}
function slotLabel(c, s) {
  const g = s.match(/^(\d)([A-Z])$/)
  if (g) return `${g[1]}º do Grupo ${g[2]}`
  const [k, id] = s.split(':')
  return `${k === 'V' ? 'Vencedor' : 'Perdedor'} da ${findMatch(c, id).title}`
}
// Preenche os times do mata-mata que ainda não começou. Rodar depois de qualquer mudança de resultado.
function resolveKO(c) {
  for (const m of c.matches) if (m.phase !== 'grupos' && !isDone(m) && !m.events.length) {
    m.home = slotTeam(c, m.slotH); m.away = slotTeam(c, m.slotA)
  }
}

/* ---------- disciplina: 3 amarelos ou 1 vermelho = suspenso no jogo seguinte; 2 amarelos = pendurado ---------- */
function discipline(c) {
  const susp = {}, st = {}
  const add = (mid, pid, why) => { (susp[mid] ??= {})[pid] = why }
  for (const p of c.players) {
    const ms = c.matches.filter(m => m.home && (m.home === p.team || m.away === p.team)).sort(byDate)
    let y = 0, pend = null
    for (const m of ms) {
      if (pend) { add(m.id, p.id, pend); pend = null; continue }
      if (!isDone(m)) break
      for (const e of m.events) if (e.player === p.id) {
        if (e.type === 'vermelho') pend = 'Cartão vermelho'
        if (e.type === 'amarelo' && ++y >= 3) { y = 0; pend = '3 cartões amarelos' }
      }
    }
    st[p.id] = {y}
  }
  for (const x of c.punishments) for (const mid of x.matches) add(mid, x.player, 'Decisão da comissão disciplinar')
  return {susp, st}
}
const nextMatches = (c, team) => c.matches.filter(m => !isDone(m) && (m.home === team || m.away === team)).sort(byDate)

function scorers(c) {
  const n = {}
  c.matches.filter(isDone).forEach(m => m.events.forEach(e => { if (e.type === 'gol' && e.player) n[e.player] = (n[e.player] || 0) + 1 }))
  return Object.entries(n).map(([id, k]) => ({p: P(c, id), n: k})).sort((a, b) => b.n - a.n || a.p.name.localeCompare(b.p.name))
}

/* ---------- tabela de jogos ---------- */
function addDays(date, n) { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
function roundRobin(ids) {   // método do círculo: todos contra todos
  const t = [...ids]; if (t.length % 2) t.push(null)
  const n = t.length, rounds = []
  for (let r = 0; r < n - 1; r++) {
    const pairs = []
    for (let i = 0; i < n / 2; i++) { const a = t[i], b = t[n - 1 - i]; if (a && b) pairs.push(r % 2 ? [b, a] : [a, b]) }
    rounds.push(pairs); t.splice(1, 0, t.pop())
  }
  return rounds
}
function newMatch(o) {
  return {group: null, round: null, home: null, away: null, slotH: null, slotA: null, title: null, status: 'agendado', events: [], half: 1,
    pen: null, wo: null, postponed: null, signatures: {}, notes: '', hash: null, pendingConfirm: false, referee: 'João Paulo', history: [], ...o}
}
// Grupo A joga aos sábados, grupo B aos domingos; depois semifinais, 3º lugar e final.
function buildFixtures(c, groups, start) {
  const ms = []; let n = 0
  const id = () => `${c.id}-m${++n}`
  const rA = roundRobin(groups.A), rB = roundRobin(groups.B), R = Math.max(rA.length, rB.length)
  for (let r = 0; r < R; r++) for (const [g, pairs, off] of [['A', rA[r] || [], 0], ['B', rB[r] || [], 1]])
    pairs.forEach(([h, a], i) => ms.push(newMatch({id: id(), phase: 'grupos', round: r + 1, group: g, home: h, away: a, date: addDays(start, r * 7 + off), time: TIMES[i]})))
  const ko = addDays(start, R * 7), s1 = id(), s2 = id()
  ms.push(newMatch({id: s1, phase: 'semi', title: 'Semifinal 1', slotH: '1A', slotA: '2B', date: ko, time: '19h00'}),
          newMatch({id: s2, phase: 'semi', title: 'Semifinal 2', slotH: '1B', slotA: '2A', date: ko, time: '20h00'}),
          newMatch({id: id(), phase: 'terceiro', title: 'Disputa de 3º lugar', slotH: 'P:' + s1, slotA: 'P:' + s2, date: addDays(ko, 7), time: '18h30'}),
          newMatch({id: id(), phase: 'final', title: 'Final', slotH: 'V:' + s1, slotA: 'V:' + s2, date: addDays(ko, 7), time: '20h00'}))
  return ms
}

/* ---------- sorteio auditável ---------- */
// ponytail: PRNG usa só os 32 primeiros bits da semente; suficiente para poucas equipes, trocar por HMAC-DRBG se crescer
function rng(hex) {
  let a = parseInt(hex.slice(0, 8), 16) >>> 0
  return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}
function shuffle(arr, r) { arr = [...arr]; for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]] } return arr }
// Mesma semente + mesmas equipes = mesmo resultado. Cabeças de chave (pote 1) são distribuídos primeiro, alternando A/B.
function drawGroups(teams, seed) {
  const r = rng(seed), sorted = [...teams].sort((a, b) => a.name.localeCompare(b.name))
  const order = [...shuffle(sorted.filter(t => t.pot === 1), r), ...shuffle(sorted.filter(t => t.pot !== 1), r)]
  const g = {A: [], B: []}
  order.forEach((t, i) => g[i % 2 ? 'B' : 'A'].push(t.id))
  return g
}
async function sha(s) {
  if (!crypto.subtle) throw new Error('Abra o arquivo direto no navegador ou por HTTPS.')
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')
}
// Conteúdo que o código de autenticidade da súmula protege
const sumulaPayload = (c, m) => JSON.stringify([c.id, m.id, m.home, m.away, score(m), m.pen, m.wo, m.events.map(e => [e.type, e.team, e.player, e.min, e.half]), m.notes])
const fmtCode = h => h ? h.slice(0, 12).toUpperCase().match(/.{4}/g).join('-') : ''

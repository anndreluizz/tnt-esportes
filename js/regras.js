// Regras do campeonato. Só lógica, sem tela: tudo recebe o campeonato (c) como parâmetro.

const SPORTS = {
  'Futsal':           {half: 20, fouls: 5},
  'Futebol society':  {half: 25, fouls: null},
  'Futebol de campo': {half: 45, fouls: null},
}
const POSICOES = {
  'Futsal':           ['Goleiro', 'Fixo', 'Ala', 'Pivô'],
  'Futebol society':  ['Goleiro', 'Zagueiro', 'Lateral', 'Meio-campo', 'Atacante'],
  'Futebol de campo': ['Goleiro', 'Zagueiro', 'Lateral', 'Volante', 'Meia', 'Atacante'],
}
const PHASES = {grupos: 'Fase de grupos', oitavas: 'Oitavas de final', quartas: 'Quartas de final', semi: 'Semifinal', terceiro: 'Disputa de 3º lugar', final: 'Final'}
const KO_ORDER = ['oitavas', 'quartas', 'semi', 'terceiro', 'final']

/* ---------- formato e regras de cada campeonato (o que não for escolhido usa o padrão da modalidade) ---------- */
const FORMATOS = {
  grupos: {nome: 'Grupos + mata-mata', desc: 'Grupos de todos contra todos. Os 2 melhores de cada grupo vão para o mata-mata.'},
  pontos: {nome: 'Pontos corridos', desc: 'Todos contra todos. Campeão é quem somar mais pontos.'},
  mata:   {nome: 'Mata-mata', desc: 'Eliminatória desde o primeiro jogo: quem perde está fora.'},
}
const regrasPadrao = sport => { const s = SPORTS[sport] || SPORTS.Futsal
  return {tempo: s.half, vitoria: 3, empate: 1, amarelos: 3, vermelho: 1, wo: 3, faltas: s.fouls, grupos: 2, returno: false, terceiro: true, inscricao_rodada: null, desempate: ['vitorias', 'saldo', 'gols']} }
// critérios de desempate (depois dos pontos), na ordem escolhida; no fim, ordem alfabética
const CRITERIOS = {confronto: 'Confronto direto', vitorias: 'Mais vitórias', saldo: 'Melhor saldo de gols', gols: 'Mais gols marcados'}
const regras = c => ({...regrasPadrao(c.sport), ...c.rules})
const formato = c => c.format || 'grupos'
const groupsOf = c => [...new Set(c.teams.map(t => t.group).filter(Boolean))].sort()
const minTeams = c => formato(c) === 'grupos' ? regras(c).grupos * 2 : 3
const maxTeams = c => formato(c) === 'mata' ? 16 : 40
const allDone = c => c.matches.length > 0 && c.matches.every(isDone)
// novos atletas pelo link ou pela equipe (a Secretaria sempre pode): prazo e "até o fim da rodada X"
function inscricaoAberta(c) {
  const r = regras(c), hoje = new Date().toLocaleDateString('sv', {timeZone: 'America/Manaus'})
  if (c.status === 'encerrado' || (c.regUntil && c.regUntil < hoje)) return false
  return !r.inscricao_rodada || c.status === 'inscricoes' || c.matches.some(m => m.phase === 'grupos' && !isDone(m) && m.round <= r.inscricao_rodada)
}
const TIMES = ['19h00', '20h00', '21h00', '18h00']

const isDone = m => m.status === 'encerrado'
const byDate = (a, b) => (a.date + a.time).localeCompare(b.date + b.time) || a.id.localeCompare(b.id, undefined, {numeric: true})
const T = (c, id) => c.teams.find(t => t.id === id)
const P = (c, id) => c.players.find(p => p.id === id) || {name: '(atleta removido)', num: 0, team: ''}
const findMatch = (c, id) => c.matches.find(m => m.id === id)

function goals(m) { return [m.home, m.away].map(t => m.events.filter(e => e.type === 'gol' && e.team === t).length) }
function score(m) { const w = m.woGoals ?? 3; return m.wo ? (m.wo === m.home ? [0, w] : [w, 0]) : goals(m) }
function winner(m) {
  if (!isDone(m)) return null
  const [h, a] = score(m)
  if (h !== a) return h > a ? m.home : m.away
  return m.pen ? (m.pen[0] > m.pen[1] ? m.home : m.away) : null
}
function loser(m) { const w = winner(m); return w && (w === m.home ? m.away : m.home) }
function champion(c) {   // pontos corridos: o 1º quando todos os jogos acabam; senão, quem vence a final
  if (formato(c) === 'pontos') return allDone(c) ? standings(c, 'A')[0]?.t.id ?? null : null
  const f = c.matches.find(m => m.phase === 'final'); return f ? winner(f) : null
}
// pódio: [campeão, vice, 3º]
function podium(c) {
  if (formato(c) === 'pontos') { const s = allDone(c) ? standings(c, 'A') : []; return [0, 1, 2].map(i => s[i]?.t.id ?? null) }
  const f = c.matches.find(m => m.phase === 'final'), t = c.matches.find(m => m.phase === 'terceiro')
  return [f && winner(f), f && loser(f), t ? winner(t) : null]
}

/* ---------- inscrição ---------- */
function ageAt(birth, ref) {
  const [y, mo, d] = birth.split('-').map(Number), [ry, rm, rd] = ref.split('-').map(Number)
  return ry - y - (rm < mo || (rm === mo && rd < d) ? 1 : 0)
}
function insc(c, p) {
  if (!p.birth) return ['aprovado', '']   // modo oficial sem login: o banco só manda atletas aprovados, sem nascimento
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
  const r0 = regras(c), crits = r0.desempate
  rows.forEach(x => { x.P = x.V * r0.vitoria + x.E * r0.empate; x.SG = x.GP - x.GC; x.CD = 0 })
  // confronto direto: pontos ganhos só nos jogos entre equipes empatadas em pontos (com 2 empatadas, é o jogo entre elas)
  for (const m of c.matches) if (m.phase === 'grupos' && m.group === g && isDone(m)) {
    const H = r(m.home), A = r(m.away), [h, a] = score(m)
    if (H.P === A.P) { H.CD += h > a ? r0.vitoria : h === a ? r0.empate : 0; A.CD += a > h ? r0.vitoria : h === a ? r0.empate : 0 }
  }
  const key = {confronto: x => x.CD, vitorias: x => x.V, saldo: x => x.SG, gols: x => x.GP}
  return rows.sort((a, b) => b.P - a.P || crits.reduce((d, k) => d || (key[k] ? key[k](b) - key[k](a) : 0), 0) || a.t.name.localeCompare(b.t.name))
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
    if (m.slotH) m.home = slotTeam(c, m.slotH)   // sem vaga = equipe já definida (mata-mata direto ou folga)
    if (m.slotA) m.away = slotTeam(c, m.slotA)
  }
}

/* ---------- disciplina: N amarelos ou 1 vermelho = suspenso nos jogos seguintes; um amarelo antes do limite = pendurado ---------- */
function discipline(c) {
  const susp = {}, st = {}, r0 = regras(c)
  const add = (mid, pid, why) => { (susp[mid] ??= {})[pid] = why }
  for (const p of c.players) {
    const ms = c.matches.filter(m => m.home && (m.home === p.team || m.away === p.team)).sort(byDate)
    let y = 0, pend = 0, why = null
    for (const m of ms) {
      if (pend) { add(m.id, p.id, why); pend--; continue }
      if (!isDone(m)) break
      for (const e of m.events) if (e.player === p.id) {
        if (e.type === 'vermelho') { pend = r0.vermelho; why = 'Cartão vermelho' }
        if (e.type === 'amarelo' && ++y >= r0.amarelos) { y = 0; pend = Math.max(pend, 1); why = `${r0.amarelos} cartões amarelos` }
      }
    }
    st[p.id] = {y, pendurado: y === r0.amarelos - 1}
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
// ordem das posições numa chave (1º enfrenta o último, e os melhores só se cruzam no fim): 8 → 1,8,4,5,2,7,3,6
function seedOrder(n) { let a = [1]; while (a.length < n) a = a.flatMap(s => [s, a.length * 2 + 1 - s]); return a }
const KO_QTD = {2: ['semi', 'Semifinal'], 4: ['quartas', 'Quartas de final'], 8: ['oitavas', 'Oitavas de final']}
// Grupos ímpares (A, C...) jogam aos sábados e pares (B, D...) aos domingos; mata-mata uma semana depois de cada fase.
function buildFixtures(c, groups, start) {
  const r0 = regras(c), ms = [], perDay = {}; let n = 0
  const id = () => `${c.id}-m${++n}`
  const hora = date => { const k = perDay[date] = (perDay[date] ?? -1) + 1; return k < TIMES.length ? TIMES[k] : String(21 - k).padStart(2, '0') + 'h00' }
  // mata-mata: lados = {team}, {slot} ou null (folga: passa direto para a fase seguinte)
  const chave = (lados, date) => {
    let semis = null
    while (lados.length > 1) {
      const qtd = lados.length / 2, prox = [], jogos = []
      if (qtd === 1) {
        const [a, b] = lados
        if (semis && r0.terceiro) ms.push(newMatch({id: id(), phase: 'terceiro', title: 'Disputa de 3º lugar', slotH: 'P:' + semis[0], slotA: 'P:' + semis[1], date, time: '18h30'}))
        ms.push(newMatch({id: id(), phase: 'final', title: 'Final', home: a.team ?? null, away: b.team ?? null, slotH: a.slot ?? null, slotA: b.slot ?? null, date, time: '20h00'}))
        return
      }
      const [fase, tit] = KO_QTD[qtd]
      for (let i = 0; i < qtd; i++) {
        const a = lados[2 * i], b = lados[2 * i + 1]
        if (!a || !b) { prox.push(a || b); continue }
        const mid = id(); jogos.push(mid)
        ms.push(newMatch({id: mid, phase: fase, title: `${tit} ${jogos.length}`, home: a.team ?? null, away: b.team ?? null, slotH: a.slot ?? null, slotA: b.slot ?? null, date, time: hora(date)}))
        prox.push({slot: 'V:' + mid})
      }
      semis = fase === 'semi' && jogos.length === 2 ? jogos : null
      lados = prox; date = addDays(date, 7)
    }
  }
  if (formato(c) === 'mata') {   // ordem do sorteio = cabeças de chave primeiro; quem sobra até a potência de 2 ganha folga
    const order = groups.A, size = 2 ** Math.ceil(Math.log2(Math.max(2, order.length)))
    chave(seedOrder(size).map(s => s <= order.length ? {team: order[s - 1]} : null), start)
    return ms
  }
  const gs = Object.keys(groups).sort(), rr = gs.map(g => {
    const rs = roundRobin(groups[g]); return r0.returno ? [...rs, ...rs.map(p => p.map(([a, b]) => [b, a]))] : rs })
  const R = Math.max(...rr.map(x => x.length))
  for (let k = 0; k < R; k++) gs.forEach((g, gi) => (rr[gi][k] || []).forEach(([h, a]) => {
    const date = addDays(start, k * 7 + gi % 2)
    ms.push(newMatch({id: id(), phase: 'grupos', round: k + 1, group: g, home: h, away: a, date, time: hora(date)}))
  }))
  if (formato(c) === 'pontos') return ms
  // 2 grupos: semifinal 1ºA×2ºB e 1ºB×2ºA; 4 grupos: quartas 1ºA×2ºB, 1ºC×2ºD, 1ºB×2ºA, 1ºD×2ºC
  const cruz = gs.length === 4 ? ['1A', '2B', '1C', '2D', '1B', '2A', '1D', '2C'] : ['1A', '2B', '1B', '2A']
  chave(cruz.map(slot => ({slot})), addDays(start, R * 7))
  return ms
}

/* ---------- sorteio auditável ---------- */
// ponytail: PRNG usa só os 32 primeiros bits da semente; suficiente para poucas equipes, trocar por HMAC-DRBG se crescer
function rng(hex) {
  let a = parseInt(hex.slice(0, 8), 16) >>> 0
  return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}
function shuffle(arr, r) { arr = [...arr]; for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]] } return arr }
// Mesma semente + mesmas equipes = mesmo resultado. Cabeças de chave (pote 1) são distribuídos primeiro, um em cada grupo.
// n = número de grupos (1 = todos no grupo A: pontos corridos, ou a ordem da chave no mata-mata)
function drawGroups(teams, seed, n = 2) {
  const r = rng(seed), sorted = [...teams].sort((a, b) => a.name.localeCompare(b.name))
  const order = [...shuffle(sorted.filter(t => t.pot === 1), r), ...shuffle(sorted.filter(t => t.pot !== 1), r)]
  const g = Object.fromEntries([...'ABCDEFGH'.slice(0, n)].map(l => [l, []]))
  order.forEach((t, i) => g['ABCDEFGH'[i % n]].push(t.id))
  return g
}
const drawN = c => formato(c) === 'grupos' ? regras(c).grupos : 1
async function sha(s) {
  if (!crypto.subtle) throw new Error('Abra o arquivo direto no navegador ou por HTTPS.')
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')
}
// Conteúdo que o código de autenticidade da súmula protege
const sumulaPayload = (c, m) => JSON.stringify([c.id, m.id, m.home, m.away, score(m), m.pen, m.wo, m.events.map(e => [e.type, e.team, e.player, e.min, e.half]), m.notes])
const fmtCode = h => h ? h.slice(0, 12).toUpperCase().match(/.{4}/g).join('-') : ''

/* ---------- imagens: reduz no próprio celular antes de enviar (internet fraca) ---------- */
// square = recorta quadrado (foto de rosto); senão mantém a proporção (documento, logo)
async function fitImage(file, max, type = 'image/jpeg', square = false) {
  if (!file || !file.size) return null
  if (!file.type.startsWith('image/') || file.size > 15e6) throw new Error('foto')
  const img = await createImageBitmap(file)
  const k = square ? Math.max(max / img.width, max / img.height) : Math.min(1, max / Math.max(img.width, img.height))
  const w = square ? max : Math.round(img.width * k), h = square ? max : Math.round(img.height * k), cv = document.createElement('canvas')
  cv.width = w; cv.height = h
  cv.getContext('2d').drawImage(img, (w - img.width * k) / 2, (h - img.height * k) / 2, img.width * k, img.height * k)
  return new Promise(r => cv.toBlob(r, type, .82))
}

/* ---------- formulário: envio de imagem com prévia (usado no app e na página do link) ---------- */
const CAMERA = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>'
function upload(name, title, o = {}) {   // o: {atual: url da imagem já salva, capture, required, dica}
  const at = o.atual && String(o.atual).replace(/"/g, '&quot;')
  return `<label>${title}<span class="upload${at ? ' tem' : ''}"><input name="${name}" type="file" accept="image/*"${o.capture ? ` capture="${o.capture}"` : ''}${o.required ? ' required' : ''}>
    <img ${at ? `src="${at}"` : 'hidden'} alt="">${at ? '' : CAMERA}<b>${at ? 'Toque para trocar' : 'Toque para enviar'}</b>${o.dica ? `<span class="sub">${o.dica}</span>` : ''}</span></label>`
}
if (typeof document !== 'undefined') document.addEventListener('change', e => {   // mostra a imagem escolhida na hora
  const box = e.target.type === 'file' && e.target.closest?.('.upload'), f = box && e.target.files[0]
  if (!f) return
  const im = box.querySelector('img'); im.src = URL.createObjectURL(f); im.hidden = false
  box.querySelector('svg')?.remove(); box.querySelector('b').textContent = 'Toque para trocar'; box.classList.add('tem')
})

// formulário do campeonato -> {format, rules}; atual = campeonato sendo editado (formato travado depois do sorteio)
function lerRegras(d, sport, atual) {
  const p = regrasPadrao(sport), base = atual ? regras(atual) : p
  const n = (k, min, max) => { const v = parseInt(d['r_' + k]); return v >= min && v <= max ? v : base[k] }
  const trava = atual && !d.format   // campos de estrutura vêm desabilitados: mantém os atuais
  return {format: trava ? formato(atual) : FORMATOS[d.format] ? d.format : 'grupos',
    rules: {tempo: n('tempo', 5, 60), vitoria: n('vitoria', 1, 5), empate: n('empate', 0, 3), amarelos: n('amarelos', 2, 5), vermelho: n('vermelho', 1, 5),
      wo: n('wo', 1, 10), faltas: d.r_faltas === '' ? null : n('faltas', 3, 10),
      grupos: trava ? base.grupos : d.r_grupos === '4' ? 4 : 2, returno: trava ? base.returno : !!d.r_returno, terceiro: trava ? base.terceiro : !!d.r_terceiro,
      inscricao_rodada: d.r_inscricao_rodada === '' ? null : n('inscricao_rodada', 1, 60),
      desempate: [1, 2, 3, 4].map(i => d['r_d' + i]).some(x => x !== undefined)
        ? [...new Set([1, 2, 3, 4].map(i => d['r_d' + i]).filter(k => CRITERIOS[k]))] : base.desempate}}
}

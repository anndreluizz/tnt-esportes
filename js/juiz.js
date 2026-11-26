// Página do juiz (juiz.html?t=<link do juiz>): lança placar e pênaltis direto, sem conta. O banco confere o link (funções esc_juiz_*).
// Duas telas: lista de jogos e a mesa de UM jogo (relógio, placar por lance, pênaltis só se empatar). O resultado vai pelo botão Salvar.
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {auth: {persistSession: false}})
const token = new URLSearchParams(location.search).get('t') || ''
const $ = s => document.querySelector(s)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]))
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 4500) }
const MSG = {'check': 'Resultado inválido: pênaltis só quando o placar empata, e nunca empatados.', 'link invalido': 'Link inválido.'}
const erroAmigavel = m => Object.entries(MSG).find(([k]) => m.includes(k))?.[1] || (/fetch/i.test(m) ? 'Sem internet. Tente de novo.' : m)
const ORDEM = ['oitavas', 'quartas', 'semifinal', 'final']
const q = async p => { const r = await p; if (r.error) throw new Error(r.error.message); return r.data }

let D = null, filtro = '', aberto = null
const aviso = msg => { $('#app').innerHTML = `<div class="card empty">${esc(msg)}</div>` }

async function carregar() {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return aviso('Link inválido. Peça o link certo à Secretaria de Esportes.')
  const cid = await q(sb.rpc('esc_juiz_valido', {p_token: token}))
  if (!cid) return aviso('Link inválido. Peça o link certo à Secretaria de Esportes.')
  const [c, mod, turmas, times, juizes] = await Promise.all([
    q(sb.from('esc_campeonatos').select('nome').eq('id', cid).single()), q(sb.from('esc_modalidades').select('id,nome').eq('campeonato_id', cid)),
    q(sb.from('esc_turmas').select('id,nome').eq('campeonato_id', cid)), q(sb.from('esc_times').select('id,nome').eq('campeonato_id', cid)), q(sb.from('esc_juizes').select('id,nome').eq('campeonato_id', cid))])
  const partidas = turmas.length ? await q(sb.from('esc_partidas').select('*').in('turma_id', turmas.map(t => t.id))) : []
  D = {c, mod, turmas, times, juizes, partidas}
  render()
}

const nome = (l, id) => l.find(x => x.id === id)?.nome || '?'
// Controle de penaltis (futsal): 3 cobrancas por time, depois morte subita (rodadas de 2). Fica na tela ate salvar; o banco guarda so o total.
const PEN = {}   // partida -> ['g' gol | 'x' erro | null] na ordem: A1, B1, A2, B2, ...
const penTotais = k => { const s = PEN[k] || []; let a = 0, b = 0; s.forEach((v, i) => { if (v === 'g') { if (i % 2) b++; else a++ } }); return {a, b} }
function penSlots(k) {   // quantas cobrancas mostrar: 6 no minimo; mais uma rodada se estiver empatado
  const n = (PEN[k] || []).length, t = penTotais(k)
  if (n < 6) return 6
  if (n % 2) return n + 1
  return t.a === t.b ? n + 2 : n
}
function penHtml(p) {
  const mod = D.mod.find(m => m.id === p.modalidade_id)?.nome
  if (mod === 'Queimada') return '<p class="sub penbox">Queimada: empatou? Joguem mais 5 minutos (botão "+5 min" no relógio) e lancem o placar final. Sem pênaltis.</p>'
  const k = p.id, s = PEN[k] || [], usa = s.length > 0
  const t = usa ? penTotais(k) : {a: p.penaltis_a ?? 0, b: p.penaltis_b ?? 0}
  const sl = usa ? penSlots(k) : 6
  const cel = i => { const v = s[i] ?? null
    return `<button type="button" class="penc ${v === 'g' ? 'g' : v === 'x' ? 'x' : ''}" data-pen="${esc(k)}" data-i="${i}" aria-label="Cobrança ${i + 1}">${v === 'g' ? '⚽' : v === 'x' ? '✗' : '·'}</button>` }
  const linha = par => `<div class="penrow"><span class="penlado">${esc(nome(D.times, par ? p.time_b_id : p.time_a_id))}</span>${Array.from({length: sl}, (_, i) => i).filter(i => i % 2 === par).map(cel).join('')}</div>`
  return `<div class="penbox"><div class="sub">Empatou: pênaltis · 3 cobranças cada, depois morte súbita</div>${linha(0)}${linha(1)}
    <div class="penres"><b>${t.a} x ${t.b}</b>${usa ? `<button type="button" class="btn ghost sm" data-penreset="${esc(k)}">Limpar cobranças</button>` : ''}</div>
    <input type="hidden" name="ea" value="${usa || p.penaltis_a != null ? t.a : ''}"><input type="hidden" name="eb" value="${usa || p.penaltis_b != null ? t.b : ''}"></div>`
}
const refazPen = k => { const p = D.partidas.find(x => x.id === k), el = document.querySelector(`form.mesa-jogo[data-id="${k}"] .penbox`); if (p && el) el.outerHTML = penHtml(p) }

// Estado da sumula de cada jogo: relogio, placar, faltas, cartoes e lances. Fica na tela; so o placar final vai ao banco.
const SUM = {}
const sumDe = p => SUM[p.id] || (SUM[p.id] = {pts: {a: p.placar_a ?? 0, b: p.placar_b ?? 0}, faltas: {a: 0, b: 0}, am: {a: 0, b: 0}, vm: {a: 0, b: 0}, log: [], seg: 600, periodo: 1, rodando: false, tocou: false})
const ehQueimada = p => D.mod.find(m => m.id === p.modalidade_id)?.nome === 'Queimada'
const mmss = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
const empatado = p => { const s = sumDe(p); return (s.tocou || p.placar_a != null) && s.pts.a === s.pts.b }
const dataHora = p => p.data ? `${p.data.slice(8)}/${p.data.slice(5, 7)} ${p.hora.slice(0, 5)} · Quadra ${p.quadra}` : ''
const titulo = p => `${esc(nome(D.mod, p.modalidade_id))} ${p.genero} · ${esc(nome(D.turmas, p.turma_id))}`

function mesaHtml(p) {
  const s = sumDe(p), k = esc(p.id), qm = ehQueimada(p), cb = p.colete_a === 'azul' ? 'vermelho' : 'azul'
  const b = (acao, lado, txt, cls = '') => `<button type="button" class="sumbtn ${cls}" data-sum="${k}" data-acao="${acao}" data-lado="${lado}">${txt}</button>`
  const lado = (l, id, cor) => `<div class="mlado ${cor}"><i class="mbar"></i><div class="mnome">${esc(nome(D.times, id))}</div><div class="msub">colete ${cor}</div>
    <div class="mpts" aria-live="polite">${s.pts[l]}</div><div class="mbtns">${b('golmenos', l, '−', 'ghost mmenos')}${b(qm ? 'elim' : 'gol', l, qm ? '+ Eliminação' : '+ Gol', 'mmais')}</div></div>`
  const lances = lado => qm ? '' : `<div class="mlances"><b>${esc(nome(D.times, lado === 'a' ? p.time_a_id : p.time_b_id))}</b><div class="sumbtns">${b('falta', lado, `Falta (${s.faltas[lado]})`, 'ghost')}${b('amarelo', lado, `Amarelo (${s.am[lado]})`, 'ghost')}${b('vermelho', lado, `Vermelho (${s.vm[lado]})`, 'ghost')}</div></div>`
  const log = s.log.slice(-6).reverse().map(e => `<li>${esc(e.txt)}</li>`).join('') || '<li class="sub">Nenhum lance ainda.</li>'
  const pa = s.tocou ? s.pts.a : (p.placar_a ?? ''), pb = s.tocou ? s.pts.b : (p.placar_b ?? '')
  return `<button type="button" class="btn ghost sm noprint" data-voltar>← Todos os jogos</button>
    <form class="card mesa-jogo" data-id="${k}">
      <div class="sub">${dataHora(p) ? `<b>${dataHora(p)}</b> · ` : ''}${titulo(p)} · <span class="pill">${esc(p.fase)}</span>${p.juiz_id ? ` · Juiz: ${esc(nome(D.juizes, p.juiz_id))}` : ''}</div>
      <div class="mrelogio"><span class="sumclock" data-clock="${k}">${mmss(s.seg)}</span><small>${qm ? 'Queimada · 10 min' : s.periodo + 'º tempo de 10 min'}</small>
        <div class="sumbtns noprint">${b('tempo', '', s.rodando ? '❚❚ Pausar' : '▶ Iniciar')}${qm ? b('mais5', '', '+5 min (empate)', 'ghost') : b('prox', '', '2º tempo', 'ghost')}${b('zerar', '', 'Zerar relógio', 'ghost')}</div></div>
      <div class="mplacar">${lado('a', p.time_a_id, p.colete_a)}${lado('b', p.time_b_id, cb)}</div>
      <input type="hidden" name="pa" value="${pa}"><input type="hidden" name="pb" value="${pb}">
      ${empatado(p) ? penHtml(p) : ''}
      <details class="mais noprint"><summary>Faltas, cartões e lances</summary>${lances('a')}${lances('b')}<div class="sumbtns">${b('desfazer', '', 'Desfazer último lance', 'ghost')}</div></details>
      <ol class="sumlog">${log}</ol>
      <button class="btn block noprint">${p.placar_a == null ? 'Salvar resultado' : 'Corrigir resultado'}</button>
      <button type="button" class="btn ghost block noprint" data-imprimir>Imprimir súmula</button>
    </form>`
}

function sumAcao(k, acao, lado) {
  const p = D.partidas.find(x => x.id === k); if (!p) return
  const s = sumDe(p), N = nome(D.times, lado === 'a' ? p.time_a_id : p.time_b_id), qm = ehQueimada(p), gol = qm ? 'Eliminação' : 'Gol'
  const lance = (txt, undo = null) => s.log.push({txt: `${mmss(s.seg)} · ${txt}`, undo})
  if (acao === 'tempo') { s.rodando = !s.rodando; s.tocou = true }
  else if (acao === 'zerar') { s.seg = 600; s.rodando = false }
  else if (acao === 'prox') { s.periodo = 2; s.seg = 600; s.rodando = false; lance('Início do 2º tempo') }
  else if (acao === 'mais5') { s.seg += 300; s.rodando = true; lance('Prorrogação +5 min (empate)') }
  else if (acao === 'gol' || acao === 'elim') { s.tocou = true; s.pts[lado]++; lance(`${gol} · ${N}`, () => { s.pts[lado]-- }) }
  else if (acao === 'golmenos') { s.tocou = true; if (s.pts[lado] > 0) { s.pts[lado]--; lance(`${gol} anulado(a) · ${N}`, () => { s.pts[lado]++ }) } }
  else if (acao === 'falta') { s.faltas[lado]++; lance(`Falta · ${N}`, () => { s.faltas[lado]-- }) }
  else if (acao === 'amarelo') { s.am[lado]++; lance(`Cartão amarelo · ${N}`, () => { s.am[lado]-- }) }
  else if (acao === 'vermelho') { s.vm[lado]++; lance(`Cartão vermelho · ${N}`, () => { s.vm[lado]-- }) }
  else if (acao === 'desfazer') { const e = s.log.pop(); e?.undo?.() }
  const aberta = document.querySelector('details.mais')?.open
  render(); if (aberta) { const d = document.querySelector('details.mais'); if (d) d.open = true }
}
// relogio: conta so os jogos com cronometro rodando
setInterval(() => {
  for (const k of Object.keys(SUM)) { const s = SUM[k]; if (!s.rodando) continue
    s.seg = Math.max(0, s.seg - 1); const c = document.querySelector(`[data-clock="${k}"]`); if (c) c.textContent = mmss(s.seg)
    if (s.seg === 0) { s.rodando = false; s.log.push({txt: `${mmss(0)} · Fim do tempo`, undo: null}); if (aberto === k) render() }
  }
}, 1000)

function listaHtml() {
  const lista = D.partidas.filter(p => !filtro || p.modalidade_id === filtro)
    .sort((x, y) => (x.placar_a == null ? 0 : 1) - (y.placar_a == null ? 0 : 1) || (x.data ? x.data + x.hora : '9').localeCompare(y.data ? y.data + y.hora : '9') || ORDEM.indexOf(x.fase) - ORDEM.indexOf(y.fase) || nome(D.turmas, x.turma_id).localeCompare(nome(D.turmas, y.turma_id), 'pt', {numeric: true}))
  const card = p => { const cb = p.colete_a === 'azul' ? 'vermelho' : 'azul', feito = p.placar_a != null, ao = SUM[p.id]?.rodando
    const sit = ao ? '<span class="pill amber">● ao vivo</span>' : p.vencedor_id ? `<span class="pill green">${p.placar_a} x ${p.placar_b}${p.penaltis_a != null ? ` (pên. ${p.penaltis_a} x ${p.penaltis_b})` : ''} · vence ${esc(nome(D.times, p.vencedor_id))}</span>` : feito ? `<span class="pill amber">${p.placar_a} x ${p.placar_b} · falta pênaltis</span>` : '<span class="pill">A jogar</span>'
    return `<button type="button" class="card jcard" data-abrir="${esc(p.id)}"><div class="sub">${dataHora(p) ? `<b>${dataHora(p)}</b> · ` : ''}${titulo(p)} · <span class="pill">${esc(p.fase)}</span></div>
      <div class="jvs"><span class="jt ${p.colete_a}">${esc(nome(D.times, p.time_a_id))}</span><span class="jx">×</span><span class="jt ${cb}">${esc(nome(D.times, p.time_b_id))}</span></div>
      <div class="jfim">${sit}<span class="jgo">${feito ? 'Corrigir' : 'Abrir súmula'} →</span></div></button>` }
  return `<div class="hero"><div><div class="eyebrow">Mesa do juiz</div><h2>${esc(D.c.nome)}</h2></div></div>
    <div class="btns chips"><button class="btn ${filtro ? 'ghost' : ''}" data-f="">Todas</button>${D.mod.map(m => `<button class="btn ${filtro === m.id ? '' : 'ghost'}" data-f="${m.id}">${esc(m.nome)}</button>`).join('')}</div>
    ${lista.map(card).join('') || '<div class="card empty">Nenhum jogo sorteado ainda. A Secretaria precisa sortear os jogos.</div>'}`
}

function render() {
  const p = aberto && D.partidas.find(x => x.id === aberto)
  $('#app').innerHTML = p ? mesaHtml(p) : listaHtml()
}
function abrir(id) { aberto = id; render(); if (typeof scrollTo === 'function') scrollTo(0, 0) }

document.addEventListener('click', e => {
  const sm = e.target.closest('[data-sum]'); if (sm) return sumAcao(sm.dataset.sum, sm.dataset.acao, sm.dataset.lado)
  const ab = e.target.closest('[data-abrir]'); if (ab) return abrir(ab.dataset.abrir)
  if (e.target.closest('[data-voltar]')) { aberto = null; render(); return typeof scrollTo === 'function' && scrollTo(0, 0) }
  if (e.target.closest('[data-imprimir]')) return print()
  const b = e.target.closest('[data-f]'); if (b) { filtro = b.dataset.f; return render() }
  const c = e.target.closest('[data-pen]')
  if (c) { const k = c.dataset.pen, i = +c.dataset.i, s = PEN[k] || (PEN[k] = []), atual = s[i] ?? null; s[i] = atual === null ? 'g' : atual === 'g' ? 'x' : null; return refazPen(k) }
  const r = e.target.closest('[data-penreset]'); if (r) { delete PEN[r.dataset.penreset]; refazPen(r.dataset.penreset) }
})
document.addEventListener('submit', async e => {
  const f = e.target.closest('form.mesa-jogo'); if (!f) return
  e.preventDefault()
  const n = v => v == null || v === '' ? null : +v, v = Object.fromEntries(new FormData(f))
  if (n(v.pa) == null || n(v.pb) == null) return toast('Lance o placar antes de salvar.')
  if (n(v.pa) !== n(v.pb)) { v.ea = ''; v.eb = '' }   // pênaltis só valem em empate
  if (n(v.pa) === n(v.pb) && (n(v.ea) == null) !== (n(v.eb) == null)) return toast('Preencha os pênaltis dos dois times.')
  if (n(v.pa) === n(v.pb) && n(v.ea) === n(v.eb) && n(v.ea) != null) return toast('Pênaltis empatados: faça mais uma cobrança (morte súbita).')
  const {error} = await sb.rpc('esc_juiz_placar', {p_token: token, p_partida: f.dataset.id, p_pa: n(v.pa), p_pb: n(v.pb), p_ea: n(v.ea), p_eb: n(v.eb)})
  if (error) return toast(erroAmigavel(error.message))
  toast('Resultado salvo.'); aberto = null; await carregar()
})

carregar().catch(err => aviso(`Não foi possível carregar (${err.message}). Confira a internet.`))

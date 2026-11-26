// Página do juiz (juiz.html?t=<link do juiz>): lança placar e pênaltis direto, sem conta. O banco confere o link (funções esc_juiz_*).
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {auth: {persistSession: false}})
const token = new URLSearchParams(location.search).get('t') || ''
const $ = s => document.querySelector(s)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]))
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 4500) }
const MSG = {'check': 'Resultado inválido: pênaltis só quando o placar empata, e nunca empatados.', 'link invalido': 'Link inválido.'}
const erroAmigavel = m => Object.entries(MSG).find(([k]) => m.includes(k))?.[1] || (/fetch/i.test(m) ? 'Sem internet. Tente de novo.' : m)
const ORDEM = ['oitavas', 'quartas', 'semifinal', 'final']
const q = async p => { const r = await p; if (r.error) throw new Error(r.error.message); return r.data }

let D = null, filtro = ''
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
  if (mod === 'Queimada') return '<p class="sub penbox">Queimada: se empatar, joguem mais 5 minutos e lancem o placar final. Sem pênaltis.</p>'
  const k = p.id, s = PEN[k] || [], usa = s.length > 0
  const t = usa ? penTotais(k) : {a: p.penaltis_a ?? 0, b: p.penaltis_b ?? 0}
  const sl = usa ? penSlots(k) : 6
  const cel = i => { const v = s[i] ?? null
    return `<button type="button" class="penc ${v === 'g' ? 'g' : v === 'x' ? 'x' : ''}" data-pen="${esc(k)}" data-i="${i}" aria-label="Cobrança ${i + 1}">${v === 'g' ? '⚽' : v === 'x' ? '✗' : '·'}</button>` }
  const linha = par => `<div class="penrow"><span class="penlado">${esc(nome(D.times, par ? p.time_b_id : p.time_a_id))}</span>${Array.from({length: sl}, (_, i) => i).filter(i => i % 2 === par).map(cel).join('')}</div>`
  return `<div class="penbox"><div class="sub">Pênaltis · 3 cobranças cada, depois morte súbita</div>${linha(0)}${linha(1)}
    <div class="penres"><b>${t.a} x ${t.b}</b>${usa ? `<button type="button" class="btn ghost sm" data-penreset="${esc(k)}">Limpar cobranças</button>` : ''}</div>
    <input type="hidden" name="ea" value="${usa || p.penaltis_a != null ? t.a : ''}"><input type="hidden" name="eb" value="${usa || p.penaltis_b != null ? t.b : ''}"></div>`
}
const refazPen = k => { const p = D.partidas.find(x => x.id === k), el = document.querySelector(`form.jogo[data-id="${k}"] .penbox`); if (p && el) el.outerHTML = penHtml(p) }

function render() {
  const nome = (l, id) => l.find(x => x.id === id)?.nome || '?'
  const lista = D.partidas.filter(p => !filtro || p.modalidade_id === filtro)
    .sort((x, y) => (x.placar_a == null ? 0 : 1) - (y.placar_a == null ? 0 : 1) || (x.data ? x.data + x.hora : '9').localeCompare(y.data ? y.data + y.hora : '9') || ORDEM.indexOf(x.fase) - ORDEM.indexOf(y.fase) || nome(D.turmas, x.turma_id).localeCompare(nome(D.turmas, y.turma_id), 'pt', {numeric: true}))
  const jogo = p => { const cb = p.colete_a === 'azul' ? 'vermelho' : 'azul', lado = (id, cor) => `<b>${esc(nome(D.times, id))}</b> <span class="pill ${cor === 'azul' ? 'blue' : 'red'}">${cor}</span>`
    return `<form class="card jogo" data-id="${p.id}"><div class="sub">${p.data ? `<b>${p.data.slice(8)}/${p.data.slice(5, 7)} ${p.hora.slice(0, 5)} · Quadra ${p.quadra}</b> · ` : ''}${esc(nome(D.mod, p.modalidade_id))} ${p.genero} · ${esc(nome(D.turmas, p.turma_id))} · <span class="pill">${esc(p.fase)}</span>${p.juiz_id ? ` · Juiz: ${esc(nome(D.juizes, p.juiz_id))}` : ''}${p.vencedor_id ? ` <span class="pill green">vence ${esc(nome(D.times, p.vencedor_id))}</span>` : p.placar_a != null ? ' <span class="pill amber">empate: falta pênaltis</span>' : ''}</div>
      <div class="vs"><div>${lado(p.time_a_id, p.colete_a)}<input name="pa" type="number" inputmode="numeric" min="0" value="${p.placar_a ?? ''}" aria-label="Gols do primeiro time"></div>
        <div>${lado(p.time_b_id, cb)}<input name="pb" type="number" inputmode="numeric" min="0" value="${p.placar_b ?? ''}" aria-label="Gols do segundo time"></div></div>
      ${penHtml(p)}
      <button class="btn block">${p.placar_a == null ? 'Salvar resultado' : 'Corrigir resultado'}</button></form>` }
  $('#app').innerHTML = `<div class="hero"><div><div class="eyebrow">Mesa do juiz</div><h2>${esc(D.c.nome)}</h2></div></div>
    <div class="btns chips"><button class="btn ${filtro ? 'ghost' : ''}" data-f="">Todas</button>${D.mod.map(m => `<button class="btn ${filtro === m.id ? '' : 'ghost'}" data-f="${m.id}">${esc(m.nome)}</button>`).join('')}</div>
    ${lista.map(jogo).join('') || '<div class="card empty">Nenhum jogo sorteado ainda. A Secretaria precisa sortear os jogos.</div>'}`
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-f]'); if (b) { filtro = b.dataset.f; return render() }
  const c = e.target.closest('[data-pen]')
  if (c) { const k = c.dataset.pen, i = +c.dataset.i, s = PEN[k] || (PEN[k] = []), atual = s[i] ?? null; s[i] = atual === null ? 'g' : atual === 'g' ? 'x' : null; return refazPen(k) }
  const r = e.target.closest('[data-penreset]'); if (r) { delete PEN[r.dataset.penreset]; refazPen(r.dataset.penreset) }
})
document.addEventListener('submit', async e => {
  const f = e.target.closest('form.jogo'); if (!f) return
  e.preventDefault()
  const n = v => v === '' ? null : +v, v = Object.fromEntries(new FormData(f))
  if ((n(v.pa) == null) !== (n(v.pb) == null)) return toast('Preencha os gols dos dois times.')
  if (n(v.pa) !== n(v.pb)) { v.ea = ''; v.eb = '' }   // pênaltis só valem em empate
  if (n(v.pa) != null && n(v.pa) === n(v.pb) && (n(v.ea) == null) !== (n(v.eb) == null)) return toast('Preencha os pênaltis dos dois times.')
  if (n(v.pa) != null && n(v.pa) === n(v.pb) && n(v.ea) === n(v.eb) && n(v.ea) != null) return toast('Pênaltis empatados: faça mais uma cobrança (morte súbita).')
  const {error} = await sb.rpc('esc_juiz_placar', {p_token: token, p_partida: f.dataset.id, p_pa: n(v.pa), p_pb: n(v.pb), p_ea: n(v.ea), p_eb: n(v.eb)})
  if (error) return toast(erroAmigavel(error.message))
  toast('Resultado salvo.'); await carregar()
})

carregar().catch(err => aviso(`Não foi possível carregar (${err.message}). Confira a internet.`))

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

function render() {
  const nome = (l, id) => l.find(x => x.id === id)?.nome || '?'
  const lista = D.partidas.filter(p => !filtro || p.modalidade_id === filtro)
    .sort((x, y) => (x.placar_a == null ? 0 : 1) - (y.placar_a == null ? 0 : 1) || (x.data ? x.data + x.hora : '9').localeCompare(y.data ? y.data + y.hora : '9') || ORDEM.indexOf(x.fase) - ORDEM.indexOf(y.fase) || nome(D.turmas, x.turma_id).localeCompare(nome(D.turmas, y.turma_id), 'pt', {numeric: true}))
  const jogo = p => { const cb = p.colete_a === 'azul' ? 'vermelho' : 'azul', lado = (id, cor) => `<b>${esc(nome(D.times, id))}</b> <span class="pill ${cor === 'azul' ? 'blue' : 'red'}">${cor}</span>`
    return `<form class="card jogo" data-id="${p.id}"><div class="sub">${p.data ? `<b>${p.data.slice(8)}/${p.data.slice(5, 7)} ${p.hora.slice(0, 5)} · Quadra ${p.quadra}</b> · ` : ''}${esc(nome(D.mod, p.modalidade_id))} ${p.genero} · ${esc(nome(D.turmas, p.turma_id))} · <span class="pill">${esc(p.fase)}</span>${p.juiz_id ? ` · Juiz: ${esc(nome(D.juizes, p.juiz_id))}` : ''}${p.vencedor_id ? ` <span class="pill green">vence ${esc(nome(D.times, p.vencedor_id))}</span>` : p.placar_a != null ? ' <span class="pill amber">empate: falta pênaltis</span>' : ''}</div>
      <div class="vs"><div>${lado(p.time_a_id, p.colete_a)}<input name="pa" type="number" inputmode="numeric" min="0" value="${p.placar_a ?? ''}" aria-label="Gols do primeiro time"></div>
        <div>${lado(p.time_b_id, cb)}<input name="pb" type="number" inputmode="numeric" min="0" value="${p.placar_b ?? ''}" aria-label="Gols do segundo time"></div></div>
      <div class="pen"><span class="sub">Pênaltis (só se empatar)</span><input name="ea" type="number" inputmode="numeric" min="0" value="${p.penaltis_a ?? ''}" aria-label="Pênaltis do primeiro time"><input name="eb" type="number" inputmode="numeric" min="0" value="${p.penaltis_b ?? ''}" aria-label="Pênaltis do segundo time"></div>
      <button class="btn block">${p.placar_a == null ? 'Salvar resultado' : 'Corrigir resultado'}</button></form>` }
  $('#app').innerHTML = `<div class="hero"><div><div class="eyebrow">Mesa do juiz</div><h2>${esc(D.c.nome)}</h2></div></div>
    <div class="btns chips"><button class="btn ${filtro ? 'ghost' : ''}" data-f="">Todas</button>${D.mod.map(m => `<button class="btn ${filtro === m.id ? '' : 'ghost'}" data-f="${m.id}">${esc(m.nome)}</button>`).join('')}</div>
    ${lista.map(jogo).join('') || '<div class="card empty">Nenhum jogo sorteado ainda. A Secretaria precisa sortear os jogos.</div>'}`
}

document.addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b) { filtro = b.dataset.f; render() } })
document.addEventListener('submit', async e => {
  const f = e.target.closest('form.jogo'); if (!f) return
  e.preventDefault()
  const n = v => v === '' ? null : +v, v = Object.fromEntries(new FormData(f))
  if ((n(v.pa) == null) !== (n(v.pb) == null)) return toast('Preencha os gols dos dois times.')
  if (n(v.pa) != null && n(v.pa) === n(v.pb) && (n(v.ea) == null) !== (n(v.eb) == null)) return toast('Preencha os pênaltis dos dois times.')
  const {error} = await sb.rpc('esc_juiz_placar', {p_token: token, p_partida: f.dataset.id, p_pa: n(v.pa), p_pb: n(v.pb), p_ea: n(v.ea), p_eb: n(v.eb)})
  if (error) return toast(erroAmigavel(error.message))
  toast('Resultado salvo.'); await carregar()
})

carregar().catch(err => aviso(`Não foi possível carregar (${err.message}). Confira a internet.`))

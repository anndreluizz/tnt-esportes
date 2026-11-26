// Página do professor (turma.html?t=<link da turma>[,<link de outra turma>]): organiza os times das turmas (A, B, C...; masculino e feminino; futsal e queimada) com os alunos da própria turma.
// Um professor com várias turmas recebe UM link com os links das turmas separados por vírgula. Cada turma pode ter mais de um professor responsável.
// Sem conta. O banco confere o link, as inscrições abertas e o limite do elenco (funções esc_turma_*).
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {auth: {persistSession: false}})
const tokens = [...new Set((new URLSearchParams(location.search).get('t') || '').split(',').map(s => s.trim()).filter(Boolean))]
const $ = s => document.querySelector(s)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]))
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 4500) }
const MSG = {'elenco cheio': 'O time já está completo (titulares + reservas).', 'duplicate': 'Esse aluno já está num time.', 'link invalido': 'Link inválido ou inscrições encerradas.', 'check': 'Digite o nome completo.',
  'time ja tem jogo': 'Esse time já tem jogo sorteado. Procure a Secretaria.', 'ultimo time': 'A turma precisa ter pelo menos um time.', 'sem letra': 'Não há mais letras livres para novos times.'}
const erroAmigavel = m => Object.entries(MSG).find(([k]) => m.includes(k))?.[1] || (/fetch/i.test(m) ? 'Sem internet. Confira a conexão e tente de novo.' : m)
const MODALIDADES = ['Futsal', 'Queimada']
const MINIMO = {Futsal: 5, Queimada: 10}
const norm = s => String(s).trim().replace(/\s+/g, ' ').toLowerCase()
const abertas = new Set()
document.addEventListener('toggle', e => { const k = e.target.dataset?.k; if (k) e.target.open ? abertas.add(k) : abertas.delete(k) }, true)

let turmas = []   // uma entrada por link: {token, turma, times, jogadores, candidatos}
const aviso = msg => { $('#app').innerHTML = `<div class="card empty">${esc(msg)}</div>` }
const profsDe = t => String(t.turma.professor || '').split(' / ').filter(Boolean)

async function carregarUma(token) {
  const m = await sb.rpc('esc_turma_meu', {p_token: token})
  if (m.error) throw new Error('conexão')
  if (!m.data[0]) return null
  const [t, c] = await Promise.all([sb.rpc('esc_turma_times', {p_token: token}), sb.rpc('esc_turma_candidatos', {p_token: token})])
  const times = (t.data || []).filter(x => MODALIDADES.includes(x.modalidade_nome))
  const ids = times.map(x => x.time_id)
  const jogadores = ids.length ? (await sb.from('esc_jogadores').select('id, time_id, nome').in('time_id', ids).order('nome')).data || [] : []
  return {token, turma: m.data[0], times, jogadores, candidatos: (c.data || []).map(x => x.nome)}
}

async function carregar() {
  if (!tokens.length || tokens.some(x => !/^[0-9a-f-]{36}$/i.test(x))) return aviso('Link inválido. Peça o link certo à Secretaria de Esportes.')
  let r
  try { r = await Promise.all(tokens.map(carregarUma)) } catch { return aviso('Sem conexão. Confira a internet e abra o link de novo.') }
  if (r.some(x => !x)) return aviso('Link inválido. Peça o link certo à Secretaria de Esportes.')
  turmas = r
  if (!abertas.size) { abertas.add('T0'); const p = turmas[0].times[0]; if (p) abertas.add(p.time_id) }
  render()
}

function blocoTurma(e, i) {
  const ab = e.turma.inscricoes_abertas, {times, jogadores, candidatos} = e
  const profs = profsDe(e)
  const timeDe = new Map(jogadores.map(j => [norm(j.nome), j.time_id]))   // aluno -> time (só desta turma)
  const semTime = candidatos.filter(n => !timeDe.has(norm(n))).length
  const profHtml = `<div class="card"><h3>Professores responsáveis</h3>
      ${profs.map(p => `<div class="row"><span><b>${esc(p)}</b></span>${ab && profs.length > 1 ? `<button class="btn ghost sm" data-delprof="${i}" data-nome="${esc(p)}" aria-label="Tirar ${esc(p)}">Tirar</button>` : ''}</div>`).join('') || '<p class="sub">Nenhum professor informado ainda.</p>'}
      ${ab ? `<form class="f" data-addprof="${i}"><label class="span2">${profs.length ? 'Outro professor desta turma' : 'Seu nome completo'}<input name="prof" required minlength="3" maxlength="60" autocomplete="name"></label>
          <div class="span2"><button class="btn">${profs.length ? 'Adicionar professor' : 'Salvar meu nome'}</button></div></form>` : ''}</div>`
  const mods = MODALIDADES.map(mod => {
    const ts = times.filter(x => x.modalidade_nome === mod)
    if (!ts.length && !ab) return ''
    const ocupados = new Set(jogadores.filter(j => ts.some(x => x.time_id === j.time_id)).map(j => norm(j.nome)))
    const livres = candidatos.filter(n => !ocupados.has(norm(n)))
    const novo = ab ? `<div class="chips" style="margin:6px 0 10px"><button type="button" class="btn ghost sm" data-novo="${i}" data-mod="${mod}" data-gen="masculino">+ Novo time masculino</button><button type="button" class="btn ghost sm" data-novo="${i}" data-mod="${mod}" data-gen="feminino">+ Novo time feminino</button></div>` : ''
    return `<h3 style="margin:18px 0 6px">${esc(mod)}</h3>${novo}` + ts.map(x => {
      const js = jogadores.filter(j => j.time_id === x.time_id), cheio = js.length >= x.vagas, min = MINIMO[mod] || 0
      const sit = js.length < min ? `<span class="pill amber">faltam ${min - js.length} para o mínimo</span>` : '<span class="pill green">completo para jogar</span>'
      return `<details class="pasta" data-k="${x.time_id}"${abertas.has(x.time_id) ? ' open' : ''}><summary><b>${esc(mod)} ${esc(x.genero)} · ${esc(x.time_nome)}</b> <small>${js.length} de ${x.vagas}</small></summary><div class="pasta-corpo">
        <p>${sit}</p>
        ${js.length ? js.map(j => `<div class="row"><span>${esc(j.nome)}</span>${ab ? `<button class="btn ghost sm" data-del="${i}" data-id="${j.id}" aria-label="Remover ${esc(j.nome)}">Remover</button>` : ''}</div>`).join('') : '<p class="sub">Nenhum aluno ainda.</p>'}
        ${ab && !cheio ? (livres.length ? `<div class="grupo">Toque no nome para colocar neste time (${esc(x.genero)})</div><div class="chips">${livres.map(n => `<button type="button" class="btn ghost sm" data-add="${x.time_id}" data-tk="${i}" data-nome="${esc(n)}">+ ${esc(n)}</button>`).join('')}</div>` : '<p class="sub">Todos os alunos da turma já estão em um time.</p>') : ''}
        ${ab ? `<p style="margin-top:10px"><button type="button" class="btn ghost sm" data-exclui="${i}" data-id="${x.time_id}" data-nome="${esc(x.time_nome)}">Excluir este time</button></p>` : ''}
      </div></details>` }).join('')
  }).join('')
  const cab = `${times.length} time(s) · ${candidatos.length} alunos na turma · ${semTime} ainda sem time`
  return turmas.length === 1 ? `<div class="hero"><div><div class="eyebrow">II Jogos Escolares · professor da turma</div><h2>${esc(e.turma.origem)}</h2><div style="color:#d6e2f7;font-size:14px;margin-top:4px">${cab}</div></div></div>${profHtml}${mods}`
    : `<details class="pasta turma" data-k="T${i}"${abertas.has('T' + i) ? ' open' : ''}><summary><b>${esc(e.turma.origem)}</b> <small>${cab}</small></summary><div class="pasta-corpo">${profHtml}${mods}</div></details>`
}

function render() {
  const ab = turmas.some(e => e.turma.inscricoes_abertas)
  const topo = turmas.length > 1 ? `<div class="hero"><div><div class="eyebrow">II Jogos Escolares · professor</div><h2>Suas ${turmas.length} turmas</h2><div style="color:#d6e2f7;font-size:14px;margin-top:4px">${turmas.map(e => esc(e.turma.origem)).join(' · ')}</div></div></div>` : ''
  $('#app').innerHTML = topo
    + (ab ? '<p class="note">Você monta os times: toque no nome para colocar o aluno no time (masculino ou feminino). Pode criar um time novo ou excluir um time que não vai usar. Um aluno fica em um time só por modalidade. Os alunos escolhidos aparecem no portal público do campeonato.</p>' : '<div class="card empty">As inscrições estão encerradas. Procure a Secretaria para qualquer ajuste.</div>')
    + turmas.map(blocoTurma).join('')
}

const chamar = async (fn, args, ok) => {
  const {error} = await sb.rpc(fn, args)
  if (error) return toast(erroAmigavel(error.message))
  if (ok) toast(ok)
  await carregar()
}
const salvaProfs = (i, lista, ok) => chamar('esc_turma_definir_professor', {p_token: turmas[i].token, p_nome: lista.join(' / ')}, ok)

$('#app').addEventListener('click', e => {
  const b = e.target.closest?.('button'); if (!b) return
  const d = b.dataset, i = Number(d.tk ?? d.del ?? d.novo ?? d.exclui ?? d.delprof)
  if (d.add) return chamar('esc_turma_inscrever', {p_token: turmas[i].token, p_time: d.add, p_nome: d.nome}, `${d.nome} adicionado.`)
  if (d.del !== undefined) {
    const j = turmas[i].jogadores.find(x => x.id === d.id)
    if (!confirm(`Remover ${j?.nome || 'o aluno'} do time?`)) return
    return chamar('esc_turma_remover', {p_token: turmas[i].token, p_jogador: d.id})
  }
  if (d.novo !== undefined) return chamar('esc_turma_criar_time', {p_token: turmas[i].token, p_modalidade: d.mod, p_genero: d.gen}, 'Time criado.')
  if (d.exclui !== undefined) {
    const n = turmas[i].jogadores.filter(j => j.time_id === d.id).length
    if (!confirm(`Excluir o time ${d.nome}?${n ? ` Os ${n} aluno(s) dele voltam para a lista da turma.` : ''}`)) return
    return chamar('esc_turma_excluir_time', {p_token: turmas[i].token, p_time: d.id}, 'Time excluído.')
  }
  if (d.delprof !== undefined) return salvaProfs(i, profsDe(turmas[i]).filter(p => p !== d.nome), 'Professor retirado.')
})
$('#app').addEventListener('submit', e => {
  const i = e.target.dataset?.addprof; if (i === undefined) return
  e.preventDefault()
  const nome = e.target.prof.value.trim().replace(/\s+/g, ' ')
  if (nome.length < 3) return toast('Digite o nome completo.')
  const lista = profsDe(turmas[i])
  if (lista.some(p => norm(p) === norm(nome))) return toast('Esse professor já está na lista.')
  salvaProfs(i, [...lista, nome], 'Nome salvo.')
})

carregar().catch(err => aviso(`Não foi possível carregar (${err.message}). Confira a internet.`))

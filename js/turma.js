// Página do professor da TURMA (turma.html?t=<link da turma>): organiza os times da turma (A, B, C...; masculino e feminino) com os alunos da própria turma.
// Sem conta. O banco confere o link, as inscrições abertas e o limite do elenco (funções esc_turma_*).
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {auth: {persistSession: false}})
const token = new URLSearchParams(location.search).get('t') || ''
const $ = s => document.querySelector(s)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]))
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 4500) }
const MSG = {'elenco cheio': 'O time já está completo (titulares + reservas).', 'duplicate': 'Esse aluno já está num time.', 'link invalido': 'Link inválido ou inscrições encerradas.', 'check': 'Digite o nome completo.'}
const erroAmigavel = m => Object.entries(MSG).find(([k]) => m.includes(k))?.[1] || (/fetch/i.test(m) ? 'Sem internet. Confira a conexão e tente de novo.' : m)
const MODALIDADES = ['Futsal', 'Queimada']
const MINIMO = {Futsal: 5, Queimada: 10}
const norm = s => String(s).trim().replace(/\s+/g, ' ').toLowerCase()
const abertas = new Set()
document.addEventListener('toggle', e => { const k = e.target.dataset?.k; if (k) e.target.open ? abertas.add(k) : abertas.delete(k) }, true)

let turma = null, times = [], jogadores = [], candidatos = [], editandoProf = false
const aviso = msg => { $('#app').innerHTML = `<div class="card empty">${esc(msg)}</div>` }

async function carregar() {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return aviso('Link inválido. Peça o link certo à Secretaria de Esportes.')
  const m = await sb.rpc('esc_turma_meu', {p_token: token})
  if (m.error) return aviso('Sem conexão. Confira a internet e abra o link de novo.')
  turma = m.data[0]
  if (!turma) return aviso('Link inválido. Peça o link certo à Secretaria de Esportes.')
  const [t, c] = await Promise.all([sb.rpc('esc_turma_times', {p_token: token}), sb.rpc('esc_turma_candidatos', {p_token: token})])
  times = (t.data || []).filter(x => MODALIDADES.includes(x.modalidade_nome))
  candidatos = (c.data || []).map(x => x.nome)
  const ids = times.map(x => x.time_id)
  jogadores = ids.length ? (await sb.from('esc_jogadores').select('id, time_id, nome').in('time_id', ids).order('nome')).data || [] : []
  if (!abertas.size && times[0]) abertas.add(times[0].time_id)
  render()
}

function render() {
  const t0 = turma, ab = t0.inscricoes_abertas
  const timeDe = new Map(jogadores.map(j => [norm(j.nome), j.time_id]))   // aluno -> time (só desta turma)
  const emTime = n => jogadores.filter(j => j.time_id === n).length
  const semTime = candidatos.filter(n => !timeDe.has(norm(n))).length
  const blocos = MODALIDADES.map(mod => {
    const ts = times.filter(x => x.modalidade_nome === mod); if (!ts.length) return ''
    const ocupados = new Set(jogadores.filter(j => ts.some(x => x.time_id === j.time_id)).map(j => norm(j.nome)))
    const livres = candidatos.filter(n => !ocupados.has(norm(n)))
    return `<h3 style="margin:18px 0 6px">${esc(mod)}</h3>` + ts.map(x => {
      const js = jogadores.filter(j => j.time_id === x.time_id), cheio = js.length >= x.vagas, min = MINIMO[mod] || 0
      const sit = js.length < min ? `<span class="pill amber">faltam ${min - js.length} para o mínimo</span>` : '<span class="pill green">completo para jogar</span>'
      return `<details class="pasta" data-k="${x.time_id}"${abertas.has(x.time_id) ? ' open' : ''}><summary><b>${esc(mod)} ${esc(x.genero)} · ${esc(x.time_nome)}</b> <small>${js.length} de ${x.vagas}</small></summary><div class="pasta-corpo">
        <p>${sit}</p>
        ${js.length ? js.map(j => `<div class="row"><span>${esc(j.nome)}</span>${ab ? `<button class="btn ghost sm" data-del="${j.id}" aria-label="Remover ${esc(j.nome)}">Remover</button>` : ''}</div>`).join('') : '<p class="sub">Nenhum aluno ainda.</p>'}
        ${ab && !cheio ? (livres.length ? `<div class="grupo">Toque no nome para colocar neste time (${esc(x.genero)})</div><div class="chips">${livres.map(n => `<button type="button" class="btn ghost sm" data-add="${x.time_id}" data-nome="${esc(n)}">+ ${esc(n)}</button>`).join('')}</div>` : '<p class="sub">Todos os alunos da turma já estão em um time.</p>') : ''}
      </div></details>` }).join('')
  }).join('')
  $('#app').innerHTML = `<div class="hero"><div><div class="eyebrow">II Jogos Escolares · professor da turma</div><h2>${esc(t0.origem)}</h2>
      <div style="color:#d6e2f7;font-size:14px;margin-top:4px">${times.length} time(s) · ${candidatos.length} alunos na turma · ${semTime} ainda sem time</div></div></div>
    <div class="card"><h3>Professor responsável</h3>${t0.professor && !editandoProf ? `<div class="row"><span><b>${esc(t0.professor)}</b></span>${ab ? '<button class="btn ghost sm" id="trocaprof">Alterar</button>' : ''}</div>`
      : ab ? `<form class="f" id="formprof"><label class="span2">Seu nome completo<input name="prof" required minlength="3" maxlength="60" autocomplete="name" value="${esc(t0.professor || '')}"></label>
          <div class="span2"><button class="btn">Salvar meu nome</button></div></form>` : '<p class="sub">Não informado.</p>'}</div>
    ${ab ? '<p class="note">Você monta os times da sua turma: toque no nome para colocar o aluno no time (masculino ou feminino). Um aluno fica em um time só por modalidade. Os alunos escolhidos aparecem no portal público do campeonato.</p>' : '<div class="card empty">As inscrições estão encerradas. Procure a Secretaria para qualquer ajuste.</div>'}
    ${blocos || '<div class="card empty">Esta turma ainda não tem times cadastrados.</div>'}`
  $('#formprof')?.addEventListener('submit', salvarProf)
  $('#trocaprof')?.addEventListener('click', () => { editandoProf = true; render() })
  document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => adicionar(b.dataset.add, b.dataset.nome))
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => remover(b.dataset.del))
}

async function adicionar(time, nome) {
  const {error} = await sb.rpc('esc_turma_inscrever', {p_token: token, p_time: time, p_nome: nome})
  if (error) return toast(erroAmigavel(error.message))
  toast(`${nome} adicionado.`); await carregar()
}
async function remover(id) {
  const j = jogadores.find(x => x.id === id)
  if (!confirm(`Remover ${j?.nome || 'o aluno'} do time?`)) return
  const {error} = await sb.rpc('esc_turma_remover', {p_token: token, p_jogador: id})
  if (error) return toast(erroAmigavel(error.message))
  await carregar()
}
async function salvarProf(e) {
  e.preventDefault()
  const nome = e.target.prof.value.trim().replace(/\s+/g, ' ')
  if (nome.length < 3) return toast('Digite seu nome completo.')
  const {error} = await sb.rpc('esc_turma_definir_professor', {p_token: token, p_nome: nome})
  if (error) return toast(erroAmigavel(error.message))
  editandoProf = false; toast('Nome salvo.'); await carregar()
}

carregar().catch(err => aviso(`Não foi possível carregar (${err.message}). Confira a internet.`))

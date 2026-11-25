// Página do professor (professor.html?t=<link do time>): inscreve e remove os alunos do time, sem conta.
// O banco confere o link, se as inscrições estão abertas e o limite do elenco (funções esc_*).
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {auth: {persistSession: false}})
const token = new URLSearchParams(location.search).get('t') || ''
const $ = s => document.querySelector(s)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]))
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 4500) }
const MSG = {'elenco cheio': 'O time já está completo (titulares + reservas).', 'duplicate': 'Esse nome já está no time.', 'link invalido': 'Link inválido ou inscrições encerradas.'}
const erroAmigavel = m => Object.entries(MSG).find(([k]) => m.includes(k))?.[1] || (/fetch/i.test(m) ? 'Sem internet. Confira a conexão e tente de novo.' : m)

let time = null, jogadores = [], candidatos = [], editandoProf = false

async function carregar() {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return aviso('Link inválido. Peça o link certo à Secretaria de Esportes.')
  const r = await sb.rpc('esc_meu_time', {p_token: token})
  if (r.error) return aviso('Sem conexão. Confira a internet e abra o link de novo.')
  time = r.data[0]
  if (!time) return aviso('Link inválido. Peça o link certo à Secretaria de Esportes.')
  const j = await sb.from('esc_jogadores').select('id, nome').eq('time_id', time.time_id).order('nome')
  jogadores = j.data || []
  candidatos = []   // lista privada da turma (só futsal): o professor toca no nome para inscrever
  if (time.modalidade_nome === 'Futsal') { const c = await sb.rpc('esc_candidatos_time', {p_token: token}); candidatos = (c.data || []).map(x => x.nome) }
  render()
}
const aviso = msg => { $('#app').innerHTML = `<div class="card empty">${esc(msg)}</div>` }

function render() {
  const t = time, cheio = jogadores.length >= t.vagas
  $('#app').innerHTML = `<div class="hero"><div><div class="eyebrow">II Jogos Escolares · ${esc(t.modalidade_nome)} ${esc(t.genero)}</div>
    <h2>${esc(t.turma_nome)}</h2><div style="color:#d6e2f7;font-size:14px;margin-top:4px">Time: ${esc(t.time_nome)}</div></div></div>
    <div class="card"><h3>Professor responsável</h3>${t.professor && !editandoProf ? `<div class="row"><span><b>${esc(t.professor)}</b></span>${t.inscricoes_abertas ? '<button class="btn ghost sm" id="trocaprof">Alterar</button>' : ''}</div>`
      : t.inscricoes_abertas ? `<form class="f" id="formprof"><label class="span2">Seu nome completo<input name="prof" required minlength="3" maxlength="60" autocomplete="name" value="${esc(t.professor || '')}"></label>
          <div class="span2"><button class="btn">Salvar meu nome</button></div></form>` : '<p class="sub">Não informado.</p>'}</div>
    ${t.inscricoes_abertas && !cheio && candidatos.length ? `<div class="card"><h3>Alunos da turma <small>${candidatos.length} disponíveis</small></h3>
      <p class="note">Toque no nome para colocar o aluno neste time (${esc(t.genero)}). Escolha só quem vai jogar: mínimo 5, até ${t.vagas}. Só os escolhidos aparecem no portal.</p>
      <div class="chips">${candidatos.map(n => `<button type="button" class="btn ghost sm" data-add="${esc(n)}">+ ${esc(n)}</button>`).join('')}</div></div>` : ''}
    <div class="card"><h3>Alunos do time <small>${jogadores.length} de ${t.vagas}${t.modalidade_nome === 'Futsal' ? ' · mínimo 5 para jogar' : ''}</small></h3>
      ${jogadores.length ? jogadores.map(j => `<div class="row"><span>${esc(j.nome)}</span>${t.inscricoes_abertas ? `<button class="btn ghost sm" data-del="${j.id}" aria-label="Remover ${esc(j.nome)}">Remover</button>` : ''}</div>`).join('')
        : '<p class="sub">Nenhum aluno ainda.</p>'}</div>
    ${!t.inscricoes_abertas ? '<div class="card empty">As inscrições estão encerradas. Procure a Secretaria para qualquer ajuste.</div>'
      : cheio ? '<div class="card empty">O time está completo.</div>'
      : `<form class="card f" id="form"><label class="span2">Nome do aluno<input name="nome" required minlength="2" maxlength="80" autocomplete="off" placeholder="Nome e sobrenome"></label>
          <div class="span2"><button class="btn block" id="enviar">Inscrever aluno</button></div>
          <p class="note span2">Os nomes dos alunos aparecem na página pública do campeonato. Só inscreva quem a escola autorizou.</p></form>`}`
  $('#form')?.addEventListener('submit', inscrever)
  $('#formprof')?.addEventListener('submit', salvarProf)
  $('#trocaprof')?.addEventListener('click', () => { editandoProf = true; render() })
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => remover(b.dataset.del))
  document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => adicionar(b.dataset.add))
}

async function inscrever(e) {
  e.preventDefault()
  const nome = e.target.nome.value.trim().replace(/\s+/g, ' '), btn = $('#enviar')
  if (nome.length < 2) return toast('Digite o nome do aluno.')
  btn.disabled = true
  const {error} = await sb.rpc('esc_inscrever_jogador', {p_token: token, p_nome: nome})
  if (error) { toast(erroAmigavel(error.message)); btn.disabled = false; return }
  toast(`${nome} inscrito.`); await carregar(); $('#form')?.nome.focus()
}

async function adicionar(nome) {
  const {error} = await sb.rpc('esc_inscrever_jogador', {p_token: token, p_nome: nome})
  if (error) return toast(erroAmigavel(error.message))
  toast(`${nome} inscrito.`); await carregar()
}

async function salvarProf(e) {
  e.preventDefault()
  const nome = e.target.prof.value.trim().replace(/\s+/g, ' ')
  if (nome.length < 3) return toast('Digite seu nome completo.')
  const {error} = await sb.rpc('esc_definir_professor', {p_token: token, p_nome: nome})
  if (error) return toast(erroAmigavel(error.message))
  editandoProf = false; toast('Nome salvo.'); await carregar()
}

async function remover(id) {
  const j = jogadores.find(x => x.id === id)
  if (!confirm(`Remover ${j?.nome || 'o aluno'} do time?`)) return
  const {error} = await sb.rpc('esc_remover_jogador', {p_token: token, p_jogador: id})
  if (error) return toast(erroAmigavel(error.message))
  await carregar()
}

carregar()

// Página do professor (turma.html?t=<link da turma>[,<link de outra turma>]): escolher os alunos de cada time, de forma simples (uma tarefa por tela).
// Um professor com várias turmas recebe UM link com os links das turmas separados por vírgula. Cada turma pode ter mais de um professor responsável.
// Sem conta. O banco confere o link, as inscrições abertas e o limite do elenco (funções esc_turma_*).
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {auth: {persistSession: false}})
const tokens = [...new Set((new URLSearchParams(location.search).get('t') || '').split(',').map(s => s.trim()).filter(Boolean))]
const $ = s => document.querySelector(s)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]))
const MSG = {'elenco cheio': 'O time já está completo.', 'duplicate': 'Esse aluno já está num time.', 'link invalido': 'Link inválido ou inscrições encerradas.', 'check telefone': 'Digite o WhatsApp com DDD, por exemplo 92 99999-9999.', 'check': 'Digite o nome completo.',
  'time ja tem jogo': 'Esse time já tem jogo sorteado. Procure a Secretaria.', 'ultimo time': 'A turma precisa ter pelo menos um time.', 'sem letra': 'Não há mais letras livres para novos times.'}
const erroAmigavel = m => Object.entries(MSG).find(([k]) => m.includes(k))?.[1] || (/fetch/i.test(m) ? 'Sem internet. Confira a conexão e tente de novo.' : m)
const MODALIDADES = ['Futsal', 'Queimada']
const MINIMO = {Futsal: 5, Queimada: 1}   // queimada: sem limite; a turma inteira entra no time misto
const sexo = g => g === 'masculino' ? 'Meninos' : g === 'misto' ? 'Meninos e meninas' : 'Meninas'
const norm = s => String(s).trim().replace(/\s+/g, ' ').toLowerCase()
const primeiro = n => String(n).split(' ')[0]
const letra = nome => String(nome).split(' - ').pop()

// estado da tela
const S = {tela: null, i: 0, mod: 'Futsal', time: null, busca: '', excluindo: false}
let turmas = []   // uma entrada por link: {token, turma, times, jogadores, candidatos}
let sincronizou = false
const abertos = {}
let fila = Promise.resolve(), avisoTimer = null
const profsDe = t => String(t.turma.professor || '').split(' / ').filter(Boolean)
const aviso = msg => { $('#app').innerHTML = `<div class="card empty">${esc(msg)}</div>` }

function toast(msg, desfazer) {
  const el = $('#aviso'); if (!el) return
  el.hidden = false; el.innerHTML = `<span>${esc(msg)}</span>${desfazer ? '<button type="button" data-desfazer>Desfazer</button>' : ''}`
  el.desfazer = desfazer || null
  clearTimeout(avisoTimer); avisoTimer = setTimeout(() => { el.hidden = true }, 5000)
}

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
  if (!sincronizou) {   // queimada: a turma inteira vai para o time misto (uma vez por abertura da página)
    sincronizou = true
    await Promise.all(r.filter(e => e.turma.inscricoes_abertas && /^[1-5]º ano/.test(e.turma.origem)).map(e => sb.rpc('esc_turma_queimada_unica', {p_token: e.token})))   // por enquanto a queimada e so do 1º ao 5º ano
    try { r = await Promise.all(tokens.map(carregarUma)) } catch { return aviso('Sem conexão. Confira a internet e abra o link de novo.') }
  }
  turmas = r
  if (!S.tela) S.tela = turmas.length === 1 ? 'turma' : 'home'   // uma turma só: vai direto para os times
  render()
}

const timesDe = (e, mod) => e.times.filter(x => x.modalidade_nome === mod)
const qtd = (e, id) => e.jogadores.filter(j => j.time_id === id).length
const ids = (e, mod) => new Set(timesDe(e, mod).map(x => x.time_id))
const totalFutsal = e => new Set(e.jogadores.filter(j => ids(e, 'Futsal').has(j.time_id)).map(j => norm(j.nome))).size

function telaHome() {
  const semProf = turmas.some(e => !profsDe(e).length && e.turma.inscricoes_abertas)
  const nome = semProf ? `<div class="card tp-nome"><h2>Qual é o seu nome?</h2><p class="lead">Assim a Secretaria sabe quem cuida de cada turma.</p>
      <form data-nome-prof><input name="prof" class="tp-in" required minlength="3" maxlength="60" autocomplete="name" placeholder="Seu nome completo" aria-label="Seu nome completo"><input name="tel" class="tp-in" type="tel" inputmode="tel" required autocomplete="tel" placeholder="WhatsApp com DDD (92 99999-9999)" aria-label="WhatsApp do professor"><p class="lead tp-nota">O número fica só com a Secretaria, para enviar o link pelo WhatsApp.</p><button class="btn tp-btn">Salvar meu nome</button></form></div>` : ''
  return `<div><h1>Olá!</h1><p class="lead">Você cuida de ${turmas.length} turmas. Toque numa turma para escolher os alunos que vão jogar.</p></div>${nome}
    <div class="tp-turmas">${turmas.map((e, i) => { const tot = e.candidatos.length, n = totalFutsal(e)
      return `<button type="button" class="card tp-turma" data-turma="${i}"><span class="tp-l"><b>${esc(e.turma.origem)}</b><span class="tp-pill ${n >= MINIMO.Futsal ? 'ok' : 'wait'}">${n ? `${n} no futsal` : 'Comece por aqui'}</span></span>
        <span class="tp-bar" aria-hidden="true"><i style="width:${tot ? Math.min(100, Math.round(n / tot * 100)) : 0}%"></i></span><span class="lead">${tot} alunos na turma</span></button>` }).join('')}</div>`
}

function telaTurma() {
  const e = turmas[S.i], ab = e.turma.inscricoes_abertas, ts = timesDe(e, S.mod)
  if (!ts.find(x => x.time_id === S.time)) S.time = ts[0]?.time_id || null
  const tm = ts.find(x => x.time_id === S.time), n = tm ? qtd(e, tm.time_id) : 0, min = MINIMO[S.mod] || 0, max = tm?.vagas || 0, pronto = n >= min
  const profs = profsDe(e), ocupa = ids(e, S.mod)
  const regraQ = S.mod === 'Queimada' ? `<div class="card tp-resumo"><div class="tp-passo">Como funciona a queimada</div><p class="lead">Todos da turma jogam no mesmo time, meninos e meninas juntos. Não tem limite de jogadores.</p><p class="lead"><b>Vence</b> quem eliminar todos os adversários primeiro. Se os 10 minutos acabarem, vence quem eliminou mais. Se empatar, joga mais 5 minutos (repete até ter vencedor). Sem pênaltis.</p></div>` : ''
  // alunos ainda livres (fora de qualquer time desta modalidade); quem já está num time aparece na lista do time
  const ondeEsta = a => e.jogadores.find(j => ocupa.has(j.time_id) && norm(j.nome) === norm(a))
  const q = norm(S.busca), livres = e.candidatos.filter(a => !ondeEsta(a) && (!q || norm(a).includes(q)))
  const ordena = arr => [...arr].sort((x, y) => String(x).localeCompare(String(y), 'pt'))
  const nomesTime = tm ? ordena(e.jogadores.filter(j => j.time_id === tm.time_id).map(j => j.nome)) : []
  const timeLista = tm ? `<div class="card tp-timelista"><div class="tp-passo">Time ${esc(letra(tm.time_nome))} · ${sexo(tm.genero)} · ${nomesTime.length} escolhido(s)</div>
    ${nomesTime.length ? `<ol class="tp-ol">${nomesTime.map(nm => `<li><span>${esc(nm)}</span>${ab && S.mod !== 'Queimada' ? `<button type="button" class="tp-mini" data-sair="${esc(nm)}" aria-label="Tirar ${esc(nm)} do time">Tirar</button>` : ''}</li>`).join('')}</ol>` : '<p class="lead">Nenhum aluno ainda. Toque nos nomes abaixo.</p>'}</div>` : ''
  const linhas = livres.map(a => `<button type="button" class="tp-aluno" aria-pressed="false" data-aluno="${esc(a)}"${!ab ? ' disabled' : ''}><span class="tp-caixa" aria-hidden="true">✓</span>
      <span class="tp-nome-a">${esc(a)}</span></button>`).join('')
  const profHtml = `${profs.map(p => `<div class="tp-prof"><span>${esc(p)}</span>${ab && profs.length > 1 ? `<button type="button" class="tp-mini" data-delprof="${esc(p)}" aria-label="Tirar ${esc(p)}">Tirar</button>` : ''}</div>`).join('') || '<p class="lead">Nenhum professor informado ainda.</p>'}
    ${ab ? `<form class="tp-f" data-addprof><input name="prof" class="tp-in" required minlength="3" maxlength="60" autocomplete="name" placeholder="${profs.length ? 'Nome de outro professor' : 'Seu nome completo'}" aria-label="Nome do professor"><input name="tel" class="tp-in" type="tel" inputmode="tel" required autocomplete="tel" placeholder="WhatsApp com DDD (92 99999-9999)" aria-label="WhatsApp do professor"><p class="lead tp-nota">O número fica só com a Secretaria, para enviar o link pelo WhatsApp.</p><button class="btn tp-btn sm">${profs.length ? 'Adicionar' : 'Salvar meu nome'}</button></form>` : ''}`
  const rod = tm ? `<div class="tp-rin"><div class="tp-rtx"><b>${n} ${n === 1 ? 'aluno escolhido' : 'alunos escolhidos'}</b><span>${pronto ? 'Time pronto para jogar' : `Faltam ${min - n} para o mínimo de ${min}`}</span><span class="tp-bar" aria-hidden="true"><i style="width:${min ? Math.min(100, Math.round(n / min * 100)) : 100}%"></i></span></div>${turmas.length > 1 ? `<button type="button" class="btn tp-btn" data-home>${pronto ? 'Concluir' : 'Sair'}</button>` : ''}</div>` : ''
  // resumo: quem está em cada time desta modalidade e quem ficou de fora (da lista da turma)
  const dentro = new Set(e.jogadores.filter(j => ocupa.has(j.time_id)).map(j => norm(j.nome))), fora = e.candidatos.filter(a => !dentro.has(norm(a)))
  const ordenar = arr => [...arr].sort((x, y) => String(x).localeCompare(String(y), 'pt'))
  const resumo = `<div class="card tp-resumo"><div class="tp-passo">Quem vai jogar · ${S.mod}</div>
    <div class="tp-rgrid">${ts.map(x => { const nomes = ordenar(e.jogadores.filter(j => j.time_id === x.time_id).map(j => j.nome)), c = nomes.length
      return `<div class="tp-rtime${x.time_id === S.time ? ' atual' : ''}"><div class="tp-rh"><b>Time ${esc(letra(x.time_nome))}</b><span>${sexo(x.genero)} · ${c}/${x.vagas}</span></div>${c ? `<ol>${nomes.map(n => `<li>${esc(n)}</li>`).join('')}</ol>` : '<p class="lead">Ninguém ainda.</p>'}</div>` }).join('') || '<p class="lead">Esta turma ainda não tem time neste esporte.</p>'}</div>
    <div class="tp-fora"><b>Ficaram de fora (${fora.length})</b>${fora.length ? `<div class="tp-chips">${ordenar(fora).map(n => `<span>${esc(n)}</span>`).join('')}</div>` : '<p class="lead">Todos da lista já estão num time.</p>'}</div></div>`
  return {rod, html: `${turmas.length > 1 ? '<button type="button" class="tp-back" data-home>← Minhas turmas</button>' : ''}
  <div><div class="tp-passo">Turma</div><h1>${esc(e.turma.origem)}</h1><p class="lead"><b>Professores responsáveis:</b> ${profs.length ? profs.map(p => esc(p)).join(' · ') : 'ainda não informado'}</p></div>
  ${ab && S.mod !== 'Queimada' ? `<details class="tp-mais" data-d="mais"${abertos.mais ? ' open' : ''}><summary>Adicionar ou excluir equipe</summary><div class="tp-in2">
    <p class="lead">Quer mais uma equipe? Escolha o tipo. O sistema dá a letra sozinho (A, B, C...).</p>
    <div class="tp-row2"><button type="button" class="btn tp-btn ghost" data-novo="masculino">+ Time de meninos</button><button type="button" class="btn tp-btn ghost" data-novo="feminino">+ Time de meninas</button></div>
    ${tm ? (S.excluindo ? `<div class="tp-conf"><b>Excluir o Time ${esc(letra(tm.time_nome))} (${sexo(tm.genero).toLowerCase()})?</b><span class="lead">Os ${n} alunos voltam para a lista da turma. Nada mais é apagado.</span><div class="tp-row2"><button type="button" class="btn tp-btn danger" data-exclui-sim>Sim, excluir</button><button type="button" class="btn tp-btn ghost" data-exclui-nao>Não</button></div></div>`
      : `<button type="button" class="btn tp-btn danger" data-exclui>Excluir o Time ${esc(letra(tm.time_nome))} (${sexo(tm.genero).toLowerCase()})</button>`) : ''}</div></details>` : ''}
  ${!ab ? '<div class="card empty">As inscrições estão encerradas. Procure a Secretaria para qualquer ajuste.</div>' : ''}
  ${ab && !profs.length ? `<div class="card tp-nome"><h2>Qual é o seu nome?</h2><form class="tp-f" data-addprof><input name="prof" class="tp-in" required minlength="3" maxlength="60" autocomplete="name" placeholder="Seu nome completo" aria-label="Seu nome completo"><input name="tel" class="tp-in" type="tel" inputmode="tel" required autocomplete="tel" placeholder="WhatsApp com DDD (92 99999-9999)" aria-label="WhatsApp do professor"><p class="lead tp-nota">O número fica só com a Secretaria, para enviar o link pelo WhatsApp.</p><button class="btn tp-btn">Salvar meu nome</button></form></div>` : ''}
  <div><div class="tp-passo">1. Escolha o esporte</div><div class="tp-seg">${MODALIDADES.map(m => `<button type="button" data-mod="${m}" aria-pressed="${S.mod === m}">${m}</button>`).join('')}</div></div>
  <div><div class="tp-passo">2. Escolha o time</div><div class="tp-times">${ts.map(x => `<button type="button" class="tp-time" data-time="${x.time_id}" aria-pressed="${x.time_id === S.time}"><small>${sexo(x.genero)}</small><b>Time ${esc(letra(x.time_nome))} · ${qtd(e, x.time_id)}</b></button>`).join('') || '<p class="lead">Esta turma ainda não tem time neste esporte. Abra “Mais opções” para criar.</p>'}</div></div>
  ${tm ? `<div class="card tp-head"><div><div class="tp-passo" style="margin:0">Time escolhido</div><h2>${S.mod} · ${sexo(tm.genero)} · Time ${esc(letra(tm.time_nome))}</h2></div><div class="tp-cont"><div class="tp-big">${n}</div><span class="tp-pill ${pronto ? 'ok' : 'wait'}">${pronto ? 'Pronto' : 'Faltam ' + (min - n)}</span></div></div>
  ${regraQ}
  ${timeLista}
  ${S.mod === 'Queimada' ? '' : `<div><div class="tp-passo">3. Toque nos alunos que vão jogar (saem desta lista e vão para o time)</div><input id="busca" class="tp-in" type="search" placeholder="Procurar aluno pelo nome" value="${esc(S.busca)}" autocomplete="off" aria-label="Procurar aluno"></div>
  <div class="tp-lista">${linhas || '<p class="tp-vazio">Todos os alunos da lista já estão num time.</p>'}</div>`}
  ${n >= max ? `<p class="tp-pill wait" style="white-space:normal">O time já tem ${max} alunos, que é o máximo.</p>` : ''}` : ''}
  ${resumo}
  <details data-d="prof"${abertos.prof ? ' open' : ''}><summary>Professores desta turma (${profs.length})</summary><div class="tp-in2">${profHtml}</div></details>`}
}

function render() {
  const f = document.activeElement?.id === 'busca', pos = f ? document.activeElement.selectionStart : 0
  const rod = $('#rodape')
  if (S.tela === 'turma' && turmas[S.i]) { const t = telaTurma(); $('#app').innerHTML = t.html; rod.hidden = !t.rod; rod.innerHTML = t.rod }
  else { $('#app').innerHTML = telaHome(); rod.hidden = true }
  if (f) { const el = $('#busca'); el?.focus(); el?.setSelectionRange?.(pos, pos) }
}

// ação com resposta imediata na tela; o banco confirma em segundo plano (uma de cada vez) e a tela volta atrás se ele recusar
function agir(local, remoto, ok, desfazer) {
  const antes = JSON.parse(JSON.stringify(turmas))
  local(); render(); if (ok) toast(ok, desfazer)
  fila = fila.then(async () => {
    const {error} = await remoto()
    if (error) { turmas = antes; render(); toast(erroAmigavel(error.message)) }
    await carregar()
  })
}
const rpc = (fn, args) => sb.rpc(fn, args)
const topo = () => { try { scrollTo(0, 0) } catch {} }

function alternar(nome) {
  const e = turmas[S.i], tm = e.times.find(x => x.time_id === S.time); if (!tm) return
  const ocupa = ids(e, S.mod), j = e.jogadores.find(x => ocupa.has(x.time_id) && norm(x.nome) === norm(nome))
  const cheio = qtd(e, tm.time_id) >= tm.vagas
  if (j?.time_id === tm.time_id) return agir(() => { e.jogadores = e.jogadores.filter(x => x !== j) }, () => rpc('esc_turma_remover', {p_token: e.token, p_jogador: j.id}), `${primeiro(nome)} saiu do Time ${letra(tm.time_nome)}.`, () => inscrever(nome, tm.time_id))
  if (cheio) return toast(`O time já tem ${tm.vagas} alunos.`)
  if (j) {   // está em outro time da mesma modalidade: sai de lá e entra aqui
    const antigo = j.time_id
    return agir(() => { j.time_id = tm.time_id }, async () => { const r = await rpc('esc_turma_remover', {p_token: e.token, p_jogador: j.id}); if (r.error) return r
      const i = await rpc('esc_turma_inscrever', {p_token: e.token, p_time: tm.time_id, p_nome: nome}); if (i.error) await rpc('esc_turma_inscrever', {p_token: e.token, p_time: antigo, p_nome: nome}); return i },
      `${primeiro(nome)} agora está no Time ${letra(tm.time_nome)}.`, () => trocar(nome, tm.time_id, antigo))
  }
  agir(() => { e.jogadores.push({id: 'novo-' + Date.now(), time_id: tm.time_id, nome}) }, () => rpc('esc_turma_inscrever', {p_token: e.token, p_time: tm.time_id, p_nome: nome}),
    `${primeiro(nome)} está no Time ${letra(tm.time_nome)}.`, () => sairDe(nome, tm.time_id))
}
function inscrever(nome, time) { const e = turmas[S.i]; agir(() => { e.jogadores.push({id: 'novo-' + Date.now(), time_id: time, nome}) }, () => rpc('esc_turma_inscrever', {p_token: e.token, p_time: time, p_nome: nome})) }
function sairDe(nome, time) { const e = turmas[S.i], j = e.jogadores.find(x => x.time_id === time && norm(x.nome) === norm(nome)); if (!j || String(j.id).startsWith('novo-')) return carregar()
  agir(() => { e.jogadores = e.jogadores.filter(x => x !== j) }, () => rpc('esc_turma_remover', {p_token: e.token, p_jogador: j.id})) }
function trocar(nome, de, para) { const e = turmas[S.i], j = e.jogadores.find(x => x.time_id === de && norm(x.nome) === norm(nome)); if (!j) return
  agir(() => { j.time_id = para }, async () => { const r = await rpc('esc_turma_remover', {p_token: e.token, p_jogador: j.id}); if (r.error) return r; return rpc('esc_turma_inscrever', {p_token: e.token, p_time: para, p_nome: nome}) }) }

const chamar = async (fn, args, ok) => { const {error} = await rpc(fn, args); if (error) return toast(erroAmigavel(error.message)); if (ok) toast(ok); await carregar() }
const salvaProfs = (e, lista, ok) => chamar('esc_turma_definir_professor', {p_token: e.token, p_nome: lista.join(' / ')}, ok)

document.addEventListener('toggle', ev => { const d = ev.target.dataset?.d; if (d) abertos[d] = ev.target.open }, true)
$('#app').addEventListener('click', ev => {
  const b = ev.target.closest?.('button'); if (!b) return; const d = b.dataset
  if (d.turma !== undefined) { S.i = +d.turma; S.tela = 'turma'; S.time = null; S.busca = ''; S.excluindo = false; render(); topo(); return }
  if (d.home !== undefined) { S.tela = 'home'; render(); topo(); return }
  if (d.mod) { S.mod = d.mod; S.time = null; S.excluindo = false; return render() }
  if (d.time) { S.time = d.time; S.excluindo = false; return render() }
  if (d.aluno) return alternar(d.aluno)
  if (d.sair !== undefined) return sairDe(d.sair, S.time)
  const e = turmas[S.i]
  if (d.novo) { const tm0 = S.mod; return fila = fila.then(async () => { const {data, error} = await rpc('esc_turma_criar_time', {p_token: e.token, p_modalidade: tm0, p_genero: d.novo}); if (error) return toast(erroAmigavel(error.message)); S.time = data; toast('Time criado.'); await carregar() }) }
  if (d.exclui !== undefined) { S.excluindo = true; return render() }
  if (d.excluiNao !== undefined) { S.excluindo = false; return render() }
  if (d.excluiSim !== undefined) { const id = S.time; S.excluindo = false; S.time = null; return fila = fila.then(() => chamar('esc_turma_excluir_time', {p_token: e.token, p_time: id}, 'Time excluído. Os alunos voltaram para a lista.')) }
  if (d.delprof) return salvaProfs(e, profsDe(e).filter(p => p !== d.delprof), 'Professor retirado.')
})
$('#rodape').addEventListener('click', ev => { if (ev.target.closest?.('[data-home]')) { S.tela = 'home'; render(); topo() } })
$('#aviso').addEventListener('click', ev => { const el = $('#aviso'); if (ev.target.closest?.('[data-desfazer]') && el.desfazer) { const f = el.desfazer; el.desfazer = null; el.hidden = true; f() } })
$('#app').addEventListener('input', ev => { if (ev.target.id === 'busca') { S.busca = ev.target.value; render() } })
$('#app').addEventListener('submit', ev => {
  const f = ev.target, nome = String(f.prof?.value || '').trim().replace(/\s+/g, ' '), tel = String(f.tel?.value || '')
  if (f.dataset?.addprof === undefined && f.dataset?.nomeProf === undefined) return
  ev.preventDefault()
  if (nome.length < 3) return toast('Digite o nome completo.')
  const contato = e => rpc('esc_turma_contato', {p_token: e.token, p_nome: nome, p_telefone: tel})
  if (f.dataset.nomeProf !== undefined) {   // tela inicial: o nome e o WhatsApp valem para todas as turmas ainda sem professor
    return fila = fila.then(async () => { for (const e of turmas) if (!profsDe(e).length && e.turma.inscricoes_abertas) {
      const c = await contato(e); if (c.error) return toast(erroAmigavel(c.error.message))
      await rpc('esc_turma_definir_professor', {p_token: e.token, p_nome: nome}) }
      toast('Nome salvo.'); await carregar() }) }
  const e = turmas[S.i], lista = profsDe(e)
  if (lista.some(p => norm(p) === norm(nome))) return toast('Esse professor já está na lista.')
  fila = fila.then(async () => { const c = await contato(e); if (c.error) return toast(erroAmigavel(c.error.message)); await salvaProfs(e, [...lista, nome], 'Nome salvo.') })
})

carregar().catch(err => aviso(`Não foi possível carregar (${err.message}). Confira a internet.`))

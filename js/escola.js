// Campeonato interno da escola (escola.html): todos veem turmas, times, jogos e campeões; a Secretaria (login) cadastra e lança placar.
// Regras de verdade ficam no banco (tabelas esc_*): aqui é só tela. Veja supabase/migrations/20261121000000_turmas_escola.sql.
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
const $ = s => document.querySelector(s)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]))
const dmy = d => d.split('-').reverse().join('/')
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 4500) }
async function q(p) { const {data, error} = await p; if (error) throw new Error(error.code === '23514' ? 'Dado fora do permitido (pênaltis só em empate e nunca empatados).' : error.code === '23505' ? 'Já existe um registro igual.' : error.message); return data }

// Regras de cada modalidade (a Secretaria pode editar no banco). Futsal: 5 + reservas, 2x10. Queimada: 10 participantes, 10 min.
const PRESETS = {Futsal: {jogadores_por_time: 5, reservas_max: 5, tempos: 2, tempo_min: 10}, Queimada: {jogadores_por_time: 10, reservas_max: 0, tempos: 1, tempo_min: 10}}
const TURMAS = ['1º ano 01', '1º ano 02', '2º ano 01', '2º ano 02', '3º ano 01', '3º ano 02', '4º ano 01', '4º ano 02', '5º ano 01', '5º ano 02',
  '6º ano 01', '6º ano 02', '7º ano', '8º ano 01', '8º ano 02', '9º ano', '6ª etapa / 7º ano - EJAI', '8ª etapa / 9º ano - EJAI']   // portal 2026
let D = {}, sec = false, aviso = ''

async function carregar() {
  const {data: {session}} = await sb.auth.getSession()
  sec = !!session && (await sb.from('perfis').select('papel').eq('id', session.user.id)).data?.[0]?.papel === 'secretaria'
  const [c] = await q(sb.from('esc_campeonatos').select('*').order('inicio', {ascending: false}).limit(1))
  D = {c, mod: [], turmas: [], times: [], jog: [], partidas: [], links: {}}
  if (c) {
    const por = t => q(sb.from(t).select('*').eq('campeonato_id', c.id))
    ;[D.mod, D.turmas] = await Promise.all([por('esc_modalidades'), por('esc_turmas')])
    D.times = await q(sb.from('esc_times').select('id,campeonato_id,turma_id,modalidade_id,genero,nome').eq('campeonato_id', c.id))   // sem a coluna token
    const ids = D.times.map(t => t.id), tid = D.turmas.map(t => t.id)
    D.jog = ids.length ? await q(sb.from('esc_jogadores').select('id,time_id,nome').in('time_id', ids).order('nome')) : []
    D.partidas = tid.length ? await q(sb.from('esc_partidas').select('*').in('turma_id', tid).order('fase').order('id')) : []
    if (sec) for (const l of await q(sb.rpc('esc_links_times', {p_campeonato: c.id}))) D.links[l.time_id] = l.token
  }
  render()
}

const nomeMod = id => D.mod.find(m => m.id === id)?.nome || '?'
const nomeTurma = id => D.turmas.find(t => t.id === id)?.nome || '?'
const timeDe = id => D.times.find(t => t.id === id)
const rotuloTime = t => `${nomeTurma(t.turma_id)} · ${nomeMod(t.modalidade_id)} ${t.genero} · ${t.nome}`
const linkProfessor = tk => new URL('professor.html?t=' + tk, location.href).href
const opcoes = (lista, rot) => lista.map(x => `<option value="${x.id}">${esc(rot(x))}</option>`).join('')

function secretaria() {
  const c = D.c
  if (!c) return `<div class="card"><h3>Criar o campeonato</h3><form class="f" data-form="camp">
    <label class="span2">Nome<input name="nome" required minlength="5" maxlength="80" value="Interclasse 2026"></label>
    <label>Início<input name="inicio" type="date" required value="2026-12-07"></label><label>Fim<input name="fim" type="date" required value="2026-12-09"></label>
    <label class="span2">Local<input name="local" maxlength="80" value="Quadra da escola"></label><div class="span2"><button class="btn">Criar</button></div></form></div>`
  const temMod = n => D.mod.some(m => m.nome === n)
  const tabela = D.times.map(t => { const tk = D.links[t.id], link = tk ? linkProfessor(tk) : ''
    return `<div class="row"><span>${esc(rotuloTime(t))} <small class="sub">${D.jog.filter(j => j.time_id === t.id).length} aluno(s)</small></span><span class="btns">
      <button class="btn ghost sm" data-act="copiar" data-link="${esc(link)}">Copiar link do professor</button>
      <a class="btn ghost sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent('Inscreva os alunos do time ' + t.nome + ' (' + nomeTurma(t.turma_id) + '): ' + link)}">WhatsApp</a>
      <button class="btn danger sm" data-act="del" data-tab="esc_times" data-id="${t.id}">Excluir</button></span></div>` }).join('')
  return `<div class="card"><h3>Painel da Secretaria <small><button class="btn ghost sm" data-act="sair">Sair</button></small></h3>
    <div class="row"><span><b>Inscrições dos professores:</b> ${c.inscricoes_abertas ? '<span class="pill green">abertas</span>' : '<span class="pill red">encerradas</span>'}</span>
      <button class="btn ghost sm" data-act="inscricoes">${c.inscricoes_abertas ? 'Encerrar inscrições' : 'Reabrir inscrições'}</button></div></div>
    <div class="card"><h3>1. Modalidades</h3><div class="btns">${Object.keys(PRESETS).map(n => `<button class="btn ${temMod(n) ? 'ghost' : ''}" data-act="mod" data-nome="${n}" ${temMod(n) ? 'disabled' : ''}>${temMod(n) ? '✓ ' : '+ '}${n}</button>`).join('')}</div>
      <p class="sub" style="margin-top:6px">Futsal: 5 em quadra + até 5 reservas, 2 tempos de 10 min. Queimada: 10 participantes, 10 min. Masculino e feminino em ambas. Sem pontos: mata-mata, empate vai a pênaltis.</p></div>
    <div class="card"><h3>2. Turmas <small>${D.turmas.length} cadastrada(s)</small></h3><form data-form="turmas"><label>Uma turma por linha (as que já existem são ignoradas)
      <textarea name="nomes">${esc(TURMAS.filter(n => !D.turmas.some(t => t.nome === n)).join('\n'))}</textarea></label><button class="btn" style="margin-top:8px">Cadastrar turmas</button></form></div>
    <div class="card"><h3>3. Times</h3><form class="f" data-form="time">
      <label>Turma<select name="turma" required>${opcoes(D.turmas, t => t.nome)}</select></label>
      <label>Modalidade<select name="mod" required>${opcoes(D.mod, m => m.nome)}</select></label>
      <label>Gênero<select name="genero"><option value="masculino">Masculino</option><option value="feminino">Feminino</option></select></label>
      <label>Nome do time<input name="nome" required minlength="2" maxlength="40" placeholder="Ex.: Time A"></label><div><button class="btn">Criar time</button></div></form>
      <div style="margin-top:10px">${tabela || '<p class="sub">Nenhum time ainda.</p>'}</div></div>
    <div class="card"><h3>4. Jogos</h3><form class="f" data-form="partida">
      <label class="span2">Time A<select name="a" required>${opcoes(D.times, rotuloTime)}</select></label>
      <label class="span2">Time B (mesma turma, modalidade e gênero)<select name="b" required>${opcoes(D.times, rotuloTime)}</select></label>
      <label>Fase<input name="fase" required minlength="3" maxlength="30" value="final" list="fases"></label><datalist id="fases"><option>quartas</option><option>semifinal</option><option>final</option></datalist>
      <label>Colete do time A<select name="colete"><option value="azul">Azul (B usa vermelho)</option><option value="vermelho">Vermelho (B usa azul)</option></select></label>
      <div><button class="btn">Marcar jogo</button></div></form></div>`
}

function publico() {
  const c = D.c
  if (!c) return '<div class="card empty">O campeonato ainda não foi criado.</div>'
  const campeoes = new Map(D.partidas.filter(p => p.fase === 'final' && p.vencedor_id).map(p => [`${p.turma_id}|${p.modalidade_id}|${p.genero}`, p.vencedor_id]))
  const jogo = p => { const a = timeDe(p.time_a_id), b = timeDe(p.time_b_id), cb = p.colete_a === 'azul' ? 'vermelho' : 'azul'
    const lado = (t, cor) => `<b>${esc(t?.nome)}</b> <span class="pill ${cor === 'azul' ? 'blue' : 'red'}">${cor}</span>`
    const res = p.placar_a == null ? '<span class="pill">a jogar</span>' : `<b>${p.placar_a} x ${p.placar_b}</b>${p.penaltis_a != null ? ` <small class="sub">(pên. ${p.penaltis_a} x ${p.penaltis_b})</small>` : ''}`
    const edit = sec ? `<form class="placar" data-form="placar" data-id="${p.id}"><input name="pa" type="number" min="0" value="${p.placar_a ?? ''}" aria-label="Placar A"><input name="pb" type="number" min="0" value="${p.placar_b ?? ''}" aria-label="Placar B">
      <input name="ea" type="number" min="0" value="${p.penaltis_a ?? ''}" placeholder="pên. A" aria-label="Pênaltis A"><input name="eb" type="number" min="0" value="${p.penaltis_b ?? ''}" placeholder="pên. B" aria-label="Pênaltis B">
      <button class="btn sm">Salvar</button><button type="button" class="btn danger sm" data-act="del" data-tab="esc_partidas" data-id="${p.id}">Excluir</button></form>` : ''
    return `<div class="row"><span><span class="pill">${esc(p.fase)}</span> ${lado(a, p.colete_a)} × ${lado(b, cb)}</span><span>${res}${p.vencedor_id ? ` <span class="pill green">vence ${esc(timeDe(p.vencedor_id)?.nome)}</span>` : ''}</span>${edit}</div>` }
  const grupos = D.turmas.map(t => {
    const blocos = D.mod.flatMap(m => ['masculino', 'feminino'].map(g => {
      const times = D.times.filter(x => x.turma_id === t.id && x.modalidade_id === m.id && x.genero === g); if (!times.length) return ''
      const camp = campeoes.get(`${t.id}|${m.id}|${g}`), ps = D.partidas.filter(p => p.turma_id === t.id && p.modalidade_id === m.id && p.genero === g)
      return `<h4>${esc(m.nome)} ${g}${camp ? ` · <span class="pill green">campeão: ${esc(timeDe(camp)?.nome)}</span>` : ''}</h4>
        ${times.map(x => { const js = D.jog.filter(j => j.time_id === x.id); return `<div class="elenco"><b>${esc(x.nome)}</b> (${js.length}/${m.jogadores_por_time + m.reservas_max}): ${js.length ? js.map(j => esc(j.nome)).join(', ') : 'sem alunos inscritos'}</div>` }).join('')}
        ${ps.map(jogo).join('')}` })).join('')
    return blocos ? `<div class="card"><h3>${esc(t.nome)}</h3>${blocos}</div>` : '' }).join('')
  return `<div class="hero"><div><div class="eyebrow">Campeonato interno da escola</div><h2>${esc(c.nome)}</h2>
    <div style="color:#d6e2f7;font-size:14px;margin-top:4px">${dmy(c.inicio)} a ${dmy(c.fim)} · ${esc(c.local)}</div></div></div>${grupos || '<div class="card empty">Ainda não há times cadastrados.</div>'}`
}

function login() {
  return `<details class="card"><summary><b>Sou da Secretaria</b></summary><form class="f" data-form="login" style="margin-top:10px">
    <label>E-mail<input name="email" type="email" required autocomplete="username"></label><label>Senha<input name="senha" type="password" required autocomplete="current-password"></label>
    <div><button class="btn">Entrar</button></div></form></details>`
}

function render() { $('#app').innerHTML = (sec ? secretaria() : '') + publico() + (sec ? '' : login()) }

// cada ação devolve o que gravar no banco; depois a tela recarrega
const ACOES = {
  camp: async d => q(sb.from('esc_campeonatos').insert({nome: d.nome, inicio: d.inicio, fim: d.fim, local: d.local || 'A definir'})),
  turmas: async d => { const novas = [...new Set(d.nomes.split('\n').map(x => x.trim()).filter(Boolean))].filter(n => !D.turmas.some(t => t.nome === n))
    if (novas.length) await q(sb.from('esc_turmas').insert(novas.map(nome => ({campeonato_id: D.c.id, nome})))) },
  time: async d => q(sb.from('esc_times').insert({campeonato_id: D.c.id, turma_id: d.turma, modalidade_id: d.mod, genero: d.genero, nome: d.nome})),
  partida: async d => { const a = timeDe(d.a); if (!a) throw new Error('Escolha o time A.')
    await q(sb.from('esc_partidas').insert({turma_id: a.turma_id, modalidade_id: a.modalidade_id, genero: a.genero, time_a_id: d.a, time_b_id: d.b, fase: d.fase.trim(), colete_a: d.colete})) },
  placar: async (d, f) => { const n = v => v === '' ? null : +v
    await q(sb.from('esc_partidas').update({placar_a: n(d.pa), placar_b: n(d.pb), penaltis_a: n(d.ea), penaltis_b: n(d.eb)}).eq('id', f.dataset.id)) },
  login: async d => { const {error} = await sb.auth.signInWithPassword({email: d.email, password: d.senha}); if (error) throw new Error('E-mail ou senha incorretos.') },
}
document.addEventListener('submit', async e => {
  const f = e.target.closest('[data-form]'); if (!f) return
  e.preventDefault()
  try { await ACOES[f.dataset.form](Object.fromEntries(new FormData(f)), f); toast('Salvo.'); await carregar() } catch (err) { toast(err.message) }
})
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return
  const act = b.dataset.act
  try {
    if (act === 'copiar') { await navigator.clipboard.writeText(b.dataset.link); return toast('Link copiado. Mande só ao professor deste time.') }
    if (act === 'sair') { await sb.auth.signOut(); return carregar() }
    if (act === 'inscricoes') await q(sb.from('esc_campeonatos').update({inscricoes_abertas: !D.c.inscricoes_abertas}).eq('id', D.c.id))
    if (act === 'mod') await q(sb.from('esc_modalidades').insert({campeonato_id: D.c.id, nome: b.dataset.nome, ...PRESETS[b.dataset.nome]}))
    if (act === 'del') { if (!confirm('Excluir? Isso não pode ser desfeito (jogos e alunos ligados também somem).')) return
      await q(sb.from(b.dataset.tab).delete().eq('id', b.dataset.id)) }
    await carregar()
  } catch (err) { toast(err.message) }
})

carregar().catch(err => { $('#app').innerHTML = `<div class="card empty">Não foi possível carregar (${esc(err.message)}). Confira a internet.</div>` })

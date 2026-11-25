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
// Grupo = SERIE: as turmas da serie (ex.: 1º ano 01 e 1º ano 02) viram times que se enfrentam num mini campeonato. Portal 2026.
const SERIES = ['1º ano', '2º ano', '3º ano', '4º ano', '5º ano', '6º ano', '7º ano', '8º ano', '9º ano', '6ª etapa / 7º ano - EJAI', '8ª etapa / 9º ano - EJAI']
const ORIGENS = ['1º ano 01', '1º ano 02', '2º ano 01', '2º ano 02', '3º ano 01', '3º ano 02', '4º ano 01', '4º ano 02', '5º ano 01', '5º ano 02', '6º ano 01', '6º ano 02',
  '7º ano', '8º ano 01', '8º ano 02', '9º ano', '6ª etapa / 7º ano - EJAI', '8ª etapa / 9º ano - EJAI']
// Sorteio: o sistema sorteia os confrontos (mata-mata). Grupo = serie + modalidade + genero. Numero impar de times: um folga (quem ainda nao folgou).
const ORDEM = ['oitavas', 'quartas', 'semifinal', 'final']
const nomeFase = k => k <= 2 ? 'final' : k <= 4 ? 'semifinal' : k <= 8 ? 'quartas' : 'oitavas'
function embaralha(lista) {   // Fisher-Yates com sorteio do proprio navegador (crypto), nao escolha de ninguem
  const a = [...lista], r = crypto.getRandomValues(new Uint32Array(a.length))
  for (let i = a.length - 1; i > 0; i--) { const j = r[i] % (i + 1); [a[i], a[j]] = [a[j], a[i]] }
  return a
}
// Devolve {campeao} | {pendente} | {erro} | {fase, jogos: [{a, b, colete}], folga}
function proximaRodada(times, partidas) {
  let vivos = times.map(t => t.id); const folgou = new Set()
  if (vivos.length < 2) return {erro: 'Precisa de pelo menos 2 times.'}
  if (vivos.length > 16) return {erro: 'O sorteio aceita até 16 times por grupo.'}
  for (const fase of ORDEM) {
    const ps = partidas.filter(p => p.fase === fase); if (!ps.length) continue
    if (ps.some(p => !p.vencedor_id)) return {pendente: ps.filter(p => !p.vencedor_id).length}
    const jogaram = new Set(ps.flatMap(p => [p.time_a_id, p.time_b_id]))
    vivos.filter(id => !jogaram.has(id)).forEach(id => folgou.add(id))
    vivos = [...vivos.filter(id => !jogaram.has(id)), ...ps.map(p => p.vencedor_id)]
  }
  if (vivos.length === 1) return {campeao: vivos[0]}
  let ordem = embaralha(vivos), folga = null
  if (ordem.length % 2) { const cand = ordem.filter(id => !folgou.has(id)); folga = (cand.length ? cand : ordem)[0]; ordem = ordem.filter(id => id !== folga) }
  const jogos = []
  for (let i = 0; i < ordem.length; i += 2) jogos.push({a: ordem[i], b: ordem[i + 1], colete: embaralha(['azul', 'vermelho'])[0]})
  return {fase: nomeFase(vivos.length), jogos, folga}
}
const GENEROS = ['masculino', 'feminino']
const grupos = () => D.turmas.flatMap(t => D.mod.flatMap(m => GENEROS.map(g => {
  const times = D.times.filter(x => x.turma_id === t.id && x.modalidade_id === m.id && x.genero === g)
  const partidas = D.partidas.filter(p => p.turma_id === t.id && p.modalidade_id === m.id && p.genero === g)
  return {t, m, g, times, partidas, chave: `${t.id}|${m.id}|${g}`, r: times.length ? proximaRodada(times, partidas) : null}
}))).filter(x => x.times.length >= 2)
let D = {}, sec = false, aviso = ''

async function carregar() {
  const {data: {session}} = await sb.auth.getSession()
  sec = !!session && (await sb.from('perfis').select('papel').eq('id', session.user.id)).data?.[0]?.papel === 'secretaria'
  const [c] = await q(sb.from('esc_campeonatos').select('*').order('inicio', {ascending: false}).limit(1))
  D = {c, mod: [], turmas: [], times: [], jog: [], partidas: [], links: {}, profs: {}}
  if (c) {
    const por = t => q(sb.from(t).select('*').eq('campeonato_id', c.id))
    ;[D.mod, D.turmas] = await Promise.all([por('esc_modalidades'), por('esc_turmas')])
    D.times = await q(sb.from('esc_times').select('id,campeonato_id,turma_id,modalidade_id,genero,nome').eq('campeonato_id', c.id))   // sem a coluna token
    const ids = D.times.map(t => t.id), tid = D.turmas.map(t => t.id)
    D.jog = ids.length ? await q(sb.from('esc_jogadores').select('id,time_id,nome').in('time_id', ids).order('nome')) : []
    D.partidas = tid.length ? await q(sb.from('esc_partidas').select('*').in('turma_id', tid).order('fase').order('id')) : []
    if (sec) for (const l of await q(sb.rpc('esc_links_times', {p_campeonato: c.id}))) { D.links[l.time_id] = l.token; D.profs[l.time_id] = l.professor }
    const pos = n => { const i = SERIES.indexOf(n); return i < 0 ? 99 : i }   // série na ordem do ensino (1º ano ... 9º ano, EJAI); fora da lista, no fim
    const nat = (a, b) => a.localeCompare(b, 'pt', {numeric: true})
    D.turmas.sort((x, y) => pos(x.nome) - pos(y.nome) || nat(x.nome, y.nome))
    D.times.sort((x, y) => nat(x.nome, y.nome))
    D.mod.sort((x, y) => nat(x.nome, y.nome))
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
    <label class="span2">Nome<input name="nome" required minlength="5" maxlength="80" value="II Jogos Escolares Internos da Escola Municipal São Francisco de Assis"></label>
    <label>Início<input name="inicio" type="date" required value="2026-12-07"></label><label>Fim<input name="fim" type="date" required value="2026-12-09"></label>
    <label class="span2">Local<input name="local" maxlength="80" value="Quadra da escola"></label><div class="span2"><button class="btn">Criar</button></div></form></div>`
  const temMod = n => D.mod.some(m => m.nome === n)
  const linha = t => { const tk = D.links[t.id], link = tk ? linkProfessor(tk) : '', prof = D.profs[t.id]
    return `<div class="row"><span><b>${esc(t.nome)}</b> <small class="sub">${D.jog.filter(j => j.time_id === t.id).length} aluno(s)</small><br>${prof ? `Professor: ${esc(prof)}` : '<span class="pill amber">professor ainda não preencheu</span>'}</span><span class="btns">
      <button class="btn ghost sm" data-act="copiar" data-link="${esc(link)}">Copiar link</button>
      <a class="btn ghost sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent('Olá! Você é o professor responsável pelo time ' + t.nome + ' (' + nomeTurma(t.turma_id) + ' · ' + nomeMod(t.modalidade_id) + ' ' + t.genero + '). Preencha seu nome e inscreva os alunos por este link: ' + link)}">WhatsApp</a>
      <button class="btn danger sm" data-act="del" data-tab="esc_times" data-id="${t.id}">Excluir</button></span></div>` }
  const tabela = D.turmas.map(u => { const ts = D.times.filter(t => t.turma_id === u.id); if (!ts.length) return ''
    return `<h4 style="margin-top:12px">${esc(u.nome)}</h4>` + D.mod.flatMap(m => GENEROS.map(g => { const l = ts.filter(t => t.modalidade_id === m.id && t.genero === g)
      return l.length ? `<div class="sub" style="margin-top:6px">${esc(m.nome)} ${g}</div>${l.map(linha).join('')}` : '' })).join('') }).join('')
  return `<div class="card"><h3>Painel da Secretaria <small><button class="btn ghost sm" data-act="sair">Sair</button></small></h3>
    <div class="row"><span><b>Inscrições dos professores:</b> ${c.inscricoes_abertas ? '<span class="pill green">abertas</span>' : '<span class="pill red">encerradas</span>'}</span>
      <button class="btn ghost sm" data-act="inscricoes">${c.inscricoes_abertas ? 'Encerrar inscrições' : 'Reabrir inscrições'}</button></div></div>
    <div class="card"><h3>1. Modalidades</h3><div class="btns">${Object.keys(PRESETS).map(n => `<button class="btn ${temMod(n) ? 'ghost' : ''}" data-act="mod" data-nome="${n}" ${temMod(n) ? 'disabled' : ''}>${temMod(n) ? '✓ ' : '+ '}${n}</button>`).join('')}</div>
      <p class="sub" style="margin-top:6px">Futsal: 5 em quadra + até 5 reservas, 2 tempos de 10 min. Queimada: 10 participantes, 10 min. Masculino e feminino em ambas. Sem pontos: mata-mata, empate vai a pênaltis.</p></div>
    <div class="card"><h3>2. Séries (grupos) <small>${D.turmas.length} cadastrada(s)</small></h3><p class="sub" style="margin-bottom:6px">Cada série é um mini campeonato: os times das turmas dela (ex.: 1º ano 01 e 1º ano 02) se enfrentam entre si.</p><form data-form="turmas"><label>Uma série por linha (as que já existem são ignoradas)
      <textarea name="nomes">${esc(SERIES.filter(n => !D.turmas.some(t => t.nome === n)).join('\n'))}</textarea></label><button class="btn" style="margin-top:8px">Cadastrar séries</button></form>
      ${D.turmas.map(t => `<div class="row"><span>${esc(t.nome)} <small class="sub">${D.times.filter(x => x.turma_id === t.id).length} time(s)</small></span><button class="btn danger sm" data-act="del" data-tab="esc_turmas" data-id="${t.id}">Excluir</button></div>`).join('')}</div>
    <div class="card"><h3>3. Times e links dos professores <small>${D.times.filter(t => D.profs[t.id]).length} de ${D.times.length} com professor responsável</small></h3><form class="f" data-form="time">
      <label>Série (grupo)<select name="turma" required>${opcoes(D.turmas, t => t.nome)}</select></label>
      <label>Turma de origem<input name="origem" required maxlength="30" list="origens" placeholder="Ex.: 1º ano 01"></label><datalist id="origens">${ORIGENS.map(o => `<option value="${o}">`).join('')}</datalist>
      <label>Modalidade<select name="mod" required>${opcoes(D.mod, m => m.nome)}</select></label>
      <label>Gênero<select name="genero"><option value="masculino">Masculino</option><option value="feminino">Feminino</option></select></label>
      <label>Time<input name="nome" required minlength="1" maxlength="8" placeholder="Ex.: A"></label><div><button class="btn">Criar time</button></div></form>
      <div style="margin-top:10px">${tabela || '<p class="sub">Nenhum time ainda.</p>'}</div></div>
    <div class="card"><h3>4. Sorteio dos jogos</h3><p class="sub" style="margin-bottom:6px">Os confrontos e os coletes são sorteados pelo sistema, não escolhidos. Mata-mata: cada fase só sai quando a anterior estiver toda decidida.</p>
      ${grupos().map(x => `<div class="row"><span><b>${esc(x.t.nome)}</b> · ${esc(x.m.nome)} ${x.g} <small class="sub">${x.times.length} times</small></span><span>${
        x.r.erro ? `<small class="sub">${esc(x.r.erro)}</small>`
        : x.r.campeao ? `<span class="pill green">campeão: ${esc(timeDe(x.r.campeao)?.nome)}</span>`
        : x.r.pendente ? `<span class="pill amber">aguardando ${x.r.pendente} resultado(s)</span> ${x.partidas.every(p => p.placar_a == null) ? `<button class="btn ghost sm" data-act="refazer" data-key="${x.chave}">Refazer sorteio</button>` : ''}`
        : `<button class="btn sm" data-act="sortear" data-key="${x.chave}">${x.partidas.length ? 'Sortear próxima fase' : 'Sortear jogos'}</button>`}</span></div>`).join('') || '<p class="sub">Crie pelo menos 2 times no mesmo grupo.</p>'}
      ${grupos().filter(x => !x.partidas.length && !x.r.erro).length > 1 ? '<div style="margin-top:10px"><button class="btn gold" data-act="todos">Sortear todos os grupos que ainda não têm jogos</button></div>' : ''}</div>`
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
  time: async d => q(sb.from('esc_times').insert({campeonato_id: D.c.id, turma_id: d.turma, modalidade_id: d.mod, genero: d.genero, nome: `${d.origem.trim()} - ${d.nome.trim()}`})),
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
    if (act === 'sortear' || act === 'todos' || act === 'refazer') {
      if (act === 'refazer') { if (!confirm('Apagar os jogos sorteados deste grupo e sortear de novo?')) return
        const x = grupos().find(g => g.chave === b.dataset.key)
        await q(sb.from('esc_partidas').delete().eq('turma_id', x.t.id).eq('modalidade_id', x.m.id).eq('genero', x.g)); await carregar() }   // recarrega: o novo sorteio parte do grupo limpo
      const alvo = grupos().filter(x => act === 'todos' ? !x.partidas.length : x.chave === b.dataset.key)
      const linhas = alvo.flatMap(x => (x.r.jogos || []).map(j => ({turma_id: x.t.id, modalidade_id: x.m.id, genero: x.g, time_a_id: j.a, time_b_id: j.b, fase: x.r.fase, colete_a: j.colete})))
      if (!linhas.length) return toast('Nada para sortear agora.')
      await q(sb.from('esc_partidas').insert(linhas)); toast(`${linhas.length} jogo(s) sorteado(s).`)
    }
    if (act === 'inscricoes') await q(sb.from('esc_campeonatos').update({inscricoes_abertas: !D.c.inscricoes_abertas}).eq('id', D.c.id))
    if (act === 'mod') await q(sb.from('esc_modalidades').insert({campeonato_id: D.c.id, nome: b.dataset.nome, ...PRESETS[b.dataset.nome]}))
    if (act === 'del') { if (!confirm('Excluir? Isso não pode ser desfeito (jogos e alunos ligados também somem).')) return
      await q(sb.from(b.dataset.tab).delete().eq('id', b.dataset.id)) }
    await carregar()
  } catch (err) { toast(err.message) }
})

carregar().catch(err => { $('#app').innerHTML = `<div class="card empty">Não foi possível carregar (${esc(err.message)}). Confira a internet.</div>` })

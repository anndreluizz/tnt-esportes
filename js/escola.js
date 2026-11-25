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
// Reparte os jogos sem juiz de forma igual: sempre o juiz com menos jogos (empate sorteado). Devolve Map juizId -> [partidaId]. Quem já foi escalado não muda.
function reparteJuizes(juizes, partidas) {
  const carga = new Map(juizes.map(j => [j.id, partidas.filter(p => p.juiz_id === j.id).length])), por = new Map()
  if (!juizes.length) return por
  for (const p of partidas.filter(p => !p.juiz_id).sort((x, y) => ORDEM.indexOf(x.fase) - ORDEM.indexOf(y.fase))) {
    const min = Math.min(...carga.values()), j = embaralha(juizes.filter(x => carga.get(x.id) === min))[0]
    carga.set(j.id, min + 1); if (!por.has(j.id)) por.set(j.id, []); por.get(j.id).push(p.id)
  }
  return por
}
const GENEROS = ['masculino', 'feminino']
const grupos = () => D.turmas.flatMap(t => D.mod.flatMap(m => GENEROS.map(g => {
  const times = D.times.filter(x => x.turma_id === t.id && x.modalidade_id === m.id && x.genero === g)
  const partidas = D.partidas.filter(p => p.turma_id === t.id && p.modalidade_id === m.id && p.genero === g)
  return {t, m, g, times, partidas, chave: `${t.id}|${m.id}|${g}`, r: times.length ? proximaRodada(times, partidas) : null}
}))).filter(x => x.times.length >= 2)
// Pasta por modalidade (Futsal, Queimada): abre/fecha e lembra o que estava aberto entre as atualizações da tela
const abertas = new Set(['ja']); let fm = ''   // 'ja' = pasta "Jogos a jogar" já aberta; fm = filtro de modalidade do portal
const nat = (a, b) => a.localeCompare(b, 'pt', {numeric: true})
const pasta = (k, titulo, resumo, corpo) => `<details class="pasta" data-k="${k}"${abertas.has(k) ? ' open' : ''}><summary><b>${esc(titulo)}</b> <small>${esc(resumo)}</small></summary><div class="pasta-corpo">${corpo}</div></details>`
document.addEventListener('toggle', e => { const k = e.target.dataset?.k; if (k) e.target.open ? abertas.add(k) : abertas.delete(k) }, true)
let D = {}, sec = false, aviso = ''

async function carregar() {
  const {data: {session}} = await sb.auth.getSession()
  sec = !!session && (await sb.from('perfis').select('papel').eq('id', session.user.id)).data?.[0]?.papel === 'secretaria'
  const [c] = await q(sb.from('esc_campeonatos').select('*').order('inicio', {ascending: false}).limit(1))
  D = {c, mod: [], turmas: [], times: [], jog: [], partidas: [], juizes: [], links: {}, profs: {}}
  if (c) {
    const por = t => q(sb.from(t).select('*').eq('campeonato_id', c.id))
    ;[D.mod, D.turmas] = await Promise.all([por('esc_modalidades'), por('esc_turmas')])
    D.juizes = (await por('esc_juizes')).sort((x, y) => nat(x.nome, y.nome))
    D.times = await q(sb.from('esc_times').select('id,campeonato_id,turma_id,modalidade_id,genero,nome').eq('campeonato_id', c.id))   // sem a coluna token
    const ids = D.times.map(t => t.id), tid = D.turmas.map(t => t.id)
    D.jog = ids.length ? await q(sb.from('esc_jogadores').select('id,time_id,nome').in('time_id', ids).order('nome')) : []
    D.partidas = tid.length ? await q(sb.from('esc_partidas').select('*').in('turma_id', tid).order('fase').order('id')) : []
    if (sec) D.juiz = await q(sb.rpc('esc_juiz_link', {p_campeonato: c.id}))
    if (sec) for (const l of await q(sb.rpc('esc_links_times', {p_campeonato: c.id}))) { D.links[l.time_id] = l.token; D.profs[l.time_id] = l.professor }
    const pos = n => { const i = SERIES.indexOf(n); return i < 0 ? 99 : i }   // série na ordem do ensino (1º ano ... 9º ano, EJAI); fora da lista, no fim
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
const marca = p => p ? `${SUPABASE_URL}/storage/v1/object/public/marcas/${p}` : null   // logos e patrocinadores ficam no bucket público 'marcas'
let patN = 0
const patRow = (s, i = patN++) => `<div class="pat"><button type="button" class="x" data-act="rmpat" aria-label="Remover patrocinador">×</button>
  <label>Nome<input name="sp${i}" maxlength="40" required value="${esc(s?.nome || '')}" placeholder="Nome do patrocinador"></label>${s?.logo_path ? `<input type="hidden" name="spp${i}" value="${esc(s.logo_path)}"><img class="clogo" src="${esc(marca(s.logo_path))}" alt="" style="height:40px;width:auto;max-width:100%">` : ''}
  <label>Logo<input type="file" name="spl${i}" accept="image/*"></label></div>`
async function fit(file, max = 400) {   // reduz a imagem (o bucket aceita até 1 MB) e guarda como PNG
  const bmp = await createImageBitmap(file), k = Math.min(1, max / Math.max(bmp.width, bmp.height)), cv = document.createElement('canvas')
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k); cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height)
  return new Promise((ok, no) => cv.toBlob(b => b ? ok(b) : no(new Error('Imagem inválida.')), 'image/png'))
}
const sponsorsBar = c => (c.patrocinadores || []).length ? `<div class="sponsors"><span class="eyebrow">Patrocínio</span>${c.patrocinadores.map(s => s.logo_path ? `<img src="${esc(marca(s.logo_path))}" alt="${esc(s.nome)}" title="${esc(s.nome)}">` : `<b>${esc(s.nome)}</b>`).join('')}</div>` : ''
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
  const tabela = D.mod.map(m => { const dela = D.times.filter(t => t.modalidade_id === m.id); if (!dela.length) return ''
    return pasta('t' + m.id, m.nome, `${dela.length} times · ${dela.filter(t => D.profs[t.id]).length} com professor`, D.turmas.map(u => { const ts = dela.filter(t => t.turma_id === u.id); if (!ts.length) return ''
      return `<h4>${esc(u.nome)}</h4>` + GENEROS.map(g => { const l = ts.filter(t => t.genero === g)
        return l.length ? `<div class="grupo">${g}</div>${l.map(linha).join('')}` : '' }).join('') }).join('')) }).join('')
  const resumo = `<div class="resumo"><div><b>${D.turmas.length}</b><span>séries (grupos)</span></div><div><b>${D.times.length}</b><span>times</span></div>
    <div><b>${D.times.filter(t => D.profs[t.id]).length}/${D.times.length}</b><span>professores responsáveis</span></div><div><b>${D.jog.length}</b><span>alunos inscritos</span></div><div><b>${D.partidas.length}</b><span>jogos sorteados</span></div></div>`
  return resumo + `<div class="card"><h3>Painel da Secretaria <small><button class="btn ghost sm" data-act="sair">Sair</button></small></h3>
    <div class="row"><span><b>Inscrições dos professores:</b> ${c.inscricoes_abertas ? '<span class="pill green">abertas</span>' : '<span class="pill red">encerradas</span>'}</span>
      <button class="btn ghost sm" data-act="inscricoes">${c.inscricoes_abertas ? 'Encerrar inscrições' : 'Reabrir inscrições'}</button></div></div>
    <div class="card"><h3>Identidade do campeonato <small>logo, responsável e patrocínio aparecem no portal público</small></h3><form class="f" data-form="identidade">
      <label class="span2">Nome<input name="nome" required minlength="5" maxlength="80" value="${esc(c.nome)}"></label>
      <label>Responsável<input name="responsavel" maxlength="60" value="${esc(c.responsavel || '')}" placeholder="Nome de quem organiza"></label>
      <label>Local<input name="local" maxlength="80" value="${esc(c.local)}"></label>
      <label>Início<input name="inicio" type="date" required value="${esc(c.inicio)}"></label><label>Fim<input name="fim" type="date" required value="${esc(c.fim)}"></label>
      <label class="span2">Logo do campeonato ${c.logo_path ? `<img class="clogo" src="${esc(marca(c.logo_path))}" alt="" style="height:48px;width:auto;vertical-align:middle;margin-left:8px">` : ''}<input type="file" name="logo" accept="image/*"></label>
      <div class="span2"><h4>Patrocinadores <small class="sub">(opcional)</small></h4><div class="pats" id="pats">${(c.patrocinadores || []).map(s => patRow(s)).join('')}</div>
        <button type="button" class="btn ghost sm" data-act="addpat" style="margin-top:8px">+ Adicionar patrocinador</button></div>
      <div class="span2"><button class="btn">Salvar identidade</button></div></form></div>
    <div class="card"><h3>Juízes <small>${D.juizes.length} cadastrado(s) · escale em cada jogo, no passo 4</small></h3>
      <form class="f" data-form="juiz"><label class="span2">Nome do juiz<input name="nome" required minlength="3" maxlength="60" autocomplete="off" placeholder="Nome e sobrenome"></label><div class="span2"><button class="btn">Adicionar juiz</button></div></form>
      ${D.juizes.length && D.partidas.some(p => !p.juiz_id) ? `<div style="margin:8px 0"><button class="btn gold" data-act="distribuir">Distribuir os juízes nos ${D.partidas.filter(p => !p.juiz_id).length} jogos sem juiz</button><p class="sub" style="margin-top:4px">O sistema reparte igualmente, sorteando quem fica com cada jogo. Quem já foi escalado à mão não muda.</p></div>` : ''}
      ${D.juizes.map(j => `<div class="row"><span>${esc(j.nome)} <small class="sub">${D.partidas.filter(p => p.juiz_id === j.id).length} jogo(s)</small></span><button class="btn danger sm" data-act="del" data-tab="esc_juizes" data-id="${j.id}">Excluir</button></div>`).join('')}</div>
    <div class="card"><h3>Link do juiz <small>lança placar e pênaltis direto</small></h3>${(() => { const lk = new URL('juiz.html?t=' + D.juiz, location.href).href
      return `<p class="sub" style="margin-bottom:8px">Um link só para todos os jogos. Quem tem o link grava o resultado, então mande só aos juízes.</p><div class="btns"><button class="btn ghost sm" data-act="copiar" data-link="${esc(lk)}">Copiar link</button>
      <a class="btn ghost sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent('Mesa do juiz - Jogos Escolares. Lance o placar e os pênaltis por este link: ' + lk)}">WhatsApp</a></div>` })()}</div>
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
      ${D.mod.map(m => { const gs = grupos().filter(x => x.m.id === m.id); return gs.length ? pasta('s' + m.id, m.nome, `${gs.length} grupos · ${gs.filter(x => x.partidas.length).length} sorteados`, gs.map(x => `<div class="row"><span><b>${esc(x.t.nome)}</b> ${x.g} <small class="sub">${x.times.length} times</small></span><span>${
        x.r.erro ? `<small class="sub">${esc(x.r.erro)}</small>`
        : x.r.campeao ? `<span class="pill green">campeão: ${esc(timeDe(x.r.campeao)?.nome)}</span>`
        : x.r.pendente ? `<span class="pill amber">aguardando ${x.r.pendente} resultado(s)</span> ${x.partidas.every(p => p.placar_a == null) ? `<button class="btn ghost sm" data-act="refazer" data-key="${x.chave}">Refazer sorteio</button>` : ''}`
        : `<button class="btn sm" data-act="sortear" data-key="${x.chave}">${x.partidas.length ? 'Sortear próxima fase' : 'Sortear jogos'}</button>`}</span></div>`).join('')) : '' }).join('') || '<p class="sub">Crie pelo menos 2 times no mesmo grupo.</p>'}
      ${grupos().filter(x => !x.partidas.length && !x.r.erro).length > 1 ? '<div style="margin-top:10px"><button class="btn gold" data-act="todos">Sortear todos os grupos que ainda não têm jogos</button></div>' : ''}</div>`
}

function publico() {
  const c = D.c
  if (!c) return '<div class="card empty">O campeonato ainda não foi criado.</div>'
  const campeoes = new Map(D.partidas.filter(p => p.fase === 'final' && p.vencedor_id).map(p => [`${p.turma_id}|${p.modalidade_id}|${p.genero}`, p.vencedor_id]))
  const jogo = (p, leitura) => { const a = timeDe(p.time_a_id), b = timeDe(p.time_b_id), cb = p.colete_a === 'azul' ? 'vermelho' : 'azul'
    const lado = (t, cor) => `<b>${esc(t?.nome)}</b> <span class="pill ${cor === 'azul' ? 'blue' : 'red'}">${cor}</span>`
    const res = p.placar_a == null ? '<span class="pill">a jogar</span>' : `<b>${p.placar_a} x ${p.placar_b}</b>${p.penaltis_a != null ? ` <small class="sub">(pên. ${p.penaltis_a} x ${p.penaltis_b})</small>` : ''}`
    const edit = sec && !leitura ? `<form class="placar" data-form="placar" data-id="${p.id}"><select data-juiz="${p.id}" aria-label="Juiz do jogo"><option value="">Sem juiz</option>${D.juizes.map(j => `<option value="${j.id}"${j.id === p.juiz_id ? ' selected' : ''}>${esc(j.nome)}</option>`).join('')}</select><input name="pa" type="number" min="0" value="${p.placar_a ?? ''}" aria-label="Placar A"><input name="pb" type="number" min="0" value="${p.placar_b ?? ''}" aria-label="Placar B">
      <input name="ea" type="number" min="0" value="${p.penaltis_a ?? ''}" placeholder="pên. A" aria-label="Pênaltis A"><input name="eb" type="number" min="0" value="${p.penaltis_b ?? ''}" placeholder="pên. B" aria-label="Pênaltis B">
      <button class="btn sm">Salvar</button><button type="button" class="btn danger sm" data-act="del" data-tab="esc_partidas" data-id="${p.id}">Excluir</button></form>` : ''
    return `<div class="row"><span><span class="pill">${esc(p.fase)}</span> ${lado(a, p.colete_a)} × ${lado(b, cb)}</span><span>${p.juiz_id ? `<small class="sub">Juiz: ${esc(D.juizes.find(j => j.id === p.juiz_id)?.nome)}</small> ` : ''}${res}${p.vencedor_id ? ` <span class="pill green">vence ${esc(timeDe(p.vencedor_id)?.nome)}</span>` : ''}</span>${edit}</div>` }
  const grupos = D.mod.map(m => { const corpo = D.turmas.map(t => {
    const blocos = ['masculino', 'feminino'].map(g => {
      const times = D.times.filter(x => x.turma_id === t.id && x.modalidade_id === m.id && x.genero === g); if (!times.length) return ''
      const camp = campeoes.get(`${t.id}|${m.id}|${g}`), ps = D.partidas.filter(p => p.turma_id === t.id && p.modalidade_id === m.id && p.genero === g)
      return `<div class="bloco"><h4>${esc(m.nome)} ${g}${camp ? ` · <span class="pill green">campeão: ${esc(timeDe(camp)?.nome)}</span>` : ''}</h4>
        ${times.map(x => { const js = D.jog.filter(j => j.time_id === x.id); return `<div class="elenco"><b>${esc(x.nome)}</b> (${js.length}/${m.jogadores_por_time + m.reservas_max}): ${js.length ? js.map(j => esc(j.nome)).join(', ') : 'sem alunos inscritos'}</div>` }).join('')}
        ${ps.map(p => jogo(p)).join('')}</div>` }).join('')
    return blocos ? `<div class="card"><h3>${esc(t.nome)}</h3><div class="blocos">${blocos}</div></div>` : '' }).join('')
    const nt = D.times.filter(x => x.modalidade_id === m.id).length
    return corpo ? pasta('p' + m.id, m.nome, `${nt} times`, corpo) : '' }).join('')
  // Portal dos jogos: todos os jogos juntos (a jogar primeiro), com filtro por modalidade. A página se atualiza sozinha.
  const lista = D.partidas.filter(p => !fm || p.modalidade_id === fm).sort((x, y) => ORDEM.indexOf(x.fase) - ORDEM.indexOf(y.fase) || nat(nomeTurma(x.turma_id), nomeTurma(y.turma_id)))
  const linhaJogo = p => `<div class="sub" style="margin-top:8px">${esc(nomeMod(p.modalidade_id))} ${p.genero} · ${esc(nomeTurma(p.turma_id))}</div>${jogo(p, true)}`
  const aJogar = lista.filter(p => p.placar_a == null), feitos = lista.filter(p => p.placar_a != null)
  const portal = D.partidas.length ? `<div class="btns chips"><button class="btn ${fm ? 'ghost' : ''}" data-act="fm" data-m="">Todas</button>${D.mod.map(m => `<button class="btn ${fm === m.id ? '' : 'ghost'}" data-act="fm" data-m="${m.id}">${esc(m.nome)}</button>`).join('')}</div>
    ${pasta('ja', 'Jogos a jogar', `${aJogar.length}`, aJogar.map(linhaJogo).join('') || '<p class="sub">Nenhum jogo pendente.</p>')}${pasta('jr', 'Resultados', `${feitos.length}`, feitos.map(linhaJogo).join('') || '<p class="sub">Ainda sem resultados.</p>')}` : ''
  return `<div class="hero"><div><div class="eyebrow">Campeonato interno da escola</div><div style="display:flex;gap:14px;align-items:center">${c.logo_path ? `<img class="clogo" src="${esc(marca(c.logo_path))}" alt="" style="width:64px;height:64px">` : ''}<h2>${esc(c.nome)}</h2></div>
    <div style="color:#d6e2f7;font-size:14px;margin-top:4px">${dmy(c.inicio)} a ${dmy(c.fim)} · ${esc(c.local)}${c.responsavel ? ` · Responsável: ${esc(c.responsavel)}` : ''}</div></div></div>${sponsorsBar(c)}${portal}${grupos || '<div class="card empty">Ainda não há times cadastrados.</div>'}`
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
  identidade: async d => { const t = v => v?.trim() || null
    const envia = async (file, nome) => { if (!file?.size) return null; const path = `escola/${D.c.id}/${nome}-${Date.now()}.png`
      const {error} = await sb.storage.from('marcas').upload(path, await fit(file), {contentType: 'image/png'}); if (error) throw new Error('Imagem não enviada: ' + error.message); return path }
    const patrocinadores = []
    for (const i of Object.keys(d).filter(k => /^sp\d+$/.test(k)).map(k => k.slice(2))) if (t(d['sp' + i])) patrocinadores.push({nome: t(d['sp' + i]), logo_path: (await envia(d['spl' + i], 'patrocinio-' + i)) || d['spp' + i] || null})
    const upd = {nome: d.nome.trim(), responsavel: t(d.responsavel), local: t(d.local) || 'A definir', inicio: d.inicio, fim: d.fim, patrocinadores}
    const logo = await envia(d.logo, 'logo'); if (logo) upd.logo_path = logo
    await q(sb.from('esc_campeonatos').update(upd).eq('id', D.c.id)) },
  juiz: async d => q(sb.from('esc_juizes').insert({campeonato_id: D.c.id, nome: d.nome.trim().replace(/\s+/g, ' ')})),
  placar: async (d, f) => { const n = v => v === '' ? null : +v
    await q(sb.from('esc_partidas').update({placar_a: n(d.pa), placar_b: n(d.pb), penaltis_a: n(d.ea), penaltis_b: n(d.eb)}).eq('id', f.dataset.id)) },
  login: async d => { const {error} = await sb.auth.signInWithPassword({email: d.email, password: d.senha}); if (error) throw new Error('E-mail ou senha incorretos.') },
}
document.addEventListener('change', async e => {   // escalar o juiz num jogo
  if (e.target.dataset?.juiz === undefined) return
  try { await q(sb.from('esc_partidas').update({juiz_id: e.target.value || null}).eq('id', e.target.dataset.juiz)); toast('Juiz escalado.'); await carregar() } catch (err) { toast(err.message) }
})
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
    if (act === 'distribuir') {   // reparte os jogos sem juiz de forma igual (sempre o juiz com menos jogos; empate sorteado)
      if (!D.juizes.length) return toast('Cadastre os juízes primeiro.')
      const por = reparteJuizes(D.juizes, D.partidas), n = [...por.values()].reduce((s, l) => s + l.length, 0)
      if (!n) return toast('Todos os jogos já têm juiz.')
      for (const [jid, ids] of por) for (let i = 0; i < ids.length; i += 40) await q(sb.from('esc_partidas').update({juiz_id: jid}).in('id', ids.slice(i, i + 40)))
      toast(`${n} jogo(s) distribuídos entre ${por.size} juiz(es).`)
    }
    if (act === 'addpat') { document.querySelector('#pats').insertAdjacentHTML('beforeend', patRow()); return }
    if (act === 'rmpat') { b.closest('.pat').remove(); return }
    if (act === 'fm') { fm = b.dataset.m; return render() }
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
setInterval(() => { if (!sec && !document.hidden) carregar().catch(() => {}) }, 30000)   // público: placar novo aparece sozinho

if (/[?&]embed/.test(location.search) && window.ResizeObserver) new ResizeObserver(() => parent.postMessage({escolaAltura: document.documentElement.scrollHeight}, location.origin)).observe(document.body)   // dentro do sistema: a moldura acompanha a altura

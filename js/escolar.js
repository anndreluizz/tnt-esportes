// Jogos Escolares como campeonato do sistema (ponte): lê o campeonato interno da escola (tabelas esc_*) e o põe em S.champs com a marca
// `escolar`, para aparecer em Campeonatos, Jogos, Equipes, Relatórios, Divulgação e Portal público, com logo, responsável e patrocínio.
// Só leitura aqui. Cadastro, sorteio e lançamento de resultado continuam na aba "Jogos Escolares" (e o juiz pelo link).
// As telas do sistema que não conhecem o modelo escolar nunca recebem esse campeonato: VIEWS é embrulhado abaixo.
const escMarca = p => p ? `${SUPABASE_URL}/storage/v1/object/public/marcas/${p}` : null
const ESC_ORDEM = ['oitavas', 'quartas', 'semifinal', 'final']
const escNat = (a, b) => String(a).localeCompare(String(b), 'pt', {numeric: true})

async function escolarCamps() {
  const POR = [['id', true]], out = []
  for (const e of await ler('esc_campeonatos', [['inicio', false], ['id', true]])) {
    const por = (t, cols = '*') => ler(t, POR, cols, q => q.eq('campeonato_id', e.id))
    const [mod, turmas, times] = await Promise.all([por('esc_modalidades'), por('esc_turmas'), por('esc_times', 'id,campeonato_id,turma_id,modalidade_id,genero,nome')])
    const ids = new Set(times.map(t => t.id)), jog = (await ler('esc_jogadores', POR, 'id,time_id,nome')).filter(j => ids.has(j.time_id))
    const tids = new Set(turmas.map(t => t.id)), partidas = (await ler('esc_partidas', POR)).filter(p => tids.has(p.turma_id))
    const SERIES = ['1º ano', '2º ano', '3º ano', '4º ano', '5º ano', '6º ano', '7º ano', '8º ano', '9º ano']
    const pos = n => { const i = SERIES.indexOf(n); return i < 0 ? 99 : i }
    turmas.sort((x, y) => pos(x.nome) - pos(y.nome) || escNat(x.nome, y.nome)); times.sort((x, y) => escNat(x.nome, y.nome)); mod.sort((x, y) => escNat(x.nome, y.nome))
    out.push({teams: [], players: [], matches: [], punishments: [], draw: null, log: [], escolar: true, id: 'esc-' + e.id, name: e.nome, sport: 'Futsal', category: 'Escolar',
      minAge: 6, maxAge: null, start: e.inicio, end: e.fim, venue: e.local, status: partidas.some(p => p.placar_a != null) ? 'andamento' : e.inscricoes_abertas ? 'inscricoes' : 'andamento',
      logo: escMarca(e.logo_path), responsible: e.responsavel, sponsors: (e.patrocinadores || []).map(s => ({name: s.nome, logo: escMarca(s.logo_path)})),
      esc: {mod, turmas, times, jog, partidas}})
  }
  return out
}

/* ---------- telas (só leitura) ---------- */
const escTime = (c, id) => c.esc.times.find(t => t.id === id)
const escSerie = (c, id) => c.esc.turmas.find(t => t.id === id)?.nome || '?'
const escMod = (c, id) => c.esc.mod.find(m => m.id === id)?.nome || '?'
const escPasta = (titulo, resumo, corpo, aberta) => `<details class="pasta"${aberta ? ' open' : ''}><summary><b>${esc(titulo)}</b> <small>${esc(resumo)}</small></summary><div class="pasta-corpo">${corpo}</div></details>`
const escGerir = () => role() === 'secretaria' ? '<button class="btn ghost sm" data-act="tab" data-tab="escolar">Gerenciar em Jogos Escolares</button>' : ''

function escJogo(c, p) {
  const a = escTime(c, p.time_a_id), b = escTime(c, p.time_b_id), cb = p.colete_a === 'azul' ? 'vermelho' : 'azul'
  const lado = (t, cor) => `<b>${esc(t?.nome)}</b> <span class="pill ${cor === 'azul' ? 'blue' : 'red'}">${cor}</span>`
  const res = p.placar_a == null ? '<span class="pill">a jogar</span>' : `<b>${p.placar_a} x ${p.placar_b}</b>${p.penaltis_a != null ? ` <small class="sub">(pên. ${p.penaltis_a} x ${p.penaltis_b})</small>` : ''}`
  return `<div class="sub" style="margin-top:8px">${esc(escMod(c, p.modalidade_id))} ${p.genero} · ${esc(escSerie(c, p.turma_id))}</div>
    <div class="row"><span><span class="pill">${esc(p.fase)}</span> ${lado(a, p.colete_a)} × ${lado(b, cb)}</span><span>${res}${p.vencedor_id ? ` <span class="pill green">vence ${esc(escTime(c, p.vencedor_id)?.nome)}</span>` : ''}</span></div>`
}
function escListaJogos(c) {
  const fm = ui.escfm || '', ps = c.esc.partidas.filter(p => !fm || p.modalidade_id === fm)
    .sort((x, y) => ESC_ORDEM.indexOf(x.fase) - ESC_ORDEM.indexOf(y.fase) || escNat(escSerie(c, x.turma_id), escSerie(c, y.turma_id)))
  const ja = ps.filter(p => p.placar_a == null), feitos = ps.filter(p => p.placar_a != null)
  const chips = `<div class="chips"><button class="${fm ? '' : 'on'}" data-act="escfm" data-m="">Todas</button>${c.esc.mod.map(m => `<button class="${fm === m.id ? 'on' : ''}" data-act="escfm" data-m="${m.id}">${esc(m.nome)}</button>`).join('')}</div>`
  if (!c.esc.partidas.length) return '<div class="card empty mt">Os jogos ainda não foram sorteados.</div>'
  return chips + escPasta('Jogos a jogar', String(ja.length), ja.map(p => escJogo(c, p)).join('') || '<p class="sub">Nenhum jogo pendente.</p>', true)
    + escPasta('Resultados', String(feitos.length), feitos.map(p => escJogo(c, p)).join('') || '<p class="sub">Ainda sem resultados.</p>')
}
const escHead = (c, olho, titulo, extra = '') => `<div class="head"><div><div class="eyebrow">${olho}</div><h2>${titulo}</h2><p class="sub">${esc(c.name)}</p></div>${extra}</div>`
const escCampeoes = c => c.esc.partidas.filter(p => p.fase === 'final' && p.vencedor_id).map(p => `<div class="row"><span>${esc(escMod(c, p.modalidade_id))} ${p.genero} · ${esc(escSerie(c, p.turma_id))}</span><span class="pill green">campeão: ${esc(escTime(c, p.vencedor_id)?.nome)}</span></div>`).join('')

const ESC_VIEWS = {
  painel: c => { const e = c.esc, feitos = e.partidas.filter(p => p.placar_a != null).length
    return escHead(c, 'Painel', 'Jogos Escolares', escGerir()) + `<div class="grid g4">${stat(e.turmas.length, 'séries (grupos)')}${stat(e.times.length, 'times')}${stat(e.jog.length, 'alunos inscritos')}${stat(e.partidas.length, 'jogos sorteados')}</div>
      <div class="grid g4 mt">${stat(e.partidas.length - feitos, 'jogos a jogar')}${stat(feitos, 'jogos decididos')}${stat(e.mod.length, 'modalidades')}${stat(e.partidas.filter(p => p.fase === 'final' && p.vencedor_id).length, 'campeões')}</div>
      <div class="card mt"><h3>Campeões</h3>${escCampeoes(c) || '<p class="sub">Os campeões aparecem aqui quando as finais forem decididas.</p>'}</div>${sponsorsBar(c)}` },
  inscricoes: c => escHead(c, 'Equipes', 'Times e alunos', escGerir()) + c.esc.mod.map(m => {
    const ts = c.esc.times.filter(t => t.modalidade_id === m.id)
    return ts.length ? escPasta(m.nome, `${ts.length} times`, c.esc.turmas.map(u => { const l = ts.filter(t => t.turma_id === u.id); if (!l.length) return ''
      return `<h4>${esc(u.nome)}</h4>` + ['masculino', 'feminino'].map(g => { const x = l.filter(t => t.genero === g)
        return x.length ? `<div class="grupo">${g}</div>${x.map(t => { const js = c.esc.jog.filter(j => j.time_id === t.id)
          return `<div class="row"><span><b>${esc(t.nome)}</b> <small class="sub">${js.length} aluno(s)</small>${js.length ? `<br><small class="sub">${js.map(j => esc(j.nome)).join(', ')}</small>` : ''}</span></div>` }).join('')}` : '' }).join('') }).join('')) : '' }).join(''),
  jogos: c => escHead(c, 'Jogos', 'Jogos e resultados', escGerir()) + escListaJogos(c),
  sumula: c => escHead(c, 'Súmula', 'Resultado dos jogos') + `<div class="card"><p class="sub">Nos Jogos Escolares o juiz lança o placar e os pênaltis direto, pelo link da mesa do juiz.</p>${escGerir()}</div>`,
  sorteio: c => escHead(c, 'Sorteio', 'Sorteio dos jogos') + `<div class="card"><p class="sub">Os confrontos são sorteados pelo sistema (mata-mata, por série), na aba Jogos Escolares.</p>${escGerir()}</div>`,
  relatorios: c => escHead(c, 'Relatórios', 'Relatórios') + `<div class="card"><h3>Resultados e campeões</h3>${escCampeoes(c) || '<p class="sub">Sem campeões ainda.</p>'}</div><p class="note">Relatórios impressos (lista de times e alunos, resultados) chegam na próxima etapa.</p>`,
  divulgacao: c => escHead(c, 'Divulgação', 'Divulgação') + '<div class="card"><p class="sub">Os cards de resultado e de próximos jogos do campeonato escolar chegam na próxima etapa.</p></div>',
  portal: c => `<div class="chips">${S.champs.map(x => `<button class="${x.id === c.id ? 'on' : ''}" data-act="pchamp" data-id="${x.id}">${esc(x.name)}</button>`).join('')}</div>
    <div class="phero"><div><div class="eyebrow">Portal público · sem login</div><div style="display:flex;gap:14px;align-items:center">${clogo(c.logo, 64)}<h2>${esc(c.name)}</h2></div>
    <p>${dmy(c.start)} a ${dmy(c.end)} · ${esc(c.venue)}${c.responsible ? ` · Responsável: ${esc(c.responsible)}` : ''}</p></div></div>${sponsorsBar(c)}
    ${escCampeoes(c) ? `<div class="card mt"><h3>Campeões</h3>${escCampeoes(c)}</div>` : ''}<div class="mt">${escListaJogos(c)}</div>`,
}
for (const k of Object.keys(VIEWS)) { const orig = VIEWS[k]; if (ESC_VIEWS[k]) VIEWS[k] = () => C()?.escolar ? ESC_VIEWS[k](C()) : orig() }
A.escfm = d => { ui.escfm = d.m }

function escolarCards() {   // cartões em Campeonatos (a lista normal não recebe o campeonato escolar)
  return S.champs.filter(c => c.escolar).map(c => `<div class="card champ"><div class="cimg" style="--f:url(img/faixa-ginasio.jpg)"><div class="tags">${cpill(c)}<span class="pill">Futsal e Queimada</span><span class="pill">Escolar</span></div>
    <div class="ctit">${clogo(c.logo)}<h3>${esc(c.name)}</h3></div></div><div class="cbody">
    <p class="sub">${dmy(c.start)} a ${dmy(c.end)} · ${esc(c.venue)}</p>${c.responsible ? `<p class="sub">Responsável: ${esc(c.responsible)}</p>` : ''}
    <p class="sub">${c.esc.times.length} times · ${c.esc.jog.length} alunos · ${c.esc.partidas.length} jogos sorteados</p>${sponsorsBar(c)}
    <div class="btns" style="margin-top:10px"><button class="btn sm" data-act="champ" data-id="${c.id}">${c.id === S.champId ? 'Abrir painel' : 'Selecionar'}</button>
      ${role() === 'secretaria' ? '<button class="btn ghost sm" data-act="tab" data-tab="escolar">Editar identidade e gerenciar</button>' : ''}</div></div></div>`).join('')
}

// Jogos Escolares como campeonato do sistema (ponte): lê o campeonato interno da escola (tabelas esc_*) e o põe em S.champs com a marca
// `escolar`, para aparecer em Campeonatos, Jogos, Equipes, Relatórios, Divulgação e Portal público, com logo, responsável e patrocínio.
// Só leitura aqui. Cadastro, sorteio e lançamento de resultado continuam na aba "Jogos Escolares" (e o juiz pelo link).
// As telas do sistema que não conhecem o modelo escolar nunca recebem esse campeonato: VIEWS é embrulhado abaixo.
const escMarca = p => p ? `${SUPABASE_URL}/storage/v1/object/public/marcas/${p}` : null
const ESC_ORDEM = ['oitavas', 'quartas', 'semifinal', 'final']
const escNat = (a, b) => String(a).localeCompare(String(b), 'pt', {numeric: true})
const escHora = h => String(h || '').slice(0, 5), escDm = d => d.slice(8) + '/' + d.slice(5, 7)
const escDia = d => ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(d + 'T12:00:00').getDay()]
const escCmpH = (x, y) => (x.data ? x.data + escHora(x.hora) : '9').localeCompare(y.data ? y.data + escHora(y.hora) : '9')   // com horário primeiro

async function escolarCamps() {
  const POR = [['id', true]], out = []
  for (const e of await ler('esc_campeonatos', [['inicio', false], ['id', true]])) {
    const por = (t, cols = '*') => ler(t, POR, cols, q => q.eq('campeonato_id', e.id))
    const [mod, turmas, times] = await Promise.all([por('esc_modalidades'), por('esc_turmas'), por('esc_times', 'id,campeonato_id,turma_id,modalidade_id,genero,nome')])
    const juizes = await por('esc_juizes')
    const ids = new Set(times.map(t => t.id)), jog = (await ler('esc_jogadores', POR, 'id,time_id,nome')).filter(j => ids.has(j.time_id))
    const tids = new Set(turmas.map(t => t.id)), partidas = (await ler('esc_partidas', POR)).filter(p => tids.has(p.turma_id))
    const SERIES = ['1º ano', '2º ano', '3º ano', '4º ano', '5º ano', '6º ano', '7º ano', '8º ano', '9º ano']
    const pos = n => { const i = SERIES.indexOf(n); return i < 0 ? 99 : i }
    turmas.sort((x, y) => pos(x.nome) - pos(y.nome) || escNat(x.nome, y.nome)); times.sort((x, y) => escNat(x.nome, y.nome)); mod.sort((x, y) => escNat(x.nome, y.nome))
    let profs = 0   // só a Secretaria enxerga quem já preencheu o nome de professor responsável
    if (role() === 'secretaria') try { profs = (await sb.rpc('esc_links_times', {p_campeonato: e.id})).data.filter(l => l.professor).length } catch {}
    out.push({teams: [], players: [], matches: [], punishments: [], draw: null, log: [], escolar: true, id: 'esc-' + e.id, name: e.nome, sport: 'Futsal', category: 'Escolar',
      minAge: 6, maxAge: null, start: e.inicio, end: e.fim, venue: e.local, status: partidas.some(p => p.placar_a != null) ? 'andamento' : e.inscricoes_abertas ? 'inscricoes' : 'andamento',
      logo: escMarca(e.logo_path), responsible: e.responsavel, sponsors: (e.patrocinadores || []).map(s => ({name: s.nome, logo: escMarca(s.logo_path)})),
      esc: {mod, turmas, times, jog, partidas, profs, juizes}})
  }
  return out
}

/* ---------- telas (só leitura) ---------- */
const escTime = (c, id) => c.esc.times.find(t => t.id === id)
const escSerie = (c, id) => c.esc.turmas.find(t => t.id === id)?.nome || '?'
const escMod = (c, id) => c.esc.mod.find(m => m.id === id)?.nome || '?'
const escPasta = (titulo, resumo, corpo, aberta) => `<details class="pasta"${aberta ? ' open' : ''}><summary><b>${esc(titulo)}</b> <small>${esc(resumo)}</small></summary><div class="pasta-corpo">${corpo}</div></details>`
const escGerir = () => role() === 'secretaria' ? '<button class="btn ghost sm" data-act="tab" data-tab="escolar">Gerenciar em Jogos Escolares</button>' : ''

function escJogo(c, p) {   // cartão do jogo: série e fase em cima, os dois times (cor do colete) e o placar no meio, horário e juiz embaixo
  const a = escTime(c, p.time_a_id), b = escTime(c, p.time_b_id), cb = p.colete_a === 'azul' ? 'vermelho' : 'azul', feito = p.placar_a != null
  const juiz = p.juiz_id ? c.esc.juizes.find(j => j.id === p.juiz_id)?.nome : ''
  return `<article class="ec-card"><div class="ec-top"><span>${esc(escMod(c, p.modalidade_id))} ${p.genero} · ${esc(escSerie(c, p.turma_id))}</span><span class="pill">${esc(p.fase)}</span></div>
    <div class="ec-vs"><span class="ec-t ${p.colete_a}">${esc(a?.nome)}</span>${feito ? `<b class="ec-pl">${p.placar_a} x ${p.placar_b}</b>` : '<span class="ec-x">×</span>'}<span class="ec-t ${cb}">${esc(b?.nome)}</span></div>
    ${feito && p.penaltis_a != null ? `<div class="sub" style="text-align:center">pênaltis ${p.penaltis_a} x ${p.penaltis_b}</div>` : ''}${p.vencedor_id ? `<div style="text-align:center"><span class="pill green">vence ${esc(escTime(c, p.vencedor_id)?.nome)}</span></div>` : ''}
    <div class="ec-foot"><span>${p.data ? `<b>${escDia(p.data)} ${escDm(p.data)} · ${escHora(p.hora)} · Quadra ${p.quadra}</b>` : 'Horário a definir'}</span>${juiz ? `<span>Juiz: ${esc(juiz)}</span>` : ''}</div></article>`
}
const escJogos = (c, l) => l.length ? `<div class="ec-grid">${l.map(p => escJogo(c, p)).join('')}</div>` : ''
function escListaJogos(c) {
  const fm = ui.escfm || '', ps = c.esc.partidas.filter(p => !fm || p.modalidade_id === fm)
    .sort((x, y) => escCmpH(x, y) || ESC_ORDEM.indexOf(x.fase) - ESC_ORDEM.indexOf(y.fase) || escNat(escSerie(c, x.turma_id), escSerie(c, y.turma_id)))
  const ja = ps.filter(p => p.placar_a == null), feitos = ps.filter(p => p.placar_a != null)
  const chips = `<div class="chips"><button class="${fm ? '' : 'on'}" data-act="escfm" data-m="">Todas</button>${c.esc.mod.map(m => `<button class="${fm === m.id ? 'on' : ''}" data-act="escfm" data-m="${m.id}">${esc(m.nome)}</button>`).join('')}</div>`
  if (!c.esc.partidas.length) return '<div class="card empty mt">Os jogos ainda não foram sorteados.</div>'
  const dias = [...new Set(ps.filter(p => p.data).map(p => p.data))].sort(), hoje = new Date().toISOString().slice(0, 10), alvo = dias.find(d => d >= hoje) || dias[0]
  const programacao = dias.map(d => { const js = ps.filter(p => p.data === d)
    return escPasta(`${escDia(d)} ${escDm(d)}`, `${js.length} jogo(s) · ${escHora(js[0].hora)} às ${escHora(js[js.length - 1].hora)}`, escJogos(c, js), d === alvo) }).join('')
  return chips + programacao + escPasta('Jogos a jogar', String(ja.length), escJogos(c, ja) || '<p class="sub">Nenhum jogo pendente.</p>', true)
    + escPasta('Resultados', String(feitos.length), escJogos(c, feitos) || '<p class="sub">Ainda sem resultados.</p>')
}
const escHead = (c, olho, titulo, extra = '') => `<div class="head"><div><div class="eyebrow">${olho}</div><h2>${titulo}</h2><p class="sub">${esc(c.name)}</p></div>${extra}</div>`
// campeões: quem venceu a final + time único do grupo (campeão direto, sem jogo)
const escLista = c => [
  ...c.esc.partidas.filter(p => p.fase === 'final' && p.vencedor_id).map(p => ({mdl: escMod(c, p.modalidade_id), genero: p.genero, serie: escSerie(c, p.turma_id), nome: escTime(c, p.vencedor_id)?.nome, direto: false})),
  ...c.esc.turmas.flatMap(u => c.esc.mod.flatMap(m => ['masculino', 'feminino'].map(g => ({u, m, g, ts: c.esc.times.filter(t => t.turma_id === u.id && t.modalidade_id === m.id && t.genero === g)})))).filter(x => x.ts.length === 1)
    .map(x => ({mdl: x.m.nome, genero: x.g, serie: x.u.nome, nome: x.ts[0].nome, direto: true}))]
const escCampeoes = c => role() !== 'secretaria' ? '' : escLista(c).map(x => `<div class="row"><span>${esc(x.mdl)} ${x.genero} · ${esc(x.serie)}</span><span class="pill green">${x.direto ? 'campeão direto' : 'campeão'}: ${esc(x.nome)}</span></div>`).join('')

const ESC_VIEWS = {
  painel: c => { const e = c.esc, feitos = e.partidas.filter(p => p.placar_a != null).length
    return escHead(c, 'Painel', 'Jogos Escolares', escGerir()) + `<div class="grid g4">${stat(e.turmas.length, 'séries (grupos)')}${stat(e.times.length, 'times')}${stat(e.jog.length, 'alunos inscritos')}${stat(e.partidas.length, 'jogos sorteados')}</div>
      <div class="grid g4 mt">${stat(e.partidas.length - feitos, 'jogos a jogar')}${stat(feitos, 'jogos decididos')}${stat(e.mod.length, 'modalidades')}${stat(escLista(c).length, 'campeões')}</div>
      ${role() === 'secretaria' ? escPassos(c) : ''}<div class="card mt"><h3>Campeões</h3>${escCampeoes(c) || '<p class="sub">Os campeões aparecem aqui quando as finais forem decididas.</p>'}</div>${sponsorsBar(c)}` },
  inscricoes: c => escHead(c, 'Equipes', 'Times e alunos', escGerir()) + c.esc.mod.map(m => {
    const ts = c.esc.times.filter(t => t.modalidade_id === m.id)
    return ts.length ? escPasta(m.nome, `${ts.length} times`, c.esc.turmas.map(u => { const l = ts.filter(t => t.turma_id === u.id); if (!l.length) return ''
      return `<h4>${esc(u.nome)}</h4>` + ['masculino', 'feminino'].map(g => { const x = l.filter(t => t.genero === g)
        return x.length ? `<div class="grupo">${g}</div>${x.map(t => { const js = c.esc.jog.filter(j => j.time_id === t.id)
          return `<div class="row"><span><b>${esc(t.nome)}</b> <small class="sub">${js.length} aluno(s)</small>${js.length ? `<br><small class="sub">${js.map(j => esc(j.nome)).join(', ')}</small>` : ''}</span></div>` }).join('')}` : '' }).join('') }).join('')) : '' }).join(''),
  jogos: c => escHead(c, 'Jogos', 'Jogos e resultados', escGerir()) + escListaJogos(c),
  sumula: c => escHead(c, 'Súmula', 'Resultado dos jogos') + `<div class="card"><p class="sub">Nos Jogos Escolares o juiz lança o placar e os pênaltis direto, pelo link da mesa do juiz.</p>${escGerir()}</div>`,
  sorteio: c => escHead(c, 'Sorteio', 'Sorteio dos jogos') + `<div class="card"><p class="sub">Os confrontos são sorteados pelo sistema (mata-mata, por série), na aba Jogos Escolares.</p>${escGerir()}</div>`,
  relatorios: c => escRelatorio(c),
  divulgacao: c => `<div class="head"><div><div class="eyebrow">Divulgação · ${esc(c.name)}</div><h2>Imagens prontas para o WhatsApp</h2><p class="sub">Geradas na hora com os dados oficiais. No celular, “Compartilhar” abre direto o WhatsApp. Só aparecem nomes de times, nunca de alunos.</p></div></div>`
    + (c.esc.partidas.length ? `<div class="grid g3">${ESC_CARDS.map((n, i) => `<div class="card"><div class="cv" id="cv${i}"></div><div class="btns" style="margin-top:10px"><button class="btn" data-act="share" data-i="${i}">Compartilhar</button><button class="btn ghost" data-act="dl" data-i="${i}">Baixar</button></div></div>`).join('')}</div>`
      : '<div class="card empty">As imagens ficam disponíveis depois do sorteio dos jogos.</div>'),
  portal: c => `<div class="chips">${S.champs.map(x => `<button class="${x.id === c.id ? 'on' : ''}" data-act="pchamp" data-id="${x.id}">${esc(x.name)}</button>`).join('')}</div>
    <header class="ehero"><div class="eyebrow">Campeonato interno da escola</div><div class="ehead">${clogo(c.logo, 72)}<h2>${esc(c.name)}</h2></div>
    <div class="pub-chips"><span>${dmy(c.start)} a ${dmy(c.end)}</span><span>${esc(c.venue)}</span>${c.responsible ? `<span>Responsável: ${esc(c.responsible)}</span>` : ''}</div>
    <div class="pub-stats">${[[c.esc.turmas.length, 'séries'], [c.esc.times.length, 'times'], [c.esc.jog.length, 'alunos'], [new Set(c.esc.partidas.map(p => p.data).filter(Boolean)).size || 3, 'dias de jogos']].map(([n, r]) => `<div class="pub-stat"><b>${n}</b><span>${r}</span></div>`).join('')}</div></header>${sponsorsBar(c)}
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

/* ---------- Relatórios (imprimir / salvar PDF) ---------- */
function escRelatorio(c) {
  const e = c.esc, feitos = e.partidas.filter(p => p.placar_a != null).length
  const linhas = e.mod.flatMap(m => e.turmas.flatMap(u => ['masculino', 'feminino'].map(g => {
    const ts = e.times.filter(t => t.turma_id === u.id && t.modalidade_id === m.id && t.genero === g); if (!ts.length) return ''
    const ps = e.partidas.filter(p => p.turma_id === u.id && p.modalidade_id === m.id && p.genero === g), fin = ps.find(p => p.fase === 'final' && p.vencedor_id)
    return `<tr><td class="l">${esc(u.nome)}</td><td class="l">${esc(m.nome)} ${g}</td><td>${ts.length}</td><td>${e.jog.filter(j => ts.some(t => t.id === j.time_id)).length}</td><td>${ps.filter(p => p.placar_a != null).length}/${ps.length}</td><td class="l">${fin ? `<b>${esc(escTime(c, fin.vencedor_id)?.nome)}</b>` : '—'}</td></tr>` }))).join('')
  const lista = e.mod.map(m => { const ts = e.times.filter(t => t.modalidade_id === m.id)
    return ts.length ? escPasta(m.nome, `${ts.length} times`, e.turmas.map(u => { const l = ts.filter(t => t.turma_id === u.id); if (!l.length) return ''
      return `<h4>${esc(u.nome)}</h4>` + l.map(t => `<div class="row"><span><b>${esc(t.nome)}</b> · ${t.genero}<br><small class="sub">${e.jog.filter(j => j.time_id === t.id).map(j => esc(j.nome)).join(', ') || 'sem alunos inscritos'}</small></span></div>`).join('') }).join('')) : '' }).join('')
  return `<div class="head"><div><div class="eyebrow">Prestação de contas</div><h2>Relatório · ${esc(c.name)}</h2></div><div class="btns noprint"><button class="btn ghost" data-act="print">Imprimir / salvar PDF</button></div></div>
  <div class="grid g4">${stat(e.turmas.length, 'séries (grupos)')}${stat(e.times.length, 'times')}${stat(e.jog.length, 'alunos inscritos')}${stat(`${feitos}/${e.partidas.length}`, 'jogos decididos')}</div>
  <div class="card mt"><h3>Por série e modalidade</h3><div class="scroll"><table class="st"><thead><tr><th class="l">Série</th><th class="l">Modalidade</th><th>Times</th><th>Alunos</th><th>Jogos</th><th class="l">Campeão</th></tr></thead><tbody>${linhas || '<tr><td colspan="6">Sem times.</td></tr>'}</tbody></table></div></div>
  <div class="card mt"><h3>Lista de times e alunos <small>abra a modalidade antes de imprimir</small></h3>${lista || '<p class="sub">Sem times.</p>'}</div>
  <p class="note">Gerado em ${new Date().toLocaleString('pt-BR')} · ${esc(c.responsible ? 'Responsável: ' + c.responsible + ' · ' : '')}os nomes dos alunos só devem circular com autorização da escola.</p>`
}

/* ---------- Divulgação: imagens (mesmo desenho do sistema, só nomes de times) ---------- */
const ESC_CARDS = ['proximos-jogos', 'resultados', 'campeoes']
async function buildCardsEscolar() {
  const c = C(); if (!c?.escolar) return
  if (c.logo || c.sponsors?.length) await marcasImg(c).catch(() => {})
  const pat = ui.marcas?.id === c.id && ui.marcas.sponsors.length ? 1 : 0, e = c.esc
  const ordem = (x, y) => ESC_ORDEM.indexOf(x.fase) - ESC_ORDEM.indexOf(y.fase) || escNat(escSerie(c, x.turma_id), escSerie(c, y.turma_id))
  const rotulo = p => `${p.fase.toUpperCase()} · ${escMod(c, p.modalidade_id).toUpperCase()} ${p.genero.toUpperCase()} · ${escSerie(c, p.turma_id).toUpperCase()}`
  ui.cardNomes = ESC_CARDS.map(n => 'tnt-escolar-' + n)
  ui.cards = [
    canvasCard(c, 'PRÓXIMOS JOGOS', (x, F) => {
      const ps = e.partidas.filter(p => p.placar_a == null).sort((a, b) => escCmpH(a, b) || ordem(a, b)).slice(0, 6 - pat); let y = 320
      if (!ps.length) { x.fillStyle = '#fff'; x.font = `600 36px ${F.B}`; x.fillText('Todos os jogos foram realizados.', 60, 400) }
      ps.forEach(p => { x.fillStyle = '#0e2547'; x.fillRect(48, y, 984, 132); x.textAlign = 'left'
        x.fillStyle = '#00E676'; fit(x, rotulo(p), 76, y + 42, 930, 700, 28, F.C)
        x.fillStyle = '#fff'; fit(x, `${escTime(c, p.time_a_id)?.nome} × ${escTime(c, p.time_b_id)?.nome}`.toUpperCase(), 76, y + 90, 930, 700, 44, F.C)
        x.fillStyle = '#a9bfe6'; x.font = `400 24px ${F.B}`; x.fillText(p.data ? `${escDia(p.data)} ${escDm(p.data)} · ${escHora(p.hora)} · Quadra ${p.quadra} · colete ${p.colete_a}` : `Colete ${p.colete_a} × ${p.colete_a === 'azul' ? 'vermelho' : 'azul'}`, 76, y + 120); y += 152 })
    }),
    canvasCard(c, 'ÚLTIMOS RESULTADOS', (x, F) => {
      const ps = e.partidas.filter(p => p.placar_a != null).sort((a, b) => ordem(b, a)).slice(0, 6 - pat); let y = 320
      if (!ps.length) { x.fillStyle = '#fff'; x.font = `600 36px ${F.B}`; x.fillText('Os resultados aparecem aqui conforme os jogos terminam.', 60, 400) }
      ps.forEach(p => { x.fillStyle = '#0e2547'; x.fillRect(48, y, 984, 132); x.textAlign = 'left'
        x.fillStyle = '#a9bfe6'; fit(x, rotulo(p), 76, y + 36, 930, 600, 24, F.B)
        x.fillStyle = '#fff'; x.font = `700 36px ${F.C}`; x.textAlign = 'right'; fit(x, (escTime(c, p.time_a_id)?.nome || '').toUpperCase(), 450, y + 92, 380, 700, 36, F.C)
        x.textAlign = 'left'; fit(x, (escTime(c, p.time_b_id)?.nome || '').toUpperCase(), 630, y + 92, 390, 700, 36, F.C)
        x.textAlign = 'center'; x.fillStyle = '#00E676'; x.font = `700 46px ${F.C}`; x.fillText(`${p.placar_a} × ${p.placar_b}`, 540, y + 94)
        if (p.penaltis_a != null) { x.fillStyle = '#a9bfe6'; x.font = `400 22px ${F.B}`; x.fillText(`pên. ${p.penaltis_a} × ${p.penaltis_b}`, 540, y + 122) }; y += 148 })
    }),
    canvasCard(c, 'CAMPEÕES', (x, F) => {
      const fins = escLista(c).slice(0, 7 - pat); let y = 330
      if (!fins.length) { x.fillStyle = '#fff'; x.font = `600 36px ${F.B}`; x.fillText('Os campeões serão conhecidos após as finais.', 60, 400) }
      fins.forEach(p => { x.fillStyle = '#0e2547'; x.fillRect(48, y, 984, 112); x.textAlign = 'left'
        x.fillStyle = '#a9bfe6'; fit(x, `${p.mdl} ${p.genero} · ${p.serie}${p.direto ? ' · campeão direto' : ''}`.toUpperCase(), 76, y + 38, 930, 600, 24, F.B)
        x.fillStyle = '#00E676'; fit(x, (p.nome || '').toUpperCase(), 76, y + 90, 930, 700, 44, F.C); y += 128 })
    }),
  ]
  ui.cards.forEach((cv, i) => { const el = document.getElementById('cv' + i); if (el) el.replaceChildren(cv) })
}

/* ---------- Passo a passo do campeonato (Secretaria) ---------- */
const incompFut = c => c.esc.times.filter(t => escMod(c, t.modalidade_id) === 'Futsal' && c.esc.jog.filter(j => j.time_id === t.id).length < 5).length
function escPassos(c) {
  const e = c.esc, ok = (v, t) => `<span class="pill ${v ? 'green' : 'amber'}">${t}</span>`
  const passo = (n, titulo, estado, dica) => `<div class="row"><span><b>${n}. ${titulo}</b><br><small class="sub">${dica}</small></span>${estado}</div>`
  return `<div class="card mt"><h3>Passo a passo <small>para o campeonato acontecer</small></h3>
    ${passo(1, 'Identidade do campeonato', ok(c.logo && c.responsible, c.logo && c.responsible ? 'pronta' : 'falta logo ou responsável'), 'Logo, responsável e patrocinadores aparecem no portal e nas imagens.')}
    ${passo(2, 'Times e links dos professores', ok(e.times.length, `${e.times.length} times`), 'Cada professor recebe um link secreto para se identificar e inscrever os alunos.')}
    ${passo(3, 'Professores identificados', ok(e.profs >= e.times.length && e.times.length, `${e.profs} de ${e.times.length}`), 'Quem ainda não preencheu o nome aparece pendente em Jogos Escolares.')}
    ${passo(4, 'Alunos inscritos', ok(e.jog.length, `${e.jog.length} alunos`), 'Os nomes aparecem no portal público: só com autorização da escola.')}
    ${passo(5, 'Futsal: mínimo de 5 alunos por time', ok(!incompFut(c), incompFut(c) ? `${incompFut(c)} time(s) com menos de 5` : 'todos completos'), 'Time de futsal com menos de 5 alunos inscritos não consegue jogar.')}
    ${passo(6, 'Sorteio dos jogos', ok(e.partidas.length, e.partidas.length ? `${e.partidas.length} jogos` : 'ainda não sorteado'), 'O sistema sorteia os confrontos e os coletes. Depois disso o juiz já pode lançar os resultados.')}
    ${passo(7, 'Juízes escalados', ok(e.partidas.length && e.partidas.every(p => p.juiz_id), `${e.partidas.filter(p => p.juiz_id).length} de ${e.partidas.length} jogos`), `${e.juizes.length} juiz(es) cadastrado(s). A Secretaria escala um juiz em cada jogo; o placar sai pelo link do juiz.`)}
    <div class="btns" style="margin-top:12px"><button class="btn sm" data-act="tab" data-tab="escolar">Abrir Jogos Escolares</button></div></div>`
}

// Telas e ações do protótipo. Regras em regras.js, dados de exemplo em dados.js.

const $ = s => document.querySelector(s)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const KEY = 'tnt-esportes-prototipo-v2'
const REAL = document.documentElement?.dataset.mode === 'real'   // oficial.html: dados no Supabase (api.js)
function load() { try { const s = JSON.parse(localStorage.getItem(KEY)); return s && s.v === 3 ? s : null } catch { return null } }
function save() { if (REAL) return saveDrafts(); try { localStorage.setItem(KEY, JSON.stringify(S)) } catch { toast('Memória do navegador cheia: as últimas alterações podem não ficar guardadas.') } }

let S = REAL ? {champs: [], champId: null, offline: false, session: null} : load() || seed()
const ui = {tab: null, matchId: null, team: null, picker: null, manage: null, punish: null, signing: null, doc: null,
            draw: null, verify: null, sumCheck: null, highlight: [], clock: {}, cards: []}
const C = () => S.champs.find(c => c.id === S.champId) || S.champs[0]
const role = () => S.session?.role
const cur = () => findMatch(C(), ui.matchId)
function resetTransient() { Object.assign(ui, {matchId: null, team: null, picker: null, manage: null, punish: null, signing: null, draw: null, verify: null, sumCheck: null, highlight: [], clock: {}}) }

function log(c, who, what, why, m) {
  const e = {at: new Date().toISOString(), who, what, ...(why ? {why} : {})}
  c.log.unshift(e); if (m) m.history.push(e)
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3800) }

/* ---------- ícones e pequenos componentes ---------- */
const svg = d => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`
const IC = {
  sec: svg('<path d="M3 21h18M5 21V8l7-5 7 5v13M9 10h.01M15 10h.01M9 14h.01M15 14h.01M10 21v-4h4v4"/>'),
  ref: svg('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM9 13l2 2 4-4"/>'),
  team: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>'),
  pub: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  trophy: svg('<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>'),
}
const ROLES = {secretaria: {name: 'Ana Souza', label: 'Secretaria'}, arbitro: {name: 'João Paulo', label: 'Árbitro'}, publico: {name: 'Visitante', label: 'População'}}
const ROLE_TABS = {
  secretaria: [['painel','Painel'],['campeonatos','Campeonatos'],['inscricoes','Inscrições'],['jogos','Jogos e tabela'],['sumula','Súmula'],['sorteio','Sorteio'],['relatorios','Relatórios'],['divulgacao','WhatsApp'],['portal','Portal público']],
  arbitro: [['sumula','Minhas partidas'],['portal','Portal público']],
  equipe: [['equipe','Minha equipe'],['portal','Portal público']],
  publico: [['portal','Portal público']],
}
const TYPES = {gol: 'Gol', amarelo: 'Amarelo', vermelho: 'Vermelho', falta: 'Falta'}
const EVICON = {gol: '<i class="dot"></i>', amarelo: '<i class="cd y"></i>', vermelho: '<i class="cd r"></i>', falta: ''}
const SPILL = {aprovado: ['green','Aprovado'], pendente: ['amber','Pendente'], analise: ['blue','Em análise'], bloqueado: ['red','Bloqueado']}
const CSTATUS = {inscricoes: ['blue','Inscrições abertas'], andamento: ['green','Em andamento'], encerrado: ['dark','Encerrado']}

const dm = d => d.slice(8) + '/' + d.slice(5, 7)
const dmy = d => d.split('-').reverse().join('/')
const fdt = iso => new Date(iso).toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'})
const fmt = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0')
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)
const cfgOf = c => SPORTS[c.sport] || SPORTS.Futsal
const ageRange = c => c.maxAge ? `${c.minAge} a ${c.maxAge} anos` : `a partir de ${c.minAge} anos`
const stat = (v, l, cls = '') => `<div class="card stat ${cls}"><b>${v}</b><span>${l}</span></div>`
const spill = s => `<span class="pill ${SPILL[s][0]}">${SPILL[s][1]}</span>`
const cpill = c => `<span class="pill ${CSTATUS[c.status][0]}">${CSTATUS[c.status][1]}</span>`
const mtitle = m => m.title || `Grupo ${m.group} · Rodada ${m.round}`
const tname = (c, m, k) => m[k] ? T(c, m[k]).name : slotLabel(c, k === 'home' ? m.slotH : m.slotA)
const side = (c, m, k) => m[k] ? esc(T(c, m[k]).name) : `<span class="tbd">${esc(tname(c, m, k))}</span>`
const label = (c, m) => `${tname(c, m, 'home')} × ${tname(c, m, 'away')}`
const scoreTxt = m => `${score(m).join(' × ')}${m.pen ? ` <small>(${m.pen[0]}×${m.pen[1]} pên.)</small>` : ''}`
function mpill(m) {
  if (m.pendingConfirm) return '<span class="pill amber">Aguardando sinal</span>'
  if (m.wo) return '<span class="pill red">W.O.</span>'
  if (isDone(m)) return '<span class="pill green">Encerrado</span>'
  if (m.status === 'correcao') return '<span class="pill amber">Em correção</span>'
  if (m.events.length) return '<span class="pill blue">Em andamento</span>'
  return m.postponed ? '<span class="pill amber">Adiado</span>' : '<span class="pill">Agendado</span>'
}
function avatar(p, size = 34) {
  const st = `width:${size}px;height:${size}px`
  // oficial: a foto vem como link temporário (https) do arquivo privado
  if (p.photo && /^(data:image\/|https:\/\/)/.test(p.photo)) return `<img class="av" style="${st}" src="${p.photo}" alt="">`
  const hue = [...p.name].reduce((s, ch) => s + ch.charCodeAt(0), 0) % 360
  return `<span class="av" style="${st};background:hsl(${hue} 32% 36%)">${esc(p.name.split(' ').map(w => w[0]).slice(0, 2).join(''))}</span>`
}
function phaseNow(c) {
  const nx = c.matches.filter(m => !isDone(m)).sort(byDate)[0]
  if (!nx) return c.matches.length ? 'Campeonato encerrado' : 'Aguardando sorteio'
  return nx.phase === 'grupos' ? `Fase de grupos · Rodada ${nx.round}` : PHASES[nx.phase]
}

function matchRow(c, m, mode) {
  const ready = m.home && m.away, d = isDone(m)
  let acts = ''
  if (mode === 'sec' && !d && ready) acts += `<button class="btn sm" data-act="open" data-id="${m.id}">Abrir súmula</button>`
  if (mode === 'sec' && !d && !m.pendingConfirm && !m.events.length) acts += `<button class="btn ghost sm" data-act="manage" data-id="${m.id}">Adiar / W.O.</button>`
  if (d) acts += `<button class="btn ghost sm" data-act="doc" data-c="${c.id}" data-id="${m.id}">Súmula</button>`
  return `<div class="match"><div class="mline"><span class="r">${side(c, m, 'home')}</span>
    <span class="sc ${d ? '' : 'time'}">${d ? scoreTxt(m) : m.time}</span><span>${side(c, m, 'away')}</span></div>
    <div class="meta">${esc(mtitle(m))} · ${dm(m.date)} · ${m.time} · ${esc(c.venue)} ${mpill(m)} ${acts}${REAL && mode === 'sec' && !d ? refSelect(m) : ''}</div>
    ${mode === 'sec' && ui.manage === m.id ? manageForm(c, m) : ''}</div>`
}
function manageForm(c, m) {
  const ready = m.home && m.away
  return `<form class="manage f" data-form="manage">
    <label>Ação<select name="acao"><option value="adiar">Adiar o jogo</option>${ready ? '<option value="wo">W.O. (equipe não compareceu)</option>' : ''}</select></label>
    <label>Nova data<input type="date" name="date" value="${m.date}"></label>
    <label>Novo horário<input type="time" name="time" value="${m.time.replace('h', ':')}"></label>
    ${ready ? `<label>Equipe ausente (W.O.)<select name="ausente"><option value="${m.home}">${esc(T(c, m.home).name)}</option><option value="${m.away}">${esc(T(c, m.away).name)}</option></select></label>` : ''}
    <label class="span2">Motivo (fica registrado no histórico)<input name="why" required minlength="5" placeholder="Ex.: chuva forte, quadra alagada"></label>
    <div class="btns span2"><button class="btn">Registrar</button><button type="button" class="btn ghost" data-act="manage" data-id="">Cancelar</button></div></form>`
}

function table(c, g) {
  return `<div class="card"><h3>Grupo ${g}</h3><div class="scroll"><table class="st"><thead><tr><th>#</th><th class="l">Equipe</th><th>P</th><th>J</th><th>V</th><th>E</th><th>D</th><th>GP</th><th>GC</th><th>SG</th></tr></thead><tbody>
  ${standings(c, g).map((r, i) => `<tr class="${i < 2 ? 'q' : ''} ${ui.highlight.includes(r.t.id) ? 'hl' : ''}"><td>${i + 1}</td><td class="l"><b>${esc(r.t.name)}</b></td><td><b>${r.P}</b></td><td>${r.J}</td><td>${r.V}</td><td>${r.E}</td><td>${r.D}</td><td>${r.GP}</td><td>${r.GC}</td><td>${r.SG > 0 ? '+' : ''}${r.SG}</td></tr>`).join('')}
  </tbody></table></div><p class="note"><span class="qmark"></span>Classificam-se para a semifinal${groupDone(c, g) ? ' · grupo encerrado' : ''}</p></div>`
}

function bracket(c) {
  const semis = c.matches.filter(m => m.phase === 'semi'), fin = c.matches.find(m => m.phase === 'final'), third = c.matches.find(m => m.phase === 'terceiro')
  if (!fin) return ''
  const box = (m, cls = '') => {
    const w = winner(m), [h, a] = score(m), d = isDone(m)
    const line = (k, s) => `<div class="bteam ${w && w === m[k] ? 'win' : ''}"><span>${side(c, m, k)}</span><b>${d ? s : ''}</b></div>`
    return `<div class="bbox ${cls}">${line('home', h)}${line('away', a)}<div class="bmeta"><span>${m.title}</span><span>${d ? (m.pen ? `pênaltis ${m.pen[0]}×${m.pen[1]}` : m.wo ? 'W.O.' : 'encerrado') : `${dm(m.date)} · ${m.time}`}</span></div></div>`
  }
  return `<div class="card"><h3>Mata-mata <small>1º A × 2º B e 1º B × 2º A · empate decidido nos pênaltis</small></h3><div class="bracket">
    <div><div class="bt">Semifinais</div>${semis.map(m => box(m)).join('')}</div>
    <div><div class="bt">Final</div>${box(fin, 'final')}<div class="bt">3º lugar</div>${box(third)}</div></div></div>`
}
function banner(c) {
  const ch = champion(c); if (!ch) return ''
  const fin = c.matches.find(m => m.phase === 'final'), th = c.matches.find(m => m.phase === 'terceiro')
  return `<div class="banner">${IC.trophy}<div><span class="eyebrow" style="color:var(--g9)">Campeão · ${esc(c.name)}</span><b>${esc(T(c, ch).name)}</b>
    <span class="sub" style="color:var(--g9)">Vice: ${esc(T(c, loser(fin)).name)}${winner(th) ? ` · 3º lugar: ${esc(T(c, winner(th)).name)}` : ''}</span></div></div>`
}
const logRow = l => `<div class="row"><div><b>${esc(l.what)}</b>${l.why ? `<div class="why">Motivo: ${esc(l.why)}</div>` : ''}<div class="sub">${esc(l.who)} · ${fdt(l.at)}</div></div></div>`

/* ---------- login ---------- */
function vLogin() {
  if (REAL) return loginReal()
  const card = (r, ic, t, d, btn) => `<div class="role"><div class="ic">${ic}</div><h3>${t}</h3><p>${d}</p><button class="btn" data-act="login" data-role="${r}">${btn}</button></div>`
  const teams = S.champs.map(c => `<optgroup label="${esc(c.name)}">${c.teams.map(t => `<option value="${c.id}|${t.id}">${esc(t.name)}</option>`).join('')}</optgroup>`).join('')
  return `<div class="login"><div class="lhero"><div class="wrap"><div class="eyebrow">Secretaria Municipal de Esportes · Tonantins/AM</div>
    <h1>TNT ESPORTES</h1><p>Organizando o esporte. Conectando pessoas.</p></div></div>
    <div class="wrap"><div class="roles">
      ${card('secretaria', IC.sec, 'Secretaria', 'Campeonatos, inscrições, sorteios, súmulas e relatórios em um só lugar.', 'Entrar como Secretaria')}
      ${card('arbitro', IC.ref, 'Árbitro', 'Súmula digital no celular. Funciona mesmo sem internet.', 'Entrar como árbitro')}
      <div class="role"><div class="ic">${IC.team}</div><h3>Equipe</h3><p>Inscreve os atletas e acompanha a situação do elenco e os jogos.</p>
        <select id="login-team" aria-label="Equipe">${teams}</select><button class="btn" data-act="login" data-role="equipe">Entrar como equipe</button></div>
      ${card('publico', IC.pub, 'População', 'Tabela, jogos, artilharia e súmulas abertos para todos, sem login.', 'Ver o portal')}
    </div><p class="note" style="text-align:center;margin:20px 0">Protótipo com dados de exemplo. Na versão real, Secretaria, árbitros e equipes entram com senha.</p></div></div>`
}

/* ---------- Secretaria ---------- */
function vPainel() {
  const c = C(), r = 'sec'
  const head = `<div class="head"><div><div class="eyebrow">Painel da Secretaria</div><h2>${esc(c.name)}</h2>
    <div class="tags">${cpill(c)}<span class="pill">${esc(c.sport)}</span><span class="pill">${esc(c.category)} · ${ageRange(c)}</span></div></div>
    <span class="pill amber">${phaseNow(c)}</span></div>`
  const aprov = c.players.filter(p => insc(c, p)[0] === 'aprovado').length
  const pendTeams = c.teams.map(t => [t, ...teamInsc(c, t)]).sort((a, b) => (a[1] === 'aprovado') - (b[1] === 'aprovado'))
  const pendCard = `<div class="card"><h3>Pendências de inscrição <small><button class="link" data-act="tab" data-tab="inscricoes">abrir inscrições</button></small></h3>
    ${pendTeams.map(([t, s, txt]) => `<div class="row"><div><b>${esc(t.name)}</b><div class="sub">${txt}</div></div>${spill(s)}</div>`).join('') || '<p class="sub">Nenhuma equipe inscrita.</p>'}</div>`
  const hist = `<div class="card mt"><h3>Histórico de alterações <small>quem, quando e por quê</small></h3>${c.log.slice(0, 8).map(logRow).join('') || '<p class="sub">Nada registrado.</p>'}</div>`
  if (c.status === 'inscricoes') {
    const pend = c.players.filter(p => insc(c, p)[0] !== 'aprovado').length
    return head + `<div class="grid g4">${stat(c.teams.length, 'equipes inscritas')}${stat(aprov, 'atletas aprovados')}${stat(pend, 'atletas com pendência', 'gold')}${stat(new Date(c.start + 'T12:00').toLocaleDateString('pt-BR'), 'início previsto')}</div>
      <div class="grid side mt"><div class="card"><h3>Próximo passo</h3><p>Com as inscrições fechadas, faça o <b>sorteio público</b>. O sistema monta os grupos e gera a tabela completa, com o mata-mata.</p>
        <div class="btns" style="margin-top:12px"><button class="btn" data-act="tab" data-tab="sorteio">Ir para o sorteio</button><button class="btn ghost" data-act="tab" data-tab="inscricoes">Ver inscrições</button></div></div>${pendCard}</div>` + hist
  }
  const fin = c.matches.filter(isDone), up = c.matches.filter(m => !isDone(m)).sort(byDate)
  const gols = fin.reduce((s, m) => s + goals(m)[0] + goals(m)[1], 0)
  const {susp, st} = discipline(c)
  const disc = c.players.map(p => {
    const nx = nextMatches(c, p.team)[0], why = nx && susp[nx.id]?.[p.id]
    const tag = why ? `<span class="pill red" title="${esc(why)}">Suspenso no próximo jogo</span>` : st[p.id].y === 2 ? '<span class="pill amber">Pendurado · 2 amarelos</span>' : ''
    return tag && `<div class="row"><div class="ath">${avatar(p, 30)}<div><b>${esc(p.name)}</b> <span class="sub">nº ${p.num}</span><div class="sub">${esc(T(c, p.team).name)}${why ? ' · ' + esc(why) : ''}</div></div></div>${tag}</div>`
  }).join('')
  const nb = nextBatch(c)
  return head + banner(c) + `<div class="grid g4">${stat(c.teams.length, 'equipes')}${stat(aprov, 'atletas aprovados')}${stat(fin.length + '/' + c.matches.length, 'jogos realizados')}${stat(gols, 'gols marcados', 'gold')}</div>
  <div class="grid side mt">
    <div class="card"><h3>Próximos jogos <small>${up.length} a realizar</small></h3>${up.slice(0, 6).map(m => matchRow(c, m, r)).join('') || '<p class="empty">Todos os jogos foram realizados.</p>'}</div>
    <div class="grid" style="align-content:start">
      ${nb && !REAL ? `<div class="card info"><h3>Modo apresentação</h3><p class="sub">Simula ${nb.label} com resultados aleatórios, para mostrar o mata-mata e o campeão sem esperar os jogos reais.</p><button class="btn gold" style="margin-top:8px" data-act="simulate">Simular ${nb.label}</button></div>` : ''}
      <div class="card"><h3>Disciplina <small>calculado automaticamente</small></h3>${disc || '<p class="sub">Nenhum atleta pendurado ou suspenso.</p>'}</div>
      ${pendCard}
    </div></div>` + hist
}

const clogo = (url, size = 44) => url ? `<img class="clogo" src="${esc(url)}" alt="" style="width:${size}px;height:${size}px">` : ''
function sponsorsBar(c) {
  if (!c.sponsors?.length) return ''
  return `<div class="sponsors"><span class="eyebrow">Patrocínio</span>${c.sponsors.map(s => s.logo ? `<img src="${esc(s.logo)}" alt="${esc(s.name)}" title="${esc(s.name)}">` : `<b>${esc(s.name)}</b>`).join('')}</div>`
}
function champForm(c) {   // criar ou editar; logo, responsável, patrocínio e prazo só no modo oficial
  const v = (k, d = '') => esc(c?.[k] ?? d), sp = c?.sponsors || []
  const step = (n, t, body) => `<fieldset class="step"><legend><span>${n}</span>${t}</legend><div class="f">${body}</div></fieldset>`
  return `<div class="card mt" id="champform"><h3>${c ? `Editar: ${esc(c.name)}` : 'Novo campeonato'}</h3>
  <form data-form="newchamp">${c ? `<input type="hidden" name="id" value="${c.id}">` : ''}
  ${step(1, 'Identidade', `
    <label class="span2">Nome<input name="name" required minlength="5" maxlength="60" value="${v('name')}" placeholder="Ex.: Copa Feminina de Futsal 2027"></label>
    <label>Modalidade<select name="sport" ${c ? 'disabled' : ''}>${Object.keys(SPORTS).map(s => `<option ${c?.sport === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
    <label>Categoria<input name="category" maxlength="20" value="${v('category')}" placeholder="Livre, Sub-17, Feminino, Veteranos..."></label>
    <label>Idade mínima<input name="min" type="number" min="5" max="80" value="${v('minAge', 15)}" required></label>
    <label>Idade máxima<input name="max" type="number" min="5" max="99" value="${v('maxAge')}" placeholder="sem limite"></label>
    ${REAL ? `<label class="span2">Logo do campeonato${c?.logo ? ` <span class="sub">(já tem; envie outra só para trocar)</span>` : ''}<input name="logo" type="file" accept="image/*"></label>` : ''}`)}
  ${step(2, 'Organização', `
    ${REAL ? `<label>Responsável<input name="resp" maxlength="60" value="${v('responsible')}" placeholder="Nome de quem organiza"></label>
    <label>Telefone / WhatsApp do responsável<input name="respPhone" type="tel" maxlength="20" value="${v('responsiblePhone')}" placeholder="(97) 9 9999-9999"></label>` : ''}
    <label>Início<input name="start" type="date" required value="${v('start', '2027-03-06')}"></label>
    <label>Local<input name="venue" maxlength="60" value="${v('venue')}" placeholder="Quadra Poliesportiva Municipal"></label>`)}
  ${REAL ? step(3, 'Inscrições', `
    <label>Inscrições até<input name="regUntil" type="date" value="${v('regUntil')}"></label>
    <label>Máximo de atletas por equipe<input name="maxPlayers" type="number" min="5" max="40" value="${v('maxPlayers', 20)}" required></label>
    <p class="note span2">Cada equipe recebe um link para inscrever os atletas com foto e documento. Depois do prazo, o link para de aceitar inscrições.</p>`)
  + step(4, 'Patrocinadores <small class="sub">(opcional · até 12 · aparecem no portal, na súmula e no link)</small>', [...Array(Math.min(12, Math.max(4, sp.length + 2))).keys()].map(i => `
    <label>Patrocinador ${i + 1}<input name="sp${i}" maxlength="40" value="${esc(sp[i]?.name || '')}" placeholder="Nome"></label>
    <label>Logo ${sp[i]?.logo ? '<span class="sub">(já tem)</span>' : ''}<input name="spl${i}" type="file" accept="image/*"></label>`).join('')) : ''}
  <div class="btns" style="margin-top:12px"><button class="btn">${c ? 'Salvar alterações' : 'Criar e abrir inscrições'}</button>${c ? '<button type="button" class="btn ghost" data-act="editchamp" data-id="">Cancelar</button>' : ''}</div>
  </form></div>`
}
function vCamps() {
  const cards = S.champs.map(c => {
    const done = c.matches.filter(isDone).length, ch = champion(c)
    return `<div class="card"><div class="tags">${cpill(c)}<span class="pill">${esc(c.sport)}</span><span class="pill">${esc(c.category)}</span></div>
      <div style="display:flex;gap:10px;align-items:center;margin-top:8px">${clogo(c.logo)}<h3 style="font-size:22px">${esc(c.name)}</h3></div>
      <p class="sub">${ageRange(c)} · início ${dmy(c.start)} · ${esc(c.venue)}</p>
      ${c.responsible ? `<p class="sub">Responsável: ${esc(c.responsible)}${c.responsiblePhone ? ' · ' + esc(c.responsiblePhone) : ''}</p>` : ''}
      <p class="sub">${c.teams.length} equipes · ${c.players.length} atletas · ${c.matches.length ? `${done}/${c.matches.length} jogos` : 'tabela após o sorteio'}${ch ? ` · campeão: <b>${esc(T(c, ch).name)}</b>` : ''}</p>
      ${c.regUntil ? `<p class="sub">Inscrições até ${dmy(c.regUntil)}</p>` : ''}${sponsorsBar(c)}
      <div class="btns" style="margin-top:10px"><button class="btn sm" data-act="champ" data-id="${c.id}">${c.id === S.champId ? 'Abrir painel' : 'Selecionar'}</button>
        ${REAL ? `<button class="btn ghost sm" data-act="editchamp" data-id="${c.id}">Editar dados</button>` : ''}</div></div>`
  }).join('')
  const editing = S.champs.find(c => c.id === ui.editChamp)
  return `<div class="head"><div><div class="eyebrow">Gestão</div><h2>Campeonatos</h2></div><span class="sub">Cada campeonato tem modalidade, categoria e faixa etária próprias.</span></div>
  ${cards ? `<div class="grid g3">${cards}</div>` : '<div class="info">Comece criando o primeiro campeonato aqui embaixo. As outras abas (inscrições, sorteio, jogos, relatórios) passam a funcionar depois disso.</div>'}
  ${champForm(editing)}
  ${REAL ? `<div class="mt">${arbitrosCard()}</div>` : ''}`
}

function athleteForm(c, mode) {
  const sec = mode !== 'team'
  return `<h3 style="margin-top:22px">${sec ? 'Inscrever atleta pela Secretaria' : 'Inscrever atleta'}</h3>
  <form class="f" data-form="athlete">
    <label>Nome completo<input name="name" required minlength="3" maxlength="50" autocomplete="off"></label>
    <label>Apelido<input name="nick" maxlength="30" autocomplete="off" placeholder="Opcional · como é chamado no jogo"></label>
    <label>Nº da camisa<input name="num" type="number" min="1" max="99" required></label>
    <label>Nascimento<input name="birth" type="date" required min="1940-01-01" max="${c.start}"></label>
    <label>Posição<select name="pos"><option value="">—</option>${(POSICOES[c.sport] || POSICOES.Futsal).map(p => `<option>${p}</option>`).join('')}</select></label>
    <label>Telefone / WhatsApp<input name="phone" type="tel" maxlength="20" placeholder="Opcional · (97) 9 9999-9999"></label>
    <label>Bairro<select name="bairro">${BAIRROS.map(b => `<option>${b}</option>`).join('')}</select></label>
    <label>Foto do atleta<input name="photo" type="file" accept="image/*" capture="user"></label>
    <label>Responsável<input name="resp" maxlength="60" placeholder="Se for menor de 18 anos"></label>
    <label>Telefone do responsável<input name="respPhone" type="tel" maxlength="20"></label>
    ${REAL && sec ? `<label>Documento (RG) – frente<input name="rgf" type="file" accept="image/*"></label><label>Documento (RG) – verso<input name="rgv" type="file" accept="image/*"></label>` : ''}
    <label class="chk span2"><input type="checkbox" name="auth"> Menor de 18: autorização do responsável entregue</label>
    <label class="chk span2"><input type="checkbox" name="consent" required> Autorizo o uso destes dados para a gestão do campeonato (LGPD). Data de nascimento, documento e foto não aparecem no portal público.</label>
    <div class="span2"><button class="btn">${sec ? 'Inscrever' : 'Enviar para aprovação'}</button></div></form>
  <p class="note">Faixa etária: ${ageRange(c)}. A idade é conferida na hora: fora da faixa, a inscrição é bloqueada; menor de 18 sem autorização fica pendente.${sec ? '' : ' A Secretaria aprova depois de conferir os documentos.'}</p>`
}

function teamLink(c, t) {   // modo oficial: link de inscrição da equipe, para mandar no WhatsApp
  if (!REAL || !t.token) return ''
  const link = new URL('inscricao.html?t=' + t.token, location.href).href
  const msg = `Inscrição da equipe ${t.name} na ${c.name}.\nCadastre cada atleta com foto e documento (RG) por este link:\n${link}`
  return `<div class="info" style="margin-bottom:12px"><b>Link de inscrição da equipe</b>
    <p class="sub">Mande para o responsável da equipe. Cada atleta é inscrito com foto e documento e entra em análise para você aprovar.${c.regUntil ? ` Vale até ${dmy(c.regUntil)}.` : ''}</p>
    <div class="btns" style="margin-top:8px"><button class="btn sm" data-act="copylink" data-link="${esc(link)}">Copiar link</button>
      <a class="btn sm gold" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">Enviar no WhatsApp</a>
      <a class="btn sm ghost" target="_blank" rel="noopener" href="${esc(link)}">Abrir</a></div></div>`
}

function teamDetail(c, t, mode) {
  const ps = c.players.filter(p => p.team === t.id).sort((a, b) => a.num - b.num)
  const {susp} = discipline(c), nx = nextMatches(c, t.id)[0]
  const rows = ps.map(p => {
    const [s, why] = insc(c, p), sw = nx && susp[nx.id]?.[p.id]
    let acts = ''
    if (mode === 'sec') {
      if (s === 'analise') acts = `<button class="btn sm" data-act="approve" data-id="${p.id}">Aprovar</button> <button class="btn ghost sm" data-act="reject" data-id="${p.id}">Recusar</button>`
      if (s === 'pendente') acts = `<button class="btn sm" data-act="auth" data-id="${p.id}">Registrar autorização</button>`
      if (s === 'aprovado' && nx) acts = `<button class="btn ghost sm" data-act="punish" data-id="${p.id}">Suspender</button>`
      if (p.rg?.length) acts += ` <button class="btn ghost sm" data-act="docs" data-id="${p.id}">${ui.docs?.id === p.id ? 'Fechar documento' : 'Ver documento'}</button>`
    }
    const info = [p.pos, p.bairro, p.phone].filter(Boolean).map(esc).join(' · ')
    const row = `<tr><td><div class="ath">${avatar(p)}<div><b>${esc(p.name)}</b>${p.nick ? ` <span class="sub">“${esc(p.nick)}”</span>` : ''}${p.origin === 'link' ? ' <span class="pill blue">via link</span>' : ''}<div class="sub">${info}</div></div></div></td><td>${p.num}</td><td>${ageAt(p.birth, c.start)}</td>
      <td class="l wrap">${spill(s)} ${sw ? '<span class="pill red">Suspenso</span>' : ''} ${why ? `<div class="sub">${why}</div>` : sw ? `<div class="sub">${esc(sw)}</div>` : ''}${p.resp ? `<div class="sub">Responsável: ${esc(p.resp)}${p.respPhone ? ' · ' + esc(p.respPhone) : ''}</div>` : ''}</td><td>${acts}</td></tr>`
    const docs = mode === 'sec' && ui.docs?.id === p.id ? `<tr><td colspan="5"><div class="docs">${ui.docs.urls.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Documento de ${esc(p.name)}"></a>`).join('')}</div>
      <p class="note">Documento visível só para a Secretaria. É apagado automaticamente quando o campeonato termina (LGPD).</p></td></tr>` : ''
    const form = mode === 'sec' && ui.punish === p.id ? `<tr><td colspan="5"><form class="f manage" data-form="punish">
      <label>Jogos de suspensão<select name="games"><option>1</option><option>2</option><option>3</option></select></label>
      <label class="span2">Decisão / motivo<input name="why" required minlength="5" placeholder="Ex.: agressão ao adversário, decisão da comissão em 05/11"></label>
      <div class="btns span2"><button class="btn danger">Aplicar suspensão</button><button type="button" class="btn ghost" data-act="punish" data-id="">Cancelar</button></div></form></td></tr>` : ''
    return row + docs + form
  }).join('')
  return `<h3>${esc(t.name)} <small>${ps.length}${c.maxPlayers ? ' de ' + c.maxPlayers : ''} atletas · ${esc(t.bairro)}${t.group ? ' · Grupo ' + t.group : ''}</small></h3>
  ${mode === 'sec' ? teamLink(c, t) + `<p class="sub" style="margin-bottom:8px">Código de acesso da equipe: <span class="codebox">${t.code}</span> · o representante usa para entrar no sistema.</p>` : ''}
  <div class="scroll"><table class="st"><thead><tr><th class="l">Atleta</th><th>Nº</th><th>Idade</th><th class="l">Situação</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="empty">Nenhum atleta inscrito.</td></tr>'}</tbody></table></div>
  ${athleteForm(c, mode)}`
}

function vInscricoes() {
  const c = C(), t = T(c, ui.team) || c.teams[0]
  ui.team = t?.id
  return `<div class="head"><div><div class="eyebrow">Inscrições · ${esc(c.name)}</div><h2>Equipes e atletas</h2></div><span class="sub">Faixa etária: ${ageRange(c)} · menores de 18 precisam de autorização do responsável</span></div>
  <div class="grid side2">
    <div class="card" style="align-self:start"><h3>Equipes <small>${c.teams.length}</small></h3>
      ${c.teams.map(x => `<button class="tbtn ${x.id === t?.id ? 'on' : ''}" data-act="team" data-team="${x.id}"><span>${esc(x.name)}${x.pot === 1 ? ' <span class="sub">· cabeça de chave</span>' : ''}</span>${spill(teamInsc(c, x)[0])}</button>`).join('') || '<p class="sub">Nenhuma equipe.</p>'}
      ${c.status === 'inscricoes' ? `<h3 style="margin-top:18px">Nova equipe</h3><form class="f" data-form="newteam">
        <label class="span2">Nome<input name="name" required minlength="3" maxlength="40"></label>
        <label>Bairro<select name="bairro">${BAIRROS.map(b => `<option>${b}</option>`).join('')}</select></label>
        <label class="chk"><input type="checkbox" name="seedpot"> Cabeça de chave</label>
        <div class="span2"><button class="btn">Cadastrar equipe</button></div></form>` : '<p class="note">Novas equipes só durante as inscrições.</p>'}
    </div>
    <div class="card">${t ? teamDetail(c, t, 'sec') : '<p class="empty">Cadastre a primeira equipe.</p>'}</div>
  </div>`
}

function vJogos() {
  const c = C()
  const head = `<div class="head"><div><div class="eyebrow">Classificação e tabela</div><h2>${esc(c.name)}</h2></div><span class="sub">Desempate: pontos, vitórias, saldo, gols marcados</span></div>`
  if (!c.matches.length) return head + `<div class="card empty">A tabela é gerada automaticamente depois do sorteio dos grupos.<div style="margin-top:12px"><button class="btn" data-act="tab" data-tab="sorteio">Ir para o sorteio</button></div></div>`
  const mode = role() === 'secretaria' ? 'sec' : null
  const sec = (title, ms) => ms.length ? `<div class="round">${title}</div>${ms.map(m => matchRow(c, m, mode)).join('')}` : ''
  const rounds = [...new Set(c.matches.filter(m => m.phase === 'grupos').map(m => m.round))]
  return head + banner(c) + `<div class="grid g2">${table(c, 'A')}${table(c, 'B')}</div><div class="mt">${bracket(c)}</div>
  <div class="card mt"><h3>Tabela de jogos</h3>
    ${rounds.map(r => sec(`Rodada ${r}`, c.matches.filter(m => m.phase === 'grupos' && m.round === r).sort(byDate))).join('')}
    ${sec('Semifinais', c.matches.filter(m => m.phase === 'semi'))}${sec('Disputa de 3º lugar e final', c.matches.filter(m => m.phase === 'terceiro' || m.phase === 'final'))}</div>`
}

/* ---------- súmula (celular do árbitro) ---------- */
function vSumula() {
  const c = C(), list = c.matches.filter(m => m.home && m.away && !(REAL && role() === 'arbitro' && m.refereeId !== S.session.uid)).sort(byDate)
  let m = findMatch(c, ui.matchId)
  if (!m || !list.includes(m)) { m = list.find(x => !isDone(x)) || list[0]; ui.matchId = m?.id }
  const head = `<div class="head"><div><div class="eyebrow">${role() === 'arbitro' ? `Árbitro ${esc(S.session.name || 'João Paulo')} · celular` : 'Modo árbitro · celular'}</div><h2>Súmula digital</h2></div>
    ${m ? `<label style="display:flex;align-items:center;gap:8px;min-width:0;max-width:100%">Partida <select id="sel-match">${list.map(x => `<option value="${x.id}" ${x.id === m.id ? 'selected' : ''}>${esc(mtitle(x))} · ${esc(label(c, x))}${isDone(x) ? ' (encerrada)' : ''}</option>`).join('')}</select></label>` : ''}</div>`
  if (!m) return head + '<div class="card empty">Nenhuma partida com equipes definidas neste campeonato.</div>'
  const cfg = cfgOf(c)
  if (ui.clock.id !== m.id) ui.clock = {id: m.id, sec: (m.half - 1) * cfg.half * 60, running: false}
  const susp = discipline(c).susp[m.id] || {}
  const [h, a] = score(m), signing = ui.signing === m.id, locked = isDone(m) || m.pendingConfirm || signing
  const pending = m.events.filter(e => !e.sent).length
  const reason = p => susp[p.id] ? 'Suspenso' : insc(c, p)[0] !== 'aprovado' ? SPILL[insc(c, p)[0]][1] : m.events.some(e => e.player === p.id && e.type === 'vermelho') ? 'Expulso' : ''
  const col = t => {
    const f = m.events.filter(e => e.type === 'falta' && e.team === t && e.half === m.half).length
    return `<div><div class="tname">${esc(T(c, t).name)}</div>
      ${['gol', 'amarelo', 'vermelho', 'falta'].map(k => `<button class="evb" data-act="ev" data-type="${k}" data-team="${t}" ${locked ? 'disabled' : ''}>${EVICON[k]} ${k === 'falta' ? '+ Falta' : TYPES[k]}</button>`).join('')}
      <div class="fouls">Faltas no ${m.half}º tempo: <b>${f}</b>${cfg.fouls && f >= cfg.fouls ? '<br><span class="warn">Próxima falta: tiro livre sem barreira</span>' : ''}</div></div>`
  }
  const pk = ui.picker && ui.picker.id === m.id && ui.picker
  const picker = pk && `<div class="picker"><div class="ph">${TYPES[pk.type]} · ${esc(T(c, pk.team).name)}: escolha o atleta</div>
    ${c.players.filter(p => p.team === pk.team).sort((x, y) => x.num - y.num).map(p => { const r = reason(p)
      return `<button class="pl" data-act="pick" data-id="${p.id}" ${r ? 'disabled' : ''}>${avatar(p, 30)}<b>${p.num}</b><span style="flex:1">${esc(p.name)}</span>${r ? `<span class="pill red">${r}</span>` : ''}</button>` }).join('')}
    <button class="btn ghost block" data-act="cancelpick">Cancelar</button></div>`
  const tie = m.phase !== 'grupos' && goals(m)[0] === goals(m)[1]
  const allSigned = ['arbitro', 'home', 'away'].every(k => m.signatures[k])
  const pads = [['arbitro', 'Árbitro · ' + m.referee], ['home', 'Capitão · ' + T(c, m.home).name], ['away', 'Capitão · ' + T(c, m.away).name]]
    .map(([k, l]) => `<div class="padl"><span>${esc(l)}</span>${m.signatures[k] ? `<button class="link" data-act="clearsig" data-k="${k}">limpar</button>` : '<span class="sub">assine com o dedo</span>'}</div><canvas class="pad" width="600" height="150" data-k="${k}" aria-label="Assinatura: ${esc(l)}"></canvas>`).join('')
  let bottom
  if (isDone(m)) bottom = `<div class="box"><b>Súmula confirmada.</b><br>Código de autenticidade: <span class="codebox">${fmtCode(m.hash) || '…'}</span></div>
    <button class="btn block" data-act="doc" data-c="${c.id}" data-id="${m.id}">Ver súmula / PDF</button>
    ${role() === 'secretaria' ? `<form class="f" data-form="reopen" style="margin-top:12px"><label class="span2">Corrigir resultado: motivo (obrigatório)<input name="why" required minlength="5" placeholder="Ex.: gol atribuído ao atleta errado"></label><button class="btn ghost">Reabrir súmula</button></form>` : '<p class="sub" style="text-align:center;margin-top:8px">Correções só pela Secretaria, com motivo registrado.</p>'}`
  else if (m.pendingConfirm) bottom = '<div class="box"><b>Súmula encerrada e assinada no aparelho.</b> Será enviada sozinha quando o sinal voltar.</div>'
  else if (signing) bottom = `<div class="box"><b>Fim de jogo.</b> Confira o placar, registre as observações e colete as assinaturas.</div>
    ${tie ? `<div class="padl">Empate no mata-mata: disputa de pênaltis</div><div class="pens"><label>${esc(T(c, m.home).name)}<input type="number" min="0" max="30" data-pen="0" value="${m.pen?.[0] ?? ''}"></label><b style="padding-bottom:10px">×</b><label>${esc(T(c, m.away).name)}<input type="number" min="0" max="30" data-pen="1" value="${m.pen?.[1] ?? ''}"></label></div>` : ''}
    <label style="margin-top:10px">Observações do árbitro<textarea data-notes maxlength="600" placeholder="Ocorrências, atrasos, comportamento da torcida...">${esc(m.notes)}</textarea></label>
    ${pads}
    <div class="btns" style="margin-top:12px"><button class="btn ghost" data-act="unsign">Voltar ao jogo</button><button class="btn" style="flex:1" data-act="confirm" ${allSigned ? '' : 'disabled'}>Confirmar súmula</button></div>`
  else bottom = `<button class="btn block" data-act="sign">Encerrar jogo e assinar</button>
    <p class="sub" style="text-align:center;margin-top:6px">${pending ? `${pending} evento(s) guardado(s) no aparelho. Serão enviados quando a internet voltar.` : 'Os eventos são enviados na hora.'}</p>`
  return head + `<div class="sumula"><div class="phone">
    <div class="ptop"><span>Árbitro: ${esc(m.referee)}</span><button class="net ${S.offline ? 'off' : ''}" data-act="net" title="${REAL ? 'Toque para tentar enviar agora' : 'Toque para simular queda de sinal'}"><i></i>${S.offline ? 'Sem internet' : 'Online'}</button></div>
    <div class="board"><div class="cap">${esc(c.name)} · ${esc(mtitle(m))}</div>
      <div class="bline"><span class="tn r">${esc(T(c, m.home).name)}</span><span class="big">${h} × ${a}</span><span class="tn" style="text-align:left">${esc(T(c, m.away).name)}</span></div>
      ${m.pen ? `<div class="cap">Pênaltis ${m.pen[0]} × ${m.pen[1]}</div>` : ''}
      <div class="clock"><span id="clock">${fmt(ui.clock.sec)}</span><button class="chip" data-act="clock" ${locked ? 'disabled' : ''}>${ui.clock.running ? 'Pausar' : 'Iniciar'}</button></div>
      <button class="chip ${m.half === 1 ? 'on' : ''}" data-act="half" data-h="1" ${locked ? 'disabled' : ''}>1º tempo</button> <button class="chip ${m.half === 2 ? 'on' : ''}" data-act="half" data-h="2" ${locked ? 'disabled' : ''}>2º tempo</button></div>
    ${Object.keys(susp).length ? `<div class="alert">Suspenso nesta partida: ${Object.keys(susp).map(id => `${esc(P(c, id).name)} (${esc(T(c, P(c, id).team).name)})`).join(', ')}</div>` : ''}
    ${signing || isDone(m) || m.pendingConfirm ? '' : picker || `<div class="cols">${col(m.home)}${col(m.away)}</div>`}
    <div style="margin:12px 0">${m.events.slice().reverse().map(e => `<div class="ev"><span class="sub">${e.min}'</span>
      <span><b>${TYPES[e.type]}</b>${e.player ? ' · ' + esc(P(c, e.player).name) : ''} <span class="sub">(${esc(T(c, e.team).name)})</span></span>
      <span class="pill ${e.sent ? 'green' : 'amber'}">${e.sent ? 'Enviado' : 'Pendente'}</span>
      ${locked ? '<span></span>' : `<button class="link" data-act="undo" data-id="${e.id}">desfazer</button>`}</div>`).join('')}</div>
    ${bottom}
  </div>
  <div>${REAL ? '' : '<p class="sub">Experimente: registre gols e cartões, toque em “Online” para simular a quadra sem sinal, depois encerre o jogo e assine na tela.</p>'}
    <ol class="points">
      <li><b>Um celular por partida</b>Só o árbitro escalado registra a súmula, evitando dois resultados diferentes para o mesmo jogo.</li>
      <li><b>Funciona sem internet</b>Tudo fica guardado no aparelho e é enviado quando o sinal volta. Cada evento tem um código único: nada é duplicado.</li>
      <li><b>Regras automáticas</b>Suspenso, expulso ou com inscrição irregular aparece bloqueado. Segundo amarelo vira vermelho.${cfg.fouls ? ` No ${esc(c.sport.toLowerCase())}, o sistema avisa na ${cfg.fouls}ª falta.` : ''}</li>
      <li><b>Súmula com validade</b>Árbitro e capitães assinam na tela. A súmula vira PDF com código de autenticidade que qualquer pessoa confere no portal.</li>
      <li><b>Tudo registrado</b>Correções só pela Secretaria, com nome, data e motivo no histórico.</li>
    </ol></div></div>`
}

function hookPads() {
  const m = cur(); if (!m) return
  document.querySelectorAll('canvas.pad').forEach(cv => {
    const x = cv.getContext('2d'), k = cv.dataset.k
    x.lineWidth = 3; x.lineCap = x.lineJoin = 'round'; x.strokeStyle = '#14261b'
    if (m.signatures[k]?.startsWith('data:')) { const im = new Image(); im.onload = () => x.drawImage(im, 0, 0); im.src = m.signatures[k] }
    let on = false
    const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height] }
    cv.onpointerdown = e => { on = true; cv.setPointerCapture(e.pointerId); x.beginPath(); x.moveTo(...pos(e)) }
    cv.onpointermove = e => { if (on) { x.lineTo(...pos(e)); x.stroke() } }
    cv.onpointerup = cv.onpointercancel = () => { if (!on) return; on = false; m.signatures[k] = cv.toDataURL(); save(); render() }
  })
}

/* ---------- equipe ---------- */
function vEquipe() {
  const c = C(), t = T(c, S.session.teamId)
  const [st] = teamInsc(c, t), ms = c.matches.filter(m => m.home === t.id || m.away === t.id).sort(byDate)
  return `<div class="head"><div><div class="eyebrow">Área da equipe · ${esc(c.name)}</div><h2>${esc(t.name)}</h2><div class="tags">${spill(st)}<span class="pill">${esc(c.sport)} · ${esc(c.category)}</span></div></div></div>
  <div class="grid side"><div class="card">${teamDetail(c, t, 'team')}</div>
    <div class="grid" style="align-content:start">
      <div class="card"><h3>Jogos da equipe</h3>${ms.map(m => matchRow(c, m, null)).join('') || '<p class="sub">A tabela sai depois do sorteio público dos grupos.</p>'}</div>
      <div class="card info"><b>Como funciona</b><p class="sub">Você inscreve os atletas por aqui, com foto. A Secretaria confere os documentos e aprova. Menores de 18 precisam da autorização do responsável entregue na Secretaria.</p></div>
    </div></div>`
}

/* ---------- sorteio ---------- */
const sameSet = (a, b) => [...a].sort().join() === [...b].sort().join()
// semente final = sha256(semente secreta + entrada pública dita na hora): ninguém escolhe antes uma semente favorável
const finalSeed = async (seed, entrada) => (await sha(seed + entrada)).slice(0, 16)
const drawInfo = d => `<p class="sub">Compromisso publicado antes (SHA-256):</p><code class="hash">${d.hash}</code><p class="sub">Semente revelada depois:</p><code class="hash">${d.seed}</code><p class="sub">Entrada pública: <b>${esc(d.entrada)}</b> · semente final: <code>${d.final}</code></p>`
function verifyForm(c) {
  const v = ui.verify && ui.verify.cid === c.id ? ui.verify : null
  const target = (ui.draw && ui.draw.cid === c.id && ui.draw.hash) || c.draw?.hash
  return `<form class="f" data-form="verify" style="margin-top:8px"><label>Semente<input name="seed" required pattern="[0-9a-fA-F]{16}" title="16 caracteres de 0-9 e a-f" placeholder="16 caracteres" value="${esc(v ? v.seed : '')}" autocomplete="off"></label>
    <label>Entrada pública<input name="entrada" required minlength="3" placeholder="ex.: 07 21 33" value="${esc(v ? v.entrada : '')}" autocomplete="off"></label><button class="btn">Conferir sorteio</button></form>
  ${v ? `<p class="sub" style="margin-top:10px">Hash calculado:</p><code class="hash">${v.hash}</code><p class="sub">Semente final: <code>${v.final}</code></p>
    ${target ? `<span class="pill ${v.hash === target ? 'green' : 'red'}">${v.hash === target ? 'Igual ao compromisso publicado' : 'Diferente do compromisso publicado'}</span>` : ''}
    ${c.draw ? ` <span class="pill ${sameSet(v.groups.A, c.draw.groups.A) ? 'green' : 'red'}">${sameSet(v.groups.A, c.draw.groups.A) ? 'Grupos iguais aos do campeonato' : 'Grupos diferentes'}</span>` : ''}
    <p class="sub" style="margin-top:8px">Grupo A: ${v.groups.A.map(id => esc(T(c, id).name)).join(', ')}<br>Grupo B: ${v.groups.B.map(id => esc(T(c, id).name)).join(', ')}</p>` : ''}`
}
function vSorteio() {
  const c = C(), d = ui.draw && ui.draw.cid === c.id ? ui.draw : {}
  const head = `<div class="head"><div><div class="eyebrow">Transparência · ${esc(c.name)}</div><h2>Sorteio auditável</h2>
    <p class="sub" style="max-width:660px">O sistema publica a “impressão digital” (hash SHA-256) de uma semente secreta antes do sorteio. Na hora, o público dita uma entrada (ex.: números falados por pessoas da plateia), que se mistura à semente. Depois a semente é revelada, e qualquer pessoa confere que ninguém escolheu o resultado.</p></div>
    ${c.status === 'inscricoes' && d.hash && !REAL ? '<button class="btn ghost" data-act="redraw">Recomeçar</button>' : ''}</div>`
  const grp = (g, ids) => `<div class="card"><h3>Grupo ${g}</h3>${ids ? ids.map(id => `<div class="team-chip">${esc(T(c, id).name)}</div>`).join('') : '<p class="sub">Aguardando sorteio.</p>'}</div>`
  const pots = `<div class="card"><h3>Potes <small>cabeças de chave no pote 1</small></h3><div class="grid g2">${[1, 2].map(k => `<div><div class="eyebrow">Pote ${k}</div>${c.teams.filter(t => (t.pot === 1) === (k === 1)).map(t => `<div class="row">${esc(t.name)}</div>`).join('') || '<p class="sub">—</p>'}</div>`).join('')}</div></div>`
  const verify = `<div class="card"><h3>Conferir um sorteio</h3><p class="sub">Digite a semente revelada e a entrada pública. O sistema recalcula o hash e refaz o sorteio.</p>${verifyForm(c)}</div>`
  if (c.status !== 'inscricoes') return head + (c.draw
    ? `<div class="card"><h3>Sorteio realizado <small>${fdt(c.draw.at)}</small></h3>${drawInfo(c.draw)}</div>
       <div class="grid g2 mt">${grp('A', c.draw.groups.A)}${grp('B', c.draw.groups.B)}</div>`
    : '<div class="card empty">Este campeonato não tem registro de sorteio.</div>') + `<div class="grid g2 mt">${pots}${verify}</div>`
  const pend = c.teams.filter(t => teamInsc(c, t)[0] !== 'aprovado'), few = c.teams.length < 4
  const warn = few ? `<div class="info warn">São necessárias pelo menos 4 equipes para o sorteio (hoje: ${c.teams.length}).</div>`
    : pend.length ? `<div class="info warn">${pend.length} equipe(s) com pendências de inscrição: ${pend.map(t => esc(t.name)).join(', ')}. O sorteio pode ser feito, mas resolva antes do primeiro jogo.</div>` : ''
  return head + warn + `<div class="grid g3 mt">
    <div class="card"><h3>1 · Publicar o compromisso</h3><p class="sub" style="margin-bottom:8px">Hash divulgado antes do ato, no portal e no grupo das equipes.</p>${d.hash ? `<code class="hash">${d.hash}</code>` : `<button class="btn" data-act="commit" ${few ? 'disabled' : ''}>Gerar e publicar</button>`}</div>
    <div class="card"><h3>2 · Sortear em público</h3><p class="sub" style="margin-bottom:8px">Peça ao público alguns números e digite aqui. Cabeças de chave separados; os demais distribuídos.</p>${d.groups ? `<p class="sub">Entrada pública: <b>${esc(d.entrada)}</b></p><span class="pill green">Realizado</span>` : `<form class="f" data-form="dodraw"><label>Entrada pública<input name="entrada" required minlength="3" placeholder="ex.: 07 21 33" autocomplete="off" ${d.hash ? '' : 'disabled'}></label><button class="btn" ${d.hash ? '' : 'disabled'}>Sortear</button></form>`}</div>
    <div class="card"><h3>3 · Revelar a semente</h3><p class="sub" style="margin-bottom:8px">Qualquer pessoa confere o hash e repete o sorteio.</p>${d.revealed ? `<code class="hash">${d.seed}</code><span class="pill ${d.ok ? 'green' : 'red'}">${d.ok ? 'Confere com o hash publicado' : 'Não confere!'}</span>` : `<button class="btn" data-act="reveal" ${d.groups ? '' : 'disabled'}>Revelar</button>`}</div>
    <div class="card"><h3>4 · Gerar a tabela</h3><p class="sub" style="margin-bottom:8px">Aplica os grupos e cria todos os jogos, com o mata-mata.</p><button class="btn gold" data-act="applydraw" ${d.revealed && d.ok ? '' : 'disabled'}>Aplicar e gerar tabela</button></div>
  </div>
  <div class="grid g2 mt">${grp('A', d.groups?.A)}${grp('B', d.groups?.B)}</div>
  <div class="grid g2 mt">${pots}${verify}</div>`
}

/* ---------- relatórios ---------- */
function vRelatorios() {
  const rows = S.champs.flatMap(c => c.players.filter(p => insc(c, p)[0] === 'aprovado').map(p => ({c, p, a: ageAt(p.birth, c.start)})))
  const ms = S.champs.flatMap(c => c.matches.filter(isDone))
  const gols = ms.reduce((s, m) => s + goals(m)[0] + goals(m)[1], 0)
  const cnt = t => ms.reduce((s, m) => s + m.events.filter(e => e.type === t).length, 0)
  const bars = list => { const max = Math.max(1, ...list.map(x => x[1]))
    return `<div class="bars">${list.map(([l, n]) => `<div class="bar"><span>${esc(l)}</span><i style="width:${n / max * 100}%"></i><b>${n}</b></div>`).join('')}</div>` }
  const ages = [['Até 14 anos', r => r.a <= 14], ['15 a 17 anos', r => r.a >= 15 && r.a <= 17], ['18 a 29 anos', r => r.a >= 18 && r.a <= 29], ['30 anos ou mais', r => r.a >= 30]]
    .map(([l, f]) => [l, rows.filter(f).length])
  const bairros = BAIRROS.map(b => [b, rows.filter(r => r.p.bairro === b).length]).sort((a, b) => b[1] - a[1])
  return `<div class="head"><div><div class="eyebrow">Prestação de contas</div><h2>Relatórios da Secretaria</h2></div><button class="btn ghost noprint" data-act="print">Imprimir / salvar PDF</button></div>
  <div class="grid g4">${stat(S.champs.length, 'campeonatos')}${stat(S.champs.reduce((s, c) => s + c.teams.length, 0), 'equipes')}${stat(rows.length, 'inscrições aprovadas')}${stat(rows.filter(r => r.a < 18).length, 'menores de 18 atendidos', 'gold')}${stat(ms.length, 'jogos realizados')}${stat(gols, `gols · média ${ms.length ? (gols / ms.length).toFixed(1) : 0} por jogo`)}</div>
  <div class="grid g2 mt"><div class="card"><h3>Atletas por faixa etária</h3>${bars(ages)}</div><div class="card"><h3>Atletas por bairro</h3>${bars(bairros)}</div></div>
  <div class="card mt"><h3>Por campeonato</h3><div class="scroll"><table class="st"><thead><tr><th class="l">Campeonato</th><th class="l">Modalidade</th><th>Categoria</th><th>Situação</th><th>Equipes</th><th>Atletas</th><th>Jogos</th><th>Gols</th></tr></thead><tbody>
    ${S.champs.map(c => { const d = c.matches.filter(isDone); return `<tr><td class="l"><b>${esc(c.name)}</b></td><td class="l">${esc(c.sport)}</td><td>${esc(c.category)}</td><td>${cpill(c)}</td><td>${c.teams.length}</td><td>${c.players.filter(p => insc(c, p)[0] === 'aprovado').length}</td><td>${d.length}/${c.matches.length}</td><td>${d.reduce((s, m) => s + goals(m)[0] + goals(m)[1], 0)}</td></tr>` }).join('')}
  </tbody></table></div></div>
  <div class="grid g4 mt">${stat(cnt('amarelo'), 'cartões amarelos')}${stat(cnt('vermelho'), 'cartões vermelhos')}${stat(ms.filter(m => m.wo).length, 'W.O.')}${stat(S.champs.reduce((s, c) => s + c.punishments.length, 0), 'suspensões da comissão')}</div>
  <p class="note">Gerado em ${new Date().toLocaleString('pt-BR')} · conta apenas inscrições aprovadas.</p>`
}

/* ---------- portal público ---------- */
function transparency(c) {
  const sc = ui.sumCheck
  let res = ''
  if (sc?.none) res = '<p style="margin-top:8px"><span class="pill red">Nenhuma súmula encontrada com esse código</span></p>'
  else if (sc) { const cc = S.champs.find(x => x.id === sc.cid), m = findMatch(cc, sc.mid)
    res = `<div class="info" style="margin-top:10px"><span class="pill ${sc.ok ? 'green' : 'red'}">${sc.ok ? 'Súmula autêntica: o conteúdo confere' : 'Atenção: o conteúdo não confere'}</span>
      <p><b>${esc(label(cc, m))}</b> · ${score(m).join(' × ')} · ${esc(cc.name)}</p><button class="btn sm" data-act="doc" data-c="${cc.id}" data-id="${m.id}">Ver súmula</button></div>` }
  return `<div class="card"><h3>Transparência</h3>
    <h4>Conferir uma súmula</h4><p class="sub">Digite o código de autenticidade impresso na súmula.</p>
    <form class="f" data-form="sumcheck" style="margin-top:6px"><label>Código<input name="code" required placeholder="XXXX-XXXX-XXXX" autocomplete="off"></label><button class="btn">Conferir</button></form>${res}
    ${c.draw ? `<h4 style="margin-top:18px">Sorteio dos grupos</h4>${drawInfo(c.draw)}${verifyForm(c)}` : ''}</div>`
}
function vPortal() {
  const c = C()
  const chips = role() === 'equipe' ? '' : `<div class="chips">${S.champs.map(x => `<button class="${x.id === c.id ? 'on' : ''}" data-act="pchamp" data-id="${x.id}">${esc(x.name)}</button>`).join('')}</div>`
  const nx = c.matches.filter(m => !isDone(m) && m.home && m.away).sort(byDate)[0]
  const hero = `<div class="hero"><div style="display:flex;gap:14px;align-items:center">${clogo(c.logo, 64)}<div><div class="eyebrow">Portal público · sem login</div><h2>${esc(c.name)}</h2>
    <div style="color:#cfe3d6;font-size:14px;margin-top:4px">${esc(c.sport)} · ${esc(c.category)} · atualizado assim que a súmula é confirmada.</div></div></div>
    ${nx ? `<div class="next"><div class="eyebrow">Próximo jogo · ${dm(nx.date)} · ${nx.time}</div><b class="cond" style="font-size:20px">${esc(label(c, nx))}</b></div>` : ''}</div>`
  const lgpd = '<p class="note" style="text-align:center;margin-top:18px">Data de nascimento, documentos e fotos dos atletas não são exibidos no portal público (LGPD).</p>'
  if (!c.matches.length) return chips + hero + sponsorsBar(c) + `<div class="card"><h3>Inscrições abertas <small>${c.teams.length} equipes</small></h3>
    ${c.teams.map(t => `<div class="row"><b>${esc(t.name)}</b><span class="sub">${esc(t.bairro)}</span></div>`).join('')}
    <p class="note">Os grupos serão definidos em sorteio público e auditável. A tabela aparece aqui logo depois.</p></div>` + lgpd
  const up = c.matches.filter(m => !isDone(m)).sort(byDate).slice(0, 4), last = c.matches.filter(isDone).sort(byDate).reverse().slice(0, 5)
  return chips + hero + sponsorsBar(c) + banner(c) + `<div class="grid g2">${table(c, 'A')}${table(c, 'B')}</div><div class="mt">${bracket(c)}</div>
  <div class="grid g2 mt"><div class="card"><h3>Próximos jogos</h3>${up.map(m => matchRow(c, m, 'pub')).join('') || '<p class="sub">Nenhum jogo agendado.</p>'}</div>
    <div class="card"><h3>Últimos resultados</h3>${last.map(m => matchRow(c, m, 'pub')).join('') || '<p class="sub">Nenhum jogo realizado.</p>'}</div></div>
  <div class="grid g2 mt"><div class="card"><h3>Artilharia</h3>${scorers(c).slice(0, 8).map((s, i) => `<div class="row"><span class="rk ${i ? '' : 'first'}">${i + 1}</span><div style="flex:1"><b>${esc(s.p.name)}</b><div class="sub">${esc(T(c, s.p.team).name)}</div></div><span class="sc">${s.n}</span></div>`).join('') || '<p class="sub">Nenhum gol ainda.</p>'}</div>
    ${transparency(c)}</div>` + lgpd
}

/* ---------- documento da súmula (PDF via impressão) ---------- */
function vDoc() {
  const c = S.champs.find(x => x.id === ui.doc.c), m = c && findMatch(c, ui.doc.id)
  if (!m) return ''
  const pub = !['secretaria', 'arbitro'].includes(role())
  const nm = id => esc(T(c, id).name)
  const evTable = (list, showType) => list.length ? `<table><tr><th>Min</th><th>Tempo</th>${showType ? '<th>Cartão</th>' : ''}<th>Equipe</th><th>Atleta</th></tr>
    ${list.map(e => `<tr><td>${e.min}'</td><td>${e.half}º</td>${showType ? `<td>${TYPES[e.type]}</td>` : ''}<td>${nm(e.team)}</td><td>${e.player ? `${esc(P(c, e.player).name)} (nº ${P(c, e.player).num})` : '—'}</td></tr>`).join('')}</table>` : '<p class="sub">Nenhum.</p>'
  const evs = t => m.events.filter(e => e.type === t)
  const fouls = (t, h) => m.events.filter(e => e.type === 'falta' && e.team === t && e.half === h).length
  const sig = (k, l) => `<div class="sig">${m.signatures[k]?.startsWith('data:') && !pub ? `<img src="${m.signatures[k]}" alt="Assinatura">` : `<div class="ph">${m.signatures[k] ? 'assinado no aparelho' : '—'}</div>`}${esc(l)}</div>`
  const sigs = m.sample ? '<p class="sub">Partida dos dados de exemplo: sem assinaturas.</p>'
    : m.simulated ? '<p class="sub">Resultado simulado no modo apresentação: sem assinaturas.</p>'
    : m.wo ? '<p class="sub">W.O. registrado pela Secretaria.</p>'
    : `<div class="sigs">${sig('arbitro', 'Árbitro · ' + m.referee)}${sig('home', 'Capitão · ' + T(c, m.home).name)}${sig('away', 'Capitão · ' + T(c, m.away).name)}</div>`
  return `<div class="docbar noprint"><button class="btn gold" data-act="print">Imprimir / salvar PDF</button><button class="btn ghost" data-act="closedoc">Fechar</button></div>
  <div class="paper">
    <div class="dhead"><div style="display:flex;gap:12px;align-items:center"><div class="logo">TNT</div><div><b>Secretaria Municipal de Esportes de Tonantins</b><div class="sub">TNT Esportes · documento gerado pelo sistema</div></div></div>
      <div style="text-align:right;display:flex;gap:10px;align-items:center"><div><h1>SÚMULA DE JOGO</h1><div class="sub">${esc(c.name)}</div></div>${clogo(c.logo, 48)}</div></div>
    <div class="dgrid"><div><span>Modalidade</span>${esc(c.sport)} · ${esc(c.category)}</div><div><span>Fase</span>${esc(mtitle(m))}</div><div><span>Data e horário</span>${dmy(m.date)} · ${m.time}</div>
      <div><span>Local</span>${esc(c.venue)}</div><div><span>Árbitro</span>${esc(m.referee)}</div><div><span>Situação</span>${isDone(m) ? 'Confirmada' : 'Em aberto'}</div></div>
    <div class="dscore"><span class="r">${nm(m.home)}</span><span class="big">${score(m).join(' × ')}</span><span>${nm(m.away)}</span></div>
    ${m.pen ? `<p style="text-align:center"><b>Pênaltis:</b> ${m.pen[0]} × ${m.pen[1]} · vencedor: ${nm(winner(m))}</p>` : ''}
    ${m.wo ? `<p class="why" style="text-align:center">Vitória por W.O.: ${nm(m.wo)} não compareceu.</p>` : ''}
    <h4>Gols</h4>${evTable(evs('gol'))}
    <h4>Cartões</h4>${evTable([...evs('amarelo'), ...evs('vermelho')].sort((a, b) => a.min - b.min), true)}
    <h4>Faltas acumuladas</h4><table><tr><th>Equipe</th><th>1º tempo</th><th>2º tempo</th></tr>${[m.home, m.away].map(t => `<tr><td>${nm(t)}</td><td>${fouls(t, 1)}</td><td>${fouls(t, 2)}</td></tr>`).join('')}</table>
    <h4>Observações do árbitro</h4><p>${esc(m.notes) || 'Sem observações.'}</p>
    ${m.history.length ? `<h4>Histórico da partida</h4>${m.history.map(x => `<p class="sub">${fdt(x.at)} · ${esc(x.who)}: ${esc(x.what)}${x.why ? ` · motivo: ${esc(x.why)}` : ''}</p>`).join('')}` : ''}
    <h4>Assinaturas</h4>${sigs}
    ${sponsorsBar(c)}
    <div class="auth"><div><div class="sub">Código de autenticidade</div><b>${fmtCode(m.hash) || '—'}</b></div><div class="sub" style="max-width:380px">Confira este código no Portal público, em “Conferir uma súmula”. Se qualquer dado da súmula for alterado, o código deixa de bater.</div></div>
  </div>`
}

/* ---------- imagens para WhatsApp (1080×1350) ---------- */
const CARDS = ['classificacao', 'proximos-jogos', 'artilharia', 'resultados']
function vDiv() {
  const c = C()
  const head = `<div class="head"><div><div class="eyebrow">Divulgação · ${esc(c.name)}</div><h2>Imagens prontas para o WhatsApp</h2><p class="sub">Geradas na hora com os dados oficiais. No celular, “Compartilhar” abre direto o WhatsApp.</p></div></div>`
  if (!c.matches.length) return head + '<div class="card empty">As imagens ficam disponíveis depois que a tabela for gerada.</div>'
  return head + `<div class="grid g3">${CARDS.map((n, i) => `<div class="card"><div class="cv" id="cv${i}"></div><div class="btns" style="margin-top:10px"><button class="btn" data-act="share" data-i="${i}">Compartilhar</button><button class="btn ghost" data-act="dl" data-i="${i}">Baixar</button></div></div>`).join('')}</div>`
}
function canvasCard(c, title, body) {
  const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1350
  const x = cv.getContext('2d'), F = {C: '"Barlow Condensed", sans-serif', B: 'Barlow, sans-serif'}
  x.fillStyle = '#103d27'; x.fillRect(0, 0, 1080, 1350)
  x.fillStyle = '#17613b'; x.fillRect(0, 0, 1080, 190); x.fillRect(0, 1270, 1080, 80)
  x.fillStyle = '#e1b34a'; x.beginPath(); x.arc(110, 95, 52, 0, 7); x.fill()
  x.fillStyle = '#103d27'; x.font = `700 40px ${F.C}`; x.textAlign = 'center'; x.fillText('TNT', 110, 110)
  x.textAlign = 'left'; x.fillStyle = '#fff'; x.font = `700 64px ${F.C}`; x.fillText('TNT ESPORTES', 190, 88)
  x.fillStyle = '#cfe3d6'; x.font = `400 30px ${F.B}`; x.fillText(c.name, 190, 134)
  x.fillStyle = '#e1b34a'; x.font = `700 54px ${F.C}`; x.fillText(title, 60, 275)
  body(x, F)
  x.textAlign = 'left'; x.fillStyle = '#cfe3d6'; x.font = `400 26px ${F.B}`
  x.fillText(`Atualizado em ${new Date().toLocaleDateString('pt-BR')} · Secretaria Municipal de Esportes de Tonantins`, 60, 1318)
  return cv
}
function fit(x, txt, X, Y, maxW, weight, size, fam) { do { x.font = `${weight} ${size}px ${fam}`; size -= 2 } while (x.measureText(txt).width > maxW && size > 16); x.fillText(txt, X, Y) }
function buildCards() {
  const c = C(), lastRound = Math.max(0, ...c.matches.filter(m => isDone(m) && m.phase === 'grupos').map(m => m.round))
  const ch = champion(c)
  ui.cards = [
    canvasCard(c, groupDone(c, 'A') && groupDone(c, 'B') ? 'CLASSIFICAÇÃO FINAL DOS GRUPOS' : `CLASSIFICAÇÃO · APÓS A RODADA ${lastRound}`, (x, F) => {
      let y = 340
      for (const g of ['A', 'B']) {
        x.fillStyle = '#9fc2ab'; x.font = `600 26px ${F.B}`; x.textAlign = 'left'; x.fillText('GRUPO ' + g, 60, y)
        x.textAlign = 'right'; [['P', 820], ['J', 910], ['SG', 1010]].forEach(([l, px]) => x.fillText(l, px, y))
        y += 20
        standings(c, g).forEach((r, i) => { y += 72
          if (i < 2) { x.fillStyle = 'rgba(225,179,74,.14)'; x.fillRect(48, y - 48, 984, 64) }
          x.textAlign = 'left'; x.fillStyle = i < 2 ? '#e1b34a' : '#9fc2ab'; x.font = `700 36px ${F.C}`; x.fillText(i + 1, 70, y)
          x.fillStyle = '#fff'; fit(x, r.t.name, 120, y, 620, 600, 36, F.B)
          x.textAlign = 'right'; x.font = `700 36px ${F.C}`; x.fillText(r.P, 820, y); x.fillText(r.J, 910, y); x.fillText((r.SG > 0 ? '+' : '') + r.SG, 1010, y) })
        y += 100
      }
    }),
    canvasCard(c, 'PRÓXIMOS JOGOS', (x, F) => {
      const ms = c.matches.filter(m => !isDone(m)).sort(byDate).slice(0, 6); let y = 320
      if (!ms.length) { x.fillStyle = '#fff'; x.font = `600 36px ${F.B}`; x.fillText('Todos os jogos foram realizados.', 60, 400) }
      ms.forEach(m => { x.fillStyle = '#1b4d33'; x.fillRect(48, y, 984, 132)
        x.fillStyle = '#e1b34a'; x.font = `700 28px ${F.C}`; x.fillText(`${dm(m.date)} · ${m.time.toUpperCase()} · ${mtitle(m).toUpperCase()}`, 76, y + 42)
        x.fillStyle = '#fff'; fit(x, label(c, m).toUpperCase(), 76, y + 90, 930, 700, 44, F.C)
        x.fillStyle = '#9fc2ab'; x.font = `400 24px ${F.B}`; x.fillText(c.venue, 76, y + 120); y += 152 })
    }),
    canvasCard(c, 'ARTILHARIA', (x, F) => {
      let y = 380
      scorers(c).slice(0, 8).forEach((s, i) => {
        x.textAlign = 'left'; x.fillStyle = i ? '#9fc2ab' : '#e1b34a'; x.font = `700 40px ${F.C}`; x.fillText(i + 1, 70, y)
        x.fillStyle = '#fff'; x.font = `600 38px ${F.B}`; x.fillText(s.p.name, 130, y)
        x.fillStyle = '#9fc2ab'; x.font = `400 24px ${F.B}`; x.fillText(T(c, s.p.team).name, 130, y + 34)
        x.textAlign = 'right'; x.fillStyle = i ? '#fff' : '#e1b34a'; x.font = `700 44px ${F.C}`; x.fillText(`${s.n} gol${s.n > 1 ? 's' : ''}`, 1010, y + 10); y += 110 })
    }),
    canvasCard(c, ch ? 'CAMPEÃO' : 'ÚLTIMOS RESULTADOS', (x, F) => {
      if (ch) {
        const fin = c.matches.find(m => m.phase === 'final'), th = c.matches.find(m => m.phase === 'terceiro')
        x.textAlign = 'center'; x.fillStyle = '#e1b34a'; x.beginPath(); x.arc(540, 560, 170, 0, 7); x.fill()
        x.fillStyle = '#103d27'; x.font = `700 120px ${F.C}`; x.fillText('1º', 540, 605)
        x.fillStyle = '#fff'; fit(x, T(c, ch).name.toUpperCase(), 540, 860, 960, 700, 88, F.C)
        x.fillStyle = '#cfe3d6'; x.font = `500 34px ${F.B}`
        x.fillText(`Final: ${label(c, fin)} · ${score(fin).join(' × ')}${fin.pen ? ` (pên. ${fin.pen[0]}×${fin.pen[1]})` : ''}`, 540, 940)
        x.fillText(`Vice: ${T(c, loser(fin)).name}${winner(th) ? ` · 3º lugar: ${T(c, winner(th)).name}` : ''}`, 540, 995)
        return
      }
      let y = 330
      c.matches.filter(isDone).sort(byDate).reverse().slice(0, 7).forEach(m => {
        const [h, a] = score(m)
        x.fillStyle = '#1b4d33'; x.fillRect(48, y, 984, 112)
        x.fillStyle = '#9fc2ab'; x.font = `600 22px ${F.B}`; x.textAlign = 'left'; x.fillText(`${dm(m.date)} · ${mtitle(m).toUpperCase()}`, 76, y + 34)
        x.fillStyle = '#fff'; x.font = `700 38px ${F.C}`; x.textAlign = 'right'; x.fillText(T(c, m.home).name.toUpperCase(), 450, y + 84)
        x.textAlign = 'left'; x.fillText(T(c, m.away).name.toUpperCase(), 630, y + 84)
        x.textAlign = 'center'; x.fillStyle = '#e1b34a'; x.font = `700 48px ${F.C}`; x.fillText(`${h} × ${a}`, 540, y + 86); y += 128 })
    }),
  ]
  ui.cards.forEach((cv, i) => { const el = document.getElementById('cv' + i); if (el) el.replaceChildren(cv) })
}
function download(i) { const a = document.createElement('a'); a.href = ui.cards[i].toDataURL('image/png'); a.download = `tnt-${CARDS[i]}.png`; a.click() }

/* ---------- ações ---------- */
function addEv(team, type, player) {
  const c = C(), m = cur(), cfg = cfgOf(c)
  const push = t => m.events.push({id: uid(), type: t, team, player, min: Math.floor(ui.clock.sec / 60) + 1, half: m.half, sent: !S.offline && !REAL})   // oficial: api.js envia
  push(type)
  if (type === 'amarelo' && m.events.filter(e => e.type === 'amarelo' && e.player === player).length === 2) { push('vermelho'); toast('Segundo amarelo: atleta expulso.') }
  if (type === 'falta' && cfg.fouls && m.events.filter(e => e.type === 'falta' && e.team === team && e.half === m.half).length === cfg.fouls)
    toast(`${T(c, team).name} chegou à ${cfg.fouls}ª falta. A próxima é tiro livre sem barreira.`)
}
async function finalize(c, m, quiet) {
  const fix = m.status === 'correcao'
  m.status = 'encerrado'; m.pendingConfirm = false
  if (ui.clock.id === m.id) ui.clock.running = false
  m.hash = await sha(sumulaPayload(c, m)).catch(() => null)
  const [h, a] = score(m)
  log(c, m.simulated ? 'Modo apresentação' : REFEREE, `${fix ? 'Correção confirmada' : 'Súmula confirmada'}: ${T(c, m.home).name} ${h} × ${a}${m.pen ? ` (pênaltis ${m.pen[0]}×${m.pen[1]})` : ''} ${T(c, m.away).name}`, null, m)
  resolveKO(c)
  if (m.phase === 'final') { c.status = 'encerrado'; log(c, SEC, `${T(c, winner(m)).name} é campeão da ${c.name}`) }
  if (quiet) return
  ui.highlight = [m.home, m.away]
  if (role() === 'secretaria') { ui.tab = 'jogos'; scrollTo(0, 0) }
  toast(m.phase === 'final' ? `Campeão: ${T(c, winner(m)).name}!` : 'Súmula confirmada. Classificação atualizada.')
}
async function sync() {
  let n = 0
  for (const c of S.champs) for (const m of c.matches) for (const e of m.events) if (!e.sent) { e.sent = true; n++ }
  if (n) { log(C(), REFEREE, `Sinal voltou: ${n} evento(s) enviados sem duplicar`); toast(`Sinal voltou: ${n} evento(s) enviados sem duplicar.`) }
  for (const c of S.champs) for (const m of c.matches.filter(x => x.pendingConfirm)) await finalize(c, m)
}
function nextBatch(c) {
  resolveKO(c)
  const open = c.matches.filter(m => !isDone(m) && !m.pendingConfirm && m.home && m.away && !m.events.length).sort(byDate)
  if (!open.length) return null
  const f = open[0], key = m => m.phase === 'grupos' ? 'r' + m.round : 'd' + m.date
  return {batch: open.filter(m => key(m) === key(f)), label: f.phase === 'grupos' ? `a rodada ${f.round}` : f.phase === 'semi' ? 'as semifinais' : 'a final e o 3º lugar'}
}
function simEvents(c, m) {
  const susp = discipline(c).susp[m.id] || {}, cfg = cfgOf(c), R = n => Math.floor(Math.random() * n), evs = []
  for (const t of [m.home, m.away]) {
    const ps = c.players.filter(p => p.team === t && insc(c, p)[0] === 'aprovado' && !susp[p.id]); if (!ps.length) continue
    for (let i = R(5); i--;) evs.push({type: 'gol', team: t, player: ps[R(ps.length)].id})
    if (Math.random() < .4) evs.push({type: 'amarelo', team: t, player: ps[R(ps.length)].id})
    for (let i = 1 + R(4); i--;) evs.push({type: 'falta', team: t, player: null})
  }
  m.events = evs.map(e => ({...e, min: 1 + R(cfg.half * 2)})).sort((a, b) => a.min - b.min)
    .map((e, k) => ({...e, id: `${m.id}s${k}`, half: e.min > cfg.half ? 2 : 1, sent: true}))
  if (m.phase !== 'grupos') { const [h, a] = goals(m); if (h === a) { const x = 3 + R(3); m.pen = Math.random() < .5 ? [x, x - 1] : [x - 1, x] } }
  m.simulated = true
}
async function resizePhoto(file) {
  if (!file || !file.size) return null
  if (!file.type.startsWith('image/') || file.size > 15e6) throw new Error('foto')
  const img = await createImageBitmap(file), s = 200, cv = document.createElement('canvas'); cv.width = cv.height = s
  const k = Math.max(s / img.width, s / img.height)
  cv.getContext('2d').drawImage(img, (s - img.width * k) / 2, (s - img.height * k) / 2, img.width * k, img.height * k)
  return cv.toDataURL('image/jpeg', .8)
}

const A = {
  login: d => {
    if (d.role === 'equipe') { const [cid, tid] = $('#login-team').value.split('|'); S.session = {role: 'equipe', teamId: tid}; S.champId = cid }
    else S.session = {role: d.role}
    resetTransient(); ui.tab = ROLE_TABS[d.role][0][0]; scrollTo(0, 0)
  },
  logout: () => { S.session = null; S.offline = false; resetTransient(); ui.doc = null },
  tab: d => { ui.tab = d.tab; ui.picker = ui.manage = ui.punish = null; scrollTo(0, 0) },
  champ: d => { S.champId = d.id; resetTransient(); ui.tab = 'painel'; scrollTo(0, 0) },
  pchamp: d => { S.champId = d.id; resetTransient() },
  open: d => { ui.matchId = d.id; ui.tab = 'sumula'; ui.picker = ui.signing = null; scrollTo(0, 0) },
  team: d => { ui.team = d.team; ui.punish = null },
  manage: d => { ui.manage = d.id && ui.manage !== d.id ? d.id : null },
  punish: d => { ui.punish = d.id && ui.punish !== d.id ? d.id : null },
  net: async () => { S.offline = !S.offline; if (!S.offline) await sync() },
  half: d => { const m = cur(); m.half = +d.h; ui.clock = {id: m.id, sec: (m.half - 1) * cfgOf(C()).half * 60, running: false} },
  clock: () => { ui.clock.running = !ui.clock.running },
  ev: d => { if (d.type === 'falta') addEv(d.team, 'falta', null); else ui.picker = {id: ui.matchId, type: d.type, team: d.team} },
  pick: d => { addEv(ui.picker.team, ui.picker.type, d.id); ui.picker = null },
  cancelpick: () => { ui.picker = null },
  undo: d => { const c = C(), m = cur(), e = m.events.find(x => x.id === d.id); if (!e) return
    m.events = m.events.filter(x => x !== e)
    log(c, REFEREE, `Evento desfeito em ${label(c, m)}: ${TYPES[e.type]}${e.player ? ' de ' + P(c, e.player).name : ''} (${e.min}')`, null, m) },
  sign: () => { ui.signing = ui.matchId; ui.clock.running = false; ui.picker = null },
  unsign: () => { ui.signing = null },
  clearsig: d => { delete cur().signatures[d.k] },
  confirm: async () => {
    const c = C(), m = cur()
    if (m.phase !== 'grupos' && goals(m)[0] === goals(m)[1]) {
      const p = m.pen; if (!p || !Number.isInteger(p[0]) || !Number.isInteger(p[1]) || p[0] === p[1]) return toast('Informe o placar dos pênaltis (não pode empatar).')
    } else m.pen = null
    if (['arbitro', 'home', 'away'].some(k => !m.signatures[k])) return toast('Faltam assinaturas.')
    ui.signing = null
    if (S.offline) { m.pendingConfirm = true; log(c, REFEREE, `Súmula de ${label(c, m)} encerrada sem internet; aguardando sinal`, null, m); toast('Sem internet: súmula guardada no aparelho.') }
    else await finalize(c, m)
  },
  auth: d => { const c = C(), p = P(c, d.id); p.auth = true; log(c, SEC, `Autorização do responsável registrada: ${p.name} (${T(c, p.team).name})`) },
  approve: d => { const c = C(), p = P(c, d.id); p.approved = true; log(c, SEC, `Inscrição aprovada: ${p.name} (${T(c, p.team).name})`) },
  reject: d => { const c = C(), p = P(c, d.id); c.players = c.players.filter(x => x !== p); log(c, SEC, `Inscrição recusada: ${p.name} (${T(c, p.team).name})`); toast('Inscrição recusada.') },
  simulate: async () => { const c = C(), nb = nextBatch(c); if (!nb) return toast('Nenhum jogo pronto para simular.')
    for (const m of nb.batch) { simEvents(c, m); await finalize(c, m, true) }
    ui.highlight = nb.batch.flatMap(m => [m.home, m.away])
    toast(champion(c) ? `Campeão: ${T(c, champion(c)).name}!` : `Simulado: ${nb.label}.`) },
  commit: async () => {
    const seed = [...crypto.getRandomValues(new Uint8Array(8))].map(x => x.toString(16).padStart(2, '0')).join('')
    try { ui.draw = {seed, hash: await sha(seed), cid: C().id}; log(C(), SEC, `Compromisso do sorteio publicado: ${ui.draw.hash.slice(0, 16)}…`) } catch (e) { toast(e.message) } },
  reveal: async () => { ui.draw.revealed = true; ui.draw.ok = (await sha(ui.draw.seed)) === ui.draw.hash; log(C(), SEC, `Semente do sorteio revelada: ${ui.draw.seed}`) },
  redraw: () => { ui.draw = ui.verify = null },
  applydraw: () => {
    const c = C(), d = ui.draw
    if (!d?.ok || c.status !== 'inscricoes' || c.teams.length < 4) return
    c.teams.forEach(t => { t.group = d.groups.A.includes(t.id) ? 'A' : 'B' })
    c.matches = buildFixtures(c, d.groups, c.start)
    c.draw = {seed: d.seed, entrada: d.entrada, final: d.final, hash: d.hash, groups: d.groups, at: new Date().toISOString()}; c.status = 'andamento'
    log(c, SEC, `Sorteio aplicado: grupos definidos e tabela de ${c.matches.length} jogos gerada`)
    ui.draw = null; ui.tab = 'jogos'; scrollTo(0, 0); toast('Tabela gerada!')
  },
  doc: d => { ui.doc = {c: d.c, id: d.id} },
  copylink: d => { navigator.clipboard?.writeText(d.link).then(() => toast('Link copiado. Cole no WhatsApp da equipe.'), () => toast(d.link)); return 'stay' },
  editchamp: d => { ui.editChamp = d.id || null; setTimeout(() => document.getElementById('champform')?.scrollIntoView({behavior: 'smooth'})) },
  closedoc: () => { ui.doc = null },
  print: () => { print(); return 'stay' },
  dl: d => { download(+d.i); return 'stay' },
  share: d => { ui.cards[+d.i].toBlob(b => {
      const f = new File([b], `tnt-${CARDS[+d.i]}.png`, {type: 'image/png'})
      if (navigator.canShare?.({files: [f]})) navigator.share({files: [f], title: 'TNT Esportes'}).catch(() => {})
      else { download(+d.i); toast('O compartilhamento direto funciona no celular. A imagem foi baixada.') } })
    return 'stay' },
  reset: async () => {
    const sess = S.session; S = seed(); resetTransient(); ui.doc = null
    S.session = sess && (sess.role !== 'equipe' || S.champs.some(c => T(c, sess.teamId))) ? sess : null
    if (S.session?.role === 'equipe') S.champId = S.champs.find(c => T(c, sess.teamId)).id
    await ensureHashes(); toast('Dados de exemplo restaurados.')
  },
}

const F = {
  athlete: async d => {
    const c = C(), mode = role() === 'equipe' ? 'team' : 'sec', t = mode === 'team' ? S.session.teamId : ui.team
    const name = d.name.trim().replace(/\s+/g, ' '), num = +d.num
    if (name.length < 3 || !(num >= 1 && num <= 99) || !/^\d{4}-\d{2}-\d{2}$/.test(d.birth) || d.birth > c.start) return toast('Confira nome, número (1 a 99) e data de nascimento.')
    if (!d.consent) return toast('É preciso o consentimento para uso dos dados.')
    if (c.players.some(p => p.team === t && p.num === num)) return toast(`O número ${num} já está em uso nesta equipe.`)
    let photo; try { photo = await resizePhoto(d.photo) } catch { return toast('Não foi possível ler a foto. Use uma imagem JPG ou PNG.') }
    const p = {id: uid(), team: t, name, num, birth: d.birth, bairro: BAIRROS.includes(d.bairro) ? d.bairro : BAIRROS[0], auth: !!d.auth, approved: mode === 'sec', consent: true, photo,
      nick: d.nick?.trim() || null, pos: d.pos || null, phone: d.phone?.trim() || null, resp: d.resp?.trim() || null, respPhone: d.respPhone?.trim() || null}
    c.players.push(p)
    const [s, why] = insc(c, p)
    log(c, mode === 'team' ? `Equipe ${T(c, t).name}` : SEC, `${mode === 'team' ? 'Atleta enviado para aprovação' : 'Atleta inscrito'}: ${name} (${T(c, t).name})`)
    toast(`${name}: ${SPILL[s][1].toLowerCase()}${why ? '. ' + why : ''}.`)
  },
  newteam: d => {
    const c = C(), name = d.name.trim().replace(/\s+/g, ' ')
    if (name.length < 3) return toast('Informe o nome da equipe.')
    if (c.teams.some(t => t.name.toLowerCase() === name.toLowerCase())) return toast('Já existe uma equipe com esse nome.')
    const id = 't' + uid().replace(/-/g, '').slice(0, 8)
    c.teams.push({id, name, group: null, pot: d.seedpot ? 1 : 2, code: code(name.replace(/[^A-Za-z]/g, '') || 'EQP', c.teams.length + 11), bairro: BAIRROS.includes(d.bairro) ? d.bairro : BAIRROS[0]})
    ui.team = id; log(c, SEC, `Equipe cadastrada: ${name}`); toast('Equipe cadastrada.')
  },
  newchamp: d => {
    const name = d.name.trim(), min = +d.min, max = d.max === '' ? null : +d.max
    if (name.length < 5 || !SPORTS[d.sport] || !/^\d{4}-\d{2}-\d{2}$/.test(d.start)) return toast('Confira nome, modalidade e data de início.')
    if (!(min >= 5 && min <= 80) || (max !== null && !(max >= min && max <= 99))) return toast('Faixa etária inválida.')
    const c = champBase({id: 'c' + uid().replace(/-/g, '').slice(0, 8), name, sport: d.sport, category: d.category.trim() || 'Livre', minAge: min, maxAge: max, start: d.start, venue: d.venue.trim() || 'A definir'})
    log(c, SEC, 'Campeonato criado; inscrições abertas')
    S.champs.push(c); S.champId = c.id; resetTransient(); ui.tab = 'inscricoes'; toast('Campeonato criado. Cadastre as equipes.')
  },
  manage: async d => {
    const c = C(), m = findMatch(c, ui.manage), why = d.why.trim()
    if (!m) return
    if (why.length < 5) return toast('Informe o motivo.')
    if (d.acao === 'wo') {
      if (![m.home, m.away].includes(d.ausente)) return
      m.wo = d.ausente; m.events = []; m.status = 'encerrado'; m.hash = await sha(sumulaPayload(c, m)).catch(() => null)
      log(c, SEC, `W.O.: ${T(c, d.ausente).name} não compareceu (${label(c, m)})`, why, m); resolveKO(c)
      if (m.phase === 'final') c.status = 'encerrado'
    } else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || !/^\d{2}:\d{2}$/.test(d.time)) return toast('Informe nova data e horário.')
      const old = `${dm(m.date)} ${m.time}`; m.date = d.date; m.time = d.time.replace(':', 'h'); m.postponed = true
      log(c, SEC, `Jogo adiado: ${label(c, m)}, de ${old} para ${dm(m.date)} ${m.time}`, why, m)
    }
    ui.manage = null; toast('Registrado no histórico.')
  },
  punish: d => {
    const c = C(), p = P(c, ui.punish), why = d.why.trim(), n = Math.min(3, Math.max(1, +d.games || 1))
    if (why.length < 5) return toast('Informe a decisão ou o motivo.')
    const ms = nextMatches(c, p.team).slice(0, n)
    if (!ms.length) return toast('A equipe não tem próximos jogos definidos.')
    c.punishments.push({player: p.id, matches: ms.map(m => m.id), why})
    log(c, SEC, `Suspensão de ${ms.length} jogo(s) aplicada a ${p.name} (${T(c, p.team).name})`, why); ui.punish = null; toast('Suspensão aplicada.')
  },
  reopen: d => {
    const c = C(), m = cur(), why = d.why.trim()
    if (why.length < 5) return toast('Informe o motivo da correção.')
    m.wo = null; m.status = 'correcao'; m.signatures = {}; m.hash = null
    if (m.phase === 'final') c.status = 'andamento'
    log(c, SEC, `Súmula reaberta para correção: ${label(c, m)}`, why, m)
  },
  dodraw: async d => {
    const entrada = d.entrada.trim()
    if (!ui.draw?.hash || ui.draw.groups) return
    if (!ui.draw.seed) return toast('A semente secreta fica só no aparelho que publicou o compromisso. Faça o sorteio nele.')
    if (entrada.length < 3) return toast('Digite a entrada pública (pelo menos 3 caracteres).')
    try { const final = await finalSeed(ui.draw.seed, entrada); Object.assign(ui.draw, {entrada, final, groups: drawGroups(C().teams, final)})
      log(C(), SEC, `Sorteio feito em público · entrada pública: ${entrada}`) } catch (e) { toast(e.message) }
  },
  verify: async d => {
    const c = C(), seed = d.seed.trim().toLowerCase(), entrada = d.entrada.trim()
    if (!/^[0-9a-f]{16}$/.test(seed)) return toast('A semente tem 16 caracteres (0 a 9 e a a f).')
    try { const final = await finalSeed(seed, entrada); ui.verify = {seed, entrada, final, hash: await sha(seed), groups: drawGroups(c.teams, final), cid: c.id} } catch (e) { toast(e.message) }
  },
  sumcheck: async d => {
    const k = d.code.toLowerCase().replace(/[^0-9a-f]/g, '')
    if (k.length < 8) return toast('Digite o código de autenticidade (12 caracteres).')
    for (const c of S.champs) for (const m of c.matches) if (m.hash && m.hash.startsWith(k)) {
      ui.sumCheck = {cid: c.id, mid: m.id, ok: (await sha(sumulaPayload(c, m)).catch(() => null)) === m.hash}; return
    }
    ui.sumCheck = {none: true}
  },
}

/* ---------- desenho da página ---------- */
const VIEWS = {painel: vPainel, campeonatos: vCamps, inscricoes: vInscricoes, jogos: vJogos, sumula: vSumula, sorteio: vSorteio,
               relatorios: vRelatorios, divulgacao: vDiv, portal: vPortal, equipe: vEquipe}
function render() {
  const r = role(), app = $('#app'), doc = $('#doc')
  if (r === 'equipe') { const c = S.champs.find(x => T(x, S.session.teamId)); if (c) S.champId = c.id; else S.session = null }
  if (!role()) {
    $('#hright').innerHTML = ''; $('#tabs').innerHTML = ''; app.className = ''; app.innerHTML = vLogin(); doc.hidden = true
    document.body.classList.remove('doc-open'); return
  }
  const tabs = ROLE_TABS[r]
  if (!tabs.some(([k]) => k === ui.tab)) ui.tab = tabs[0][0]
  const c = C()
  if (REAL && c && !ui.draw && c.pendingDraw) ui.draw = {...c.pendingDraw}
  $('#hright').innerHTML = (r === 'equipe' ? `<span class="who"><span><b>${esc(T(c, S.session.teamId).name)}</b>Equipe</span></span>`
    : `<select class="hsel" id="sel-champ" aria-label="Campeonato">${S.champs.map(x => `<option value="${x.id}" ${x.id === c?.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select><span class="who"><span><b>${esc(S.session.name || ROLES[r].name)}</b>${ROLES[r].label}</span></span>`)
    + '<button class="out" data-act="logout">Trocar perfil</button>'
  $('#tabs').innerHTML = tabs.map(([k, l]) => `<button class="${ui.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}" ${ui.tab === k ? 'aria-current="page"' : ''}>${l}</button>`).join('')
  app.className = 'wrap'; app.innerHTML = c || ['campeonatos', 'relatorios'].includes(ui.tab) ? VIEWS[ui.tab]()
    : `<div class="card empty mt">Nenhum campeonato cadastrado ainda.${r === 'secretaria' ? '<div style="margin-top:12px"><button class="btn" data-act="tab" data-tab="campeonatos">Criar o primeiro campeonato</button></div>' : ''}</div>`
  doc.hidden = !ui.doc; doc.innerHTML = ui.doc ? vDoc() : ''
  document.body.classList.toggle('doc-open', !!ui.doc)
  if (ui.tab === 'sumula') hookPads()
  if (ui.tab === 'divulgacao' && c?.matches.length)
    Promise.all([document.fonts.load('700 40px "Barlow Condensed"'), document.fonts.load('600 30px Barlow')]).catch(() => {}).finally(buildCards)
}

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b || b.disabled) return
  if (await A[b.dataset.act](b.dataset) === 'stay') return
  save(); render()
})
document.addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target
  await F[f.dataset.form](Object.fromEntries(new FormData(f))); save(); render()
})
document.addEventListener('change', e => {
  if (e.target.id === 'sel-match') { ui.matchId = e.target.value; ui.picker = ui.signing = null; render() }
  if (e.target.id === 'sel-champ') { S.champId = e.target.value; resetTransient(); save(); render() }
})
document.addEventListener('input', e => {   // campos da tela de assinatura: guardam sem redesenhar
  const m = ui.signing && cur(); if (!m) return
  if (e.target.dataset.pen !== undefined) { m.pen ??= [null, null]; m.pen[+e.target.dataset.pen] = e.target.value === '' ? null : +e.target.value; save() }
  if (e.target.dataset.notes !== undefined) { m.notes = e.target.value.slice(0, 600); save() }
})
document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.doc) { ui.doc = null; render() } })
setInterval(() => { if (!ui.clock.running) return; ui.clock.sec++; const el = document.getElementById('clock'); if (el) el.textContent = fmt(ui.clock.sec) }, 1000)

async function ensureHashes() { for (const c of S.champs) for (const m of c.matches) if (isDone(m) && !m.hash) m.hash = await sha(sumulaPayload(c, m)).catch(() => null) }
if (!REAL) {   // protótipo; o modo oficial começa em api.js
  S.champs.forEach(resolveKO)
  // link direto: index.html#publico/portal, #secretaria/jogos, #arbitro/sumula
  const [hr, ht] = decodeURIComponent(location.hash.slice(1)).split('/')
  if (ROLE_TABS[hr] && hr !== 'equipe') { S.session = {role: hr}; ui.tab = ht }
  render()
  ensureHashes().then(() => { save(); render() })
}
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {})

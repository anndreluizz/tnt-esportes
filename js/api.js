// Modo oficial (oficial.html): as mesmas telas do protótipo, com os dados no Supabase.
// Público lê sem login; a Secretaria entra com e-mail e senha. Toda mudança vai ao banco
// (tabelas protegidas por RLS ou funções que conferem permissão) e depois a tela recarrega do banco.
let sb
const seedKey = cid => 'tnt-semente-' + cid   // semente secreta do sorteio: só no aparelho que publicou o compromisso
const local = {get: k => { try { return localStorage.getItem(k) } catch { return null } },
               set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch {} }}

const ERR = {'42501': 'Sem permissão para isso.', '23505': 'Já existe um registro igual (nome ou número repetido).', '23514': 'Algum dado está fora do permitido.'}
async function q(p) { const {data, error} = await p; if (error) throw new Error(ERR[error.code] || error.message); return data }

// linhas do banco -> mesmo formato de dados.js (champs/teams/players/matches), para reaproveitar telas e regras.js
async function toState(r) {
  const camps = r.campeonatos.map(c => champBase({id: c.id, name: c.nome, sport: c.modalidade, category: c.categoria, minAge: c.idade_min,
    maxAge: c.idade_max, start: c.inicio, venue: c.local, status: c.status}))
  const byId = Object.fromEntries(camps.map(c => [c.id, c]))
  const teamCamp = Object.fromEntries(r.equipes.map(t => [t.id, t.campeonato_id])), jogoCamp = Object.fromEntries(r.jogos.map(j => [j.id, j.campeonato_id]))
  for (const t of r.equipes) byId[t.campeonato_id]?.teams.push({id: t.id, name: t.nome, group: t.grupo, pot: t.pote, code: t.codigo, bairro: t.bairro})
  for (const p of r.atletas) byId[teamCamp[p.equipe_id]]?.players.push({id: p.id, team: p.equipe_id, name: p.nome, num: p.numero, birth: p.nascimento,
    bairro: p.bairro ?? '', auth: p.autorizacao ?? true, approved: p.aprovado ?? true, consent: true, photo: null})   // portal: só aprovados, sem nascimento
  const evs = {}
  for (const e of r.eventos) (evs[e.jogo_id] ??= []).push({id: e.id, type: e.tipo, team: e.equipe_id, player: e.atleta_id, min: e.minuto, half: e.tempo, sent: true})
  for (const j of r.jogos) byId[j.campeonato_id]?.matches.push(newMatch({id: j.id, phase: j.fase, round: j.rodada, group: j.grupo, title: j.titulo,
    home: j.mandante_id, away: j.visitante_id, slotH: j.vaga_mandante, slotA: j.vaga_visitante, date: j.data, time: j.hora, status: j.status,
    events: (evs[j.id] || []).sort((a, b) => a.half - b.half || a.min - b.min), pen: j.pen_mandante == null ? null : [j.pen_mandante, j.pen_visitante],
    wo: j.wo_ausente_id, postponed: j.adiado, notes: j.observacoes, hash: j.hash, referee: 'Árbitro escalado'}))
  for (const h of r.historico) {   // vem do mais novo para o mais antigo
    const c = byId[h.campeonato_id ?? jogoCamp[h.jogo_id]]; if (!c) continue
    const e = {at: h.em, who: h.quem, what: h.o_que, ...(h.motivo ? {why: h.motivo} : {})}
    c.log.push(e); if (h.jogo_id) findMatch(c, h.jogo_id)?.history.unshift(e)
  }
  for (const s of r.suspensoes) { const c = byId[teamCamp[r.atletas.find(p => p.id === s.atleta_id)?.equipe_id]]
    c?.punishments.push({player: s.atleta_id, matches: s.jogo_ids, why: s.motivo}) }
  for (const d of r.sorteios) {
    const c = byId[d.campeonato_id]; if (!c) continue
    if (d.grupos) { c.draw = {seed: d.semente, entrada: d.entrada_publica, final: await finalSeed(d.semente, d.entrada_publica), hash: d.hash, groups: d.grupos, at: d.revelado_em}; continue }
    // compromisso publicado, tabela ainda não gerada: retoma o sorteio de onde parou
    const pd = c.pendingDraw = {cid: c.id, hash: d.hash, seed: d.semente || local.get(seedKey(c.id))}
    if (d.revelado_em) { const final = await finalSeed(d.semente, d.entrada_publica)
      Object.assign(pd, {entrada: d.entrada_publica, final, groups: drawGroups(c.teams, final), revealed: true, ok: true}) }
  }
  return camps
}

async function loadAll() {
  const sec = role() === 'secretaria', all = t => q(sb.from(t).select('*'))
  // ponytail: cada consulta traz até 1000 linhas (limite do Supabase); paginar se a cidade passar disso
  const [campeonatos, equipes, atletas, jogos, eventos, sorteios, historico, suspensoes] = await Promise.all([
    q(sb.from('campeonatos').select('*').order('criado_em')), q(sb.from(sec ? 'equipes' : 'equipes_publico').select('*').order('nome')),
    all(sec ? 'atletas' : 'atletas_publico'), all('jogos'), all('eventos'), all('sorteios_publico'),
    q(sb.from(sec ? 'historico' : 'historico_publico').select('*').order('em', {ascending: false}).limit(1000)), sec ? all('suspensoes') : []])
  S.champs = await toState({campeonatos, equipes, atletas, jogos, eventos, sorteios, historico, suspensoes})
  if (!S.champs.some(c => c.id === S.champId)) S.champId = S.champs[0]?.id ?? null
}

async function enter(user) {
  const p = (await q(sb.from('perfis').select('nome, papel').eq('id', user.id)))[0]
  if (p?.papel === 'secretaria') { S.session = {role: 'secretaria', name: p.nome}; return true }
  await sb.auth.signOut()
  toast(p ? 'O acesso de árbitros e equipes chega na próxima etapa. Por enquanto, veja o portal público.' : 'Esta conta ainda não tem perfil no sistema. Fale com a Secretaria.')
  return false
}

function loginReal() {
  return `<div class="login"><div class="lhero"><div class="wrap"><div class="eyebrow">Secretaria Municipal de Esportes · Tonantins/AM</div>
    <h1>TNT ESPORTES</h1><p>Organizando o esporte. Conectando pessoas.</p></div></div>
    <div class="wrap"><div class="roles">
      <div class="role"><div class="ic">${IC.sec}</div><h3>Secretaria</h3><p>Entre com o e-mail e a senha da Secretaria.</p>
        <form class="f" data-form="signin"><label class="span2">E-mail<input name="email" type="email" required autocomplete="username"></label>
          <label class="span2">Senha<input name="senha" type="password" required autocomplete="current-password"></label><div class="span2"><button class="btn">Entrar</button></div></form></div>
      <div class="role"><div class="ic">${IC.pub}</div><h3>População</h3><p>Tabela, jogos, artilharia e súmulas abertos para todos, sem login.</p><button class="btn" data-act="login" data-role="publico">Ver o portal</button></div>
    </div><p class="note" style="text-align:center;margin:20px 0">Sistema oficial, com dados reais. Árbitros e equipes terão acesso na próxima etapa.</p></div></div>`
}

// mudança no banco: mostra o erro em português e sempre recarrega, para a tela ficar igual ao banco
const write = fn => async d => { try { await fn(d) } catch (e) { toast(e.message) } try { await loadAll() } catch (e) { toast('Sem conexão com o banco: ' + e.message) } }
const rpc = (f, args) => q(sb.rpc(f, args))
const atleta = (id, campos) => q(sb.from('atletas').update(campos).eq('id', id))

const REAL_A = {
  logout: async () => { await sb.auth.signOut(); S.session = null; resetTransient(); ui.doc = null; render(); await loadAll() },
  auth: write(d => atleta(d.id, {autorizacao: true})),
  approve: write(d => atleta(d.id, {aprovado: true})),
  reject: write(async d => { await q(sb.from('atletas').delete().eq('id', d.id)); toast('Inscrição recusada.') }),
  commit: write(async () => {
    const c = C(), seed = [...crypto.getRandomValues(new Uint8Array(8))].map(x => x.toString(16).padStart(2, '0')).join(''), hash = await sha(seed)
    local.set(seedKey(c.id), seed)   // guarda antes de publicar: se a resposta se perder, a semente não se perde
    await rpc('publicar_compromisso', {c: c.id, h: hash}); ui.draw = {seed, hash, cid: c.id}
  }),
  reveal: write(async () => {
    const d = ui.draw, final = await rpc('revelar_semente', {c: d.cid, s: d.seed, entrada: d.entrada})
    Object.assign(d, {revealed: true, ok: final === d.final && (await sha(d.seed)) === d.hash})
  }),
  applydraw: write(async () => {
    const c = C(), d = ui.draw
    if (!d?.ok || c.status !== 'inscricoes') return
    const ms = buildFixtures(c, d.groups, c.start), id = Object.fromEntries(ms.map(m => [m.id, uid()]))   // o banco usa uuid
    const vaga = s => s && s.replace(/^([VP]):(.+)$/, (_, k, x) => `${k}:${id[x]}`)
    await rpc('aplicar_sorteio', {c: c.id, g: d.groups, jogos_novos: ms.map(m => ({id: id[m.id], fase: m.phase, rodada: m.round, grupo: m.group, titulo: m.title,
      mandante_id: m.home, visitante_id: m.away, vaga_mandante: vaga(m.slotH), vaga_visitante: vaga(m.slotA), data: m.date, hora: m.time}))})
    local.set(seedKey(c.id), null); ui.draw = null; ui.tab = 'jogos'; scrollTo(0, 0); toast('Tabela gerada!')
  }),
}

const REAL_F = {
  signin: async d => {
    const {data, error} = await sb.auth.signInWithPassword({email: d.email.trim(), password: d.senha})
    if (error) return toast(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message)
    if (await enter(data.user)) { resetTransient(); ui.tab = 'painel'; scrollTo(0, 0) }
    await loadAll()
  },
  athlete: write(async d => {
    const c = C(), name = d.name.trim().replace(/\s+/g, ' '), num = +d.num
    if (name.length < 3 || !(num >= 1 && num <= 99) || !/^\d{4}-\d{2}-\d{2}$/.test(d.birth) || d.birth > c.start) return toast('Confira nome, número (1 a 99) e data de nascimento.')
    if (!d.consent) return toast('É preciso o consentimento para uso dos dados.')
    if (c.players.some(p => p.team === ui.team && p.num === num)) return toast(`O número ${num} já está em uso nesta equipe.`)
    // ponytail: foto ainda não vai para o bucket "fotos"; entra junto com o acesso das equipes
    const p = {birth: d.birth, auth: !!d.auth, approved: true}
    await q(sb.from('atletas').insert({equipe_id: ui.team, nome: name, numero: num, nascimento: d.birth, bairro: BAIRROS.includes(d.bairro) ? d.bairro : BAIRROS[0],
      autorizacao: p.auth, aprovado: true, consentimento: true}))
    const [s, why] = insc(c, p); toast(`${name}: ${SPILL[s][1].toLowerCase()}${why ? '. ' + why : ''}.`)
  }),
  newteam: write(async d => {
    const c = C(), name = d.name.trim().replace(/\s+/g, ' ')
    if (name.length < 3) return toast('Informe o nome da equipe.')
    const [t] = await q(sb.from('equipes').insert({campeonato_id: c.id, nome: name, bairro: BAIRROS.includes(d.bairro) ? d.bairro : BAIRROS[0], pote: d.seedpot ? 1 : 2}).select('id'))
    ui.team = t.id; toast('Equipe cadastrada.')
  }),
  newchamp: write(async d => {
    const name = d.name.trim(), min = +d.min, max = d.max === '' ? null : +d.max
    if (name.length < 5 || !SPORTS[d.sport] || !/^\d{4}-\d{2}-\d{2}$/.test(d.start)) return toast('Confira nome, modalidade e data de início.')
    if (!(min >= 5 && min <= 80) || (max !== null && !(max >= min && max <= 99))) return toast('Faixa etária inválida.')
    const [c] = await q(sb.from('campeonatos').insert({nome: name, modalidade: d.sport, categoria: d.category.trim() || 'Livre', idade_min: min, idade_max: max,
      inicio: d.start, local: d.venue.trim() || 'A definir'}).select('id'))
    S.champId = c.id; resetTransient(); ui.tab = 'inscricoes'; toast('Campeonato criado. Cadastre as equipes.')
  }),
  manage: write(async d => {
    const m = findMatch(C(), ui.manage), why = d.why.trim()
    if (!m) return
    if (why.length < 5) return toast('Informe o motivo.')
    if (d.acao === 'wo') await rpc('registrar_wo', {j: m.id, ausente: d.ausente, motivo: why})
    else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || !/^\d{2}:\d{2}$/.test(d.time)) return toast('Informe nova data e horário.')
      await rpc('adiar_jogo', {j: m.id, nova_data: d.date, nova_hora: d.time.replace(':', 'h'), motivo: why})
    }
    ui.manage = null; toast('Registrado no histórico.')
  }),
  punish: write(async d => {
    const why = d.why.trim()
    if (why.length < 5) return toast('Informe a decisão ou o motivo.')
    await rpc('aplicar_suspensao', {a: ui.punish, n: Math.min(3, Math.max(1, +d.games || 1)), motivo: why}); ui.punish = null; toast('Suspensão aplicada.')
  }),
  sumcheck: async d => {
    const k = d.code.toLowerCase().replace(/[^0-9a-f]/g, '')
    if (k.length < 8) return toast('Digite o código de autenticidade (12 caracteres).')
    try { const [r] = await rpc('conferir_sumula', {codigo: k}), c = r && S.champs.find(x => findMatch(x, r.jogo_id))
      ui.sumCheck = c ? {cid: c.id, mid: r.jogo_id, ok: r.autentica} : {none: true} } catch (e) { toast(e.message) }
  },
}

async function startReal() {
  sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
  Object.assign(A, REAL_A); Object.assign(F, REAL_F)
  try {
    const {data: {session}} = await sb.auth.getSession()
    if (session) await enter(session.user)
    if (!S.session && location.hash === '#portal') S.session = {role: 'publico'}
    await loadAll()
  } catch (e) { toast('Sem conexão com o banco: ' + e.message) }
  render()
}
if (REAL) startReal()

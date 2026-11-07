// Modo oficial (oficial.html): as mesmas telas do protótipo, com os dados no Supabase.
// Público lê sem login; Secretaria e árbitros entram com e-mail e senha. Toda mudança vai ao banco
// (tabelas protegidas por RLS ou funções que conferem permissão) e depois a tela recarrega do banco.
// Súmula: o que ainda não chegou ao banco fica guardado no aparelho e é enviado quando o sinal volta.
let sb
const seedKey = cid => 'tnt-semente-' + cid   // semente secreta do sorteio: só no aparelho que publicou o compromisso
const draftKey = id => 'tnt-sumula-' + id      // eventos ainda não enviados, assinaturas, observações
const local = {get: k => { try { return localStorage.getItem(k) } catch { return null } },
               set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch {} }}
const json = k => { try { return JSON.parse(local.get(k)) } catch { return null } }

const ERR = {'23503': 'Não dá para excluir: já existem jogos ou resultados ligados a isso.', '42501': 'Sem permissão para isso.', '23505': 'Já existe um registro igual (nome ou número repetido).', '23514': 'Algum dado está fora do permitido.'}
// erro sem código = não chegou ao banco (sem internet)
async function q(p) { const {data, error} = await p; if (error) throw Object.assign(new Error(ERR[error.code] || error.message), {code: error.code}); return data }

// linhas do banco -> mesmo formato de dados.js (champs/teams/players/matches), para reaproveitar telas e regras.js
async function toState(r) {
  const marca = p => p ? `${SUPABASE_URL}/storage/v1/object/public/marcas/${p}` : null   // logos são públicas
  const camps = r.campeonatos.map(c => champBase({id: c.id, name: c.nome, sport: c.modalidade, category: c.categoria, minAge: c.idade_min,
    maxAge: c.idade_max, start: c.inicio, venue: c.local, status: c.status, format: c.formato, rules: c.regras || {}, logo: marca(c.logo_path), responsible: c.responsavel,
    responsiblePhone: c.responsavel_telefone, regUntil: c.inscricao_ate, maxPlayers: c.max_atletas, cancelledDraws: [],
    sponsors: (c.patrocinadores || []).map(x => ({name: x.nome, logo: marca(x.logo_path), path: x.logo_path}))}))
  const byId = Object.fromEntries(camps.map(c => [c.id, c]))
  const teamCamp = Object.fromEntries(r.equipes.map(t => [t.id, t.campeonato_id])), jogoCamp = Object.fromEntries(r.jogos.map(j => [j.id, j.campeonato_id]))
  const nomes = Object.fromEntries((r.perfis || []).map(p => [p.id, p.nome]))
  if (S.session?.uid) nomes[S.session.uid] = S.session.name
  for (const t of r.equipes) byId[t.campeonato_id]?.teams.push({id: t.id, name: t.nome, group: t.grupo, pot: t.pote, code: t.codigo, bairro: t.bairro ?? '', token: t.link_token,
    crest: marca(t.escudo_path), colors: t.cores, coach: t.responsavel, coachPhone: t.responsavel_telefone})
  for (const p of r.atletas) byId[teamCamp[p.equipe_id]]?.players.push({id: p.id, team: p.equipe_id, name: p.nome, num: p.numero, birth: p.nascimento,
    bairro: p.bairro ?? '', address: p.endereco, city: p.municipio, auth: p.autorizacao ?? true, approved: p.aprovado ?? true, consent: true, photo: p.foto_url ?? null, photoPath: p.foto_path,
    nick: p.apelido, pos: p.posicao, phone: p.telefone, resp: p.responsavel, respPhone: p.responsavel_telefone, origin: p.origem,
    rg: [p.rg_frente_path, p.rg_verso_path].filter(Boolean)})   // portal: só aprovados, sem nascimento, foto nem documento
  const evs = {}
  for (const e of r.eventos) (evs[e.jogo_id] ??= []).push({id: e.id, type: e.tipo, team: e.equipe_id, player: e.atleta_id, min: e.minuto, half: e.tempo, sent: true})
  for (const j of r.jogos) {
    const a = j.assinaturas || {}, m = newMatch({id: j.id, phase: j.fase, round: j.rodada, group: j.grupo, title: j.titulo,
      home: j.mandante_id, away: j.visitante_id, slotH: j.vaga_mandante, slotA: j.vaga_visitante, date: j.data, time: j.hora, status: j.status,
      events: evs[j.id] || [], pen: j.pen_mandante == null ? null : [j.pen_mandante, j.pen_visitante], wo: j.wo_ausente_id, postponed: j.adiado,
      notes: j.observacoes, hash: j.hash, local: j.local, woGoals: byId[j.campeonato_id] ? regras(byId[j.campeonato_id]).wo : 3, refereeId: j.arbitro_id, referee: nomes[j.arbitro_id] || (j.arbitro_id ? 'Árbitro escalado' : 'A definir'),
      signatures: Object.fromEntries([['arbitro', a.arbitro], ['home', a.mandante], ['away', a.visitante]].filter(x => x[1]))})
    const d = j.status !== 'encerrado' && json(draftKey(j.id))   // súmula em andamento neste aparelho
    if (d) { const ids = new Set(m.events.map(e => e.id))
      m.events.push(...d.events.filter(e => !ids.has(e.id))); Object.assign(m, {signatures: d.signatures, notes: d.notes, pen: d.pen, half: d.half, pendingConfirm: d.pendingConfirm}) }
    m.events.sort((x, y) => x.half - y.half || x.min - y.min)
    byId[j.campeonato_id]?.matches.push(m)
  }
  for (const h of r.historico) {   // vem do mais novo para o mais antigo
    const c = byId[h.campeonato_id ?? jogoCamp[h.jogo_id]]; if (!c) continue
    const e = {at: h.em, who: h.quem, what: h.o_que, ...(h.motivo ? {why: h.motivo} : {})}
    c.log.push(e); if (h.jogo_id) findMatch(c, h.jogo_id)?.history.unshift(e)
  }
  for (const s of r.suspensoes) { const c = byId[teamCamp[r.atletas.find(p => p.id === s.atleta_id)?.equipe_id]]
    c?.punishments.push({player: s.atleta_id, matches: s.jogo_ids, why: s.motivo}) }
  for (const x of r.cancelados || []) byId[x.campeonato_id]?.cancelledDraws.push({at: x.cancelado_em, why: x.motivo, hash: x.hash, seed: x.semente})
  for (const d of r.sorteios) {
    const c = byId[d.campeonato_id]; if (!c) continue
    if (d.grupos) { c.draw = {seed: d.semente, entrada: d.entrada_publica, final: await finalSeed(d.semente, d.entrada_publica), hash: d.hash, groups: d.grupos, at: d.revelado_em}; continue }
    // compromisso publicado, tabela ainda não gerada: retoma o sorteio de onde parou
    const pd = c.pendingDraw = {cid: c.id, hash: d.hash, seed: d.semente || local.get(seedKey(c.id))}
    if (d.revelado_em) { const final = await finalSeed(d.semente, d.entrada_publica)
      Object.assign(pd, {entrada: d.entrada_publica, final, groups: drawGroups(c.teams, final, drawN(c)), revealed: true, ok: true}) }
  }
  return camps
}

async function loadAll() {
  const sec = role() === 'secretaria', arb = role() === 'arbitro', eq = role() === 'equipe', all = t => q(sb.from(t).select('*'))
  let r
  try {
    // ponytail: cada consulta traz até 1000 linhas (limite do Supabase); paginar se a cidade passar disso
    const [campeonatos, equipes, pub, jogos, eventos, sorteios, historico, suspensoes, perfis, meus, cancelados, minha] = await Promise.all([
      q(sb.from('campeonatos').select('*').order('criado_em')), q(sb.from(sec ? 'equipes' : 'equipes_publico').select('*').order('nome')),
      all(sec ? 'atletas' : 'atletas_publico'), all('jogos'), all('eventos'), all('sorteios_publico'),
      q(sb.from(sec ? 'historico' : 'historico_publico').select('*').order('em', {ascending: false}).limit(1000)),
      sec || arb || eq ? all('suspensoes') : [], sec ? q(sb.from('perfis').select('id, nome, papel').order('nome')) : [],
      // equipe: o próprio elenco completo (com pendências); árbitro: fotos dos atletas dos seus jogos (o banco filtra)
      eq ? q(sb.from('atletas').select('*').eq('equipe_id', S.session.teamId)) : arb ? q(sb.from('atletas').select('id, foto_path')) : [],
      all('sorteios_cancelados'), eq ? q(sb.from('equipes').select('id, link_token').eq('id', S.session.teamId)) : []])
    for (const x of minha) Object.assign(equipes.find(t => t.id === x.id) || {}, x)   // representante vê o link da própria equipe
    const foto = Object.fromEntries(meus.map(a => [a.id, a.foto_path]))
    const atletas = eq ? [...pub.filter(a => a.equipe_id !== S.session.teamId), ...meus] : pub.map(a => ({...a, foto_path: a.foto_path ?? foto[a.id]}))
    const paths = atletas.map(a => a.foto_path).filter(Boolean)
    if (paths.length) {   // fotos ficam no arquivo privado: link temporário só para quem pode ver
      const {data} = await sb.storage.from('fotos').createSignedUrls(paths, 3600), url = Object.fromEntries((data || []).map(x => [x.path, x.signedUrl]))
      atletas.forEach(a => { a.foto_url = url[a.foto_path] })
    }
    r = {campeonatos, equipes, atletas, jogos, eventos, sorteios, historico, suspensoes, perfis, cancelados}
    if (arb) local.set('tnt-oficial-dados', JSON.stringify(r))   // árbitro abre a súmula mesmo sem sinal na quadra (só dados públicos)
    S.arbitros = perfis.filter(p => p.papel === 'arbitro'); S.secretarias = perfis.filter(p => p.papel === 'secretaria')
  } catch (e) {
    if (!(arb && !e.code && (r = json('tnt-oficial-dados')))) throw e
    S.offline = true
  }
  S.champs = await toState(r)
  if (!S.champs.some(c => c.id === S.champId)) S.champId = S.champs[0]?.id ?? null
  if (sec) limparDocumentos(r).catch(() => {})   // não trava a tela
}
// LGPD: documento (RG) só fica guardado enquanto o campeonato não termina
async function limparDocumentos(r) {
  const fim = new Set(r.campeonatos.filter(c => c.status === 'encerrado').map(c => c.id)), camp = Object.fromEntries(r.equipes.map(t => [t.id, t.campeonato_id]))
  const velhos = r.atletas.filter(a => (a.rg_frente_path || a.rg_verso_path) && fim.has(camp[a.equipe_id]))
  if (!velhos.length) return
  const {error} = await sb.storage.from('documentos').remove(velhos.flatMap(a => [a.rg_frente_path, a.rg_verso_path]).filter(Boolean))
  if (!error) await q(sb.from('atletas').update({rg_frente_path: null, rg_verso_path: null}).in('id', velhos.map(a => a.id)))
}

async function enter(user) {
  let p
  try { p = (await q(sb.from('perfis').select('nome, papel, equipe_id').eq('id', user.id)))[0] }
  catch (e) { const c = json('tnt-oficial-perfil'); if (e.code || c?.uid !== user.id) throw e; p = c }   // sem sinal: último perfil deste aparelho
  if (!p) { ui.noProfile = {email: user.email}; return false }   // continua logado: pode vincular a equipe pelo código
  S.session = {role: p.papel, name: p.nome, uid: user.id, teamId: p.equipe_id}; ui.noProfile = null
  local.set('tnt-oficial-perfil', JSON.stringify({uid: user.id, nome: p.nome, papel: p.papel, equipe_id: p.equipe_id}))
  return true
}
async function entrou(user) { if (await enter(user)) { resetTransient(); ui.tab = ROLE_TABS[role()][0][0]; scrollTo(0, 0) } await loadAll() }

function loginReal() {
  const card = (ic, t, p, body) => `<div class="role"><div class="ic">${ic}</div><h3>${t}</h3><p>${p}</p>${body}</div>`
  const senha = (l, auto) => `<label class="span2">${l}<input name="senha" type="password" required minlength="${auto === 'new-password' ? 8 : 1}" autocomplete="${auto}"></label>`
  const email = '<label class="span2">E-mail<input name="email" type="email" required autocomplete="username"></label>'
  const equipeCampos = `<label class="span2">Seu nome<input name="nome" required minlength="2" maxlength="60"></label>
    <label class="span2">Código da equipe (a Secretaria passa)<input name="codigo" required autocomplete="off" style="text-transform:uppercase"></label>`
  const np = ui.noProfile, ss = ui.signup
  const main = np
    ? card(IC.team, 'Conta sem acesso ainda', `Você entrou como <b>${esc(np.email)}</b>.`,
        `<p class="sub"><b>Representante de equipe:</b> digite seu nome e o código da equipe.</p>
        <form class="f" data-form="vincular">${equipeCampos}<div class="span2"><button class="btn">Vincular à equipe</button></div></form>
        <p class="sub" style="margin-top:8px"><b>Árbitro:</b> peça à Secretaria para liberar este e-mail.</p><button class="btn ghost" data-act="logout">Sair</button>`)
    : ss
    ? card(ss === 'equipe' ? IC.team : IC.ref, ss === 'equipe' ? 'Criar conta da equipe' : 'Criar conta de árbitro',
        ss === 'equipe' ? 'Para o representante: crie a conta e use o código da equipe que a Secretaria passou.' : 'Depois de criar a conta, peça à Secretaria para liberar o seu acesso pelo e-mail.',
        `<form class="f" data-form="signup"><input type="hidden" name="tipo" value="${ss}">${email}${senha('Crie uma senha (mínimo 8 caracteres)', 'new-password')}${ss === 'equipe' ? equipeCampos : ''}
          <div class="span2 btns"><button class="btn">Criar conta</button><button type="button" class="btn ghost" data-act="signupmode">Voltar</button></div></form>`)
    : card(IC.sec, 'Entrar', 'Secretaria, árbitros e equipes entram com e-mail e senha.',
        `${ui.signupDone ? `<div class="info">Conta criada para <b>${esc(ui.signupDone)}</b>. Se chegar um e-mail de confirmação, abra o link e depois entre aqui.</div>` : ''}
        <form class="f" data-form="signin">${email}${senha('Senha', 'current-password')}<div class="span2"><button class="btn">Entrar</button></div></form>
        <p class="sub" style="margin-top:10px">Primeira vez? <button class="link" data-act="signupmode" data-tipo="equipe">Criar conta da equipe</button> · <button class="link" data-act="signupmode" data-tipo="arbitro">Criar conta de árbitro</button></p>`)
  return `<div class="login"><div class="lhero"><div class="wrap"><div class="eyebrow">Secretaria Municipal de Esportes · Tonantins/AM</div>
    <h1>TNT ESPORTES</h1><p>Organizando o esporte. Conectando pessoas.</p></div></div>
    <div class="wrap"><div class="roles">${main}
      ${card(IC.pub, 'População', 'Tabela, jogos, artilharia e súmulas abertos para todos, sem login.', '<button class="btn" data-act="login" data-role="publico">Ver o portal</button>')}
    </div><p class="note" style="text-align:center;margin:20px 0">Sistema oficial, com dados reais.</p></div></div>`
}

// Secretaria: escalar árbitro no jogo e liberar a conta de árbitros novos
function refSelect(m) {
  return ` <label class="sub" style="display:inline-flex;gap:6px;align-items:center">Árbitro <select data-ref="${m.id}"><option value="">A definir</option>
    ${(S.arbitros || []).map(a => `<option value="${a.id}" ${a.id === m.refereeId ? 'selected' : ''}>${esc(a.nome)}</option>`).join('')}</select></label>`
}
function arbitrosCard() {   // acessos (árbitros e Secretaria) + minha conta
  const nomes = l => l.map(a => esc(a.nome)).join(', ')
  return `<div class="grid g2"><div class="card"><h3>Acessos ao sistema</h3>
    <p class="sub"><b>Secretaria:</b> ${nomes(S.secretarias || []) || '—'}</p>
    <p class="sub"><b>Árbitros:</b> ${nomes(S.arbitros || []) || 'nenhum ainda'}</p>
    <p class="note">A pessoa cria a conta na tela de entrada (“Criar conta de árbitro”). Depois você libera aqui pelo e-mail. Árbitros são escalados nos jogos, na aba Jogos e tabela. Tenha sempre pelo menos 2 contas da Secretaria.</p>
    <form class="f" data-form="liberar" style="margin-top:8px"><label>E-mail<input name="email" type="email" required></label>
      <label>Nome<input name="nome" required minlength="2" maxlength="60"></label>
      <label>Acesso<select name="papel"><option value="arbitro">Árbitro</option><option value="secretaria">Secretaria (administrador)</option></select></label>
      <div><button class="btn">Liberar acesso</button></div></form></div>
  <div class="card"><h3>Minha conta <small>${esc(S.session?.name || '')}</small></h3>
    <p class="sub">Use uma senha forte: pelo menos 10 caracteres, misturando letras e números. Não use datas nem a mesma senha de outros sites.</p>
    <form class="f" data-form="senha" style="margin-top:8px"><label>Nova senha<input name="senha" type="password" required minlength="10" autocomplete="new-password"></label>
      <label>Repita a nova senha<input name="senha2" type="password" required minlength="10" autocomplete="new-password"></label>
      <div><button class="btn">Trocar senha</button></div></form></div></div>`
}

/* ---------- súmula: guarda no aparelho e envia quando der ---------- */
function saveDrafts() {
  for (const c of S.champs) for (const m of c.matches) {
    if (isDone(m)) { local.set(draftKey(m.id), null); continue }
    const d = {events: m.events.filter(e => !e.sent), signatures: m.signatures, notes: m.notes, pen: m.pen, half: m.half, pendingConfirm: m.pendingConfirm}
    const vazio = !d.events.length && !Object.keys(d.signatures).length && !d.notes && !d.pen && d.half === 1 && !d.pendingConfirm
    local.set(draftKey(m.id), vazio ? null : JSON.stringify(d))
  }
}
async function sendConfirm(m) {
  const assin = {}
  for (const [k, nome] of [['arbitro', 'arbitro'], ['home', 'mandante'], ['away', 'visitante']]) {
    let s = m.signatures[k]
    if (s.startsWith('data:')) {   // ainda não foi para o arquivo privado "assinaturas"
      const path = `${m.id}/${nome}-${Date.now()}.png`
      const {error} = await sb.storage.from('assinaturas').upload(path, await (await fetch(s)).blob(), {contentType: 'image/png'})
      if (error) throw error   // sem sinal: tenta de novo depois, com a súmula guardada
      s = m.signatures[k] = path; saveDrafts()
    }
    assin[nome] = s
  }
  try { await rpc('confirmar_sumula', {j: m.id, pen_m: m.pen?.[0] ?? null, pen_v: m.pen?.[1] ?? null, obs: m.notes, assin}) }
  catch (e) { if (!e.code) throw e; m.pendingConfirm = false; toast('Súmula recusada: ' + e.message); return }
  m.pendingConfirm = false; local.set(draftKey(m.id), null)
  toast(m.phase === 'final' ? 'Final confirmada. Campeonato encerrado!' : 'Súmula confirmada. Classificação atualizada.')
}
let syncing = false
async function syncReal(quiet) {   // devolve true se tudo foi enviado
  if (syncing || !sb) return false
  syncing = true; let sent = 0, changed = false
  try {
    for (const c of S.champs) for (const m of c.matches) {
      for (const e of m.events.filter(x => !x.sent)) {
        try { await q(sb.from('eventos').insert({id: e.id, jogo_id: m.id, tipo: e.type, equipe_id: e.team, atleta_id: e.player, minuto: e.min, tempo: e.half})) }
        catch (err) {
          if (!err.code) throw err                     // sem sinal: para e tenta depois
          if (err.code !== '23505') {                   // 23505 = já tinha chegado antes (reenvio não duplica)
            m.events = m.events.filter(x => x !== e); changed = true; toast('Evento recusado: ' + err.message); continue }
        }
        e.sent = true; sent++
      }
      if (m.pendingConfirm) { await sendConfirm(m); changed = true }
    }
    S.offline = false
  } catch (e) { S.offline = true; if (!quiet && navigator.onLine) toast('Não foi possível enviar agora: ' + e.message) }
  finally { syncing = false; saveDrafts() }
  if (sent && quiet) toast(`Sinal voltou: ${sent} evento(s) enviados sem duplicar.`)
  if (changed) await loadAll().catch(() => {})
  return !S.offline
}
const pending = () => S.champs.some(c => c.matches.some(m => m.pendingConfirm || m.events.some(e => !e.sent)))

async function listarTudo(bucket, pasta) {
  const {data} = await sb.storage.from(bucket).list(pasta, {limit: 1000}), out = []
  for (const x of data || []) { const p = pasta + '/' + x.name; if (x.id) out.push(p); else out.push(...await listarTudo(bucket, p)) }
  return out
}
async function apagarArquivos(lista) {   // [[bucket, pasta], ...]
  for (const [b, pasta] of lista) { const ps = await listarTudo(b, pasta); if (ps.length) await sb.storage.from(b).remove(ps) }
}
const equipeCampos = v => ({nome: v.name, bairro: v.bairro, cores: v.colors, responsavel: v.coach, responsavel_telefone: v.coachPhone, ...(v.pot ? {pote: v.pot} : {})})
async function enviaEscudo(c, tid, blob) {   // escudo vai para o arquivo público das marcas
  if (!blob) return
  const path = `${c.id}/equipe-${tid}-${Date.now()}.png`, {error} = await sb.storage.from('marcas').upload(path, blob, {contentType: 'image/png'})
  if (error) return toast('Escudo não enviado: ' + error.message)
  await q(sb.from('equipes').update({escudo_path: path}).eq('id', tid))
}
// mudança no banco: mostra o erro em português e sempre recarrega, para a tela ficar igual ao banco
const write = fn => async d => { try { await fn(d) } catch (e) { toast(e.code || navigator.onLine ? e.message : 'Sem internet. Tente de novo quando o sinal voltar.') }
  try { await loadAll() } catch (e) { toast('Sem conexão com o banco: ' + e.message) } }
const rpc = (f, args) => q(sb.rpc(f, args))
const atleta = (id, campos) => q(sb.from('atletas').update(campos).eq('id', id))

const DEMO = {ev: A.ev, pick: A.pick}
const REAL_A = {
  logout: async () => { await sb.auth.signOut(); S.session = ui.noProfile = null; resetTransient(); ui.doc = null; render(); await loadAll() },
  signupmode: d => { ui.signup = d.tipo || null; ui.signupDone = null },
  auth: write(d => atleta(d.id, {autorizacao: true})),
  approve: write(d => atleta(d.id, {aprovado: true})),
  reject: write(async d => {
    const p = P(C(), d.id); await q(sb.from('atletas').delete().eq('id', d.id))
    if (p.rg?.length) await sb.storage.from('documentos').remove(p.rg)
    if (p.photoPath) await sb.storage.from('fotos').remove([p.photoPath])
    toast('Inscrição recusada. Foto e documento apagados.')
  }),
  docs: async d => {   // documento só a Secretaria vê, por link temporário de 10 minutos
    if (ui.docs?.id === d.id) { ui.docs = null; return }
    const {data, error} = await sb.storage.from('documentos').createSignedUrls(P(C(), d.id).rg, 600)
    if (error) return toast(error.message)
    ui.docs = {id: d.id, urls: data.map(x => x.signedUrl).filter(Boolean)}
  },
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
    if (c.teams.length < minTeams(c) || c.teams.length > maxTeams(c)) return toast(`Este formato precisa de ${minTeams(c)} a ${maxTeams(c)} equipes.`)
    const ms = buildFixtures(c, d.groups, c.start), id = Object.fromEntries(ms.map(m => [m.id, uid()]))   // o banco usa uuid
    const vaga = s => s && s.replace(/^([VP]):(.+)$/, (_, k, x) => `${k}:${id[x]}`)
    await rpc('aplicar_sorteio', {c: c.id, g: d.groups, jogos_novos: ms.map(m => ({id: id[m.id], fase: m.phase, rodada: m.round, grupo: m.group, titulo: m.title,
      mandante_id: m.home, visitante_id: m.away, vaga_mandante: vaga(m.slotH), vaga_visitante: vaga(m.slotA), data: m.date, hora: m.time, local: m.local}))})
    local.set(seedKey(c.id), null); ui.draw = null; ui.tab = 'jogos'; scrollTo(0, 0); toast('Tabela gerada!')
  }),
  backup: async () => {   // tudo o que está no banco, num arquivo (fotos e documentos ficam fora)
    try {
      const tabelas = ['campeonatos', 'equipes', 'atletas', 'jogos', 'eventos', 'suspensoes', 'sorteios', 'historico', 'perfis'], dados = {}
      for (const t of tabelas) dados[t] = await q(sb.from(t === 'sorteios' ? 'sorteios_publico' : t).select('*').limit(100000))
      const blob = new Blob([JSON.stringify({sistema: 'TNT Esportes', gerado_em: new Date().toISOString(), ...dados}, null, 1)], {type: 'application/json'})
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `tnt-esportes-copia-${new Date().toISOString().slice(0, 10)}.json`; a.click()
      toast(`Cópia baixada: ${tabelas.map(t => dados[t].length).reduce((x, y) => x + y)} registros. Guarde em lugar seguro (tem dados pessoais).`)
    } catch (e) { toast('Não foi possível gerar a cópia: ' + e.message) }
    return 'stay'
  },
  doc: async d => {   // súmula: assinaturas por link temporário (só Secretaria e árbitro)
    ui.doc = {c: d.c, id: d.id}; ui.docSigs = null
    const m = findMatch(S.champs.find(x => x.id === d.c), d.id), ps = Object.values(m?.signatures || {}).filter(p => p && !p.startsWith('data:'))
    if (!ps.length || !['secretaria', 'arbitro'].includes(role())) return
    const {data} = await sb.storage.from('assinaturas').createSignedUrls(ps, 600)
    ui.docSigs = Object.fromEntries(Object.entries(m.signatures).map(([k, p]) => [k, data?.find(x => x.path === p)?.signedUrl]))
  },
  delteam: write(async d => {
    if (ui.confirmDel !== 'team:' + d.id) { ui.confirmDel = 'team:' + d.id; ui.editTeam = null; return }
    const c = C(), t = T(c, d.id)
    await q(sb.from('equipes').delete().eq('id', d.id))
    await apagarArquivos([['fotos', d.id], ['documentos', d.id]])
    ui.confirmDel = ui.team = null; toast(`Equipe ${t.name} excluída.`)
  }),
  // súmula: o evento fica no aparelho na hora e é enviado logo em seguida (ou quando o sinal voltar)
  ev: async d => { DEMO.ev(d); if (d.type === 'falta') { saveDrafts(); await syncReal() } },
  pick: async d => { DEMO.pick(d); saveDrafts(); await syncReal() },
  undo: async d => {
    const m = cur(), e = m?.events.find(x => x.id === d.id); if (!e) return
    if (!e.sent) { m.events = m.events.filter(x => x !== e); return }
    try { await q(sb.from('eventos').delete().eq('id', e.id)); await loadAll() }
    catch (err) { toast(err.code ? err.message : 'Sem internet: este evento já foi enviado e só pode ser desfeito quando o sinal voltar.') }
  },
  confirm: async () => {
    const m = cur()
    if (m.phase !== 'grupos' && goals(m)[0] === goals(m)[1]) {
      const p = m.pen; if (!p || !Number.isInteger(p[0]) || !Number.isInteger(p[1]) || p[0] === p[1]) return toast('Informe o placar dos pênaltis (não pode empatar).')
    } else m.pen = null
    if (['arbitro', 'home', 'away'].some(k => !m.signatures[k])) return toast('Faltam assinaturas.')
    ui.signing = null; m.pendingConfirm = true; saveDrafts()
    if (!(await syncReal(true)) && !navigator.onLine) toast('Sem internet: súmula guardada no aparelho. Será enviada sozinha quando o sinal voltar.')
  },
  net: async () => { toast((await syncReal()) ? (pending() ? 'Enviando…' : 'Tudo enviado.') : 'Ainda sem internet. Os dados continuam guardados no aparelho.') },
}

const REAL_F = {
  signin: async d => {
    const {data, error} = await sb.auth.signInWithPassword({email: d.email.trim(), password: d.senha})
    if (error) return toast(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message === 'Email not confirmed' ? 'Confirme o e-mail pelo link que chegou na sua caixa de entrada.' : error.message)
    await entrou(data.user)
  },
  signup: async d => {
    const email = d.email.trim(), equipe = d.tipo === 'equipe'
    if (d.senha.length < 8) return toast('A senha precisa de pelo menos 8 caracteres.')
    if (equipe && ((d.nome || '').trim().length < 2 || !(d.codigo || '').trim())) return toast('Informe seu nome e o código da equipe.')
    const {data, error} = await sb.auth.signUp({email, password: d.senha, options: {emailRedirectTo: location.href.split('#')[0]}})
    if (error) return toast(error.message === 'User already registered' ? 'Já existe uma conta com esse e-mail. Use “Entrar”.' : error.message)
    ui.signup = null
    if (!data.session) { ui.signupDone = email; return }   // confirmação por e-mail ligada: entra depois de confirmar
    if (!equipe) { await sb.auth.signOut(); ui.signupDone = email; return }
    try { await rpc('vincular_equipe', {cod: d.codigo, nome: d.nome.trim()}) } catch (e) { toast(e.message) }   // código errado: a tela pede de novo
    await entrou(data.user)
  },
  vincular: async d => {
    try { await rpc('vincular_equipe', {cod: d.codigo, nome: d.nome.trim()}) } catch (e) { return toast(e.message) }
    const {data: {user}} = await sb.auth.getUser(); await entrou(user); toast('Pronto! Agora inscreva os atletas da equipe.')
  },
  liberar: write(async d => {
    const papel = d.papel === 'secretaria' ? 'secretaria' : 'arbitro'
    await rpc('liberar_acesso', {email_conta: d.email, nome_conta: d.nome.trim(), papel_conta: papel})
    toast(papel === 'secretaria' ? 'Acesso de Secretaria liberado.' : 'Acesso liberado. Escale o árbitro nos jogos.')
  }),
  senha: async d => {
    if (d.senha.length < 10 || !/[a-zA-Z]/.test(d.senha) || !/\d/.test(d.senha)) return toast('A senha precisa de pelo menos 10 caracteres, com letras e números.')
    if (d.senha !== d.senha2) return toast('As duas senhas não são iguais.')
    const {error} = await sb.auth.updateUser({password: d.senha})
    toast(error ? (/different/i.test(error.message) ? 'A nova senha precisa ser diferente da atual.' : error.message) : 'Senha trocada. Use a nova senha na próxima vez que entrar.')
  },
  reopen: write(async d => {
    const why = d.why.trim(); if (why.length < 5) return toast('Informe o motivo da correção.')
    await rpc('reabrir_sumula', {j: cur().id, motivo: why}); local.set(draftKey(cur().id), null)
  }),
  editteam: write(async d => {
    const c = C(), t = T(c, ui.editTeam); if (!t) return
    const v = await lerEquipe(c, t, d); if (!v) return
    await q(sb.from('equipes').update(equipeCampos(v)).eq('id', t.id)); await enviaEscudo(c, t.id, v.escudo)
    ui.editTeam = null; toast('Equipe atualizada.')
  }),
  editplayer: write(async d => {
    const c = C(), p = P(c, ui.editPlayer), v = lerAtleta(c, p, d); if (!v) return
    await q(sb.from('atletas').update({nome: v.name, numero: v.num, nascimento: v.birth, apelido: v.nick, posicao: v.pos, telefone: v.phone, bairro: v.bairro,
      endereco: v.address, municipio: v.city, responsavel: v.resp, responsavel_telefone: v.respPhone}).eq('id', p.id))
    ui.editPlayer = null; toast('Atleta atualizado.')
  }),
  cancelsorteio: write(async d => {
    const c = C(); await rpc('cancelar_sorteio', {c: c.id, motivo: d.why.trim()})
    local.set(seedKey(c.id), null); ui.draw = null; toast('Sorteio cancelado. O registro fica público, com o motivo.')
  }),
  delchamp: write(async d => {
    const c = C()
    if (d.confirma.trim().toLowerCase() !== c.name.trim().toLowerCase()) return toast('O nome digitado não confere com o nome do campeonato.')
    const pastas = [['marcas', c.id], ...c.teams.flatMap(t => [['fotos', t.id], ['documentos', t.id]])]
    await q(sb.from('campeonatos').delete().eq('id', c.id))
    await apagarArquivos(pastas)
    ui.confirmDel = ui.editChamp = null; S.champId = null; resetTransient(); ui.tab = 'campeonatos'; toast(`Campeonato ${c.name} excluído.`)
  }),
  athlete: write(async d => {
    const c = C(), sec = role() === 'secretaria', team = sec ? ui.team : S.session.teamId, name = d.name.trim().replace(/\s+/g, ' '), num = +d.num
    if (name.length < 3 || !(num >= 1 && num <= 99) || !/^\d{4}-\d{2}-\d{2}$/.test(d.birth) || d.birth > c.start) return toast('Confira nome, número (1 a 99) e data de nascimento.')
    if (!d.consent) return toast('É preciso o consentimento para uso dos dados.')
    if (c.players.some(p => p.team === team && p.num === num)) return toast(`O número ${num} já está em uso nesta equipe.`)
    if (c.maxPlayers && c.players.filter(p => p.team === team).length >= c.maxPlayers) return toast(`A equipe já tem o máximo de ${c.maxPlayers} atletas.`)
    const id = uid(), p = {birth: d.birth, auth: !!d.auth, approved: sec}
    const envia = async (bucket, path, file, max, square) => {
      const b = await fitImage(file, max, 'image/jpeg', square); if (!b) return null
      const {error} = await sb.storage.from(bucket).upload(path, b, {contentType: 'image/jpeg'})
      if (error) { toast('Imagem não enviada: ' + error.message); return null }
      return path
    }
    let arq
    try {   // foto: Secretaria, a equipe e o árbitro do jogo veem; documento: só a Secretaria
      arq = {foto_path: await envia('fotos', `${team}/${id}.jpg`, d.photo, 400, true),
             rg_frente_path: sec ? await envia('documentos', `${team}/${id}-rg-frente.jpg`, d.rgf, 1400) : null,
             rg_verso_path: sec ? await envia('documentos', `${team}/${id}-rg-verso.jpg`, d.rgv, 1400) : null}
    } catch { return toast('Não foi possível ler a imagem. Use uma foto JPG ou PNG.') }
    const t = v => v?.trim() || null
    await q(sb.from('atletas').insert({id, equipe_id: team, nome: name, numero: num, nascimento: d.birth, endereco: t(d.endereco), bairro: t(d.bairro) || '', municipio: t(d.municipio),
      apelido: t(d.nick), posicao: d.pos || null, telefone: t(d.phone), responsavel: t(d.resp), responsavel_telefone: t(d.respPhone),
      autorizacao: p.auth, aprovado: sec, consentimento: true, origem: sec ? 'secretaria' : 'equipe', ...arq}))
    const [s, why] = insc(c, p); toast(`${name}: ${sec ? SPILL[s][1].toLowerCase() : 'enviado para aprovação'}${why ? '. ' + why : ''}.`)
  }),
  newteam: write(async d => {
    const c = C(), v = await lerEquipe(c, null, d); if (!v) return
    const [t] = await q(sb.from('equipes').insert({campeonato_id: c.id, ...equipeCampos(v)}).select('id'))
    await enviaEscudo(c, t.id, v.escudo); ui.team = t.id; toast('Equipe cadastrada.')
  }),
  newchamp: write(async d => {
    const name = d.name.trim(), min = +d.min, max = d.max === '' ? null : +d.max, maxPlayers = +d.maxPlayers || 20
    if (name.length < 5 || (!d.id && !SPORTS[d.sport]) || !/^\d{4}-\d{2}-\d{2}$/.test(d.start)) return toast('Confira nome, modalidade e data de início.')
    if (!(min >= 5 && min <= 80) || (max !== null && !(max >= min && max <= 99))) return toast('Faixa etária inválida.')
    if (!(maxPlayers >= 5 && maxPlayers <= 40)) return toast('O máximo de atletas por equipe vai de 5 a 40.')
    const t = v => v?.trim() || null, atual = d.id && S.champs.find(c => c.id === d.id), {format, rules} = lerRegras(d, atual?.sport || d.sport, atual)
    const campos = {formato: format, regras: rules, nome: name, categoria: t(d.category) || 'Livre', idade_min: min, idade_max: max, inicio: d.start, local: t(d.venue) || 'A definir',
      responsavel: t(d.resp), responsavel_telefone: t(d.respPhone), inscricao_ate: d.regUntil || null, max_atletas: maxPlayers}
    let id = d.id
    if (id) await q(sb.from('campeonatos').update(campos).eq('id', id))
    else id = (await q(sb.from('campeonatos').insert({...campos, modalidade: d.sport}).select('id')))[0].id
    // logos: arquivo público "marcas/<campeonato>/..."; se uma imagem falhar, o resto continua salvo
    const marca = async (file, nome) => {
      let b; try { b = await fitImage(file, 400, 'image/png') } catch { toast('Não foi possível ler a imagem de ' + nome); return null }
      if (!b) return null
      const path = `${id}/${nome}-${Date.now()}.png`, {error} = await sb.storage.from('marcas').upload(path, b, {contentType: 'image/png'})
      if (error) { toast('Imagem não enviada: ' + error.message); return null }
      return path
    }
    const extra = {patrocinadores: []}
    const logo = await marca(d.logo, 'logo'); if (logo) extra.logo_path = logo
    for (const i of Object.keys(d).filter(k => /^sp\d+$/.test(k)).map(k => k.slice(2)))   // na ordem da tela
      if (t(d['sp' + i])) extra.patrocinadores.push({nome: t(d['sp' + i]), logo_path: (await marca(d['spl' + i], 'patrocinio-' + i)) || d['spp' + i] || null})
    await q(sb.from('campeonatos').update(extra).eq('id', id))
    if (d.id) { ui.editChamp = null; toast('Dados do campeonato atualizados.') }
    else { S.champId = id; resetTransient(); ui.tab = 'inscricoes'; toast('Campeonato criado. Cadastre as equipes e mande o link de inscrição.') }
  }),
  manage: write(async d => {
    const m = findMatch(C(), ui.manage), why = d.why.trim()
    if (!m) return
    if (why.length < 5) return toast('Informe o motivo.')
    if (d.acao === 'wo') await rpc('registrar_wo', {j: m.id, ausente: d.ausente, motivo: why})
    else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || !/^\d{2}:\d{2}$/.test(d.time)) return toast('Informe data e horário.')
      await rpc('alterar_jogo', {j: m.id, nova_data: d.date, nova_hora: d.time.replace(':', 'h'), novo_local: d.local || '', motivo: why})
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
  S.offline = !navigator.onLine
  try {
    const {data: {session}} = await sb.auth.getSession()
    if (session) await enter(session.user)
    if (!S.session && location.hash === '#portal') S.session = {role: 'publico'}
    await loadAll()
  } catch (e) { toast('Sem conexão com o banco: ' + e.message) }
  render()
  if (pending()) syncReal(true).then(render)
  // escalar árbitro direto no jogo (Secretaria)
  document.addEventListener('change', async e => {
    const id = e.target.dataset?.ref; if (id === undefined) return
    await write(async () => { await q(sb.from('jogos').update({arbitro_id: e.target.value || null}).eq('id', id)); toast('Árbitro escalado.') })(); render()
  })
  addEventListener('online', () => syncReal(true).then(render))
  setInterval(() => { if (pending() && !syncing) syncReal(true).then(ok => { if (ok) render() }) }, 30000)
}
if (REAL) startReal()

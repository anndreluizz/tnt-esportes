// node checar.js — confere as regras com os dados de exemplo e abre todas as telas, em todos os perfis.
const fs = require('fs'), vm = require('vm'), {createHash} = require('crypto')
const read = f => fs.readFileSync(__dirname + '/' + f, 'utf8')
const el = () => ({innerHTML: '', className: '', hidden: false, value: '', classList: {add() {}, remove() {}, toggle() {}}, replaceChildren() {}})
const els = {}
const ctx = vm.createContext({
  crypto, TextEncoder, console, setInterval() {}, setTimeout, clearTimeout, scrollTo() {}, print() {},
  localStorage: {getItem: () => null, setItem() {}}, navigator: {}, location: {protocol: 'file:', hash: ''},
  document: {querySelector: s => els[s] ??= el(), querySelectorAll: () => [], getElementById: () => null, addEventListener() {},
             body: el(), fonts: {load: () => Promise.resolve()},
             createElement: () => ({getContext: () => new Proxy({}, {get: (t, k) => k === 'measureText' ? () => ({width: 0}) : () => {}, set: () => true})})},
})
for (const f of ['js/regras.js', 'js/dados.js', 'js/app.js', 'js/api.js']) vm.runInContext(read(f), ctx, {filename: f})
const run = code => vm.runInContext(code, ctx)
const ok = (cond, msg) => { if (!cond) { console.error('FALHOU:', msg); process.exit(1) } }

;(async () => {
  run('S = seed(); S.champs.forEach(resolveKO)'); await run('ensureHashes()')
  // classificação e disciplina com os dados de exemplo
  ok(run(`standings(C(),'A').map(r=>r.t.id+':'+r.P).join()`) === 'rsf:4,atc:3,unb:2,est:1', 'classificação do grupo A')
  ok(run(`standings(C(),'B').map(r=>r.t.id+':'+r.P).join()`) === 'gre:4,tjr:3,juv:3,svi:1', 'classificação do grupo B (desempate por saldo)')
  ok(run(`(()=>{const c=C(),d=discipline(c),cl=c.players.find(p=>p.name==='Cleiton'),m=nextMatches(c,'est')[0];return !!d.susp[m.id][cl.id]})()`), 'Cleiton suspenso')
  ok(run(`discipline(C()).st[C().players.find(p=>p.name==='Diego').id].y`) === 2, 'Diego pendurado')
  ok(run(`scorers(C())[0].p.name+scorers(C())[0].n`) === 'Rafael4', 'artilharia')
  // inscrição por idade
  ok(run(`insc(S.champs[1], S.champs[1].players[14])[0]`) === 'bloqueado', 'acima da faixa no Sub-15')
  ok(run(`insc(S.champs[1], S.champs[1].players[40])[0]`) === 'analise', 'aguardando aprovação')
  // sorteio do exemplo confere
  const d = run('C().draw')
  ok(createHash('sha256').update(d.seed).digest('hex') === d.hash, 'hash do sorteio de exemplo')
  ok(createHash('sha256').update(d.seed + d.entrada).digest('hex').slice(0, 16) === d.final, 'semente final = sha256(semente + entrada pública)')
  ok(run(`sameSet(drawGroups(C().teams, C().draw.final).A, ['rsf','atc','unb','est'])`), 'semente final refaz os grupos')
  // modo oficial: linhas do banco (como o Supabase devolve) viram o mesmo estado das telas
  ok(await run(`(async () => { const c = C(), rows = {
    campeonatos: [{id: c.id, nome: c.name, modalidade: c.sport, categoria: c.category, idade_min: c.minAge, idade_max: c.maxAge, inicio: c.start, local: c.venue, status: c.status}],
    equipes: c.teams.map(t => ({id: t.id, campeonato_id: c.id, nome: t.name, bairro: t.bairro, pote: t.pot, grupo: t.group, codigo: t.code})),
    atletas: c.players.map(p => ({id: p.id, equipe_id: p.team, nome: p.name, numero: p.num, nascimento: p.birth, bairro: p.bairro, autorizacao: p.auth, aprovado: p.approved})),
    jogos: c.matches.map(m => ({id: m.id, campeonato_id: c.id, fase: m.phase, rodada: m.round, grupo: m.group, titulo: m.title, mandante_id: m.home, visitante_id: m.away,
      vaga_mandante: m.slotH, vaga_visitante: m.slotA, data: m.date, hora: m.time, status: m.status, pen_mandante: m.pen?.[0] ?? null, pen_visitante: m.pen?.[1] ?? null,
      wo_ausente_id: m.wo, adiado: !!m.postponed, observacoes: m.notes, hash: m.hash})),
    eventos: c.matches.flatMap(m => m.events.map(e => ({id: e.id, jogo_id: m.id, tipo: e.type, equipe_id: e.team, atleta_id: e.player, minuto: e.min, tempo: e.half}))),
    sorteios: [{campeonato_id: c.id, hash: c.draw.hash, semente: c.draw.seed, entrada_publica: c.draw.entrada, grupos: c.draw.groups, revelado_em: c.draw.at}],
    historico: [{campeonato_id: c.id, jogo_id: c.matches[0].id, quem: 'x', o_que: 'y', motivo: null, em: c.start}],
    suspensoes: [{atleta_id: c.players[0].id, jogo_ids: [c.matches[8].id], motivo: 'z'}]}
    const [d] = await toState(rows), f = x => JSON.stringify([standings(x, 'A').map(r => r.t.id + r.P), standings(x, 'B').map(r => r.t.id + r.P),
      scorers(x).map(s => s.p.id + s.n), Object.keys(discipline(x).susp), x.matches.filter(isDone).length])
    return f(d) === f(c) && d.draw.final === c.draw.final && d.matches[0].history.length === 1 && d.punishments.length === 1 })()`), 'banco -> telas: mesma classificação, artilharia e disciplina')
  // mata-mata: antes do fim dos grupos as vagas estão vazias
  ok(run(`C().matches.find(m=>m.phase==='semi').home`) === null, 'semifinal ainda sem time')

  // abre todas as telas em todos os perfis
  const allViews = async () => {
    for (const [r, tabs] of Object.entries(run('ROLE_TABS'))) {
      run(`S.session = ${JSON.stringify(r === 'equipe' ? {role: r, teamId: 'rsf'} : {role: r})}`)
      for (const [t] of tabs) { run(`ui.tab='${t}'; render()`); ok(els['#app'].innerHTML.length > 200, `tela ${r}/${t}`) }
    }
  }
  await allViews()
  run(`S.session=null; render()`); ok(els['#app'].innerHTML.includes('TNT ESPORTES'), 'tela de entrada')

  // simula até o campeão e confere o mata-mata
  run(`S.session={role:'secretaria'}`)
  for (let i = 0; i < 4; i++) await run('A.simulate()')
  ok(run('isDone(C().matches.find(m=>m.phase==="semi"))'), 'semifinais simuladas')
  ok(run(`(()=>{const c=C(),s=c.matches.filter(m=>m.phase==='semi');return s[0].home===standings(c,'A')[0].t.id && s[1].away===standings(c,'A')[1].t.id})()`), 'cruzamento 1A×2B / 1B×2A')
  ok(run('!!champion(C()) && C().status==="encerrado"'), 'campeão definido')
  ok(run('C().matches.filter(isDone).every(m=>m.hash && m.hash.length===64)'), 'todas as súmulas com código')
  run(`ui.doc={c:C().id,id:C().matches.find(m=>m.phase==='final').id}; render()`); ok(els['#doc'].innerHTML.includes('SÚMULA DE JOGO'), 'documento da súmula')
  // sorteio real no Sub-15 gera a tabela
  run(`S.champId='sub15'; resetTransient()`)
  await run('A.commit()'); await run(`F.dodraw({entrada: '4 15 8'})`); await run('A.reveal()'); run('A.applydraw()')
  ok(run('C().status') === 'andamento' && run('C().matches.length') === 16, 'sorteio aplicado: 12 jogos de grupo + 4 do mata-mata')
  const s15 = run('C().draw')
  ok(s15.final === createHash('sha256').update(s15.seed + '4 15 8').digest('hex').slice(0, 16) && run(`JSON.stringify(drawGroups(C().teams, C().draw.final)) === JSON.stringify(C().draw.groups)`), 'sorteio real usa a entrada pública')
  await allViews()
  console.log('ok: regras, mata-mata, sorteio e todas as telas')
})()

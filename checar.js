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
  ok(run(`(() => { const c = C(), antes = c.rules; c.rules = {desempate: ['confronto', 'saldo']}
    const o = standings(c, 'B').map(r => r.t.id).join(); c.rules = antes; return o })()`) === 'gre,juv,tjr,svi', 'desempate editável: confronto direto põe a Juventude (venceu o jogo) na frente do Tonantins Jr.')
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
  ok(run(`(() => { const c = S.champs.find(x => x.id === 'sub15'), antes = c.rules; c.rules = {inscricao_rodada: 1}
    const aberta = inscricaoAberta(c), r1 = c.matches.filter(m => m.round === 1); r1.forEach(m => m.status = 'encerrado')
    const fechada = !inscricaoAberta(c); r1.forEach(m => m.status = 'agendado'); c.rules = antes; return aberta && fechada })()`), 'novos atletas até o fim da rodada 1')

  // outros formatos: monta, sorteia, simula até o campeão
  const formato = async (id, nTimes, format, rules) => {
    run(`(()=>{ const c = champBase({id: '${id}', name: 'Teste ${id}', sport: 'Futsal', category: 'Livre', minAge: 15, maxAge: null, start: '2027-03-06', venue: 'Quadra', format: '${format}', rules: ${JSON.stringify(rules)}})
      for (let i = 0; i < ${nTimes}; i++) { const t = '${id}t' + i; c.teams.push({id: t, name: 'Equipe ' + String.fromCharCode(65 + i), group: null, pot: i < 2 ? 1 : 2, code: 'X', bairro: 'Centro'})
        for (let k = 0; k < 6; k++) c.players.push({id: t + 'p' + k, team: t, name: 'Atleta ' + i + k, num: k + 1, birth: '1995-01-01', auth: true, approved: true, consent: true, photo: null, bairro: 'Centro'}) }
      const g = drawGroups(c.teams, 'abcdef0123456789', drawN(c)); c.teams.forEach(t => { t.group = Object.keys(g).find(k => g[k].includes(t.id)) })
      c.matches = buildFixtures(c, g, c.start); c.status = 'andamento'; c.draw = {groups: g}; S.champs.push(c); S.champId = c.id; resetTransient() })()`)
    const total = run('C().matches.length')
    for (let i = 0; i < 40 && !run('champion(C())'); i++) await run('A.simulate()')
    await allViews(); run(`S.champId = '${id}'; S.session = {role: 'secretaria'}`)
    return total
  }
  ok(await formato('pc', 5, 'pontos', {returno: true, vitoria: 2}) === 20, 'pontos corridos com returno: 5 equipes = 20 jogos')
  ok(run(`C().matches.every(m => m.phase === 'grupos') && C().status === 'encerrado' && champion(C()) === standings(C(), 'A')[0].t.id`), 'pontos corridos: campeão é o 1º colocado')
  ok(run(`standings(C(), 'A').every(r => r.P === r.V * 2 + r.E)`), 'vitória valendo 2 pontos')
  ok(await formato('g4', 8, 'grupos', {grupos: 4}) === 12, '4 grupos: 4 jogos de grupo + quartas, semis, 3º e final')
  ok(run(`C().matches.filter(m => m.phase === 'quartas').length === 4 && C().matches.find(m => m.phase === 'quartas').slotH === '1A' && !!champion(C()) && C().status === 'encerrado'`), '4 grupos: quartas 1ºA×2ºB até o campeão')
  ok(await formato('mm', 6, 'mata', {terceiro: false}) === 5, 'mata-mata com 6 equipes: 2 quartas, 2 semis e a final (sem 3º lugar)')
  ok(run(`(() => { const c = C(), q = c.matches.filter(m => m.phase === 'quartas'), s = c.matches.filter(m => m.phase === 'semi')
    return q.every(m => m.home && m.away && !m.slotH) && s[0].home === c.draw.groups.A[0] && s[1].home === c.draw.groups.A[1] && !!champion(c) })()`), 'mata-mata: cabeças de chave com folga direto na semifinal')
  // calendário escolhido: quartas-feiras, 2 horários × 2 quadras; cada rodada num dia, ninguém joga 2× no mesmo dia
  run(`(() => { const c = champBase({id: 'cal', name: 'Teste cal', sport: 'Futsal', category: 'Livre', minAge: 15, maxAge: null, start: '2027-03-01', venue: 'Quadra',
    ...lerRegras({r_cal: '1', r_dia3: 'on', r_horarios: '19h, 20:30', r_locais: 'Quadra 1\\nQuadra 2'}, 'Futsal'), format: 'pontos'})
    for (let i = 0; i < 5; i++) c.teams.push({id: 'k' + i, name: 'K' + i, group: 'A', pot: 2, code: 'X', bairro: 'Centro'})
    c.matches = buildFixtures(c, {A: c.teams.map(t => t.id)}, c.start); S.champs.push(c) })()`)
  ok(run(`(() => { const ms = S.champs.find(c => c.id === 'cal').matches, porDia = {}
    for (const m of ms) { const d = porDia[m.date] ??= []; if (d.includes(m.home) || d.includes(m.away)) return false; d.push(m.home, m.away) }
    return ms.every(m => new Date(m.date + 'T12:00:00Z').getUTCDay() === 3 && ['19h00', '20h30'].includes(m.time) && ['Quadra 1', 'Quadra 2'].includes(m.local))
      && ms[0].date === '2027-03-03' && Object.keys(porDia).length === 5 })()`), 'calendário: só quartas, horários e quadras escolhidos, uma rodada por dia')
  ok(run(`[dataISO('20/05/2010'), dataISO('31/02/2010'), dataISO('2010-05-20'), dataISO('29/02/2024'), dataBR('2010-05-20')].join()`) === '2010-05-20,,,2024-02-29,20/05/2010', 'datas digitadas dd/mm/aaaa (31/02 não existe)')
  ok(run(`JSON.stringify(lerHoras('19h, 20:30, 1930, 7, 25h00, 19h00'))`) === '["07h00","19h00","19h30","20h30"]', 'horários digitados de qualquer jeito viram 19h00, 20h30...')
  ok(run(`JSON.stringify(lerRegras({r_cal: '1', r_hora1: '20:30', r_hora2: '', r_local3: 'Campo da Vila', r_local4: ' '}, 'Futsal').rules.locais)`) === '["Campo da Vila"]', 'horários e locais um por linha (vazios ignorados)')
  // editar atleta, excluir equipe, aviso de WhatsApp, estatísticas
  run(`S.champId = 'cal'; S.session = {role: 'secretaria'}`)
  run(`(() => { const c = C(); c.players.push({id: 'kp', team: 'k0', name: 'Erro Digitado', num: 5, birth: '1990-01-01', auth: true, approved: true, consent: true, bairro: 'Centro'}) })()`)
  run(`ui.editPlayer = 'kp'; F.editplayer({name: 'Nome Certo', num: '7', birth: '1990-01-01', nick: 'Certinho', pos: 'Ala', phone: '', endereco: 'Rua Nova, 5', bairro: 'Vila Nova', municipio: 'Tonantins', resp: '', respPhone: ''})`)
  ok(run(`(() => { const p = P(C(), 'kp'); return p.name === 'Nome Certo' && p.num === 7 && p.nick === 'Certinho' })()`), 'Secretaria corrige nome e número do atleta')
  ok(run(`(() => { const p = P(C(), 'kp'); return p.address === 'Rua Nova, 5' && p.city === 'Tonantins' })()`), 'endereço e município do atleta')
  run(`(() => { const c = C(); c.matches = []; c.status = 'inscricoes' })()`)
  await run(`F.newteam({name: 'Unidos da Comunidade', colors: 'azul e branco', coach: 'Seu Raimundo', coachPhone: '97 99999-1234', bairro: 'Comunidade São José'})`)
  ok(run(`(() => { const t = C().teams.find(x => x.name === 'Unidos da Comunidade'); return t.colors === 'azul e branco' && t.coach === 'Seu Raimundo' && t.bairro === 'Comunidade São José' })()`), 'equipe com cores, responsável e comunidade (texto livre)')
  await run(`F.newteam({name: 'Sem Bairro EC'})`); ok(run(`C().teams.some(x => x.name === 'Sem Bairro EC' && !x.bairro)`), 'bairro é opcional')
  run(`A.delteam({id: 'k4'})`); ok(run(`!!T(C(), 'k4')`), 'excluir equipe pede confirmação')
  run(`A.delteam({id: 'k4'})`); ok(run(`!T(C(), 'k4')`), 'equipe excluída depois de confirmar')
  ok(decodeURIComponent(run(`waLink(S.champs[0], S.champs[0].matches.find(isDone))`)).includes('RESULTADO'), 'aviso de resultado pronto para o WhatsApp')
  // imprevisto: trocar o campo de todos os jogos de um dia
  run(`S.champId = 'sub15'; S.session = {role: 'secretaria'}; ui.tab = 'jogos'; ui.swap = {}; render()`)
  ok(els['#app'].innerHTML.includes('Imprevisto: trocar campo'), 'formulário de troca de campo')
  const chave = run(`Object.keys(jogosPorCampo(C())).sort()[0]`)
  run(`F.swap({chave: ${JSON.stringify(chave)}, novo: 'Campo Reserva', why: 'campo alagado pela chuva'})`)
  const nTroca = run('ui.swap.ids.length'); run('A.swapok()')
  ok(nTroca > 0 && run(`ui.swap.ids === undefined && ui.swap.n`) === nTroca && run(`C().matches.filter(m => m.local === 'Campo Reserva').length`) === nTroca, 'troca de campo move todos os jogos do dia')
  ok(decodeURIComponent(run('ui.swap.wa')).includes('TROCA DE CAMPO') && run(`C().log[0].why`) === 'campo alagado pela chuva', 'aviso de WhatsApp e histórico com motivo')
  run('ui.swap = null')
  run(`S.champId = 'futsal26'; S.session = {role: 'publico'}; ui.tab = 'portal'; render()`)
  ok(els['#app'].innerHTML.includes('Melhor ataque') && els['#app'].innerHTML.includes('Defesa menos vazada'), 'estatísticas no portal')
  run(`S.session = {role: 'secretaria'}`)
  ok(await formato('g3', 6, 'grupos', {grupos: 3, classificam: 2}) === 3 + 6, 'personalizado: 3 grupos e passam 2 = 3 jogos de grupo + 2 quartas (2 folgas), semis, 3º e final')
  ok(run(`!!champion(C()) && C().status === 'encerrado'`), 'personalizado 3 grupos: chega ao campeão')
  ok(await formato('g1', 5, 'grupos', {grupos: 1, classificam: 4, terceiro: false}) === 10 + 3, 'personalizado: 1 grupo e passam 4 = pontos corridos + semifinal e final')
  ok(run(`(() => { const s = C().matches.filter(m => m.phase === 'semi'); return s[0].slotH === '1A' && s[0].slotA === '4A' && s[1].slotH === '2A' && !!champion(C()) })()`), 'semifinal 1º×4º e 2º×3º')
  ok(run(`JSON.stringify(lerRegras({format: 'grupos', r_grupos: '8', r_classificam: '4'}, 'Futsal').rules.classificam)`) === '2', 'no máximo 16 classificados (8 grupos passam 2)')
  run(`ui.doc = null; ui.reg = 'g4'; render()`); ok(els['#doc'].innerHTML.includes('REGULAMENTO') && els['#doc'].innerHTML.includes('4 grupos') && els['#doc'].innerHTML.includes('quartas de final'), 'regulamento gerado com o formato')
  run(`ui.reg = 'pc'; render()`); ok(els['#doc'].innerHTML.includes('turno e returno') && els['#doc'].innerHTML.includes('Vitória vale 2 pontos'), 'regulamento com as regras escolhidas')
  run(`ui.reg = null; render()`)
  console.log('ok: regras, mata-mata, sorteio e todas as telas')
})()

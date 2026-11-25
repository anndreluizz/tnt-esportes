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
             createElement: () => ({getContext: () => new Proxy({}, {get: (t, k) => k === 'measureText' ? () => ({width: 0}) : /Gradient$/.test(k) ? () => ({addColorStop() {}}) : () => {}, set: () => true})})},
})
for (const f of ['js/regras.js', 'js/dados.js', 'js/app.js', 'js/escolar.js', 'js/api.js']) vm.runInContext(read(f), ctx, {filename: f})
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
  run(`S.session=null; render()`); ok(els['#app'].innerHTML.includes('lhero t3'), 'tela de entrada')
  // Jogos Escolares como campeonato do sistema: todas as telas, todos os perfis, sem derrubar nada
  run(`S.champs.push({teams: [], players: [], matches: [], punishments: [], draw: null, log: [], escolar: true, id: 'esc-1', name: 'II Jogos Escolares <b>', sport: 'Futsal', category: 'Escolar', minAge: 6, maxAge: null,
    start: '2026-12-07', end: '2026-12-09', venue: 'Quadra', status: 'andamento', logo: 'https://x/l.png', responsible: 'Prof. Carlos', sponsors: [{name: 'Mercado Bom', logo: null}],
    esc: {mod: [{id: 'm1', nome: 'Futsal'}], turmas: [{id: 't1', nome: '1º ano'}], times: [{id: 'a', turma_id: 't1', modalidade_id: 'm1', genero: 'masculino', nome: '1º ano 01 - A'}, {id: 'b', turma_id: 't1', modalidade_id: 'm1', genero: 'masculino', nome: '1º ano 02 - C'}],
      jog: [{id: 'j', time_id: 'a', nome: 'Aluno <i>'}], juizes: [{id: 'z', nome: 'Carlos Silva'}], partidas: [{id: 'p', turma_id: 't1', modalidade_id: 'm1', genero: 'masculino', time_a_id: 'a', time_b_id: 'b', juiz_id: 'z', data: '2026-12-07', hora: '08:30:00', quadra: 1, placar_a: 2, placar_b: 1, vencedor_id: 'a', fase: 'final', colete_a: 'azul'}]}})`)
  run(`S.champId = 'esc-1'`)
  for (const [r, tabs] of Object.entries(run('ROLE_TABS')).filter(([r]) => r !== 'equipe'))
    for (const [t] of tabs.filter(([k]) => k !== 'escolar')) {
      run(`S.session = {role: '${r}'}; ui.tab='${t}'; render()`)
      const h = els['#app'].innerHTML
      if (t !== 'auditoria') ok(h.length > 150 && !h.includes('Aluno <i>') && !h.includes('II Jogos Escolares <b>'), `escolar ${r}/${t}`)
    }
  run(`S.session = {role: 'secretaria'}; ui.tab='jogos'; render()`)
  ok(els['#app'].innerHTML.includes('1º ano 01 - A') && els['#app'].innerHTML.includes('2 x 1') && els['#app'].innerHTML.includes('Juiz: Carlos Silva') && els['#app'].innerHTML.includes('08:30 · Quadra 1'), 'Jogos mostra os jogos escolares, o juiz e o horário')
  run(`ui.tab='campeonatos'; render()`); ok(els['#app'].innerHTML.includes('Jogos Escolares') || els['#app'].innerHTML.includes('II Jogos Escolares'), 'Campeonatos lista o escolar')
  run(`ui.tab='portal'; render()`); ok(els['#app'].innerHTML.includes('Mercado Bom') && els['#app'].innerHTML.includes('Prof. Carlos'), 'Portal mostra patrocínio e responsável')
  run(`S.session = {role: 'secretaria'}; ui.tab='painel'; render()`); ok(els['#app'].innerHTML.includes('Passo a passo'), 'Painel escolar da Secretaria traz o passo a passo')
  run(`S.session = {role: 'publico'}; ui.tab='portal'; render()`); ok(!els['#app'].innerHTML.includes('Passo a passo'), 'passo a passo é só da Secretaria')
  run(`S.session = {role: 'secretaria'}; ui.tab='relatorios'; render()`)
  ok(els['#app'].innerHTML.includes('Por série e modalidade') && els['#app'].innerHTML.includes('1º ano 01 - A') && els['#app'].innerHTML.includes('Imprimir'), 'Relatório escolar: tabela por série e lista de times')
  run(`ui.tab='divulgacao'; render()`)
  ok(els['#app'].innerHTML.includes('id="cv2"') && !els['#app'].innerHTML.includes('Aluno <i>'), 'Divulgação escolar: 3 imagens')
  run(`ui.tab='divulgacao'; render()`)
  await run(`buildCardsEscolar().then(() => ui.cards.length)`).then(n => ok(n === 3, 'Divulgação escolar monta as 3 imagens'))
  run(`S.champs = S.champs.filter(c => !c.escolar); S.champId = S.champs[0].id`)


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
  ok(run(`faltaCampeonato({name: 'Copa X', category: '', min: '15', start: '2027-01-01', venue: 'Quadra'}, true).join()`) === 'Categoria,Responsável,WhatsApp do responsável,Inscrições até,Máximo de atletas', 'campeonato oficial não é criado sem os campos obrigatórios')
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
  // histórico da partida: o público não recebe quem alterou nem o motivo (a view do banco não tem essas colunas): a linha sai só com data e texto
  run(`S = seed(); S.champs.forEach(resolveKO); S.session = {role: 'publico'}; const mh = C().matches.find(isDone); mh.history = [{at: '2026-11-14T12:00:00Z', what: 'Súmula confirmada: A 1 × 0 B'}]; ui.reg = null; ui.doc = {c: C().id, id: mh.id}; render()`)
  ok(els['#doc'].innerHTML.includes('Súmula confirmada: A 1 × 0 B') && !els['#doc'].innerHTML.includes('undefined') && !els['#doc'].innerHTML.includes(': Súmula'), 'histórico público: só data e texto, sem autor nem motivo')
  run(`ui.doc = null; S.session = null`)
  // privacidade: o documento público não mostra telefone do responsável nem observações internas da súmula
  run(`S.session = {role: 'publico'}; const cp = C(); cp.responsible = 'Fulano'; cp.responsiblePhone = '97999990000'; ui.doc = null; ui.reg = cp.id; render()`)
  ok(els['#doc'].innerHTML.includes('Fulano') && !els['#doc'].innerHTML.includes('97999990000'), 'regulamento público não mostra o telefone do responsável')
  run(`const mp = C().matches.find(isDone); mp.notes = 'OBSERVACAO INTERNA'; ui.reg = null; ui.doc = {c: C().id, id: mp.id}; render()`)
  ok(els['#doc'].innerHTML.includes('Gols') && !els['#doc'].innerHTML.includes('OBSERVACAO INTERNA'), 'súmula pública não mostra as observações do árbitro')
  run(`S.session = {role: 'secretaria'}; render()`)
  ok(els['#doc'].innerHTML.includes('OBSERVACAO INTERNA'), 'a Secretaria continua vendo as observações da súmula')
  run(`ui.doc = null; render()`)
  // carga do banco (loadAll de verdade, com um banco de mentira): roda sem erro em todos os perfis e só a Secretaria lê as tabelas sensíveis
  run(`globalThis.__vistas = []; sb = {from: t => { __vistas.push(t); const r = {data: [], error: null}, ch = {select: () => ch, order: () => ch, limit: () => ch, range: () => ch, eq: () => ch, then: (f, g) => Promise.resolve(r).then(f, g)}; return ch },
    storage: {from: () => ({createSignedUrls: async () => ({data: []})})}}`)
  for (const [perfil, sessao] of [['publico', "{role: 'publico'}"], ['arbitro', "{role: 'arbitro', uid: 'u1'}"], ['equipe', "{role: 'equipe', teamId: 't1'}"], ['secretaria', "{role: 'secretaria', uid: 'u2'}"]]) {
    run(`S.session = ${sessao}; __vistas = []`)
    let erro = null; try { await run('loadAll()') } catch (e) { erro = e.message }
    ok(!erro, `loadAll roda sem erro como ${perfil}: ${erro}`)
    const v = run('__vistas.slice()')
    ok(v.includes('equipes_publico') === (perfil !== 'secretaria') && v.includes('sorteios_publico'), `loadAll como ${perfil} consulta todas as fontes esperadas`)
    ok(v.includes('campeonatos') === (perfil === 'secretaria'), `só a Secretaria lê a tabela campeonatos (${perfil})`)
    ok(v.includes('jogos') === (perfil === 'secretaria' || perfil === 'arbitro'), `tabela jogos só para a Secretaria e o árbitro (${perfil})`)
  }
  run(`S.session = null`)
  // menores: nome abreviado nas artes públicas
  ok(run(`abrevNome('Maria Clara Souza Lima')`) === 'Maria L.' && run(`abrevNome('  joao   pedro ')`) === 'joao P.' && run(`abrevNome('Cacau')`) === 'Cacau' && run(`abrevNome('Ágatha Évora')`) === 'Ágatha É.', 'abrevNome: primeiro nome + inicial do último sobrenome')
  ok(run(`(() => { const c = seed().champs[0], men = {name: 'Pedro Alves Souza', birth: c.start.slice(0, 4) - 16 + '-06-01'}, mai = {name: 'Pedro Alves Souza', birth: c.start.slice(0, 4) - 30 + '-06-01'}
    return nomePublico(c, men) === 'Pedro S.' && nomePublico(c, mai) === 'Pedro Alves Souza' && nomePublico(c, {name: 'Sem Data'}) === 'Sem Data' })()`), 'nomePublico: menor abreviado, maior completo')
  ok(read('sw.js').includes("fetch(e.request, {cache: 'no-cache'})"), 'service worker confere com o servidor a cada abertura (sem cópia velha do HTML/JS)')
  // exclusão controlada das imagens antigas (bucket "marcas"): banco e armazenamento simulados, cada falha pode ser forçada
  const novoBanco = (cfg = {}) => {
    const st = {camp: [{id: 'c1', logo_path: 'c1/logo-1.png', patrocinadores: [{nome: 'Gadita', logo_path: 'c1/patrocinio-0-1.png'}, {nome: 'Lia', logo_path: 'c1/patrocinio-1-1.png'}]}],
      eq: [{id: 't1', escudo_path: 'c1/equipe-t1-1.png'}], ordem: [], removidos: [], pend: [], atualizou: false}
    st.foto = {campeonatos: JSON.parse(JSON.stringify(st.camp)), equipes: JSON.parse(JSON.stringify(st.eq))}
    const tabela = t => t === 'campeonatos' ? st.camp : st.eq
    st.from = t => { let filtro = null, mudanca = null
      const b = {select: () => b, order: () => b, range: () => b, eq: (k, v) => (filtro = [k, v], b), update: o => (mudanca = o, b),
        then: (res, rej) => Promise.resolve().then(() => {
          const linhas = tabela(t).filter(r => !filtro || r[filtro[0]] === filtro[1])
          if (mudanca) { st.ordem.push('update:' + t); if (cfg.falhaUpdate) return {data: null, error: {message: 'falhou ao gravar'}}; linhas.forEach(r => Object.assign(r, mudanca)); st.atualizou = true; return {data: null, error: null} }
          st.ordem.push('select:' + t)
          const fonte = cfg.releituraAntiga && st.atualizou ? st.foto[t].filter(r => !filtro || r[filtro[0]] === filtro[1]) : linhas
          return {data: JSON.parse(JSON.stringify(fonte)), error: null} }).then(res, rej) }
      return b }
    st.storage = {from: () => ({
      upload: async path => { st.ordem.push('upload:' + path); return cfg.falhaUpload ? {error: {message: 'sem espaço'}} : {error: null} },
      remove: async paths => { st.ordem.push('remove:' + paths.join())
        if (cfg.falhaRemove === 'erro') return {data: null, error: {message: 'rede caiu'}}
        if (cfg.falhaRemove === 'silencioso') return {data: [], error: null}   // o Storage sem permissão não apaga e não avisa
        paths.forEach(p => st.removidos.push(p)); return {data: paths.map(name => ({name})), error: null} }})}
    return st
  }
  const usa = st => { ctx.__st = st; run(`sb = {from: __st.from, storage: __st.storage}; fitImage = async f => f ? {tipo: 'blob'} : null; leePendentes = () => __st.pend.slice(); guardaPendentes = l => { __st.pend = l.slice() }`) }
  const tenta = async codigo => { try { await run(codigo); return null } catch (e) { return e.message } }
  const SP = {sp0: 'Gadita', spp0: 'c1/patrocinio-0-1.png', sp1: 'Lia', spp1: 'c1/patrocinio-1-1.png'}   // o formulário de edição devolve os patrocinadores que já existem
  const dc = d => JSON.stringify(d)
  const idx = (st, prefixo) => st.ordem.findIndex(x => x.startsWith(prefixo))

  ok(run(`JSON.stringify(escolheParaApagar(['c1/a.png', 'c1/b.png', 'c9/de-outro-campeonato.png', null, 'c1/a.png', 'c1/em-uso.png'], ['c1/em-uso.png'], 'c1'))`) === '["c1/a.png","c1/b.png"]', 'escolheParaApagar: só da pasta do campeonato, sem repetir, e nunca o que ainda está em uso')
  // 1) trocar a logo: o antigo só sai DEPOIS de gravar e conferir
  let b = novoBanco(); usa(b)
  ok(await tenta(`gravaMarcas('c1', ${dc({logo: 'ARQ', ...SP})}, true)`) === null, 'trocar a logo: roda sem erro')
  ok(b.removidos.join() === 'c1/logo-1.png' && b.camp[0].logo_path !== 'c1/logo-1.png' && b.camp[0].logo_path.startsWith('c1/logo-'), 'trocar a logo: o arquivo antigo é apagado e a logo nova fica no registro')
  ok(idx(b, 'upload:') < idx(b, 'update:campeonatos') && idx(b, 'update:campeonatos') < idx(b, 'remove:'), 'trocar a logo: a ordem é enviar, gravar no banco e só então apagar o antigo')
  ok(b.ordem.slice(idx(b, 'update:campeonatos'), idx(b, 'remove:')).includes('select:campeonatos'), 'trocar a logo: o registro é lido de volta antes de apagar')
  ok(b.camp[0].patrocinadores.map(p => p.logo_path).join() === 'c1/patrocinio-0-1.png,c1/patrocinio-1-1.png', 'trocar a logo: os patrocinadores continuam como estavam')
  // 2) a gravação falha: nada é apagado
  b = novoBanco({falhaUpdate: true}); usa(b)
  ok(await tenta(`gravaMarcas('c1', ${dc({logo: 'ARQ', ...SP})}, true)`) !== null && b.removidos.length === 0 && !b.ordem.some(x => x.startsWith('remove:')), 'se a gravação no banco falha, nenhum arquivo é apagado')
  // 3) o banco não confirma (leitura de volta diferente): nada é apagado
  b = novoBanco({releituraAntiga: true}); usa(b)
  await tenta(`gravaMarcas('c1', ${dc({logo: 'ARQ', ...SP})}, true)`)
  ok(b.removidos.length === 0 && !b.ordem.some(x => x.startsWith('remove:')), 'se o registro lido de volta não é o pretendido, nada é apagado')
  // 4) o arquivo antigo ainda é usado por outro registro: nunca apaga
  b = novoBanco(); b.eq[0].escudo_path = 'c1/logo-1.png'; usa(b)
  await tenta(`gravaMarcas('c1', ${dc({logo: 'ARQ', ...SP})}, true)`)
  ok(b.removidos.length === 0, 'um arquivo que ainda está referenciado por outro registro nunca é apagado')
  // 5) a exclusão falha com erro: vira pendência; depois é refeita
  b = novoBanco({falhaRemove: 'erro'}); usa(b)
  await tenta(`gravaMarcas('c1', ${dc({logo: 'ARQ', ...SP})}, true)`)
  ok(b.pend.length === 1 && b.pend[0].path === 'c1/logo-1.png' && b.camp[0].logo_path !== 'c1/logo-1.png', 'exclusão com erro: o registro fica salvo e a pendência é registrada')
  b.removidos.length = 0; const cfg5 = b; usa(Object.assign(b, {}))
  run(`sb = {from: __st.from, storage: {from: () => ({remove: async paths => { __st.ordem.push('remove:' + paths.join()); __st.removidos.push(...paths); return {data: paths.map(name => ({name})), error: null} }})}}`)
  await run('reprocessaPendencias()')
  ok(b.removidos.join() === 'c1/logo-1.png' && b.pend.length === 0, 'a pendência é tentada de novo, apaga o arquivo e sai da lista')
  // 6) o Storage "não apaga e não avisa" (sem erro, lista vazia): também vira pendência
  b = novoBanco({falhaRemove: 'silencioso'}); usa(b)
  await tenta(`gravaMarcas('c1', ${dc({logo: 'ARQ', ...SP})}, true)`)
  ok(b.pend.length === 1 && b.pend[0].path === 'c1/logo-1.png', 'se o Storage não apaga e não avisa, vira pendência (não é dado como apagado)')
  // 6b) limite de tentativas automáticas: a pendência fica registrada e visível, sem novas tentativas
  b = novoBanco({falhaRemove: 'erro'}); b.pend = [{path: 'c1/velho.png', pasta: 'c1', motivo: 'x', em: '2026-01-01', tentativas: 0}]; usa(b)
  b.renders = 0; run('render = () => { __st.renders++ }')
  let chamadas = 0;
  for (let i = 0; i < 8; i++) { const antes = b.ordem.filter(x => x.startsWith('remove:')).length; await run('reprocessaPendencias()'); chamadas += b.ordem.filter(x => x.startsWith('remove:')).length - antes }
  ok(chamadas === 5, 'a exclusão que sempre falha é tentada no máximo 5 vezes (foram ' + chamadas + ' em 8 aberturas da Central)')
  ok(b.pend.length === 1 && b.pend[0].path === 'c1/velho.png' && b.pend[0].tentativas === 5 && b.removidos.length === 0, 'ao atingir o limite a pendência continua registrada e nada é apagado')
  ok(JSON.stringify(await run('pendentesMarcas()')) === '{"total":1,"esgotadas":1}', 'a contagem para a Central mostra 1 pendente e 1 sem novas tentativas')
  ok(b.renders >= 1, 'cada tentativa que falha atualiza a tela da Central')
  // depois do limite, mesmo com o Storage funcionando de novo, não há exclusão automática
  run(`sb = {from: __st.from, storage: {from: () => ({remove: async paths => { __st.removidos.push(...paths); return {data: paths.map(name => ({name})), error: null} }})}}`)
  await run('reprocessaPendencias()')
  ok(b.removidos.length === 0 && b.pend.length === 1, 'esgotadas as tentativas, não há nova exclusão automática (a pendência segue registrada)')
  // aviso da Central
  const aviso = await run('avisoMarcas()')
  ok(/Imagens antigas pendentes de exclusão/.test(aviso) && />1</.test(aviso) && /limite de tentativas/.test(aviso), 'a Central mostra a quantidade de imagens pendentes e o limite de tentativas')
  b = novoBanco(); usa(b); ok(!(await run('avisoMarcas()')), 'sem pendências, a Central não mostra o aviso')
  // 7) falha ao enviar a imagem nova: não apaga nada e o registro não muda
  b = novoBanco({falhaUpload: true}); usa(b)
  await tenta(`gravaMarcas('c1', ${dc({logo: 'ARQ', ...SP})}, true)`)
  ok(b.removidos.length === 0 && b.camp[0].logo_path === 'c1/logo-1.png' && b.pend.length === 0, 'se o envio da imagem nova falha, nada é apagado e a logo antiga continua no registro')
  // 8) tirar um patrocinador: só a imagem dele sai; a do outro e a logo ficam
  b = novoBanco(); usa(b)
  await tenta(`gravaMarcas('c1', ${dc({sp0: 'Gadita', spp0: 'c1/patrocinio-0-1.png'})}, true)`)
  ok(b.removidos.join() === 'c1/patrocinio-1-1.png' && b.camp[0].patrocinadores.length === 1 && b.camp[0].logo_path === 'c1/logo-1.png', 'tirar um patrocinador apaga só a imagem dele; a do outro e a logo ficam')
  // 9) trocar a logo de um patrocinador
  b = novoBanco(); usa(b)
  await tenta(`gravaMarcas('c1', ${dc({...SP, spl0: 'ARQ'})}, true)`)
  ok(b.removidos.join() === 'c1/patrocinio-0-1.png' && b.camp[0].patrocinadores[0].logo_path.startsWith('c1/patrocinio-0-') && b.camp[0].patrocinadores[0].logo_path !== 'c1/patrocinio-0-1.png', 'trocar a logo de um patrocinador apaga só a anterior dele')
  // 10) um patrocinador ficaria sem a imagem que tinha: não apaga nada
  b = novoBanco(); usa(b)
  await tenta(`gravaMarcas('c1', ${dc({sp0: 'Gadita', sp1: 'Lia', spp1: 'c1/patrocinio-1-1.png'})}, true)`)
  ok(b.removidos.length === 0 && !b.ordem.some(x => x.startsWith('remove:')), 'se uma operação deixaria um patrocinador sem a imagem que tinha, nada é apagado')
  // 11) salvar sem mexer em imagens: nada é apagado e os patrocinadores são preservados
  b = novoBanco(); usa(b)
  await tenta(`gravaMarcas('c1', ${dc({...SP})}, true)`)
  ok(b.removidos.length === 0 && b.camp[0].patrocinadores.map(p => p.nome).join() === 'Gadita,Lia' && b.camp[0].logo_path === 'c1/logo-1.png', 'salvar o campeonato sem trocar imagens não apaga nada e preserva logo e patrocinadores')
  // 12) criação de campeonato: não há nada antigo para apagar
  b = novoBanco(); usa(b)
  await tenta(`gravaMarcas('c1', ${dc({logo: 'ARQ', ...SP})}, false)`)
  ok(b.removidos.length === 0 && !b.ordem.some(x => x.startsWith('remove:')), 'criar o campeonato não apaga nada')
  // 13) pendência cujo arquivo voltou a ser usado: descartada sem apagar
  b = novoBanco(); b.pend = [{path: 'c1/logo-1.png', pasta: 'c1', motivo: 'x', tentativas: 0}]; usa(b)
  await run('reprocessaPendencias()')
  ok(b.removidos.length === 0 && b.pend.length === 0, 'pendência cujo arquivo voltou a ser usado é descartada sem apagar')
  // 14) escudo da equipe: troca confirmada apaga o antigo; falha ou releitura diferente não
  b = novoBanco(); usa(b)
  await tenta(`enviaEscudo({id: 'c1'}, 't1', {tipo: 'blob'})`)
  ok(b.removidos.join() === 'c1/equipe-t1-1.png' && b.eq[0].escudo_path.startsWith('c1/equipe-t1-') && idx(b, 'update:equipes') < idx(b, 'remove:'), 'trocar o escudo: grava, lê de volta e só então apaga o antigo')
  b = novoBanco({falhaUpdate: true}); usa(b)
  await tenta(`enviaEscudo({id: 'c1'}, 't1', {tipo: 'blob'})`)
  ok(b.removidos.length === 0, 'trocar o escudo com falha na gravação não apaga o antigo')
  b = novoBanco({releituraAntiga: true}); usa(b)
  await tenta(`enviaEscudo({id: 'c1'}, 't1', {tipo: 'blob'})`)
  ok(b.removidos.length === 0, 'trocar o escudo sem confirmação do banco não apaga o antigo')
  b = novoBanco({falhaRemove: 'silencioso'}); usa(b)
  await tenta(`enviaEscudo({id: 'c1'}, 't1', {tipo: 'blob'})`)
  ok(b.pend.length === 1 && b.pend[0].path === 'c1/equipe-t1-1.png', 'escudo: exclusão que o Storage não fez vira pendência')
  run(`sb = null; leePendentes = () => []; guardaPendentes = () => {}`)
  console.log('ok: regras, mata-mata, sorteio e todas as telas')
})()

// node checar-escola.js — abre as telas do campeonato escolar (escola.html e professor.html) com um banco de mentira
// e confere o que aparece para o público, para a Secretaria e para o professor. As regras do banco ficam em supabase/testar-turmas.mjs.
const fs = require('fs'), vm = require('vm')
const read = f => fs.readFileSync(__dirname + '/' + f, 'utf8')
const ok = (c, m) => { if (!c) { console.error('FALHOU:', m); process.exit(1) } }
const espera = () => new Promise(r => setTimeout(r, 30))

const TOK = '11111111-1111-4111-8111-111111111111'
const rows = {
  esc_campeonatos: [{id: 'c1', nome: 'II Jogos Escolares Internos', inicio: '2026-12-07', fim: '2026-12-09', local: 'Quadra <b>x</b>', inscricoes_abertas: true, responsavel: 'Prof. Carlos <b>', logo_path: 'escola/c1/logo.png', patrocinadores: [{nome: 'Mercado Bom', logo_path: 'escola/c1/p0.png'}, {nome: 'Sem Logo', logo_path: null}]}],
  esc_modalidades: [{id: 'm1', campeonato_id: 'c1', nome: 'Futsal', jogadores_por_time: 5, reservas_max: 5}, {id: 'm2', campeonato_id: 'c1', nome: 'Queimada', jogadores_por_time: 10, reservas_max: 0}],
  esc_turmas: [{id: 't9', campeonato_id: 'c1', nome: '9º ano'}, {id: 't10', campeonato_id: 'c1', nome: '6ª etapa / 7º ano - EJAI'}, {id: 't2', campeonato_id: 'c1', nome: '2º ano'}, {id: 't1', campeonato_id: 'c1', nome: '1º ano 01'}],
  esc_times: [{id: 'solo', turma_id: 't2', modalidade_id: 'm1', genero: 'feminino', nome: 'Solo <b>'}, {id: 'a', turma_id: 't1', modalidade_id: 'm1', genero: 'masculino', nome: 'Time A'}, {id: 'b', turma_id: 't1', modalidade_id: 'm1', genero: 'masculino', nome: 'Time B'}],
  esc_jogadores: [{id: 'j1', time_id: 'a', nome: 'Aluno <i>1</i>'}],
  esc_partidas: [{id: 'p1', turma_id: 't1', modalidade_id: 'm1', genero: 'masculino', time_a_id: 'a', time_b_id: 'b', juiz_id: 'z1', data: '2026-12-07', hora: '08:00:00', quadra: 1, placar_a: 2, placar_b: 2, penaltis_a: 4, penaltis_b: 3, vencedor_id: 'a', fase: 'final', colete_a: 'azul'}],
  esc_juizes: [{id: 'z1', campeonato_id: 'c1', nome: 'Carlos <u>Silva'}],
  perfis: [{papel: 'secretaria'}],
}
const rpcs = {esc_contatos_prof: [{origem: '1º ano 01', nome: 'Prof <b>', telefone: '5592999991234'}], esc_links_turmas: [{origem: '1º ano 01', token: 'TURMATOK', professor: 'Prof <b>', times: 2, alunos: 3}], esc_turma_meu: [{origem: '1º ano 01', professor: null, inscricoes_abertas: true}], esc_turma_times: [{time_id: 'a', time_nome: '1º ano 01 - A', modalidade_nome: 'Futsal', genero: 'masculino', vagas: 15}, {time_id: 'q', time_nome: '1º ano 01 - A', modalidade_nome: 'Queimada', genero: 'masculino', vagas: 10}], esc_turma_candidatos: [{nome: 'Ana <i>Souza'}, {nome: 'Bia Lima'}], esc_candidatos_time: [{nome: 'Ana <i>Souza'}, {nome: 'Bia Lima'}], esc_juiz_link: 'JUIZTOK', esc_juiz_valido: 'c1', esc_links_times: [{time_id: 'a', token: TOK, professor: 'Maria da Silva'}, {time_id: 'b', token: '22222222-2222-4222-8222-222222222222', professor: null}], esc_meu_time: [{time_id: 'a', time_nome: 'Time A', turma_nome: '1º ano 01', modalidade_nome: 'Futsal', genero: 'masculino', vagas: 10, inscricoes_abertas: true, professor: null}]}

function roda(arquivos, {logado, busca = TOK}) {
  const els = {}, el = () => ({innerHTML: '', textContent: '', classList: {add() {}, remove() {}}, addEventListener() {}})
  const builder = r => { const b = new Proxy({}, {get: (_, k) => k === 'then' ? f => Promise.resolve({data: r, error: null}).then(f) : () => b}); return b }
  const sb = {auth: {getSession: async () => ({data: {session: logado ? {user: {id: 'u'}} : null}}), signOut: async () => {}, signInWithPassword: async () => ({})},
    from: t => builder(rows[t]), rpc: n => builder(rpcs[n])}
  const ctx = vm.createContext({crypto: require('crypto').webcrypto, console, setTimeout, clearTimeout, setInterval: () => 0, URL, URLSearchParams, encodeURIComponent, confirm: () => true, navigator: {},
    location: {href: 'https://x.test/escola.html', search: '?t=' + busca}, supabase: {createClient: () => sb},
    document: {querySelector: s => els[s] ??= el(), querySelectorAll: () => [], addEventListener() {}}})
  for (const f of arquivos) vm.runInContext(read(f), ctx, {filename: f})
  els.__ctx = ctx
  return els
}

;(async () => {
  let els = roda(['js/config.js', 'js/escola.js'], {logado: false}); await espera()
  let h = els['#app'].innerHTML
  ok(h.includes('II Jogos Escolares Internos') && h.includes('1º ano 01') && h.includes('Time A'), 'público vê campeonato, turma e times')
  ok(!h.includes('Campeão: Time A') && h.includes('pên. 4 x 3'), 'portal público não mostra campeão; resultado com pênaltis continua')
  ok(h.includes('azul') && h.includes('vermelho'), 'mostra os coletes dos dois lados')
  ok(h.includes('Aluno &lt;i&gt;1&lt;/i&gt;') && h.includes('Quadra &lt;b&gt;x&lt;/b&gt;') && !h.includes('<i>1</i>'), 'nomes e textos do banco são escapados (sem HTML injetado)')
  ok(h.includes('Sou da Secretaria') && !h.includes('Painel da Secretaria') && !h.includes('data-form="placar"') && !h.includes(TOK), 'público não vê painel, edição de placar nem link do professor')
  ok(h.includes('Resultados') && h.includes('Jogos a jogar') && h.includes('data-act="fm"') && !h.includes('JUIZTOK'), 'portal público lista os jogos (a jogar e resultados), com filtro, sem o link do juiz')
  ok(h.includes('Respons') && h.includes('Prof. Carlos &lt;b&gt;') && h.includes('marcas/escola/c1/logo.png') && h.includes('class="sponsors pub-spons"') && h.includes('Mercado Bom') && h.includes('<b>Sem Logo</b>'), 'portal mostra logo, responsável (escapado) e patrocinadores')
  ok(h.includes('seg 07/12') && h.includes('08:00') && h.includes('Quadra 1'), 'portal mostra o dia, a hora e a quadra do jogo')
  ok(!h.includes('campeão direto') && h.includes('aguardando outros times') && h.includes('Solo &lt;b&gt;') && !h.includes('Solo <b>'), 'portal: time único não vira campeão antes do sorteio (nome escapado)')
  els = roda(['js/config.js', 'js/escola.js'], {logado: true}); await espera(); h = els['#app'].innerHTML; const ctxEscola = els.__ctx
  ok(h.includes('Painel da Secretaria') && h.includes('data-form="placar"') && h.includes('professor.html?t=' + TOK), 'Secretaria vê painel, edita placar e pega o link do professor')
  ok(h.includes('wa.me/?text='), 'link do professor pode ir por WhatsApp')
  ok(h.includes('Professor: Maria da Silva') && h.includes('professor ainda não preencheu') && h.includes('1 de 3 com professor responsável'), 'Secretaria vê quem é o professor de cada time e quem falta')
  const pos = t => h.indexOf(t + ' <small class="sub">'); ok(pos('2º ano') > 0 && pos('2º ano') < pos('9º ano') && pos('9º ano') < pos('6ª etapa / 7º ano - EJAI'), 'séries em ordem numérica (1º ao 9º ano, depois EJAI), não alfabética')
  ok(h.includes('class="resumo"') && h.includes('professores responsáveis'), 'painel mostra o resumo (séries, times, professores, alunos, jogos)')
  ok(h.includes('Sorteio dos jogos') && !h.includes('data-form="partida"') && h.includes('campeão: Time A'), 'jogos são sorteados pelo sistema (sem escolher confronto à mão)')
  ok(h.includes('Séries (grupos)') && h.includes('name="origem"') && h.includes('1º ano 02'), 'time nasce de uma turma de origem dentro da série')
  ok(h.includes('data-form="identidade"') && h.includes('name="logo"') && h.includes('name="sp0"') && h.includes('data-act="addpat"') && h.includes('name="responsavel"'), 'Secretaria edita logo, responsável e patrocinadores')
  ok(h.includes('com menos de 5 alunos') && h.includes('campeão direto: Solo'), 'Secretaria: aviso de futsal com menos de 5 alunos e campeão direto no sorteio')
  ok(!h.includes('data-act="sortear" data-key="t2|'), 'grupo de time único não tem sorteio')
  ok(h.includes('turma.html?t=TURMATOK') && h.includes('data-form="addprof"') && h.includes('name="origem"') && h.includes('name="tel"') && h.includes('data-act="tirarprof"') && !h.includes('Prof <b>'), 'Secretaria pega o link de cada turma (professor escapado)')
  ok(h.includes('>Professores <small>') && h.includes('wa.me/5592999991234?text=') && h.includes('Enviar pelo WhatsApp') && h.includes('(92) 999991234') && h.includes('<b>Prof &lt;b&gt;</b>') && !h.includes('Prof <b>') && !h.includes('Links por turma'), 'Secretaria vê cada professor com o WhatsApp e o botão de enviar o link (turmas dele num link só)')
  ok(h.includes('data-form="agenda"') && h.includes('5. Horários dos jogos') && h.includes('Ver como fica'), 'Secretaria vê o card de horários')
  ok(h.includes('data-form="juiz"') && h.includes('Carlos &lt;u&gt;Silva') && h.includes('data-juiz="p1"') && !h.includes('Carlos <u>'), 'Secretaria cadastra juízes (nome escapado) e escala em cada jogo')
  ok(h.includes('juiz.html?t=JUIZTOK') && h.includes('Link do juiz'), 'Secretaria pega o link do juiz')
  els = roda(['js/config.js', 'js/juiz.js'], {logado: false}); await espera(); h = els['#app'].innerHTML
  ok(h.includes('Mesa do juiz') && h.includes('data-abrir="p1"') && h.includes('Corrigir') && !h.includes('name="pa"') && !h.includes('sumclock'), 'juiz vê a lista de jogos (um toque abre a mesa do jogo)')
  const ctxJ = els.__ctx; vm.runInContext("abrir('p1')", ctxJ); h = els['#app'].innerHTML
  ok(h.includes('sumclock') && h.includes('10 min') && h.includes('name="pa"') && h.includes('name="ea"') && h.includes('Corrigir resultado') && h.includes('data-voltar') && h.includes('Imprimir súmula'), 'mesa do jogo: relógio, placar, pênaltis (jogo empatado) e voltar')
  vm.runInContext("sumAcao('p1', 'gol', 'a')", ctxJ); h = els['#app'].innerHTML
  ok(h.includes('name="pa" value="3"') && !h.includes('name="ea"') && h.includes('Gol ·'), 'gol muda o placar, esconde os pênaltis (não empata mais) e entra no log')
  vm.runInContext("sumAcao('p1', 'desfazer')", ctxJ); h = els['#app'].innerHTML
  ok(h.includes('name="pa" value="2"') && h.includes('name="ea"'), 'desfazer volta o placar e os pênaltis')
  els = roda(['js/config.js', 'js/professor.js'], {logado: false}); await espera(); h = els['#app'].innerHTML
  ok(h.includes('Time A') && h.includes('1 de 10') && h.includes('Inscrever aluno') && h.includes('Aluno &lt;i&gt;1&lt;/i&gt;'), 'professor vê o time, as vagas e o formulário')
  ok(h.includes('Alunos da turma') && h.includes('data-add="Ana &lt;i&gt;Souza"') && !h.includes('Ana <i>'), 'professor de futsal vê a lista da turma para escolher (nome escapado)')
  els = roda(['js/config.js', 'js/turma.js'], {logado: false}); await espera(); h = els['#app'].innerHTML; let ctxT = els.__ctx, rod = els['#rodape'].innerHTML
  ok(h.includes('Quem vai jogar') && h.includes('Ficaram de fora') && h.includes('tp-rtime'), 'professor vê o resumo dos times e quem ficou de fora')
  ok(h.includes('1º ano 01') && h.includes('Time A') && h.includes('data-aluno="Ana &lt;i&gt;Souza"') && h.includes('data-mod="Queimada"') && !h.includes('Ana <i>') && !h.includes('Minhas turmas'), 'uma turma só: vai direto para os times e a lista da turma (nomes escapados)')
  ok(h.includes('Qual é o seu nome?') && h.includes('name="prof"') && h.includes('name="tel"') && h.includes('fica só com a Secretaria') && rod.includes('Faltam 4 para o mínimo de 5') && rod.includes('1 aluno escolhido'), 'professor sem nome vê o campo, e a barra de baixo mostra o que falta para o mínimo')
  ok(h.includes('Aluno &lt;i&gt;1&lt;/i&gt;') && h.includes('data-sair="Aluno &lt;i&gt;1&lt;/i&gt;"') && h.includes('Quem vai jogar') && h.includes('Ficaram de fora') && !h.includes('data-aluno="Aluno &lt;i&gt;1&lt;/i&gt;"'), 'aluno que já está no time aparece na lista do time (com Tirar), e sai da lista de livres')
  ok(h.includes('Adicionar ou excluir equipe') && h.includes('data-novo="masculino"') && h.includes('data-novo="feminino"') && h.includes('data-exclui'), 'professor cria time novo (meninos ou meninas) e exclui time em "Adicionar ou excluir equipe"')
  vm.runInContext("alternar('Bia Lima')", ctxT); ok(vm.runInContext("turmas[0].jogadores.some(j => j.nome === 'Bia Lima' && j.time_id === 'a')", ctxT) && els['#rodape'].innerHTML.includes('2 alunos escolhidos'), 'tocar no nome coloca o aluno no time na hora (a tela não espera o banco)')
  vm.runInContext("S.mod = 'Queimada'; S.time = null; render(); 0", ctxT); h = els['#app'].innerHTML; rod = els['#rodape'].innerHTML
  ok(h.includes('Queimada · Meninos · Time A') && rod.includes('Faltam 1 para o mínimo de 1'), 'queimada: sem limite de jogadores, mínimo 1')
  const T2 = '33333333-3333-4333-8333-333333333333'
  els = roda(['js/config.js', 'js/turma.js'], {logado: false, busca: TOK + ',' + T2}); await espera(); h = els['#app'].innerHTML
  ok(h.includes('Você cuida de 2 turmas') && h.includes('data-turma="0"') && h.includes('data-turma="1"') && h.includes('data-nome-prof'), 'um link com duas turmas: começa na lista de turmas e pergunta o nome uma vez')
  rpcs.esc_turma_meu = [{origem: '1º ano 01', professor: 'Ana Lima / Bia <b>Souza', inscricoes_abertas: true}]
  els = roda(['js/config.js', 'js/turma.js'], {logado: false}); await espera(); h = els['#app'].innerHTML
  ok(h.includes('Ana Lima') && h.includes('Bia &lt;b&gt;Souza') && !h.includes('Bia <b>') && h.includes('data-delprof="Ana Lima"') && h.includes('Nome de outro professor') && !h.includes('Qual é o seu nome?'), 'turma com vários professores: lista, tirar e adicionar outro')
  els = roda(['js/config.js', 'js/professor.js'], {logado: false}); await espera(); h = els['#app'].innerHTML
  ok(h.includes('Professor responsável') && h.includes('name="prof"'), 'professor sem nome cadastrado vê o campo para preencher')
  // juízes: distribuição igual, sem mexer em quem já foi escalado
  const rj = (js, ps) => [...vm.runInContext(`reparteJuizes(${JSON.stringify(js)}, ${JSON.stringify(ps)})`, ctxEscola).entries()]
  const jz = n => Array.from({length: n}, (_, i) => ({id: 'j' + i})), jg2 = n => Array.from({length: n}, (_, i) => ({id: 'g' + i, fase: 'quartas'}))
  let rp = rj(jz(3), jg2(10)); ok(rp.length === 3 && rp.every(([, l]) => l.length >= 3 && l.length <= 4) && rp.flatMap(([, l]) => l).length === 10, '10 jogos entre 3 juízes: 3 ou 4 para cada')
  rp = rj(jz(2), [{id: 'a', fase: 'final', juiz_id: 'j0'}, {id: 'b', fase: 'final', juiz_id: 'j0'}, {id: 'c', fase: 'final'}]); ok(rp.length === 1 && rp[0][0] === 'j1' && rp[0][1].join() === 'c', 'quem tem menos jogos recebe; escalado à mão não muda')
  ok(rj([], jg2(3)).length === 0 && rj(jz(2), [{id: 'a', fase: 'final', juiz_id: 'j0'}]).length === 0, 'sem juiz cadastrado ou sem jogo livre: nada a distribuir')
  // agenda por horário: 1 e 2 quadras, janelas, sobra, fase em ordem, jogos já marcados
  const mods = [{id: 'f', tempos: 2, tempo_min: 10}, {id: 'q', tempos: 1, tempo_min: 10}]
  const ag = (ps, o) => vm.runInContext(`montaAgenda(${JSON.stringify(ps)}, ${JSON.stringify(mods)}, ${JSON.stringify({dias: ['2026-12-07', '2026-12-08'], janelas: [['08:00', '09:00'], ['13:30', '14:30']], quadras: 1, ...o})})`, ctxEscola)
  ok(ag([{id: 'x', data: null, modalidade_id: 'm2', fase: 'final'}], {dia1: '08:30'}).linhas[0].hora === '08:30' && ag([{id: 'x', data: null, modalidade_id: 'm2', fase: 'final'}], {dia1: '13:30'}).linhas[0].hora === '13:30', 'agenda: 1º jogo do 1º dia depois da abertura')
  const fut = (n, fase = 'quartas') => Array.from({length: n}, (_, i) => ({id: 'f' + i, modalidade_id: 'f', fase}))
  let a1 = ag(fut(5)); ok(a1.linhas.map(l => l.data + ' ' + l.hora).join() === '2026-12-07 08:00,2026-12-07 08:30,2026-12-07 13:30,2026-12-07 14:00,2026-12-08 08:00', 'agenda: 30 min por jogo de futsal, manhã depois tarde, depois o dia seguinte')
  a1 = ag(fut(10)); ok(a1.linhas.length === 8 && a1.sobra.length === 2 && a1.precisa === 300 && a1.tem === 240, 'agenda: o que não cabe vai para a sobra, com horas precisas e disponíveis')
  a1 = ag(fut(4), {quadras: 2}); ok(a1.linhas.filter(l => l.hora === '08:00').length === 2 && a1.linhas.every(l => l.quadra <= 2), 'agenda: 2 quadras jogam ao mesmo tempo')
  a1 = ag([...fut(1, 'final').map(p => ({...p, id: 'fin'})), ...fut(1, 'semifinal').map(p => ({...p, id: 'semi'}))]); ok(a1.linhas[0].id === 'semi' && a1.linhas[1].id === 'fin', 'agenda: fases em ordem (semifinal antes da final)')
  a1 = ag([{id: 'x', modalidade_id: 'q', fase: 'final'}, {id: 'y', modalidade_id: 'q', fase: 'final'}]); ok(a1.linhas[1].hora === '08:15', 'agenda: queimada ocupa 15 min')
  a1 = ag([{id: 'ja', modalidade_id: 'f', fase: 'final', data: '2026-12-07', hora: '08:00:00', quadra: 1}, {id: 'novo', modalidade_id: 'f', fase: 'final'}]); ok(a1.linhas.length === 1 && a1.linhas[0].hora === '08:30', 'agenda: jogo já marcado não muda e o novo vem depois')
  // sorteio: o sistema monta os confrontos (mata-mata, com folga quando o numero e impar)
  const pr = (n, ps = []) => vm.runInContext(`proximaRodada(${JSON.stringify(Array.from({length: n}, (_, i) => ({id: 't' + i})))}, ${JSON.stringify(ps)})`, ctxEscola)
  const usados = r => [...r.jogos.flatMap(j => [j.a, j.b]), ...(r.folga ? [r.folga] : [])].sort().join()
  let r = pr(2); ok(r.fase === 'final' && r.jogos.length === 1 && !r.folga, '2 times: direto a final')
  r = pr(3); ok(r.fase === 'semifinal' && r.jogos.length === 1 && r.folga && usados(r) === 't0,t1,t2', '3 times: 1 jogo e 1 folga')
  r = pr(4); ok(r.fase === 'semifinal' && r.jogos.length === 2 && !r.folga && usados(r) === 't0,t1,t2,t3', '4 times: 2 semifinais')
  r = pr(5); ok(r.fase === 'quartas' && r.jogos.length === 2 && r.folga, '5 times: 2 jogos e 1 folga')
  ok(r.jogos.every(j => ['azul', 'vermelho'].includes(j.colete) && j.a !== j.b), 'coletes e confrontos válidos')
  ok(pr(17).erro && pr(1).erro, 'limites: 1 ou mais de 16 times não sorteia')
  const jg = (a, b, fase, v) => ({time_a_id: a, time_b_id: b, fase, vencedor_id: v})
  ok(pr(4, [jg('t0', 't1', 'semifinal', 't0'), jg('t2', 't3', 'semifinal', null)]).pendente === 1, 'fase com jogo sem vencedor: aguarda')
  r = pr(4, [jg('t0', 't1', 'semifinal', 't0'), jg('t2', 't3', 'semifinal', 't3')]); ok(r.fase === 'final' && usados(r) === 't0,t3', 'vencedores seguem para a final')
  r = pr(3, [jg('t0', 't1', 'semifinal', 't1')]); ok(r.fase === 'final' && usados(r) === 't1,t2', 'quem folgou entra na final')
  ok(pr(4, [jg('t0', 't1', 'semifinal', 't0'), jg('t2', 't3', 'semifinal', 't3'), jg('t0', 't3', 'final', 't3')]).campeao === 't3', 'final decidida: campeão')
  r = pr(5, [jg('t0', 't1', 'quartas', 't0'), jg('t2', 't3', 'quartas', 't2')]); ok(r.fase === 'semifinal' && r.jogos.length === 1 && r.folga, '5 times: quartas, depois semifinal com folga')
  console.log('ok: telas do campeonato escolar (público, Secretaria e professor)')
})()

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
  esc_times: [{id: 'a', turma_id: 't1', modalidade_id: 'm1', genero: 'masculino', nome: 'Time A'}, {id: 'b', turma_id: 't1', modalidade_id: 'm1', genero: 'masculino', nome: 'Time B'}],
  esc_jogadores: [{id: 'j1', time_id: 'a', nome: 'Aluno <i>1</i>'}],
  esc_partidas: [{id: 'p1', turma_id: 't1', modalidade_id: 'm1', genero: 'masculino', time_a_id: 'a', time_b_id: 'b', placar_a: 2, placar_b: 2, penaltis_a: 4, penaltis_b: 3, vencedor_id: 'a', fase: 'final', colete_a: 'azul'}],
  perfis: [{papel: 'secretaria'}],
}
const rpcs = {esc_juiz_link: 'JUIZTOK', esc_juiz_valido: 'c1', esc_links_times: [{time_id: 'a', token: TOK, professor: 'Maria da Silva'}, {time_id: 'b', token: '22222222-2222-4222-8222-222222222222', professor: null}], esc_meu_time: [{time_id: 'a', time_nome: 'Time A', turma_nome: '1º ano 01', modalidade_nome: 'Futsal', genero: 'masculino', vagas: 10, inscricoes_abertas: true, professor: null}]}

function roda(arquivos, {logado}) {
  const els = {}, el = () => ({innerHTML: '', textContent: '', classList: {add() {}, remove() {}}, addEventListener() {}})
  const builder = r => { const b = new Proxy({}, {get: (_, k) => k === 'then' ? f => Promise.resolve({data: r, error: null}).then(f) : () => b}); return b }
  const sb = {auth: {getSession: async () => ({data: {session: logado ? {user: {id: 'u'}} : null}}), signOut: async () => {}, signInWithPassword: async () => ({})},
    from: t => builder(rows[t]), rpc: n => builder(rpcs[n])}
  const ctx = vm.createContext({crypto: require('crypto').webcrypto, console, setTimeout, clearTimeout, setInterval: () => 0, URL, URLSearchParams, encodeURIComponent, confirm: () => true, navigator: {},
    location: {href: 'https://x.test/escola.html', search: '?t=' + TOK}, supabase: {createClient: () => sb},
    document: {querySelector: s => els[s] ??= el(), querySelectorAll: () => [], addEventListener() {}}})
  for (const f of arquivos) vm.runInContext(read(f), ctx, {filename: f})
  els.__ctx = ctx
  return els
}

;(async () => {
  let els = roda(['js/config.js', 'js/escola.js'], {logado: false}); await espera()
  let h = els['#app'].innerHTML
  ok(h.includes('II Jogos Escolares Internos') && h.includes('1º ano 01') && h.includes('Time A'), 'público vê campeonato, turma e times')
  ok(h.includes('campeão: Time A') && h.includes('pên. 4 x 3'), 'campeão = vencedor da final, com pênaltis')
  ok(h.includes('azul') && h.includes('vermelho'), 'mostra os coletes dos dois lados')
  ok(h.includes('Aluno &lt;i&gt;1&lt;/i&gt;') && h.includes('Quadra &lt;b&gt;x&lt;/b&gt;') && !h.includes('<i>1</i>'), 'nomes e textos do banco são escapados (sem HTML injetado)')
  ok(h.includes('Sou da Secretaria') && !h.includes('Painel da Secretaria') && !h.includes('data-form="placar"') && !h.includes(TOK), 'público não vê painel, edição de placar nem link do professor')
  ok(h.includes('Resultados') && h.includes('Jogos a jogar') && h.includes('data-act="fm"') && !h.includes('JUIZTOK'), 'portal público lista os jogos (a jogar e resultados), com filtro, sem o link do juiz')
  ok(h.includes('Respons') && h.includes('Prof. Carlos &lt;b&gt;') && h.includes('marcas/escola/c1/logo.png') && h.includes('class="sponsors"') && h.includes('Mercado Bom') && h.includes('<b>Sem Logo</b>'), 'portal mostra logo, responsável (escapado) e patrocinadores')
  els = roda(['js/config.js', 'js/escola.js'], {logado: true}); await espera(); h = els['#app'].innerHTML; const ctxEscola = els.__ctx
  ok(h.includes('Painel da Secretaria') && h.includes('data-form="placar"') && h.includes('professor.html?t=' + TOK), 'Secretaria vê painel, edita placar e pega o link do professor')
  ok(h.includes('wa.me/?text='), 'link do professor pode ir por WhatsApp')
  ok(h.includes('Professor: Maria da Silva') && h.includes('professor ainda não preencheu') && h.includes('1 de 2 com professor responsável'), 'Secretaria vê quem é o professor de cada time e quem falta')
  const pos = t => h.indexOf(t + ' <small class="sub">'); ok(pos('2º ano') > 0 && pos('2º ano') < pos('9º ano') && pos('9º ano') < pos('6ª etapa / 7º ano - EJAI'), 'séries em ordem numérica (1º ao 9º ano, depois EJAI), não alfabética')
  ok(h.includes('class="resumo"') && h.includes('professores responsáveis'), 'painel mostra o resumo (séries, times, professores, alunos, jogos)')
  ok(h.includes('Sorteio dos jogos') && !h.includes('data-form="partida"') && h.includes('campeão: Time A'), 'jogos são sorteados pelo sistema (sem escolher confronto à mão)')
  ok(h.includes('Séries (grupos)') && h.includes('name="origem"') && h.includes('1º ano 02'), 'time nasce de uma turma de origem dentro da série')
  ok(h.includes('data-form="identidade"') && h.includes('name="logo"') && h.includes('name="sp0"') && h.includes('data-act="addpat"') && h.includes('name="responsavel"'), 'Secretaria edita logo, responsável e patrocinadores')
  ok(h.includes('juiz.html?t=JUIZTOK') && h.includes('Link do juiz'), 'Secretaria pega o link do juiz')
  els = roda(['js/config.js', 'js/juiz.js'], {logado: false}); await espera(); h = els['#app'].innerHTML
  ok(h.includes('Mesa do juiz') && h.includes('name="pa"') && h.includes('name="ea"') && h.includes('Corrigir resultado'), 'juiz vê os jogos com campos de placar e pênaltis')
  els = roda(['js/config.js', 'js/professor.js'], {logado: false}); await espera(); h = els['#app'].innerHTML
  ok(h.includes('Time A') && h.includes('1 de 10') && h.includes('Inscrever aluno') && h.includes('Aluno &lt;i&gt;1&lt;/i&gt;'), 'professor vê o time, as vagas e o formulário')
  ok(h.includes('Professor responsável') && h.includes('name="prof"'), 'professor sem nome cadastrado vê o campo para preencher')
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

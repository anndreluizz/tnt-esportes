// node checar-escola.js — abre as telas do campeonato escolar (escola.html e professor.html) com um banco de mentira
// e confere o que aparece para o público, para a Secretaria e para o professor. As regras do banco ficam em supabase/testar-turmas.mjs.
const fs = require('fs'), vm = require('vm')
const read = f => fs.readFileSync(__dirname + '/' + f, 'utf8')
const ok = (c, m) => { if (!c) { console.error('FALHOU:', m); process.exit(1) } }
const espera = () => new Promise(r => setTimeout(r, 30))

const TOK = '11111111-1111-4111-8111-111111111111'
const rows = {
  esc_campeonatos: [{id: 'c1', nome: 'Interclasse 2026', inicio: '2026-12-07', fim: '2026-12-09', local: 'Quadra <b>x</b>', inscricoes_abertas: true}],
  esc_modalidades: [{id: 'm1', campeonato_id: 'c1', nome: 'Futsal', jogadores_por_time: 5, reservas_max: 5}, {id: 'm2', campeonato_id: 'c1', nome: 'Queimada', jogadores_por_time: 10, reservas_max: 0}],
  esc_turmas: [{id: 't1', campeonato_id: 'c1', nome: '1º ano 01'}],
  esc_times: [{id: 'a', turma_id: 't1', modalidade_id: 'm1', genero: 'masculino', nome: 'Time A'}, {id: 'b', turma_id: 't1', modalidade_id: 'm1', genero: 'masculino', nome: 'Time B'}],
  esc_jogadores: [{id: 'j1', time_id: 'a', nome: 'Aluno <i>1</i>'}],
  esc_partidas: [{id: 'p1', turma_id: 't1', modalidade_id: 'm1', genero: 'masculino', time_a_id: 'a', time_b_id: 'b', placar_a: 2, placar_b: 2, penaltis_a: 4, penaltis_b: 3, vencedor_id: 'a', fase: 'final', colete_a: 'azul'}],
  perfis: [{papel: 'secretaria'}],
}
const rpcs = {esc_links_times: [{time_id: 'a', token: TOK}], esc_meu_time: [{time_id: 'a', time_nome: 'Time A', turma_nome: '1º ano 01', modalidade_nome: 'Futsal', genero: 'masculino', vagas: 10, inscricoes_abertas: true}]}

function roda(arquivos, {logado}) {
  const els = {}, el = () => ({innerHTML: '', textContent: '', classList: {add() {}, remove() {}}, addEventListener() {}})
  const builder = r => { const b = new Proxy({}, {get: (_, k) => k === 'then' ? f => Promise.resolve({data: r, error: null}).then(f) : () => b}); return b }
  const sb = {auth: {getSession: async () => ({data: {session: logado ? {user: {id: 'u'}} : null}}), signOut: async () => {}, signInWithPassword: async () => ({})},
    from: t => builder(rows[t]), rpc: n => builder(rpcs[n])}
  const ctx = vm.createContext({console, setTimeout, clearTimeout, URL, URLSearchParams, encodeURIComponent, confirm: () => true, navigator: {},
    location: {href: 'https://x.test/escola.html', search: '?t=' + TOK}, supabase: {createClient: () => sb},
    document: {querySelector: s => els[s] ??= el(), querySelectorAll: () => [], addEventListener() {}}})
  for (const f of arquivos) vm.runInContext(read(f), ctx, {filename: f})
  return els
}

;(async () => {
  let els = roda(['js/config.js', 'js/escola.js'], {logado: false}); await espera()
  let h = els['#app'].innerHTML
  ok(h.includes('Interclasse 2026') && h.includes('1º ano 01') && h.includes('Time A'), 'público vê campeonato, turma e times')
  ok(h.includes('campeão: Time A') && h.includes('pên. 4 x 3'), 'campeão = vencedor da final, com pênaltis')
  ok(h.includes('azul') && h.includes('vermelho'), 'mostra os coletes dos dois lados')
  ok(h.includes('Aluno &lt;i&gt;1&lt;/i&gt;') && h.includes('Quadra &lt;b&gt;x&lt;/b&gt;') && !h.includes('<i>1</i>'), 'nomes e textos do banco são escapados (sem HTML injetado)')
  ok(h.includes('Sou da Secretaria') && !h.includes('Painel da Secretaria') && !h.includes('data-form="placar"') && !h.includes(TOK), 'público não vê painel, edição de placar nem link do professor')
  els = roda(['js/config.js', 'js/escola.js'], {logado: true}); await espera(); h = els['#app'].innerHTML
  ok(h.includes('Painel da Secretaria') && h.includes('data-form="placar"') && h.includes('professor.html?t=' + TOK), 'Secretaria vê painel, edita placar e pega o link do professor')
  ok(h.includes('wa.me/?text='), 'link do professor pode ir por WhatsApp')
  els = roda(['js/config.js', 'js/professor.js'], {logado: false}); await espera(); h = els['#app'].innerHTML
  ok(h.includes('Time A') && h.includes('1 de 10') && h.includes('Inscrever aluno') && h.includes('Aluno &lt;i&gt;1&lt;/i&gt;'), 'professor vê o time, as vagas e o formulário')
  console.log('ok: telas do campeonato escolar (público, Secretaria e professor)')
})()

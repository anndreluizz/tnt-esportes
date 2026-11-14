// cd supabase && npm run test:auditoria   (ou: node testar-auditoria-app.mjs)
// A tela Auditoria: o app de verdade (js/app.js + js/api.js) lendo a tabela "auditoria" de um banco local (PGlite) com as regras de acesso reais.
// Confere: só a Secretaria, filtros (campeonato, usuário, tabela, período), paginação sem perder nem repetir registro, nenhum dado pessoal,
// nenhum botão de editar ou excluir, e a mensagem certa quando a migration ainda não foi aplicada. 100% local: sem rede nem Supabase.
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import vm from 'node:vm'
import { criaBanco, semeia, como, dono, q as qq, SEC, ARB, REP, CAMP } from './volume.mjs'

let total = 0, falhas = 0
const ok = (cond, msg) => { total++; if (!cond) { falhas++; console.error('  FALHOU:', msg) } }
const secao = t => console.log('\n' + t)
const db = await criaBanco(), q = (s, p) => qq(db, s, p)
const M = await semeia(db)

// ---- mais registros: edições com dados pessoais (nada disso pode aparecer na tela) e linhas antigas para testar o período ----
await como(db, SEC)
await q(`update campeonatos set patrocinadores = '[{"nome": "Padaria Boa", "logo_path": "x/a.png"}]' where id = $1`, [CAMP])
await q(`update campeonatos set patrocinadores = '[]', responsavel = 'Responsavel Sentinela', responsavel_telefone = '97 90000-1234' where id = $1`, [CAMP])
const alvo = M.at[M.eq[0]][3]
await q(`update atletas set nome = 'Sentinela Pessoal Teste', telefone = '97 91111-5678', endereco = 'Rua Sentinela 1', nascimento = '2010-01-01', aprovado = false where id = $1`, [alvo])
await q(`update atletas set aprovado = true where id = $1`, [alvo])
await q(`update jogos set arbitro_id = null where id = $1`, [M.jogos[119].id])
await q(`update jogos set arbitro_id = $1 where id = $2`, [ARB, M.jogos[119].id])
await dono(db)
const passado = (em, resumo) => db.query(`insert into auditoria (em, usuario_id, usuario_nome, usuario_papel, origem, tabela, operacao, registro_id, campeonato_id, resumo) values ($1, $2, 'Ana Antiga', 'secretaria', 'app', 'campeonatos', 'UPDATE', 'x', $3, $4)`, [em, SEC, CAMP, resumo])
await passado('2026-02-01T00:00:00-04:00', 'Início do dia 01/02'); await passado('2026-02-01T23:59:00-04:00', 'Fim do dia 01/02'); await passado('2026-02-02T00:00:00-04:00', 'Início do dia 02/02'); await passado('2026-01-31T23:59:00-04:00', 'Fim do dia 31/01')
const TOTAL = (await q(`select count(*)::int c from auditoria`))[0].c

// ---- o app, em um sandbox ----
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8')
const vazio = () => { const ch = { select: () => ch, eq: () => ch, order: () => ch, limit: () => ch, range: () => ch, is: () => ch, then: (f, g) => Promise.resolve({ data: [], error: null, count: 0 }).then(f, g) }; return ch }
const novoApp = async modoOficial => {
  const el = () => ({ innerHTML: '', className: '', hidden: false, value: '', classList: { add() {}, remove() {}, toggle() {} }, replaceChildren() {} }), els = {}
  const ctx = vm.createContext({ crypto: webcrypto, TextEncoder, console, setInterval() {}, setTimeout, clearTimeout, scrollTo() {}, print() {}, SUPABASE_URL: 'http://localhost', SUPABASE_KEY: 'x', addEventListener() {},
    supabase: { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) }, from: vazio, storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }) }) } }) },
    localStorage: { getItem: () => null, setItem() {} }, navigator: { onLine: true }, location: { protocol: 'file:', hash: '' },
    document: { documentElement: { dataset: modoOficial ? { mode: 'real' } : {} }, querySelector: s => els[s] ??= el(), querySelectorAll: () => [], getElementById: () => null, addEventListener() {}, body: el(), fonts: { load: () => Promise.resolve() },
      createElement: () => ({ getContext: () => new Proxy({}, { get: (t, k) => k === 'measureText' ? () => ({ width: 0 }) : /Gradient$/.test(k) ? () => ({ addColorStop() {} }) : () => {}, set: () => true }) }) } })
  for (const f of ['js/regras.js', 'js/dados.js', 'js/app.js', 'js/api.js']) vm.runInContext(read(f), ctx, { filename: f })
  await new Promise(r => setTimeout(r, 30))   // deixa o startReal do modo oficial terminar
  return { ctx, els, run: c => vm.runInContext(c, ctx) }
}

// cliente Supabase de mentira que executa a consulta de verdade no banco local, no perfil indicado (assim a RLS real decide o que aparece)
const sbSql = uid => ({ from: t => {
  const st = { w: [], p: [], o: [], de: 0, ate: 0, cont: false }
  const ch = {
    select: (c, o) => { st.cont = o?.count === 'exact'; return ch },
    eq: (c, v) => { st.p.push(v); st.w.push(`${c} = $${st.p.length}`); return ch }, is: (c, v) => { st.w.push(`${c} is ${v === null ? 'null' : v}`); return ch },
    gte: (c, v) => { st.p.push(v); st.w.push(`${c} >= $${st.p.length}::timestamptz`); return ch }, lt: (c, v) => { st.p.push(v); st.w.push(`${c} < $${st.p.length}::timestamptz`); return ch },
    order: (c, o) => { st.o.push(`${c} ${o?.ascending === false ? 'desc' : 'asc'}`); return ch }, range: (a, b) => { st.de = a; st.ate = b; return ch },
    then: (f, g) => (async () => {
      try {
        await como(db, uid)
        const onde = st.w.length ? ' where ' + st.w.join(' and ') : ''
        const data = (await db.query(`select to_jsonb(x) j from (select * from ${t}${onde}${st.o.length ? ' order by ' + st.o.join(', ') : ''} offset ${st.de} limit ${st.ate - st.de + 1}) x`, st.p)).rows.map(r => r.j)
        const count = st.cont ? (await db.query(`select count(*)::int c from ${t}${onde}`, st.p)).rows[0].c : null
        return { data, count, error: null }
      } catch (e) { return { data: null, count: null, error: { code: e.code, message: e.message } } } finally { await dono(db) }
    })().then(f, g) }
  return ch }, storage: { from: () => ({}) } })
const sbErro = (code, message) => ({ from: () => ({ select() { return this }, eq() { return this }, is() { return this }, gte() { return this }, lt() { return this }, order() { return this }, range() { return this },
  then: (f, g) => Promise.resolve({ data: null, count: null, error: { code, message } }).then(f, g) }), storage: { from: () => ({}) } })
const sbFixo = rows => ({ from: () => ({ select() { return this }, eq() { return this }, is() { return this }, gte() { return this }, lt() { return this }, order() { return this }, range() { return this },
  then: (f, g) => Promise.resolve({ data: rows, count: rows.length, error: null }).then(f, g) }), storage: { from: () => ({}) } })

const perfis = await q(`select id, nome, papel::text papel from perfis order by nome`)
const abre = async (ctxApp, sb, sessao) => {   // abre a tela Auditoria como o app faz: troca de aba + render (que dispara a leitura)
  const { ctx, run } = ctxApp
  ctx.__sb = sb; ctx.__perfis = perfis
  run(`sb = __sb; S.session = ${JSON.stringify(sessao)}; S.champs = []; S.perfis = ${JSON.stringify(sessao.role === 'secretaria' ? perfis : [])}; ui.aud = null`)
  if (sessao.role !== 'secretaria') { run('render = () => {}'); await run('(ui.aud = audNovo(), carregaAuditoria())'); return }   // sem tela: só a consulta (a tela é da Secretaria)
  run(`ui.tab = 'auditoria'; render()`)
  for (let i = 0; i < 200 && run('!ui.aud || ui.aud.linhas === null || ui.aud.carregando'); i++) await new Promise(r => setTimeout(r, 5))
}
const pagina = ctxApp => ctxApp.els['#app'].innerHTML
const sec = { role: 'secretaria', uid: SEC, name: 'Secretaria Teste' }

secao('Acesso: só a Secretaria, só no sistema oficial')
const demo = await novoApp(false), real = await novoApp(true)
ok(!demo.run('ROLE_TABS.secretaria.some(t => t[0] === "auditoria")'), 'no modo de demonstração (sem banco) a aba Auditoria não existe')
ok(real.run('ROLE_TABS.secretaria.some(t => t[0] === "auditoria")') && ['arbitro', 'equipe', 'publico'].every(r => !real.run(`ROLE_TABS.${r}.some(t => t[0] === "auditoria")`)), 'no sistema oficial só a Secretaria tem a aba Auditoria (árbitro, equipe e público não têm)')
ok(real.run('GRUPOS.some(g => g[2].includes("auditoria"))'), 'a aba está no menu "Mais" da Secretaria')
for (const r of ['arbitro', 'equipe', 'publico']) { real.run(`S.session = {role: '${r}', uid: 'u'}`); ok(real.run('VIEWS.auditoria()') === '', `a tela devolve vazio para ${r} (defesa extra, além do menu)`) }
// árbitro e representante tentando abrir a tela mesmo assim: o app volta para a primeira aba deles
real.run(`S.session = {role: 'arbitro', uid: '${ARB}', name: 'Arbitro'}; S.champs = []; ui.tab = 'auditoria'`)
try { real.run('render()') } catch {}
ok(real.run('ui.tab') !== 'auditoria', 'árbitro que força a aba Auditoria é levado de volta para as telas dele')
// o banco também barra: o que o árbitro, o representante e o visitante recebem são 0 linhas / negado
for (const [nome, uid, papel] of [['árbitro', ARB, 'arbitro'], ['representante', REP, 'equipe'], ['visitante', null, 'publico']]) {
  const app = await novoApp(true); await abre(app, sbSql(uid), { role: papel, uid })
  ok(app.run('ui.aud.total') === 0 && app.run('(ui.aud.linhas || []).length') === 0, `${nome} que consulte direto a auditoria recebe 0 registros (RLS do banco)`)
}

secao('Primeira página, ordem e totais')
const A = await novoApp(true); await abre(A, sbSql(SEC), sec)
ok(A.run('ui.aud.total') === TOTAL && A.run('ui.aud.linhas.length') === 25, `a Secretaria vê ${TOTAL} registros no total e 25 na primeira página`)
const dsc = (await q(`select id from auditoria order by em desc, id desc limit 25`)).map(r => r.id)
ok(JSON.stringify(A.run('ui.aud.linhas.map(r => r.id)')) === JSON.stringify(dsc), 'os registros vêm do mais novo para o mais antigo')
ok(/Página 1 de \d+ · \d+ registros/.test(pagina(A)) && /Auditoria de alterações/.test(pagina(A)) && /não podem ser editados nem excluídos/.test(pagina(A)), 'a página mostra título, aviso de somente leitura e "Página 1 de N"')
ok(/data-act="audpag" data-d="-1" disabled/.test(pagina(A)) && !/data-act="audpag" data-d="1" disabled/.test(pagina(A)), 'na primeira página só o botão "Anterior" fica desativado')

secao('Paginação: percorre tudo, sem perder nem repetir')
const vistos = []
for (let pg = 0; ; pg++) {
  A.run(`ui.aud.pg = ${pg}; ui.aud.linhas = null; render()`)
  for (let i = 0; i < 200 && A.run('ui.aud.linhas === null || ui.aud.carregando'); i++) await new Promise(r => setTimeout(r, 5))
  vistos.push(...A.run('ui.aud.linhas.map(r => r.id)'))
  if ((pg + 1) * 25 >= TOTAL) break
}
const todos = (await q(`select id from auditoria order by em desc, id desc`)).map(r => r.id)
ok(vistos.length === TOTAL && new Set(vistos).size === TOTAL && JSON.stringify(vistos) === JSON.stringify(todos), `as ${Math.ceil(TOTAL / 25)} páginas juntas têm exatamente os ${TOTAL} registros, uma vez cada, na ordem do banco`)
ok(/data-act="audpag" data-d="1" disabled/.test(pagina(A)) && !/data-act="audpag" data-d="-1" disabled/.test(pagina(A)), 'na última página só o botão "Próxima" fica desativado')
// ação de página: Próxima / Anterior e limite (nunca abaixo da primeira)
A.run(`ui.aud.pg = 0; A.audpag({d: '-1'})`); ok(A.run('ui.aud.pg') === 0, 'o botão Anterior na primeira página não anda para trás')
A.run(`A.audpag({d: '1'})`); ok(A.run('ui.aud.pg') === 1 && A.run('ui.aud.linhas') === null, 'o botão Próxima vai para a página 2 e pede nova leitura')
// página que deixou de existir (ex.: filtro novo com menos registros): cai na última
A.run(`ui.aud = {...audNovo(), pg: 99}; render()`)
for (let i = 0; i < 200 && A.run('ui.aud.linhas === null || ui.aud.carregando'); i++) await new Promise(r => setTimeout(r, 5))
ok(A.run('ui.aud.pg') === Math.ceil(TOTAL / 25) - 1 && A.run('ui.aud.linhas.length') > 0, 'página inexistente volta sozinha para a última')

secao('Filtros: campeonato, usuário, tabela e período')
const filtra = async f => {
  A.run(`F.auditoria(${JSON.stringify(f)}); render()`)
  for (let i = 0; i < 200 && A.run('ui.aud.linhas === null || ui.aud.carregando'); i++) await new Promise(r => setTimeout(r, 5))
  return { total: A.run('ui.aud.total'), ids: A.run('ui.aud.linhas.map(r => r.id)'), linhas: A.run('ui.aud.linhas') }
}
const conta = async (onde, p) => (await q(`select count(*)::int c from auditoria where ${onde}`, p))[0].c
let r = await filtra({ camp: CAMP }); ok(r.total === await conta('campeonato_id = $1', [CAMP]) && r.linhas.every(x => x.campeonato_id === CAMP), 'filtro por campeonato')
r = await filtra({ usuario: SEC }); ok(r.total === await conta('usuario_id = $1', [SEC]) && r.linhas.every(x => x.usuario_id === SEC), 'filtro por usuário (Secretaria)')
r = await filtra({ usuario: ARB }); ok(r.total === await conta('usuario_id = $1', [ARB]) && r.total >= 0, 'filtro por usuário (árbitro): só o que ele fez')
r = await filtra({ usuario: 'sem' }); ok(r.total === await conta('usuario_id is null', []) && r.total > 0 && r.linhas.every(x => x.usuario_id === null), 'filtro "sem usuário" (administrador, rotina ou visitante)')
r = await filtra({ tabela: 'atletas' }); ok(r.total === await conta(`tabela = 'atletas'`, []) && r.linhas.every(x => x.tabela === 'atletas'), 'filtro por tabela (atletas)')
r = await filtra({ tabela: 'jogos' }); ok(r.total === await conta(`tabela = 'jogos'`, []) && r.total >= 2, 'filtro por tabela (jogos = troca de árbitro)')
r = await filtra({ de: '2026-02-01', ate: '2026-02-01' }); ok(r.total === 2 && r.linhas.map(x => x.resumo).sort().join() === 'Fim do dia 01/02,Início do dia 01/02', 'período de 1 dia (01/02): pega 00:00 e 23:59 de Manaus, e deixa o dia anterior e o seguinte de fora')
r = await filtra({ de: '2026-02-02', ate: '2026-02-02' }); ok(r.total === 1 && r.linhas[0].resumo === 'Início do dia 02/02', 'período do dia seguinte (02/02)')
r = await filtra({ de: '2026-01-31', ate: '2026-02-01' }); ok(r.total === 3, 'período de 31/01 a 01/02: 3 registros')
r = await filtra({ de: '2026-02-02' }); ok(r.total === await conta(`em >= '2026-02-02T00:00:00-04:00'`, []), 'só "de": tudo a partir do dia')
r = await filtra({ ate: '2026-01-31' }); ok(r.total === 1 && r.linhas[0].resumo === 'Fim do dia 31/01', 'só "até": tudo até o fim do dia')
r = await filtra({ de: '2030-01-01', ate: '2030-12-31' }); ok(r.total === 0 && /Nenhum registro encontrado/.test(pagina(A)), 'período sem registros: mostra "Nenhum registro encontrado com estes filtros"')
r = await filtra({ camp: CAMP, usuario: SEC, tabela: 'campeonatos', de: '2026-01-01', ate: '2026-02-28' }); ok(r.total === 4, 'filtros combinados (campeonato + usuário + tabela + período)')
// período invertido é recusado e não muda a tela
A.run(`ui.aud = {...audNovo(), f: {camp: '', usuario: '', tabela: 'equipes', de: '', ate: ''}}`)
A.run(`F.auditoria({camp: '', usuario: '', tabela: '', de: '2026-03-10', ate: '2026-03-01'})`)
ok(A.run('ui.aud.f.tabela') === 'equipes' && A.run('ui.aud.f.de') === '', 'data inicial depois da final é recusada e os filtros anteriores ficam')
A.run(`A.audlimpa()`); ok(A.run('ui.aud.f.tabela') === '' && A.run('ui.aud.pg') === 0, '"Limpar filtros" volta ao começo')
r = await filtra({}); ok(r.total === TOTAL, 'sem filtros volta a mostrar tudo')

secao('Conteúdo: detalhes úteis e nenhum dado pessoal')
const htmlTodo = []
A.run(`F.auditoria({})`)
for (let pg = 0; pg * 25 < TOTAL; pg++) {
  A.run(`ui.aud.pg = ${pg}; ui.aud.linhas = null; render()`)
  for (let i = 0; i < 200 && A.run('ui.aud.linhas === null || ui.aud.carregando'); i++) await new Promise(r => setTimeout(r, 5))
  htmlTodo.push(pagina(A))
}
const H = htmlTodo.join('\n')
const nomes = await q(`select nome from atletas`)
ok(nomes.every(a => !H.includes(a.nome)), `nenhum dos ${nomes.length} nomes de atletas aparece em nenhuma das ${htmlTodo.length} páginas`)
const sentinelas = ['Sentinela Pessoal', '97 91111-5678', 'Rua Sentinela', '2010-01-01', 'Responsavel Sentinela', '97 90000-1234', '.jpg', 'foto']
ok(sentinelas.every(s => !H.includes(s)), 'telefone, endereço, nascimento, responsável, fotos e nome editados pela Secretaria não aparecem na tela')
ok(/Atleta aprovado: equipe Equipe 01, camisa \d+/.test(H) && /Aprovação do atleta retirada: equipe Equipe 01/.test(H), 'a tela mostra o resumo ("Atleta aprovado: equipe Equipe 01, camisa N") sem nome')
ok(H.includes('Secretaria Teste (secretaria)') && /Administrador do banco/.test(H) && /\d{2}\/\d{2}\/\d{4}/.test(H), 'mostra o responsável (nome e papel), "Administrador do banco" quando não há usuário, e a data')
ok(/Patrocinadores<\/b>: \[\{&quot;nome&quot;:&quot;Padaria Boa&quot;,&quot;logo_path&quot;:&quot;x\/a\.png&quot;\}\] → \[\]/.test(H), 'os detalhes mostram patrocinadores antes → depois (a lista que foi esvaziada)')
ok(/Telefone<\/b>|telefone<\/b>: alterado <span class="sub">\(valor não exibido/.test(H) || /<b>telefone<\/b>: alterado/.test(H), 'campo pessoal alterado aparece só como "alterado (valor não exibido: dado pessoal)"')
ok(/Aprovado<\/b>: não → sim/.test(H), 'aprovação aparece como "Aprovado: não → sim"')
ok(/Árbitro<\/b>:/.test(H) && /Jogo \(árbitro\)/.test(H), 'a troca de árbitro aparece com a tabela "Jogo (árbitro)"')
ok(/<form[^>]*data-form="auditoria"[^>]*data-etapas="nao"/.test(H), 'o formulário de filtros não é dividido em etapas pelo assistente do app (etapas.js dividiria um formulário com mais de 2 campos em "Etapa 1 de 3 / Próximo")')
ok(['camp', 'usuario', 'tabela'].every(n => new RegExp('<select name="' + n + '" data-et-chips>').test(H)), 'os seletores de filtro ficam como lista (o assistente de etapas não os troca por botões que escondem a opção "Todas")')
// nenhuma ação de editar ou excluir na tela
const acoes = [...new Set([...H.matchAll(/data-act="([a-z]+)"/g)].map(m => m[1]))].sort().join()
ok(acoes === 'audlimpa,audpag,tab', `as únicas ações são paginar, limpar filtros e navegar entre abas (encontradas: ${acoes})`)
ok(!/<form[^>]*data-form="(?!auditoria")/.test(H) && (H.match(/data-form="([a-z]+)"/g) || []).every(x => x === 'data-form="auditoria"') && !/(excluir|apagar|editar|remover)<\/button>/i.test(H), 'o único formulário é o de filtros, e não há botão de editar, excluir, apagar nem remover')
// defesa: linha adulterada (valor de coluna pessoal, HTML no texto) não vaza nem executa
const adulterada = [{ id: 1, em: '2026-05-05T12:00:00Z', usuario_id: SEC, usuario_nome: '<b>Ana</b>', usuario_papel: 'secretaria', origem: 'app', tabela: 'atletas', operacao: 'UPDATE', registro_id: 'x', campeonato_id: null,
  resumo: '<img src=x onerror=alert(1)>', alteradas: ['nome', 'numero', 'telefone'], antes: { nome: 'Fulano Secreto', numero: 7, telefone: '97 9 SEGREDO' }, depois: { nome: 'Ciclano Secreto', numero: 8, telefone: '97 9 SEGREDO2' } }]
const B = await novoApp(true); await abre(B, sbFixo(adulterada), sec)
const hb = pagina(B)
ok(!/<img/.test(hb) && hb.includes('&lt;img src=x onerror=alert(1)&gt;') && !/<b>Ana<\/b>/.test(hb), 'texto com HTML é escapado (sem injeção)')
ok(!hb.includes('Fulano Secreto') && !hb.includes('Ciclano Secreto') && !hb.includes('SEGREDO') && /Camisa<\/b>: 7 → 8/.test(hb), 'mesmo se o banco guardasse nome ou telefone de atleta, a tela só mostra os campos permitidos (camisa sim, nome e telefone não)')

secao('Mensagens quando não dá para ler')
for (const [code, msg] of [['42P01', 'relation "auditoria" does not exist'], ['PGRST205', "Could not find the table 'public.auditoria' in the schema cache"]]) {
  const E = await novoApp(true); await abre(E, sbErro(code, msg), sec)
  ok(/ainda não foi ativada no banco/.test(pagina(E)) && !/Não foi possível ler/.test(pagina(E)), `migration ainda não aplicada (${code}): mensagem clara, sem quebrar a tela`)
}
const E2 = await novoApp(true); await abre(E2, sbErro('XX000', 'falha qualquer'), sec)
ok(/Não foi possível ler a auditoria: falha qualquer/.test(pagina(E2)), 'outro erro do banco aparece como "Não foi possível ler a auditoria"')

secao('A tela não altera o banco')
await dono(db)
ok((await q(`select count(*)::int c from auditoria`))[0].c === TOTAL, 'depois de tudo isso, a auditoria tem os mesmos registros (a tela só lê)')

console.log(falhas ? `\n${falhas} de ${total} verificações da tela falharam` : `\nok: ${total} verificações da tela de auditoria`)
process.exit(falhas ? 1 : 0)

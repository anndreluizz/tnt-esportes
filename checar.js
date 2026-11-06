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
for (const f of ['js/regras.js', 'js/dados.js', 'js/app.js']) vm.runInContext(read(f), ctx, {filename: f})
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
  ok(run(`sameSet(drawGroups(C().teams, C().draw.seed).A, ['rsf','atc','unb','est'])`), 'semente refaz os grupos')
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
  await run('A.commit()'); run('A.dodraw()'); await run('A.reveal()'); run('A.applydraw()')
  ok(run('C().status') === 'andamento' && run('C().matches.length') === 16, 'sorteio aplicado: 12 jogos de grupo + 4 do mata-mata')
  await allViews()
  console.log('ok: regras, mata-mata, sorteio e todas as telas')
})()

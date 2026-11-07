// Dados de exemplo: times, atletas e resultados fictícios, para demonstração.

const SEC = 'Secretaria (Ana Souza)', REFEREE = 'Árbitro João Paulo'
const BAIRROS = ['Centro', 'Beira Rio', 'São Francisco', 'Vila Nova', 'Bairro Novo', 'Comunidade ribeirinha']

function seed() {
  return {v: 3, champs: [seedFutsal(), seedSub15()], champId: 'futsal26', offline: false, session: null}
}

function champBase(o) { return {teams: [], players: [], matches: [], punishments: [], draw: null, log: [], status: 'inscricoes', ...o} }
const code = (id, i) => id.slice(0, 3).toUpperCase() + '-' + (4821 + i * 1373) % 9000

function seedFutsal() {
  const c = champBase({id: 'futsal26', name: 'Copa Municipal de Futsal 2026', sport: 'Futsal', category: 'Livre', minAge: 15, maxAge: null,
    start: '2026-10-24', venue: 'Quadra Poliesportiva Municipal', status: 'andamento'})
  c.teams = [['rsf','Real São Francisco','A',1],['atc','Atlético Centro','A',1],['unb','Unidos da Beira','A',2],['est','Estrela do Solimões','A',2],
             ['gre','Grêmio Ribeirinho','B',1],['juv','Juventude FC','B',1],['tjr','Tonantins Jr.','B',2],['svi','Santos da Vila','B',2]]
    .map(([id, name, group, pot], i) => ({id, name, group, pot, code: code(id, i), bairro: BAIRROS[i % 6]}))
  const roster = {
    rsf:'Luan 10,Renan 7,Diego 4,Marcos 1,Thiago 8,Felipe 11', atc:'Jonas 9,Caio 5,Bruno 1,Igor 7,Wesley 10,Mateus 3',
    unb:'Pedro 10,Alan 6,Davi 1,Kauã 8,Erick 4,Samuel 11',    est:'Ruan 9,Cleiton 6,Gabriel 5,Lucas 1,Vitor 10,Nilson 7',
    gre:'Rafael 11,Josué 8,Elias 1,Paulo 4,Hugo 10,Breno 7',  juv:'Matheus 9,André 10,Sérgio 1,Leandro 6,Danilo 4,Fábio 8',
    tjr:'Kevin 10,Yuri 7,Arthur 1,Enzo 5,Raí 9,Henrique 3',   svi:'Cauã 10,Ítalo 7,Rodrigo 1,Miguel 8,Heitor 11,Wallace 5'}
  const minors = {'tjr Enzo':'2012-05-20', 'svi Miguel':'2009-08-02', 'svi Heitor':'2010-02-14'}   // pendências de exemplo
  Object.entries(roster).forEach(([team, list], ti) => list.split(',').forEach((s, i) => {
    const [name, num] = s.split(' '), m = minors[team + ' ' + name]
    c.players.push({id: `p${c.players.length + 1}`, team, name, num: +num, birth: m || `${1992 + (i * 7 + ti * 3) % 12}-0${1 + (i + ti) % 9}-1${i}`,
      auth: !m, approved: true, consent: true, photo: null, bairro: BAIRROS[(i + ti) % 6]})
  }))
  // ordem escolhida para as rodadas baterem com os resultados abaixo
  c.matches = buildFixtures(c, {A: ['rsf','est','unb','atc'], B: ['juv','svi','gre','tjr']}, c.start)
  const results = {   // por par de equipes; cada evento: tipo time atleta
    'atc-rsf': 'g rsf Luan|y rsf Diego|g rsf Luan|g atc Jonas|f atc|g rsf Renan',
    'est-unb': 'g unb Pedro|g est Ruan|y est Cleiton|g unb Pedro|g est Vitor',
    'juv-tjr': 'g juv Matheus|f tjr',
    'gre-svi': 'g gre Rafael|g svi Cauã|g gre Rafael|g svi Cauã|g gre Josué|g svi Ítalo',
    'rsf-unb': 'g rsf Luan|g unb Pedro|y rsf Diego|g unb Kauã|g rsf Thiago',
    'atc-est': 'g atc Jonas|g est Ruan|g atc Jonas|r est Cleiton|g atc Wesley|g atc Caio',
    'gre-juv': 'g gre Rafael|g juv André|g gre Rafael|g juv Matheus|g gre Hugo',
    'svi-tjr': 'g tjr Kevin|g tjr Yuri'}
  const pid = (team, name) => c.players.find(p => p.team === team && p.name === name).id
  const kind = {g: 'gol', y: 'amarelo', r: 'vermelho', f: 'falta'}
  for (const m of c.matches) {
    const evs = m.phase === 'grupos' && results[[m.home, m.away].sort().join('-')]
    if (!evs) continue
    m.events = evs.split('|').map((e, k) => { const [t, team, n] = e.split(' '), min = 2 + k * 6
      return {id: `${m.id}e${k}`, type: kind[t], team, player: n ? pid(team, n) : null, min, half: min > 20 ? 2 : 1, sent: true} })
    m.status = 'encerrado'; m.sample = true
    const [h, a] = score(m)
    const e = {at: `${m.date}T${+m.time.slice(0, 2) + 1}:05:00`, who: REFEREE, what: `Súmula confirmada: ${T(c, m.home).name} ${h} × ${a} ${T(c, m.away).name}`}
    c.log.unshift(e); m.history.push(e)
  }
  // registro do sorteio feito antes da competição; final = sha256(semente + entrada).slice(0,16), conferível no portal
  const final = '38b89e91108af4c7'
  c.draw = {seed: '92f50b21f7502dcf', entrada: '07 21 33', final, hash: 'd17c636c6f85ff3ac3c90d620e296900adc007d14e3959a125a7728fcbc176ff', groups: drawGroups(c.teams, final), at: '2026-10-10T10:00:00'}
  c.log.push({at: c.draw.at, who: SEC, what: `Sorteio dos grupos realizado. Semente revelada: ${c.draw.seed} · entrada pública: ${c.draw.entrada}`})
  return c
}

function seedSub15() {
  const c = champBase({id: 'sub15', name: 'Copa Sub-15 de Futebol Society', sport: 'Futebol society', category: 'Sub-15', minAge: 13, maxAge: 15,
    start: '2026-11-28', venue: 'Campo do Bairro Novo'})
  c.teams = ['Escolinha Beira Rio','Atlético Mirim','Unidos Sub-15','Pequenos do Solimões','Juventude Mirim','EC Vila Nova','Real Mirim','Ribeirinho Sub-15']
    .map((name, i) => ({id: `s${i + 1}`, name, group: null, pot: i < 4 ? 1 : 2, code: code('s' + name.replace(/\W/g, ''), i), bairro: BAIRROS[i % 6]}))
  const first = ['Arthur','Bernardo','Davi','Gael','Heitor','Isaac','João','Kauê','Lorenzo','Miguel','Nicolas','Otávio','Pietro','Ravi','Samuel','Theo','Vicente','Benício','Caleb','Emanuel','Gustavo','Henry','Joaquim','Levi','Murilo','Noah','Pedro','Rael','Tomás','Yago']
  const last = ['Lima','Souza','Costa','Melo','Rocha','Prado','Nunes']
  c.teams.forEach((t, ti) => { for (let i = 0; i < 7; i++) {
    const k = ti * 7 + i
    c.players.push({id: `sp${k + 1}`, team: t.id, name: `${first[k % 30]} ${last[(k * 3 + ti) % 7]}`, num: [1,4,5,7,9,10,11][i],
      birth: `${2011 + (ti + i) % 3}-0${1 + (i * 2 + ti) % 9}-1${i}`, auth: true, approved: true, consent: true, photo: null, bairro: BAIRROS[(k * 5) % 6]})
  } })
  const p = n => c.players[n]
  p(14).birth = '2010-03-15'                    // 16 anos: acima da faixa
  p(40).approved = false; p(41).approved = false // enviados pela equipe, aguardando a Secretaria
  p(52).auth = false                            // falta autorização do responsável
  c.log.unshift({at: '2026-11-02T09:00:00', who: SEC, what: 'Inscrições abertas para a Copa Sub-15'})
  c.log.unshift({at: '2026-11-05T18:40:00', who: 'Equipe EC Vila Nova', what: '2 atletas enviados para aprovação'})
  return c
}

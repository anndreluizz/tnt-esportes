// Manual animado: cada passo é uma tela real (manual/*.jpg) com a bolinha onde tocar (x, y em % da imagem).
const MANUAL = {
  secretaria: {nome: 'Secretaria', passos: [
    ['sec-01-entrar', 32.2, 52, 'Entrar no sistema', 'Abra o sistema oficial e entre com o e-mail e a senha da Secretaria.'],
    ['sec-02-novo', 50, 50, 'Criar o campeonato', 'Em Campeonatos, preencha o “Novo campeonato”. Os campos com * são obrigatórios: nome, categoria, idade, início, local, responsável e prazo das inscrições.'],
    ['sec-03-formato', 27.8, 50, 'Escolher o formato e as regras', 'Escolha Grupos + mata-mata, Pontos corridos ou Mata-mata. Nos grupos, diga quantos grupos e quantos passam. Ajuste tempo de jogo, pontos, cartões, W.O. e desempate.'],
    ['sec-04-calendario', 30.8, 60.2, 'Dias, horários e campos', 'Marque os dias de jogo e adicione cada horário e cada campo com o “+”. A tabela sai nesses dias, sem nenhuma equipe jogar duas vezes no mesmo dia.'],
    ['sec-05-equipe', 20.9, 64.8, 'Cadastrar as equipes', 'Em Inscrições, cadastre cada equipe com nome, escudo, cores e responsável. No sistema oficial, cada equipe ganha um link de inscrição para mandar no WhatsApp.'],
    ['sec-06-aprovar', 71.4, 50, 'Aprovar os atletas', 'Os atletas chegam “em análise”. Confira a foto e o documento (Ver documento) e toque em Aprovar. Menor de 18 precisa da autorização do responsável.'],
    ['sec-07-sorteio', 20.4, 49.9, 'Fazer o sorteio', 'Na aba Sorteio: 1) publique o compromisso, 2) digite os números ditos pelo público e sorteie, 3) revele a semente, 4) gere a tabela.'],
    ['sec-08-alterar', 63.5, 50, 'Alterar um jogo', 'Em Jogos e tabela, use “Alterar / W.O.” para mudar data, horário ou campo, ou registrar W.O. O motivo fica no histórico.'],
    ['sec-09-whatsapp', 70.4, 50, 'Avisar no WhatsApp', 'O botão WhatsApp de cada jogo monta a mensagem pronta (resultado ou jogo marcado). É só escolher o grupo e enviar.'],
    ['sec-10-imprevisto', 50, 44.8, 'Imprevisto: trocar campo', 'Campo alagado? Toque em “Imprevisto: trocar campo”, escolha o dia e o campo, digite o campo novo e o motivo. Todos os jogos do dia mudam de uma vez.'],
    ['sec-11-relatorios', 79.5, 23, 'Relatórios e cópia de segurança', 'Em Relatórios, veja os números do campeonato e imprima em PDF. No sistema oficial, baixe a cópia de segurança depois de cada rodada.'],
  ]},
  arbitro: {nome: 'Árbitro', passos: [
    ['sec-01-entrar', 34.3, 78.6, 'Criar a conta', 'Na primeira vez, toque em “Criar conta de árbitro”. Depois peça à Secretaria para liberar o seu e-mail e escalar você nos jogos.'],
    ['arb-01-gol', 21.3, 50, 'Registrar o jogo', 'Em Minhas partidas, escolha o jogo. Toque em Gol, Amarelo, Vermelho ou Falta e escolha o atleta. Atleta suspenso aparece bloqueado.'],
    ['arb-02-sem-internet', 34.5, 31.8, 'Sem internet? Continue', 'Se o sinal cair, continue normalmente: tudo fica guardado no celular e é enviado sozinho quando a internet voltar.'],
    ['arb-03-assinar', 27.6, 50, 'Assinar e confirmar', 'No fim, toque em “Encerrar jogo e assinar”. Árbitro e os dois capitães assinam com o dedo. Depois, “Confirmar súmula”: sai o código de autenticidade.'],
  ]},
  equipe: {nome: 'Equipe', passos: [
    ['eq-02-link', 50, 42.7, 'Inscrever pelo link', 'Abra o link que a Secretaria mandou (não precisa de conta) e preencha cada atleta: nome, número, nascimento e endereço.'],
    ['eq-03-fotos', 40.1, 49.9, 'Foto e documento', 'Tire a foto do rosto e do RG, frente e verso. Se o atleta for menor de 18, aparecem os campos do responsável. A inscrição fica em análise até a Secretaria aprovar.'],
    ['eq-01-conta', 32.2, 69.6, 'Conta da equipe (opcional)', 'Para acompanhar o elenco e os jogos, o responsável toca em “Criar conta da equipe”, cria e-mail e senha e digita o código que a Secretaria passou.'],
  ]},
  populacao: {nome: 'População', passos: [
    ['pub-01-portal', 67.8, 50, 'Acompanhar o campeonato', 'No portal público, sem login: tabela, próximos jogos, resultados, artilharia e estatísticas.'],
    ['pub-02-conferir', 32.7, 50, 'Conferir uma súmula', 'Digite o código impresso na súmula para saber se ela é autêntica. Dá também para conferir o sorteio e ver o regulamento.'],
  ]},
}
const TEMPO = 6500   // ms por passo
const $ = s => document.querySelector(s)
let papel = Object.keys(MANUAL).includes(location.hash.slice(1)) ? location.hash.slice(1) : 'secretaria', passo = 0, tocando = true, timer = null

function montar() {
  $('#papeis').innerHTML = Object.entries(MANUAL).map(([k, v]) => `<button role="tab" class="${k === papel ? 'on' : ''}" aria-selected="${k === papel}" data-papel="${k}">${v.nome}</button>`).join('')
  const ps = MANUAL[papel].passos
  $('#palco').innerHTML = ps.map(([img, x, y, t]) => `<div class="cena" style="transform-origin:${x}% ${y}%"><img src="manual/${img}.jpg" alt="${t}" loading="lazy"><span class="toque" style="left:${x}%;top:${y}%"></span></div>`).join('')
  $('#pontos').innerHTML = ps.map((p, i) => `<button aria-label="Passo ${i + 1}" data-i="${i}"></button>`).join('')
  $('#lista').innerHTML = ps.map((p, i) => `<li><button data-i="${i}">${p[3]}</button> — ${p[4]}</li>`).join('')
  mostrar(0)
}
function mostrar(i) {
  const ps = MANUAL[papel].passos; passo = (i + ps.length) % ps.length
  document.querySelectorAll('.cena').forEach((c, k) => c.classList.toggle('on', k === passo))
  document.querySelectorAll('.pontos button').forEach((b, k) => b.classList.toggle('on', k === passo))
  const [, , , t, txt] = ps[passo]
  $('#legenda').innerHTML = `<div class="eyebrow">${MANUAL[papel].nome} · passo ${passo + 1} de ${ps.length}</div><h2>${t}</h2><p>${txt}</p>`
  const barra = $('#tempo'); barra.classList.remove('corre'); void barra.offsetWidth
  clearTimeout(timer)
  if (tocando) { barra.style.animationDuration = TEMPO + 'ms'; barra.classList.add('corre'); timer = setTimeout(() => mostrar(passo + 1), TEMPO) }
}
function tocar(v) { tocando = v; $('#play').textContent = v ? '⏸ Pausar' : '▶ Continuar'; $('#play').setAttribute('aria-label', v ? 'Pausar' : 'Continuar'); mostrar(passo) }

document.addEventListener('click', e => {
  const p = e.target.closest('[data-papel]'); if (p) { papel = p.dataset.papel; history.replaceState(null, '', '#' + papel); return montar() }
  const i = e.target.closest('[data-i]'); if (i) { tocar(false); mostrar(+i.dataset.i); if (i.closest('#lista')) $('#palco').scrollIntoView({behavior: 'smooth', block: 'center'}); return }
  if (e.target.closest('#ant')) { tocar(false); return mostrar(passo - 1) }
  if (e.target.closest('#prox')) { tocar(false); return mostrar(passo + 1) }
  if (e.target.closest('#play')) return tocar(!tocando)
})
document.addEventListener('keydown', e => { if (e.key === 'ArrowRight') { tocar(false); mostrar(passo + 1) } if (e.key === 'ArrowLeft') { tocar(false); mostrar(passo - 1) } })
if (matchMedia('(prefers-reduced-motion: reduce)').matches) tocando = false
montar(); tocar(tocando)

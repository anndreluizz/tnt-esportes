// Página do link de inscrição (inscricao.html?t=<link da equipe>): o responsável da equipe inscreve
// cada atleta com foto e documento, sem precisar de conta. Tudo entra "em análise" para a Secretaria aprovar.
// O banco confere o link, o prazo, o limite de atletas e o número da camisa (função inscrever_pelo_link).
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {auth: {persistSession: false}})
const token = new URLSearchParams(location.search).get('t') || ''
const $ = s => document.querySelector(s)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]))
const marca = p => p ? `${SUPABASE_URL}/storage/v1/object/public/marcas/${p}` : null
const dmy = d => d.split('-').reverse().join('/')
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 4500) }

let info = null, feito = null

async function carregar() {
  const {data, error} = /^[0-9a-f-]{36}$/i.test(token) ? await sb.rpc('link_inscricao', {t: token}) : {data: null}
  info = error ? {erro: 'Sem conexão. Confira a internet e abra o link de novo.'} : data || {erro: 'Link de inscrição inválido. Peça o link certo à Secretaria de Esportes.'}
  render()
}

function render() {
  const app = $('#app')
  if (info.erro) { app.innerHTML = `<div class="card empty">${esc(info.erro)}</div>`; return }
  const i = info, faixa = i.idade_max ? `${i.idade_min} a ${i.idade_max} anos` : `a partir de ${i.idade_min} anos`
  const pats = (i.patrocinadores || []).length ? `<div class="sponsors"><span class="eyebrow">Patrocínio</span>${i.patrocinadores.map(p => p.logo_path
    ? `<img src="${esc(marca(p.logo_path))}" alt="${esc(p.nome)}" title="${esc(p.nome)}">` : `<b>${esc(p.nome)}</b>`).join('')}</div>` : ''
  const img = i.escudo || i.logo   // escudo da equipe; sem escudo, a logo do campeonato
  const head = `<div class="hero"><div style="display:flex;gap:14px;align-items:center">${img ? `<img class="clogo" src="${esc(marca(img))}" alt="" style="width:64px;height:64px">` : ''}
    <div><div class="eyebrow">Inscrição de atletas · ${esc(i.campeonato)}</div><h2>${esc(i.equipe)}</h2>
    <div style="color:#cfe3d6;font-size:14px;margin-top:4px">${esc(i.modalidade)} · ${esc(i.categoria)} · ${faixa}${i.inscricao_ate ? ` · inscrições até ${dmy(i.inscricao_ate)}` : ''}</div></div></div></div>${pats}`
  const lista = `<div class="card"><h3>Atletas já inscritos <small>${i.inscritos.length} de ${i.max_atletas}</small></h3>
    ${i.inscritos.length ? `<div class="numeros">${i.inscritos.map(a => `<span><b>${a.numero}</b> ${esc(a.nome)}</span>`).join('')}</div>` : '<p class="sub">Nenhum ainda. Comece pelo primeiro atleta aqui embaixo.</p>'}</div>`
  if (!i.aberta) { app.innerHTML = head + `<div class="card empty">As inscrições deste campeonato estão encerradas.</div>` + lista; return }
  if (feito) {
    app.innerHTML = head + `<div class="card" style="text-align:center"><div class="ok">✓</div><h3>${esc(feito)} foi inscrito!</h3>
      <p class="sub">A inscrição fica em análise até a Secretaria conferir os documentos.</p>
      <button class="btn" style="margin-top:12px" id="outro">Inscrever outro atleta</button></div>` + lista
    $('#outro').onclick = () => { feito = null; render(); scrollTo(0, 0) }
    return
  }
  if (i.inscritos.length >= i.max_atletas) { app.innerHTML = head + `<div class="card empty">A equipe já tem o máximo de ${i.max_atletas} atletas.</div>` + lista; return }
  const step = (n, t, body) => `<fieldset class="step"><legend><span>${n}</span>${t}</legend><div class="f">${body}</div></fieldset>`
  app.innerHTML = head + `<form id="form" novalidate>
    ${step(1, 'Dados do atleta', `
      <label class="span2">Nome completo<input name="nome" required minlength="3" maxlength="50" autocomplete="off"></label>
      <label>Apelido<input name="apelido" maxlength="30" autocomplete="off" placeholder="Opcional · como é chamado no jogo"></label>
      <label>Nº da camisa<input name="numero" type="number" min="1" max="99" required inputmode="numeric"></label>
      <label>Data de nascimento${campoData('nascimento', '', 'required')}</label>
      <label>Posição<select name="posicao"><option value="">—</option>${(POSICOES[i.modalidade] || POSICOES.Futsal).map(p => `<option>${p}</option>`).join('')}</select></label>
      <label>Bairro<select name="bairro">${BAIRROS.map(b => `<option>${b}</option>`).join('')}</select></label>`)}
    <div id="resp" hidden>${step(2, 'Responsável <small class="sub">(atleta menor de 18 anos)</small>', `
      <label>Nome do responsável<input name="responsavel" maxlength="60"></label>
      <label>Telefone do responsável<input name="responsavel_telefone" type="tel" maxlength="20"></label>
      <p class="note span2">Menor de 18 anos também precisa levar a autorização assinada pelo responsável à Secretaria.</p>`)}</div>
    ${step(3, 'Foto e documento', `
      ${upload('foto', 'Foto do rosto do atleta', {capture: 'user', required: true, dica: 'De frente, sem boné nem óculos escuros'})}
      ${upload('rgf', 'Documento (RG) – frente', {capture: 'environment', required: true})}
      ${upload('rgv', 'Documento (RG) – verso', {capture: 'environment', required: true})}
      <p class="note span2">O documento serve só para a Secretaria conferir a idade. Ninguém mais vê, e ele é apagado quando o campeonato termina.</p>`)}
    <label class="chk" style="margin-top:12px"><input type="checkbox" name="consentimento"> Autorizo o uso destes dados para a gestão do campeonato (LGPD). Se o atleta for menor de 18 anos, declaro ser o responsável legal e autorizo em nome dele. Nascimento, foto e documento não aparecem no portal público. <a href="privacidade.html" target="_blank" rel="noopener">Como usamos os dados</a></label>
    <button class="btn block" style="margin-top:14px" id="enviar">Enviar inscrição</button></form>` + lista
  $('#form').onsubmit = enviar
  $('#form').oninput = e => {   // dados do responsável só aparecem para menor de 18
    if (e.target.name !== 'nascimento') return
    const iso = dataISO(e.target.value); $('#resp').hidden = !(iso && ageAt(iso, info.inicio) < 18)
  }
}

async function enviar(e) {
  e.preventDefault()
  const f = e.target, d = lerForm(f), i = info, btn = $('#enviar')
  const nome = d.nome.trim().replace(/\s+/g, ' '), numero = +d.numero
  const erro = msg => { toast(msg); return false }
  if (nome.length < 3) return erro('Digite o nome completo do atleta.')
  if (!(numero >= 1 && numero <= 99)) return erro('O número da camisa vai de 1 a 99.')
  if (i.inscritos.some(a => a.numero === numero)) return erro(`O número ${numero} já está com outro atleta da equipe.`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.nascimento)) return erro('Data de nascimento inválida. Digite assim: 20/05/2010.')
  const idade = ageAt(d.nascimento, i.inicio)
  if (idade < i.idade_min || (i.idade_max && idade > i.idade_max)) return erro(`Fora da faixa etária do campeonato: o atleta terá ${idade} anos.`)
  if (idade < 18 && (!d.responsavel.trim() || !d.responsavel_telefone.trim())) return erro('Menor de 18 anos: informe o nome e o telefone do responsável.')
  if (!d.foto.size || !d.rgf.size || !d.rgv.size) return erro('Envie a foto do atleta e o documento (frente e verso).')
  if (!d.consentimento) return erro('Marque a autorização de uso dos dados (LGPD).')
  btn.disabled = true; btn.textContent = 'Enviando… (com internet fraca pode demorar um pouco)'
  try {
    const id = crypto.randomUUID(), pasta = `${i.equipe_id}/${token}/`
    const envia = async (bucket, nomeArq, file, max, square) => {
      const path = pasta + id + nomeArq, b = await fitImage(file, max, 'image/jpeg', square)
      const {error} = await sb.storage.from(bucket).upload(path, b, {contentType: 'image/jpeg'})
      if (error && !/exists/i.test(error.message)) throw new Error('Não foi possível enviar a imagem: ' + error.message)
      return path
    }
    let arq
    try { arq = {foto_path: await envia('fotos', '-foto.jpg', d.foto, 400, true), rg_frente_path: await envia('documentos', '-rg-frente.jpg', d.rgf, 1400),
                 rg_verso_path: await envia('documentos', '-rg-verso.jpg', d.rgv, 1400)} }
    catch (err) { throw err.message === 'foto' ? new Error('Não foi possível ler a imagem. Tire a foto de novo ou use JPG/PNG.') : err }
    const {error} = await sb.rpc('inscrever_pelo_link', {t: token, a: {id, nome, apelido: d.apelido, numero, nascimento: d.nascimento, posicao: d.posicao,
      bairro: d.bairro, responsavel: d.responsavel, responsavel_telefone: d.responsavel_telefone, consentimento: true, ...arq}})
    if (error && !/atletas_pkey/.test(error.message))   // pkey = já tinha chegado (toque duplo ou reenvio)
      throw new Error(/numero/.test(error.message) ? `O número ${numero} já está com outro atleta da equipe.` : error.message)
    feito = nome; await carregar(); scrollTo(0, 0)
  } catch (err) {
    toast(/fetch/i.test(err.message) ? 'Sem internet. Confira a conexão e toque em enviar de novo.' : err.message)
    btn.disabled = false; btn.textContent = 'Enviar inscrição'
  }
}

carregar()

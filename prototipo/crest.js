// escudo gerado das iniciais (provisório: troca pelo escudo real enviado pela equipe)
const HUES = {rsf: '#1769FF', atc: '#e53950', unb: '#00b865', est: '#f5a623', gre: '#7ad0ff', juv: '#ffd23f', tjr: '#00E676', svi: '#ff7a45'}
document.querySelectorAll('[data-t]').forEach(e => {
  const [k, i] = e.dataset.t.split(':')
  e.innerHTML = `<svg class="crest ${e.dataset.s ? 's' : ''}" viewBox="0 0 64 64"><path d="M32 3 57 17v30L32 61 7 47V17Z" fill="${HUES[k]}"/><path d="M32 8 52.5 20v24L32 56 11.5 44V20Z" fill="none" stroke="#071426" stroke-opacity=".55" stroke-width="2"/><text x="32" y="40" text-anchor="middle" font-family="Barlow Condensed" font-weight="700" font-size="25" fill="#071426">${i}</text></svg>`
})

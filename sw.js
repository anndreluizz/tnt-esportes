// Guarda o app no aparelho para abrir sem internet (só funciona quando hospedado em https).
const CACHE = 'tnt-v8'
const FILES = ['./', 'index.html', 'estilo.css', 'js/etapas.js', 'js/regras.js', 'js/dados.js', 'js/app.js', 'manifest.webmanifest', 'icone.svg', 'oficial.html', 'js/api.js', 'js/config.js', 'manual.html', 'js/manual.js', 'img/marca.svg', 'img/hero-rio.jpg', 'img/hero-praca.jpg', 'img/faixa-ginasio.jpg', 'img/faixa-praca.jpg', 'img/faixa-orla.jpg']
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())))
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())))
// rede primeiro (pega versão nova), cache se estiver sem sinal
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return
  e.respondWith(fetch(e.request).then(r => { if (r.ok && (new URL(e.request.url).origin === location.origin || e.request.url.startsWith('https://cdn.jsdelivr.net/'))) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)) } return r })
    .catch(() => caches.match(e.request)))
})

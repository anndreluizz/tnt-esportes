// Guarda o app no aparelho para abrir sem internet (só funciona quando hospedado em https).
const CACHE = 'tnt-v2'
const FILES = ['./', 'index.html', 'estilo.css', 'js/regras.js', 'js/dados.js', 'js/app.js', 'manifest.webmanifest', 'icone.svg']
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())))
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())))
// rede primeiro (pega versão nova), cache se estiver sem sinal
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return
  e.respondWith(fetch(e.request).then(r => { if (r.ok && new URL(e.request.url).origin === location.origin) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)) } return r })
    .catch(() => caches.match(e.request)))
})

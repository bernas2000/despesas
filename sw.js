// Service worker mínimo: guarda a "casca" da app para abrir depressa e mesmo sem rede.
// Vai sempre à rede primeiro (com revalidação), por isso uma atualização no GitHub chega
// aos telemóveis na abertura seguinte, sem ninguém mexer nada.
// Os dados (despesas) vêm sempre do servidor; não há gravação offline.
const CACHE = 'despesas-v5';
const ASSETS = ['./', './index.html', './app.css', './calc.js', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return; // pedidos ao servidor passam direto
  e.respondWith(
    fetch(r, { cache: 'no-cache' }).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(r, copy));
      }
      return res;
    }).catch(() => caches.match(r).then(m => m || caches.match('./index.html')))
  );
});

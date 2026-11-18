// Service Worker: App funktioniert offline. Bei Internet wird immer die neueste Version geholt.
const CACHE = 'lerntrainer-968775a851';
const SHELL = ['./', 'index.html', 'app.js', 'style.css', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
  'manifest.webmanifest', 'local-api.js', 'import.js', 'inhalte.json'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  const fromCache = () => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'));
  // erst Netz (max. 3 s), sonst aus dem Speicher – so geht es auch im Flugmodus
  e.respondWith(new Promise(resolve => {
    let done = false;
    const t = setTimeout(() => { fromCache().then(r => { if (r && !done) { done = true; resolve(r); } }); }, 3000);
    fetch(e.request).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      clearTimeout(t); if (!done) { done = true; resolve(r); }
    }).catch(() => { clearTimeout(t); fromCache().then(r => { if (!done) { done = true; resolve(r || Response.error()); } }); });
  }));
});

/* Rehabilitacja stopy – service worker (© Wojciech Wieczorek)
   Kod aplikacji (html/js/css): najpierw sieć, w razie braku – pamięć podręczna (działa offline).
   Duże, niezmienne pliki (model, ONNX Runtime, ffmpeg, fonty, biblioteki): najpierw pamięć podręczna. */
const VERSION = 'v6';
const SHELL = `rehab-shell-${VERSION}`, HEAVY = `rehab-heavy-${VERSION}`;
const SHELL_FILES = [
  './', './index.html', './style.css', './tracker.js', './manifest.webmanifest',
  './js/app.js', './js/util.js', './js/pose.js', './js/video.js', './js/convert.js', './js/metrics.js', './js/store.js', './js/report.js', './js/version.js',
  './assets/fonts.css', './assets/logo-bikerc.svg', './assets/coach.js',
  './assets/icons/icon-192.png', './assets/icons/icon-512.png', './assets/icons/apple-touch-icon.png'
];
const isHeavy = p => /\/assets\/(models|ort|ffmpeg|fonts|vendor)\//.test(p);
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await Promise.all(SHELL_FILES.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => { })));
    self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('rehab-') && k !== SHELL && k !== HEAVY) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); if (url.origin !== location.origin) return;
  if (req.headers.has('range')) return;                       // nie dotykamy zapytań o zakres bajtów
  if (isHeavy(url.pathname)) {
    e.respondWith((async () => {
      const c = await caches.open(HEAVY), hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req); if (res.ok) c.put(req, res.clone()).catch(() => { }); return res;
    })());
    return;
  }
  e.respondWith((async () => {
    const c = await caches.open(SHELL);
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) c.put(req, res.clone()).catch(() => { });
      return res;
    } catch (err) {
      const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await c.match('./index.html') : null);
      if (hit) return hit; throw err;
    }
  })());
});

/* Rehabilitacja stopy – service worker (© Wojciech Wieczorek): powłoka aplikacji offline + cache bibliotek i modelu */
const VERSION = 'v3';
const SHELL = `rehab-shell-${VERSION}`;
const LIBS = 'rehab-libs-v1';
const SHELL_FILES = [
  './', './index.html', './style.css', './app.js', './tracker.js', './manifest.webmanifest',
  './assets/fonts.css', './assets/logo-bikerc.svg', './assets/coach.js',
  './assets/vendor/jspdf.umd.min.js', './assets/vendor/report-fonts.js',
  './assets/icons/icon-192.png', './assets/icons/icon-512.png', './assets/icons/icon-maskable-512.png', './assets/icons/apple-touch-icon.png'
];
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    // pojedyncze błędy (np. brak pliku) nie blokują instalacji
    await Promise.all(SHELL_FILES.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    // fonty z assets/fonts.css
    try {
      const css = await (await fetch('./assets/fonts.css')).text();
      const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map(m => m[1].replace(/["']/g, '')).filter(u => !u.startsWith('data:'));
      await Promise.all(urls.map(u => c.add(new URL(u, new URL('./assets/', self.registration.scope)).href).catch(() => {})));
    } catch (_) {}
    self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('rehab-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});
const isLib = u => /cdn\.jsdelivr\.net|storage\.googleapis\.com\/mediapipe-models|\/assets\/mediapipe\//.test(u);
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // biblioteki / model: cache-first (duże, wersjonowane)
  if (isLib(req.url)) {
    e.respondWith((async () => {
      const c = await caches.open(LIBS);
      const hit = await c.match(req, { ignoreVary: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()).catch(() => {});
        return res;
      } catch (err) { return hit || Response.error(); }
    })());
    return;
  }
  if (url.origin !== self.location.origin) return;
  // index.html / nawigacja: NETWORK-FIRST (nowa wersja trafia do użytkownika od razu),
  // przy braku sieci lub bardzo wolnym łączu (>4 s) – kopia z cache
  const isDoc = req.mode === 'navigate' || /\/(index\.html)?$/.test(url.pathname) || /\/(sw\.js|manifest\.webmanifest|app\.js|tracker\.js|style\.css|assets\/coach\.js)$/.test(url.pathname);
  if (isDoc) {
    e.respondWith((async () => {
      const c = await caches.open(SHELL);
      const key = req.mode === 'navigate' || /\/$/.test(url.pathname) ? './index.html' : req;
      const net = fetch(req.mode === 'navigate' ? new Request(req.url, { cache: 'no-cache' }) : req, req.mode === 'navigate' ? undefined : { cache: 'no-cache' })
        .then(res => { if (res && res.ok) c.put(key, res.clone()).catch(() => {}); return res }).catch(() => null);
      const timeout = new Promise(r => setTimeout(() => r(null), 4000));
      const res = await Promise.race([net, timeout]);
      if (res) return res;
      const hit = await c.match(key, { ignoreSearch: true });
      if (hit) { e.waitUntil(net); return hit }
      const late = await net; if (late) return late;
      const idx = await c.match('./index.html'); return idx || Response.error();
    })());
    return;
  }
  // pozostałe własne pliki: stale-while-revalidate
  e.respondWith((async () => {
    const c = await caches.open(SHELL);
    const hit = await c.match(req);
    const net = fetch(req).then(res => { if (res && res.ok) c.put(req, res.clone()).catch(() => {}); return res }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit }
    const res = await net;
    return res || Response.error();
  })());
});

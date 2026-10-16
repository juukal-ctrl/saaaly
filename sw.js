// sw.js: pitää sovelluksen kuoren saatavilla ilman verkkoa. Verkko ensin, välimuisti varana,
// joten uusi versio tulee käyttöön heti kun se on julkaistu. Sää- ja tekoälykutsut eivät kulje tämän kautta.

const CACHE = 'saaaly-shell-v1';
const SHELL = ['./', 'index.html', 'saaaly.js', 'app.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // rajapintakutsut menevät suoraan verkkoon
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await cache.match('index.html') : null);
    if (hit) return hit;
    return new Response('Ei verkkoyhteyttä', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
}

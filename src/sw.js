// sw.js: pitää sovelluksen kuoren saatavilla ilman verkkoa. Verkko ensin (enintään 3 s), välimuisti varana,
// joten uusi versio tulee käyttöön heti kun se on julkaistu eikä hidas verkko viivytä käynnistystä.
// Sää- ja tekoälykutsut eivät kulje tämän kautta. Käännös korvaa BUILD-tunnuksen (tools/build.mjs).

const BUILD = '__BUILD__';
const CACHE = 'saaaly-' + BUILD;
const SHELL = ['./', 'index.html', 'crash.js', 'saaaly.js', 'css/app.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'icons/wx-d-cloud.webp', 'icons/wx-d-part.webp', 'icons/wx-d-part_cloud.webp', 'icons/wx-d-part_sun.webp', 'icons/wx-d-rain.webp', 'icons/wx-d-snow.webp', 'icons/wx-d-storm.webp', 'icons/wx-d-sun.webp', 'icons/wx-n-cloud.webp', 'icons/wx-n-moon.webp', 'icons/wx-n-moonpart.webp', 'icons/wx-n-rain.webp', 'icons/wx-n-snow.webp', 'icons/wx-n-storm.webp'];
const NET_TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // addAll on atomista: jos yksikin tiedosto puuttuu, asennus epäonnistuu ja vanha versio jää käyttöön (ei osittaista kuorta).
      await cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('saaaly-') && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // rajapintakutsut menevät suoraan verkkoon
  if (url.pathname.endsWith('/version.json')) return; // versiotarkistus kysytään aina verkosta
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  let res = null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), NET_TIMEOUT_MS);
    try {
      res = await fetch(req, { cache: 'no-cache', signal: ctl.signal });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    res = null; // ei verkkoa tai liian hidas
  }
  if (res && res.ok) {
    cache.put(req, res.clone());
    return res;
  }
  // Verkko ei toimi tai palautti virheen (404, 5xx): tallennettu kopio on parempi kuin virhesivu.
  const hit = (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await cache.match('index.html') : null);
  if (hit) return hit;
  return res || new Response('Ei verkkoyhteyttä', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

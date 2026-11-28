// sw.js: pitää sovelluksen kuoren saatavilla ilman verkkoa. Verkko ensin (enintään 3 s), välimuisti varana,
// joten uusi versio tulee käyttöön heti kun se on julkaistu eikä hidas verkko viivytä käynnistystä.
// Välimuisti on yksi versiokohtainen (saaaly-<BUILD>): kuori esiladataan asennuksessa, muut saman palvelimen tiedostot
// (esim. pohjakartat) tallentuvat ensimmäisellä haulla ilman kyselyosaa, joten tiedostojen määrä on rajattu.
// Sää- ja tekoälykutsut eivät kulje tämän kautta. Käännös korvaa BUILD-tunnuksen (tools/build.mjs).

const BUILD = 'cf6a46e2b4';
const CACHE = 'saaaly-' + BUILD;
const SHELL = ['./', 'index.html', 'crash.js', 'saaaly.js', 'app.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'wx-d-cloud.webp', 'wx-d-part.webp', 'wx-d-part_cloud.webp', 'wx-d-part_sun.webp', 'wx-d-rain.webp', 'wx-d-snow.webp', 'wx-d-storm.webp', 'wx-d-sun.webp', 'wx-n-cloud.webp', 'wx-n-moon.webp', 'wx-n-moonpart.webp', 'wx-n-rain.webp', 'wx-n-snow.webp', 'wx-n-storm.webp', 'trk-d.webp', 'trk-n.webp',
  'braid.webp', 'cap.webp', 'pearls.webp', 'inter-display-regular.woff', 'inter-display-medium.woff', 'inter-display-semibold.woff', 'inter-display-bold.woff'];
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
      // Vain tämän version välimuisti jää: vanhat versiot poistetaan, joten tallennettu tila ei kasva versio versiolta.
      for (const key of await caches.keys()) if (key.startsWith('saaaly-') && key !== CACHE) await caches.delete(key);
      // Navigoinnin esilataus: sivun verkkohaku alkaa jo service workerin käynnistyessä (nopeampi avaus hitaalla verkolla).
      try {
        await self.registration.navigationPreload?.enable();
      } catch {
        /* ei tukea */
      }
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
  event.respondWith(networkFirst(event, url));
});

/**
 * Välimuistin avain ilman kyselyosaa (?demo=, ?avaa=): sama tiedosto tallentuu yhden kerran, joten välimuisti ei kasva
 * osoitteiden mukana. Sivulle (navigointi) avain on aina kuoren index.html.
 */
function cacheKey(req, url) {
  if (req.mode === 'navigate') return new URL('index.html', self.registration.scope).href;
  return url.origin + url.pathname;
}

async function networkFirst(event, url) {
  const req = event.request;
  const cache = await caches.open(CACHE);
  const key = cacheKey(req, url);
  let res = null;
  const ctl = new AbortController();
  let timer = 0;
  const preload = event.preloadResponse ? Promise.resolve(event.preloadResponse).catch(() => null) : Promise.resolve(null);
  if (event.preloadResponse) event.waitUntil(preload);
  const net = preload.then((pre) => pre || fetch(req, { cache: 'no-cache', signal: ctl.signal }));
  net.catch(() => {});
  try {
    res = await Promise.race([
      net,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          ctl.abort();
          reject(new Error('aikakatkaisu'));
        }, NET_TIMEOUT_MS);
      }),
    ]);
  } catch {
    res = null; // ei verkkoa tai liian hidas
  } finally {
    clearTimeout(timer);
  }
  // Vain kokonaiset vastaukset tallennetaan (206 = osavastaus ei kelpaa välimuistiin).
  if (res && res.ok && res.status === 200) {
    event.waitUntil(cache.put(key, res.clone()).catch(() => {}));
    return res;
  }
  if (res && res.ok) return res;
  // Verkko ei toimi tai palautti virheen (404, 5xx): tallennettu kopio on parempi kuin virhesivu.
  const hit = (await cache.match(key)) || (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await cache.match('index.html') : null);
  if (hit) return hit;
  return res || new Response('Ei verkkoyhteyttä', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

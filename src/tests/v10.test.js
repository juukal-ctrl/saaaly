// 1.0: saavutettavuus (painikkeiden nimet), taivasanimaation kuvatahti ja pysäytys, service workerin välimuisti ja manifesti.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { placeHtml, trackHtml, weekPageHtml, hoursPageHtml, staleText, verdictHtml } from '../js/views.js';
import { blendForecast } from '../js/blend.js';
import { MODELS } from '../js/models.js';
import { parseModelResponse } from '../js/weather.js';
import { syntheticResponse } from '../js/demo.js';
import { createSky } from '../js/sky.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = Date.UTC(2026, 9, 14, 11, 4);

function forecast() {
  const res = MODELS.map((m) => {
    const id = m.ids[0];
    return { model: m, ok: true, id, data: parseModelResponse(syntheticResponse({ lat: 60.45, lon: 22.27, modelId: id, nowMs: NOW, scenario: 'rain' }), id), ms: 5 };
  });
  return blendForecast(res, { nowMs: NOW });
}

/** Painikkeiden avaustagit ja niiden näkyvä teksti (piiloteksti mukana). */
const buttons = (html) => [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({ attrs: m[1], text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/ ,/g, ',').trim() }));

// ---------- Saavutettavuus ----------

test('saavutettavuus: tuntien, päivien ja paikan painikkeiden nimi alkaa näkyvällä tekstillä (WCAG 2.5.3), ei aria-labelia', () => {
  const fc = forecast();
  const place = placeHtml({ name: 'Turku', region: 'Varsinais-Suomi', country: 'Suomi' });
  assert.match(place, /<span class="sr-only">, vaihda paikkakuntaa<\/span>$/);
  const track = buttons(trackHtml({ fc, nowMs: NOW, sel: { type: 'now' } })).filter((b) => /data-act="hour"/.test(b.attrs));
  assert.ok(track.length >= 8);
  for (const b of track) {
    assert.doesNotMatch(b.attrs, /aria-label/);
    assert.match(b.text, /^[+−-]?\d+° klo \d\d, \w+, /, b.text);
  }
  const week = buttons(weekPageHtml({ fc, nowMs: NOW })).filter((b) => /data-act="day"/.test(b.attrs));
  assert.ok(week.length >= 5);
  for (const b of week) {
    assert.doesNotMatch(b.attrs, /aria-label/);
    assert.match(b.text, /alin .*ylin/);
  }
  const hours = buttons(hoursPageHtml({ fc, nowMs: NOW })).filter((b) => /data-act="hrow"/.test(b.attrs));
  assert.ok(hours.length >= 10);
  for (const b of hours) assert.doesNotMatch(b.attrs, /aria-label/);
  assert.match(hours[0].text, /^nyt, /);
});

test('saavutettavuus: etusivun otsikko on h2-otsikko ja sen rivien välissä on väli ruudunlukijalle', () => {
  const html = verdictHtml({ hl: { l1: 'Sadetakki mukaan.', l2: 'Sade alkaa klo 16.', small: 'Puuskia.' } });
  assert.match(html, /^<h2 class="vsay"><b>Sadetakki mukaan\.<\/b> <span>Sade alkaa klo 16\.<\/span><\/h2><p class="vsmall">/);
});

test('ilmoitus vanhasta ennusteesta kertoo haun kellonajan ja sen, onko verkko poissa', () => {
  const at = new Date(2026, 9, 14, 9, 5).getTime();
  const now = at + 2 * 3600000;
  assert.equal(staleText({ fetchedAt: at, nowMs: now, offline: true }), 'Ei verkkoyhteyttä. Näytetään ennuste klo 9.05 (2 h sitten).');
  assert.match(staleText({ fetchedAt: at, nowMs: now }), /^Päivitys ei onnistunut\. Näytetään ennuste klo 9\.05/);
  assert.match(staleText({ fetchedAt: at, nowMs: at + 26 * 3600000, offline: true }), /ennuste 14\.10\. klo 9\.05 \(1 vrk sitten\)/);
});

// ---------- Taivaan animaatio ----------

function fakeCanvas() {
  const noop = () => {};
  const grad = { addColorStop: noop };
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k.startsWith('create') ? () => grad : noop), set: (t, k, v) => ((t[k] = v), true) });
  return { clientWidth: 400, clientHeight: 800, width: 0, height: 0, getContext: () => ctx };
}

function withFrames(fn) {
  const saved = { raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame, doc: globalThis.document };
  const q = new Map();
  let id = 0;
  globalThis.requestAnimationFrame = (f) => (q.set(++id, f), id);
  globalThis.cancelAnimationFrame = (i) => q.delete(i);
  globalThis.document = { hidden: false };
  const runFrame = (ts) => {
    const fs = [...q.values()];
    q.clear();
    fs.forEach((f) => f(ts));
    return fs.length;
  };
  try {
    return fn({ q, runFrame });
  } finally {
    globalThis.requestAnimationFrame = saved.raf;
    globalThis.cancelAnimationFrame = saved.caf;
    if (saved.doc === undefined) delete globalThis.document;
    else globalThis.document = saved.doc;
  }
}

test('taivas: piirron jälkeen seuraavaa kuvaa ei pyydetä heti (ajastin, ei 60 kuvaa/s), pysäytetty taivas ei herää kosketuksesta', () =>
  withFrames(({ q, runFrame }) => {
    const sky = createSky(fakeCanvas());
    const f0 = sky.frames();
    sky.start();
    assert.equal(q.size, 1);
    runFrame(performance.now());
    assert.ok(sky.frames() > f0, 'kuva piirrettiin');
    assert.equal(q.size, 0, 'seuraava kuva odottaa ajastinta eikä näytön päivitystä');
    sky.stop();
    sky.poke();
    assert.equal(q.size, 0, 'kosketus ei herätä pysäytettyä taivasta (paneeli auki)');
    const before = sky.frames();
    sky.set({ precip: 2 });
    assert.equal(sky.frames(), before + 1, 'tilan muutos piirretään kerran myös pysäytettynä');
    sky.start();
    assert.equal(q.size, 1, 'start käynnistää uudelleen');
    sky.stop();
    assert.equal(q.size, 0);
  }));

// ---------- Service worker ----------

const SCOPE = 'https://example.test/saaaly/';

function loadWorker({ net, keys = [] } = {}) {
  const handlers = {};
  const store = new Map();
  const deleted = [];
  const key = (k) => (typeof k === 'string' ? new URL(k, SCOPE).href : k.url);
  const cache = {
    put: async (k, r) => void store.set(key(k), await r.text()),
    match: async (k, o = {}) => {
      const u = key(k);
      if (store.has(u)) return new Response(store.get(u));
      if (o.ignoreSearch) for (const [kk, v] of store) if (kk.split('?')[0] === u.split('?')[0]) return new Response(v);
      return undefined;
    },
    addAll: async () => {},
  };
  const ctx = {
    self: { addEventListener: (t, f) => (handlers[t] = f), location: new URL(SCOPE), registration: { scope: SCOPE, navigationPreload: { enable: async () => {} } }, skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches: { open: async () => cache, keys: async () => keys, delete: async (k) => (deleted.push(k), true) },
    fetch: (req) => net(req),
    Response,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(readFileSync(join(root, 'sw.js'), 'utf8'), ctx);
  async function get(url, mode = 'no-cors') {
    let resp = null;
    const waits = [];
    handlers.fetch({ request: { method: 'GET', url, mode }, respondWith: (p) => (resp = p), waitUntil: (p) => waits.push(p) });
    const r = resp ? await resp : null;
    await Promise.all(waits);
    return r;
  }
  return { handlers, store, deleted, get };
}

test('service worker: sivun osoitteen kyselyosa ei kasvata välimuistia, ja ilman verkkoa sivu tulee välimuistista', async () => {
  let online = true;
  const sw = loadWorker({ net: async (req) => (online ? new Response(`verkosta ${req.url}`, { status: 200 }) : Promise.reject(new TypeError('offline'))) });
  await sw.get(SCOPE + '?demo=rain', 'navigate');
  await sw.get(SCOPE + '?avaa=kysy', 'navigate');
  await sw.get(SCOPE, 'navigate');
  await sw.get(SCOPE + 'map-nordic.json?v=1');
  await sw.get(SCOPE + 'map-nordic.json?v=2');
  assert.deepEqual([...sw.store.keys()].sort(), [SCOPE + 'index.html', SCOPE + 'map-nordic.json']);
  online = false;
  const r = await sw.get(SCOPE + '?avaa=kartta', 'navigate');
  assert.equal(await r.text(), `verkosta ${SCOPE}`);
  // Rajapintakutsut ja versiotarkistus eivät kulje välimuistin kautta.
  assert.equal(await sw.get('https://api.open-meteo.com/v1/forecast?x=1'), null);
  assert.equal(await sw.get(SCOPE + 'version.json'), null);
});

test('service worker: osavastausta (206) ei tallenneta, ja aktivointi poistaa vain vanhat SääÄly-välimuistit', async () => {
  const sw = loadWorker({ net: async () => new Response('osa', { status: 206 }), keys: ['saaaly-vanha', 'saaaly-__BUILD__', 'muu-sovellus'] });
  const r = await sw.get(SCOPE + 'fonts/x.woff');
  assert.equal(r.status, 206);
  assert.equal(sw.store.size, 0);
  const waits = [];
  sw.handlers.activate({ waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  assert.deepEqual(sw.deleted, ['saaaly-vanha']);
});

// ---------- Manifesti ----------

test('manifesti: tunniste, kategoriat ja pikakuvakkeet, joiden osoitteet sovellus osaa avata', () => {
  const m = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
  const app = readFileSync(join(root, 'js/app.js'), 'utf8');
  assert.equal(m.id, './');
  assert.ok(m.categories.includes('weather'));
  assert.ok(m.shortcuts.length >= 3);
  for (const s of m.shortcuts) {
    const what = /^\.\/\?avaa=(\w+)$/.exec(s.url)?.[1];
    assert.ok(what, s.url);
    assert.ok(app.includes(`what === '${what}'`), `app.js ei käsittele pikakuvaketta ${what}`);
    for (const i of s.icons) assert.ok(m.icons.some((x) => x.src === i.src), i.src);
  }
});

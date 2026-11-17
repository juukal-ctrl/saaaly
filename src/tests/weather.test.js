import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUrl, parseModelResponse, fetchModel, fetchAll, summarizeErrors, HOURLY } from '../js/weather.js';
import { MODELS } from '../js/models.js';
import { syntheticResponse, makeDemoFetch } from '../js/demo.js';

// Muistinvarainen localStorage (Node:ssa sitä ei ole)
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
test.beforeEach(() => mem.clear());

const NOW = Date.UTC(2026, 9, 14, 17, 4);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ecmwf = MODELS.find((m) => m.key === 'ecmwf');
const dmi = MODELS.find((m) => m.key === 'dmi'); // valinnainen malli: virheellinen tunnus merkitään kuolleeksi
const icon = MODELS.find((m) => m.key === 'icon');

test('buildUrl sisältää tarvittavat parametrit ja pysyy lyhyenä', () => {
  const u = new URL(buildUrl(60.45181, 22.26661, 'icon_seamless'));
  assert.equal(u.hostname, 'api.open-meteo.com');
  assert.equal(u.searchParams.get('latitude'), '60.45'); // 2 desimaalia (≈1 km): riittää malleille eikä paljasta tarkkaa sijaintia
  assert.equal(u.searchParams.get('longitude'), '22.27');
  assert.equal(u.searchParams.get('models'), 'icon_seamless');
  assert.equal(u.searchParams.get('timezone'), 'auto');
  assert.equal(u.searchParams.get('wind_speed_unit'), 'ms');
  assert.equal(u.searchParams.get('forecast_days'), '7');
  assert.deepEqual(u.searchParams.get('hourly').split(','), HOURLY);
  assert.ok(u.href.length < 600);
});

test('parseModelResponse lukee sekä päätteettömät että päätteelliset avaimet', () => {
  const plain = syntheticResponse({ lat: 60.45, lon: 22.27, modelId: 'icon_seamless', nowMs: NOW });
  const a = parseModelResponse(plain, 'icon_seamless');
  assert.equal(a.time.length, 168);
  assert.equal(a.tz, 'Europe/Helsinki');
  assert.equal(a.vars.temperature_2m.length, 168);

  const suffixed = structuredClone(plain);
  for (const k of HOURLY) {
    suffixed.hourly[`${k}_icon_seamless`] = suffixed.hourly[k];
    delete suffixed.hourly[k];
  }
  const b = parseModelResponse(suffixed, 'icon_seamless');
  assert.deepEqual(b.vars.temperature_2m, a.vars.temperature_2m);
});

test('parseModelResponse hylkää tyhjän tai lämpötilattoman vastauksen', () => {
  assert.throws(() => parseModelResponse({}, 'x'), /tuntidataa/);
  assert.throws(() => parseModelResponse({ hourly: { time: ['2026-10-14T00:00'], temperature_2m: [null] } }, 'x'), /lämpötiloja/);
  const j = { hourly: { time: ['2026-10-14T00:00'], temperature_2m: [5] }, timezone: 'Europe/Helsinki' };
  const ok = parseModelResponse(j, 'x');
  assert.equal(ok.vars.precipitation, null); // puuttuva muuttuja ei kaada
});

test('REGRESSIO: Open-Meteon "edellisen tunnin" suureet siirretään, jotta tunti 14 tarkoittaa väliä 14–15', () => {
  // Aikaleima 15:00 + sade 5 mm tarkoittaa, että sade tuli välillä 14–15, joten se kuuluu tuntiriville 14.
  const time = ['2026-10-14T13:00', '2026-10-14T14:00', '2026-10-14T15:00', '2026-10-14T16:00'];
  const j = {
    timezone: 'Europe/Helsinki',
    hourly: {
      time,
      temperature_2m: [5, 5, 5, 5],
      relative_humidity_2m: [80, 80, 80, 80],
      precipitation: [0, 0, 5, 0],
      wind_gusts_10m: [8, 8, 14, 8],
      weather_code: [3, 3, 63, 3],
      precipitation_probability: [10, 10, 90, 10],
      uv_index: [0, 0, 2, 0],
    },
  };
  const d = parseModelResponse(j, 'x');
  assert.deepEqual(d.vars.precipitation, [0, 5, 0, null]);
  assert.deepEqual(d.vars.wind_gusts_10m, [8, 14, 8, null]);
  assert.deepEqual(d.vars.weather_code, [3, 63, 3, null]);
  assert.deepEqual(d.vars.precipitation_probability, [10, 90, 10, null]);
  assert.deepEqual(d.vars.uv_index, [0, 2, 0, null]);
  // hetkellisiä suureita ei siirretä
  assert.deepEqual(d.vars.temperature_2m, [5, 5, 5, 5]);
  assert.deepEqual(d.vars.relative_humidity_2m, [80, 80, 80, 80]);
});

test('malliluettelossa ei ole Ilmatieteen laitoksen mallia (fmi_seamless ei ole Open-Meteossa) ja DMI on valinnainen', () => {
  assert.equal(MODELS.some((m) => m.ids.includes('fmi_seamless')), false);
  assert.equal(dmi.optional, true);
  assert.ok(dmi.maxLat < 70);
});

test('pohjoinen malli ohitetaan hiljaa paikoissa, joita se ei kata (ei verkkokutsua)', async () => {
  let calls = 0;
  const r = await fetchModel(dmi, 68.9, 27.0, { fetchFn: async () => { calls++; return json({}); }, now: NOW });
  assert.equal(r.coverage, true);
  assert.equal(r.ok, false);
  assert.equal(calls, 0);
});

test('fetchModel hakee mallin ja kutsuu oikeaa osoitetta', async () => {
  const urls = [];
  const fetchFn = makeDemoFetch({ nowMs: NOW, log: (u) => urls.push(u) });
  const r = await fetchModel(icon, 60.45, 22.27, { fetchFn, now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.id, 'icon_seamless');
  assert.equal(urls.length, 1);
  assert.ok(urls[0].includes('models=icon_seamless'));
});

test('fetchModel kokeilee varatunnusta, kun ensimmäinen hylätään (HTTP 400)', async () => {
  const seen = [];
  const fetchFn = async (url) => {
    const id = new URL(url).searchParams.get('models');
    seen.push(id);
    if (id === 'ecmwf_ifs') return json({ error: true, reason: 'Cannot initialize invalid value ecmwf_ifs' }, 400);
    return json(syntheticResponse({ lat: 60.45, lon: 22.27, modelId: id, nowMs: NOW }));
  };
  const r = await fetchModel(ecmwf, 60.45, 22.27, { fetchFn, now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.id, 'ecmwf_ifs025');
  assert.deepEqual(seen, ['ecmwf_ifs', 'ecmwf_ifs025']);
  // muistaa toimivan tunnuksen ja menee suoraan siihen
  seen.length = 0;
  await fetchModel(ecmwf, 60.45, 22.27, { fetchFn, now: NOW });
  assert.deepEqual(seen, ['ecmwf_ifs025']);
});

test('fetchModel ei heitä virheestä: HTTP 500, ei-JSON, verkkovirhe, aikakatkaisu', async () => {
  const r500 = await fetchModel(icon, 60, 22, { fetchFn: async () => new Response('Internal error', { status: 500 }) });
  assert.equal(r500.ok, false);
  assert.match(r500.error, /HTTP 500/);

  const rHtml = await fetchModel(icon, 60, 22, { fetchFn: async () => new Response('<html>', { status: 200 }) });
  assert.equal(rHtml.ok, false);
  assert.match(rHtml.error, /JSON/);

  const rNet = await fetchModel(icon, 60, 22, {
    fetchFn: async () => {
      throw new TypeError('Failed to fetch');
    },
  });
  assert.equal(rNet.ok, false);
  assert.match(rNet.error, /Failed to fetch/);

  const rLimit = await fetchModel(icon, 60, 22, { fetchFn: async () => json({ error: true, reason: 'Daily API request limit exceeded.' }, 429) });
  assert.equal(rLimit.ok, false);
  assert.match(rLimit.error, /limit/);

  const rTimeout = await fetchModel(icon, 60, 22, {
    timeoutMs: 20,
    fetchFn: (url, { signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' })));
      }),
  });
  assert.equal(rTimeout.ok, false);
  assert.match(rTimeout.error, /Aikakatkaisu/);
});

test('valinnainen malli, jota ei ole, ohitetaan seuraavilla kerroilla', async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    return json({ error: true, reason: 'Cannot initialize MultiDomains from invalid String value dmi_harmonie_arome_europe' }, 400);
  };
  const first = await fetchModel(dmi, 60, 22, { fetchFn, now: NOW });
  assert.equal(first.ok, false);
  assert.equal(calls, 1);
  const second = await fetchModel(dmi, 60, 22, { fetchFn, now: NOW + 3600000 });
  assert.equal(second.skipped, true);
  assert.equal(calls, 1);
  const later = await fetchModel(dmi, 60, 22, { fetchFn, now: NOW + 13 * 3600000 });
  assert.equal(later.skipped, undefined);
  assert.equal(calls, 2);
});

test('fetchAll palauttaa tuloksen jokaiselle mallille eikä koskaan hylkää', async () => {
  const all = await fetchAll(60.45, 22.27, {
    fetchFn: async () => {
      throw new Error('ei verkkoa');
    },
    now: NOW,
  });
  assert.equal(all.length, MODELS.length);
  assert.ok(all.every((r) => r.ok === false));
  assert.match(summarizeErrors(all), /ei verkkoa/);

  const good = await fetchAll(60.45, 22.27, { fetchFn: makeDemoFetch({ nowMs: NOW }), now: NOW });
  const okIds = good.filter((r) => r.ok).map((r) => r.model.key);
  assert.ok(okIds.includes('ecmwf') && okIds.includes('icon') && okIds.includes('gfs'));
  assert.equal(good.length, MODELS.length);
  assert.ok(good.every((r) => r.ok), 'esimerkkidata vastaa jokaiselle mallille');
});

test('REGRESSIO: fetchAll rajoittaa samanaikaiset kutsut (puhelimessa GFS kaatui "Too many concurrent requests")', async () => {
  let inFlight = 0;
  let peak = 0;
  const fetchFn = async (url) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight--;
    const id = new URL(url).searchParams.get('models');
    return json(syntheticResponse({ lat: 60.45, lon: 22.27, modelId: id, nowMs: NOW }));
  };
  const all = await fetchAll(60.45, 22.27, { fetchFn, now: NOW });
  assert.equal(all.length, MODELS.length);
  assert.deepEqual(all.map((r) => r.model.key), MODELS.map((m) => m.key), 'järjestys muuttui');
  assert.ok(all.every((r) => r.ok));
  assert.ok(peak <= 3, `samanaikaisia kutsuja ${peak}`);
  assert.ok(peak >= 2, 'rinnakkaisuutta ei käytetty lainkaan');
});

test('fetchModel yrittää uudelleen, kun rajapinta vastaa "Too many concurrent requests"', async () => {
  let calls = 0;
  const waits = [];
  const fetchFn = async () => {
    calls++;
    if (calls <= 2) return json({ error: true, reason: 'Too many concurrent requests' }, 429);
    return json(syntheticResponse({ lat: 60.45, lon: 22.27, modelId: 'icon_seamless', nowMs: NOW }));
  };
  const r = await fetchModel(icon, 60.45, 22.27, { fetchFn, now: NOW, sleepFn: async (ms) => waits.push(ms) });
  assert.equal(r.ok, true);
  assert.equal(calls, 3);
  assert.equal(waits.length, 2);
  assert.ok(waits.every((ms) => ms >= 300 && ms < 1200), `odotukset ${waits}`);
});

test('fetchModel luovuttaa, jos rajapinta pysyy kiireisenä, eikä yritä uudelleen päivärajan ylityttyä', async () => {
  let calls = 0;
  const busy = async () => {
    calls++;
    return json({ error: true, reason: 'Too many concurrent requests' }, 429);
  };
  const r = await fetchModel(icon, 60, 22, { fetchFn: busy, sleepFn: async () => {} });
  assert.equal(r.ok, false);
  assert.match(r.error, /concurrent/);
  assert.equal(calls, 3); // ensimmäinen kutsu + 2 uudelleenyritystä

  calls = 0;
  const daily = async () => {
    calls++;
    return json({ error: true, reason: 'Daily API request limit exceeded. Please try again tomorrow.' }, 429);
  };
  const r2 = await fetchModel(icon, 60, 22, { fetchFn: daily, sleepFn: async () => {} });
  assert.equal(r2.ok, false);
  assert.equal(calls, 1);
});

test('REGRESSIO: alueellinen malli, joka ei kata paikkaa, ei ole virhe eikä "kuollut"', async () => {
  const metno = MODELS.find((m) => m.key === 'metno');
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    return json({ error: true, reason: 'No data is available for this location' }, 400);
  };
  const r = await fetchModel(metno, 37.9787, -0.6822, { fetchFn, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.coverage, true);
  assert.match(r.error, /ei kata/);
  assert.equal(calls, 1);
  // valinnainen malli ilman kattavuutta ei merkitse mallia poistuneeksi
  const r2 = await fetchModel(dmi, 37.9787, -0.6822, { fetchFn, now: NOW });
  assert.equal(r2.coverage, true);
  const r3 = await fetchModel(dmi, 37.9787, -0.6822, { fetchFn, now: NOW + 1000 });
  assert.equal(r3.skipped, undefined);
  assert.equal(calls, 3);
  assert.equal(summarizeErrors([r, r2, r3]), 'Ei virheitä');
});

test('fetchAll: aikaraja palauttaa jo saadut mallit ja merkitsee loput aikakatkaistuiksi', async () => {
  const slow = new Set(['gfs_seamless', 'gem_seamless', 'ukmo_seamless', 'meteofrance_seamless', 'icon_seamless']);
  const fetchFn = (url, { signal } = {}) => {
    const id = new URL(url).searchParams.get('models');
    if (!slow.has(id)) return Promise.resolve(json(syntheticResponse({ lat: 60.45, lon: 22.27, modelId: id, nowMs: NOW })));
    return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' }))));
  };
  const t0 = Date.now();
  const res = await fetchAll(60.45, 22.27, { fetchFn, now: NOW, deadlineMs: 80, timeoutMs: 5000, concurrency: 3 });
  assert.ok(Date.now() - t0 < 2000, 'aikaraja ei katkaissut hakua');
  assert.equal(res.length, MODELS.length);
  assert.ok(res.some((r) => r.ok), 'nopeat mallit pitää säilyä');
  const late = res.filter((r) => !r.ok && !r.coverage);
  assert.ok(late.length > 0 && late.every((r) => r.kind === 'timeout' && /Aikakatkaisu/.test(r.error)), JSON.stringify(late.map((r) => [r.model.key, r.kind, r.error])));
});

test('fetchAll: ulkoinen peruutus keskeyttää haun eikä käynnistä uusia kutsuja', async () => {
  let calls = 0;
  const fetchFn = (url, { signal } = {}) => {
    calls++;
    return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' }))));
  };
  const ctl = new AbortController();
  const p = fetchAll(60.45, 22.27, { fetchFn, now: NOW, signal: ctl.signal, concurrency: 3, deadlineMs: 0 });
  await new Promise((r) => setTimeout(r, 20));
  ctl.abort();
  const res = await p;
  assert.ok(calls <= 3, `peruutuksen jälkeen kutsuttiin vielä: ${calls}`);
  assert.equal(res.length, MODELS.length);
  assert.ok(res.every((r) => !r.ok));
  assert.ok(res.filter((r) => !r.coverage).every((r) => r.kind === 'aborted'), JSON.stringify(res.map((r) => r.kind)));
});

test('peruutettu valinnainen malli ei merkitse mallia kuolleeksi', async () => {
  const ctl = new AbortController();
  const fetchFn = (url, { signal } = {}) => new Promise((_, reject) => signal?.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' }))));
  const p = fetchModel(dmi, 60.45, 22.27, { fetchFn, now: NOW, signal: ctl.signal, timeoutMs: 5000 });
  ctl.abort();
  const r = await p;
  assert.equal(r.kind, 'aborted');
  assert.equal(mem.get('saaaly.dead'), undefined, 'peruutus ei saa jättää mallia kuolleeksi');
});

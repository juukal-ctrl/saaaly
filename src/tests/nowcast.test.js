import test from 'node:test';
import assert from 'node:assert/strict';
import { nowcastUrl, parseNowcast, summarizeNowcast, intensityWord, fetchNowcast, STALE_MIN } from '../js/nowcast.js';

const T0 = Date.parse('2026-11-17T12:00:00Z');
const MIN = 60000;

/** MET Nowcast 2.0 -vastauksen muotoinen aineisto: yksi arvo viiden minuutin välein alkaen hetkestä start. */
function mk(rates, { start = T0, coverage = 'ok', updated = start } = {}) {
  return {
    type: 'Feature',
    properties: {
      meta: { updated_at: new Date(updated).toISOString(), radar_coverage: coverage },
      timeseries: rates.map((r, i) => ({ time: new Date(start + i * 5 * MIN).toISOString(), data: { instant: { details: { precipitation_rate: r, air_temperature: 3.1 } } } })),
    },
  };
}
const zeros = (n) => Array(n).fill(0);
const sum = (rates, now) => summarizeNowcast(parseNowcast(mk(rates)), now);

test('nowcastUrl pyöristää koordinaatit kahteen desimaaliin', () => {
  const u = new URL(nowcastUrl(60.451234, 22.266789));
  assert.equal(u.hostname, 'api.met.no');
  assert.equal(u.searchParams.get('lat'), '60.45');
  assert.equal(u.searchParams.get('lon'), '22.27');
});

test('parseNowcast: lukee askeleet ja jättää puuttuvan arvon pois (null ei ole nolla)', () => {
  const json = mk([0, 0.4, null, 'x', 1.2]);
  const nc = parseNowcast(json);
  assert.equal(nc.ok, true);
  assert.deepEqual(nc.steps.map((s) => s.rate), [0, 0.4, 1.2]);
  assert.equal(nc.updated, T0);
});

test('parseNowcast: tutkakattavuuden puute ei ole virhe vaan ok:false', () => {
  assert.deepEqual(parseNowcast(mk(zeros(25), { coverage: 'no coverage' })).ok, false);
  const r = parseNowcast(mk(zeros(25), { coverage: 'temporarily unavailable' }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /ei käytettävissä/);
});

test('parseNowcast: odottamaton rakenne heittää', () => {
  assert.throws(() => parseNowcast({}));
  assert.throws(() => parseNowcast({ properties: { timeseries: 'x' } }));
  assert.throws(() => parseNowcast(mk([0, 0])), /sadearvioita/);
});

test('kuiva koko jakson: ei sadetta seuraavaan 2 tuntiin', () => {
  const s = sum(zeros(25), T0 + MIN);
  assert.equal(s.ok, true);
  assert.equal(s.state, 'dry');
  assert.equal(s.startMin, null);
  assert.equal(s.line, 'Tutkan mukaan ei sadetta seuraavaan 2 tuntiin.');
});

test('sade alkaa 15 min päästä ja lasku etenee ajan mukana', () => {
  const rates = [0, 0, 0, 0.3, 0.3, 0.3, ...zeros(19)];
  const a = sum(rates, T0);
  assert.equal(a.state, 'dry');
  assert.equal(a.startMin, 15);
  assert.equal(a.word, 'heikkoa');
  assert.equal(a.line, 'Tutkan mukaan sade alkaa noin 15 min päästä (heikkoa).');
  assert.equal(sum(rates, T0 + 5 * MIN).startMin, 10); // sama ennuste, myöhempi hetki
  assert.equal(sum(rates, T0 + 10 * MIN + 30000).startMin, 5);
});

test('sade alkaa aivan pian, kun alkuun on enintään viisi minuuttia', () => {
  const s = sum([0, 0.6, 0.8, 0.6, ...zeros(21)], T0);
  assert.equal(s.startMin, 5);
  assert.match(s.line, /alkaa aivan pian \(kohtalaista\)/);
});

test('yksittäinen heikko märkä askel on kohinaa, mutta yli 1 mm/h yksittäinen kuuro ei', () => {
  assert.equal(sum([0, 0, 0.4, 0, 0, ...zeros(20)], T0).startMin, null);
  const s = sum([0, 0, 1.5, 0, 0, ...zeros(20)], T0);
  assert.equal(s.startMin, 10);
  assert.equal(s.word, 'kohtalaista');
});

test('sataa nyt ja päättyy: päättymisaika ja voimakkuus', () => {
  const s = sum([0.5, 0.5, 0.5, 0, 0, 0, ...zeros(19)], T0 + MIN);
  assert.equal(s.state, 'wet');
  assert.equal(s.endMin, 15);
  assert.equal(s.line, 'Sataa nyt (kohtalaista). Tutkan mukaan sade päättyy noin 15 min päästä.');
});

test('yhden askeleen tauko sateessa ei lopeta sadetta', () => {
  const s = sum([0.5, 0.5, 0, 0.5, 0.5, 0, 0, ...zeros(18)], T0);
  assert.equal(s.state, 'wet');
  assert.equal(s.endMin, 25); // vasta kahden kuivan askeleen jakso (askel 5) päättää sateen
});

test('sade jatkuu koko ennustejakson', () => {
  const s = sum(Array(25).fill(2.0), T0 + 2 * MIN);
  assert.equal(s.state, 'wet');
  assert.equal(s.endMin, null);
  assert.equal(s.word, 'kohtalaista');
  assert.match(s.line, /Sataa nyt \(kohtalaista\)\. Tutkan mukaan sade jatkuu ainakin seuraavat 2 tuntia\./);
});

test('sade on loppumassa, kun loppuun on enintään viisi minuuttia', () => {
  const s = sum([0.6, 0.6, 0, 0, ...zeros(21)], T0 + 6 * MIN);
  assert.equal(s.state, 'wet');
  assert.match(s.line, /sade on loppumassa/);
});

test('vanhentunut ennuste ja ennustejakson ohittanut hetki eivät anna tulosta', () => {
  const nc = parseNowcast(mk(zeros(25)));
  const old = summarizeNowcast(nc, T0 + (STALE_MIN + 1) * MIN);
  assert.equal(old.ok, false);
  assert.equal(old.stale, true);
  assert.equal(summarizeNowcast(nc, T0 + 3 * 60 * MIN).ok, false);
});

test('summarizeNowcast ei heitä tyhjästä eikä ok:false-syötteestä', () => {
  assert.equal(summarizeNowcast(null).ok, false);
  assert.equal(summarizeNowcast({ ok: false, reason: 'ei tutkakattavuutta' }).reason, 'ei tutkakattavuutta');
  assert.equal(summarizeNowcast({ ok: true, steps: [] }).ok, false);
});

test('intensityWord rajat', () => {
  assert.deepEqual([0.2, 0.5, 4, 8].map(intensityWord), ['heikkoa', 'kohtalaista', 'runsasta', 'rankkaa']);
});

test('fetchNowcast: onnistunut haku käyttää vain Accept-otsikkoa (ei CORS-esitarkistusta)', async () => {
  let seen;
  const fetchFn = async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, json: async () => mk(zeros(25)) };
  };
  const nc = await fetchNowcast(60.4518, 22.2666, { fetchFn });
  assert.equal(nc.ok, true);
  assert.match(seen.url, /lat=60\.45&lon=22\.27$/);
  assert.deepEqual(Object.keys(seen.init.headers), ['Accept']);
});

test('fetchNowcast: 422 tarkoittaa ettei paikkaa katettu (ei virhe), 403 ja 500 ovat virheitä', async () => {
  const resp = (status) => async () => ({ ok: status < 400, status, json: async () => ({}) });
  assert.equal((await fetchNowcast(1, 2, { fetchFn: resp(422) })).ok, false);
  await assert.rejects(fetchNowcast(1, 2, { fetchFn: resp(403) }), (e) => e.status === 403);
  await assert.rejects(fetchNowcast(1, 2, { fetchFn: resp(500) }), /HTTP 500/);
});

test('fetchNowcast: aikakatkaisu ja ulkoinen peruutus', async () => {
  const hang = (url, { signal }) =>
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  await assert.rejects(fetchNowcast(1, 2, { fetchFn: hang, timeoutMs: 20 }), /aikakatkaisu/);
  const ctl = new AbortController();
  const p = fetchNowcast(1, 2, { fetchFn: hang, timeoutMs: 5000, signal: ctl.signal });
  setTimeout(() => ctl.abort(), 10);
  await assert.rejects(p, (e) => e.name === 'AbortError' && e.cancelled === true);
});

test('fetchNowcast: verkkovirhe (esim. CORS-esto) heitetään kutsujalle', async () => {
  await assert.rejects(fetchNowcast(1, 2, { fetchFn: async () => Promise.reject(new TypeError('Failed to fetch')) }), /Failed to fetch/);
});

test('esimerkkitilan tutkadata on kelvollista ja vastaa skenaariota', async () => {
  const { syntheticNowcast } = await import('../js/demo.js');
  const at = Date.parse('2026-10-14T14:04:00+03:00');
  const rain = summarizeNowcast(parseNowcast(syntheticNowcast({ lat: 60.45, lon: 22.27, nowMs: at, scenario: 'rain' })), at);
  assert.equal(rain.state, 'wet');
  assert.equal(rain.endMin, null); // sade jatkuu koko ennustejakson
  const clear = summarizeNowcast(parseNowcast(syntheticNowcast({ lat: 60.45, lon: 22.27, nowMs: at, scenario: 'clear' })), at);
  assert.equal(clear.state, 'dry');
  assert.equal(clear.startMin, null);
  const mixed = summarizeNowcast(parseNowcast(syntheticNowcast({ lat: 60.45, lon: 22.27, nowMs: at, scenario: 'mixed' })), at);
  assert.equal(mixed.state, 'dry'); // sekaskenaarion sade alkaa vasta huomenna
  const abroad = parseNowcast(syntheticNowcast({ lat: 48.85, lon: 2.35, nowMs: at }));
  assert.equal(abroad.ok, false); // Pariisi on tutkakattavuuden ulkopuolella
});

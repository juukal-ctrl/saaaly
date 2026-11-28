// Koodikatselmoinnin löydökset: jokainen testi kaatui ennen korjausta. Ajetaan sekä TZ=UTC että TZ=Europe/Helsinki.
import test from 'node:test';
import assert from 'node:assert/strict';
import { alertsHtml } from '../js/views.js';
import { blendForecast, nowPosition, modelRows, windowPopPm } from '../js/blend.js';
import { parseModelResponse } from '../js/weather.js';
import { summarizeNowcast } from '../js/nowcast.js';
import { searchPlaces } from '../js/geo.js';
import { resolveWindow } from '../js/answer.js';
import { parseQuestion } from '../js/nlu.js';

test('varoitusrivin tarkistusaika näytetään paikan aikavyöhykkeessä, ei laitteen', () => {
  const now = Date.UTC(2026, 10, 26, 9, 45);
  // Helsinki (oletus): 2.24 UTC = 4.24 paikallista, sama päivä
  assert.match(alertsHtml({ checkedAt: Date.UTC(2026, 10, 26, 2, 24), nowMs: now }), /Varoitustieto klo 4\.24 /);
  assert.match(alertsHtml({ checkedAt: Date.UTC(2026, 10, 26, 2, 24), nowMs: now, tz: 'Europe/Helsinki' }), /Varoitustieto klo 4\.24 /);
  // Päivä vaihtuu paikan mukaan: 21.30 UTC 25.11. on Helsingissä jo 26.11. (sama päivä kuin nyt), UTC:ssä edellinen päivä
  assert.match(alertsHtml({ checkedAt: Date.UTC(2026, 10, 25, 22, 30), nowMs: now, tz: 'Europe/Helsinki' }), /Varoitustieto klo 0\.30 /);
  assert.match(alertsHtml({ checkedAt: Date.UTC(2026, 10, 25, 22, 30), nowMs: now, tz: 'UTC' }), /Varoitustieto 25\.11\. klo 22\.30 /);
});

// ---------- Yhdistelmä: tunnit, joilta kaikilta malleilta puuttuu lämpötila ----------

/** Käsintehty malli Helsingin ajassa 14.10.2026 klo 00 alkaen. temps: lämpötila tunneittain (null = puuttuu). */
function hand(key, temps, { precip = null, weight = 1, lead = null } = {}) {
  const time = temps.map((_, h) => `2026-10-${14 + Math.floor(h / 24)}T${String(h % 24).padStart(2, '0')}:00`);
  const fill = (v) => time.map(() => v);
  const json = {
    latitude: 60.17, longitude: 24.94, timezone: 'Europe/Helsinki', utc_offset_seconds: 10800,
    hourly: { time, temperature_2m: temps, precipitation: precip || fill(0), cloud_cover: fill(50), wind_speed_10m: fill(3), wind_gusts_10m: fill(5), wind_direction_10m: fill(225) },
  };
  const model = { key, ids: [key], label: key, short: key, weight, ...(lead ? { lead } : {}) };
  return { model, ok: true, id: key, data: parseModelResponse(json, key), ms: 1 };
}

test('mallivertailu lukee mallin arvon samalta tunnilta kuin yhdistelmä, vaikka välistä puuttuu tunti', () => {
  const temps = (base) => Array.from({ length: 30 }, (_, h) => (h === 2 ? null : base + h));
  const results = [hand('a', temps(0)), hand('b', temps(10))];
  const fc = blendForecast(results, { nowMs: Date.UTC(2026, 9, 13, 21, 0) });
  assert.equal(fc.hours[2].t, '2026-10-14T03:00'); // klo 02 puuttuu kummaltakin mallilta
  const rows = modelRows(results, fc, 2, 0, fc.hours[2].temp);
  assert.equal(rows[0].temp, 3, 'mallin a lämpötila klo 03');
  assert.equal(rows[1].temp, 13, 'mallin b lämpötila klo 03');
  assert.ok(Math.abs(rows[0].delta + 5) < 1e-9);
});

test('nykyhetki puuttuvalla tunnilla on edeltävä tunti, ei ennusteen viimeinen tunti', () => {
  const temps = Array.from({ length: 30 }, (_, h) => (h === 2 ? null : h));
  const fc = blendForecast([hand('a', temps), hand('b', temps)], { nowMs: Date.UTC(2026, 9, 13, 21, 0) });
  const np = nowPosition(fc, Date.UTC(2026, 9, 13, 23, 30)); // klo 02.30 Helsingissä
  assert.equal(fc.hours[np.idx].t, '2026-10-14T01:00');
  assert.equal(nowPosition(fc, Date.UTC(2026, 9, 13, 12, 0)).idx, 0, 'ennen ennusteen alkua: ensimmäinen tunti');
  assert.equal(nowPosition(fc, Date.UTC(2026, 9, 20, 12, 0)).idx, fc.hours.length - 1, 'ennusteen jälkeen: viimeinen tunti');
});

test('päivän sateen todennäköisyys painottaa malleja ennusteen iän mukaan kuten sadejaksot', () => {
  const temps = Array.from({ length: 72 }, () => 5);
  const wet = temps.map((_, h) => (h >= 24 && h < 48 ? 1 : 0));
  // a painaa lähitunneilla, b kauempana. Nyt on 15.10. klo 06, joten 15.10. on lähituntia (ikä 0 h), ei 24 h vanhaa ennustetta.
  const a = hand('a', temps, { precip: wet, lead: [2, 0.1, 0.1, 0.1] });
  const b = hand('b', temps, { lead: [0.1, 2, 2, 2] });
  const fc = blendForecast([a, b], { nowMs: Date.UTC(2026, 9, 15, 3, 0) });
  assert.equal(fc.lead0, 30);
  const d = fc.days.find((x) => x.date === '2026-10-15');
  assert.ok(Math.abs(d.pwin - 2 / 2.1) < 1e-9, `pwin ${d.pwin}`);
  assert.ok(Math.abs(d.pwin - windowPopPm(fc.pm, d.from, d.to, 0.3, fc.lead0)) < 1e-12);
});

// ---------- Tutkaennuste ----------

test('tutkaennuste: alkavan sateen voimakkuus ja määrä tunnin ajalta myös 15 minuutin askeleilla', () => {
  const T0 = Date.parse('2026-11-17T12:00:00Z');
  const rates = [0, 0, 2, 2, 2, 2, 8, 8]; // 15 min välein, sade alkaa 30 min päästä, rankka sade vasta tunnin kuluttua
  const nc = { ok: true, updated: T0, steps: rates.map((rate, i) => ({ t: T0 + i * 15 * 60000, rate })) };
  const s = summarizeNowcast(nc, T0 + 60000);
  assert.equal(s.state, 'dry');
  assert.equal(s.startMin, 30);
  assert.equal(s.peak, 2);
  assert.equal(s.mm, 2);
  assert.equal(s.word, 'kohtalaista');
});

// ---------- Paikkahaku ----------

test('paikkahaku ohittaa rikkinäiset rivit eikä kaadu tyhjään vastaukseen', async () => {
  const json = (body) => async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  assert.deepEqual(await searchPlaces('Oulu', { fetchFn: json(null) }), []);
  assert.deepEqual(await searchPlaces('Oulu', { fetchFn: json({ results: 'x' }) }), []);
  const list = await searchPlaces('Oulu', {
    fetchFn: json({ results: [{ name: 'Oulu', latitude: 65.01, longitude: 25.47, country: 'Suomi' }, { name: 'Rikki' }, { name: 'Rikki2', latitude: null, longitude: 25 }, null, { latitude: 60, longitude: 25 }] }),
  });
  assert.deepEqual(list.map((p) => p.name), ['Oulu']);
});

// ---------- Chatin ajankohdat ----------

test('kysytty tunti, joka puuttuu ennusteen keskeltä, ei ole "ennusteen ulkopuolella"', () => {
  const temps = Array.from({ length: 48 }, (_, h) => (h === 3 ? null : h));
  const fc = blendForecast([hand('a', temps), hand('b', temps)], { nowMs: Date.UTC(2026, 9, 13, 21, 0) });
  const now = Date.UTC(2026, 9, 13, 22, 10); // 14.10. klo 01.10 Helsingissä
  const w = resolveWindow(parseQuestion('Paljonko on lämpöä klo 3?', { nowHour: 1 }), fc, now);
  assert.equal(w.beyond, false);
  assert.equal(fc.hours[w.from].t, '2026-10-14T04:00');
  const r = resolveWindow(parseQuestion('Lämpötila klo 2-5?', { nowHour: 1 }), fc, now);
  assert.deepEqual([fc.hours[r.from].t, fc.hours[r.to].t, r.beyond, r.clipped], ['2026-10-14T02:00', '2026-10-14T04:00', false, false]);
});

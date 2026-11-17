import test from 'node:test';
import assert from 'node:assert/strict';
import { modelsHtml } from '../js/views.js';
import { blendForecast } from '../js/blend.js';
import { MODELS } from '../js/models.js';
import { parseModelResponse } from '../js/weather.js';
import { syntheticResponse } from '../js/demo.js';

const NOW = Date.UTC(2026, 9, 14, 17, 4);

/** Kaikki muut mallit vastaavat paitsi `special`-avaimilla annetut, joille annetaan virhetila. */
function results(special = {}) {
  return MODELS.map((m) => {
    if (special[m.key]) return { model: m, ok: false, ...special[m.key] };
    const id = m.ids[0];
    return { model: m, ok: true, id, data: parseModelResponse(syntheticResponse({ lat: 60.45, lon: 22.27, modelId: id, nowMs: NOW }), id), ms: 5 };
  });
}

test('mallivertailu erottaa "ei kata paikkaa" ja "ei vastannut" toisistaan', () => {
  const res = results({ metno: { coverage: true, error: 'Malli ei kata tätä paikkaa' }, gfs: { error: 'Too many concurrent requests' } });
  const fc = blendForecast(res);
  const html = modelsHtml({ results: res, fc, nowMs: NOW });
  assert.match(html, /MET Nordic<\/th><td colspan="3">ei kata tätä paikkaa<\/td>/);
  assert.match(html, /GFS<\/th><td colspan="3">ei vastannut<small>Too many concurrent requests<\/small>/);
  assert.match(html, /6\/7 mallia/);
});

// ---------- Sääkaavio ----------
import { meteoHtml, nightSpans } from '../js/views.js';
import { meteogram, RANGES } from '../js/meteogram.js';

function mgHours(n = 170) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2026, 9, 14, 12 + i));
    const t = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}:00`;
    const h = d.getUTCHours();
    out.push({ t, temp: 8 + 4 * Math.sin((i / 24) * 6.283), tLo: 7 + 4 * Math.sin((i / 24) * 6.283), tHi: 9.5 + 4 * Math.sin((i / 24) * 6.283), precip: i === 5 ? 2.4 : 0, precipHi: i === 5 ? 3.5 : 0, pop: i === 5 ? 0.8 : 0, snowShare: 0, wind: 5 + (i % 7), gust: 9 + (i % 7), dir: 200, sym: i === 5 ? 'rain' : 'partly_cloudy', isDay: h >= 6 && h < 20 });
  }
  return out;
}

test('meteogram: jokainen aikaväli piirtyy ilman virhettä ja sisältää käyrän, sadepalkit ja tuulinuolet', () => {
  for (const range of Object.keys(RANGES)) {
    const m = meteogram(mgHours(), { range, width: 360, nowFrac: 0.3, night: [] });
    assert.match(m.svg, /^<svg class="mg"/);
    assert.ok(m.svg.includes('class="mg-line"') && m.svg.includes('class="mg-rain"') && m.svg.includes('mg-arrow'), range);
    assert.ok(m.bins.length >= 24, `${range}: ${m.bins.length} jaksoa`);
    assert.ok(!/NaN|undefined|Infinity/.test(m.svg), `${range}: SVG sisältää virheellisiä lukuja`);
  }
});

test('REGRESSIO: sadepalkki rivistä j kuuluu jaksoon j (rivi kattaa välin [t_j, t_j+1 h)), ei seuraavaan', () => {
  const hours = mgHours();
  const m = meteogram(hours, { range: '24h', width: 360 });
  const wet = m.bins.map((b, j) => [j, b.precip]).filter(([, p]) => p > 0);
  assert.deepEqual(wet, [[5, 2.4]]);
  assert.equal(m.bins[5].t, hours[5].t);
  assert.match(m.readout(5).when, /klo 17–18$/); // 12 UTC + 5 h = 17:00 (aika on annettu sellaisenaan)
});

test('meteogram: tarkastuskohta annetaan hetkenä ja löytyy, vaikka indeksi on siirtynyt', () => {
  const hours = mgHours();
  const a = meteogram(hours, { range: '24h', width: 360, inspectIso: hours[8].t });
  const b = meteogram(hours.slice(2), { range: '24h', width: 360, inspectIso: hours[8].t });
  assert.equal(a.inspect, 8);
  assert.equal(b.inspect, 6);
  assert.equal(meteogram(hours, { range: '24h', width: 360, inspectIso: '2000-01-01T00:00' }).inspect, null);
});

test('nightSpans palauttaa yöjaksot ja meteoHtml antaa saavutettavan tarkastuspalkin, taulukon ja aikavälipainikkeet', () => {
  const hours = mgHours(48);
  const spans = nightSpans(hours);
  assert.ok(spans.length >= 1 && spans.every(([a, b]) => a < b || b.endsWith('23:59')));
  const fc = { hours: mgHours(60) };
  // meteoHtml käyttää nowPosition-funktiota: tehdään minimaalinen ennuste, jossa tz ja tunnit ovat mukana
  const html = meteoHtmlFor(fc);
  assert.match(html, /role="slider"/);
  assert.match(html, /aria-valuetext="[^"]+"/);
  assert.equal((html.match(/data-act="mg-range"/g) || []).length, 3);
  assert.match(html, /<details class="mg-table">/);
  assert.ok(!/<script|onerror=|javascript:/i.test(html));
});

function meteoHtmlFor(fc) {
  const nowMs = Date.UTC(2026, 9, 14, 9, 30); // 12:30 Helsingin aikaa
  return meteoHtml({ fc: { ...fc, tz: 'Europe/Helsinki' }, nowMs, range: '24h', width: 360 });
}

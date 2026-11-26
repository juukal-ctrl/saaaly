// 0.7: havaintoasema, lähteiden tila ja hämärän värit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseObs, obsUrl, fetchObs } from '../js/observations.js';
import { syntheticObs } from '../js/demo.js';
import { createGuard, memoryStorage, runSource, sourceLine } from '../js/sources.js';
import { mixLch, blobsFor } from '../js/sky.js';

const NOW = Date.UTC(2026, 10, 26, 9, 45);

test('havainto: WFS-vastauksesta luetaan aseman nimi ja viimeisin lämpötila', () => {
  const o = parseObs(syntheticObs({ lat: 60.45, lon: 22.27, nowMs: NOW, scenario: 'snow' }));
  assert.equal(o.name, 'Esimerkkiasema');
  assert.ok(Math.abs(o.value - -2.35) < 0.11, String(o.value));
  assert.ok(NOW - o.t < 11 * 60000);
  assert.match(obsUrl(60.45, 22.27, NOW), /^https:\/\/opendata\.fmi\.fi\/wfs\?.*storedquery_id=fmi%3A%3Aobservations%3A%3Aweather%3A%3Atimevaluepair.*latlon=60\.45%2C22\.27(&|$)/);
  assert.equal(parseObs('<a><b>ei arvoja</b></a>'), null);
});

test('havainto: kaukana oleva asema tai vanha arvo ei kelpaa', async () => {
  const xml = syntheticObs({ lat: 61.5, lon: 23.8, nowMs: NOW });
  const far = await fetchObs(60.45, 22.27, { now: NOW, fetchFn: async () => new Response(xml) });
  assert.equal(far.ok, false);
  assert.match(far.reason, /km päässä/);
  const near = await fetchObs(60.45, 22.27, { now: NOW, fetchFn: async () => new Response(syntheticObs({ lat: 60.45, lon: 22.27, nowMs: NOW })) });
  assert.equal(near.ok, true);
  assert.match(near.note, /Esimerkkiasema, \d km/);
});

test('lähteen tila: vastannut mutta käyttökelvoton tieto ei saa ✓-merkkiä', async () => {
  const g = createGuard({ storage: memoryStorage(), clock: () => NOW });
  const r = await runSource(g, 'warnings', async () => ({ ok: false, reason: 'peili on vanhentunut', fetchedAt: NOW - 7 * 3600000 }), { now: NOW });
  assert.equal(r.value, null);
  assert.equal(r.raw.fetchedAt, NOW - 7 * 3600000);
  assert.match(sourceLine('warnings', g.status('warnings'), NOW), /^! Viralliset varoitukset/);
  await runSource(g, 'obs', async () => ({ ok: true, note: 'Turku' }), { now: NOW });
  assert.match(sourceLine('obs', g.status('obs'), NOW), /^✓ Havainto/);
});

test('hämärä: värit sekoitetaan kylläisinä, ei harmaana välivaiheena', () => {
  const chroma = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b);
  const mid = mixLch([106, 79, 214], [255, 213, 138], 0.5); // yön violetti -> aamun persikka
  assert.ok(chroma(mid) > 60, `välivärin kylläisyys ${chroma(mid)}`);
  for (const alt of [-7, -6, -5, -4.5]) {
    const blobs = blobsFor(alt, true);
    const avg = blobs.reduce((a, b) => a + chroma(b[4]), 0) / blobs.length;
    assert.ok(avg > 50, `${alt}°: keskikylläisyys ${avg.toFixed(0)}`);
  }
});

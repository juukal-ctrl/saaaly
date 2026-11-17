// 0.3.2: UI/UX-arvioiden korjaukset: sateettoman ikkunan teksti, Tänään/Huomenna-valinta, varoitustilan rivit, paikannimen väärät osumat.

import test from 'node:test';
import assert from 'node:assert/strict';
import { verdict, verdictWindow } from '../js/advice.js';
import { alertsHtml, verdictHtml, CHAT_CHIPS } from '../js/views.js';
import { findOffline } from '../js/gazetteer.js';

const pad = (n) => String(n).padStart(2, '0');
function mkFc(n, wetFrom = 999) {
  const hours = Array.from({ length: n }, (_, i) => {
    const day = 14 + Math.floor(i / 24);
    const hr = i % 24;
    return { t: `2026-10-${pad(day)}T${pad(hr)}:00`, temp: 8, feels: 8, hum: 80, cloud: 80, wind: 3, gust: 5, gustHi: 6, dir: 225, precip: i >= wetFrom ? 1 : 0, pop: i >= wetFrom ? 0.9 : 0, popAgree: 0, popSrc: 'models', snowShare: 0, thunderShare: 0, frzShare: 0, uv: 0, sym: 'overcast', isDay: hr >= 8 && hr < 18 };
  });
  const pm = Array.from({ length: 7 }, () => ({ model: { weight: 1 }, p: hours.map((h) => h.precip) }));
  return { hours, pm, lead0: 0, tz: 'Europe/Helsinki', lat: 60.45 };
}
const at = (h, m = 0, d = 14) => Date.UTC(2026, 9, d, h - 3, m);

test('sateeton ikkuna kertoo mihin asti ja milloin seuraava sade tulee', () => {
  const fc = mkFc(72, 24); // sataa huomisesta 00 alkaen
  const v = verdict(fc, at(14, 4), { month: 10 });
  assert.match(v.chips[1].sub, /^ei sadetta klo \d+ asti · seuraava sade huomenna klo 00/);
  assert.ok(!v.chips.some((c) => /ei sadetta odotettavissa/.test(c.sub || '')));
  const dry = verdict(mkFc(72), at(13, 0), { month: 10 });
  assert.match(dry.chips[1].sub, /^ei sadetta klo \d+ asti$/);
});

test('Tänään/Huomenna pakottaa ikkunan', () => {
  const fc = mkFc(72);
  assert.equal(verdictWindow(fc, at(13, 0), 'tomorrow').kind, 'tomorrow');
  assert.equal(verdictWindow(fc, at(22, 0), 'today').kind !== 'tomorrow', true);
  assert.equal(verdictWindow(fc, at(22, 0)).kind, 'tomorrow');
  const v = verdict(fc, at(13, 0), { month: 10, window: 'tomorrow' });
  assert.match(v.win.caption, /^Huomenna klo 07/);
  const html = verdictHtml({ v });
  assert.match(html, /data-act="vday" data-day="tomorrow" aria-pressed="true"/);
  assert.match(html, /data-act="vday" data-day="today" aria-pressed="false"/);
  assert.ok(CHAT_CHIPS.includes('Mitä pukisin huomenna?'));
});

test('vastauskaistalla tutkalause on ruudukon jälkeen', () => {
  const v = verdict(mkFc(48), at(13, 0), { month: 10 });
  const html = verdictHtml({ v, nowcastLine: 'Tutkan mukaan ei sadetta' });
  assert.ok(html.indexOf('class="vgrid"') < html.indexOf('class="vnow"'));
});

test('huomiokaista: vakavin näkyy, loput tiivistettynä; tuntematon varoitustila kerrotaan', () => {
  const off = [1, 2, 3].map((i) => ({ severity: 'Moderate', title: `Varoitus ${i}`, when: 'tänään', text: 'x' }));
  const h = alertsHtml({ official: off });
  assert.equal((h.match(/class="alert off/g) || []).length, 3);
  assert.match(h, /more-alerts/);
  assert.match(h, /Lisäksi 2 huomiota/);
  assert.ok(h.indexOf('Varoitus 1') < h.indexOf('more-alerts'));
  assert.equal(alertsHtml({}), '');
  const u = alertsHtml({ officialState: 'unknown' });
  assert.match(u, /Virallisia varoituksia ei voitu tarkistaa/);
  assert.match(u, /ilmatieteenlaitos\.fi\/varoitukset/);
  assert.doesNotMatch(alertsHtml({ official: off, officialState: 'unknown' }), /ei voitu tarkistaa/);
});

test('paikannimi: "lapsen" ei ole Lapua, taivutetut paikat löytyvät yhä', () => {
  for (const w of ['lapsen', 'lasten', 'vanhan', 'lapsessa', 'kotona']) assert.equal(findOffline(w), null, w);
  const must = { lapuassa: 'Lapua', Rovanimellä: 'Rovaniemi', oulussa: 'Oulu', ouluun: 'Oulu', lahdessa: 'Lahti', turussa: 'Turku', Kotkassa: 'Kotka' };
  for (const [w, n] of Object.entries(must)) assert.equal(findOffline(w)?.name, n, w);
});

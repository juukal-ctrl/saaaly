// 0.3.2: UI/UX-arvioiden korjaukset: sateettoman ikkunan teksti, Tänään/Huomenna-valinta, varoitustilan rivit, paikannimen väärät osumat.

import test from 'node:test';
import assert from 'node:assert/strict';
import { verdict, verdictWindow } from '../js/advice.js';
import { alertsHtml, verdictHtml, CHAT_CHIPS } from '../js/views.js';
import { homeHeadline, hoursHeadline, weekHeadline, weekendLine, certaintyInfo } from '../js/headline.js';
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

test('Tänään/Huomenna pakottaa ikkunan (chatin ja huomioiden laskenta)', () => {
  const fc = mkFc(72);
  assert.equal(verdictWindow(fc, at(13, 0), 'tomorrow').kind, 'tomorrow');
  assert.equal(verdictWindow(fc, at(22, 0), 'today').kind !== 'tomorrow', true);
  const v = verdict(fc, at(13, 0), { month: 10, window: 'tomorrow' });
  assert.match(v.win.caption, /^Huomenna klo 07/);
  assert.ok(CHAT_CHIPS.includes('Mitä pukisin huomenna?'));
});

// ---------- 0.7: etusivun otsikko ----------

/** Kuten mkFc, mutta sateiset tunnit ovat mallien yhteistä sadetta (popAgree) ja ajanjaksoja voi olla useita. */
function mkWet(n, wet = () => false, extra = {}) {
  const fc = mkFc(n);
  fc.hours.forEach((h, i) => {
    if (wet(i)) Object.assign(h, { precip: 1, pop: 0.9, popAgree: 0.9 });
    Object.assign(h, extra);
  });
  fc.pm = Array.from({ length: 7 }, () => ({ model: { weight: 1 }, p: fc.hours.map((h) => h.precip) }));
  fc.days = [0, 1, 2].map((d) => ({ date: `2026-10-${14 + d}`, from: d * 24, to: d * 24 + 23, tmin: 6, tmax: 10, precip: 0, sym: 'overcast' }));
  return fc;
}

test('kuivana päivänä otsikko on takki ja todellinen kuiva jakso, ei ikkunan loppuaika', () => {
  const dry = homeHeadline(mkWet(72), at(13, 0), {});
  assert.equal(dry.l1, 'Ohut takki tai huppari.');
  assert.equal(dry.l2, 'Kuivaa koko päivän.');
  assert.equal(dry.small, 'Ei sadetta lähipäivinä.');
  assert.ok(!dry.wet);
  const night = homeHeadline(mkWet(72, (i) => i >= 24), at(14, 4), {});
  assert.equal(night.l2, 'Kuivaa keskiyöhön asti.');
  assert.doesNotMatch(`${night.l2} ${night.small}`, /klo 18 asti/);
  const morning = homeHeadline(mkWet(72, (i) => i >= 24), at(8, 0), {});
  assert.equal(morning.l2, 'Kuivaa koko päivän.');
  assert.equal(morning.small, 'Seuraava sade keskiyöllä.');
});

test('sade tulossa: sateenvarjo ensin ja oikea alkamisaika; takki pienellä rivillä', () => {
  const h = homeHeadline(mkWet(72, (i) => i >= 16 && i <= 19), at(13, 0), {});
  assert.equal(h.l1, 'Sateenvarjo mukaan.');
  assert.equal(h.l2, 'Sade alkaa klo 16.');
  assert.equal(h.small, 'Ohut takki tai huppari.');
});

test('sataa nyt: ei koskaan "alkaa", vaan kuinka pitkään sade jatkuu', () => {
  const h = homeHeadline(mkWet(72, (i) => i >= 10 && i <= 15), at(13, 0), {});
  assert.equal(h.l1, 'Sateenvarjo mukaan.');
  assert.equal(h.l2, 'Sade jatkuu klo 16 asti.');
  const long = homeHeadline(mkWet(72, (i) => i >= 10), at(23, 20), {});
  assert.doesNotMatch(long.l2, /alkaa/);
  const radar = homeHeadline(mkWet(72, (i) => i >= 10 && i <= 15), at(13, 0), { nowcast: { ok: true, state: 'wet', endMin: 30 } });
  assert.equal(radar.l2, 'Sade lakkaa noin 30 min kuluttua.');
});

test('huomenna-tila: otsikko kertoo huomisen päivästä', () => {
  const dry = homeHeadline(mkWet(72), at(13, 0), { day: 'tomorrow' });
  assert.equal(dry.kicker, 'Huomenna to 15.10.');
  assert.equal(dry.l2, 'Kuivaa koko päivän.');
  const wet = homeHeadline(mkWet(72, (i) => i >= 24), at(13, 0), { day: 'tomorrow' });
  assert.equal(wet.l1, 'Sateenvarjo mukaan.');
  assert.equal(wet.l2, 'Sataa koko päivän.');
});

test('tuntien otsikko: kuiva jakso ja sen jälkeinen sade', () => {
  assert.deepEqual(hoursHeadline(mkWet(72, (i) => i >= 16 && i <= 19), at(13, 0)), ['Kuivaa klo 16 asti.', 'Sitten sadetta klo 20 asti.']);
  assert.deepEqual(hoursHeadline(mkWet(72, (i) => i >= 10 && i <= 15), at(13, 0)), ['Sataa nyt.', 'Sade lakkaa klo 16.']);
  assert.equal(hoursHeadline(mkWet(72), at(13, 0))[0], 'Kuivaa koko vuorokauden.');
});

test('tuntien otsikko seuraa tutkaa kuten etusivu', () => {
  // Tutka: sade alkaa 20 min päästä; malli: sadetta klo 14–19.
  const fc = mkWet(72, (i) => i >= 14 && i <= 19);
  const soon = { ok: true, state: 'dry', startMin: 20, endMin: null, word: 'heikkoa' };
  assert.deepEqual(hoursHeadline(fc, at(13, 30), soon), ['Sade alkaa noin 20 min kuluttua.', 'Sadetta klo 20 asti.']);
  // Tutka: sataa nyt ja lakkaa 30 min päästä, vaikka malli sanoo kuivaa.
  const wet = { ok: true, state: 'wet', startMin: 0, endMin: 30, word: 'heikkoa' };
  assert.deepEqual(hoursHeadline(mkWet(72), at(13, 0), wet), ['Sataa nyt.', 'Sade lakkaa noin 30 min kuluttua.']);
  // Tutka: ei sada nyt eikä kahteen tuntiin: mallin kuluvan tunnin sade ei tee otsikosta "Sataa nyt".
  const dry = { ok: true, state: 'dry', startMin: null, endMin: null, word: '' };
  assert.equal(hoursHeadline(mkWet(72, (i) => i === 13), at(13, 10), dry)[0], 'Kuivaa koko vuorokauden.');
});

test('viikon otsikko: pakkasen hellittäminen, sadepäivät ja viikonloppu', () => {
  const d = (date, tmin, tmax, precip = 0, sym = 'overcast') => ({ date, tmin, tmax, precip, sym });
  const days = [d('2026-11-26', -5, -2), d('2026-11-27', -6, -2), d('2026-11-28', -6, 1), d('2026-11-29', 1, 4), d('2026-11-30', 3, 4, 1.4, 'rain_light'), d('2026-12-01', 4, 5, 0.8), d('2026-12-02', 5, 5, 1.8)];
  const [t, r] = weekHeadline(days, '2026-11-26');
  assert.equal(t, 'Pakkanen hellittää lauantaina.');
  assert.equal(r, 'Sadetta maanantaina ja keskiviikkona.');
  assert.equal(weekendLine(days, '2026-11-26'), 'Viikonloppuna: la −6°…+1°, su +1°…+4°.');
  const dryWeek = days.map((x) => ({ ...x, precip: 0, sym: 'clear' }));
  assert.equal(weekHeadline(dryWeek, '2026-11-26')[1], 'Kuivaa koko viikon.');
  assert.equal(weekHeadline([d('2026-11-26', 1, 2, 3, 'rain'), ...days.slice(1, 3)], '2026-11-26')[1], 'Tänään sadetta.');
});

test('varmuus: sama mittari tänään ja huomenna, ei ristiriitaisia sanoja', () => {
  const fc = mkWet(72, () => false, { sdT: 0.5, sdW: 0.5 });
  fc.modelsUsed = 7;
  fc.modelsTotal = 7;
  const c = certaintyInfo(fc, [], at(13, 0));
  assert.equal(c.l1, 'Tänään luotettava.');
  assert.equal(c.l2, 'Huomennakin luotettava.');
  assert.equal(c.today.agree, 'mallit samaa mieltä');
  const wide = mkWet(72, () => false, { sdT: 3.5, sdW: 0.5 });
  wide.modelsUsed = 7;
  wide.modelsTotal = 7;
  const w = certaintyInfo(wide, [], at(13, 0));
  assert.equal(w.l1, 'Tänään epävarma.');
  assert.doesNotMatch(JSON.stringify(w), /epävarma varmuus/);
});

test('etusivun otsikko piirretään ilman laatikoita ja painikkeita', () => {
  const html = verdictHtml({ hl: { l1: 'Talvitakki, pipo ja hanskat.', l2: 'Kuivaa koko päivän.', small: 'Seuraava sade ma klo 11.' } });
  assert.match(html, /class="vsay"><b>Talvitakki, pipo ja hanskat\.<\/b> <span>Kuivaa koko päivän\.<\/span>/);
  assert.match(html, /class="vsmall">Seuraava sade ma klo 11\./);
  assert.doesNotMatch(html, /<button/);
});

test('varoitusrivi: viralliset ensin, oma huomio katkoviivalla; vanha tai puuttuva tieto kerrotaan rauhallisesti', () => {
  const off = [1, 2, 3].map((i) => ({ severity: 'Moderate', title: `Varoitus ${i}`, when: 'tänään', text: 'x' }));
  const h = alertsHtml({ official: off });
  assert.equal((h.match(/class="alert off/g) || []).length, 3);
  assert.ok(h.indexOf('Varoitus 1') < h.indexOf('Varoitus 3'));
  assert.equal(alertsHtml({}), '');
  const u = alertsHtml({ officialState: 'unknown' });
  assert.match(u, /class="alert-chip"/);
  assert.match(u, /Varoituksia ei voitu tarkistaa/);
  assert.match(u, /ilmatieteenlaitos\.fi\/varoitukset/);
  const now = Date.UTC(2026, 10, 26, 9, 45);
  const checked = Date.UTC(2026, 10, 26, 2, 24);
  const old = alertsHtml({ checkedAt: checked, nowMs: now });
  // Kellonaika näytetään laitteen aikavyöhykkeessä (Helsingissä klo 4.24): testi toimii myös TZ=UTC-ajossa.
  assert.ok(old.includes(`Varoitustieto klo ${new Date(checked).getHours()}.24`), old);
  assert.equal(alertsHtml({ checkedAt: now - 20 * 60000, nowMs: now }), '', 'tuore tieto ilman varoituksia: ei mitään');
});

test('paikannimi: "lapsen" ei ole Lapua, taivutetut paikat löytyvät yhä', () => {
  for (const w of ['lapsen', 'lasten', 'vanhan', 'lapsessa', 'kotona']) assert.equal(findOffline(w), null, w);
  const must = { lapuassa: 'Lapua', Rovanimellä: 'Rovaniemi', oulussa: 'Oulu', ouluun: 'Oulu', lahdessa: 'Lahti', turussa: 'Turku', Kotkassa: 'Kotka' };
  for (const [w, n] of Object.entries(must)) assert.equal(findOffline(w)?.name, n, w);
});

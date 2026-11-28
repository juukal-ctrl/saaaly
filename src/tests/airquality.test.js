// Ilmanlaadun, siitepölyn ja UV:n testit (js/airquality.js) ja niiden käyttö näkymissä, omissa huomioissa ja chatissa.
// Data on rakennettu käsin: nyt on ti 12.5.2026 klo 10:04 (Helsinki, UTC+3). Ilmanlaadun aikaleimat ovat UTC-tunteja kuten
// oikeassa rajapinnassa (timeformat=unixtime), joten paikallinen klo 14 on UTC 11.

import test from 'node:test';
import assert from 'node:assert/strict';
import { airUrl, parseAir, fetchAir, aqiLevel, pollenLevel, uvLevel, dominantPollutant, hourAir, airWindow, airHighlights, airAlerts, airUsable, AIR_VARS } from '../js/airquality.js';
import { answerQuestion } from '../js/answer.js';
import { parseQuestion } from '../js/nlu.js';
import { hoursPageHtml, verdictHtml, weekPageHtml, airPillsHtml, alertsHtml } from '../js/views.js';
import { compactForecast } from '../js/ai.js';
import { syntheticAir, makeDemoFetch } from '../js/demo.js';
import { blendForecast } from '../js/blend.js';
import { MODELS } from '../js/models.js';
import { parseModelResponse, BACKWARD } from '../js/weather.js';

const NOW = Date.UTC(2026, 4, 12, 7, 4); // ti 12.5.2026 10:04 Helsinki
const TZ = 'Europe/Helsinki';
const turku = { name: 'Turku', region: 'Varsinais-Suomi', country: 'Suomi', lat: 60.4518, lon: 22.2666 };
const pad = (n) => String(n).padStart(2, '0');

/** Kaikki mallit samalla perusdatalla. uv(i, d, h) antaa säämallien UV-indeksin (null = malleilla ei UV:tä). */
function build({ days = 5, uv = null } = {}) {
  const results = MODELS.map((m) => {
    const id = m.ids[0];
    const keys = ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'precipitation', 'snowfall', 'weather_code', 'cloud_cover', 'pressure_msl', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'is_day', 'uv_index'];
    const hourly = { time: [] };
    keys.forEach((x) => (hourly[x] = []));
    for (let i = 0; i < days * 24; i++) {
      const d = new Date(Date.parse('2026-05-12T00:00:00Z') + Math.floor(i / 24) * 86400000).toISOString().slice(0, 10);
      const h = i % 24;
      hourly.time.push(`${d}T${pad(h)}:00`);
      hourly.temperature_2m.push(14);
      hourly.apparent_temperature.push(13);
      hourly.relative_humidity_2m.push(60);
      hourly.precipitation.push(0);
      hourly.snowfall.push(0);
      hourly.weather_code.push(1);
      hourly.cloud_cover.push(20);
      hourly.pressure_msl.push(1015);
      hourly.wind_speed_10m.push(4);
      hourly.wind_gusts_10m.push(7);
      hourly.wind_direction_10m.push(200);
      hourly.is_day.push(h >= 5 && h < 22 ? 1 : 0);
      hourly.uv_index.push(uv ? uv(i, d, h) : null);
    }
    for (const v of BACKWARD) if (hourly[v]) hourly[v] = [hourly[v][0], ...hourly[v].slice(0, -1)];
    const data = parseModelResponse({ latitude: turku.lat, longitude: turku.lon, timezone: TZ, utc_offset_seconds: 10800, elevation: 10, hourly }, id);
    return { model: m, ok: true, id, data, ms: 1 };
  });
  return { results, fc: blendForecast(results, { nowMs: NOW }) };
}

/**
 * Ilmanlaadun vastaus (Open-Meteon muoto) neljälle vuorokaudelle alkaen 12.5. klo 00 UTC.
 * f(local) antaa arvot paikallisen ajan mukaan: local = { date, h }. Puuttuva kenttä = 0, pollen:null = ei siitepölyä (talvi).
 */
function airJson(f = () => ({}), { pollen = true } = {}) {
  const t0 = Date.UTC(2026, 4, 12);
  const hourly = { time: [] };
  for (const v of AIR_VARS) hourly[v] = [];
  for (let k = 0; k < 96; k++) {
    const ms = t0 + k * 3600000;
    hourly.time.push(ms / 1000);
    const loc = new Date(ms + 3 * 3600000);
    const v = { aqi: 12, pm25: 4, pm10: 8, no2: 10, o3: 40, uv: 0, alder: 0, birch: 2, grass: 0, mugwort: 0, ragweed: 0, ...f({ date: loc.toISOString().slice(0, 10), h: loc.getUTCHours() }) };
    hourly.european_aqi.push(v.aqi);
    hourly.pm2_5.push(v.pm25);
    hourly.pm10.push(v.pm10);
    hourly.nitrogen_dioxide.push(v.no2);
    hourly.ozone.push(v.o3);
    hourly.uv_index.push(v.uv);
    for (const p of ['alder', 'birch', 'grass', 'mugwort', 'ragweed']) hourly[`${p}_pollen`].push(pollen ? v[p] : null);
  }
  return { latitude: 60.45, longitude: 22.27, hourly };
}

// Koivun huippu tänään klo 12–16 (300 kpl/m³) ja huomenna klo 13 (1400), leppää vähän; ilma huono huomenna klo 8 (typpidioksidi).
const spring = ({ date, h }) => {
  const o = {};
  if (date === '2026-05-12' && h >= 12 && h <= 16) o.birch = 300;
  if (date === '2026-05-13' && h === 13) o.birch = 1400;
  if (date === '2026-05-12' && h >= 10 && h <= 15) o.alder = 4;
  if (date === '2026-05-13' && h === 8) Object.assign(o, { aqi: 66, no2: 150 });
  if (h >= 11 && h <= 15) o.uv = 5.2;
  return o;
};

const ctx = (fc, results, air, extra = {}) => ({ place: turku, fc, results, nowMs: NOW, air, last: null, geocode: async () => [], forecastFor: async () => { throw new Error('ei verkkoa'); }, ...extra });

// ---------- Haku ja jäsennys ----------

test('hakuosoite: sijainti kahdella desimaalilla, kaikki suureet ja unix-aika', () => {
  const u = new URL(airUrl(60.45183, 22.26664));
  assert.equal(u.origin + u.pathname, 'https://air-quality-api.open-meteo.com/v1/air-quality');
  assert.equal(u.searchParams.get('latitude'), '60.45');
  assert.equal(u.searchParams.get('longitude'), '22.27');
  assert.equal(u.searchParams.get('timeformat'), 'unixtime');
  for (const v of ['european_aqi', 'pm2_5', 'pm10', 'nitrogen_dioxide', 'ozone', 'uv_index', 'alder_pollen', 'birch_pollen', 'grass_pollen', 'mugwort_pollen', 'ragweed_pollen']) assert.ok(u.searchParams.get('hourly').split(',').includes(v), v);
});

test('jäsennys: puuttuva arvo pysyy nullina, virheelliset arvot hylätään, talvella ei siitepölyä', () => {
  const j = airJson();
  j.hourly.european_aqi[0] = null;
  j.hourly.european_aqi[1] = -5;
  j.hourly.european_aqi[2] = '40';
  j.hourly.birch_pollen[3] = 1e9;
  const a = parseAir(j);
  assert.equal(a.ok, true);
  assert.equal(a.t.length, 96);
  assert.equal(a.t[1] - a.t[0], 3600000);
  assert.deepEqual(a.aqi.slice(0, 4), [null, null, null, 12]);
  assert.equal(a.pollen.birch[3], null);
  assert.equal(a.hasPollen, true);
  const w = parseAir(airJson(() => ({}), { pollen: false }));
  assert.equal(w.hasPollen, false);
  assert.doesNotMatch(w.note, /siitepöly/);
  assert.throws(() => parseAir({}), /rakenne/);
  assert.throws(() => parseAir({ hourly: { time: ['x'] } }), /aikaleimat/);
  const empty = airJson();
  for (const v of AIR_VARS) empty.hourly[v] = empty.hourly[v].map(() => null);
  assert.equal(parseAir(empty).ok, false);
});

test('haku: HTTP-virhe heittää (lähde merkitään epäonnistuneeksi), 400 = ei kattavuutta', async () => {
  const resp = (status, body) => async () => new Response(JSON.stringify(body), { status });
  await assert.rejects(fetchAir(60, 20, { fetchFn: resp(503, {}) }), /HTTP 503/);
  assert.deepEqual(await fetchAir(60, 20, { fetchFn: resp(400, { error: true }) }), { ok: false, reason: 'ei kattavuutta' });
  const ok = await fetchAir(60, 20, { fetchFn: resp(200, airJson(spring)) });
  assert.equal(ok.ok, true);
});

// ---------- Luokat ----------

test('ilmanlaatuindeksi suomeksi: hyvä, tyydyttävä, kohtalainen, huono, erittäin huono', () => {
  const w = (v) => aqiLevel(v)?.word;
  assert.equal(w(0), 'hyvä');
  assert.equal(w(19.9), 'hyvä');
  assert.equal(w(20), 'tyydyttävä');
  assert.equal(w(45), 'kohtalainen');
  assert.equal(w(60), 'huono');
  assert.equal(w(85), 'erittäin huono');
  assert.equal(w(130), 'äärimmäisen huono');
  assert.equal(aqiLevel(null), null);
  assert.equal(aqiLevel(10).advice, '');
  assert.match(aqiLevel(70).advice, /liikuntaa/);
});

test('siitepölyn tasot lajeittain: puilla korkeammat rajat kuin heinillä', () => {
  assert.deepEqual(pollenLevel('birch', 0), { level: 0, word: 'ei siitepölyä' });
  assert.equal(pollenLevel('birch', 5).word, 'vähäinen');
  assert.equal(pollenLevel('birch', 50).word, 'kohtalainen');
  assert.equal(pollenLevel('birch', 150).word, 'runsas');
  assert.equal(pollenLevel('birch', 1500).word, 'erittäin runsas');
  assert.equal(pollenLevel('alder', 120).word, 'runsas');
  assert.equal(pollenLevel('grass', 35).word, 'runsas', 'heinillä 30 kpl/m³ on jo runsas');
  assert.equal(pollenLevel('mugwort', 20).word, 'kohtalainen');
  assert.equal(pollenLevel('ragweed', 6).word, 'kohtalainen');
  assert.equal(pollenLevel('tammi', 6), null);
  assert.equal(pollenLevel('birch', null), null);
});

test('UV-luokat ja neuvot (WHO): aurinkovoide ja lakki kolmesta alkaen', () => {
  assert.equal(uvLevel(2.4).word, 'matala');
  assert.equal(uvLevel(2.6).word, 'kohtalainen', 'pyöristetään kokonaisluvuksi kuten UV-indeksi ilmoitetaan');
  assert.equal(uvLevel(2.6).value, 3);
  assert.equal(uvLevel(6).word, 'korkea');
  assert.equal(uvLevel(8).word, 'erittäin korkea');
  assert.equal(uvLevel(11).word, 'äärimmäinen');
  assert.match(uvLevel(4).advice, /aurinkovoide/);
  assert.match(uvLevel(4).advice, /lakki/);
  assert.match(uvLevel(1).advice, /ei tarvita/);
  assert.equal(uvLevel(null), null);
});

test('huonon ilman syy: huonoimman luokan saaste', () => {
  const a = parseAir(airJson(spring));
  const k = a.t.indexOf(Date.UTC(2026, 4, 13, 5)); // huomenna klo 08 paikallista aikaa
  assert.equal(dominantPollutant(a, k).name, 'typpidioksidi');
  assert.equal(dominantPollutant(a, k).level, 4);
});

// ---------- Ennusteen tunneille ----------

test('tunnit kohdistuvat paikalliseen aikaan; UV säämalleista ja ilmanlaadusta vain varalla', () => {
  const air = parseAir(airJson(spring));
  const { fc } = build();
  const i14 = fc.hours.findIndex((h) => h.t === '2026-05-12T14:00');
  const a = hourAir(fc, air, i14);
  assert.equal(a.pollen.find((p) => p.key === 'birch').v, 300);
  assert.equal(a.pollen.find((p) => p.key === 'birch').word, 'runsas');
  assert.equal(a.aqiInfo.word, 'hyvä');
  assert.equal(a.uv, 5.2);
  assert.equal(a.uvSrc, 'ilmanlaatu', 'malleilla ei UV:tä: ilmanlaadun UV käytetään');
  const withUv = build({ uv: (i, d, h) => (h >= 11 && h <= 15 ? 3.1 : 0) }).fc;
  const b = hourAir(withUv, air, i14);
  assert.equal(b.uv, 3.1);
  assert.equal(b.uvSrc, 'malli');
  assert.equal(hourAir(withUv, null, i14).uv, 3.1, 'UV toimii ilman ilmanlaadun lähdettä');
  assert.equal(hourAir(fc, null, i14), null, 'ei mitään tietoa: ei riviä');
});

test('aikavälin yhteenveto: lajit järjestyksessä, huippujakso ja huonoin ilmanlaatu', () => {
  const air = parseAir(airJson(spring));
  const { fc } = build();
  const from = fc.hours.findIndex((h) => h.t === '2026-05-12T10:00');
  const s = airWindow(fc, air, from, from + 13);
  assert.equal(s.pollen[0].key, 'birch');
  assert.equal(s.pollen[0].max, 300);
  assert.equal(fc.hours[s.pollen[0].peakStart].t, '2026-05-12T12:00');
  assert.equal(fc.hours[s.pollen[0].peakEnd].t, '2026-05-12T16:00');
  assert.equal(s.pollen[1].key, 'alder');
  assert.equal(s.aqi.info.word, 'hyvä');
  assert.equal(s.uv.info.value, 5);
  assert.equal(fc.hours[s.uv.start].t, '2026-05-12T11:00');
  const tm = airWindow(fc, air, fc.hours.findIndex((h) => h.t === '2026-05-13T00:00'), fc.hours.findIndex((h) => h.t === '2026-05-13T23:00'));
  assert.equal(tm.aqi.info.word, 'huono');
  assert.equal(fc.hours[tm.aqi.start].t, '2026-05-13T08:00');
  assert.equal(tm.aqi.dom.name, 'typpidioksidi');
  assert.equal(tm.covered, 24);
});

test('Kodin ilmarivi näyttää vain olennaisen: siitepöly kohtalaisesta, ilma huonosta, UV kolmesta alkaen', () => {
  const { fc } = build();
  const from = fc.hours.findIndex((h) => h.t === '2026-05-12T10:00');
  const hl = airHighlights(airWindow(fc, parseAir(airJson(spring)), from, from + 13));
  assert.deepEqual(hl.map((x) => x.kind), ['pollen', 'uv'], 'leppä vähäinen ei näy, ilma hyvä ei näy');
  assert.equal(hl[0].text, 'Koivu runsas');
  assert.equal(hl[1].text, 'UV 5');
  const calm = airHighlights(airWindow(fc, parseAir(airJson(() => ({ birch: 3, uv: 1.5 }))), from, from + 13));
  assert.deepEqual(calm, []);
  assert.equal(airPillsHtml(calm), '');
  const html = verdictHtml({ hl: { l1: 'Ohut takki.', l2: 'Kuivaa koko päivän.' }, air: hl });
  assert.match(html, /class="vair"/);
  assert.match(html, /<b>Koivu runsas<\/b>/);
  assert.match(html, /aria-label="Ilma: Koivun siitepölyä runsaasti, UV-indeksi 5, kohtalainen"/);
  assert.doesNotMatch(verdictHtml({ hl: { l1: 'a', l2: 'b' } }), /vair/);
});

test('omat huomiot: huono ilmanlaatu ja erittäin runsas siitepöly, muuten ei mitään', () => {
  const air = parseAir(airJson(spring));
  const { fc } = build();
  const from = fc.hours.findIndex((h) => h.t === '2026-05-12T10:00');
  const al = airAlerts(fc, air, from, from + 30);
  const aqi = al.find((a) => a.key === 'aqi');
  assert.equal(aqi.title, 'Huono ilmanlaatu');
  assert.equal(aqi.level, 1);
  assert.match(aqi.text, /huomenna klo 08/);
  assert.match(aqi.text, /typpidioksidi/);
  const pol = al.find((a) => a.key === 'pollen');
  assert.equal(pol.title, 'Erittäin runsaasti koivun siitepölyä');
  assert.match(pol.text, /1 ?400 kpl\/m³/);
  assert.deepEqual(airAlerts(fc, parseAir(airJson(() => ({ birch: 300, aqi: 30 }))), from, from + 30), [], 'runsas siitepöly ja tyydyttävä ilma eivät ole huomioita');
  assert.deepEqual(airAlerts(fc, null, from, from + 23), []);
  const row = alertsHtml({ alerts: al });
  assert.match(row, /class="alert own"/);
  assert.match(row, /Huono ilmanlaatu/);
  assert.match(row, /SääÄlyn huomio/);
});

test('välimuisti: haku kelpaa samalle paikalle vuorokauden', () => {
  const e = { raw: { t: [] }, key: '60.45,22.27', at: NOW };
  assert.equal(airUsable(e, '60.45,22.27', NOW + 3600000), true);
  assert.equal(airUsable(e, '60.17,24.94', NOW), false);
  assert.equal(airUsable(e, '60.45,22.27', NOW + 25 * 3600000), false);
  assert.equal(airUsable({ raw: null, key: '60.45,22.27', at: NOW }, '60.45,22.27', NOW), false);
});

// ---------- Näkymät ----------

test('Tunnit: avattu tunti näyttää ilmanlaadun, UV:n ja siitepölyn sekä neuvon', () => {
  const air = parseAir(airJson(spring));
  const { fc } = build();
  const html = hoursPageHtml({ fc, nowMs: NOW, open: '2026-05-12T14:00', air });
  const more = html.slice(html.indexOf('id="hm-2026-05-12T14:00"'));
  assert.match(more, /class="air-row"/);
  assert.match(more, /Ilmanlaatu hyvä/);
  assert.match(more, /UV 5 · kohtalainen/);
  assert.match(more, /Koivu runsas/);
  assert.match(more, /Leppä vähäinen/);
  assert.match(more, /aurinkovoide ja lakki/);
  const none = hoursPageHtml({ fc, nowMs: NOW, open: '2026-05-12T14:00', air: null });
  assert.doesNotMatch(none, /air-row/, 'ilman lähdettä ja ilman mallien UV:tä ei mitään');
});

test('Viikko: avatun päivän yhteenvedossa siitepöly ja UV, kun niillä on merkitystä', () => {
  const air = parseAir(airJson(spring));
  const { fc } = build();
  const html = weekPageHtml({ fc, nowMs: NOW, open: '2026-05-13', air });
  assert.match(html, /koivu erittäin runsas/);
  assert.match(html, /ilmanlaatu huono/);
  assert.match(html, /UV enintään 5/);
});

test('Geminin konteksti sisältää ilman samoina luokkina', () => {
  const air = parseAir(airJson(spring));
  const { fc } = build();
  const c = compactForecast(fc, NOW, { air });
  assert.ok(c.ilma);
  assert.deepEqual(c.ilma.tunnit_sarakkeet.slice(0, 4), ['aika', 'ilmanlaatuindeksi', 'ilmanlaatu', 'uv_indeksi']);
  assert.ok(c.ilma.tunnit_sarakkeet.includes('koivu_kpl_m3'));
  const row = c.ilma.tunnit.find((r) => r[0] === '05-12 14:00');
  assert.equal(row[2], 'hyvä');
  assert.equal(row[3], 5.2);
  assert.ok(c.ilma.paivat[1].siitepoly.some((s) => /koivu erittäin runsas/.test(s)));
  assert.equal(compactForecast(fc, NOW).ilma, undefined, 'ei ilmaa eikä mallien UV:tä: kenttää ei ole');
});

// ---------- Chat ----------

test('nlu: siitepöly-, ilmanlaatu- ja UV-kysymykset tunnistetaan', () => {
  const it = (q) => parseQuestion(q, { nowHour: 10 }).intents;
  assert.deepEqual(it('Onko huomenna paljon siitepölyä?'), ['pollen']);
  assert.deepEqual(it('Kukkiiko koivu?'), ['pollen']);
  assert.deepEqual(it('Onko pujoa ilmassa?'), ['pollen']);
  assert.deepEqual(it('Millainen ilman laatu on?'), ['aqi']);
  assert.deepEqual(it('Paljonko pienhiukkasia on?'), ['aqi']);
  assert.deepEqual(it('Mikä on UV-indeksi klo 14?'), ['uv']);
  assert.deepEqual(it('Tarvitsenko aurinkovoidetta?'), ['uv']);
});

test('chat: siitepöly tänään, huomenna ja kysytty laji', async () => {
  const air = parseAir(airJson(spring));
  const { fc, results } = build();
  const a = await answerQuestion('Onko siitepölyä?', ctx(fc, results, air));
  assert.match(a.text, /\*\*Siitepölyä tänään:\*\* koivu runsas \(enintään 300 kpl\/m³, eniten klo 12–17\), leppä vähäinen/);
  assert.match(a.text, /lääke ajoissa/);
  assert.match(a.text, /CAMS/);
  const b = await answerQuestion('Paljonko koivun siitepölyä on huomenna?', ctx(fc, results, air));
  assert.match(b.text, /Siitepölyä huomenna:\*\* koivu erittäin runsas \(enintään 1 ?400 kpl\/m³/);
  const c = await answerQuestion('Kukkiiko leppä huomenna?', ctx(fc, results, air));
  assert.match(c.text, /Lepän siitepölyä ei juuri ole huomenna/);
  assert.match(c.text, /Muuta siitepölyä: koivu erittäin runsas/);
  const d = await answerQuestion('Paljonko siitepölyä on klo 14?', ctx(fc, results, air));
  assert.match(d.text, /tänään klo 14:\*\* koivu runsas \(300 kpl\/m³\)/);
});

test('chat: ilmanlaatu ja UV datasta, ennusteen ulkopuolinen päivä kerrotaan', async () => {
  const air = parseAir(airJson(spring));
  const { fc, results } = build();
  const a = await answerQuestion('Millainen ilmanlaatu on huomenna?', ctx(fc, results, air));
  assert.match(a.text, /\*\*Ilmanlaatu huomenna: huono\.\*\*/);
  assert.match(a.text, /huonoimmillaan klo 08/);
  assert.match(a.text, /typpidioksidi/);
  assert.match(a.text, /rasittavaa liikuntaa/);
  const b = await answerQuestion('Millainen ilmanlaatu on nyt?', ctx(fc, results, air));
  assert.match(b.text, /Ilmanlaatu nyt: hyvä/);
  const u = await answerQuestion('Tarvitaanko tänään aurinkorasvaa?', ctx(fc, results, air));
  assert.match(u.text, /\*\*UV-indeksi tänään: enintään 5 \(kohtalainen\), korkeimmillaan klo 11–16\.\*\*/);
  assert.match(u.text, /aurinkovoide ja lakki/);
  const far = await answerQuestion('Millainen ilmanlaatu on lauantaina?', ctx(fc, results, air));
  assert.match(far.text, /ei ole vielä ennusteessa/);
  assert.match(far.text, /ulottuu perjantaina 15\.5\. asti/);
});

test('chat: ilman lähdettä tai talvella kerrotaan rehellisesti', async () => {
  const { fc, results } = build();
  const a = await answerQuestion('Onko siitepölyä?', ctx(fc, results, null));
  assert.match(a.text, /Siitepölytietoa ei juuri nyt saatu/);
  assert.doesNotMatch(a.text, /ei vielä hae/);
  const b = await answerQuestion('Millainen on ilmanlaatu?', ctx(fc, results, null));
  assert.match(b.text, /Ilmanlaatutietoa ei juuri nyt saatu/);
  const w = await answerQuestion('Onko siitepölyä?', ctx(fc, results, parseAir(airJson(() => ({}), { pollen: false }))));
  assert.match(w.text, /Siitepölyä ei ennusteta nyt/);
  const uv = await answerQuestion('UV-indeksi tänään?', ctx(build({ uv: (i, d, h) => (h === 13 ? 7.4 : 1) }).fc, results, null));
  assert.match(uv.text, /enintään 7 \(korkea\)/, 'UV säämalleista ilman ilmanlaadun lähdettä');
});

test('chat: toisen paikkakunnan ilma tulee sen omasta hausta', async () => {
  const air = parseAir(airJson(spring));
  const { fc, results } = build();
  const oulu = { name: 'Oulu', region: 'Pohjois-Pohjanmaa', country: 'Suomi', lat: 65.01, lon: 25.47, pop: 200000 };
  const other = parseAir(airJson(() => ({ aqi: 85, pm25: 60 })));
  const out = await answerQuestion('Millainen ilmanlaatu on Oulussa?', ctx(fc, results, air, { geocode: async () => [oulu], forecastFor: async () => ({ fc, results, air: other }) }));
  assert.match(out.text, /\*\*Oulu/);
  assert.match(out.text, /erittäin huono/);
  assert.match(out.text, /pienhiukkaset/);
});

// ---------- Esimerkkitila ----------

test('esimerkkitila: siitepöly kasvukaudella, talvella null; sumussa ilmanlaatu heikkenee', async () => {
  const may = parseAir(syntheticAir({ lat: 60.45, lon: 22.27, nowMs: NOW, scenario: 'clear' }));
  assert.equal(may.hasPollen, true);
  assert.ok(Math.max(...may.pollen.birch) > 100, 'toukokuussa koivua');
  const nov = parseAir(syntheticAir({ lat: 60.45, lon: 22.27, nowMs: Date.UTC(2026, 10, 20, 10), scenario: 'mixed' }));
  assert.equal(nov.hasPollen, false);
  const fog = parseAir(syntheticAir({ lat: 60.45, lon: 22.27, nowMs: Date.UTC(2026, 9, 14, 3), scenario: 'fog' }));
  assert.ok(Math.max(...fog.aqi) >= 60, 'sumuinversio: huono ilmanlaatu aamulla');
  const res = await makeDemoFetch({ scenario: 'clear', nowMs: NOW })(airUrl(60.45, 22.27));
  assert.equal(res.status, 200);
  assert.equal(parseAir(await res.json()).ok, true);
});

// Sisäisen vastausmoottorin testit. Data on rakennettu käsin, joten oikeat vastaukset tiedetään täsmälleen:
// nyt on ke 14.10.2026 klo 20:04 (Helsinki). Huomenna (to 15.10.) sataa klo 07–09 (1 mm/h), pakkasta klo 03–07,
// tuuli on klo 15 huomenna 12 m/s (puuskat 18) ja perjantaina sataa klo 14–15 (0,5 mm/h).

import test from 'node:test';
import assert from 'node:assert/strict';
import { answerQuestion, resolveWindow, facts, dayName } from '../js/answer.js';
import { parseQuestion } from '../js/nlu.js';
import { blendForecast } from '../js/blend.js';
import { MODELS } from '../js/models.js';
import { parseModelResponse, BACKWARD } from '../js/weather.js';

const NOW = Date.UTC(2026, 9, 14, 17, 4); // ke 14.10.2026 20:04 Helsinki
const TZ = 'Europe/Helsinki';
const turku = { name: 'Turku', region: 'Varsinais-Suomi', country: 'Suomi', lat: 60.4518, lon: 22.2666 };

const pad = (n) => String(n).padStart(2, '0');

/** Rakentaa fetchAll-muotoiset tulokset: jokainen malli saa saman perusdatan, pieni lämpötilaero mallien välillä. */
function build({ fn = () => ({}), start = '2026-10-14', days = 7, drop = [], lat = turku.lat, lon = turku.lon } = {}) {
  const results = MODELS.map((m, k) => {
    const id = m.ids[0];
    if (drop.includes(m.key)) return { model: m, ok: false, skipped: true, id, error: 'Ei saatavilla (ohitettu)' };
    const keys = ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'precipitation', 'snowfall', 'weather_code', 'cloud_cover', 'pressure_msl', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'is_day'];
    const hourly = { time: [] };
    keys.forEach((x) => (hourly[x] = []));
    for (let i = 0; i < days * 24; i++) {
      const d = new Date(Date.parse(start + 'T00:00:00Z') + Math.floor(i / 24) * 86400000).toISOString().slice(0, 10);
      const h = i % 24;
      const v = { temp: 8, precip: 0, wind: 4, gust: 6, cloud: 80, hum: 80, press: 1010 - i * 0.05, dir: 225, snow: 0, code: 3, day: h >= 8 && h < 18 ? 1 : 0, ...fn(i, d, h, m.key) };
      hourly.time.push(`${d}T${pad(h)}:00`);
      const t = v.temp + (k - 3) * 0.2;
      hourly.temperature_2m.push(t);
      hourly.apparent_temperature.push(v.feels ?? t - 1);
      hourly.relative_humidity_2m.push(v.hum);
      hourly.precipitation.push(v.precip);
      hourly.snowfall.push(v.snow);
      hourly.weather_code.push(v.precip >= 0.1 ? 61 : v.code);
      hourly.cloud_cover.push(v.cloud);
      hourly.pressure_msl.push(v.press);
      hourly.wind_speed_10m.push(v.wind);
      hourly.wind_gusts_10m.push(v.gust);
      hourly.wind_direction_10m.push(v.dir);
      hourly.is_day.push(v.day);
    }
    // Open-Meteo antaa sade-, puuska- ja säätunnussarjat "edelliseltä tunnilta" (aikaleima = jakson loppu).
    // Testidata kirjoitetaan luettavasti jakson alkuhetken mukaan ja muunnetaan tässä API:n muotoon.
    for (const v of BACKWARD) if (hourly[v]) hourly[v] = [hourly[v][0], ...hourly[v].slice(0, -1)];
    const data = parseModelResponse({ latitude: lat, longitude: lon, timezone: TZ, utc_offset_seconds: 10800, elevation: 10, hourly }, id);
    return { model: m, ok: true, id, data, ms: 1 };
  });
  return { results, fc: blendForecast(results) };
}

// Huomenna to 15.10.: pakkasta klo 03–07, sadetta klo 07–09, tuuli klo 15 12 m/s. Pe 16.10.: sadetta klo 14–15.
const base = (i, d, h) => {
  const o = {};
  if (d === '2026-10-15' && h >= 3 && h <= 7) o.temp = -1.5;
  if (d === '2026-10-15' && h >= 7 && h <= 9) o.precip = 1;
  if (d === '2026-10-15' && h === 15) (o.wind = 12), (o.gust = 18);
  if (d === '2026-10-16' && h >= 14 && h <= 15) o.precip = 0.5;
  return o;
};

const RAW = build({ fn: base });
const cities = { Rovaniemi: { lat: 66.5039, lon: 25.7294 }, Oulu: { lat: 65.0121, lon: 25.4651 } };

function ctxFor({ fn = base, place = turku, now = NOW, last = null, calls = [], start = null } = {}) {
  const { fc, results } = fn === base && !start ? RAW : build({ fn, ...(start ? { start } : {}) });
  return {
    place,
    fc,
    results,
    nowMs: now,
    last,
    geocode: async (q) => {
      calls.push(['geocode', q]);
      return q.startsWith('Kemij') ? [{ name: 'Kemijärvi', region: 'Lappi', country: 'Suomi', countryCode: 'FI', lat: 66.71, lon: 27.43, pop: 7000 }] : [];
    },
    forecastFor: async (p) => {
      calls.push(['forecastFor', p.name]);
      return build({ fn: (i, d, h) => ({ ...base(i, d, h), temp: (base(i, d, h).temp ?? 8) - 6 }), lat: p.lat, lon: p.lon });
    },
  };
}

const ask = async (text, opts) => (await answerQuestion(text, ctxFor(opts))).text;

// ---------- Kysymysten tulkinta ----------

test('tulkinta: aihe, ajankohta ja paikka tunnistetaan taivutetuista sanoista', () => {
  const p = parseQuestion('Sataako huomenna Rovaniemellä aamulla?');
  assert.deepEqual(p.intents, ['rain']);
  assert.deepEqual(p.when.day, { type: 'offset', n: 1 });
  assert.equal(p.when.part, 'aamu');
  assert.equal(p.places[0].offline.name, 'Rovaniemi');
  assert.equal(parseQuestion('Mitä pukisin tänään?').intents[0], 'clothing');
  assert.equal(parseQuestion('Tarvitsenko sateenvarjon?').flags.umbrella, true);
  assert.deepEqual(parseQuestion('Onko huomenna liukasta?').intents, ['ice']);
  assert.deepEqual(parseQuestion('Ovatko mallit samaa mieltä?').intents, ['confidence']);
  assert.deepEqual(parseQuestion('Mitä ECMWF sanoo sateesta?').models, ['ecmwf']);
  assert.equal(parseQuestion('Milloin aurinko laskee?').intents[0], 'sun');
  assert.equal(parseQuestion('Onko ukkosta tulossa?').intents[0], 'thunder');
});

test('tulkinta: kellonajat, päivämäärät ja tuntien päästä', () => {
  assert.equal(parseQuestion('lämpötila klo 15').when.hour, 15);
  const r = parseQuestion('sää klo 14-18');
  assert.deepEqual([r.when.hour, r.when.hourTo], [14, 18]);
  assert.equal(parseQuestion('Sataako 2 tunnin päästä?').when.ahead, 2);
  assert.deepEqual(parseQuestion('sää 20.10.').when.day, { type: 'date', d: 20, m: 10, y: null });
  assert.deepEqual(parseQuestion('sää ensi viikolla').when.day, { type: 'week', which: 'next' });
  assert.equal(parseQuestion('Tuleeko lunta viikonloppuna?').when.day.type, 'weekend');
  assert.equal(parseQuestion('mitä pukisin huomenaamuna').when.part, 'aamu');
  assert.deepEqual(parseQuestion('Millainen sää oli eilen?').when.day, { type: 'offset', n: -1 });
});

test('tulkinta: tavalliset sanat eivät muutu paikoiksi', () => {
  for (const q of ['Ovatko mallit samaa mieltä?', 'Sataako 2 tunnin päästä?', 'Menisinkö ulos?', 'Onko ukkosta tulossa?', 'Kuinka kylmä on tänään?']) {
    assert.deepEqual(parseQuestion(q).places, [], q);
  }
  // tuntematon paikka lähtee paikkahakuun perusmuotoehdokkailla
  const k = parseQuestion('Sää Kemijärvellä').places[0];
  assert.equal(k.offline, undefined);
  assert.equal(k.queries[0], 'Kemijärvi');
});

// ---------- Ajankohdan ratkaisu ----------

test('ajankohta: huomenna, osa päivästä, kellonaika ja nyt', () => {
  const { fc } = RAW;
  const w = (q) => resolveWindow(parseQuestion(q), fc, NOW);
  const tomorrow = w('sää huomenna');
  assert.equal(fc.hours[tomorrow.from].t, '2026-10-15T00:00');
  assert.equal(fc.hours[tomorrow.to].t, '2026-10-15T23:00');
  assert.equal(tomorrow.label, 'huomenna');
  const morning = w('sää huomenna aamulla');
  assert.equal(fc.hours[morning.from].t, '2026-10-15T06:00');
  assert.equal(fc.hours[morning.to].t, '2026-10-15T09:00');
  const at15 = w('lämpötila klo 15');
  assert.equal(fc.hours[at15.from].t, '2026-10-15T15:00'); // klo 15 on jo mennyt tänään -> huomenna
  assert.equal(at15.kind, 'point');
  const in2h = w('sataako 2 tunnin päästä');
  assert.equal(fc.hours[in2h.from].t, '2026-10-14T22:00');
  const night = w('paljonko pakkasta yöllä');
  assert.equal(fc.hours[night.from].t, '2026-10-14T22:00');
  assert.equal(fc.hours[night.to].t, '2026-10-15T05:00');
  assert.equal(night.label, 'tänä yönä');
  const weekend = w('sää viikonloppuna');
  assert.equal(weekend.kind, 'days');
  assert.deepEqual(weekend.days.map((d) => d.date), ['2026-10-17', '2026-10-18']);
  assert.equal(dayName('2026-10-17', '2026-10-14'), 'lauantaina 17.10.');
});

test('ajankohta: menneet ja ennusteen ulkopuoliset ajat tunnistetaan', () => {
  const { fc } = RAW;
  assert.equal(resolveWindow(parseQuestion('millainen sää oli eilen'), fc, NOW).past, true);
  assert.equal(resolveWindow(parseQuestion('sää tänään aamulla'), fc, NOW).past, true);
  assert.equal(resolveWindow(parseQuestion('sää 1.12.'), fc, NOW).beyond, true);
  const partial = resolveWindow(parseQuestion('sää ensi viikolla'), fc, NOW);
  assert.equal(partial.clipped, true); // ennuste kattaa vain ensi viikon alun
  assert.ok(partial.days.length >= 1 && partial.days.length < 7);
});

// ---------- Vastaukset ----------

test('sade: huomisen sateen ajankohta ja määrä tulevat datasta', async () => {
  const t = await ask('Sataako huomenna?');
  assert.match(t, /Huomenna sataa/);
  assert.match(t, /klo 07–10/);
  assert.match(t, /3,0 mm/);
  assert.match(t, /Kaikki 8 mallia ennustavat sadetta/);
  assert.match(await ask('Sataako tänään?'), /Tänään ei sada/);
});

test('sade: sateenvarjokysymys ja milloin sade alkaa', async () => {
  assert.match(await ask('Tarvitsenko sateenvarjon huomenna?'), /Kyllä, ota sateenvarjo/);
  assert.match(await ask('Tarvitsenko sateenvarjon tänään?'), /Ei tarvita/);
  assert.match(await ask('Milloin alkaa sataa?'), /Sade alkaa huomenna noin klo 07 ja kestää arviolta 3 h/);
  assert.match(await ask('Sataako 2 tunnin päästä?'), /ei sada/);
});

test('tuuli: huippu, kellonaika ja puuskat', async () => {
  const t = await ask('Paljonko tuulee huomenna?');
  assert.match(t, /navakkaa tuulta/);
  assert.match(t, /12 m\/s/);
  assert.match(t, /klo 15/);
  assert.match(t, /puuskissa jopa 18 m\/s/);
});

test('lämpötila: pakkasen ajankohta ja yksittäinen tunti', async () => {
  assert.match(await ask('Onko huomenna pakkasta?'), /Pakkasta on klo 03–08/);
  assert.match(await ask('Onko huomenna pakkasta aamulla?'), /Pakkasta on klo 06–08/); // aamu = klo 06–10
  assert.match(await ask('Mikä on lämpötila huomenna klo 5?'), /−2°|−1°/);
  assert.match(await ask('Onko pakkasta tänä yönä?'), /Pakkasta on klo 03–06/);
});

test('pukeutuminen: lämpötilan, sateen ja tuulen mukaan', async () => {
  const cold = await ask('Mitä pukisin huomenna aamulla?');
  assert.match(cold, /Pukeutuminen huomenna aamulla/);
  assert.match(cold, /[Pp]akkasen puolella|Kylmää|Viileää/);
  assert.match(cold, /Sadetta/);
  const windy = await ask('Mitä pukisin huomenna iltapäivällä?');
  assert.match(windy, /Tuulee navakasti/);
});

test('ulkoilu: paras hetki välttää sateen eikä ehdota sateista aikaa', async () => {
  const t = await ask('Milloin on paras hetki lenkille huomenna?');
  const m = t.match(/Paras ajankohta lenkille huomenna: \*\*klo (\d\d)–(\d\d)\*\*/);
  assert.ok(m, t);
  const h = +m[1];
  assert.ok(!(h >= 6 && h <= 9), 'sateen aikaa ei saa ehdottaa: ' + t);
  assert.ok(h >= 10 && h <= 18 && h !== 15, 'päiväsaikaan, ei kovan tuulen tuntina: ' + t);
  assert.match(t, /Vältä klo 07–10: silloin sataa/);
});

test('liukkaus: jäätävä keli tunnistetaan ja kuiva pakkanen ei ole liukasta', async () => {
  const wetFreeze = (i, d, h) => (d === '2026-10-15' ? (h <= 6 ? { temp: -0.5, precip: 0.4 } : {}) : {});
  const t = await ask('Onko huomenna liukasta?', { fn: wetFreeze });
  assert.match(t, /Liukkautta on mahdollista klo 00–07/);
  const dryCold = (i, d) => (d === '2026-10-15' ? { temp: -5, hum: 70 } : {});
  assert.match(await ask('Onko huomenna liukasta?', { fn: dryCold }), /Liukkaus ei vaikuta todennäköiseltä/);
  // oletusdatassa huomenna klo 07 sataa pakkasen puolella: jäätävän sateen riski
  assert.match(await ask('Onko huomenna liukasta?'), /Liukkautta on mahdollista klo 07: jäätävää/);
});

test('aurinko: nousu ja lasku lasketaan paikan mukaan', async () => {
  const t = await ask('Milloin aurinko laskee huomenna?');
  assert.match(t, /aurinko nousee klo \*\*\d\d:\d\d\*\* ja laskee klo \*\*1[78]:\d\d\*\*/);
  assert.match(await ask('Milloin aurinko laskee?'), /Aurinko laskee huomenna klo \*\*1[78]:\d\d\*\*/); // tämän päivän lasku on jo ohi
});

test('mallit: nimetyn mallin omat luvut ja mallien yksimielisyys', async () => {
  const t = await ask('Mitä ECMWF sanoo sateesta huomenna?');
  assert.match(t, /ECMWF IFS/);
  assert.match(t, /sade 3,0 mm/);
  assert.match(t, /yhdistelmä: sade 3,0 mm/);
  const all = await ask('Mitä mallit ennustavat huomiselle?');
  for (const name of ['ECMWF', 'MET Nordic', 'ICON', 'Météo-France', 'UKMO', 'GFS', 'GEM']) assert.ok(all.includes(name), name);
  assert.match(all, /Kaikki 8 mallia ennustavat sadetta/);
  assert.match(await ask('Ovatko mallit samaa mieltä?'), /Mallit ovat .* samaa mieltä/);
  const fmi = await ask('Mitä FMI sanoo huomisesta?');
  assert.match(fmi, /Ilmatieteen laitos.*ei käytä sitä/);
  assert.match(fmi, /ilmatieteenlaitos\.fi/);
});

test('paikat: tunnettu paikka haetaan ilman paikkahakua, tuntematon paikkahaulla', async () => {
  const calls = [];
  const t = await ask('Millainen sää on Rovaniemellä huomenna?', { calls });
  assert.match(t, /^\*\*Rovaniemi, Lappi\*\*/);
  assert.deepEqual(calls, [['forecastFor', 'Rovaniemi']]);
  const calls2 = [];
  const k = await ask('Sää Kemijärvellä', { calls: calls2 });
  assert.deepEqual(calls2.map((c) => c[0]), ['geocode', 'forecastFor']);
  assert.match(k, /^\*\*Kemijärvi, Lappi\*\*/);
  const missing = await ask('Millainen sää on Xyzzyllä?');
  assert.match(missing, /En löytänyt paikkaa "Xyzzyllä"/);
});

test('paikat: vertailu kahden paikan välillä', async () => {
  const t = await ask('Onko Oulussa kylmempää kuin täällä?');
  assert.match(t, /Oulu on kylmempi kuin Turku/);
  assert.match(t, /Keskilämpötilojen ero on noin 6,0°/);
});

test('jatkokysymys: aihe ja paikka periytyvät edelliseltä kysymykseltä', async () => {
  const ctx = ctxFor();
  const r1 = await answerQuestion('Sataako Rovaniemellä huomenna?', ctx);
  ctx.last = r1.last;
  const r2 = await answerQuestion('Entä ylihuomenna?', ctx);
  assert.deepEqual(r2.intents, ['rain']);
  assert.match(r2.text, /^\*\*Rovaniemi, Lappi\*\*/);
  assert.match(r2.text, /Ylihuomenna sataa/);
  const r3 = await answerQuestion('Entä täällä?', { ...ctx, last: r2.last });
  assert.ok(!r3.text.startsWith('**Rovaniemi'), 'täällä palaa nykyiseen paikkaan');
});

test('jatkokysymys perii ajankohdan: "Entä Rovaniemellä?" = sama päivä, "Entä illalla?" = saman päivän ilta, oma aika ohittaa perityn', async () => {
  const ctx = ctxFor();
  const r1 = await answerQuestion('Sataako huomenna?', ctx);
  const r2 = await answerQuestion('Entä Rovaniemellä?', { ...ctx, last: r1.last });
  assert.match(r2.text, /^\*\*Rovaniemi, Lappi\*\*/);
  assert.match(r2.text, /Huomenna sataa/);
  const r3 = await answerQuestion('Entä illalla?', { ...ctx, last: r1.last });
  assert.match(r3.text, /Huomenna illalla ei sada/);
  const r4 = await answerQuestion('Entä perjantaina?', { ...ctx, last: r1.last });
  assert.match(r4.text, /Ylihuomenna sataa/); // pe 16.10. on ylihuomenna
  assert.doesNotMatch(r4.text, /Huomenna/);
  // ajankohta säilyy usean jatkokysymyksen yli ja siirtyy tuulikysymykseen mukana
  const w1 = await answerQuestion('Paljonko tuulee huomenna iltapäivällä?', ctx);
  const w2 = await answerQuestion('Entä Rovaniemellä?', { ...ctx, last: w1.last });
  const w3 = await answerQuestion('Entä täällä?', { ...ctx, last: w2.last });
  assert.match(w2.text, /Rovaniemi, Lappi/);
  assert.match(w2.text, /iltapäivällä/);
  assert.match(w3.text, /iltapäivällä/);
  assert.ok(!w3.text.startsWith('**Rovaniemi'));
  // ilman edellistä kysymystä "Entä illalla?" ei kaadu eikä keksi päivää
  const solo = await answerQuestion('Entä illalla?', ctxFor());
  assert.ok(solo.text.length > 0);
});

test('rajatapaukset: menneisyys, ennusteen ulkopuoli ja ymmärtämätön kysymys', async () => {
  assert.match(await ask('Millainen sää oli eilen?'), /on jo mennyt/);
  assert.match(await ask('Sataako 1.12.?'), /Ennuste ulottuu vain/);
  const u = await answerQuestion('Kerro vitsi', ctxFor());
  assert.equal(u.understood, false);
  assert.match(u.text, /En ymmärtänyt kysymystä/);
  assert.match(await ask('Kiitos'), /Ole hyvä/);
  assert.match(await ask('Mitä osaat?'), /Sataako huomenna\?/);
  const none = await answerQuestion('Sataako?', { ...ctxFor(), fc: null });
  assert.match(none.text, /ei ole vielä ladattu/);
});

test('luvut ovat samat kuin datassa: vastauksen sademäärä vastaa laskettua summaa', async () => {
  const { fc } = RAW;
  const w = resolveWindow(parseQuestion('sää huomenna'), fc, NOW);
  const f = facts(fc, w.from, w.to);
  assert.ok(Math.abs(f.precip - 3) < 0.05, `summa ${f.precip}`);
  assert.equal(fc.hours[f.iWind].t, '2026-10-15T15:00');
});

// ---------- Myöhemmät korjaukset ----------

test('sumu: "onko sumua" vastataan sumutunneilla eikä yleisellä pilvisyysvastauksella', async () => {
  const fog = (i, d, h) => (d === '2026-10-15' && h >= 5 && h <= 7 ? { code: 45 } : {});
  const t = await ask('Onko huomenna sumua?', { fn: fog });
  assert.match(t, /Sumua on mahdollista klo 05–08/); // päivä on jo kysymyksessä (huomenna), joten sitä ei toisteta
  assert.match(await ask('Onko huomenna sumua?'), /Sumua ei ole ennusteessa huomenna/);
  assert.equal(parseQuestion('Onko sumua?').flags.fog, true);
});

test('aurinko: päivän pituus ja ennusteen ulkopuoliset päivät lasketaan tähtitieteellisesti', async () => {
  assert.match(await ask('Kuinka pitkä päivä on tänään?'), /päivän pituus on \*\*\d+ h \d+ min\*\*: aurinko nousee klo \d\d:\d\d ja laskee klo \d\d:\d\d/);
  // jouluaatto ja joulukuu ovat ennusteen ulkopuolella, mutta aurinko ei tarvitse ennustetta
  const xmas = await ask('Milloin aurinko laskee jouluaattona?');
  assert.match(xmas, /Torstaina 24\.12\.: aurinko nousee klo \*\*\d\d:\d\d\*\* ja laskee klo \*\*1[45]:\d\d\*\*/);
  assert.doesNotMatch(xmas, /ei ole vielä ennusteessa/);
  const dec = await ask('Kuinka pitkä päivä on joulukuussa?');
  assert.match(dec, /^\*\*Joulukuussa:\*\*\n- Tiistaina 1\.12\./);
  assert.match(dec, /\n- Torstaina 31\.12\./);
  assert.match(await ask('Milloin aurinko nousi eilen?'), /^Tiistaina 13\.10\.: aurinko nousee klo \*\*\d\d:\d\d\*\*/);
  // epämääräinen kaukainen ajankohta ei ratkea päiväksi
  assert.match(await ask('Milloin aurinko laskee ensi vuonna?'), /ei ole vielä ennusteessa/);
});

test('paikat: kaksiosainen nimi ja "siellä"', async () => {
  const p = parseQuestion('Sataako New Yorkissa?').places[0];
  assert.equal(p.offline.name, 'New York');
  assert.match(await ask('Sataako New Yorkissa huomenna?'), /^\*\*New York/);
  assert.match(await ask('Sataako siellä?'), /En tiedä, mitä paikkaa tarkoitat sanalla "siellä"/);
  const ctx = ctxFor();
  const r1 = await answerQuestion('Sataako Rovaniemellä huomenna?', ctx);
  const r2 = await answerQuestion('Onko siellä tuulista?', { ...ctx, last: r1.last });
  assert.match(r2.text, /^\*\*Rovaniemi, Lappi\*\*/);
});

test('ajankohta: kuukausi, juhlapyhä ja vuodenaika ratkeavat päiviksi tai kerrotaan rehellisesti ennusteen ulkopuolisiksi', async () => {
  assert.deepEqual(parseQuestion('sataako joulukuussa').when.day, { type: 'month', m: 12 });
  assert.equal(parseQuestion('sataako jouluna').when.day.type, 'dates');
  assert.equal(parseQuestion('sataako juhannuksena').when.day.type, 'juhannus');
  assert.equal(parseQuestion('sataako pääsiäisenä').when.day.type, 'easter');
  assert.deepEqual(parseQuestion('sataako ensi vuonna').when.day, { type: 'far', label: 'ensi vuonna' });
  assert.equal(parseQuestion('sataako kesällä').when.day.type, 'far');
  for (const [q, label] of [['Sataako joulukuussa?', 'joulukuussa'], ['Sataako jouluna?', 'jouluna'], ['Sataako juhannuksena?', 'juhannuksena'], ['Sataako ensi vuonna?', 'ensi vuonna'], ['Sataako kesällä?', 'kesällä'], ['Sataako tammikuussa?', 'tammikuussa']]) {
    assert.equal(await ask(q), `Ennuste ulottuu vain tiistaina 20.10. asti, joten ${label} ei ole vielä ennusteessa.`, q);
  }
  // kuluva kuukausi on ennusteessa: lista päivittäin
  const oct = await ask('Sataako lokakuussa?');
  assert.match(oct, /^\*\*Lokakuussa:\*\*\n- \*\*Tänään\*\*/);
  // sama kuukausi kysyttynä uudelleen ei kaadu kuukaudenvaihteessa
  assert.ok((await ask('Sataako marraskuussa?', { now: Date.UTC(2026, 9, 31, 20, 0) })).length > 0);
});

test('ajankohta: pääsiäinen ja juhannus lasketaan oikein ja menneet päivät eivät "katkaise" jaksoa', async () => {
  const at = (iso, ms) => resolveWindow(parseQuestion(iso), build({ start: ms.start }).fc, ms.now);
  // pääsiäinen 2027: la 27.3. on tänään, pitkäperjantai 26.3. on jo mennyt (ennuste alkaa tästä päivästä)
  const e = at('sää pääsiäisenä', { start: '2027-03-27', now: Date.UTC(2027, 2, 27, 8, 0) });
  assert.deepEqual(e.days.map((d) => d.date), ['2027-03-27', '2027-03-28', '2027-03-29']);
  assert.equal(e.clipped, false);
  assert.deepEqual(e.dates, ['2027-03-26', '2027-03-27', '2027-03-28', '2027-03-29']);
  // pääsiäinen 2028 (su 16.4.), juhannus 2027 (la 26.6.) ja 2026 (la 20.6.)
  assert.deepEqual(at('sää pääsiäisenä', { start: '2028-03-01', now: Date.UTC(2028, 2, 1, 8, 0) }).dates, ['2028-04-14', '2028-04-15', '2028-04-16', '2028-04-17']);
  assert.deepEqual(at('sää juhannuksena', { start: '2027-06-10', now: Date.UTC(2027, 5, 10, 8, 0) }).dates, ['2027-06-25', '2027-06-26', '2027-06-27']);
  assert.deepEqual(at('sää juhannuksena', { start: '2026-06-17', now: Date.UTC(2026, 5, 17, 8, 0) }).dates, ['2026-06-19', '2026-06-20', '2026-06-21']);
  assert.equal(at('sää juhannuksena', { start: '2027-06-10', now: Date.UTC(2027, 5, 10, 8, 0) }).beyond, true);
  // vastaus: vappu ennusteessa, pääsiäinen jo mennyt
  const o = { fn: () => ({}), start: '2027-04-29', now: Date.UTC(2027, 3, 29, 7, 0) };
  assert.match(await ask('Sataako vappuna?', o), /^\*\*Vappuna ei sada(\.\*\*|:\*\* poutaa)/);
  const past = await ask('Sataako pääsiäisenä?', { fn: () => ({}), start: '2027-03-30', now: Date.UTC(2027, 2, 30, 7, 0) });
  assert.match(past, /Ajankohta "pääsiäisenä" on jo mennyt/);
  const hol = await ask('Onko pääsiäisenä lämmin?', { fn: () => ({}), start: '2027-03-27', now: Date.UTC(2027, 2, 27, 8, 0) });
  assert.doesNotMatch(hol, /Ennuste kattaa vain/);
});

test('vastaus: päivämäärän perään ei tule kahta pistettä', async () => {
  const t = await ask('Onko tiistaina pakkasta?');
  assert.match(t, /tiistaina 20\.10\./);
  assert.doesNotMatch(t, /\d\.\./);
});

test('useampi vuorokaudenaika: "aamulla ja illalla" saa vastauksen kummallekin', async () => {
  assert.deepEqual(parseQuestion('sataako aamulla ja illalla').when.parts, ['aamu', 'ilta']);
  assert.deepEqual(parseQuestion('tuuli aamulla, iltapäivällä ja illalla').when.parts, ['aamu', 'iltapaiva', 'ilta']);
  for (const q of ['sataako aamupäivällä', 'sataako huomenaamuna', 'sataako illalla', 'sataako klo 15 illalla']) assert.equal(parseQuestion(q).when.parts, undefined, q);
  const t = await ask('Sataako huomenna aamulla ja illalla?');
  assert.match(t, /\*\*Huomenna aamulla sataa:\*\*/);
  assert.match(t, /\*\*Huomenna illalla ei sada:\*\* poutaa, [+−]?\d+°/);
  assert.ok(t.indexOf('aamulla') < t.indexOf('illalla'));
  // ennusteen ulkopuolinen päivä: yksi huomautus eikä kahta
  const far = await ask('Sataako joulukuussa aamulla ja illalla?');
  assert.equal((far.match(/Ennuste ulottuu vain/g) || []).length, 1);
  assert.match(far, /joulukuussa ei ole vielä ennusteessa/);
  // jatkokysymys perii kaksiosaisen ajan
  const ctx = ctxFor();
  const r1 = await answerQuestion('Sataako huomenna aamulla ja illalla?', ctx);
  const r2 = await answerQuestion('Entä Rovaniemellä?', { ...ctx, last: r1.last });
  assert.match(r2.text, /Huomenna aamulla/);
  assert.match(r2.text, /Huomenna illalla/);
});

test('sanasto: myrsky, salamointi, ensilumi, kuiva sää ja "nousee ja laskee"', async () => {
  assert.match(await ask('Tuleeko myrsky?'), /\*\*Myrskyä \(keskituuli vähintään 21 m\/s\) ei ole ennusteessa/);
  const gale = (i, d, h) => (d === '2026-10-15' && h === 12 ? { wind: 23, gust: 30 } : {});
  assert.match(await ask('Tuleeko huomenna myrsky?', { fn: gale }), /\*\*Myrskytuulta ennustetaan:\*\* keskituuli nousee jopa 23 m\/s/);
  assert.deepEqual(parseQuestion('Salamoiko?').intents, ['thunder']);
  assert.deepEqual(parseQuestion('Tuleeko ensilumi?').intents, ['snow']);
  assert.deepEqual(parseQuestion('Milloin on kuivaa?').intents, ['rain']);
  assert.match(await ask('Milloin aurinko nousee ja laskee huomenna?'), /^Huomenna: aurinko nousee klo \*\*\d\d:\d\d\*\* ja laskee klo \*\*1[78]:\d\d\*\*/);
});

test('satunnaiset kysymykset eivät kaada moottoria eivätkä tuota rikkinäistä tekstiä', async () => {
  const words = ['sataako', 'huomenna', 'tuulee', 'pakkasta', 'klo 7', 'illalla', 'viikonloppuna', 'ensi viikolla', 'lunta', 'pukisin', 'lenkille', 'mallit', 'ECMWF', 'aurinko', 'laskee', 'Oulussa', 'täällä', 'entä', 'eilen', 'ukkosta', 'liukasta', '2 tunnin päästä', '20.10.', 'kuin'];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const ctx = ctxFor();
  for (let n = 0; n < 150; n++) {
    const q = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => words[Math.floor(rnd() * words.length)]).join(' ');
    const r = await answerQuestion(q, ctx);
    assert.ok(r.text.trim().length > 0, q);
    assert.doesNotMatch(r.text, /undefined|NaN|\[object|Infinity/, q);
    ctx.last = r.last;
  }
});

test('suosikit: suosikin nimi ratkeaa ilman paikkahakua ja voittaa samannimisen tunnetun paikan', async () => {
  const favorites = [
    { name: 'Särkisalo', region: 'Varsinais-Suomi', country: 'Suomi', lat: 60.07, lon: 22.79 },
    { name: 'Oulu', region: 'Pohjois-Pohjanmaa', country: 'Suomi', lat: 65.18, lon: 25.35 },
  ];
  const calls = [];
  const ctx = { ...ctxFor({ calls }), favorites };
  const seen = [];
  const ff = ctx.forecastFor;
  ctx.forecastFor = async (p) => (seen.push(p), ff(p));
  const r = await answerQuestion('Sataako Särkisalossa huomenna?', ctx);
  assert.match(r.text, /^\*\*Särkisalo, Varsinais-Suomi\*\*/);
  assert.deepEqual(calls, [['forecastFor', 'Särkisalo']], 'paikkahakua ei tarvittu');
  await answerQuestion('Millainen sää on Oulussa?', ctx);
  assert.equal(seen.at(-1).lat, 65.18, 'suosikin koordinaatit, ei tunnetun Oulun keskustan');
  const plain = [];
  await answerQuestion('Millainen sää on Oulussa?', ctxFor({ calls: plain }));
  assert.deepEqual(plain, [['forecastFor', 'Oulu']]);
});

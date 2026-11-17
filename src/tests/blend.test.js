import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blendForecast, combine, wMedian, pickSymbol, nowPosition, snapshot, modelRows, confidence, wetSpans, describeNow, describeDay, describeHour, SYMBOLS,
} from '../js/blend.js';
import { MODELS, weightAt } from '../js/models.js';
import { parseModelResponse } from '../js/weather.js';
import { syntheticResponse } from '../js/demo.js';
import { fmtTemp } from '../js/util.js';

const NOW = Date.UTC(2026, 9, 14, 17, 4); // 20:04 Helsingin aikaa
const TURKU = { lat: 60.4518, lon: 22.2666 };

function synth(scenario, skip = []) {
  return MODELS.map((m) => {
    if (skip.includes(m.key)) return { model: m, ok: false, error: 'testi' };
    const id = m.ids[0];
    return { model: m, ok: true, id, data: parseModelResponse(syntheticResponse({ ...TURKU, modelId: id, nowMs: NOW, scenario }), id), ms: 5 };
  });
}

/** Käsintehty malli: jokaiselle tunnille oma lämpötila, muut kentät kiinteitä. */
function handModel(key, weight, tempFn, { startHour = 0, hours = 48, extra = {} } = {}) {
  const time = [];
  const temp = [];
  for (let i = 0; i < hours; i++) {
    const h = startHour + i;
    const day = 14 + Math.floor(h / 24);
    time.push(`2026-10-${day}T${String(h % 24).padStart(2, '0')}:00`);
    temp.push(tempFn(h));
  }
  const fill = (v) => time.map(() => v);
  const json = {
    latitude: 60.45, longitude: 22.27, timezone: 'Europe/Helsinki', utc_offset_seconds: 10800,
    hourly: { time, temperature_2m: temp, precipitation: fill(0), cloud_cover: fill(50), wind_speed_10m: fill(3), wind_gusts_10m: fill(5), wind_direction_10m: fill(225), is_day: fill(0), ...extra },
  };
  const model = { key, ids: [key], label: key, short: key, weight };
  return { model, ok: true, id: key, data: parseModelResponse(json, key), ms: 1 };
}

test('blendForecast: 7 päivää, jokaisella tunnilla järkevä lämpötila ja symboli', () => {
  const fc = blendForecast(synth('mixed'));
  assert.ok(fc.hours.length >= 168 - 1);
  assert.equal(fc.days[0].date, '2026-10-14');
  assert.equal(fc.days.length, 7);
  assert.equal(fc.tz, 'Europe/Helsinki');
  for (const h of fc.hours) {
    assert.ok(Number.isFinite(h.temp), h.t);
    assert.ok(h.sym in SYMBOLS, h.sym);
    assert.ok(h.pop >= 0 && h.pop <= 1);
  }
  assert.equal(fc.modelsUsed, MODELS.length);
});

test('yhdistelmä pysyy mallien ylä- ja alarajan välissä', () => {
  const res = synth('mixed');
  const fc = blendForecast(res);
  fc.hours.forEach((h, i) => {
    const vals = res.filter((r) => r.ok).map((r) => r.data.vars.temperature_2m[i]).filter((v) => v != null);
    assert.ok(h.temp >= Math.min(...vals) - 1e-9 && h.temp <= Math.max(...vals) + 1e-9, `${h.t}: ${h.temp} ei välillä ${Math.min(...vals)}–${Math.max(...vals)}`);
  });
});

test('REGRESSIO: nykyhetken lämpötila tulee paikallisen kellonajan tunnilta, ei UTC-tunnilta', () => {
  // Lämpötila = kellonaika, joten tulos paljastaa, mikä tunti valittiin.
  const res = [handModel('a', 1, (h) => h), handModel('b', 1, (h) => h), handModel('c', 1, (h) => h)];
  const fc = blendForecast(res);
  const { idx, frac, local } = nowPosition(fc, NOW);
  assert.equal(local.iso, '2026-10-14T20:04');
  assert.equal(fc.hours[idx].t, '2026-10-14T20:00');
  const s = snapshot(fc, idx, frac);
  assert.ok(Math.abs(s.temp - (20 + 4 / 60)) < 0.01, `lämpötila ${s.temp}`); // ei 17,07 eikä 23,07
});

test('REGRESSIO: nykyhetki ei ole vuorokauden alin tai ylin lämpötila', () => {
  const res = [handModel('a', 1, (h) => 4 + 5 * Math.sin(((h - 9) / 24) * 2 * Math.PI)), handModel('b', 1, (h) => 4.4 + 5 * Math.sin(((h - 9) / 24) * 2 * Math.PI)), handModel('c', 1, (h) => 3.8 + 5 * Math.sin(((h - 9) / 24) * 2 * Math.PI))];
  const fc = blendForecast(res);
  const { idx, frac } = nowPosition(fc, NOW);
  const s = snapshot(fc, idx, frac);
  const day = fc.days[0];
  assert.ok(s.temp > day.tmin && s.temp < day.tmax);
});

test('poikkeava malli ei vedä yhdistelmää mukanaan', () => {
  const c = combine([{ v: 9, w: 1 }, { v: 9.5, w: 1 }, { v: 8.8, w: 1 }, { v: -2, w: 1 }], 3);
  assert.ok(Math.abs(c.value - 9.1) < 0.1, `arvo ${c.value}`);
  assert.equal(c.n, 3);
  // kaksi mallia: ei poisteta mitään
  const two = combine([{ v: 9, w: 1 }, { v: 3, w: 1 }], 3);
  assert.equal(two.value, 6);
  assert.equal(combine([], 3).value, null);
  assert.equal(wMedian([{ v: 1, w: 1 }, { v: 2, w: 1 }, { v: 10, w: 1 }]), 2);
});

test('painot vaikuttavat yhdistelmään', () => {
  const c = combine([{ v: 10, w: 3 }, { v: 12, w: 1 }], 3);
  assert.equal(c.value, 10.5);
});

test('aikajanat kohdistetaan aikaleiman mukaan, kun malli alkaa myöhemmin', () => {
  const a = handModel('a', 1, () => 10, { hours: 48 });
  const b = handModel('b', 1, () => 20, { startHour: 10, hours: 20 });
  const fc = blendForecast([a, b]);
  const at = (t) => fc.hours.find((h) => h.t === t).temp;
  assert.equal(at('2026-10-14T05:00'), 10); // vain a
  assert.equal(at('2026-10-14T12:00'), 15); // molemmat
  assert.equal(at('2026-10-15T12:00'), 10); // b:n horisontti ohi
});

test('lyhyt horisontti: tunnit ilman lämpötilaa jätetään pois', () => {
  const a = handModel('a', 1, () => 5, { hours: 30 });
  const fc = blendForecast([a]);
  assert.equal(fc.hours.length, 30);
  assert.equal(fc.hours.at(-1).t, '2026-10-15T05:00');
});

test('kesäajan päättyessä toistuva tunti ei kaada laskentaa', () => {
  const time = ['2026-10-25T01:00', '2026-10-25T02:00', '2026-10-25T03:00', '2026-10-25T03:00', '2026-10-25T04:00'];
  const mk = (key) => {
    const json = { latitude: 60, longitude: 22, timezone: 'Europe/Helsinki', hourly: { time, temperature_2m: [1, 2, 3, 4, 5], precipitation: [0, 0, 0, 0, 0], is_day: [0, 0, 0, 0, 0] } };
    return { model: { key, ids: [key], label: key, short: key, weight: 1 }, ok: true, id: key, data: parseModelResponse(json, key), ms: 1 };
  };
  const fc = blendForecast([mk('a'), mk('b')]);
  assert.equal(fc.hours.length, 5);
});

test('pickSymbol valitsee oikean symbolin', () => {
  assert.equal(pickSymbol({ precip: 0, cloud: 3 }), 'clear');
  assert.equal(pickSymbol({ precip: 0, cloud: 20 }), 'mostly_clear');
  assert.equal(pickSymbol({ precip: 0, cloud: 50 }), 'partly_cloudy');
  assert.equal(pickSymbol({ precip: 0, cloud: 75 }), 'mostly_cloudy');
  assert.equal(pickSymbol({ precip: 0, cloud: 95 }), 'overcast');
  assert.equal(pickSymbol({ precip: 0.15, cloud: 95 }), 'drizzle');
  assert.equal(pickSymbol({ precip: 0.5, cloud: 95 }), 'rain_light');
  assert.equal(pickSymbol({ precip: 1.5, cloud: 95 }), 'rain');
  assert.equal(pickSymbol({ precip: 4, cloud: 95 }), 'rain_heavy');
  assert.equal(pickSymbol({ precip: 0.5, cloud: 95, snowShare: 1 }), 'snow');
  assert.equal(pickSymbol({ precip: 0.2, cloud: 95, snowShare: 1 }), 'snow_light');
  assert.equal(pickSymbol({ precip: 2, cloud: 95, snowShare: 1 }), 'snow_heavy');
  assert.equal(pickSymbol({ precip: 0.5, cloud: 95, snowShare: 0.5 }), 'sleet');
  assert.equal(pickSymbol({ precip: 2, cloud: 95, thunderShare: 0.5 }), 'thunder');
  assert.equal(pickSymbol({ precip: 0, cloud: 100, fogShare: 0.8 }), 'fog');
});

test('lumi tunnistetaan lumisateesta ja pakkasesta', () => {
  const snowy = (key) => handModel(key, 1, () => -3, { extra: { precipitation: Array(48).fill(1), snowfall: Array(48).fill(0.7), weather_code: Array(48).fill(73), cloud_cover: Array(48).fill(100) } });
  const fc = blendForecast([snowy('a'), snowy('b'), snowy('c')]);
  assert.equal(fc.hours[10].snowShare, 1);
  assert.equal(fc.hours[10].sym, 'snow');
  // ei snowfall-kenttää eikä koodia: päätellään lämpötilasta
  const bare = (key, t) => handModel(key, 1, () => t, { extra: { precipitation: Array(48).fill(1) } });
  // märkälämpötilasta: selvä pakkanen lunta, plussan puolella vettä, nollakelillä välimuoto
  assert.equal(blendForecast([bare('a', -4)]).hours[5].snowShare, 1);
  assert.equal(blendForecast([bare('a', 0.8)]).hours[5].snowShare, 1, 'kostealla ilmalla märkälämpö on jo pakkasella');
  const mid = blendForecast([bare('a', 2)]).hours[5].snowShare;
  assert.ok(mid > 0.3 && mid < 0.7, `räntäraja ${mid}`);
  assert.equal(blendForecast([bare('a', 6)]).hours[5].snowShare, 0);
});

test('sadetodennäköisyys on mallien yksimielisyys', () => {
  const wet = (key, p) => handModel(key, 1, () => 8, { extra: { precipitation: Array(48).fill(p) } });
  const fc = blendForecast([wet('a', 1), wet('b', 1), wet('c', 0), wet('d', 0)]);
  assert.equal(fc.hours[3].pop, 0.5);
  assert.equal(fc.hours[3].precip, 0.5);
});

test('sadetodennäköisyys: ensemble-todennäköisyys on ensisijainen, kun vähintään kaksi mallia antaa sen', () => {
  const plain = (key) => handModel(key, 1, () => 8, { extra: { precipitation: Array(48).fill(0.5) } });
  const ens = (key, p) => handModel(key, 1, () => 8, { extra: { precipitation: Array(48).fill(0.5), precipitation_probability: Array(48).fill(p) } });
  const two = blendForecast([ens('a', 80), ens('b', 60), plain('c'), plain('d'), plain('e'), plain('f'), plain('g'), plain('h')]);
  assert.equal(two.hours[5].popSrc, 'ens');
  assert.ok(Math.abs(two.hours[5].pop - 0.7) < 1e-9, `pop ${two.hours[5].pop}`);
  // yksi ensemble-malli ei riitä: palataan mallien yksimielisyyteen
  const one = blendForecast([ens('a', 80), plain('b'), plain('c')]);
  assert.equal(one.hours[5].popSrc, 'models');
  assert.equal(one.hours[5].pop, 1);
});

test('mallien painot: ikä muuttaa painoja pehmeästi, ja jakson loppua kohti paino laskee', () => {
  const metno = MODELS.find((m) => m.key === 'metno');
  const ecmwf = MODELS.find((m) => m.key === 'ecmwf');
  assert.equal(weightAt(metno, 0), 1.6);
  assert.equal(weightAt(metno, 12), 1.6);
  assert.ok(Math.abs(weightAt(metno, 27) - 1.5) < 1e-9);
  assert.equal(weightAt(metno, 200), 1.0);
  assert.ok(weightAt(ecmwf, 150) > weightAt(ecmwf, 6), 'ECMWF painaa enemmän kaukana');
  assert.ok(weightAt(metno, 6) > weightAt(metno, 100), 'MET Nordic painaa enemmän lähellä');
  // jatkuvuus: viereisten tuntien painot eivät hyppää
  for (let h = 0; h < 170; h++) assert.ok(Math.abs(weightAt(ecmwf, h + 1) - weightAt(ecmwf, h)) < 0.02, `hyppy tunnilla ${h}`);
  assert.equal(weightAt({ weight: 0.7 }, 100), 0.7);
});

test('mallin horisontin lopussa sen paino pienenee eikä yhdistelmä hyppää', () => {
  // A kattaa 48 h, B vain 24 h ja on 4 °C kylmempi
  const a = handModel('a', 1, () => 10, { hours: 48 });
  const b = handModel('b', 1, () => 6, { hours: 24 });
  const fc = blendForecast([a, b]);
  const t = fc.hours.map((h) => h.temp);
  assert.ok(Math.abs(t[5] - 8) < 1e-6, `tasapaino ${t[5]}`);
  assert.ok(Math.abs(t[30] - 10) < 1e-6, 'B:n jälkeen vain A');
  for (let i = 1; i < 30; i++) assert.ok(Math.abs(t[i] - t[i - 1]) < 1.2, `hyppy ${i}: ${t[i - 1]} → ${t[i]}`);
});

test('päiväyhteenveto: lumipäivä ja sadepäivä', () => {
  const snow = blendForecast(synth('snow'));
  assert.ok(snow.days[1].tmax < 3);
  assert.match(snow.days[1].sym, /snow|sleet/);
  const rain = blendForecast(synth('rain'));
  assert.match(rain.days[1].sym, /rain/);
  assert.ok(rain.days[1].precip > 10);
  const clear = blendForecast(synth('clear'));
  assert.equal(clear.days[1].sym, 'clear');
  const thunder = blendForecast(synth('thunder'));
  assert.equal(thunder.days[1].sym, 'thunder');
  const fog = blendForecast(synth('fog'));
  assert.equal(fog.days[1].sym, 'fog');
});

test('nowPosition: ennustealueen ulkopuolella käytetään reunaa', () => {
  const fc = blendForecast([handModel('a', 1, () => 5, { hours: 48 })]);
  assert.equal(nowPosition(fc, Date.UTC(2026, 9, 10, 0, 0)).idx, 0);
  assert.equal(nowPosition(fc, Date.UTC(2026, 9, 20, 0, 0)).idx, fc.hours.length - 1);
});

test('modelRows näyttää jokaisen mallin lämpötilan ja eron yhdistelmään', () => {
  const res = synth('mixed', ['gem']);
  const fc = blendForecast(res);
  const { idx, frac } = nowPosition(fc, NOW);
  const s = snapshot(fc, idx, frac);
  const rows = modelRows(res, fc, idx, frac, s.temp);
  assert.equal(rows.length, res.length);
  const gem = rows.find((r) => r.model.key === 'gem');
  assert.equal(gem.ok, false);
  const okRows = rows.filter((r) => r.ok);
  assert.ok(okRows.every((r) => Number.isFinite(r.temp) && Number.isFinite(r.delta)));
  const avgDelta = okRows.reduce((a, r) => a + r.delta, 0) / okRows.length;
  assert.ok(Math.abs(avgDelta) < 1.5);
});

test('confidence luokittelee mallien hajonnan', () => {
  const tight = blendForecast([handModel('a', 1, () => 9), handModel('b', 1, () => 9.4)]);
  assert.equal(confidence(tight, 0).level, 'high');
  const wide = blendForecast([handModel('a', 1, () => 4), handModel('b', 1, () => 9)]);
  assert.equal(confidence(wide, 0).level, 'low');
  const one = blendForecast([handModel('a', 1, () => 9)]);
  assert.equal(confidence(one, 0).level, 'single');
});

/** Käsintehty ennuste wetSpans-testeihin: jokaisella mallilla oma sadesarja. */
function spanFc(series, snowFrom = 99) {
  const n = series[0].length;
  const hours = Array.from({ length: n }, (_, i) => {
    const p = series.reduce((a, s) => a + s[i], 0) / series.length;
    const wet = series.filter((s) => s[i] >= 0.1).length / series.length;
    return { t: `2026-10-14T${String(i).padStart(2, '0')}:00`, precip: p, pop: wet, popAgree: wet, popSrc: 'models', snowShare: i >= snowFrom ? 1 : 0 };
  });
  return { hours, pm: series.map((p) => ({ model: { weight: 1 }, p })) };
}

test('wetSpans yhdistää lähekkäiset sadejaksot ja tunnistaa lumen', () => {
  const p = [0, 0, 1, 1, 0, 1, 0, 0, 0, 2, 2, 0];
  const fc = spanFc([p, p, p], 9);
  const spans = wetSpans(fc, 0, 11);
  assert.equal(spans.length, 2);
  assert.equal(spans[0].start, 2);
  assert.equal(spans[0].end, 5);
  assert.equal(spans[0].kind, 'rain');
  assert.equal(spans[1].kind, 'snow');
  assert.ok(spans[0].pwin >= 0.99);
});

test('wetSpans: yksittäinen sadetta ennustava malli ei tee sadejaksoa, mutta useampi malli tekee', () => {
  const dry = Array(12).fill(0);
  const wet = [0, 0, 0, 1.2, 0.8, 0, 0, 0, 0, 0, 0, 0];
  // yksi malli seitsemästä
  const one = spanFc([wet, dry, dry, dry, dry, dry, dry]);
  assert.equal(wetSpans(one, 0, 11).length, 0, 'yksi eri mieltä oleva malli ei ole ennuste');
  // kolme seitsemästä: sade on mahdollista
  const three = spanFc([wet, wet, wet, dry, dry, dry, dry]);
  const s3 = wetSpans(three, 0, 11);
  assert.equal(s3.length, 1);
  assert.ok(s3[0].pwin >= 0.3 && s3[0].pwin < 0.6);
});

test('wetSpans: eri aikoihin kuuron antavat mallit antavat yhden jakson ja epävarman ajoituksen', () => {
  // seitsemän mallia, kullakin 6 mm:n kuuro eri tunnilla 2–8: yksittäisellä tunnilla vain yksi malli märkä
  const series = Array.from({ length: 7 }, (_, k) => Array.from({ length: 12 }, (_, i) => (i === 2 + k ? 6 : 0)));
  const fc = spanFc(series);
  const spans = wetSpans(fc, 0, 11, { minPwin: 0.3 });
  assert.equal(spans.length, 1, 'tuntikohtainen yksimielisyys on matala, mutta jakson aikana kaikki mallit ennustavat sadetta');
  assert.ok(spans[0].pwin >= 0.99);
  assert.equal(spans[0].timingUncertain, true);
  assert.equal(spans[0].start, 2);
  assert.equal(spans[0].end, 8);
});

test('suomenkielinen yhteenveto: nyt, tunti ja päivä', () => {
  const fc = blendForecast(synth('rain'));
  const now = describeNow(fc, NOW).join(' ');
  assert.match(now, /Vesisadetta|Kovaa vesisadetta|Heikkoa vesisadetta/);
  assert.match(now, /Tuuli \d+ m\/s/);
  assert.match(now, /Lämpötila vaihtelee/);
  const clear = describeNow(blendForecast(synth('clear')), NOW).join(' ');
  assert.match(clear, /Selkeää/);
  assert.match(clear, /ei odoteta merkittävää sadetta/);
  const day = describeDay(fc, '2026-10-15', NOW).join(' ');
  assert.match(day, /Torstai 15\.10\./);
  const today = describeDay(fc, '2026-10-14', NOW).join(' ');
  assert.match(today, /^Tänään:/);
  const hour = describeHour(fc, 30).join(' ');
  assert.match(hour, /klo 06/);
  assert.ok(day.includes(fmtTemp(fc.days[1].tmax)));
});

test('blendForecast heittää selvän virheen, kun mikään malli ei vastaa', () => {
  assert.throws(() => blendForecast([{ model: MODELS[0], ok: false, error: 'x' }]), /Yksikään säämalli/);
});

test('mallien kokonaismäärä ei sisällä mallia, joka ei kata paikkaa, mutta sisältää mallin, joka ei vastannut', () => {
  const noCoverage = synth('mixed', ['metno']).map((r) => (r.model.key === 'metno' ? { ...r, coverage: true, error: 'Malli ei kata tätä paikkaa' } : r));
  const fc = blendForecast(noCoverage);
  assert.equal(fc.modelsUsed, MODELS.length - 1);
  assert.equal(fc.modelsTotal, MODELS.length - 1);
  assert.equal(fc.models.find((m) => m.key === 'metno').coverage, true);
  const { idx, frac } = nowPosition(fc, NOW);
  const rows = modelRows(noCoverage, fc, idx, frac, snapshot(fc, idx, frac).temp);
  assert.equal(rows.find((r) => r.model.key === 'metno').coverage, true);

  const failed = blendForecast(synth('mixed', ['metno']));
  assert.equal(failed.modelsUsed, MODELS.length - 1);
  assert.equal(failed.modelsTotal, MODELS.length);
});

test('REGRESSIO: yli 20 tunnin sadejaksoa ei kuvata kellonajoilla "klo 13–14", vaan koko vuorokauden kestävänä', () => {
  const now = Date.UTC(2026, 9, 14, 10, 30); // 13:30 Helsingin aikaa
  const results = MODELS.map((m) => {
    const id = m.ids[0];
    return { model: m, ok: true, id, data: parseModelResponse(syntheticResponse({ ...TURKU, modelId: id, nowMs: now, scenario: 'rain' }), id), ms: 5 };
  });
  const fc = blendForecast(results, { nowMs: now });
  const text = describeNow(fc, now).join(' ');
  assert.match(text, /koko seuraavan vuorokauden ajan/, text);
  assert.doesNotMatch(text, /klo 13–14/, text);
  assert.match(text, /yhteensä noin \d+ mm/);
});

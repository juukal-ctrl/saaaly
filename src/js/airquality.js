// airquality.js: ilmanlaatu, siitepöly ja UV-indeksi (Open-Meteo Air Quality API, Euroopan CAMS-mallit, CC BY 4.0).
// "Koodi laskee": luokat (hyvä … erittäin huono, vähäinen … erittäin runsas, matala … äärimmäinen) ja neuvot lasketaan täällä
// puhtailla funktioilla, ja Koti, Tunnit, Viikko, omat huomiot ja chat käyttävät samaa tulosta.
// Lähde on lisä kuten tutkaennuste (sources.js): jos se ei vastaa tai on estetty, sovellus toimii ilman sitä eikä näytä virhettä.
// UV-indeksi tulee ensisijaisesti säämalleilta (weather.js, uv_index); tämän lähteen UV on vain varalla.

import { defaultFetch, zonedToUtcMs, fmtNum } from './util.js';
import { timedRequest } from './sources.js';
import { spanLabel } from './blend.js';

export const AIR_BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality';
/** Mallit päivittyvät muutaman kerran vuorokaudessa: tunnin välein haku riittää. */
export const AIR_TTL = 60 * 60000;
/** Tätä vanhempaa hakua ei käytetä (ennuste on silti tunneittain, mutta vanha haku voi olla toiselta mallikierrokselta). */
export const AIR_MAX_AGE = 24 * 3600000;

export const POLLEN = [
  { key: 'alder', api: 'alder_pollen', name: 'leppä', gen: 'lepän', th: [1, 10, 100, 1000] },
  { key: 'birch', api: 'birch_pollen', name: 'koivu', gen: 'koivun', th: [1, 10, 100, 1000] },
  { key: 'grass', api: 'grass_pollen', name: 'heinät', gen: 'heinien', th: [1, 10, 30, 150] },
  { key: 'mugwort', api: 'mugwort_pollen', name: 'pujo', gen: 'pujon', th: [1, 10, 30, 100] },
  { key: 'ragweed', api: 'ragweed_pollen', name: 'tuoksukki', gen: 'tuoksukin', th: [1, 5, 20, 50] },
];
const GAS = [
  ['aqi', 'european_aqi', 1000],
  ['pm25', 'pm2_5', 2000],
  ['pm10', 'pm10', 3000],
  ['no2', 'nitrogen_dioxide', 2000],
  ['o3', 'ozone', 2000],
  ['uv', 'uv_index', 25],
];
export const AIR_VARS = [...GAS.map((g) => g[1]), ...POLLEN.map((p) => p.api)];

/** Hakuosoite. Sijainti pyöristetään kahteen desimaaliin (noin 1 km) kuten muissa lähteissä; CAMS-ruudukko on silti noin 10 km. */
export function airUrl(lat, lon) {
  const q = new URLSearchParams({
    latitude: Number(lat).toFixed(2),
    longitude: Number(lon).toFixed(2),
    hourly: AIR_VARS.join(','),
    timeformat: 'unixtime',
    forecast_days: '4',
  });
  return `${AIR_BASE}?${q.toString()}`;
}

/**
 * Jäsentää vastauksen: { ok:true, t:[ms], aqi:[], pm25:[], pm10:[], no2:[], o3:[], uv:[], pollen:{ birch:[] … }, hasPollen, note }.
 * Puuttuva arvo pysyy nullina ("ei tietoa", ei nolla). Aineisto ei ole luotettua: arvot rajataan. Heittää, jos rakenne on odottamaton.
 */
export function parseAir(json) {
  const h = json?.hourly;
  if (!h || !Array.isArray(h.time) || !h.time.length) throw new Error('Ilmanlaadun rakenne ei vastaa odotettua');
  const n = Math.min(h.time.length, 24 * 8);
  const t = h.time.slice(0, n).map((x) => (typeof x === 'number' ? x * 1000 : Date.parse(x)));
  if (!t.every(Number.isFinite)) throw new Error('Ilmanlaadun aikaleimat ovat virheellisiä');
  const col = (name, max) => {
    const a = Array.isArray(h[name]) ? h[name] : [];
    return Array.from({ length: n }, (_, i) => {
      const v = a[i];
      return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null;
    });
  };
  const out = { ok: true, t };
  for (const [k, name, max] of GAS) out[k] = col(name, max);
  out.pollen = Object.fromEntries(POLLEN.map((p) => [p.key, col(p.api, 100000)]));
  out.hasPollen = POLLEN.some((p) => out.pollen[p.key].some((v) => v != null));
  const hasAqi = out.aqi.some((v) => v != null);
  if (!hasAqi && !out.hasPollen && !out.uv.some((v) => v != null)) return { ok: false, reason: 'ei ilmanlaatutietoa tälle paikalle' };
  out.note = [hasAqi ? 'ilmanlaatu' : '', out.hasPollen ? 'siitepöly' : '', 'UV'].filter(Boolean).join(', ');
  return out;
}

/** Hakee ja jäsentää ilmanlaadun. Heittää verkko- ja rakennevirheistä (kutsuja suojaa ne sources.js:llä). */
export function fetchAir(lat, lon, { fetchFn = defaultFetch, timeoutMs = 8000, signal = null } = {}) {
  return timedRequest(fetchFn, airUrl(lat, lon), { headers: { Accept: 'application/json' } }, { timeoutMs, signal, label: 'Ilmanlaatu' }, async (res) => {
    if (res.status === 400) return { ok: false, reason: 'ei kattavuutta' };
    if (!res.ok) throw Object.assign(new Error(`Ilmanlaatu: HTTP ${res.status}`), { status: res.status });
    return parseAir(await res.json());
  });
}

// ---------- Luokat ----------

export const AQI_CLASSES = [
  { level: 1, below: 20, word: 'hyvä', advice: '' },
  { level: 2, below: 40, word: 'tyydyttävä', advice: '' },
  { level: 3, below: 60, word: 'kohtalainen', advice: 'Herkimmät (astmaatikot, sydänsairaat) voivat tuntea oireita vilkkaiden teiden varrella.' },
  { level: 4, below: 80, word: 'huono', advice: 'Herkkien kannattaa välttää rasittavaa liikuntaa ulkona, varsinkin vilkkaiden teiden varrella.' },
  { level: 5, below: 100, word: 'erittäin huono', advice: 'Vältä rasittavaa liikuntaa ulkona. Herkkien kannattaa pysyä sisällä ja pitää ikkunat kiinni.' },
  { level: 6, below: Infinity, word: 'äärimmäisen huono', advice: 'Vältä oleskelua ulkona. Pidä ikkunat kiinni.' },
];

/** Eurooppalainen ilmanlaatuindeksi (EAQI, 0–100+) luokaksi. null, jos arvoa ei ole. */
export function aqiLevel(v) {
  if (v == null || !Number.isFinite(v)) return null;
  return AQI_CLASSES.find((c) => v < c.below);
}

// Saasteiden luokkarajat (µg/m³) samoilla väleillä kuin indeksi: millä aineella on huonoin luokka.
const POLLUTANT = [
  { key: 'pm25', name: 'pienhiukkaset', th: [10, 20, 25, 50, 75] },
  { key: 'pm10', name: 'hengitettävät hiukkaset', th: [20, 40, 50, 100, 150] },
  { key: 'no2', name: 'typpidioksidi', th: [40, 90, 120, 230, 340] },
  { key: 'o3', name: 'otsoni', th: [50, 100, 130, 240, 380] },
];

/** Huonoimman luokan saaste tunnille i ({ key, name, level }) tai null. Kertoo, mistä huono ilma johtuu. */
export function dominantPollutant(air, i) {
  let best = null;
  for (const p of POLLUTANT) {
    const v = air[p.key]?.[i];
    if (v == null) continue;
    const level = 1 + p.th.filter((x) => v >= x).length;
    if (!best || level > best.level) best = { key: p.key, name: p.name, level, v };
  }
  return best;
}

export const POLLEN_WORDS = ['ei siitepölyä', 'vähäinen', 'kohtalainen', 'runsas', 'erittäin runsas'];

/** Siitepölypitoisuus (kpl/m³) tasoksi 0–4 lajin rajoilla. Heinien, pujon ja tuoksukin rajat ovat matalammat kuin puiden. */
export function pollenLevel(key, v) {
  const p = POLLEN.find((x) => x.key === key);
  if (!p || v == null || !Number.isFinite(v)) return null;
  const level = p.th.filter((x) => v >= x).length;
  return { level, word: POLLEN_WORDS[level] };
}

export const UV_CLASSES = [
  { level: 0, below: 3, word: 'matala', advice: 'Aurinkosuojaa ei tarvita.' },
  { level: 1, below: 6, word: 'kohtalainen', advice: 'Keskipäivällä aurinkovoide ja lakki, varjossa tauko.' },
  { level: 2, below: 8, word: 'korkea', advice: 'Aurinkovoide (SPF 30+), lakki ja aurinkolasit. Hakeudu varjoon klo 12–15.' },
  { level: 3, below: 11, word: 'erittäin korkea', advice: 'Vältä aurinkoa klo 12–15. Aurinkovoide, lakki, aurinkolasit ja peittävät vaatteet.' },
  { level: 4, below: Infinity, word: 'äärimmäinen', advice: 'Vältä aurinkoa keskipäivällä. Iho palaa hyvin nopeasti.' },
];

/** UV-indeksi luokaksi (WHO:n rajat kokonaisluvuille: 3, 6, 8, 11). */
export function uvLevel(v) {
  if (v == null || !Number.isFinite(v)) return null;
  const r = Math.round(v);
  return { ...UV_CLASSES.find((c) => r < c.below), value: r };
}

// ---------- Ennusteen tunneille ----------

const ROWS = new WeakMap();

/** Ilmanlaadun rivi-indeksit ennusteen tunneille: taulukko fc.hours-indeksistä air-indeksiin (tai -1). Välimuistissa. */
export function airIndex(fc, air) {
  if (!fc || !air?.t) return [];
  let byAir = ROWS.get(fc);
  if (!byAir) ROWS.set(fc, (byAir = new WeakMap()));
  let idx = byAir.get(air);
  if (!idx) {
    const pos = new Map(air.t.map((ms, k) => [Math.round(ms / 3600000), k]));
    idx = fc.hours.map((h) => pos.get(Math.round(zonedToUtcMs(h.t, fc.tz) / 3600000)) ?? -1);
    byAir.set(air, idx);
  }
  return idx;
}

/**
 * Yhden tunnin ilma: { aqi, aqiInfo, dom, uv, uvInfo, uvSrc, pollen:[{ key, name, gen, v, level, word }] } tai null.
 * UV säämalleista (fc.hours[i].uv), ilmanlaadun UV vain jos malleilla ei ole arvoa.
 */
export function hourAir(fc, air, i) {
  const h = fc?.hours?.[i];
  if (!h) return null;
  const k = air ? airIndex(fc, air)[i] : -1;
  const uvW = h.uv;
  const uvA = k >= 0 ? air.uv[k] : null;
  const uv = uvW != null ? uvW : uvA;
  if (k < 0 && uv == null) return null;
  const aqi = k >= 0 ? air.aqi[k] : null;
  const pollen = k >= 0 && air.hasPollen ? POLLEN.map((p) => ({ key: p.key, name: p.name, gen: p.gen, v: air.pollen[p.key][k], ...pollenLevel(p.key, air.pollen[p.key][k]) })).filter((p) => p.v != null) : [];
  return { aqi, aqiInfo: aqiLevel(aqi), dom: k >= 0 ? dominantPollutant(air, k) : null, uv, uvInfo: uvLevel(uv), uvSrc: uvW != null ? 'malli' : uv != null ? 'ilmanlaatu' : null, pollen };
}

/**
 * Yhteenveto tuntiväliltä from..to: suurin ilmanlaatuindeksi, siitepöly lajeittain ja UV. Jaksot (start..end) kertovat, milloin taso on korkein.
 * { aqi: { max, i, info, dom, start, end } | null, pollen: [{ key, name, gen, max, i, level, word, start, end, peakStart, peakEnd }], uv: { max, i, info, start, end } | null,
 *   covered: tunteja, joille ilmanlaatutieto löytyi, hours: välin tuntien määrä }
 */
export function airWindow(fc, air, from, to) {
  const last = (fc?.hours?.length || 0) - 1;
  from = Math.max(0, from);
  to = Math.min(last, to);
  const out = { aqi: null, pollen: [], uv: null, covered: 0, hours: Math.max(0, to - from + 1), hasPollen: Boolean(air?.hasPollen) };
  if (!fc || to < from) return out;
  const rows = [];
  for (let i = from; i <= to; i++) rows.push([i, hourAir(fc, air, i)]);
  const span = (test) => {
    const hits = rows.filter(([, r]) => r && test(r)).map(([i]) => i);
    return hits.length ? { start: hits[0], end: hits.at(-1) } : { start: -1, end: -1 };
  };
  for (const [i, r] of rows) {
    if (!r) continue;
    if (r.aqi != null || r.pollen.length) out.covered++;
    if (r.aqi != null && (!out.aqi || r.aqi > out.aqi.max)) out.aqi = { max: r.aqi, i, info: r.aqiInfo, dom: r.dom };
    if (r.uv != null && (!out.uv || r.uv > out.uv.max)) out.uv = { max: r.uv, i, info: r.uvInfo };
  }
  if (out.aqi) Object.assign(out.aqi, span((r) => aqiLevel(r.aqi)?.level >= out.aqi.info.level));
  if (out.uv) Object.assign(out.uv, out.uv.info.level >= 1 ? span((r) => r.uvInfo?.level >= 1) : { start: out.uv.i, end: out.uv.i });
  for (const p of POLLEN) {
    let best = null;
    for (const [i, r] of rows) {
      const x = r?.pollen.find((q) => q.key === p.key);
      if (x && (!best || x.v > best.max)) best = { key: p.key, name: p.name, gen: p.gen, max: x.v, i, level: x.level, word: x.word };
    }
    if (!best) continue;
    Object.assign(best, span((r) => (r.pollen.find((q) => q.key === p.key)?.level ?? 0) >= Math.max(1, best.level)));
    // Huippujakso: tunnit, joilla pitoisuus on vähintään 3/4 huipusta ("eniten klo 12–17")
    const peak = span((r) => (r.pollen.find((q) => q.key === p.key)?.v ?? 0) >= best.max * 0.75);
    best.peakStart = peak.start;
    best.peakEnd = peak.end;
    out.pollen.push(best);
  }
  out.pollen.sort((a, b) => b.level - a.level || b.max - a.max);
  return out;
}

/** Kpl/m³ lyhyesti: alle 10 yhdellä desimaalilla ei tarvita, isot luvut pyöristetään. */
export const grains = (v) => `${fmtNum(v >= 100 ? Math.round(v / 10) * 10 : v)} kpl/m³`;

/**
 * Kodin pieni ilmarivi: vain olennainen. Siitepöly kohtalaisesta alkaen (enintään kaksi lajia), ilmanlaatu huonosta alkaen
 * ja UV-indeksi 3:sta alkaen. Tyhjä taulukko = ei mitään näytettävää.
 * Palauttaa [{ kind:'pollen'|'aqi'|'uv', text, level (0–3 vakavuus näytölle), sr }].
 */
export function airHighlights(sum) {
  if (!sum) return [];
  const out = [];
  for (const p of sum.pollen.filter((x) => x.level >= 2).slice(0, 2)) {
    out.push({ kind: 'pollen', text: `${cap1(p.name)} ${p.word}`, level: p.level >= 4 ? 3 : p.level - 1, sr: `${cap1(p.gen)} siitepölyä ${p.word === 'erittäin runsas' ? 'erittäin runsaasti' : p.word === 'runsas' ? 'runsaasti' : 'kohtalaisesti'}` });
  }
  if (sum.aqi && sum.aqi.info.level >= 4) out.push({ kind: 'aqi', text: `Ilmanlaatu ${sum.aqi.info.word}`, level: sum.aqi.info.level >= 5 ? 3 : 2, sr: `Ilmanlaatu ${sum.aqi.info.word}` });
  if (sum.uv && sum.uv.info.level >= 1) out.push({ kind: 'uv', text: `UV ${sum.uv.info.value}`, level: sum.uv.info.level >= 3 ? 3 : sum.uv.info.level, sr: `UV-indeksi ${sum.uv.info.value}, ${sum.uv.info.word}` });
  return out;
}

const cap1 = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * Omat huomiot ilmasta etusivun varoitusriville (sama muoto kuin advice.js:n ownAlerts). Koti pysyy rauhallisena:
 * siitepölystä vain erittäin runsas, ilmanlaadusta huono tai huonompi. Ei virallinen varoitus.
 */
export function airAlerts(fc, air, from, to) {
  if (!air || !fc) return [];
  const sum = airWindow(fc, air, from, to);
  const today = fc.hours[Math.max(0, from)]?.t.slice(0, 10);
  const lbl = (a, b) => spanLabel(fc, a, b, today);
  const out = [];
  if (sum.aqi && sum.aqi.info.level >= 4) {
    const l = sum.aqi.info.level >= 5 ? 2 : 1;
    const why = sum.aqi.dom && sum.aqi.dom.level >= 3 ? ` (eniten ${sum.aqi.dom.name})` : '';
    out.push({ key: 'aqi', level: l, title: l >= 2 ? 'Erittäin huono ilmanlaatu' : 'Huono ilmanlaatu', text: `Ilmanlaatu on ${sum.aqi.info.word} ${lbl(sum.aqi.start, sum.aqi.end)}${why}. ${sum.aqi.info.advice}`, short: `${lbl(sum.aqi.start, sum.aqi.end)}${sum.aqi.dom && sum.aqi.dom.level >= 3 ? `, ${sum.aqi.dom.name}` : ''}`, start: sum.aqi.start, end: sum.aqi.end });
  }
  const hi = sum.pollen.filter((p) => p.level >= 4);
  if (hi.length) {
    const p = hi[0];
    const names = hi.map((x) => x.gen).join(' ja ');
    out.push({ key: 'pollen', level: 1, title: `Erittäin runsaasti ${p.gen} siitepölyä`, text: `${cap1(names)} siitepölyä on ilmassa erittäin runsaasti ${lbl(p.start, p.end)} (jopa ${grains(p.max)}). Allergisen kannattaa ottaa lääke ajoissa, pitää ikkunat kiinni päivällä ja vaihtaa vaatteet ulkoilun jälkeen.`, short: `${p.name} ${lbl(p.start, p.end)}`, start: p.start, end: p.end });
  }
  out.forEach((a) => (a.word = a.level >= 2 ? 'vahva huomio' : 'huomio'));
  return out;
}

/** Onko haettu ilmanlaatu tälle paikalle käyttökelpoinen hetkellä now. */
export function airUsable(entry, key, now) {
  return Boolean(entry?.raw && entry.key === key && now - entry.at < AIR_MAX_AGE);
}

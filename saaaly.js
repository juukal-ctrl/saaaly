// GENEROITU TIEDOSTO. Älä muokkaa: lähdekoodi on js/-kansiossa. Tämä tehdään komennolla "node tools/build.mjs".
(() => {
'use strict';
const __m = {};

// ---- util.js ----
__m['util'] = (() => {
// util.js: muotoilu, aika-apurit, tallennus ja pieni turvallinen markdown-renderöijä.

const MINUS = '−';
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const defaultFetch = (...args) => globalThis.fetch(...args);

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---------- Numerot ja lämpötilat ----------

function roundHalfAway(x, digits = 0) {
  const k = 10 ** digits;
  return (Math.sign(x) * Math.round(Math.abs(x) * k)) / k;
}

function fmtNum(x, digits = 0) {
  if (x == null || !Number.isFinite(x)) return '–';
  return roundHalfAway(x, digits).toFixed(digits).replace('.', ',');
}

/** Suomalainen lämpötilamerkintä: +9°, −3°, 0° (oikea miinusmerkki). */
function fmtTemp(t, { sign = true, digits = 0 } = {}) {
  if (t == null || !Number.isFinite(t)) return '–';
  const r = roundHalfAway(t, digits);
  if (r === 0) return '0°';
  return (r < 0 ? MINUS : sign ? '+' : '') + fmtNum(Math.abs(r), digits) + '°';
}

function fmtMm(mm) {
  if (mm == null || !Number.isFinite(mm)) return '–';
  if (mm < 0.05) return '0 mm';
  return fmtNum(mm, mm < 10 ? 1 : 0) + ' mm';
}

const FROM = ['pohjoisesta', 'koillisesta', 'idästä', 'kaakosta', 'etelästä', 'lounaasta', 'lännestä', 'luoteesta'];
/** Tuulen tulosuunta suomeksi (elatiivi): 225° -> "lounaasta". */
function windFrom(deg) {
  if (deg == null || !Number.isFinite(deg)) return '';
  return FROM[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

function fmtCoord(v, pos, neg) {
  return fmtNum(Math.abs(v), 2) + '°' + (v >= 0 ? pos : neg);
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// ---------- Päivämäärät ----------

const WD_SHORT = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];
const WD_LONG = ['sunnuntai', 'maanantai', 'tiistai', 'keskiviikko', 'torstai', 'perjantai', 'lauantai'];

function weekday(dateStr, long = false) {
  const d = new Date(dateStr + 'T00:00:00Z').getUTCDay();
  return (long ? WD_LONG : WD_SHORT)[d];
}

/** "2026-10-14" -> "14.10." */
function fmtDM(dateStr) {
  const [, m, d] = dateStr.split('-');
  return `${+d}.${+m}.`;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const hhmm = (iso) => iso.slice(11, 16);

// ---------- Aikavyöhykkeet ----------

const dtfCache = new Map();
function dtf(tz) {
  let f = dtfCache.get(tz);
  if (!f) {
    const opts = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' };
    try {
      f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...opts });
    } catch {
      f = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...opts });
    }
    dtfCache.set(tz, f);
  }
  return f;
}

function partsIn(ms, tz) {
  const o = {};
  for (const p of dtf(tz).formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
}

const pad2 = (n) => String(n).padStart(2, '0');

/** Paikallinen kellonaika annetussa aikavyöhykkeessä. */
function localNow(ms, tz) {
  const p = partsIn(ms, tz);
  const date = `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
  return { date, hour: p.h, minute: p.mi, iso: `${date}T${pad2(p.h)}:${pad2(p.mi)}` };
}

function tzOffsetMs(ms, tz) {
  const p = partsIn(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** Paikallinen ISO-aika ("2026-10-14T20:00") -> UTC-millisekunnit. */
function zonedToUtcMs(iso, tz) {
  const [dPart, tPart = '00:00'] = iso.split('T');
  const [y, m, d] = dPart.split('-').map(Number);
  const [h, mi] = tPart.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, h, mi, 0);
  const off1 = tzOffsetMs(naive, tz);
  let guess = naive - off1;
  const off2 = tzOffsetMs(guess, tz);
  if (off2 !== off1) guess = naive - off2;
  return guess;
}

// ---------- Tallennus (kestää puuttuvan localStoragen) ----------

const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem('saaaly.' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('saaaly.' + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  del(key) {
    try {
      localStorage.removeItem('saaaly.' + key);
    } catch {
      /* ei väliä */
    }
  },
};

// ---------- Turvallinen markdown ----------

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function inline(s) {
  // s on jo HTML-escapattu
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\s][^_]*?)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
}

/** Muuntaa pienen osajoukon markdownia HTML:ksi: **lihavointi**, *kursiivi*, listat, otsikot, kappaleet. */
function mdToHtml(md) {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let list = null;
  let para = [];
  const flushPara = () => {
    if (para.length) out.push('<p>' + para.join('<br>') + '</p>');
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.type}>` + list.items.map((i) => `<li>${i}</li>`).join('') + `</${list.type}>`);
    list = null;
  };
  for (const raw of lines) {
    const line = escapeHtml(raw.trimEnd());
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    let m = line.match(/^\s*(?:[-*•])\s+(.*)$/);
    if (m) {
      flushPara();
      if (!list || list.type !== 'ul') {
        flushList();
        list = { type: 'ul', items: [] };
      }
      list.items.push(inline(m[1]));
      continue;
    }
    m = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (m) {
      flushPara();
      if (!list || list.type !== 'ol') {
        flushList();
        list = { type: 'ol', items: [] };
      }
      list.items.push(inline(m[1]));
      continue;
    }
    m = line.match(/^#{1,6}\s+(.*)$/);
    if (m) {
      flushPara();
      flushList();
      out.push('<p><strong>' + inline(m[1]) + '</strong></p>');
      continue;
    }
    flushList();
    para.push(inline(line.trim()));
  }
  flushPara();
  flushList();
  return out.join('');
}
return { MINUS, clamp, lerp, defaultFetch, debounce, roundHalfAway, fmtNum, fmtTemp, fmtMm, windFrom, fmtCoord, cap, weekday, fmtDM, addDays, hhmm, partsIn, localNow, tzOffsetMs, zonedToUtcMs, store, escapeHtml, mdToHtml };
})();

// ---- models.js ----
__m['models'] = (() => {
// models.js: käytettävät säämallit. Jokainen malli haetaan omana kutsunaan, jotta yksi
// virheellinen tai poistunut malli ei kaada koko hakua.
//
// ids: kokeillaan järjestyksessä; seuraava kokeillaan vain, jos edellinen hylätään virheellisenä (HTTP 400).
// weight: ennakkopaino yhdistelmässä. Nämä ovat arvioita; tarkennetaan, kun ennusteita on verrattu havaintoihin.
// optional: puuttuva malli ohitetaan hiljaa.

const MODELS = [
  { key: 'ecmwf', ids: ['ecmwf_ifs', 'ecmwf_ifs025'], label: 'ECMWF IFS', short: 'ECMWF', weight: 1.4 },
  { key: 'metno', ids: ['metno_nordic'], label: 'MET Norway (Pohjoismaat)', short: 'MET Nordic', weight: 1.3 },
  { key: 'icon', ids: ['icon_seamless'], label: 'DWD ICON', short: 'ICON', weight: 1.1 },
  { key: 'arpege', ids: ['meteofrance_seamless'], label: 'Météo-France', short: 'Météo-France', weight: 1.0 },
  { key: 'ukmo', ids: ['ukmo_seamless'], label: 'UK Met Office', short: 'UKMO', weight: 1.0 },
  { key: 'gfs', ids: ['gfs_seamless'], label: 'NOAA GFS', short: 'GFS', weight: 0.7 },
  { key: 'gem', ids: ['gem_seamless'], label: 'Kanadan GEM', short: 'GEM', weight: 0.6 },
  { key: 'fmi', ids: ['fmi_seamless'], label: 'Ilmatieteen laitos', short: 'FMI', weight: 1.5, optional: true },
];
return { MODELS };
})();

// ---- weather.js ----
__m['weather'] = (() => {
// weather.js: säädatan haku Open-Meteosta. Jokainen malli haetaan omana kutsunaan, mutta enintään
// muutama kerrallaan (rajapinta hylkää liian monta samanaikaista kutsua). fetchModel ei koskaan heitä
// virhettä, joten yksi huono malli ei kaada koko hakua.

const { MODELS } = __m['models'];
const { defaultFetch, store } = __m['util'];

const API_BASE = 'https://api.open-meteo.com/v1/forecast';

// Vain vakiomuuttujia, joita rajapinta tukee kaikille malleille. Puuttuva muuttuja palautuu null-arvoina.
const HOURLY = [
  'temperature_2m',
  'apparent_temperature',
  'relative_humidity_2m',
  'precipitation',
  'snowfall',
  'weather_code',
  'cloud_cover',
  'pressure_msl',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'is_day',
];

class ApiError extends Error {
  constructor(message, { status = 0, kind = 'http' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind;
  }
}

function buildUrl(lat, lon, id, { days = 7 } = {}) {
  const q = new URLSearchParams({
    latitude: Number(lat).toFixed(4),
    longitude: Number(lon).toFixed(4),
    hourly: HOURLY.join(','),
    models: id,
    timezone: 'auto',
    forecast_days: String(days),
    wind_speed_unit: 'ms',
  });
  return `${API_BASE}?${q.toString()}`;
}

async function fetchJson(url, { fetchFn = defaultFetch, timeoutMs = 15000, noCache = false } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { signal: ctl.signal, cache: noCache ? 'no-cache' : 'default' });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* ei JSON-vastaus */
    }
    if (!res.ok) throw new ApiError(body?.reason || `HTTP ${res.status}`, { status: res.status });
    if (body == null) throw new ApiError('Vastaus ei ollut JSON-muotoista', { kind: 'parse' });
    if (body.error) throw new ApiError(body.reason || 'Rajapinta palautti virheen', { status: res.status || 400 });
    return body;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e?.name === 'AbortError') throw new ApiError(`Aikakatkaisu (${Math.round(timeoutMs / 1000)} s)`, { kind: 'timeout' });
    throw new ApiError(e?.message || 'Verkkovirhe', { kind: 'network' });
  } finally {
    clearTimeout(timer);
  }
}

function parseModelResponse(json, id) {
  const h = json?.hourly;
  if (!h || !Array.isArray(h.time) || !h.time.length) throw new ApiError('Vastauksessa ei ollut tuntidataa', { kind: 'parse' });
  const vars = {};
  for (const v of HOURLY) {
    // Yhden mallin vastauksessa avaimet ovat ilman päätettä; monimallivastauksessa päätteenä on mallin nimi.
    const arr = h[v] ?? h[`${v}_${id}`];
    vars[v] = Array.isArray(arr) ? arr : null;
  }
  const t = vars.temperature_2m;
  if (!t || !t.some((x) => x != null && Number.isFinite(x))) {
    throw new ApiError('Malli ei palauttanut lämpötiloja tälle paikalle', { kind: 'nodata' });
  }
  return {
    id,
    time: h.time,
    tz: json.timezone || 'UTC',
    utcOffset: json.utc_offset_seconds ?? 0,
    lat: json.latitude,
    lon: json.longitude,
    elevation: json.elevation ?? null,
    vars,
  };
}

// ---- Virhetilanteiden tunnistus ja uudelleenyritys ----

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Open-Meteo hylkää kutsun, kun samalta osoitteelta tulee liikaa samanaikaisia kutsuja. Hetken päästä kannattaa yrittää uudelleen. */
const isBusy = (e) => /too many concurrent/i.test(e?.message || '');

/** Alueellinen malli (esim. MET Nordic) ei kata paikkaa. Ei ole virhe eikä merkki mallin poistumisesta. */
const isNoCoverage = (e) => /no data is available for this location/i.test(e?.message || '');

async function fetchWithRetry(url, opts, { retries, sleepFn }) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchJson(url, opts);
    } catch (e) {
      if (attempt >= retries || !isBusy(e)) throw e;
      await sleepFn(300 * (attempt + 1) + Math.floor(Math.random() * 250));
    }
  }
}

// ---- Mallien saatavuuden muisti (säästää turhia kutsuja) ----

const HALF_DAY = 12 * 3600 * 1000;

function getResolved() {
  return store.get('resolved', {}) || {};
}

function orderedIds(model) {
  const pref = getResolved()[model.key];
  return pref && model.ids.includes(pref) ? [pref, ...model.ids.filter((x) => x !== pref)] : [...model.ids];
}

function rememberResolved(model, id) {
  const r = getResolved();
  if (r[model.key] !== id) store.set('resolved', { ...r, [model.key]: id });
}

function isDead(model, now) {
  const d = store.get('dead', {}) || {};
  return !!d[model.key] && d[model.key] > now;
}

function markDead(model, now) {
  const d = store.get('dead', {}) || {};
  store.set('dead', { ...d, [model.key]: now + HALF_DAY });
}

const elapsed = (t0) => Math.round((globalThis.performance?.now?.() ?? Date.now()) - t0);

/** Hakee yhden mallin. Ei koskaan heitä: palauttaa { ok:false, error } virhetilanteessa. */
async function fetchModel(model, lat, lon, { fetchFn = defaultFetch, noCache = false, days = 7, now = Date.now(), timeoutMs = 15000, sleepFn = defaultSleep, retries = 2 } = {}) {
  const t0 = globalThis.performance?.now?.() ?? Date.now();
  if (model.optional && isDead(model, now)) {
    return { model, ok: false, skipped: true, id: model.ids[0], error: 'Ei saatavilla (ohitettu)', ms: 0 };
  }
  let lastErr = null;
  for (const id of orderedIds(model)) {
    try {
      const json = await fetchWithRetry(buildUrl(lat, lon, id, { days }), { fetchFn, noCache, timeoutMs }, { retries, sleepFn });
      const data = parseModelResponse(json, id);
      rememberResolved(model, id);
      return { model, ok: true, id, data, ms: elapsed(t0) };
    } catch (e) {
      lastErr = e;
      if (isNoCoverage(e) || isBusy(e) || e.status !== 400) break; // vain virheellinen mallinimi kokeilee seuraavaa tunnistetta
    }
  }
  if (isNoCoverage(lastErr)) {
    return { model, ok: false, coverage: true, id: model.ids[0], error: 'Malli ei kata tätä paikkaa', status: lastErr.status, kind: 'coverage', ms: elapsed(t0) };
  }
  if (model.optional && lastErr?.status === 400 && !isBusy(lastErr)) markDead(model, now);
  return {
    model,
    ok: false,
    id: model.ids[0],
    error: lastErr?.message ?? 'Tuntematon virhe',
    status: lastErr?.status ?? 0,
    kind: lastErr?.kind,
    ms: elapsed(t0),
  };
}

/** Hakee kaikki mallit, enintään `concurrency` kerrallaan. Tulokset ovat samassa järjestyksessä kuin mallit. */
async function fetchAll(lat, lon, { models = MODELS, fetchFn = defaultFetch, noCache = false, days = 7, now = Date.now(), timeoutMs = 10000, concurrency = 3, sleepFn } = {}) {
  const results = new Array(models.length);
  let next = 0;
  const worker = async () => {
    while (next < models.length) {
      const i = next++;
      results[i] = await fetchModel(models[i], lat, lon, { fetchFn, noCache, days, now, timeoutMs, ...(sleepFn ? { sleepFn } : {}) });
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), models.length) }, worker));
  return results;
}

function summarizeErrors(results) {
  const bad = results.filter((r) => !r.ok && !r.skipped && !r.coverage);
  if (!bad.length) return 'Ei virheitä';
  const first = bad[0];
  const same = bad.every((r) => r.error === first.error);
  return same ? first.error : bad.map((r) => `${r.model.short}: ${r.error}`).join('; ');
}
return { API_BASE, HOURLY, ApiError, buildUrl, parseModelResponse, fetchModel, fetchAll, summarizeErrors };
})();

// ---- sun.js ----
__m['sun'] = (() => {
// sun.js: auringon asema, nousu ja lasku (SunCalc-tyylinen laskenta, ei verkkokutsuja).

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;

const toDays = (ms) => ms / DAY_MS - 0.5 + J1970 - J2000;

function sunCoords(d) {
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(L) * Math.sin(OBLIQUITY));
  const ra = Math.atan2(Math.sin(L) * Math.cos(OBLIQUITY), Math.cos(L));
  return { dec, ra };
}

/** Auringon korkeus (astetta horisontin yläpuolella) ja suunta (astetta pohjoisesta myötäpäivään). */
function sunPosition(ms, lat, lon) {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(ms);
  const { dec, ra } = sunCoords(d);
  const H = RAD * (280.16 + 360.9856235 * d) - lw - ra;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const azSouth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { altitudeDeg: alt / RAD, bearingDeg: (((azSouth / RAD + 180) % 360) + 360) % 360 };
}

/**
 * Nousu ja lasku vuorokaudelle, joka alkaa hetkellä dayStartMs (UTC ms).
 * polar: 'day' (aurinko ei laske), 'night' (aurinko ei nouse) tai null.
 */
function sunEvents(dayStartMs, lat, lon, stepMin = 4) {
  const h0 = -0.833;
  const step = stepMin * 60000;
  let prev = sunPosition(dayStartMs, lat, lon).altitudeDeg;
  let rise = null;
  let set = null;
  for (let t = dayStartMs + step; t <= dayStartMs + DAY_MS; t += step) {
    const a = sunPosition(t, lat, lon).altitudeDeg;
    const cross = t - step + (step * (h0 - prev)) / (a - prev);
    if (prev < h0 && a >= h0) {
      if (rise == null) rise = cross;
    } else if (prev >= h0 && a < h0) {
      set = cross;
    }
    prev = a;
  }
  let polar = null;
  if (rise == null && set == null) {
    polar = sunPosition(dayStartMs + DAY_MS / 2, lat, lon).altitudeDeg > h0 ? 'day' : 'night';
  }
  return { rise, set, polar };
}

/** Päivän pituus millisekunteina (null, jos ei määriteltävissä). */
function dayLengthMs(ev) {
  if (ev.polar === 'day') return DAY_MS;
  if (ev.polar === 'night') return 0;
  if (ev.rise != null && ev.set != null && ev.set > ev.rise) return ev.set - ev.rise;
  return null;
}

const SYNODIC_DAYS = 29.530588853;
const NEW_MOON_JD = 2451550.26; // uusikuu 6.1.2000 klo 18.14 UTC

/**
 * Kuun vaihe (0 = uusi, 0,5 = täysi), valaistu osuus ja karkea asema taivaalla.
 * Asema on arvio keskimääräisestä kiertoradasta: kuu ylittää etelän aurinkoaikaa 12 h + vaihe × 24 h.
 * hourAngle: tunteja ylityksestä (negatiivinen = nousemassa idässä), altitudeDeg: karkea korkeus.
 */
function moonInfo(ms, lat, lon) {
  const jd = ms / DAY_MS + 2440587.5;
  const phase = ((((jd - NEW_MOON_JD) / SYNODIC_DAYS) % 1) + 1) % 1;
  const illum = (1 - Math.cos(phase * 2 * Math.PI)) / 2;
  const solarHour = (((ms / 3600000 + lon / 15) % 24) + 24) % 24;
  const hourAngle = ((((solarHour - (12 + phase * 24)) % 24) + 36) % 24) - 12;
  const altitudeDeg = 34 * Math.cos((hourAngle / 12) * Math.PI) - 4;
  return { phase, illum, hourAngle, altitudeDeg };
}
return { sunPosition, sunEvents, dayLengthMs, moonInfo };
})();

// ---- blend.js ----
__m['blend'] = (() => {
// blend.js: usean mallin yhdistäminen yhdeksi ennusteeksi. Kaikki laskenta on deterministista koodia.
// Tekoäly ei koske lukuihin, se vain selittää valmiin tuloksen.

const { clamp, lerp, localNow, zonedToUtcMs, fmtTemp, fmtNum, fmtMm, windFrom, weekday, fmtDM, cap } = __m['util'];
const { sunPosition } = __m['sun'];

const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);
const SLEET_CODES = new Set([56, 57, 66, 67]);
const THUNDER_CODES = new Set([95, 96, 99]);
const FOG_CODES = new Set([45, 48]);

const SYMBOLS = {
  clear: 'Selkeää',
  mostly_clear: 'Enimmäkseen selkeää',
  partly_cloudy: 'Puolipilvistä',
  mostly_cloudy: 'Enimmäkseen pilvistä',
  overcast: 'Pilvistä',
  fog: 'Sumua',
  drizzle: 'Tihkua',
  rain_light: 'Heikkoa vesisadetta',
  rain: 'Vesisadetta',
  rain_heavy: 'Kovaa vesisadetta',
  sleet: 'Räntää',
  snow_light: 'Heikkoa lumisadetta',
  snow: 'Lumisadetta',
  snow_heavy: 'Kovaa lumisadetta',
  thunder: 'Ukkosta',
};

// ---------- Tilastoapurit ----------

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function wMedian(items) {
  const s = [...items].sort((a, b) => a.v - b.v);
  const half = s.reduce((a, x) => a + x.w, 0) / 2;
  let acc = 0;
  for (let i = 0; i < s.length; i++) {
    acc += s[i].w;
    if (Math.abs(acc - half) < 1e-9 && i + 1 < s.length) return (s[i].v + s[i + 1].v) / 2;
    if (acc > half) return s[i].v;
  }
  return s[s.length - 1].v;
}

function wMean(items) {
  let sw = 0;
  let sv = 0;
  for (const x of items) {
    sw += x.w;
    sv += x.w * x.v;
  }
  return sw ? sv / sw : null;
}

/** Painotettu keskiarvo, josta on poistettu selvät poikkeamat. */
function combine(items, absFloor) {
  if (!items.length) return { value: null, n: 0, spread: 0 };
  let used = items;
  if (items.length >= 3) {
    const med = wMedian(items);
    const mad = median(items.map((x) => Math.abs(x.v - med)));
    const thr = Math.max(absFloor, 2.2 * 1.4826 * mad);
    const kept = items.filter((x) => Math.abs(x.v - med) <= thr);
    if (kept.length >= 2) used = kept;
  }
  const vs = used.map((x) => x.v);
  return { value: wMean(used), n: used.length, spread: Math.max(...vs) - Math.min(...vs) };
}

function circMean(items) {
  let x = 0;
  let y = 0;
  for (const it of items) {
    const r = (it.deg * Math.PI) / 180;
    x += it.w * Math.sin(r);
    y += it.w * Math.cos(r);
  }
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return null;
  return (((Math.atan2(x, y) * 180) / Math.PI) + 360) % 360;
}

// ---------- Sääsymbolit ----------

function cloudSymbol(cloud) {
  if (cloud < 10) return 'clear';
  if (cloud < 30) return 'mostly_clear';
  if (cloud < 60) return 'partly_cloudy';
  if (cloud < 85) return 'mostly_cloudy';
  return 'overcast';
}

function pickSymbol({ precip, cloud, snowShare = 0, thunderShare = 0, fogShare = 0 }) {
  if (thunderShare >= 0.34 && precip >= 0.05) return 'thunder';
  if (precip >= 0.1) {
    if (snowShare >= 0.6) return precip < 0.3 ? 'snow_light' : precip < 1.5 ? 'snow' : 'snow_heavy';
    if (snowShare >= 0.25) return 'sleet';
    if (precip < 0.25) return 'drizzle';
    return precip < 0.8 ? 'rain_light' : precip < 2.5 ? 'rain' : 'rain_heavy';
  }
  if (fogShare >= 0.5) return 'fog';
  return cloudSymbol(cloud);
}

function dailySymbol(all, day) {
  const precip = all.reduce((a, h) => a + h.precip, 0);
  const wetHours = all.filter((h) => h.precip >= 0.1).length;
  if (all.some((h) => h.sym === 'thunder')) return 'thunder';
  if (precip >= 0.8 && wetHours >= 2) {
    const snowShare = all.reduce((a, h) => a + h.precip * h.snowShare, 0) / precip;
    if (snowShare >= 0.6) return precip < 1.5 ? 'snow_light' : precip < 5 ? 'snow' : 'snow_heavy';
    if (snowShare >= 0.25) return 'sleet';
    return precip < 2 ? 'rain_light' : precip < 8 ? 'rain' : 'rain_heavy';
  }
  if (day.filter((h) => h.sym === 'fog').length / day.length >= 0.5) return 'fog';
  return cloudSymbol(median(day.map((h) => h.cloud ?? 50)));
}

// ---------- Yhdistelmä ----------

function sameTimeline(a, b) {
  return a.length === b.length && a[0] === b[0] && a[a.length - 1] === b[b.length - 1];
}

/**
 * Yhdistää onnistuneet mallivastaukset yhdeksi tuntiennusteeksi ja päiväyhteenvedoiksi.
 * results: fetchAll-funktion tulos.
 */
function blendForecast(results) {
  const ok = results.filter((r) => r.ok);
  if (!ok.length) throw new Error('Yksikään säämalli ei vastannut');
  const first = ok[0].data;
  const tz = first.tz || 'UTC';
  const lat = first.lat;
  const lon = first.lon;
  const longest = ok.reduce((a, b) => (b.data.time.length > a.data.time.length ? b : a)).data;
  const time = longest.time;

  // Kohdistus: tavallisesti aikajanat ovat samat (indeksi i = indeksi i). Muuten haetaan aikaleiman mukaan.
  const align = {};
  for (const r of ok) {
    if (sameTimeline(r.data.time, time)) align[r.model.key] = (i) => i;
    else {
      const m = new Map();
      r.data.time.forEach((t, i) => m.set(t, i));
      align[r.model.key] = (i) => m.get(time[i]);
    }
  }

  const hours = [];
  for (let i = 0; i < time.length; i++) {
    const t = time[i];
    const get = (v) => {
      const out = [];
      ok.forEach((r, k) => {
        const arr = r.data.vars[v];
        if (!arr) return;
        const j = align[r.model.key](i);
        if (j == null) return;
        const x = arr[j];
        if (x == null || !Number.isFinite(x)) return;
        out.push({ v: x, w: r.model.weight, k });
      });
      return out;
    };

    const T = combine(get('temperature_2m'), 3);
    if (T.value == null) continue; // mallien horisontin takana
    const FEELS = combine(get('apparent_temperature'), 4);
    const HUM = combine(get('relative_humidity_2m'), 25);
    const CLOUD = combine(get('cloud_cover'), 45);
    const PRESS = combine(get('pressure_msl'), 6);
    const windItems = get('wind_speed_10m');
    const WIND = combine(windItems, 4);
    const GUST = combine(get('wind_gusts_10m'), 6);
    const dirItems = get('wind_direction_10m')
      .map((d) => ({ deg: d.v, w: d.w * (windItems.find((x) => x.k === d.k)?.v ?? 1) + 0.01 }));

    const precipItems = get('precipitation');
    const pTotalW = precipItems.reduce((a, x) => a + x.w, 0);
    const precip = precipItems.length ? wMean(precipItems) : 0;
    const pop = pTotalW ? precipItems.filter((x) => x.v >= 0.1).reduce((a, x) => a + x.w, 0) / pTotalW : 0;

    // Lumen osuus sateesta: ensisijaisesti lumisateesta, sitten säätunnuksesta, viimeksi lämpötilasta.
    const snowItems = get('snowfall');
    const codeItems = get('weather_code');
    const tItems = get('temperature_2m');
    let sw = 0;
    let ss = 0;
    for (const p of precipItems) {
      if (p.v < 0.05) continue;
      let share = null;
      const sf = snowItems.find((x) => x.k === p.k);
      if (sf && sf.v > 0) share = clamp(sf.v / 0.7 / p.v, 0, 1);
      if (share == null) {
        const c = codeItems.find((x) => x.k === p.k);
        if (c) {
          if (SNOW_CODES.has(c.v)) share = 1;
          else if (SLEET_CODES.has(c.v)) share = 0.5;
          else if (c.v >= 50 && c.v <= 82) share = 0;
        }
      }
      if (share == null) {
        const tt = tItems.find((x) => x.k === p.k);
        share = tt ? (tt.v <= 0 ? 1 : tt.v < 1.5 ? 0.5 : 0) : 0;
      }
      sw += p.w * p.v;
      ss += p.w * p.v * share;
    }
    const snowShare = sw > 0 ? ss / sw : T.value <= 0 ? 1 : T.value < 1.5 ? 0.5 : 0;

    const codeW = codeItems.reduce((a, x) => a + x.w, 0);
    const share = (set) => (codeW ? codeItems.filter((x) => set.has(x.v)).reduce((a, x) => a + x.w, 0) / codeW : 0);
    const thunderShare = share(THUNDER_CODES);
    const fogShare = share(FOG_CODES);

    const dayItem = get('is_day')[0];
    const isDay = dayItem ? dayItem.v >= 0.5 : sunPosition(zonedToUtcMs(t, tz), lat, lon).altitudeDeg > -0.833;
    const cloud = CLOUD.value ?? 50;

    hours.push({
      t,
      temp: T.value,
      feels: FEELS.value ?? T.value,
      hum: HUM.value,
      cloud,
      press: PRESS.value,
      wind: WIND.value ?? 0,
      gust: GUST.value ?? WIND.value ?? 0,
      dir: dirItems.length ? circMean(dirItems) : null,
      precip,
      pop,
      snowShare,
      thunderShare,
      sym: pickSymbol({ precip, cloud, snowShare, thunderShare, fogShare }),
      isDay,
      spread: T.spread,
      n: T.n,
    });
  }
  if (!hours.length) throw new Error('Mallit eivät palauttaneet ennustetunteja');

  // Päiväyhteenvedot paikallisen kalenteripäivän mukaan
  const byDate = new Map();
  hours.forEach((h, i) => {
    const d = h.t.slice(0, 10);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(i);
  });
  const days = [...byDate].map(([date, idxs]) => {
    const hs = idxs.map((i) => hours[i]);
    const dayHours = hs.filter((h) => h.isDay);
    const base = dayHours.length >= 4 ? dayHours : hs;
    return {
      date,
      from: idxs[0],
      to: idxs[idxs.length - 1],
      tmin: Math.min(...hs.map((h) => h.temp)),
      tmax: Math.max(...hs.map((h) => h.temp)),
      precip: hs.reduce((a, h) => a + h.precip, 0),
      pop: Math.max(...hs.map((h) => h.pop)),
      wind: Math.max(...hs.map((h) => h.wind)),
      gust: Math.max(...hs.map((h) => h.gust)),
      sym: dailySymbol(hs, base),
      complete: hs.length >= 22,
    };
  });

  return {
    tz,
    lat,
    lon,
    elevation: first.elevation,
    hours,
    days,
    align,
    time,
    models: results.map((r) => ({
      key: r.model.key,
      label: r.model.label,
      short: r.model.short,
      id: r.id,
      ok: !!r.ok,
      skipped: !!r.skipped,
      coverage: !!r.coverage,
      error: r.error || null,
      ms: r.ms,
    })),
    modelsUsed: ok.length,
    modelsTotal: results.filter((r) => !r.skipped && !r.coverage).length, // alueellinen malli, joka ei kata paikkaa, ei ole puuttuva malli
  };
}

// ---------- Nykyhetki ja tilannekuva ----------

function nowPosition(fc, nowMs) {
  const ln = localNow(nowMs, fc.tz);
  const hourIso = ln.iso.slice(0, 13) + ':00';
  let idx = fc.hours.findIndex((h) => h.t === hourIso);
  let frac = ln.minute / 60;
  if (idx < 0) {
    idx = hourIso < fc.hours[0].t ? 0 : fc.hours.length - 1;
    frac = 0;
  }
  return { idx, frac, local: ln };
}

function snapshot(fc, idx, frac = 0) {
  const a = fc.hours[idx];
  const b = fc.hours[idx + 1] || a;
  const mix = (k) => (a[k] == null || b[k] == null ? a[k] : lerp(a[k], b[k], frac));
  const nearest = frac >= 0.5 ? b : a;
  return {
    t: a.t,
    temp: mix('temp'),
    feels: mix('feels'),
    wind: mix('wind'),
    gust: mix('gust'),
    hum: mix('hum'),
    press: mix('press'),
    cloud: mix('cloud'),
    spread: mix('spread'),
    precip: a.precip,
    pop: a.pop,
    dir: a.dir,
    snowShare: a.snowShare,
    thunderShare: a.thunderShare,
    sym: nearest.sym,
    isDay: nearest.isDay,
  };
}

/** Jokaisen mallin oma lämpötila nyt (interpoloitu) ja ero yhdistelmään. */
function modelRows(results, fc, idx, frac, blendTemp) {
  return results.map((r) => {
    if (!r.ok) return { model: r.model, ok: false, skipped: !!r.skipped, coverage: !!r.coverage, error: r.error };
    const arr = r.data.vars.temperature_2m;
    const at = (i) => {
      const j = fc.align[r.model.key]?.(i);
      const v = j == null ? null : arr[j];
      return v == null || !Number.isFinite(v) ? null : v;
    };
    const a = at(idx);
    const b = at(idx + 1) ?? a;
    const temp = a == null ? null : lerp(a, b, frac);
    let p24 = 0;
    const parr = r.data.vars.precipitation;
    for (let i = idx; i < Math.min(fc.hours.length, idx + 24); i++) {
      const j = fc.align[r.model.key]?.(i);
      const v = parr && j != null ? parr[j] : null;
      if (v != null && Number.isFinite(v)) p24 += v;
    }
    return { model: r.model, ok: true, temp, delta: temp == null ? null : temp - blendTemp, precip24: p24 };
  });
}

function confidence(fc, from, len = 12) {
  const hs = fc.hours.slice(from, from + len);
  const avg = hs.reduce((a, h) => a + h.spread, 0) / Math.max(1, hs.length);
  if (fc.modelsUsed < 2) return { level: 'single', avg, text: 'Vain yksi malli vastasi' };
  if (avg < 2) return { level: 'high', avg, text: 'Mallit ovat samaa mieltä' };
  if (avg < 4) return { level: 'mid', avg, text: 'Mallien välillä on pientä hajontaa' };
  return { level: 'low', avg, text: 'Mallit eroavat toisistaan' };
}

// ---------- Suomenkielinen yhteenveto (ilman tekoälyä) ----------

function wetSpans(hours, from, to) {
  const spans = [];
  let cur = null;
  for (let i = from; i <= to && i < hours.length; i++) {
    const h = hours[i];
    const wet = h.precip >= 0.2 || (h.pop >= 0.6 && h.precip >= 0.05);
    if (wet) {
      if (!cur) cur = { start: i, end: i, total: 0, snowW: 0 };
      cur.end = i;
      cur.total += h.precip;
      cur.snowW += h.precip * h.snowShare;
    } else if (cur) {
      spans.push(cur);
      cur = null;
    }
  }
  if (cur) spans.push(cur);
  const merged = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.start - last.end <= 2) {
      last.end = s.end;
      last.total += s.total;
      last.snowW += s.snowW;
    } else merged.push({ ...s });
  }
  return merged.map((s) => {
    const sh = s.total ? s.snowW / s.total : 0;
    return { ...s, startT: hours[s.start].t, endT: hours[s.end].t, kind: sh >= 0.6 ? 'snow' : sh >= 0.25 ? 'sleet' : 'rain' };
  });
}

const KIND_WORD = { rain: 'vesisadetta', snow: 'lumisadetta', sleet: 'räntäsadetta' };
const hh = (iso) => iso.slice(11, 13);
const endHour = (iso) => String((+iso.slice(11, 13) + 1) % 24).padStart(2, '0');

function whenLabel(iso, today) {
  const d = iso.slice(0, 10);
  if (d === today) return '';
  const tomorrow = new Date(today + 'T00:00:00Z');
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (d === tomorrow.toISOString().slice(0, 10)) return 'huomenna ';
  return weekday(d) + ' ';
}

function spanSentences(spans, today, max = 2) {
  return spans.slice(0, max).map((s) => {
    const total = s.total >= 0.1 ? `, yhteensä noin ${fmtMm(s.total)}` : '';
    const range = s.start === s.end ? `klo ${hh(s.startT)}` : `klo ${hh(s.startT)}–${endHour(s.endT)}`;
    return `${cap(KIND_WORD[s.kind])} ${whenLabel(s.startT, today)}${range}${total}.`;
  });
}

function windText(s) {
  const gust = s.gust - s.wind >= 4 ? `, puuskissa ${fmtNum(s.gust)} m/s` : '';
  const dir = s.dir != null ? ` ${windFrom(s.dir)}` : '';
  return `Tuuli ${fmtNum(s.wind)} m/s${dir}${gust}.`;
}

function describeNow(fc, nowMs) {
  const { idx, frac, local } = nowPosition(fc, nowMs);
  const s = snapshot(fc, idx, frac);
  const out = [];
  const feels = Math.abs(s.feels - s.temp) >= 2 ? `, tuntuu kuin ${fmtTemp(s.feels)}` : '';
  out.push(`${SYMBOLS[s.sym]}, ${fmtTemp(s.temp)}${feels}.`);
  out.push(windText(s));
  const spans = wetSpans(fc.hours, idx, Math.min(fc.hours.length - 1, idx + 24));
  if (spans.length) out.push(...spanSentences(spans, local.date));
  else out.push('Seuraavan vuorokauden aikana ei odoteta merkittävää sadetta.');
  const next = fc.hours.slice(idx, idx + 25);
  out.push(`Lämpötila vaihtelee välillä ${fmtTemp(Math.min(...next.map((h) => h.temp)))} … ${fmtTemp(Math.max(...next.map((h) => h.temp)))}.`);
  return out;
}

function describeHour(fc, idx) {
  const h = fc.hours[idx];
  const d = h.t.slice(0, 10);
  const out = [];
  out.push(`${cap(weekday(d, true))} ${fmtDM(d)} klo ${hh(h.t)}: ${SYMBOLS[h.sym].toLowerCase()}, ${fmtTemp(h.temp)}.`);
  out.push(windText(h));
  if (h.precip >= 0.1) out.push(`Sadetta noin ${fmtMm(h.precip)} tunnissa, todennäköisyys ${Math.round(h.pop * 100)} %.`);
  else out.push('Sadetta ei odoteta.');
  return out;
}

function describeDay(fc, date, nowMs) {
  const d = fc.days.find((x) => x.date === date);
  if (!d) return [];
  const today = localNow(nowMs, fc.tz).date;
  const out = [];
  const label = date === today ? 'Tänään' : `${cap(weekday(date, true))} ${fmtDM(date)}`;
  out.push(`${label}: ${SYMBOLS[d.sym].toLowerCase()}, ylin ${fmtTemp(d.tmax)}, alin ${fmtTemp(d.tmin)}.`);
  const spans = wetSpans(fc.hours, d.from, d.to);
  if (spans.length) out.push(...spanSentences(spans, date));
  else out.push('Merkittävää sadetta ei odoteta.');
  out.push(`Tuuli enimmillään ${fmtNum(d.wind)} m/s, puuskissa ${fmtNum(d.gust)} m/s.`);
  return out;
}
return { SYMBOLS, median, wMedian, wMean, combine, cloudSymbol, pickSymbol, blendForecast, nowPosition, snapshot, modelRows, confidence, wetSpans, describeNow, describeHour, describeDay };
})();

// ---- geo.js ----
__m['geo'] = (() => {
// geo.js: paikkahaku, paikannimen selvitys koordinaateista ja sijainnin pyytäminen.
// Paikannimi tulee oikeasta käänteisestä geokoodauksesta, ei tekoälyn arvauksesta.
// Ketju: BigDataCloud -> OpenStreetMap Nominatim -> lähin suomalainen kaupunki (offline) -> koordinaatit.

const { defaultFetch, fmtCoord } = __m['util'];

/** Maakuntien nimet: englanti/ruotsi -> suomi. Avaimet pienillä kirjaimilla. */
const FI_REGIONS = {
  'southwest finland': 'Varsinais-Suomi',
  'finland proper': 'Varsinais-Suomi',
  'egentliga finland': 'Varsinais-Suomi',
  uusimaa: 'Uusimaa',
  nyland: 'Uusimaa',
  'eastern uusimaa': 'Itä-Uusimaa',
  'itä-uusimaa': 'Itä-Uusimaa',
  'päijät-häme': 'Päijät-Häme',
  'päijänne tavastia': 'Päijät-Häme',
  'kanta-häme': 'Kanta-Häme',
  'tavastia proper': 'Kanta-Häme',
  pirkanmaa: 'Pirkanmaa',
  satakunta: 'Satakunta',
  ostrobothnia: 'Pohjanmaa',
  österbotten: 'Pohjanmaa',
  'central ostrobothnia': 'Keski-Pohjanmaa',
  'south ostrobothnia': 'Etelä-Pohjanmaa',
  'southern ostrobothnia': 'Etelä-Pohjanmaa',
  'north ostrobothnia': 'Pohjois-Pohjanmaa',
  'northern ostrobothnia': 'Pohjois-Pohjanmaa',
  kainuu: 'Kainuu',
  lapland: 'Lappi',
  'north karelia': 'Pohjois-Karjala',
  'northern karelia': 'Pohjois-Karjala',
  'north savo': 'Pohjois-Savo',
  'northern savonia': 'Pohjois-Savo',
  'south savo': 'Etelä-Savo',
  'southern savonia': 'Etelä-Savo',
  'central finland': 'Keski-Suomi',
  'south karelia': 'Etelä-Karjala',
  'southern karelia': 'Etelä-Karjala',
  kymenlaakso: 'Kymenlaakso',
  'kymmenedalen': 'Kymenlaakso',
  'åland islands': 'Ahvenanmaa',
  åland: 'Ahvenanmaa',
};

function localizeRegion(name) {
  if (!name) return '';
  return FI_REGIONS[name.trim().toLowerCase()] || name.trim();
}

/** Suuria suomalaisia kaupunkeja: [nimi, lat, lon, maakunta]. Käytetään vain nimen varapolkuna. */
const FI_CITIES = [
  ['Helsinki', 60.1699, 24.9384, 'Uusimaa'],
  ['Espoo', 60.2055, 24.6559, 'Uusimaa'],
  ['Vantaa', 60.2934, 25.0378, 'Uusimaa'],
  ['Tampere', 61.4978, 23.761, 'Pirkanmaa'],
  ['Turku', 60.4518, 22.2666, 'Varsinais-Suomi'],
  ['Oulu', 65.0121, 25.4651, 'Pohjois-Pohjanmaa'],
  ['Jyväskylä', 62.2426, 25.7473, 'Keski-Suomi'],
  ['Lahti', 60.9827, 25.6612, 'Päijät-Häme'],
  ['Kuopio', 62.8924, 27.677, 'Pohjois-Savo'],
  ['Pori', 61.4851, 21.7974, 'Satakunta'],
  ['Joensuu', 62.601, 29.7636, 'Pohjois-Karjala'],
  ['Lappeenranta', 61.0587, 28.1887, 'Etelä-Karjala'],
  ['Hämeenlinna', 60.9959, 24.4643, 'Kanta-Häme'],
  ['Vaasa', 63.0951, 21.6165, 'Pohjanmaa'],
  ['Seinäjoki', 62.7903, 22.8403, 'Etelä-Pohjanmaa'],
  ['Rovaniemi', 66.5039, 25.7294, 'Lappi'],
  ['Mikkeli', 61.6886, 27.2723, 'Etelä-Savo'],
  ['Kotka', 60.4664, 26.9458, 'Kymenlaakso'],
  ['Kouvola', 60.8681, 26.7042, 'Kymenlaakso'],
  ['Salo', 60.3833, 23.1333, 'Varsinais-Suomi'],
  ['Porvoo', 60.3923, 25.6651, 'Uusimaa'],
  ['Kokkola', 63.8385, 23.1307, 'Keski-Pohjanmaa'],
  ['Lohja', 60.2487, 24.0653, 'Uusimaa'],
  ['Hyvinkää', 60.6305, 24.859, 'Uusimaa'],
  ['Järvenpää', 60.4737, 25.0898, 'Uusimaa'],
  ['Rauma', 61.1272, 21.5112, 'Satakunta'],
  ['Kajaani', 64.2273, 27.7285, 'Kainuu'],
  ['Kerava', 60.4034, 25.105, 'Uusimaa'],
  ['Savonlinna', 61.8686, 28.8795, 'Etelä-Savo'],
  ['Nokia', 61.4786, 23.5091, 'Pirkanmaa'],
  ['Kemi', 65.7369, 24.5637, 'Lappi'],
  ['Tornio', 65.8481, 24.1466, 'Lappi'],
  ['Raahe', 64.6842, 24.4767, 'Pohjois-Pohjanmaa'],
  ['Naantali', 60.4678, 22.0243, 'Varsinais-Suomi'],
  ['Kaarina', 60.4071, 22.3693, 'Varsinais-Suomi'],
  ['Loimaa', 60.85, 23.05, 'Varsinais-Suomi'],
  ['Uusikaupunki', 60.8, 21.4083, 'Varsinais-Suomi'],
  ['Parainen', 60.3, 22.3, 'Varsinais-Suomi'],
  ['Maarianhamina', 60.0973, 19.9348, 'Ahvenanmaa'],
  ['Sodankylä', 67.4167, 26.5833, 'Lappi'],
  ['Ivalo', 68.6567, 27.5389, 'Lappi'],
  ['Kittilä', 67.65, 24.91, 'Lappi'],
  ['Kuusamo', 65.9667, 29.1833, 'Pohjois-Pohjanmaa'],
  ['Iisalmi', 63.5594, 27.1906, 'Pohjois-Savo'],
  ['Varkaus', 62.3167, 27.8667, 'Pohjois-Savo'],
  ['Imatra', 61.1719, 28.7769, 'Etelä-Karjala'],
  ['Heinola', 61.2058, 26.0378, 'Päijät-Häme'],
  ['Forssa', 60.8142, 23.62, 'Kanta-Häme'],
  ['Valkeakoski', 61.2667, 24.0333, 'Pirkanmaa'],
  ['Kangasala', 61.4625, 24.0714, 'Pirkanmaa'],
  ['Hamina', 60.5697, 27.1979, 'Kymenlaakso'],
  ['Lieksa', 63.3167, 30.0167, 'Pohjois-Karjala'],
  ['Ylivieska', 64.0833, 24.5333, 'Pohjois-Pohjanmaa'],
  ['Kuhmo', 64.1167, 29.5167, 'Kainuu'],
  ['Pietarsaari', 63.675, 22.7, 'Pohjanmaa'],
  ['Hanko', 59.8333, 23.2333, 'Uusimaa'],
  ['Lapua', 62.97, 23.01, 'Etelä-Pohjanmaa'],
  ['Inari', 68.906, 27.029, 'Lappi'],
  ['Utsjoki', 69.906, 27.027, 'Lappi'],
  ['Muonio', 67.956, 23.68, 'Lappi'],
];

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function nearestCity(lat, lon) {
  let best = null;
  for (const [name, la, lo, region] of FI_CITIES) {
    const km = haversineKm(lat, lon, la, lo);
    if (!best || km < best.km) best = { name, region, km };
  }
  return best;
}

async function getJson(url, { fetchFn = defaultFetch, timeoutMs = 8000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    throw new Error(e?.name === 'AbortError' ? 'aikakatkaisu' : e?.message || 'verkkovirhe');
  } finally {
    clearTimeout(timer);
  }
}

/** Paikkahaku nimellä (Open-Meteo Geocoding). */
async function searchPlaces(query, { fetchFn = defaultFetch, count = 8 } = {}) {
  const q = (query || '').trim();
  if (q.length < 2) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=${count}&language=fi&format=json`;
  const j = await getJson(url, { fetchFn });
  return (j.results || []).map((r) => ({
    name: r.name,
    region: localizeRegion(r.admin1 || r.admin2 || ''),
    country: r.country || '',
    countryCode: r.country_code || '',
    lat: r.latitude,
    lon: r.longitude,
    tz: r.timezone || null,
    pop: r.population || 0,
  }));
}

async function viaBigDataCloud(lat, lon, opts) {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}&localityLanguage=fi`;
  const j = await getJson(url, opts);
  const name = j.city || j.locality || '';
  if (!name) throw new Error('vastauksessa ei ollut paikannimeä');
  return { name, region: localizeRegion(j.principalSubdivision || ''), country: j.countryName || '', source: 'bigdatacloud' };
}

async function viaNominatim(lat, lon, opts) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&addressdetails=1&accept-language=fi&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`;
  const j = await getJson(url, opts);
  const a = j.address || {};
  const name = a.city || a.town || a.village || a.municipality || a.suburb || a.hamlet || '';
  if (!name) throw new Error('vastauksessa ei ollut paikannimeä');
  return { name, region: localizeRegion(a.county || a.state || ''), country: a.country || '', source: 'nominatim' };
}

/** Selvittää paikan nimen ja alueen koordinaateista. Ei koskaan heitä virhettä. */
async function reverseGeocode(lat, lon, { fetchFn = defaultFetch } = {}) {
  const errors = [];
  const opts = { fetchFn };
  try {
    return { ...(await viaBigDataCloud(lat, lon, opts)), errors };
  } catch (e) {
    errors.push('BigDataCloud: ' + e.message);
  }
  try {
    return { ...(await viaNominatim(lat, lon, opts)), errors };
  } catch (e) {
    errors.push('Nominatim: ' + e.message);
  }
  const c = nearestCity(lat, lon);
  if (c && c.km <= 50) {
    return { name: c.name, region: c.region, country: 'Suomi', source: 'offline', note: 'lähin kaupunki', errors };
  }
  return { name: `${fmtCoord(lat, 'N', 'S')} ${fmtCoord(lon, 'E', 'W')}`, region: '', country: '', source: 'coords', errors };
}

function placeKey(p) {
  return `${Number(p.lat).toFixed(2)},${Number(p.lon).toFixed(2)}`;
}

function placeSubtitle(p) {
  return [p.region, p.country].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(', ');
}

/** Selaimen paikannus lupausmuodossa, suomenkielisillä virheillä. */
function getPosition({ timeoutMs = 12000, maximumAge = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Selain ei tue paikannusta'));
    if (globalThis.isSecureContext === false) return reject(new Error('Paikannus vaatii suojatun (https) yhteyden'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => {
        const msg =
          err.code === 1
            ? 'Sijaintilupa on estetty. Salli sijainti selaimen sivuasetuksista ja yritä uudelleen.'
            : err.code === 2
              ? 'Sijaintia ei saatu selville. Tarkista, että puhelimen sijainti on päällä.'
              : 'Sijainnin haku aikakatkaistiin.';
        reject(Object.assign(new Error(msg), { code: err.code }));
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge },
    );
  });
}
return { FI_REGIONS, localizeRegion, FI_CITIES, haversineKm, nearestCity, searchPlaces, reverseGeocode, placeKey, placeSubtitle, getPosition };
})();

// ---- sky.js ----
__m['sky'] = (() => {
// sky.js: koodilla piirretty, animoitu taivas. Seuraa auringon korkeutta, pilvisyyttä, sadetta,
// lunta, ukkosta ja sumua. Ei ulkoisia kuvia tai kutsuja, joten se latautuu heti ja toimii offline.

const { clamp, lerp } = __m['util'];

// Auringon korkeus (astetta) -> taivaan kolme väriä [ylä, keski, horisontti]
const STOPS = [
  [-18, ['#03060f', '#060b1c', '#0a1330']],
  [-12, ['#060b1e', '#0d1735', '#17275a']],
  [-6, ['#101b45', '#2f3573', '#b55f6b']],
  [-1, ['#1f3a78', '#6a5f9e', '#f0955c']],
  [4, ['#264c8f', '#5a86c0', '#f0bd80']],
  [12, ['#235aa0', '#4a80c4', '#8fb8e0']],
  [35, ['#194f96', '#3f78bd', '#7fb0e0']],
].map(([alt, cols]) => [alt, cols.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)])]);

const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const rgba = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const greyer = (c, k) => {
  const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  return mix(c, [l * 0.92, l * 0.96, l], k);
};

function skyColors(altDeg) {
  if (altDeg <= STOPS[0][0]) return STOPS[0][1];
  for (let i = 1; i < STOPS.length; i++) {
    const [a1, c1] = STOPS[i];
    if (altDeg <= a1) {
      const [a0, c0] = STOPS[i - 1];
      const t = (altDeg - a0) / (a1 - a0);
      return c0.map((c, k) => mix(c, c1[k], t));
    }
  }
  return STOPS.at(-1)[1];
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEFAULT = { alt: 25, bearing: 180, cloud: 0.3, precip: 0, snow: 0, wind: 3, windDir: 225, thunder: 0, fog: 0, moonPhase: 0.5, moonAlt: -90, moonHA: 12 };
const KEYS = Object.keys(DEFAULT);

function createSky(canvas, { reduceMotion = false } = {}) {
  const ctx = canvas.getContext('2d');
  let w = 0;
  let h = 0;
  let dpr = 1;
  let raf = 0;
  let last = 0;
  let time = 0;
  let inited = false;
  const cur = { ...DEFAULT, rainN: 0, snowN: 0 };
  const tgt = { ...DEFAULT };

  const rand = mulberry(20261014);
  const stars = Array.from({ length: 140 }, () => ({ x: rand(), y: rand() * 0.66, r: 0.5 + rand() * 1.1, ph: rand() * 6.28 }));
  const clouds = Array.from({ length: 12 }, (_, i) => ({
    x: rand() * 1.4 - 0.2,
    y: 0.05 + rand() * 0.5,
    s: 0.75 + rand() * 0.9,
    v: 0.5 + rand() * 0.9,
    puffs: Array.from({ length: 6 }, (_, k) => ({ dx: (k - 2.5) * (30 + rand() * 14), dy: (rand() - 0.5) * 26 - Math.abs(k - 2.5) * 5, r: 46 + rand() * 36 })),
    order: i,
  }));
  const rain = Array.from({ length: 280 }, () => ({ x: rand(), y: rand(), v: 0.75 + rand() * 0.5, l: 0.6 + rand() * 0.8 }));
  const snow = Array.from({ length: 200 }, () => ({ x: rand(), y: rand(), v: 0.5 + rand() * 0.8, r: 1 + rand() * 2.2, ph: rand() * 6.28 }));
  const flash = { a: 0, next: 4, bolt: null };

  function resize() {
    dpr = Math.min(globalThis.devicePixelRatio || 1, 1.5); // pehmeä sisältö, ei tarvitse täyttä tarkkuutta
    w = Math.max(1, Math.round(canvas.clientWidth || globalThis.innerWidth || 400));
    h = Math.max(1, Math.round(canvas.clientHeight || globalThis.innerHeight || 800));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!raf) draw(0);
  }

  function set(state, { snap = false } = {}) {
    for (const k of KEYS) if (state[k] != null && Number.isFinite(state[k])) tgt[k] = state[k];
    if (!inited || snap) {
      for (const k of KEYS) cur[k] = tgt[k];
      cur.rainN = rainCount();
      cur.snowN = snowCount();
      inited = true;
    }
    if (!raf) draw(0);
  }

  const rainCount = () => (tgt.precip >= 0.05 ? clamp(35 + tgt.precip * 60, 0, 280) * (1 - tgt.snow) : 0);
  const snowCount = () => (tgt.precip >= 0.05 ? clamp(50 + tgt.precip * 90, 0, 200) * tgt.snow : 0);

  function step(dt) {
    const k = 1 - Math.exp(-dt / 0.9);
    for (const key of KEYS) cur[key] += (tgt[key] - cur[key]) * k;
    cur.rainN += (rainCount() - cur.rainN) * k;
    cur.snowN += (snowCount() - cur.snowN) * k;
    time += dt;
    if (tgt.thunder > 0.3) {
      flash.next -= dt;
      if (flash.next <= 0) {
        flash.a = 1;
        flash.next = 5 + Math.random() * 6;
        const bx = 0.15 + Math.random() * 0.7;
        flash.bolt = Array.from({ length: 8 }, (_, i) => [bx + (Math.random() - 0.5) * 0.06 * i, 0.05 + i * 0.075]);
      }
    }
    flash.a = Math.max(0, flash.a - dt * 3.5);
  }

  function drawMoon(x, y, r, phase, a) {
    const k = Math.cos(phase * 2 * Math.PI); // 1 uusi, -1 täysi
    const lit = (1 - k) / 2;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 6);
    glow.addColorStop(0, `rgba(200,215,255,${((0.08 + 0.3 * lit) * a).toFixed(3)})`);
    glow.addColorStop(1, 'rgba(200,215,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - r * 6, y - r * 6, r * 12, r * 12);
    ctx.save();
    ctx.translate(x, y);
    if (phase >= 0.5) ctx.scale(-1, 1); // vähenevä kuu: valaistu puoli vasemmalla
    ctx.fillStyle = `rgba(120,132,170,${(0.22 * a).toFixed(3)})`; // varjopuoli
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 6.2832);
    ctx.fill();
    ctx.fillStyle = `rgba(238,242,255,${a.toFixed(3)})`; // valaistu osa
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
    ctx.ellipse(0, 0, Math.max(0.01, Math.abs(k)) * r, r, 0, Math.PI / 2, -Math.PI / 2, k > 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function draw(dt) {
    const alt = cur.alt;
    const cover = clamp(cur.cloud, 0, 1);
    const night = clamp((-alt - 3) / 10, 0, 1);
    const [top0, mid0, hor0] = skyColors(alt);
    const gloom = clamp(cover * 0.55 + (cur.precip > 0.3 ? 0.18 : 0) + cur.thunder * 0.2 + cur.fog * 0.3, 0, 0.88);
    const top = greyer(top0, gloom);
    const mid = greyer(mid0, gloom);
    const hor = greyer(hor0, gloom * 0.9);

    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgba(top));
    g.addColorStop(0.45, rgba(mid));
    g.addColorStop(0.72, rgba(hor));
    g.addColorStop(1, rgba(mix(hor, [0, 0, 0], 0.18)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Tähdet
    const starVis = night * (1 - cover * 0.95) * (1 - cur.fog * 0.8);
    if (starVis > 0.02) {
      for (const s of stars) {
        const tw = 0.55 + 0.45 * Math.sin(time * 1.3 + s.ph);
        ctx.fillStyle = `rgba(235,240,255,${(starVis * tw).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(s.x * w, s.y * h, s.r, 0, 6.2832);
        ctx.fill();
      }
    }

    // Kuu: oikea vaihe ja karkea asema (nousee idästä, laskee länteen)
    if (alt < -2 && cur.moonAlt > -1) {
      const mv = clamp((-alt - 2) / 6, 0, 1) * clamp((cur.moonAlt + 1) / 8, 0, 1) * (1 - cover * 0.9) * (1 - cur.fog * 0.7);
      if (mv > 0.02) {
        const mx = lerp(w * 0.16, w * 0.84, clamp((cur.moonHA + 6) / 12, 0, 1));
        const my = lerp(h * 0.64, h * 0.1, clamp(cur.moonAlt / 50, 0, 1));
        drawMoon(mx, my, 19, cur.moonPhase, mv);
      }
    }

    // Aurinko
    if (alt > -4) {
      const vis = clamp((alt + 4) / 8, 0, 1) * (1 - cover * 0.82) * (1 - cur.fog * 0.6);
      if (vis > 0.02) {
        const horizonY = h * 0.64;
        const sx = lerp(w * 0.14, w * 0.86, clamp((cur.bearing - 85) / 190, 0, 1));
        const sy = alt >= 0 ? lerp(horizonY, h * 0.1, clamp(alt / 65, 0, 1)) : horizonY - alt * h * 0.012;
        const warm = clamp(alt / 22, 0, 1);
        const col = mix([255, 150, 80], [255, 238, 196], warm);
        const R = Math.min(w, h) * (0.55 - warm * 0.15);
        const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, R);
        glow.addColorStop(0, rgba(col, 0.7 * vis));
        glow.addColorStop(0.25, rgba(col, 0.25 * vis));
        glow.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);
        const disc = ctx.createRadialGradient(sx, sy, 0, sx, sy, 30);
        disc.addColorStop(0, rgba([255, 255, 245], vis));
        disc.addColorStop(0.7, rgba(col, vis));
        disc.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = disc;
        ctx.beginPath();
        ctx.arc(sx, sy, 30, 0, 6.2832);
        ctx.fill();
      }
    }

    // Pilvet
    if (cover > 0.04) {
      const light = clamp((alt + 8) / 22, 0, 1);
      const dayCol = mix([236, 241, 249], hor0, 0.22);
      const nightCol = [62, 71, 98];
      const stormCol = [88, 98, 114];
      const base = mix(mix(nightCol, dayCol, light), stormCol, clamp(cover * 0.45 + (cur.precip > 0.3 ? 0.3 : 0) + cur.thunder * 0.35, 0, 0.85));
      const n = Math.max(1, Math.round(cover * clouds.length));
      const alpha = clamp(0.3 + cover * 0.5, 0, 0.88);
      const drift = Math.max(2, cur.wind * 1.6);
      for (let i = 0; i < n; i++) {
        const c = clouds[i];
        const x = ((((c.x * w + time * drift * c.v) % (w * 1.5)) + w * 1.5) % (w * 1.5)) - w * 0.25;
        const y = c.y * h;
        for (const p of c.puffs) {
          const px = x + p.dx * c.s;
          const py = y + p.dy * c.s;
          const pr = p.r * c.s;
          const gr = ctx.createRadialGradient(px, py, 0, px, py, pr);
          gr.addColorStop(0, rgba(base, alpha));
          gr.addColorStop(0.55, rgba(base, alpha * 0.6));
          gr.addColorStop(1, rgba(base, 0));
          ctx.fillStyle = gr;
          ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
        }
      }
      const layer = clamp((cover - 0.6) / 0.4, 0, 1);
      if (layer > 0) {
        const lg = ctx.createLinearGradient(0, 0, 0, h * 0.8);
        lg.addColorStop(0, rgba(base, 0.62 * layer));
        lg.addColorStop(1, rgba(base, 0.18 * layer));
        ctx.fillStyle = lg;
        ctx.fillRect(0, 0, w, h);
      }
    }

    // Sumu
    if (cur.fog > 0.03) {
      for (let i = 0; i < 3; i++) {
        const y = h * (0.4 + i * 0.16);
        const off = Math.sin(time * 0.05 + i * 2) * 40;
        const fg = ctx.createLinearGradient(0, y - h * 0.18, 0, y + h * 0.18);
        const fogCol = mix([205, 212, 224], hor0, 0.2);
        fg.addColorStop(0, rgba(fogCol, 0));
        fg.addColorStop(0.5, rgba(fogCol, 0.42 * cur.fog * (night > 0.5 ? 0.6 : 1)));
        fg.addColorStop(1, rgba(fogCol, 0));
        ctx.fillStyle = fg;
        ctx.fillRect(-60 + off, y - h * 0.18, w + 120, h * 0.36);
      }
    }

    // Sade
    const nr = Math.floor(cur.rainN);
    if (nr > 0) {
      const slant = clamp(cur.wind / 14, 0, 1) * 0.55 * -Math.sin((cur.windDir * Math.PI) / 180);
      ctx.strokeStyle = night > 0.5 ? 'rgba(170,195,235,0.42)' : 'rgba(205,224,255,0.55)';
      ctx.lineWidth = 1.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < nr; i++) {
        const d = rain[i];
        const y = (((d.y * h + time * 640 * d.v) % (h + 40)) + h + 40) % (h + 40) - 20;
        const x = (((d.x * w + y * slant * 0.6) % w) + w) % w;
        ctx.moveTo(x, y);
        ctx.lineTo(x + slant * 16 * d.l, y + 16 * d.l);
      }
      ctx.stroke();
    }

    // Lumi
    const ns = Math.floor(cur.snowN);
    if (ns > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.beginPath();
      for (let i = 0; i < ns; i++) {
        const d = snow[i];
        const y = (((d.y * h + time * 48 * d.v) % (h + 20)) + h + 20) % (h + 20) - 10;
        const x = (((d.x * w + Math.sin(time * 0.9 + d.ph) * 22 + cur.wind * 4 * time * 0.2) % w) + w) % w;
        ctx.moveTo(x + d.r, y);
        ctx.arc(x, y, d.r, 0, 6.2832);
      }
      ctx.fill();
    }

    // Salama
    if (flash.a > 0.01) {
      ctx.fillStyle = `rgba(235,240,255,${(flash.a * 0.2).toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
      if (flash.bolt && flash.a > 0.5) {
        ctx.strokeStyle = `rgba(255,255,255,${flash.a.toFixed(3)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        flash.bolt.forEach(([bx, by], i) => (i ? ctx.lineTo(bx * w, by * h) : ctx.moveTo(bx * w, by * h)));
        ctx.stroke();
      }
    }
  }

  function loop(ts) {
    raf = requestAnimationFrame(loop);
    if (document.hidden) return;
    const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0.016;
    if (ts - last < 28) return;
    last = ts;
    step(dt);
    draw(dt);
  }

  function start() {
    if (reduceMotion || raf) return;
    last = 0;
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  resize();
  globalThis.addEventListener?.('resize', resize);
  return { set, resize, start, stop, draw: () => draw(0), state: () => ({ ...cur }) };
}
return { skyColors, createSky };
})();

// ---- ai.js ----
__m['ai'] = (() => {
// ai.js: Gemini-kutsut suoraan selaimesta omalla avaimella (avain pysyy vain tämän laitteen selaimessa).
// Tekoäly saa valmiin, koodilla lasketun datan ja selittää sen. Se ei laske lämpötiloja itse.

const { store, defaultFetch, weekday, localNow } = __m['util'];
const { nowPosition, SYMBOLS } = __m['blend'];

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-flash-latest';

class AiError extends Error {
  constructor(message, { kind = 'http', status = 0, details = '' } = {}) {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
    this.status = status;
    this.details = details;
  }
}

const aiSettings = {
  key: () => store.get('geminiKey', '') || '',
  setKey: (k) => store.set('geminiKey', String(k || '').trim()),
  model: () => store.get('geminiModel', '') || DEFAULT_MODEL,
  setModel: (m) => store.set('geminiModel', String(m || '').trim()),
};

function friendlyError(status, message) {
  if (status === 400 && /api key/i.test(message)) return 'Gemini-avain ei kelpaa. Tarkista avain asetuksista.';
  if (status === 401 || status === 403) return `Gemini hylkäsi avaimen (${status}). Tarkista, että avain on voimassa ja että se saa käyttää Gemini API:a.`;
  if (status === 404) return 'Gemini-mallia ei löytynyt. Avaa asetukset ja hae saatavilla olevat mallit.';
  if (status === 429) return 'Gemini-kiintiö on hetkeksi täynnä. Yritä uudelleen hetken päästä.';
  if (status >= 500) return 'Gemini on tilapäisesti poissa käytöstä. Yritä hetken päästä uudelleen.';
  return message || `Virhe ${status}`;
}

// ---------- Matalan tason kutsut ----------

async function generate({ key, model, system, contents, tools, temperature = 0.5, fetchFn = defaultFetch, signal }) {
  if (!key) throw new AiError('Gemini-avainta ei ole asetettu. Lisää se asetuksista.', { kind: 'nokey' });
  const body = { contents, generationConfig: { temperature } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (tools) body.tools = tools;
  let res;
  try {
    res = await fetchFn(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw new AiError('Keskeytetty', { kind: 'abort' });
    throw new AiError('Geminiin ei saatu yhteyttä. Tarkista verkkoyhteys.', { kind: 'network', details: e?.message });
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ei JSON */
  }
  if (!res.ok) {
    const raw = json?.error?.message || text.slice(0, 200);
    throw new AiError(friendlyError(res.status, raw), { status: res.status, details: raw });
  }
  return json;
}

function textOf(res) {
  const cand = res?.candidates?.[0];
  const text = (cand?.content?.parts || [])
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('')
    .trim();
  if (text) return text;
  const block = res?.promptFeedback?.blockReason;
  if (block) throw new AiError(`Gemini ei vastannut (${block}).`, { kind: 'blocked' });
  throw new AiError(`Gemini palautti tyhjän vastauksen${cand?.finishReason ? ` (${cand.finishReason})` : ''}.`, { kind: 'empty' });
}

async function listModels({ key, fetchFn = defaultFetch }) {
  if (!key) throw new AiError('Gemini-avainta ei ole asetettu.', { kind: 'nokey' });
  let res;
  try {
    res = await fetchFn(`${GEMINI_BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
  } catch (e) {
    throw new AiError('Geminiin ei saatu yhteyttä.', { kind: 'network', details: e?.message });
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new AiError(friendlyError(res.status, json?.error?.message || ''), { status: res.status });
  return (json?.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name).replace(/^models\//, ''));
}

/** Valitsee uusimman Flash-mallin nimilistasta (ei lite-, kuva-, ääni- tai live-versioita). */
function pickFlash(names) {
  let best = null;
  for (const n of names) {
    const m = /^gemini-(\d+(?:\.\d+)?)-flash(?:-(preview|exp)[\w.-]*)?$/.exec(n);
    if (!m) continue;
    const ver = parseFloat(m[1]);
    const preview = !!m[2];
    if (!best || ver > best.ver || (ver === best.ver && best.preview && !preview)) best = { n, ver, preview };
  }
  return best ? best.n : null;
}

/** Jos malli puuttuu (404), haetaan saatavilla oleva Flash-malli ja yritetään kerran uudelleen. */
async function withModelHeal(fn, { key, fetchFn }) {
  try {
    return await fn(aiSettings.model());
  } catch (e) {
    if (e.status !== 404) throw e;
    const names = await listModels({ key, fetchFn });
    const alt = pickFlash(names);
    if (!alt || alt === aiSettings.model()) throw e;
    aiSettings.setModel(alt);
    return fn(alt);
  }
}

// ---------- Konteksti ----------

const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

/** Tiivis, koneluettava kuvaus ennusteesta tekoälylle. */
function compactForecast(fc, nowMs, { hours = 48 } = {}) {
  const { idx, frac, local } = nowPosition(fc, nowMs);
  const rows = fc.hours.slice(idx, idx + hours).map((h) => [h.t.slice(5, 16).replace('T', ' '), r1(h.temp), r1(h.feels), r1(h.precip), Math.round(h.pop * 100), Math.round(h.cloud), r1(h.wind), r1(h.gust), SYMBOLS[h.sym]]);
  const days = fc.days.slice(0, 7).map((d) => [d.date, weekday(d.date, true), r1(d.tmin), r1(d.tmax), r1(d.precip), r1(d.wind), SYMBOLS[d.sym]]);
  const h0 = fc.hours[idx];
  const next = fc.hours[idx + 1] || h0;
  return {
    aikavyohyke: fc.tz,
    paikallinen_aika_nyt: local.iso.replace('T', ' '),
    lampotila_nyt_C: r1(h0.temp + (next.temp - h0.temp) * frac),
    mallien_lampotilahajonta_C: r1(h0.spread),
    malleja_kaytossa: fc.modelsUsed,
    tunnit_sarakkeet: ['aika', 'lampotila_C', 'tuntuu_C', 'sade_mm', 'sateen_todennakoisyys_%', 'pilvisyys_%', 'tuuli_ms', 'puuskat_ms', 'saa'],
    tunnit: rows,
    paivat_sarakkeet: ['paiva', 'viikonpaiva', 'alin_C', 'ylin_C', 'sade_mm', 'tuuli_ms', 'saa'],
    paivat: days,
  };
}

function placeLabel(place) {
  return [place.name, place.region].filter(Boolean).join(', ');
}

function systemPrompt({ place, fc, nowMs }) {
  const ln = localNow(nowMs, fc.tz);
  return [
    'Olet SääÄly, suomenkielinen sääasiantuntija sääsovelluksessa.',
    'Käytät vain annettua sääennustedataa. Data on koodilla laskettu usean säämallin (ECMWF, ICON, MET Norway ym.) painotetusta yhdistelmästä. Älä keksi lukuja, aikoja tai paikkoja, joita datassa ei ole. Jos data ei riitä vastaukseen, sano se.',
    `Paikka: ${placeLabel(place)}. Paikallinen aika nyt: ${weekday(ln.date, true)} ${ln.date} klo ${ln.iso.slice(11)} (${fc.tz}). Kaikki datan ajat ovat tämän paikan paikallista aikaa.`,
    'Kirjoita selkeää, ystävällistä suomea. Ole ytimekäs: yleensä 3–6 lausetta. Käytä lämpötiloissa etumerkkiä (+5°, −3°) ja tuulessa yksikköä m/s.',
    'Jos mallit eroavat toisistaan (hajonta suuri), mainitse epävarmuus lyhyesti.',
    'Voit käyttää **lihavointia** ja lyhyitä luettelomerkkejä. Älä käytä otsikoita.',
    'Jos käyttäjä kysyy muun paikkakunnan kuin nykyisen paikan säästä, hae data get_forecast-työkalulla.',
    '',
    'SÄÄDATA (JSON):',
    JSON.stringify(compactForecast(fc, nowMs)),
  ].join('\n');
}

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'get_forecast',
        description: 'Hakee yhdistetyn sääennusteen mille tahansa paikkakunnalle. Käytä, kun käyttäjä kysyy muun paikan kuin nykyisen paikan säästä.',
        parameters: {
          type: 'OBJECT',
          properties: { place: { type: 'STRING', description: 'Paikkakunnan nimi, esim. "Rovaniemi" tai "Tukholma"' } },
          required: ['place'],
        },
      },
    ],
  },
];

// ---------- Selitys ja chat ----------

/** Selittää sään valitulle ajankohdalle. selection: { type:'now'|'hour'|'day', label } */
async function explain({ fc, place, nowMs, selection, fetchFn = defaultFetch, signal }) {
  const key = aiSettings.key();
  const target =
    selection.type === 'now'
      ? 'tämä hetki ja seuraavat tunnit'
      : selection.type === 'hour'
        ? `tunti ${selection.label}`
        : `päivä ${selection.label}`;
  const ask = `Selitä sää ajankohdalle: ${target}. Kerro, mitä on tulossa ja mikä sen todennäköisesti aiheuttaa, jos data antaa siihen aihetta. Lopuksi yksi käytännön vinkki. Enintään 90 sanaa.`;
  const system = systemPrompt({ place, fc, nowMs });
  return withModelHeal(
    async (model) => textOf(await generate({ key, model, system, contents: [{ role: 'user', parts: [{ text: ask }] }], temperature: 0.4, fetchFn, signal })),
    { key, fetchFn },
  );
}

/**
 * Keskustelu. history: [{role:'user'|'assistant', text}], viimeinen on käyttäjän.
 * runTool(name, args) palauttaa tavallisen objektin (esim. paikan ennuste).
 */
async function chat({ fc, place, nowMs, history, runTool, fetchFn = defaultFetch, signal, maxSteps = 4 }) {
  const key = aiSettings.key();
  const system = systemPrompt({ place, fc, nowMs });
  const contents = history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] }));
  let tools = runTool ? TOOLS : undefined;

  return withModelHeal(
    async (model) => {
      const convo = [...contents];
      for (let step = 0; step < maxSteps; step++) {
        let res;
        try {
          res = await generate({ key, model, system, contents: convo, tools, temperature: 0.5, fetchFn, signal });
        } catch (e) {
          if (tools && e.status === 400 && /function|tool/i.test(e.details || e.message)) {
            tools = undefined; // malli ei tue työkaluja: jatketaan ilman
            res = await generate({ key, model, system, contents: convo, temperature: 0.5, fetchFn, signal });
          } else throw e;
        }
        const cand = res?.candidates?.[0];
        const parts = cand?.content?.parts || [];
        const calls = parts.filter((p) => p.functionCall);
        if (!calls.length) return textOf(res);
        convo.push(cand.content); // säilyttää mallin allekirjoitukset sellaisenaan
        const answers = [];
        for (const c of calls) {
          let out;
          try {
            out = await runTool(c.functionCall.name, c.functionCall.args || {});
          } catch (e) {
            out = { virhe: e?.message || 'Työkalu epäonnistui' };
          }
          answers.push({ functionResponse: { name: c.functionCall.name, response: { tulos: out } } });
        }
        convo.push({ role: 'user', parts: answers });
      }
      throw new AiError('Tekoäly jäi kutsumaan työkaluja eikä vastannut.', { kind: 'loop' });
    },
    { key, fetchFn },
  );
}
return { GEMINI_BASE, DEFAULT_MODEL, AiError, aiSettings, friendlyError, generate, textOf, listModels, pickFlash, compactForecast, placeLabel, systemPrompt, TOOLS, explain, chat };
})();

// ---- demo.js ----
__m['demo'] = (() => {
// demo.js: synteettinen säädata testeihin ja esikatseluun (?demo=1, ?demo=rain|snow|clear|thunder|fog).
// Tuottaa Open-Meteon vastausmuotoa, joten koko sovelluksen koodipolku (haku, jäsennys, yhdistely) on sama kuin oikealla datalla.

const { FI_CITIES, haversineKm } = __m['geo'];
const { sunPosition } = __m['sun'];
const { localNow, zonedToUtcMs, clamp } = __m['util'];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hashStr = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

const SCENARIOS = {
  clear: { temp: 14, cloud: 4, precip: 0, snow: 0, code: 0 },
  rain: { temp: 9, cloud: 96, precip: 1.3, snow: 0, code: 63 },
  snow: { temp: -2, cloud: 96, precip: 0.9, snow: 1, code: 73 },
  thunder: { temp: 21, cloud: 98, precip: 3.2, snow: 0, code: 95 },
  fog: { temp: 3, cloud: 100, precip: 0, snow: 0, code: 45 },
};

const HORIZON_H = { metno_nordic: 60 };

/** Rakentaa Open-Meteon muotoisen vastauksen yhdelle mallille. */
function syntheticResponse({ lat, lon, modelId, nowMs = Date.now(), days = 7, tz = 'Europe/Helsinki', scenario = 'mixed' }) {
  const startDate = localNow(nowMs, tz).date;
  const start = zonedToUtcMs(startDate + 'T00:00', tz);
  const rand = rng(hashStr(modelId));
  const bias = (rand() - 0.5) * 2.4;
  const shift = Math.round((rand() - 0.5) * 4);
  const pScale = 0.65 + rand() * 0.8;
  const sc = SCENARIOS[scenario];
  const horizon = HORIZON_H[modelId] ?? Infinity;
  const outsideNordic = modelId === 'metno_nordic' && (lat < 54 || lat > 72 || lon < 3 || lon > 35);

  const keys = ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'precipitation', 'snowfall', 'weather_code', 'cloud_cover', 'pressure_msl', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'is_day'];
  const hourly = { time: [] };
  keys.forEach((k) => (hourly[k] = []));
  const base = 6.3 - (lat - 60) * 0.5;
  const noise = rng(hashStr(modelId) ^ 99);

  for (let i = 0; i < days * 24; i++) {
    const ms = start + i * 3600000;
    const ln = localNow(ms, tz);
    hourly.time.push(ln.iso.slice(0, 13) + ':00');
    if (i >= horizon || outsideNordic) {
      keys.forEach((k) => hourly[k].push(null));
      continue;
    }
    const hour = ln.hour;
    const diurnal = 2.6 * Math.sin(((hour - 9) / 24) * 2 * Math.PI);
    const synoptic = 2.4 * Math.sin(i / 31) + 1.6 * Math.sin(i / 17 + 1);
    // Sadetapahtuma: huomenna aamusta iltapäivään, malleilla eri ajoitus ja voimakkuus
    const ev = Math.exp(-(((i - (31 + shift)) / 4.5) ** 2));
    const ev2 = 0.45 * Math.exp(-(((i - (82 + shift)) / 5) ** 2));
    let precip = sc ? sc.precip * pScale : (ev * 1.9 + ev2 * 1.2) * pScale;
    if (precip < 0.05) precip = 0;
    let cloud = sc ? sc.cloud : clamp(35 + 28 * Math.sin(i / 13 + 0.5) + 55 * (ev + ev2) + (noise() - 0.5) * 14, 0, 100);
    let temp = (sc ? sc.temp : base + synoptic) + diurnal + bias + (noise() - 0.5) * 0.5;
    if (!sc && precip > 0.3) temp -= 1;
    const snowShare = sc ? sc.snow : temp <= 0 ? 1 : temp < 1.5 ? 0.5 : 0;
    const wind = clamp(4.2 + 2.2 * Math.sin(i / 11) + (precip > 0.3 ? 2 : 0) + (noise() - 0.5) * 1.4, 0.4, 20);
    const sunAlt = sunPosition(ms, lat, lon).altitudeDeg;
    let code = 0;
    if (sc) code = sc.code;
    else if (precip >= 0.1) code = snowShare >= 0.6 ? 73 : snowShare >= 0.25 ? 67 : precip < 0.5 ? 61 : precip < 2.5 ? 63 : 65;
    else code = cloud < 15 ? 0 : cloud < 45 ? 1 : cloud < 75 ? 2 : 3;
    hourly.temperature_2m.push(+temp.toFixed(1));
    hourly.apparent_temperature.push(+(temp - 0.9 * Math.max(0, wind - 1.5)).toFixed(1));
    hourly.relative_humidity_2m.push(Math.round(clamp(62 + 0.3 * cloud + (precip > 0 ? 8 : 0), 30, 100)));
    hourly.precipitation.push(+precip.toFixed(2));
    hourly.snowfall.push(+(precip * snowShare * 0.7).toFixed(2));
    hourly.weather_code.push(code);
    hourly.cloud_cover.push(Math.round(cloud));
    hourly.pressure_msl.push(+(1010 + 7 * Math.sin(i / 40)).toFixed(1));
    hourly.wind_speed_10m.push(+wind.toFixed(1));
    hourly.wind_gusts_10m.push(+(wind * 1.7).toFixed(1));
    hourly.wind_direction_10m.push(Math.round((225 + 40 * Math.sin(i / 23) + 360) % 360));
    hourly.is_day.push(sunAlt > -0.833 ? 1 : 0);
  }
  return {
    latitude: +lat.toFixed(4),
    longitude: +lon.toFixed(4),
    generationtime_ms: 0.5,
    utc_offset_seconds: (zonedToUtcMs(startDate + 'T12:00', 'UTC') - zonedToUtcMs(startDate + 'T12:00', tz)) / 1000,
    timezone: tz,
    timezone_abbreviation: tz === 'UTC' ? 'GMT' : 'EET',
    elevation: 12,
    hourly_units: { time: 'iso8601', temperature_2m: '°C', precipitation: 'mm', wind_speed_10m: 'm/s' },
    hourly,
  };
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const EN_REGION = { 'Varsinais-Suomi': 'Southwest Finland', Pirkanmaa: 'Pirkanmaa', Uusimaa: 'Uusimaa', Lappi: 'Lapland', 'Pohjois-Pohjanmaa': 'North Ostrobothnia' };

/**
 * Korvaa fetchin: palauttaa synteettisen sään, paikkahaun ja käänteisen geokoodauksen.
 * Tuntemattomat osoitteet saavat 403-vastauksen.
 */
function makeDemoFetch({ scenario = 'mixed', nowMs, log } = {}) {
  return async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    log?.(url.href);
    if (url.hostname === 'api.open-meteo.com') {
      const id = url.searchParams.get('models');
      if (id === 'fmi_seamless') return json({ error: true, reason: `Cannot initialize MultiDomains from invalid String value ${id} for key models` }, 400);
      return json(
        syntheticResponse({
          lat: +url.searchParams.get('latitude'),
          lon: +url.searchParams.get('longitude'),
          modelId: id,
          nowMs: nowMs ?? Date.now(),
          days: +url.searchParams.get('forecast_days') || 7,
          scenario,
        }),
      );
    }
    if (url.hostname === 'geocoding-api.open-meteo.com') {
      const q = (url.searchParams.get('name') || '').toLowerCase();
      const results = FI_CITIES.filter((c) => c[0].toLowerCase().includes(q))
        .slice(0, 8)
        .map(([name, lat, lon, admin1], i) => ({ id: i, name, latitude: lat, longitude: lon, country: 'Suomi', country_code: 'FI', admin1, timezone: 'Europe/Helsinki', population: 1000 }));
      return json(results.length ? { results } : {});
    }
    if (url.hostname === 'api.bigdatacloud.net') {
      const lat = +url.searchParams.get('latitude');
      const lon = +url.searchParams.get('longitude');
      let best = null;
      for (const [name, la, lo, region] of FI_CITIES) {
        const km = haversineKm(lat, lon, la, lo);
        if (!best || km < best.km) best = { name, region, km };
      }
      return json({ city: best.name, locality: '', principalSubdivision: EN_REGION[best.region] || best.region, countryName: 'Suomi' });
    }
    return json({ error: { message: 'Demo-tilassa ei ole yhteyttä tähän palveluun' } }, 403);
  };
}
return { syntheticResponse, makeDemoFetch };
})();

// ---- icons.js ----
__m['icons'] = (() => {
// icons.js: sääsymbolit inline-SVG:nä (64x64). Ei ulkoisia kuvia, toimii offline.

const C = {
  sun: '#FFC24B',
  moon: '#E6ECFF',
  cloud: '#F4F7FC',
  cloudShade: '#C3CEE0',
  cloudDark: '#8394AD',
  storm: '#6B7A93',
  drop: '#7CC7FF',
  snow: '#FFFFFF',
  bolt: '#FFD34D',
};

function sun(cx, cy, r) {
  let rays = '';
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const x1 = cx + Math.cos(a) * (r + 4);
    const y1 = cy + Math.sin(a) * (r + 4);
    const x2 = cx + Math.cos(a) * (r + 9);
    const y2 = cy + Math.sin(a) * (r + 9);
    rays += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
  }
  return `<g stroke="${C.sun}" stroke-width="3.2" stroke-linecap="round">${rays}</g><circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.sun}"/>`;
}

function moon(cx, cy, r) {
  const x = cx + r * 0.45;
  return `<path d="M${x} ${cy - r}A${r} ${r} 0 0 0 ${x} ${cy + r}A${r * 1.25} ${r * 1.25} 0 0 1 ${x} ${cy - r}Z" transform="rotate(-18 ${cx} ${cy})" fill="${C.moon}"/>`;
}

// Pilvi piirretään 40x28-laatikkoon ja siirretään/skaalataan.
function cloud(x, y, s, fill = C.cloud) {
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="${fill}"><circle cx="11" cy="17" r="8"/><circle cx="21" cy="12" r="10.5"/><circle cx="31" cy="17.5" r="7.5"/><rect x="3" y="17" width="36" height="10" rx="5"/></g>`;
}

function drops(n, y0 = 47) {
  const xs = [22, 31, 40, 26.5, 35.5].slice(0, n);
  return xs
    .map((x, i) => {
      const y = y0 + (i > 2 ? 7 : 0);
      return `<line x1="${x}" y1="${y}" x2="${x - 3}" y2="${y + 8}" stroke="${C.drop}" stroke-width="3.4" stroke-linecap="round"/>`;
    })
    .join('');
}

function flakes(n, y0 = 50, xs) {
  const pts = (xs || [
    [23, y0],
    [32, y0 + 5],
    [41, y0],
    [27.5, y0 + 9],
    [36.5, y0 + 10],
  ]).slice(0, n);
  return pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.4" fill="${C.snow}"/>`).join('');
}

const bolt = `<polygon points="34,41 25,55 32,55 29,64 42,48 34,48 38,41" fill="${C.bolt}"/>`;

function fogLines() {
  return `<g stroke="#FFFFFF" stroke-opacity=".85" stroke-width="3.2" stroke-linecap="round"><line x1="14" y1="49" x2="46" y2="49"/><line x1="22" y1="56" x2="54" y2="56"/></g>`;
}

function glyph(sym, isDay) {
  const lum = isDay ? (x, y, r) => sun(x, y, r) : (x, y, r) => moon(x, y, r * 1.35);
  switch (sym) {
    case 'clear':
      return isDay ? sun(32, 32, 12) : moon(32, 32, 17);
    case 'mostly_clear':
      return lum(26, 26, 10) + cloud(26, 33, 0.78);
    case 'partly_cloudy':
      return lum(23, 24, 9) + cloud(11, 22, 1.25);
    case 'mostly_cloudy':
      return lum(21, 19, 7) + cloud(7, 22, 1.3, C.cloudShade) + cloud(16, 26, 1.0);
    case 'overcast':
      return cloud(17, 14, 0.95, C.cloudDark) + cloud(7, 22, 1.3, C.cloudShade);
    case 'fog':
      return cloud(10, 12, 1.2) + fogLines();
    case 'drizzle':
      return cloud(10, 14, 1.2, C.cloudShade) + drops(2);
    case 'rain_light':
      return cloud(10, 14, 1.2, C.cloudShade) + drops(2);
    case 'rain':
      return cloud(10, 14, 1.2, C.cloudShade) + drops(3);
    case 'rain_heavy':
      return cloud(10, 12, 1.2, C.cloudDark) + drops(5, 45);
    case 'sleet':
      return cloud(10, 14, 1.2, C.cloudShade) + drops(1, 47) + flakes(2, 0, [[32, 52], [41, 50]]);
    case 'snow_light':
      return cloud(10, 14, 1.2, C.cloudShade) + flakes(2);
    case 'snow':
      return cloud(10, 14, 1.2, C.cloudShade) + flakes(3);
    case 'snow_heavy':
      return cloud(10, 12, 1.2, C.cloudDark) + flakes(5, 48);
    case 'thunder':
      return cloud(10, 10, 1.2, C.storm) + bolt;
    default:
      return cloud(10, 18, 1.2);
  }
}

/** Palauttaa SVG-merkkijonon annetulle symbolille. */
function icon(sym, isDay = true, size = 48) {
  return `<svg class="wx" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true" focusable="false">${glyph(sym, isDay)}</svg>`;
}
return { icon };
})();

// ---- views.js ----
__m['views'] = (() => {
// views.js: näkymät HTML-merkkijonoina. Puhtaita funktioita: sama syöte antaa saman HTML:n.
// Kaikki dynaaminen teksti kulkee esc()-funktion kautta.

const { escapeHtml: esc, fmtTemp, fmtNum, fmtMm, windFrom, weekday, fmtDM, cap, mdToHtml, zonedToUtcMs, localNow } = __m['util'];
const { SYMBOLS, nowPosition, snapshot, modelRows, confidence, describeNow, describeDay, describeHour } = __m['blend'];
const { icon } = __m['icons'];
const { sunEvents, dayLengthMs } = __m['sun'];
const { placeSubtitle } = __m['geo'];

const SVG = {
  locate: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.4 5.7"/><path d="M20 4v7h-7"/></svg>',
  sliders: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9M18 7h2M4 17h2M11 17h9"/><circle cx="15.5" cy="7" r="2.3"/><circle cx="8.5" cy="17" r="2.3"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-3-7z"/></svg>',
  spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  caret: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>',
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></svg>',
};

const hh = (iso) => iso.slice(11, 13);
const clock = (ms) => new Date(ms).toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' });

function selLabel(sel) {
  if (sel.type === 'hour') return `${weekday(sel.iso.slice(0, 10))} ${fmtDM(sel.iso.slice(0, 10))} klo ${hh(sel.iso)}`;
  if (sel.type === 'day') return `${cap(weekday(sel.date, true))} ${fmtDM(sel.date)}`;
  return 'nyt';
}

// ---------- Otsikko ----------

function placeHtml(place) {
  if (!place || !place.name) return '<span class="place-name"><span class="pn">Haetaan sijaintia…</span></span><span class="place-sub">Hetki vain</span>';
  const sub = placeSubtitle(place);
  const note = place.note ? ` (${place.note})` : '';
  const pin = place.gps ? `<span class="pin" title="Perustuu sijaintiisi">${SVG.locate}</span>` : '';
  return `<span class="place-name">${pin}<span class="pn">${esc(place.name)}</span>${SVG.caret}</span><span class="place-sub">${esc(sub)}${esc(note)}</span>`;
}

// ---------- Sankari ----------

function sunLine(fc, localDate) {
  const dayStart = zonedToUtcMs(localDate + 'T00:00', fc.tz);
  const ev = sunEvents(dayStart, fc.lat, fc.lon);
  if (ev.polar === 'day') return 'Aurinko ei laske (yötön yö)';
  if (ev.polar === 'night') return 'Aurinko ei nouse (kaamos)';
  const fmt = (ms) => (ms == null ? '–' : localNow(ms, fc.tz).iso.slice(11));
  const len = dayLengthMs(ev);
  const prev = dayLengthMs(sunEvents(dayStart - 86400000, fc.lat, fc.lon));
  let txt = `${fmt(ev.rise)}–${fmt(ev.set)}`;
  if (len != null && len > 0 && len < 86400000) {
    const m = Math.floor(len / 60000);
    txt += `, päivä ${Math.floor(m / 60)} h ${m % 60} min`;
    if (prev != null && prev > 0 && prev < 86400000) {
      const d = Math.round((len - prev) / 1000);
      if (Math.abs(d) >= 5) txt += `, ${d > 0 ? 'pitenee' : 'lyhenee'} ${Math.floor(Math.abs(d) / 60)} min ${Math.abs(d) % 60} s`;
    }
  }
  return txt;
}

function heroHtml({ fc, nowMs, fetchedAt, loading, modelsUsed, modelsTotal }) {
  const { idx, frac, local } = nowPosition(fc, nowMs);
  const s = snapshot(fc, idx, frac);
  const day = fc.days.find((d) => d.date === local.date) || fc.days[0];
  const conf = confidence(fc, idx);
  const t = fmtTemp(s.temp);
  const gust = s.gust - s.wind >= 3 ? `<small>puuskat ${fmtNum(s.gust)} m/s</small>` : '';
  const dot = { high: 'good', mid: 'warn', low: 'bad', single: 'warn' }[conf.level];
  return `
    <div class="hero-main">
      <div class="temp" aria-label="Lämpötila nyt ${esc(t)}">${/^[+−]/.test(t) ? `<span class="t-sign" aria-hidden="true">${esc(t[0])}</span>` : ''}<span class="t-num" aria-hidden="true">${esc(t.replace(/^[+−]/, '').slice(0, -1))}</span><span class="t-deg" aria-hidden="true">°</span></div>
      <div class="hero-icon">${icon(s.sym, s.isDay, 104)}</div>
    </div>
    <div class="cond">${esc(SYMBOLS[s.sym])}</div>
    <div class="range">Tänään ylin ${esc(fmtTemp(day.tmax))}, alin ${esc(fmtTemp(day.tmin))}</div>
    <dl class="stats">
      <div><dt>Tuntuu kuin</dt><dd>${esc(fmtTemp(s.feels))}</dd></div>
      <div><dt>Tuuli</dt><dd>${fmtNum(s.wind)} m/s<small>${esc(windFrom(s.dir))}</small>${gust}</dd></div>
      <div><dt>Sade tunnissa</dt><dd>${esc(fmtMm(s.precip))}<small>${s.precip >= 0.05 || s.pop >= 0.05 ? `${Math.round(s.pop * 100)} % todennäköisyys` : 'ei sadetta'}</small></dd></div>
      <div><dt>Kosteus</dt><dd>${Math.round(s.hum ?? 0)} %</dd></div>
      <div><dt>Ilmanpaine</dt><dd>${Math.round(s.press ?? 0)} hPa</dd></div>
      <div><dt>Pilvisyys</dt><dd>${Math.round(s.cloud)} %</dd></div>
    </dl>
    <div class="sun">${SVG.sun}<span>${esc(sunLine(fc, local.date))}</span></div>
    <div class="meta" role="status" aria-live="polite">
      <span class="dot ${dot}"></span>
      <span>${esc(conf.text)} (${modelsUsed}/${modelsTotal} mallia)</span>
    </div>
    <div class="meta sub">${loading ? 'Päivitetään…' : `Päivitetty ${esc(clock(fetchedAt))}`}</div>`;
}

// ---------- Tekoälykortti ----------

function selectionLines(fc, sel, nowMs) {
  if (sel.type === 'hour') {
    const i = fc.hours.findIndex((h) => h.t === sel.iso);
    return i < 0 ? [] : describeHour(fc, i);
  }
  if (sel.type === 'day') return describeDay(fc, sel.date, nowMs);
  return describeNow(fc, nowMs);
}

function aiHtml({ fc, nowMs, sel, ai, hasKey }) {
  const lines = selectionLines(fc, sel, nowMs);
  let body;
  let tag;
  let action = '';
  if (ai.status === 'done' && ai.text) {
    body = `<div class="md">${mdToHtml(ai.text)}</div>`;
    tag = 'Tekoäly (Gemini)';
    action = `<button class="pill" data-act="ai-run" type="button">${SVG.refresh}Päivitä</button>`;
  } else {
    body = `<p>${esc(lines.join(' '))}</p>`;
    if (ai.status === 'loading') tag = 'Tekoäly kirjoittaa selitystä…';
    else if (ai.status === 'error') tag = 'Tekoälyn selitys ei onnistunut';
    else tag = 'Laskennallinen yhteenveto';
    if (!hasKey) action = `<button class="pill" data-act="open-settings" type="button">${SVG.spark}Lisää Gemini-avain</button>`;
    else if (ai.status !== 'loading') action = `<button class="pill" data-act="ai-run" type="button">${SVG.spark}${ai.status === 'error' ? 'Yritä uudelleen' : 'Selitä tekoälyllä'}</button>`;
  }
  const err = ai.status === 'error' ? `<p class="warn-text" role="alert">${esc(ai.error)}</p>` : '';
  const chip =
    sel.type === 'now'
      ? '<span class="chip-sm">nyt</span>'
      : `<button class="chip-sm active" data-act="now" type="button" aria-label="Palaa nykyhetkeen">${esc(selLabel(sel))}${SVG.close}</button>`;
  return `
    <div class="row between"><span class="label">SääÄly kertoo</span>${chip}</div>
    <div class="ai-text ${ai.status === 'loading' ? 'busy' : ''}">${body}${err}</div>
    <div class="row between ai-foot"><span class="tag">${esc(tag)}</span>${action}</div>`;
}

// ---------- Tunnit ja päivät ----------

function hourlyHtml({ fc, nowMs, sel }) {
  const { idx } = nowPosition(fc, nowMs);
  const cells = fc.hours.slice(idx, idx + 48).map((h, i) => {
    const date = h.t.slice(0, 10);
    const first = i === 0;
    const flag = first || hh(h.t) === '00' ? weekday(date) : '';
    const pressed = first ? sel.type === 'now' : sel.type === 'hour' && sel.iso === h.t;
    const act = first ? 'now' : 'hour';
    const p = h.precip >= 0.1 ? fmtMm(h.precip).replace(' mm', '') : '';
    return `<button class="hr" type="button" data-act="${act}" data-iso="${esc(h.t)}" aria-pressed="${pressed}" aria-label="${esc(`${weekday(date)} klo ${hh(h.t)}, ${SYMBOLS[h.sym]}, ${fmtTemp(h.temp)}`)}">
      <span class="hr-d">${esc(flag)}</span><span class="hr-t">${first ? 'Nyt' : hh(h.t)}</span>${icon(h.sym, h.isDay, 30)}
      <span class="hr-temp">${esc(fmtTemp(h.temp))}</span><span class="hr-p">${p ? esc(p) + ' mm' : ''}</span></button>`;
  });
  return `<div class="label">Seuraavat tunnit</div><div class="strip" id="strip">${cells.join('')}</div>`;
}

function dailyHtml({ fc, nowMs, sel }) {
  const today = nowPosition(fc, nowMs).local.date;
  const days = fc.days.slice(0, 7);
  const lo = Math.min(...days.map((d) => d.tmin));
  const hi = Math.max(...days.map((d) => d.tmax));
  const span = hi - lo || 1;
  const rows = days.map((d) => {
    const left = ((d.tmin - lo) / span) * 100;
    const width = Math.max(5, ((d.tmax - d.tmin) / span) * 100);
    const label = d.date === today ? 'Tänään' : `${weekday(d.date)} ${fmtDM(d.date)}`;
    const pressed = sel.type === 'day' && sel.date === d.date;
    return `<button class="day" type="button" data-act="day" data-date="${d.date}" aria-pressed="${pressed}" aria-label="${esc(`${label}, ${SYMBOLS[d.sym]}, ylin ${fmtTemp(d.tmax)}, alin ${fmtTemp(d.tmin)}`)}">
      <span class="day-n">${esc(label)}</span>${icon(d.sym, true, 30)}
      <span class="rng"><span class="lo">${esc(fmtTemp(d.tmin))}</span><span class="track"><span class="fill" style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%"></span></span><span class="hi">${esc(fmtTemp(d.tmax))}</span></span>
      <span class="day-p">${d.precip >= 0.1 ? esc(fmtMm(d.precip)) : '–'}</span></button>`;
  });
  return `<div class="label">${days.length} päivän ennuste</div><div class="days">${rows.join('')}</div>`;
}

// ---------- Mallivertailu ----------

function modelsHtml({ results, fc, nowMs }) {
  const { idx, frac } = nowPosition(fc, nowMs);
  const s = snapshot(fc, idx, frac);
  const rows = modelRows(results, fc, idx, frac, s.temp);
  const body = rows
    .map((r) => {
      if (!r.ok) {
        const state = r.skipped ? 'ei saatavilla' : r.coverage ? 'ei kata tätä paikkaa' : 'ei vastannut';
        return `<tr class="off"><th scope="row">${esc(r.model.short)}</th><td colspan="3">${state}${r.coverage ? '' : `<small>${esc(r.error || '')}</small>`}</td></tr>`;
      }
      const d = r.delta;
      const cls = r.temp == null ? 'off' : Math.abs(d) <= 1 ? 'ok' : Math.abs(d) <= 2.5 ? 'mid' : 'far';
      const dtxt = d == null ? '–' : (d > 0 ? '+' : d < 0 ? '−' : '') + fmtNum(Math.abs(d), 1);
      return `<tr class="${cls}"><th scope="row">${esc(r.model.short)}</th><td>${r.temp == null ? '–' : esc(fmtTemp(r.temp, { digits: 1 }))}</td><td class="delta">${esc(dtxt)}</td><td>${esc(fmtMm(r.precip24))}</td></tr>`;
    })
    .join('');
  return `
    <details class="models-d">
      <summary><span class="label">Mallivertailu</span><span class="sum">${fc.modelsUsed}/${fc.modelsTotal} mallia, hajonta nyt ${fmtNum(s.spread, 1)}°</span>${SVG.caret}</summary>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th scope="col">Malli</th><th scope="col">Lämpö nyt</th><th scope="col">Ero</th><th scope="col">Sade 24 h</th></tr></thead>
        <tbody>${body}
          <tr class="blend"><th scope="row">Yhdistelmä</th><td>${esc(fmtTemp(s.temp, { digits: 1 }))}</td><td class="delta">0,0</td><td>${esc(fmtMm(fc.hours.slice(idx, idx + 24).reduce((a, h) => a + h.precip, 0)))}</td></tr>
        </tbody></table></div>
      <p class="note">Ero kertoo, kuinka paljon malli poikkeaa yhdistelmästä. Selvästi poikkeavat mallit jätetään yhdistelmästä pois. Vertaa lukemaa Ilmatieteen laitoksen havaintoon.</p>
    </details>`;
}

// ---------- Sivupaneelit ----------

function searchSheetHtml({ recent }) {
  const rec = (recent || [])
    .map((p, i) => `<button class="row-btn" type="button" data-act="pick-recent" data-i="${i}"><b>${esc(p.name)}</b><small>${esc(placeSubtitle(p))}</small></button>`)
    .join('');
  return `
    <div class="sheet-head"><h2>Paikkakunta</h2><button class="icon-btn" type="button" data-act="close" aria-label="Sulje">${SVG.close}</button></div>
    <div class="sheet-scroll">
      <form class="search" data-form="search" role="search">${SVG.search}<input id="q" name="q" type="search" placeholder="Hae paikkakuntaa" autocomplete="off" autocapitalize="words" enterkeyhint="search" aria-label="Hae paikkakuntaa"></form>
      <button class="row-btn locate" type="button" data-act="locate">${SVG.locate}<span><b>Käytä sijaintiani</b><small>Paikannus selaimen kautta</small></span></button>
      <div id="results" class="results" aria-live="polite"></div>
      ${rec ? `<div class="label">Viimeksi katsotut</div><div class="results">${rec}</div>` : ''}
    </div>`;
}

function resultsHtml(list, status) {
  if (status) return `<p class="note">${esc(status)}</p>`;
  return list.map((p, i) => `<button class="row-btn" type="button" data-act="pick" data-i="${i}"><b>${esc(p.name)}</b><small>${esc(placeSubtitle(p))}</small></button>`).join('');
}

function settingsSheetHtml({ hasKey, model, refreshMin, models, demo }) {
  const opts = [5, 10, 15, 30].map((m) => `<option value="${m}" ${m === refreshMin ? 'selected' : ''}>${m} min</option>`).join('');
  const datalist = (models || []).map((m) => `<option value="${esc(m)}"></option>`).join('');
  return `
    <div class="sheet-head"><h2>Asetukset</h2><button class="icon-btn" type="button" data-act="close" aria-label="Sulje">${SVG.close}</button></div>
    <div class="sheet-scroll">
      ${demo ? '<p class="note demo-note">Esimerkkitila: sää, paikkahaku ja nimet ovat tekaistuja, eikä tekoäly ole käytössä.</p>' : ''}
      <section class="set">
        <h3>Tekoäly (Gemini)</h3>
        <p class="note">Avain tallentuu vain tämän laitteen selaimeen. Hae ilmainen avain osoitteesta <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>.</p>
        <label for="key">Gemini API -avain</label>
        <div class="inline"><input id="key" type="password" autocomplete="off" spellcheck="false" placeholder="${hasKey ? 'Avain tallennettu' : 'AIza…'}"><button class="btn" type="button" data-act="save-key">Tallenna</button></div>
        <label for="model">Malli</label>
        <div class="inline"><input id="model" list="modelList" value="${esc(model)}" autocomplete="off" spellcheck="false"><datalist id="modelList">${datalist}</datalist><button class="btn" type="button" data-act="list-models">Hae mallit</button></div>
        <div class="inline"><button class="btn" type="button" data-act="test-ai">Testaa yhteys</button>${hasKey ? '<button class="btn ghost" type="button" data-act="clear-key">Poista avain</button>' : ''}</div>
        <p class="note" id="aiNote" aria-live="polite"></p>
      </section>
      <section class="set">
        <h3>Päivitys</h3>
        <label for="refresh">Päivitysväli, kun sovellus on auki</label>
        <select id="refresh">${opts}</select>
      </section>
      <section class="set">
        <h3>Diagnostiikka</h3>
        <p class="note">Tarkistaa, vastaako jokainen säämalli ja palvelu. Jos jokin ei toimi, kopioi raportti ja lähetä se kehittäjälle.</p>
        <div class="inline"><button class="btn" type="button" data-act="diag">Aja diagnostiikka</button><button class="btn ghost" type="button" data-act="diag-copy">Kopioi raportti</button></div>
        <pre id="diag" class="diag" aria-live="polite"></pre>
      </section>
      <section class="set">
        <h3>Tiedot</h3>
        <div class="inline"><button class="btn ghost" type="button" data-act="wipe">Tyhjennä tallennetut tiedot</button></div>
      </section>
    </div>`;
}

function chatSheetHtml({ hasKey }) {
  const chips = ['Mitä pukisin tänään?', 'Sataako huomenna?', 'Milloin on paras hetki lenkille?', 'Millainen sää on Rovaniemellä?']
    .map((q) => `<button class="pill" type="button" data-act="ask" data-q="${esc(q)}">${esc(q)}</button>`)
    .join('');
  return `
    <div class="sheet-head"><h2>Kysy SääÄlyltä</h2><button class="icon-btn" type="button" data-act="close" aria-label="Sulje">${SVG.close}</button></div>
    <div class="sheet-scroll chat-scroll" id="msgs" aria-live="polite"></div>
    ${hasKey ? `<div class="chips">${chips}</div>` : ''}
    <form class="composer" data-form="chat">
      <textarea id="msg" rows="1" placeholder="${hasKey ? 'Kysy mitä tahansa säästä' : 'Lisää ensin Gemini-avain asetuksista'}" ${hasKey ? '' : 'disabled'} aria-label="Viesti"></textarea>
      <button class="send" type="submit" aria-label="Lähetä" ${hasKey ? '' : 'disabled'}>${SVG.send}</button>
    </form>`;
}

function messageHtml(m) {
  if (m.role === 'user') return `<div class="msg user"><p>${esc(m.text)}</p></div>`;
  if (m.error) return `<div class="msg bot err"><p>${esc(m.text)}</p></div>`;
  return `<div class="msg bot"><div class="md">${mdToHtml(m.text)}</div></div>`;
}

const typingHtml = '<div class="msg bot typing" aria-label="SääÄly kirjoittaa"><span></span><span></span><span></span></div>';

function chatEmptyHtml({ hasKey }) {
  return hasKey
    ? '<p class="note center">Kysy esimerkiksi pukeutumisesta, ulkoilusta tai muun paikkakunnan säästä. SääÄly käyttää samaa yhdistettyä dataa kuin etusivu.</p>'
    : '<p class="note center">Chat tarvitsee Gemini-avaimen. Avaa asetukset ja lisää avain.</p>';
}
return { SVG, selLabel, placeHtml, heroHtml, selectionLines, aiHtml, hourlyHtml, dailyHtml, modelsHtml, searchSheetHtml, resultsHtml, settingsSheetHtml, chatSheetHtml, messageHtml, typingHtml, chatEmptyHtml };
})();

// ---- app.js ----
__m['app'] = (() => {
// app.js: sovelluksen tila, tapahtumat, päivityssilmukka ja näkymien yhdistäminen.
// Laskenta on moduuleissa (weather, blend, geo, ai); tämä tiedosto vain kutsuu niitä ja piirtää tuloksen.

const { store, defaultFetch, debounce, localNow, zonedToUtcMs, fmtTemp, fmtNum, escapeHtml: esc } = __m['util'];
const { MODELS } = __m['models'];
const { fetchAll, summarizeErrors } = __m['weather'];
const { blendForecast, nowPosition, snapshot } = __m['blend'];
const { searchPlaces, reverseGeocode, getPosition, placeKey, haversineKm } = __m['geo'];
const { sunPosition, moonInfo } = __m['sun'];
const { createSky, skyColors } = __m['sky'];
const { aiSettings, explain, chat, listModels, pickFlash, generate, textOf, compactForecast, placeLabel } = __m['ai'];
const { makeDemoFetch } = __m['demo'];
const { selLabel, placeHtml, heroHtml, selectionLines, aiHtml, hourlyHtml, dailyHtml, modelsHtml, searchSheetHtml, resultsHtml, settingsSheetHtml, chatSheetHtml, messageHtml, typingHtml, chatEmptyHtml } = __m['views'];

const VERSION = '0.1.2';

// ---------- Ympäristö ----------

const params = new URLSearchParams(location.search);
const demoParam = params.get('demo');
const DEMO = Boolean(globalThis.SAAALY_DEMO) || demoParam !== null;
const SCENARIOS = ['clear', 'rain', 'snow', 'thunder', 'fog', 'mixed'];
const scenario = SCENARIOS.includes(demoParam) ? demoParam : SCENARIOS.includes(globalThis.SAAALY_SCENARIO) ? globalThis.SAAALY_SCENARIO : 'mixed';

// ?demo&at=2026-12-24T15:00:00%2B02:00 siirtää kellon (vain esimerkkitilassa, näkymien tarkistamiseen)
const T0 = Date.now();
const atMs = DEMO ? Date.parse(params.get('at') || '') : NaN;
const nowMs = Number.isFinite(atMs) ? () => atMs + (Date.now() - T0) : () => Date.now();
const fetchFn = DEMO ? makeDemoFetch({ scenario, nowMs: Number.isFinite(atMs) ? atMs : undefined }) : defaultFetch;

const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEFAULT_PLACE = { name: 'Helsinki', region: 'Uusimaa', country: 'Suomi', lat: 60.1699, lon: 24.9384, mode: 'default' };
const DEMO_PLACE = { name: 'Turku', region: 'Varsinais-Suomi', country: 'Suomi', lat: 60.4518, lon: 22.2666, mode: 'manual' };
const REFRESH_OPTIONS = [5, 10, 15, 30];
const CACHE_MAX_AGE = 24 * 3600 * 1000;

const $ = (sel, root = document) => root.querySelector(sel);
const el = {
  sky: $('#sky'),
  place: $('#placeBtn'),
  refresh: $('#refreshBtn'),
  banner: $('#banner'),
  app: $('#app'),
  hero: $('#hero'),
  ai: $('#ai'),
  forecast: $('#forecast'),
  hourly: $('#hourly'),
  daily: $('#daily'),
  models: $('#models'),
  fab: $('#fab'),
  sheet: $('#sheet'),
  panel: $('#sheetPanel'),
  theme: $('meta[name="theme-color"]'),
};

// ---------- Tila ----------

const savedRefresh = Number(store.get('refreshMin', 10));
const state = {
  place: null,
  results: null,
  fc: null,
  fetchedAt: 0,
  loading: false,
  manualLoad: false,
  error: '',
  sel: { type: 'now' },
  ai: { status: 'idle', text: '', error: '', fp: '' },
  refreshMin: REFRESH_OPTIONS.includes(savedRefresh) ? savedRefresh : 10,
  sheet: null,
  found: [],
  recent: (store.get('recent', []) || []).filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon)),
  chat: [],
  chatBusy: false,
  models: [],
  banner: null,
};

const hasKey = () => DEMO || Boolean(aiSettings.key());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Piirtäminen ----------

const last = {};
function patch(key, node, html) {
  if (last[key] === html) return false;
  last[key] = html;
  node.innerHTML = html;
  return true;
}

const SKELETON =
  '<div aria-busy="true"><div class="sk sk-temp"></div><div class="sk sk-line"></div><div class="sk sk-panel"></div></div><p class="hero-note" role="status">Haetaan säätä…</p>';

function problemHtml(message) {
  return `<div class="problem" role="alert"><h2>Säätä ei saatu haettua</h2><p>${esc(message)}</p>
    <div class="inline"><button class="btn" type="button" data-act="refresh">Yritä uudelleen</button><button class="btn ghost" type="button" data-act="open-diag">Diagnostiikka</button></div></div>`;
}

function renderHeader() {
  const html = placeHtml(state.place);
  if (last.header !== html) {
    last.header = html;
    el.place.innerHTML = html;
    el.place.setAttribute('aria-label', state.place?.name ? `Vaihda paikkakuntaa. Nyt: ${state.place.name}` : 'Vaihda paikkakuntaa');
  }
  el.refresh.classList.toggle('spin', state.loading && (state.manualLoad || !state.fc));
}

function renderAi() {
  if (!state.fc) {
    el.ai.hidden = true;
    patch('ai', el.ai, '');
    return;
  }
  el.ai.hidden = false;
  patch('ai', el.ai, aiHtml({ fc: state.fc, nowMs: nowMs(), sel: state.sel, ai: state.ai, hasKey: hasKey() }));
}

function renderAll() {
  renderHeader();
  if (!state.fc) {
    patch('hero', el.hero, state.error ? problemHtml(state.error) : SKELETON);
    renderAi();
    el.forecast.hidden = true;
    return;
  }
  const now = nowMs();
  const { fc, sel } = state;
  patch(
    'hero',
    el.hero,
    heroHtml({ fc, nowMs: now, fetchedAt: state.fetchedAt, loading: state.loading && state.manualLoad, modelsUsed: fc.modelsUsed, modelsTotal: fc.modelsTotal }),
  );
  renderAi();
  el.forecast.hidden = false;

  const strip = $('#strip', el.hourly);
  const left = strip ? strip.scrollLeft : 0;
  if (patch('hourly', el.hourly, hourlyHtml({ fc, nowMs: now, sel }))) {
    const next = $('#strip', el.hourly);
    if (next && left) next.scrollLeft = left;
  }
  patch('daily', el.daily, dailyHtml({ fc, nowMs: now, sel }));
  const wasOpen = $('.models-d', el.models)?.open;
  if (patch('models', el.models, modelsHtml({ results: state.results, fc, nowMs: now })) && wasOpen) $('.models-d', el.models).open = true;
}

function setBanner(b) {
  state.banner = b;
  if (!b) {
    el.banner.hidden = true;
    el.banner.textContent = '';
    return;
  }
  el.banner.dataset.kind = b.kind || 'info';
  el.banner.innerHTML = `<span>${esc(b.text)}</span>${b.action ? `<button type="button" data-act="${esc(b.action.act)}">${esc(b.action.label)}</button>` : ''}`;
  el.banner.hidden = false;
}

// ---------- Taivas ----------

let sky = null;

function initSky() {
  sky = createSky(el.sky, { reduceMotion });
  sky.start();
}

function setThemeColor(alt) {
  const c = skyColors(alt)[0].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  el.theme?.setAttribute('content', '#' + c);
}

function skyIdle() {
  const p = state.place;
  const sun = sunPosition(nowMs(), p.lat, p.lon);
  const moon = moonInfo(nowMs(), p.lat, p.lon);
  sky.set({ alt: sun.altitudeDeg, bearing: sun.bearingDeg, cloud: 0.4, precip: 0, snow: 0, wind: 3, windDir: 225, thunder: 0, fog: 0, moonPhase: moon.phase, moonAlt: moon.altitudeDeg, moonHA: moon.hourAngle }, { snap: true });
  setThemeColor(sun.altitudeDeg);
}

/** Taivaan tila valitulle ajalle: nyt, valittu tunti tai valitun päivän iltapäivä. */
function skyStateFor() {
  const { fc, sel } = state;
  const now = nowMs();
  const { idx, frac, local } = nowPosition(fc, now);
  let ms = now;
  let h = snapshot(fc, idx, frac);
  if (sel.type === 'hour') {
    const i = fc.hours.findIndex((x) => x.t === sel.iso);
    if (i >= 0) {
      h = fc.hours[i];
      ms = zonedToUtcMs(h.t, fc.tz) + 30 * 60000;
    }
  } else if (sel.type === 'day' && sel.date !== local.date) {
    const d = fc.days.find((x) => x.date === sel.date);
    if (d) {
      const at = fc.hours.findIndex((x) => x.t === `${sel.date}T14:00`);
      h = fc.hours[at >= 0 ? at : Math.floor((d.from + d.to) / 2)];
      ms = zonedToUtcMs(h.t, fc.tz) + 30 * 60000;
    }
  }
  const sun = sunPosition(ms, fc.lat, fc.lon);
  const moon = moonInfo(ms, fc.lat, fc.lon);
  return {
    moonPhase: moon.phase,
    moonAlt: moon.altitudeDeg,
    moonHA: moon.hourAngle,
    alt: sun.altitudeDeg,
    bearing: sun.bearingDeg,
    cloud: (h.cloud ?? 50) / 100,
    precip: h.precip || 0,
    snow: h.snowShare || 0,
    wind: h.wind || 0,
    windDir: h.dir ?? 225,
    thunder: h.thunderShare >= 0.34 && h.precip >= 0.05 ? 1 : 0,
    fog: h.sym === 'fog' ? 0.85 : 0,
  };
}

function updateSky(snap = false) {
  if (!state.fc) return;
  const st = skyStateFor();
  sky.set(st, { snap: snap || reduceMotion });
  setThemeColor(st.alt);
}

// ---------- Välimuisti ----------

function persistPlace() {
  if (DEMO || !state.place?.name) return;
  store.set('place', state.place);
}

function persistCache() {
  if (DEMO || !state.results) return;
  const slim = state.results.map((r) =>
    r.ok
      ? { ok: true, key: r.model.key, id: r.id, data: r.data, ms: r.ms }
      : { ok: false, key: r.model.key, id: r.id, error: r.error, skipped: !!r.skipped, coverage: !!r.coverage, status: r.status, ms: r.ms },
  );
  store.set('cache', { placeKey: placeKey(state.place), fetchedAt: state.fetchedAt, results: slim });
}

function restoreCache() {
  if (DEMO) return false;
  const c = store.get('cache');
  if (!c || !Array.isArray(c.results) || c.placeKey !== placeKey(state.place)) return false;
  if (nowMs() - c.fetchedAt > CACHE_MAX_AGE) return false;
  try {
    const results = c.results.map((r) => ({ ...r, model: MODELS.find((m) => m.key === r.key) })).filter((r) => r.model);
    state.fc = blendForecast(results);
    state.results = results;
    state.fetchedAt = c.fetchedAt;
    return true;
  } catch {
    state.fc = null;
    state.results = null;
    return false;
  }
}

function rememberRecent(p) {
  const key = placeKey(p);
  state.recent = [{ name: p.name, region: p.region, country: p.country, lat: p.lat, lon: p.lon }, ...state.recent.filter((r) => placeKey(r) !== key)].slice(0, 6);
  store.set('recent', state.recent);
}

// ---------- Datan haku ----------

let loadSeq = 0;

function validateSelection() {
  const { fc, sel } = state;
  if (!fc) return;
  const { idx, local } = nowPosition(fc, nowMs());
  if (sel.type === 'hour') {
    const i = fc.hours.findIndex((h) => h.t === sel.iso);
    if (i < idx) state.sel = { type: 'now' };
  } else if (sel.type === 'day') {
    if (!fc.days.some((d) => d.date === sel.date) || sel.date < local.date) state.sel = { type: 'now' };
  }
}

async function load({ manual = false } = {}) {
  if (!state.place) return;
  const seq = ++loadSeq;
  const place = state.place;
  state.loading = true;
  state.manualLoad = manual || !state.fc;
  renderAll();
  let results = [];
  try {
    results = await fetchAll(place.lat, place.lon, { fetchFn, noCache: manual, now: nowMs() });
  } catch {
    results = [];
  }
  if (seq !== loadSeq) return; // paikka vaihtui tai uudempi haku on käynnissä
  state.loading = false;
  let fc = null;
  try {
    fc = blendForecast(results);
  } catch {
    fc = null;
  }
  if (!fc) {
    const why = summarizeErrors(results);
    const net = results.length && results.every((r) => r.kind === 'network' || r.kind === 'timeout');
    const hint = net ? ' Tarkista verkkoyhteys. Jos verkko toimii muuten, sisällönesto voi estää osoitteen api.open-meteo.com.' : '';
    if (state.fc) {
      const ageMin = Math.round((nowMs() - state.fetchedAt) / 60000);
      setBanner({ id: 'stale', kind: 'warn', text: `Päivitys ei onnistunut, näytetään ${ageMin} min vanha ennuste.`, action: { act: 'refresh', label: 'Yritä uudelleen' } });
    } else {
      state.error = `Yksikään säämalli ei vastannut. ${why}.${hint}`;
    }
    renderAll();
    return;
  }
  state.results = results;
  state.fc = fc;
  state.fetchedAt = nowMs();
  state.error = '';
  if (state.banner?.id === 'stale') setBanner(null);
  validateSelection();
  persistCache();
  renderAll();
  updateSky();
  syncAi({ immediate: true });
}

// ---------- Paikka ----------

function setPlace(place) {
  state.place = place;
  state.fc = null;
  state.results = null;
  state.error = '';
  state.sel = { type: 'now' };
  state.ai = { status: 'idle', text: '', error: '', fp: '' };
  setBanner(null);
  persistPlace();
  skyIdle();
  renderAll();
  load();
}

function pickPlace(p) {
  if (!p) return;
  closeSheet();
  setPlace({ name: p.name, region: p.region, country: p.country, lat: p.lat, lon: p.lon, mode: 'manual' });
  rememberRecent(state.place);
}

async function geoPermission() {
  try {
    return (await navigator.permissions.query({ name: 'geolocation' })).state;
  } catch {
    return 'unknown';
  }
}

async function locate({ quiet = false } = {}) {
  if (state.sheet) closeSheet();
  if (!quiet) setBanner({ kind: 'info', text: 'Haetaan sijaintia…' });
  let pos;
  try {
    pos = DEMO ? { lat: DEMO_PLACE.lat, lon: DEMO_PLACE.lon } : await getPosition();
  } catch (e) {
    setBanner(quiet ? null : { kind: 'warn', text: e.message });
    return;
  }
  setBanner(null);
  const cur = state.place;
  if (quiet && cur?.mode === 'gps' && cur.name && haversineKm(cur.lat, cur.lon, pos.lat, pos.lon) < 3) return; // ei merkittävää liikettä
  const place = { name: '', region: '', country: '', lat: pos.lat, lon: pos.lon, gps: true, mode: 'gps' };
  setPlace(place);
  const geo = await reverseGeocode(pos.lat, pos.lon, { fetchFn });
  if (state.place !== place) return; // käyttäjä ehti valita toisen paikan
  Object.assign(place, { name: geo.name, region: geo.region, country: geo.country, note: geo.note || '' });
  persistPlace();
  renderAll();
  syncAi({ immediate: true });
}

let searchSeq = 0;
async function doSearch() {
  const q = ($('#q')?.value || '').trim();
  const out = $('#results');
  if (!out) return;
  const seq = ++searchSeq;
  if (q.length < 2) {
    state.found = [];
    out.innerHTML = '';
    return;
  }
  out.innerHTML = resultsHtml([], 'Haetaan…');
  try {
    const list = await searchPlaces(q, { fetchFn });
    if (seq !== searchSeq) return;
    state.found = list;
    out.innerHTML = resultsHtml(list, list.length ? '' : `Ei tuloksia haulle "${q}".`);
  } catch (e) {
    if (seq !== searchSeq) return;
    out.innerHTML = resultsHtml([], `Haku epäonnistui: ${e.message}`);
  }
}
const searchSoon = debounce(doSearch, 280);

// ---------- Valinta ja tekoälyn selitys ----------

const aiCache = new Map();
let aiSeq = 0;
let aiAbort = null;

function selection() {
  return { type: state.sel.type, label: selLabel(state.sel) };
}

/** Selityksen tunniste: sama paikka, valinta ja tunti + sateiden ajoitus. Näin selitystä ei pyydetä turhaan joka päivityksellä. */
function aiFingerprint() {
  const { fc, sel, place } = state;
  const { idx, local } = nowPosition(fc, nowMs());
  const wet = fc.hours
    .slice(idx, idx + 24)
    .map((h, i) => (h.precip >= 0.2 ? i : -1))
    .filter((i) => i >= 0)
    .join(',');
  const key = sel.type === 'hour' ? sel.iso : sel.type === 'day' ? sel.date : 'nyt';
  return [placeKey(place), sel.type, key, local.iso.slice(0, 13), wet, Math.round(fc.hours[idx].temp / 3), aiSettings.model()].join('|');
}

function syncAi({ immediate = false } = {}) {
  if (!state.fc || !state.place?.name) return;
  const fp = aiFingerprint();
  if (state.ai.fp === fp && state.ai.status !== 'idle') return;
  const cached = aiCache.get(fp);
  if (cached) {
    state.ai = { status: 'done', text: cached, error: '', fp };
    renderAi();
    return;
  }
  state.ai = { status: hasKey() ? 'loading' : 'idle', text: '', error: '', fp };
  renderAi();
  if (hasKey()) {
    if (immediate) runAi();
    else runAiSoon();
  }
}

async function demoExplain() {
  await sleep(450);
  const lines = selectionLines(state.fc, state.sel, nowMs());
  return `**Esimerkkiteksti, ei oikea tekoäly.** ${lines.join(' ')}\n\nTähän tulee Geminin kirjoittama selitys, kun olet lisännyt avaimen asetuksissa.`;
}

async function runAi({ force = false } = {}) {
  if (!state.fc || !state.place?.name || !hasKey()) return;
  const fp = aiFingerprint();
  if (!force && aiCache.has(fp)) {
    state.ai = { status: 'done', text: aiCache.get(fp), error: '', fp };
    renderAi();
    return;
  }
  aiAbort?.abort();
  aiAbort = new AbortController();
  const mySeq = ++aiSeq;
  state.ai = { status: 'loading', text: '', error: '', fp };
  renderAi();
  try {
    const text = DEMO
      ? await demoExplain()
      : await explain({ fc: state.fc, place: state.place, nowMs: nowMs(), selection: selection(), fetchFn, signal: aiAbort.signal });
    if (mySeq !== aiSeq) return;
    aiCache.set(fp, text);
    state.ai = { status: 'done', text, error: '', fp };
  } catch (e) {
    if (mySeq !== aiSeq || e?.kind === 'abort') return;
    state.ai = { status: 'error', text: '', error: e?.message || 'Tuntematon virhe', fp };
  }
  renderAi();
}
const runAiSoon = debounce(() => runAi(), 450);

function select(sel) {
  state.sel = sel;
  renderAll();
  updateSky();
  syncAi();
  if (sel.type !== 'now') revealAi();
}

function revealAi() {
  const r = el.ai.getBoundingClientRect();
  if (r.top < 8 || r.bottom > innerHeight - 76) el.ai.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
}

// ---------- Päivityssilmukka ----------

let tickTimer = 0;

function tick() {
  if (!state.fc || state.loading) return;
  if (nowMs() - state.fetchedAt >= state.refreshMin * 60000 - 1000) {
    load();
    return;
  }
  validateSelection();
  renderAll();
  updateSky();
  syncAi();
}

function startTimers() {
  clearInterval(tickTimer);
  tickTimer = setInterval(tick, 30000);
}

// ---------- Paneelit ----------

let lastFocus = null;
let hasEntry = false;
const TITLES = { search: 'Paikkakunta', settings: 'Asetukset', chat: 'Kysy SääÄlyltä' };

function sheetContent(kind) {
  if (kind === 'search') return searchSheetHtml({ recent: state.recent });
  if (kind === 'chat') return chatSheetHtml({ hasKey: hasKey() });
  return settingsSheetHtml({ hasKey: Boolean(aiSettings.key()), model: aiSettings.model(), refreshMin: state.refreshMin, models: state.models, demo: DEMO });
}

function openSheet(kind) {
  const already = Boolean(state.sheet);
  if (!already) lastFocus = document.activeElement;
  state.sheet = kind;
  el.panel.dataset.kind = kind;
  el.panel.setAttribute('aria-label', TITLES[kind]);
  el.panel.innerHTML = sheetContent(kind);
  if (kind === 'chat') renderChat();
  el.sheet.hidden = false;
  el.app.inert = true;
  el.fab.inert = true;
  document.body.classList.add('sheet-open');
  if (!already) {
    requestAnimationFrame(() => el.sheet.classList.add('open'));
    sky?.stop();
    try {
      history.pushState({ saaalySheet: true }, '');
      hasEntry = true;
    } catch {
      hasEntry = false;
    }
  }
  setTimeout(() => (kind === 'search' ? $('#q', el.panel) : el.panel)?.focus({ preventScroll: true }), 60);
}

function closeSheet() {
  if (!state.sheet) return;
  state.sheet = null;
  el.sheet.classList.remove('open');
  el.app.inert = false;
  el.fab.inert = false;
  document.body.classList.remove('sheet-open');
  sky?.start();
  if (hasEntry) {
    hasEntry = false;
    try {
      history.back();
    } catch {
      /* ei väliä */
    }
  }
  setTimeout(() => {
    if (!state.sheet) el.sheet.hidden = true;
  }, 220);
  if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
}

function trapTab(ev) {
  const items = [...el.panel.querySelectorAll('button:not([disabled]), input:not([disabled]), select, textarea:not([disabled]), a[href], summary')].filter((n) => n.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const lastItem = items[items.length - 1];
  if (ev.shiftKey && (document.activeElement === first || document.activeElement === el.panel)) {
    ev.preventDefault();
    lastItem.focus();
  } else if (!ev.shiftKey && document.activeElement === lastItem) {
    ev.preventDefault();
    first.focus();
  }
}

// ---------- Chat ----------

function renderChat() {
  const box = $('#msgs');
  if (!box || state.sheet !== 'chat') return;
  const html = state.chat.length ? state.chat.map(messageHtml).join('') : chatEmptyHtml({ hasKey: hasKey() });
  box.innerHTML = html + (state.chatBusy ? typingHtml : '');
  box.scrollTop = box.scrollHeight;
  const send = $('.send');
  if (send) send.disabled = !hasKey() || state.chatBusy;
}

async function runTool(name, args) {
  if (name !== 'get_forecast') throw new Error('Tuntematon työkalu');
  const q = String(args.place || '').trim();
  const found = await searchPlaces(q, { fetchFn, count: 3 });
  if (!found.length) throw new Error(`Paikkaa "${q}" ei löytynyt`);
  const p = found[0];
  const fc = blendForecast(await fetchAll(p.lat, p.lon, { fetchFn, now: nowMs() }));
  return { paikka: placeLabel(p), ...compactForecast(fc, nowMs(), { hours: 36 }) };
}

async function demoChat(history) {
  await sleep(600);
  const q = history.at(-1)?.text || '';
  return `Tämä on esikatselu, joten vastaus on esimerkki. Oikeassa sovelluksessa Gemini vastaisi kysymykseesi «${q}» käyttäen samaa yhdistettyä säädataa, jonka näet etusivulla.`;
}

async function sendChat(text) {
  text = String(text || '').trim();
  if (!text || state.chatBusy || !state.fc || !hasKey()) return;
  state.chat.push({ role: 'user', text });
  state.chatBusy = true;
  const ta = $('#msg');
  if (ta) {
    ta.value = '';
    ta.style.height = '';
  }
  renderChat();
  try {
    const history = state.chat.filter((m) => !m.error).slice(-12).map(({ role, text: t }) => ({ role, text: t }));
    const out = DEMO ? await demoChat(history) : await chat({ fc: state.fc, place: state.place, nowMs: nowMs(), history, runTool, fetchFn });
    state.chat.push({ role: 'assistant', text: out });
  } catch (e) {
    state.chat.push({ role: 'assistant', text: e?.message || 'Vastaus epäonnistui', error: true });
  }
  state.chatBusy = false;
  renderChat();
}

// ---------- Asetukset ----------

const aiNote = (text, kind = '') => {
  const n = $('#aiNote');
  if (n) {
    n.textContent = text;
    n.dataset.kind = kind;
  }
};

function saveKey() {
  const input = $('#key');
  const v = input?.value.trim();
  if (!v) return aiNote('Liitä avain kenttään ja paina Tallenna.', 'warn');
  aiSettings.setKey(v);
  const m = $('#model')?.value.trim();
  if (m) aiSettings.setModel(m);
  openSheet('settings');
  aiNote('Avain tallennettu tähän laitteeseen. Voit testata yhteyden.', 'ok');
  state.ai = { status: 'idle', text: '', error: '', fp: '' };
  syncAi();
}

function clearKey() {
  aiSettings.setKey('');
  openSheet('settings');
  aiNote('Avain poistettu.', 'ok');
  state.ai = { status: 'idle', text: '', error: '', fp: '' };
  renderAi();
}

async function testAi() {
  const key = aiSettings.key();
  if (!key) return aiNote('Lisää ensin avain.', 'warn');
  const model = $('#model')?.value.trim() || aiSettings.model();
  aiSettings.setModel(model);
  aiNote('Testataan…');
  const t0 = performance.now();
  try {
    const res = await generate({ key, model, contents: [{ role: 'user', parts: [{ text: 'Vastaa yhdellä sanalla: toimii' }] }], temperature: 0, fetchFn });
    aiNote(`Yhteys toimii. ${model} vastasi ${Math.round(performance.now() - t0)} ms (“${textOf(res).slice(0, 40)}”).`, 'ok');
  } catch (e) {
    aiNote(e.message + (e.status === 404 ? ' Paina "Hae mallit".' : ''), 'bad');
  }
}

async function findModels() {
  const key = aiSettings.key();
  if (!key) return aiNote('Lisää ensin avain.', 'warn');
  aiNote('Haetaan malleja…');
  try {
    const names = (await listModels({ key, fetchFn })).filter((n) => n.startsWith('gemini'));
    state.models = names;
    const list = $('#modelList');
    if (list) list.innerHTML = names.map((n) => `<option value="${esc(n)}"></option>`).join('');
    const best = pickFlash(names);
    const current = $('#model')?.value.trim();
    if (best && current && !names.includes(current)) {
      $('#model').value = best;
      aiNote(`Löytyi ${names.length} mallia. Mallia "${current}" ei ole, ehdotus: ${best}. Paina Testaa yhteys.`, 'warn');
    } else {
      aiNote(`Löytyi ${names.length} mallia${best ? `. Uusin Flash: ${best}` : ''}.`, 'ok');
    }
  } catch (e) {
    aiNote(e.message, 'bad');
  }
}

let diagText = '';

async function runDiagnostics() {
  const out = $('#diag');
  if (!out) return;
  const lines = [];
  const push = (s) => {
    lines.push(s);
    diagText = lines.join('\n');
    out.textContent = diagText;
    out.scrollTop = out.scrollHeight;
  };
  const t = nowMs();
  const p = state.place;
  push(`SääÄly ${VERSION}, diagnostiikka${DEMO ? ' (ESIMERKKITILA, data tekaistua)' : ''}`);
  push(`Laitteen aika: ${new Date(t).toString()}`);
  push(`Laitteen aikavyöhyke: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  push(`Verkko: ${navigator.onLine ? 'online' : 'OFFLINE'}, suojattu yhteys: ${globalThis.isSecureContext}, sijaintilupa: ${await geoPermission()}`);
  push(`Selain: ${navigator.userAgent}`);
  push(`Paikka: ${p ? `${p.name || '(nimi puuttuu)'}, ${p.region || '-'} (${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}) [${p.mode}]` : '-'}`);
  if (!p) return;
  push('');
  push('Säämallit (haetaan uudelleen ilman välimuistia):');
  const results = await fetchAll(p.lat, p.lon, { fetchFn, noCache: true, now: t });
  for (const r of results) {
    if (!r.ok) {
      const why = r.skipped ? 'ei saatavilla, ohitettu' : r.coverage ? 'ei kata tätä paikkaa (normaalia alueelliselle mallille)' : r.error;
      push(`  ${r.coverage ? '–' : '✗'} ${r.model.short} (${r.id}): ${why}`);
      continue;
    }
    // Sama interpolointi kuin yhdistelmässä, jotta mallien luvut ja yhdistelmä ovat vertailukelpoisia.
    const ln = localNow(t, r.data.tz);
    const i = r.data.time.indexOf(ln.iso.slice(0, 13) + ':00');
    const arr = r.data.vars.temperature_2m;
    const a = i >= 0 ? arr[i] : null;
    const b = i >= 0 && arr[i + 1] != null ? arr[i + 1] : a;
    const v = a == null ? null : a + (b - a) * (ln.minute / 60);
    push(`  ✓ ${r.model.short} (${r.id}) ${r.ms} ms, nyt ${v == null ? 'ei arvoa' : fmtTemp(v, { digits: 1 })}, aikasarja ${r.data.time[0].slice(5, 10)}…${r.data.time.at(-1).slice(5, 10)}`);
  }
  try {
    const fc = blendForecast(results);
    const { idx, frac, local } = nowPosition(fc, t);
    const s = snapshot(fc, idx, frac);
    push(`Aikavyöhyke ${fc.tz}, paikallinen aika nyt ${local.iso.slice(11)}`);
    push(`Yhdistelmä nyt: ${fmtTemp(s.temp, { digits: 1 })}, hajonta ${fmtNum(s.spread, 1)}°, ${fc.modelsUsed}/${fc.modelsTotal} mallia`);
    push(/suomi|finland/i.test(p.country || '') ? 'Vertaa tätä lukua Ilmatieteen laitoksen havaintoon lähimmältä asemalta.' : 'Vertaa tätä lukua paikalliseen havaintoon tai toiseen sääsovellukseen.');
  } catch (e) {
    push(`Yhdistely epäonnistui: ${e.message}`);
  }
  push('');
  try {
    const found = await searchPlaces('Turku', { fetchFn });
    push(`Paikkahaku: ✓ ${found.length} tulosta`);
  } catch (e) {
    push(`Paikkahaku: ✗ ${e.message}`);
  }
  const geo = await reverseGeocode(p.lat, p.lon, { fetchFn });
  push(`Paikannimi: ${geo.name || '-'} (${geo.source})${geo.errors?.length ? `, varalle siirryttiin: ${geo.errors.join('; ')}` : ''}`);
  const key = aiSettings.key();
  if (DEMO) push('Gemini: ei käytössä esimerkkitilassa');
  else if (!key) push('Gemini: ei avainta');
  else {
    const t0 = performance.now();
    try {
      await generate({ key, model: aiSettings.model(), contents: [{ role: 'user', parts: [{ text: 'Vastaa: ok' }] }], temperature: 0, fetchFn });
      push(`Gemini: ✓ ${aiSettings.model()} vastasi ${Math.round(performance.now() - t0)} ms`);
    } catch (e) {
      push(`Gemini: ✗ ${e.message}${e.details ? ` [${String(e.details).slice(0, 120)}]` : ''}`);
    }
  }
  push('');
  push('Valmis.');
}

async function copyDiag() {
  const text = diagText || $('#diag')?.textContent || '';
  const btn = $('[data-act="diag-copy"]');
  if (!text) {
    if (btn) btn.textContent = 'Aja ensin diagnostiikka';
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch {
      /* ei onnistunut */
    }
    ta.remove();
  }
  if (btn) {
    btn.textContent = 'Kopioitu';
    setTimeout(() => (btn.textContent = 'Kopioi raportti'), 1600);
  }
}

function wipeAll() {
  if (!confirm('Tyhjennetäänkö kaikki tallennetut tiedot tältä laitteelta (paikka, Gemini-avain, asetukset)?')) return;
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('saaaly.'))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ei väliä */
  }
  location.reload();
}

// ---------- Tapahtumat ----------

const ACTIONS = {
  close: () => closeSheet(),
  'open-search': () => openSheet('search'),
  'open-settings': () => openSheet('settings'),
  'open-chat': () => openSheet('chat'),
  'open-diag': () => {
    openSheet('settings');
    setTimeout(runDiagnostics, 80);
  },
  locate: () => locate(),
  refresh: () => load({ manual: true }),
  now: () => select({ type: 'now' }),
  hour: (t) => select({ type: 'hour', iso: t.dataset.iso }),
  day: (t) => select({ type: 'day', date: t.dataset.date }),
  'ai-run': () => runAi({ force: true }),
  pick: (t) => pickPlace(state.found[+t.dataset.i]),
  'pick-recent': (t) => pickPlace(state.recent[+t.dataset.i]),
  ask: (t) => sendChat(t.dataset.q),
  'save-key': saveKey,
  'clear-key': clearKey,
  'list-models': findModels,
  'test-ai': testAi,
  diag: runDiagnostics,
  'diag-copy': copyDiag,
  wipe: wipeAll,
};

function bindEvents() {
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest?.('[data-act]');
    const fn = t && ACTIONS[t.dataset.act];
    if (fn) fn(t, ev);
  });

  document.addEventListener('submit', (ev) => {
    const kind = ev.target.dataset?.form;
    if (!kind) return;
    ev.preventDefault();
    if (kind === 'search') doSearch();
    if (kind === 'chat') sendChat($('#msg')?.value);
  });

  document.addEventListener('input', (ev) => {
    if (ev.target.id === 'q') searchSoon();
    if (ev.target.id === 'msg') {
      ev.target.style.height = 'auto';
      ev.target.style.height = Math.min(ev.target.scrollHeight, 124) + 'px';
    }
  });

  document.addEventListener('change', (ev) => {
    if (ev.target.id === 'refresh') {
      const v = Number(ev.target.value);
      if (REFRESH_OPTIONS.includes(v)) {
        state.refreshMin = v;
        store.set('refreshMin', v);
      }
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (state.sheet && ev.key === 'Escape') closeSheet();
    else if (state.sheet && ev.key === 'Tab') trapTab(ev);
    else if (ev.target.id === 'msg' && ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing && matchMedia('(pointer: fine)').matches) {
      ev.preventDefault();
      sendChat(ev.target.value);
    }
  });

  window.addEventListener('popstate', () => {
    if (state.sheet) {
      hasEntry = false;
      closeSheet();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick();
  });
  window.addEventListener('online', () => load());
}

// ---------- Käynnistys ----------

function registerWorker() {
  if (DEMO || !('serviceWorker' in navigator)) return;
  if (!(location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

async function boot() {
  initSky();
  bindEvents();
  const saved = DEMO ? null : store.get('place');
  const usable = saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lon) ? saved : null;
  const first = !usable && !DEMO;
  state.place = DEMO ? { ...DEMO_PLACE } : usable || { ...DEFAULT_PLACE };
  skyIdle();
  if (restoreCache()) updateSky(true);
  renderAll();
  if (DEMO) setBanner({ kind: 'info', text: `Esimerkkitila: sää ja paikannimet ovat tekaistuja${scenario !== 'mixed' ? ` (${scenario})` : ''}.` });
  load();
  if (state.fc) syncAi({ immediate: true });

  // Paikannus: ensimmäisellä käynnistyksellä kysytään lupaa, myöhemmin päivitetään vain jos lupa on jo annettu.
  if (!DEMO && (first || usable?.mode === 'gps')) {
    const perm = await geoPermission();
    if (perm === 'denied') {
      if (first) setBanner({ kind: 'warn', text: 'Sijaintilupa on estetty. Valitse paikkakunta ylhäältä.' });
    } else if (first || perm === 'granted') {
      locate({ quiet: !first });
    }
  }
  if (!state.place.name && !first) {
    // Tallennetulta paikalta puuttui nimi (sovellus suljettiin kesken haun)
    reverseGeocode(state.place.lat, state.place.lon, { fetchFn }).then((geo) => {
      Object.assign(state.place, { name: geo.name, region: geo.region, country: geo.country, note: geo.note || '' });
      persistPlace();
      renderAll();
      syncAi({ immediate: true });
    });
  }
  startTimers();
  if (document.readyState === 'complete') registerWorker();
  else window.addEventListener('load', registerWorker);
}

globalThis.__saaaly = { state, VERSION, load, select };
boot();
})();
})();

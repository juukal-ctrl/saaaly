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
  // Tyypitetyt lukijat: väärän muotoinen arvo (käsin muokattu, vanhasta versiosta tai rikkoutunut) palauttaa varaarvon eikä kaada sovellusta.
  array(key) {
    const v = this.get(key, []);
    return Array.isArray(v) ? v : [];
  },
  object(key) {
    const v = this.get(key, null);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  },
  str(key, fallback = '') {
    const v = this.get(key, fallback);
    return typeof v === 'string' ? v : fallback;
  },
  num(key, fallback = 0) {
    const v = this.get(key, fallback);
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  },
  bool(key, fallback = false) {
    const v = this.get(key, fallback);
    return typeof v === 'boolean' ? v : fallback;
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
// weight: perusarvo ennakkopainolle yhdistelmässä. Nämä ovat arvioita; tarkennetaan, kun ennusteita on verrattu havaintoihin.
// lead: painot ennusteen iän mukaan neljässä pisteessä [0–24 h, 24–60 h, 60–120 h, 120–168 h]; haarukoiden keskikohtien (12, 42, 90, 144 h)
//   välillä painot interpoloidaan lineaarisesti, jotta yhdistelmään ei tule hyppäyksiä. Pohjoismainen tarkkuusmalli painaa eniten
//   lähituntien ennusteessa, ECMWF kauempana. Puuttuessa käytetään weight-arvoa koko ajan.
// optional: puuttuva malli ohitetaan hiljaa.
// maxLat: malli ei kata tätä pohjoisempia paikkoja, joten sitä ei haeta turhaan.
//
// Ilmatieteen laitoksen oma malli (fmi_seamless) ei ole Open-Meteossa, joten se on poistettu listalta.
// MET Nordic ja DMI HARMONIE ovat samaa mallisukua, joten DMI:n paino on pienempi.

const MODELS = [
  { key: 'ecmwf', ids: ['ecmwf_ifs', 'ecmwf_ifs025'], label: 'ECMWF IFS', short: 'ECMWF', weight: 1.4, lead: [1.2, 1.3, 1.5, 1.6] },
  { key: 'metno', ids: ['metno_nordic'], label: 'MET Norway (Pohjoismaat)', short: 'MET Nordic', weight: 1.3, lead: [1.6, 1.4, 1.0, 1.0] },
  { key: 'dmi', ids: ['dmi_harmonie_arome_europe'], label: 'DMI HARMONIE-AROME', short: 'DMI', weight: 0.8, lead: [0.9, 0.7, 0.7, 0.7], optional: true, maxLat: 65.5 },
  { key: 'icon', ids: ['icon_seamless'], label: 'DWD ICON', short: 'ICON', weight: 1.1, lead: [1.1, 1.1, 1.1, 1.0] },
  { key: 'arpege', ids: ['meteofrance_seamless'], label: 'Météo-France', short: 'Météo-France', weight: 0.9, lead: [0.9, 0.9, 0.9, 0.7] },
  { key: 'ukmo', ids: ['ukmo_seamless'], label: 'UK Met Office', short: 'UKMO', weight: 1.0, lead: [1.0, 1.0, 1.1, 1.1] },
  { key: 'gfs', ids: ['gfs_seamless'], label: 'NOAA GFS', short: 'GFS', weight: 0.6, lead: [0.5, 0.5, 0.6, 0.6] },
  { key: 'gem', ids: ['gem_seamless'], label: 'Kanadan GEM', short: 'GEM', weight: 0.5, lead: [0.4, 0.4, 0.5, 0.5] },
];

const LEAD_CENTERS = [12, 42, 90, 144];

/** Mallin paino ennusteen iän (tuntia) mukaan. Haarukoiden keskikohtien välillä interpoloidaan. */
function weightAt(model, leadH = 0) {
  const w = model.lead;
  if (!w) return model.weight;
  if (leadH <= LEAD_CENTERS[0]) return w[0];
  for (let b = 1; b < LEAD_CENTERS.length; b++) {
    if (leadH <= LEAD_CENTERS[b]) {
      const f = (leadH - LEAD_CENTERS[b - 1]) / (LEAD_CENTERS[b] - LEAD_CENTERS[b - 1]);
      return w[b - 1] + (w[b] - w[b - 1]) * f;
    }
  }
  return w[w.length - 1];
}
return { MODELS, weightAt };
})();

// ---- weather.js ----
__m['weather'] = (() => {
// weather.js: säädatan haku Open-Meteosta. Jokainen malli haetaan omana kutsunaan, mutta enintään
// muutama kerrallaan (rajapinta hylkää liian monta samanaikaista kutsua). fetchModel ei koskaan heitä
// virhettä, joten yksi huono malli ei kaada koko hakua.

const { MODELS } = __m['models'];
const { defaultFetch, store } = __m['util'];

const API_BASE = 'https://api.open-meteo.com/v1/forecast';

// Vain vakiomuuttujia, joita rajapinta tukee. Puuttuva muuttuja palautuu null-arvoina.
// Tuntuu kuin -lämpötila lasketaan itse (Ilmatieteen laitoksen kaava) lämpötilasta, kosteudesta, tuulesta ja säteilystä,
// joten apparent_temperature ja is_day eivät ole mukana.
const HOURLY = [
  'temperature_2m',
  'relative_humidity_2m',
  'precipitation',
  'snowfall',
  'weather_code',
  'cloud_cover',
  'pressure_msl',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'shortwave_radiation',
  'precipitation_probability',
  'uv_index',
];

// Open-Meteo merkitsee nämä suureet tunnin LOPPUUN ("preceding hour"): arvo aikaleimalla 14:00 koskee väliä 13–14.
// Sovelluksen ajatus on, että tuntirivi 14:00 tarkoittaa väliä 14–15, joten arvot siirretään yhden askeleen taaksepäin jo jäsennettäessä.
// weather_code johdetaan samasta tunnin sateesta, joten se siirretään mukana.
const BACKWARD = ['precipitation', 'snowfall', 'wind_gusts_10m', 'shortwave_radiation', 'uv_index', 'precipitation_probability', 'weather_code'];

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
    latitude: Number(lat).toFixed(2), // 2 desimaalia (≈1 km) riittää säämalleille eikä paljasta tarkkaa sijaintia
    longitude: Number(lon).toFixed(2),
    hourly: HOURLY.join(','),
    models: id,
    timezone: 'auto',
    forecast_days: String(days),
    wind_speed_unit: 'ms',
  });
  return `${API_BASE}?${q.toString()}`;
}

async function fetchJson(url, { fetchFn = defaultFetch, timeoutMs = 15000, noCache = false, signal = null } = {}) {
  const ctl = new AbortController();
  let cancelled = false; // ulkoinen peruutus (uusi haku alkoi tai aikaraja tuli vastaan)
  const onAbort = () => {
    cancelled = true;
    ctl.abort();
  };
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
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
    if (e?.name === 'AbortError') {
      if (cancelled) throw new ApiError('Peruttu', { kind: 'aborted' });
      throw new ApiError(`Aikakatkaisu (${Math.round(timeoutMs / 1000)} s)`, { kind: 'timeout' });
    }
    throw new ApiError(e?.message || 'Verkkovirhe', { kind: 'network' });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
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
  for (const v of BACKWARD) if (vars[v]) vars[v] = [...vars[v].slice(1), null];
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
  return store.object('resolved') || {};
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
  const d = store.object('dead') || {};
  return !!d[model.key] && d[model.key] > now;
}

function markDead(model, now) {
  const d = store.object('dead') || {};
  store.set('dead', { ...d, [model.key]: now + HALF_DAY });
}

const elapsed = (t0) => Math.round((globalThis.performance?.now?.() ?? Date.now()) - t0);

/** Hakee yhden mallin. Ei koskaan heitä: palauttaa { ok:false, error } virhetilanteessa. */
async function fetchModel(model, lat, lon, { fetchFn = defaultFetch, noCache = false, days = 7, now = Date.now(), timeoutMs = 15000, sleepFn = defaultSleep, retries = 2, signal = null } = {}) {
  const t0 = globalThis.performance?.now?.() ?? Date.now();
  if (model.optional && isDead(model, now)) {
    return { model, ok: false, skipped: true, id: model.ids[0], error: 'Ei saatavilla (ohitettu)', ms: 0 };
  }
  if (model.maxLat != null && lat > model.maxLat) {
    return { model, ok: false, coverage: true, id: model.ids[0], error: 'Malli ei kata tätä paikkaa', kind: 'coverage', ms: 0 };
  }
  let lastErr = null;
  for (const id of orderedIds(model)) {
    try {
      const json = await fetchWithRetry(buildUrl(lat, lon, id, { days }), { fetchFn, noCache, timeoutMs, signal }, { retries, sleepFn });
      const data = parseModelResponse(json, id);
      rememberResolved(model, id);
      return { model, ok: true, id, data, ms: elapsed(t0) };
    } catch (e) {
      lastErr = e;
      if (e.kind === 'aborted' || isNoCoverage(e) || isBusy(e) || e.status !== 400) break; // vain virheellinen mallinimi kokeilee seuraavaa tunnistetta
    }
  }
  if (isNoCoverage(lastErr)) {
    return { model, ok: false, coverage: true, id: model.ids[0], error: 'Malli ei kata tätä paikkaa', status: lastErr.status, kind: 'coverage', ms: elapsed(t0) };
  }
  if (model.optional && lastErr?.status === 400 && !isBusy(lastErr) && lastErr.kind !== 'aborted') markDead(model, now);
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

/**
 * Hakee kaikki mallit, enintään `concurrency` kerrallaan. Tulokset ovat samassa järjestyksessä kuin mallit.
 * deadlineMs: koko haun yläraja. Sen jälkeen keskeneräiset mallit merkitään aikakatkaistuiksi ja palautetaan se, mitä ehdittiin saada.
 * signal: ulkoinen peruutus (esim. paikka vaihtui kesken haun).
 */
async function fetchAll(lat, lon, { models = MODELS, fetchFn = defaultFetch, noCache = false, days = 7, now = Date.now(), timeoutMs = 10000, concurrency = 3, sleepFn, deadlineMs = 10000, signal = null } = {}) {
  const results = new Array(models.length);
  const ctl = new AbortController();
  let deadlineHit = false;
  const onExternal = () => ctl.abort();
  if (signal?.aborted) ctl.abort();
  else signal?.addEventListener('abort', onExternal, { once: true });
  const deadline = deadlineMs > 0 ? setTimeout(() => ((deadlineHit = true), ctl.abort()), deadlineMs) : null;
  let next = 0;
  const worker = async () => {
    while (next < models.length && !ctl.signal.aborted) {
      const i = next++;
      results[i] = await fetchModel(models[i], lat, lon, { fetchFn, noCache, days, now, timeoutMs, signal: ctl.signal, ...(sleepFn ? { sleepFn } : {}) });
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), models.length) }, worker));
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', onExternal);
  }
  // Mallit, jotka jäivät hakematta tai keskeytyivät, kirjataan epäonnistuneiksi (aikaraja tai peruutus).
  for (let i = 0; i < models.length; i++) {
    const r = results[i];
    if (r && !(r.kind === 'aborted' && deadlineHit)) continue;
    const m = models[i];
    if (!r && m.maxLat != null && lat > m.maxLat) {
      results[i] = { model: m, ok: false, coverage: true, id: m.ids[0], error: 'Malli ei kata tätä paikkaa', kind: 'coverage', ms: 0 };
      continue;
    }
    results[i] = deadlineHit
      ? { model: m, ok: false, id: m.ids[0], error: `Aikakatkaisu (${Math.round(deadlineMs / 1000)} s)`, kind: 'timeout', ms: deadlineMs }
      : { model: m, ok: false, id: m.ids[0], error: 'Peruttu', kind: 'aborted', ms: 0 };
  }
  return results;
}

function summarizeErrors(results) {
  const bad = results.filter((r) => !r.ok && !r.skipped && !r.coverage);
  if (!bad.length) return 'Ei virheitä';
  const first = bad[0];
  const same = bad.every((r) => r.error === first.error);
  return same ? first.error : bad.map((r) => `${r.model.short}: ${r.error}`).join('; ');
}
return { API_BASE, HOURLY, BACKWARD, ApiError, buildUrl, parseModelResponse, fetchModel, fetchAll, summarizeErrors };
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

// ---- phys.js ----
__m['phys'] = (() => {
// phys.js: sääfysiikan apufunktiot. Puhtaita funktioita, joten ne voidaan testata ja siirtää sellaisenaan Android-sovellukseen.
// Tuntuu kuin -kaava on Ilmatieteen laitoksen (smartmet-library-newbase, FmiFeelsLikeTemperature); testivektorit tests/phys.test.js.

/** Ilmatieteen laitoksen Summer Simmer -indeksi. rh prosentteina, t asteina. */
function summerSimmer(rh, t) {
  if (t <= 14.5) return t;
  const r = rh / 100;
  return (1.8 * t - 0.55 * (1 - r) * (1.8 * t - 26) - 0.55 * 0.5 * 26) / (1.8 * (1 - 0.55 * 0.5));
}

/**
 * Ilmatieteen laitoksen "tuntuu kuin". wind = 10 m tuuli m/s, rh %, temp °C, rad = lyhytaaltosäteily W/m² tai null.
 * Yhdistää tuulen viilentävän vaikutuksen, lämpimän ilman kosteuden ja auringon säteilyn.
 */
function fmiFeelsLike(wind, rh, temp, rad = null) {
  const a = 15;
  const t0 = 37;
  const chill = a + (1 - a / t0) * temp + (a / t0) * Math.pow(wind + 1, 0.16) * (temp - t0);
  const heat = summerSimmer(rh, temp);
  let feels = temp + (chill - temp) + (heat - temp);
  if (rad != null && Number.isFinite(rad)) feels += (0.7 * 0.07 * rad) / (wind + 10) - 0.25;
  return feels;
}

/** Pakkasen tuulen viilennysindeksi (kanadalainen kaava, sama kuin Ilmatieteen laitoksella). Vain T ≤ 10 °C. */
function windChill(wind, temp) {
  const kmh = wind * 3.6;
  if (kmh < 5) return temp + ((-1.59 + 0.1345 * temp) / 5) * kmh;
  const w = Math.pow(kmh, 0.16);
  return 13.12 + 0.6215 * temp - 11.37 * w + 0.3965 * temp * w;
}

/** Stullin (2011) märkälämpötila. Pätee kun RH 5–99 % ja T −20…50 °C; muuten rajataan. */
function wetBulb(T, RH) {
  const rh = Math.min(99, Math.max(5, RH));
  return T * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) + Math.atan(T + rh) - Math.atan(rh - 1.676331) + 0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) - 4.686035;
}

/** Kastepiste (Magnus) lämpötilasta ja suhteellisesta kosteudesta. */
function dewPoint(T, RH) {
  const a = 17.62;
  const b = 243.12;
  const g = Math.log(Math.max(1, RH) / 100) + (a * T) / (b + T);
  return (b * g) / (a - g);
}

/** Ilman kuivaava voima: höyrynpaineen vaje kPa:na. Isompi kuin 0,6 tarkoittaa, että pyykki kuivuu hyvin. */
function vpd(T, RH) {
  return 0.6108 * Math.exp((17.27 * T) / (T + 237.3)) * (1 - Math.min(100, Math.max(0, RH)) / 100);
}
return { summerSimmer, fmiFeelsLike, windChill, wetBulb, dewPoint, vpd };
})();

// ---- blend.js ----
__m['blend'] = (() => {
// blend.js: usean mallin yhdistäminen yhdeksi ennusteeksi. Kaikki laskenta on deterministista koodia.
// Tekoäly ei koske lukuihin, se vain selittää valmiin tuloksen.

const { clamp, lerp, localNow, zonedToUtcMs, fmtTemp, fmtNum, fmtMm, windFrom, weekday, fmtDM, cap } = __m['util'];
const { sunPosition } = __m['sun'];
const { weightAt } = __m['models'];
const { fmiFeelsLike, wetBulb } = __m['phys'];

const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);
const FRZ_CODES = new Set([56, 57, 66, 67]); // jäätävä tihku ja jäätävä vesisade: ei räntää, vaan jäätävää vettä
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

/** Painotettu kvantiili (q 0..1). */
function wQuantile(items, q) {
  if (!items.length) return null;
  const s = [...items].sort((a, b) => a.v - b.v);
  const total = s.reduce((a, x) => a + x.w, 0);
  let acc = 0;
  for (const x of s) {
    acc += x.w;
    if (acc >= q * total - 1e-9) return x.v;
  }
  return s[s.length - 1].v;
}

/**
 * Painotettu keskiarvo, josta on poistettu selvät poikkeamat. spread = pienimmän ja suurimman arvon ero KAIKISTA malleista
 * (ei vain hyväksytyistä), sd = painotettu keskihajonta kaikista malleista. Karsinta vaikuttaa vain keskiarvoon, ei epävarmuuteen.
 */
function combine(items, absFloor) {
  if (!items.length) return { value: null, n: 0, spread: 0, spreadKept: 0, sd: 0, lo: null, hi: null };
  const all = items.map((x) => x.v);
  const mAll = wMean(items);
  const sw = items.reduce((a, x) => a + x.w, 0);
  const sd = Math.sqrt(items.reduce((a, x) => a + x.w * (x.v - mAll) ** 2, 0) / (sw || 1));
  let used = items;
  if (items.length >= 3) {
    const med = wMedian(items);
    const mad = median(items.map((x) => Math.abs(x.v - med)));
    const thr = Math.max(absFloor, 2.2 * 1.4826 * mad);
    const kept = items.filter((x) => Math.abs(x.v - med) <= thr);
    if (kept.length >= 2) used = kept;
  }
  const vs = used.map((x) => x.v);
  // lo/hi: huomioitujen mallien vaihteluväli (sääkaavion epävarmuuskaista)
  return { value: wMean(used), n: used.length, spread: Math.max(...all) - Math.min(...all), spreadKept: Math.max(...vs) - Math.min(...vs), sd, lo: Math.min(...vs), hi: Math.max(...vs) };
}

/** Sateen olomuoto lumen osuutena (0..1) märkälämpötilasta, kun mallilta ei saada lumisadetta eikä säätunnusta. */
function phaseShare(T, RH) {
  const tw = wetBulb(T, RH ?? 85);
  return clamp((1.5 - tw) / 2, 0, 1);
}

/** Todennäköisyys, että aikavälillä (fc.hours-indeksit from..to) sataa vähintään thr mm: mallien painotettu osuus. pm = fc.pm. */
function windowPopPm(pm, from, to, thr = 0.3, lead0 = 0) {
  let sw = 0;
  let sx = 0;
  const need = (to - from + 1) / 2;
  for (const m of pm) {
    let n = 0;
    let sum = 0;
    for (let i = from; i <= to && i < m.p.length; i++) {
      const v = m.p[i];
      if (v == null) continue;
      n++;
      sum += v;
    }
    if (n < need) continue;
    const w = Math.max(0.05, weightAt(m.model, Math.max(0, from - lead0)));
    sw += w;
    if (sum >= thr) sx += w;
  }
  return sw ? sx / sw : null;
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

function pickSymbol({ precip, cloud, snowShare = 0, thunderShare = 0, fogShare = 0, rawPrecip = 0 }) {
  if (thunderShare >= 0.34 && Math.max(precip, rawPrecip) >= 0.05) return 'thunder';
  if (precip >= 0.1) {
    if (snowShare >= 0.6) return precip < 0.3 ? 'snow_light' : precip < 1.5 ? 'snow' : 'snow_heavy';
    if (snowShare >= 0.25) return 'sleet';
    if (precip < 0.25) return 'drizzle';
    return precip < 0.8 ? 'rain_light' : precip < 2.5 ? 'rain' : 'rain_heavy';
  }
  if (fogShare >= 0.5) return 'fog';
  return cloudSymbol(cloud);
}

function dailySymbol(all, day, pwin) {
  const precip = all.reduce((a, h) => a + h.precip, 0);
  const wetHours = all.filter((h) => h.precip >= 0.1).length;
  // Ukkonen: vähintään kaksi tuntia, joissa puolet malleista ennustaa ukkosta, tai yksi tunti, jossa 3/4 mallista
  if (all.filter((h) => h.thunderShare >= 0.5).length >= 2 || all.some((h) => h.thunderShare >= 0.75)) return 'thunder';
  if (precip >= 0.8 && wetHours >= 2 && (pwin == null || pwin >= 0.5)) {
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

const lastValidIndex = (arr) => {
  for (let q = arr.length - 1; q >= 0; q--) if (arr[q] != null && Number.isFinite(arr[q])) return q;
  return -1;
};

/**
 * Yhdistää onnistuneet mallivastaukset yhdeksi tuntiennusteeksi ja päiväyhteenvedoiksi.
 * results: fetchAll-funktion tulos. nowMs: nykyhetki, jolla mallien painot valitaan ennusteen iän mukaan
 * (ilman sitä ikä lasketaan aikajanan alusta).
 *
 * Tuntirivi i tarkoittaa väliä [t, t+1 h). Sade, puuskat, UV ja säteily on siirretty tähän merkitykseen jo weather.js:ssä.
 */
function blendForecast(results, { nowMs } = {}) {
  const ok = results.filter((r) => r.ok);
  if (!ok.length) throw new Error('Yksikään säämalli ei vastannut');
  const first = ok[0].data;
  const tz = first.tz || 'UTC';
  const lat = first.lat;
  const lon = first.lon;
  const longest = ok.reduce((a, b) => (b.data.time.length > a.data.time.length ? b : a)).data;
  const time = longest.time;
  const lead0 = nowMs != null ? Math.max(0, Math.floor((nowMs - zonedToUtcMs(time[0], tz)) / 3600000)) : 0;

  // Kohdistus: tavallisesti aikajanat ovat samat (indeksi i = indeksi i). Muuten haetaan aikaleiman mukaan.
  const align = {};
  const lastValid = {};
  for (const r of ok) {
    if (sameTimeline(r.data.time, time)) align[r.model.key] = (i) => i;
    else {
      const m = new Map();
      r.data.time.forEach((t, i) => m.set(t, i));
      align[r.model.key] = (i) => m.get(time[i]);
    }
    lastValid[r.model.key] = lastValidIndex(r.data.vars.temperature_2m);
  }

  const hours = [];
  const timeIdx = []; // hours-rivin indeksi -> aikajanan indeksi
  for (let i = 0; i < time.length; i++) {
    const t = time[i];
    const lead = Math.max(0, i - lead0);
    const get = (v) => {
      const out = [];
      ok.forEach((r, k) => {
        const arr = r.data.vars[v];
        if (!arr) return;
        const j = align[r.model.key](i);
        if (j == null) return;
        const x = arr[j];
        if (x == null || !Number.isFinite(x)) return;
        // Mallin horisontin lähellä paino laskee tasaisesti, jotta yhdistelmä ei hyppää, kun malli loppuu
        const taper = clamp((lastValid[r.model.key] - j + 1) / 6, 0, 1);
        out.push({ v: x, w: Math.max(0.05, weightAt(r.model, lead) * taper), k });
      });
      return out;
    };

    const T = combine(get('temperature_2m'), 2.5);
    if (T.value == null) continue; // mallien horisontin takana
    const HUM = combine(get('relative_humidity_2m'), 25);
    const CLOUD = combine(get('cloud_cover'), 45);
    const PRESS = combine(get('pressure_msl'), 6);
    const windItems = get('wind_speed_10m').filter((x) => x.v < 80);
    const WIND = { value: wMean(windItems), n: windItems.length, sd: combine(windItems, 3).sd };
    const gustItems = get('wind_gusts_10m').filter((x) => x.v < 120);
    const gust = gustItems.length ? Math.max(wMean(gustItems), WIND.value ?? 0) : WIND.value;
    const gustHi = gustItems.length ? Math.max(wQuantile(gustItems, 0.8), gust) : gust;
    const RAD = combine(get('shortwave_radiation'), 150);
    const dirItems = get('wind_direction_10m')
      .map((d) => ({ deg: d.v, w: d.w * (windItems.find((x) => x.k === d.k)?.v ?? 1) + 0.01 }));

    const feels = fmiFeelsLike(WIND.value ?? 0, HUM.value ?? 80, T.value, RAD.value);

    const precipItems = get('precipitation');
    const pTotalW = precipItems.reduce((a, x) => a + x.w, 0);
    const precip = precipItems.length ? wMean(precipItems) : 0;
    const wetItems = precipItems.filter((x) => x.v >= 0.1);
    const popAgree = pTotalW ? wetItems.reduce((a, x) => a + x.w, 0) / pTotalW : 0;
    const precipWet = wetItems.length ? wMean(wetItems) : 0;
    // Oikea ensemblepohjainen todennäköisyys, kun vähintään kaksi mallia antaa sen; muuten mallien yksimielisyys
    const popItems = get('precipitation_probability');
    const popEns = popItems.length >= 2 ? clamp(wMean(popItems) / 100, 0, 1) : null;
    const pop = popEns ?? popAgree;

    // Lumen osuus sateesta: ensisijaisesti lumisateesta, sitten säätunnuksesta, viimeksi märkälämpötilasta.
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
          else if (c.v >= 50 && c.v <= 82) share = 0;
        }
      }
      if (share == null) {
        const tt = tItems.find((x) => x.k === p.k);
        share = tt ? phaseShare(tt.v, HUM.value) : 0;
      }
      sw += p.w * p.v;
      ss += p.w * p.v * share;
    }
    const snowShare = sw > 0 ? ss / sw : phaseShare(T.value, HUM.value);

    const codeW = codeItems.reduce((a, x) => a + x.w, 0);
    const share = (set) => (codeW ? codeItems.filter((x) => set.has(x.v)).reduce((a, x) => a + x.w, 0) / codeW : 0);
    const thunderShare = share(THUNDER_CODES);
    const fogShare = share(FOG_CODES);
    const frzShare = share(FRZ_CODES);

    // Sadesymboli vain, kun sade on todennäköisempää kuin ei (pop >= 0,5); sateen voimakkuus on sateisten mallien keskiarvo
    const symPrecip = pop >= 0.5 ? Math.max(precipWet, precip, 0.1) : 0;
    const uvItems = get('uv_index');

    const dayItem = get('is_day')[0];
    const isDay = dayItem ? dayItem.v >= 0.5 : sunPosition(zonedToUtcMs(t, tz), lat, lon).altitudeDeg > -0.833;
    const cloud = CLOUD.value ?? 50;

    timeIdx.push(i);
    hours.push({
      t,
      temp: T.value,
      tLo: T.lo,
      tHi: T.hi,
      feels,
      hum: HUM.value,
      cloud,
      press: PRESS.value,
      wind: WIND.value ?? 0,
      gust: gust ?? 0,
      gustHi: gustHi ?? 0,
      dir: dirItems.length ? circMean(dirItems) : null,
      rad: RAD.value,
      uv: uvItems.length ? wMean(uvItems) : null,
      precip,
      precipHi: precipItems.length ? Math.max(precip, ...precipItems.map((x) => x.v)) : precip, // märimmän mallin arvo (kaavion vaalea kate)
      precipWet,
      pop,
      popAgree,
      popSrc: popEns != null ? 'ens' : 'models',
      snowShare,
      thunderShare,
      frzShare,
      sym: pickSymbol({ precip: symPrecip, cloud, snowShare, thunderShare, fogShare, rawPrecip: precip }),
      showers: pop >= 0.25 && pop < 0.5 && precip >= 0.05,
      isDay,
      spread: T.spread,
      sdT: T.sd,
      sdW: WIND.sd,
      n: T.n,
    });
  }
  if (!hours.length) throw new Error('Mallit eivät palauttaneet ennustetunteja');

  // Mallikohtainen sade samalla tuntijanalla kuin hours: sateen todennäköisyys ja ajoitus aikaväleille lasketaan näistä
  const pm = ok.map((r) => {
    const arr = r.data.vars.precipitation;
    return {
      model: r.model,
      p: timeIdx.map((i) => {
        const j = align[r.model.key](i);
        const v = arr && j != null ? arr[j] : null;
        return v == null || !Number.isFinite(v) ? null : v;
      }),
    };
  });

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
    const from = idxs[0];
    const to = idxs[idxs.length - 1];
    const pwin = windowPopPm(pm, from, to, 0.3);
    const uvs = hs.map((h) => h.uv).filter((x) => x != null);
    return {
      date,
      from,
      to,
      tmin: Math.min(...hs.map((h) => h.temp)),
      tmax: Math.max(...hs.map((h) => h.temp)),
      precip: hs.reduce((a, h) => a + h.precip, 0),
      pop: Math.max(...hs.map((h) => h.pop)),
      pwin,
      wind: Math.max(...hs.map((h) => h.wind)),
      gust: Math.max(...hs.map((h) => h.gust)),
      gustHi: Math.max(...hs.map((h) => h.gustHi)),
      uvMax: uvs.length ? Math.max(...uvs) : null,
      sym: dailySymbol(hs, base, pwin),
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
    pm,
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
    lead0,
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
    gustHi: a.gustHi,
    hum: mix('hum'),
    press: mix('press'),
    cloud: mix('cloud'),
    spread: mix('spread'),
    uv: a.uv,
    rad: a.rad,
    precip: a.precip,
    precipWet: a.precipWet,
    pop: a.pop,
    popAgree: a.popAgree,
    popSrc: a.popSrc,
    dir: a.dir,
    snowShare: a.snowShare,
    thunderShare: a.thunderShare,
    frzShare: a.frzShare,
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

// ---------- Mallikohtaiset luvut ----------
// Chatin sisäinen vastausmoottori ja tekoälyn konteksti tarvitsevat myös yksittäisten mallien omat luvut,
// ei vain yhdistelmää. Luvut luetaan samoista vastauksista, joista yhdistelmä on laskettu.

const TIME_INDEX = new WeakMap();
function timeIndex(fc) {
  let m = TIME_INDEX.get(fc);
  if (!m) {
    m = new Map(fc.time.map((t, i) => [t, i]));
    TIME_INDEX.set(fc, m);
  }
  return m;
}

/** Yhden mallin muuttuja yhdistelmän tuntiaikajanalla: taulukko, jossa on yksi arvo per fc.hours-rivi (null = ei arvoa). */
function modelSeries(result, fc, variable) {
  if (!result?.ok) return null;
  const arr = result.data.vars[variable];
  const align = fc.align[result.model.key];
  if (!arr || !align) return null;
  const ti = timeIndex(fc);
  return fc.hours.map((h) => {
    const j = align(ti.get(h.t));
    const v = j == null ? null : arr[j];
    return v == null || !Number.isFinite(v) ? null : v;
  });
}

function windowOf(series, from, to) {
  const out = { n: 0, min: null, max: null, sum: null };
  for (let i = from; i <= to && i < series.length; i++) {
    const v = series[i];
    if (v == null) continue;
    out.n++;
    out.sum = (out.sum ?? 0) + v;
    out.min = out.min == null ? v : Math.min(out.min, v);
    out.max = out.max == null ? v : Math.max(out.max, v);
  }
  return out;
}

/** Jokaisen mallin luvut aikavälillä from..to (fc.hours-indeksit, päätepisteet mukana). cover = osuus väliltä, jolle mallilla on dataa. */
function modelWindow(results, fc, from, to) {
  const len = Math.max(1, Math.min(to, fc.hours.length - 1) - from + 1);
  return results.map((r) => {
    if (!r.ok) return { model: r.model, ok: false, skipped: !!r.skipped, coverage: !!r.coverage, error: r.error || null };
    const T = windowOf(modelSeries(r, fc, 'temperature_2m') || [], from, to);
    const P = windowOf(modelSeries(r, fc, 'precipitation') || [], from, to);
    const W = windowOf(modelSeries(r, fc, 'wind_speed_10m') || [], from, to);
    const G = windowOf(modelSeries(r, fc, 'wind_gusts_10m') || [], from, to);
    return {
      model: r.model,
      ok: true,
      cover: T.n / len,
      tmin: T.min,
      tmax: T.max,
      precip: P.n ? P.sum : null,
      wind: W.max,
      gust: G.max,
    };
  });
}

/** Mallikohtainen päiväyhteenveto: [{ key, short, days: [[päivä, alin, ylin, sade mm, tuuli max] | null, ...] }]. */
function modelDaily(results, fc, { days = 4 } = {}) {
  const ds = fc.days.slice(0, days);
  const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
  return results
    .filter((r) => r.ok)
    .map((r) => {
      const T = modelSeries(r, fc, 'temperature_2m') || [];
      const P = modelSeries(r, fc, 'precipitation') || [];
      const W = modelSeries(r, fc, 'wind_speed_10m') || [];
      return {
        key: r.model.key,
        short: r.model.short,
        days: ds.map((d) => {
          const t = windowOf(T, d.from, d.to);
          if (!t.n || t.n < (d.to - d.from + 1) / 2) return null; // malli ei ulotu tähän päivään (esim. MET Nordic ~60 h)
          return [d.date, r1(t.min), r1(t.max), r1(windowOf(P, d.from, d.to).sum), r1(windowOf(W, d.from, d.to).max)];
        }),
      };
    });
}

/**
 * Ennusteen luotettavuus aikavälille from..from+len (fc.hours-indeksit). leadH = välin alun ikä tunteina.
 * Arvioidaan lämpötilan, sateen ja tuulen mallihajonnasta; huonoin määrää tason. Ei väitä ennusteen osuvan, vain kertoo
 * mistä mallit ovat eri mieltä. Rajat ovat arvioita ja tarkentuvat, kun ennusteita verrataan havaintoihin.
 */
function confidence(fc, from, len = 12, leadH = 0) {
  const hs = fc.hours.slice(from, from + len);
  if (fc.modelsUsed < 2) return { level: 'single', avg: 0, text: 'Vain yksi malli vastasi', why: 'single' };
  const avg = (f) => hs.reduce((a, h) => a + (f(h) ?? 0), 0) / Math.max(1, hs.length);
  const d = (leadH + len / 2) / 24;
  const sdT = avg((h) => h.sdT);
  const sdW = avg((h) => h.sdW);
  const rainU = Math.max(0, ...hs.map((h) => (h.popAgree > 0.05 ? 4 * h.popAgree * (1 - h.popAgree) : 0)));
  const lv = {
    temp: sdT <= 1 + 0.3 * d ? 0 : sdT > 2 + 0.6 * d ? 2 : 1,
    rain: rainU <= 0.5 ? 0 : rainU >= 0.9 ? 2 : 1,
    wind: sdW <= 1.5 ? 0 : sdW >= 3 ? 2 : 1,
  };
  const worst = Math.max(lv.temp, lv.rain, lv.wind);
  const why = worst === 0 ? 'ok' : (['rain', 'temp', 'wind'].find((k) => lv[k] === worst) ?? 'temp');
  const level = ['high', 'mid', 'low'][worst];
  const TXT = {
    ok: 'Mallit ovat melko yksimielisiä',
    rain: 'Sateen ajoituksesta mallit ovat eri mieltä',
    temp: worst === 2 ? 'Lämpötilassa mallit eroavat selvästi' : 'Lämpötilassa mallit eroavat hieman',
    wind: 'Tuulesta mallit ovat eri mieltä',
  };
  return { level, avg: sdT, text: TXT[why], why };
}

// ---------- Suomenkielinen yhteenveto (ilman tekoälyä) ----------

/** Pyöristää todennäköisyyden kymmeniin prosentteihin (10–90): tarkempaa lukua ennuste ei kestä. */
const popPct = (p) => clamp(Math.round(p * 10) * 10, 10, 90);

/** Sateen todennäköisyys sanoin: oikea ensembletodennäköisyys tai mallien yksimielisyys, ei koskaan "100 %". */
function popText(h) {
  if (h.popSrc === 'ens') return `sateen todennäköisyys noin ${popPct(h.pop)} %`;
  return `${Math.round(h.popAgree * 100)} % malleista ennustaa sadetta`;
}

/**
 * Sadejaksot välillä from..to (fc.hours-indeksit). Tunti on märkä, kun vähintään neljäsosa mallien painosta ennustaa vähintään
 * 0,2 mm/h tai ensembletodennäköisyys on yli 60 %. Jakso säilyy vain, jos sen aikana vähintään minPwin mallien painosta
 * ennustaa yhteensä 0,3 mm: yksittäinen eri mieltä oleva malli ei tee sateesta ennustetta.
 * Palauttaa jaksoja, joissa pwin = sateen todennäköisyys jakson aikana ja timingUncertain = mallit ovat eri mieltä alkamisajasta.
 */
/** Sadejaksot, jotka ALKAVAT horisontin sisällä; loppu saa ylittää sen, jotta eri tekstit kertovat saman päättymisajan. */
function rainSpansFrom(fc, fromIdx, horizonH) {
  const last = fc.hours.length - 1;
  return wetSpans(fc, fromIdx, Math.min(last, fromIdx + horizonH + 12)).filter((sp) => sp.start <= fromIdx + horizonH);
}

function wetSpans(fc, from, to, { minPwin = 0.3 } = {}) {
  const { hours, pm } = fc;
  to = Math.min(to, hours.length - 1);
  const lead0 = fc.lead0 || 0;
  const leadOf = (i) => Math.max(0, i - lead0);
  // Painotettu osuus malleista, joiden oma sade tunnilla i on vähintään 0,2 mm
  const shareCache = new Map();
  const wetShare = (i) => {
    if (shareCache.has(i)) return shareCache.get(i);
    let sw = 0;
    let sx = 0;
    for (const m of pm) {
      const v = m.p[i];
      if (v == null) continue;
      const w = Math.max(0.05, weightAt(m.model, leadOf(i)));
      sw += w;
      if (v >= 0.2) sx += w;
    }
    const r = sw ? sx / sw : 0;
    shareCache.set(i, r);
    return r;
  };
  const core = (i) => wetShare(i) >= 0.25 || (hours[i].popSrc === 'ens' && hours[i].pop >= 0.6 && hours[i].precip >= 0.05);
  const any = (i) => wetShare(i) > 0;

  /** Yhdistää peräkkäiset tunnit, joiden välissä on enintään yksi kuiva tunti. */
  const group = (pred, lo, hi) => {
    const spans = [];
    let cur = null;
    for (let i = lo; i <= hi; i++) {
      if (!pred(i)) continue;
      if (cur && i - cur.end <= 2) cur.end = i; // enintään yksi kuiva tunti välissä
      else {
        cur = { start: i, end: i };
        spans.push(cur);
      }
    }
    return spans;
  };
  const sum = (s) => {
    let total = 0;
    let snowW = 0;
    for (let i = s.start; i <= s.end; i++) {
      total += hours[i].precip;
      snowW += hours[i].precip * hours[i].snowShare;
    }
    return { ...s, total, snowW };
  };

  // 1) Mallien yhteisesti ennustamat sadejaksot
  const coreSpans = group(core, from, to).map(sum);
  // 2) Hajonneet jaksot: useampi malli ennustaa sadetta, mutta kukin eri tunneille (esim. konvektiiviset kuurot).
  //    Tunnit, joilla on vain yksittäisten mallien sadetta, ja jotka eivät ole varmojen jaksojen vieressä.
  const occupied = (i) => coreSpans.some((s) => i >= s.start - 2 && i <= s.end + 2);
  const smeared = group((i) => any(i) && !core(i) && !occupied(i), from, to).map(sum).map((s) => ({ ...s, smeared: true }));

  const out = [];
  for (const s of [...coreSpans, ...smeared].sort((x, y) => x.start - y.start)) {
    const pwin = windowPopPm(pm, s.start, s.end, 0.3, lead0);
    if (pwin != null && pwin < minPwin) continue;
    // Alkamisajan hajonta: mallien omat ensimmäiset märät tunnit jakson ympäristössä
    const starts = [];
    for (const m of pm) {
      for (let i = Math.max(0, s.start - 2); i <= Math.min(to, s.end + 2); i++) {
        if (m.p[i] != null && m.p[i] >= 0.2) {
          starts.push({ v: i, w: Math.max(0.05, weightAt(m.model, leadOf(i))) });
          break;
        }
      }
    }
    const timingUncertain = !!s.smeared || (starts.length >= 3 && wQuantile(starts, 0.75) - wQuantile(starts, 0.25) > 2);
    // Alkamisajan vaihteluväli mallien kesken (20. ja 80. persentiili): "sade alkaa klo 15–17 mallista riippuen"
    const startLo = starts.length >= 3 ? Math.round(wQuantile(starts, 0.2)) : s.start;
    const startHi = starts.length >= 3 ? Math.round(wQuantile(starts, 0.8)) : s.start;
    const sh = s.total ? s.snowW / s.total : 0;
    out.push({
      start: s.start, end: s.end, total: s.total, snowW: s.snowW, pwin, timingUncertain, startLo, startHi,
      startT: hours[s.start].t, endT: hours[s.end].t, kind: sh >= 0.6 ? 'snow' : sh >= 0.25 ? 'sleet' : 'rain',
    });
  }
  return out;
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

const LONG_SPAN_H = 20; // tästä pituudesta alkaen "klo 14–15" olisi harhaanjohtava: loppuhetki on jo seuraavana päivänä

/** Lyhyt aikamääre tuntijaksolle: "klo 14–17" (tai "huomenna klo 06–09"). Yksi tunti: "klo 14". Pitkä jakso: "klo 14 alkaen (noin 22 h)". */
function spanLabel(fc, start, end, today) {
  const a = fc.hours[start].t;
  const b = fc.hours[end].t;
  const len = end - start + 1;
  const range = start === end ? `klo ${hh(a)}` : len >= LONG_SPAN_H ? `klo ${hh(a)} alkaen (noin ${len} h)` : `klo ${hh(a)}–${endHour(b)}`;
  return `${whenLabel(a, today)}${range}`;
}

/** fromIdx: nykyinen tunti. Jos pitkä jakso alkaa jo nyt, sanotaan "koko seuraavan vuorokauden ajan". */
function spanSentences(spans, today, max = 2, fromIdx = null) {
  return spans.slice(0, max).map((s) => {
    const total = s.total >= 0.1 ? `, yhteensä noin ${fmtMm(s.total)}` : '';
    const len = s.end - s.start + 1;
    let range;
    if (len >= LONG_SPAN_H && fromIdx != null && s.start <= fromIdx) range = 'koko seuraavan vuorokauden ajan';
    else if (len >= LONG_SPAN_H) range = `${whenLabel(s.startT, today)}klo ${hh(s.startT)} alkaen noin ${len} tunnin ajan`;
    else range = `${whenLabel(s.startT, today)}${s.start === s.end ? `klo ${hh(s.startT)}` : `klo ${hh(s.startT)}–${endHour(s.endT)}`}`;
    const unsure = s.timingUncertain ? ' Ajoitus on epävarma.' : '';
    const word = s.pwin != null && s.pwin < 0.6 ? `Mahdollisesti ${KIND_WORD[s.kind]}` : cap(KIND_WORD[s.kind]);
    return `${word} ${range}${total}.${unsure}`;
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
  const spans = rainSpansFrom(fc, idx, 24);
  if (spans.length) out.push(...spanSentences(spans, local.date, 2, idx));
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
  if (h.precip >= 0.1) out.push(`Sadetta noin ${fmtMm(h.precip)} tunnissa, ${popText(h)}.`);
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
  const spans = wetSpans(fc, d.from, d.to);
  if (spans.length) out.push(...spanSentences(spans, date));
  else out.push('Merkittävää sadetta ei odoteta.');
  out.push(`Tuuli enimmillään ${fmtNum(d.wind)} m/s, puuskissa ${fmtNum(d.gust)} m/s.`);
  return out;
}
return { SYMBOLS, median, wMedian, wMean, wQuantile, combine, phaseShare, windowPopPm, cloudSymbol, pickSymbol, blendForecast, nowPosition, snapshot, modelRows, modelSeries, modelWindow, modelDaily, confidence, popPct, popText, rainSpansFrom, wetSpans, hh, endHour, whenLabel, spanLabel, describeNow, describeHour, describeDay };
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
  [-12, ['#0a0d26', '#141a45', '#1f2a66']],
  [-8, ['#1d1f52', '#3d3486', '#7a4f96']],
  [-6, ['#4a3d93', '#8a6ec2', '#d690b6']], // syvä hämärä: kylläinen violetti, ei harmaata välivaihetta
  [-4, ['#e8c5cf', '#d3b4e2', '#b8baf0']], // aamu/ilta: pastellinen persikka ja laventeli, vaalea jo ennen auringonnousua
  [1, ['#f6cfc6', '#eabcd8', '#c9c4f2']],
  [6, ['#ffe4cc', '#f6cae4', '#c7d3fb']],
  [14, ['#fdebd3', '#e2cbfb', '#bcdcff']],
  [35, ['#fdf0da', '#d8cdfb', '#b6ddff']],
].map(([alt, cols]) => [alt, cols.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)])]);

/** Onko taivas niin vaalea, että käyttöliittymän pitää käyttää tummaa tekstiä. */
function isLightSky(altDeg) {
  const c = skyColors(altDeg)[1];
  const lin = (v) => ((v / 255) ** 2.2);
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]) > 0.3;
}

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


// Konseptin väripaletit: [x, y, leveys, korkeus, väri, peittävyys] 412 x 915 -pohjalla. Kuudes kenttä on vain päiväpaletissa (muissa läpinäkyvä).
const hex3 = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const PAL = {
  aamu: [[190, -60, 380, 380, '#ffd58a', 0.95], [-110, 120, 340, 340, '#ffb0c4', 0.9], [110, 380, 380, 380, '#ffd9c6', 0.85], [-70, 620, 420, 360, '#b8dcff', 0.95], [250, 700, 240, 240, '#fff3c2', 0.9], [-30, -40, 220, 200, '#fff0b2', 0.6]],
  paiva: [[200, -70, 360, 360, '#ffc4a6', 0.95], [-110, 150, 320, 320, '#ffaed2', 0.9], [110, 380, 380, 380, '#cdb5ff', 0.9], [-70, 620, 400, 360, '#a6d5ff', 0.95], [250, 700, 240, 240, '#bff3de', 0.9], [-30, -40, 220, 200, '#fff0b2', 0.9]],
  ilta: [[190, -60, 380, 380, '#e6a6c8', 0.85], [-120, 140, 360, 360, '#a69be6', 0.9], [100, 400, 400, 400, '#8fa4e6', 0.9], [-70, 640, 420, 360, '#7fb0e8', 0.85], [250, 700, 240, 240, '#c9b8f2', 0.8], [-30, -40, 220, 200, '#f6c8d8', 0.5]],
  yo: [[190, -60, 380, 380, '#6a4fd6', 0.75], [-120, 140, 360, 360, '#d05fb4', 0.55], [100, 420, 400, 400, '#3b55d6', 0.7], [-70, 640, 420, 360, '#1f8fd6', 0.6], [250, 700, 240, 240, '#2fd0c0', 0.35], [-30, -40, 220, 200, '#6a4fd6', 0.3]],
};
for (const k of Object.keys(PAL)) PAL[k] = PAL[k].map(([x, y, bw, bh, c, o]) => [x, y, bw, bh, hex3(c), o]);

// Värien sekoitus OKLCH-avaruudessa: sävy kiertää ja kylläisyys säilyy, joten hämärän välivaiheet eivät muutu harmaiksi.
const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const gam = (v) => clamp((v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255, 0, 255);
function toLab([r, g, b]) {
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromLab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), gam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
}
function mixLch(c1, c2, t) {
  const A = toLab(c1);
  const B = toLab(c2);
  const C1 = Math.hypot(A[1], A[2]);
  const C2 = Math.hypot(B[1], B[2]);
  const h1 = Math.atan2(A[2], A[1]);
  let dh = Math.atan2(B[2], B[1]) - h1;
  if (dh > Math.PI) dh -= 2 * Math.PI;
  if (dh < -Math.PI) dh += 2 * Math.PI;
  // Lähes harmaan värin sävy ei merkitse: käytetään toisen värin sävyä
  const h = C1 < 0.02 ? Math.atan2(B[2], B[1]) : C2 < 0.02 ? h1 : h1 + dh * t;
  const C = lerp(C1, C2, t);
  return fromLab([lerp(A[0], B[0], t), C * Math.cos(h), C * Math.sin(h)]);
}

const blendPal = (a, b, t) => a.map((p, i) => [lerp(p[0], b[i][0], t), lerp(p[1], b[i][1], t), lerp(p[2], b[i][2], t), lerp(p[3], b[i][3], t), mixLch(p[4], b[i][4], t), lerp(p[5], b[i][5], t)]);

/** Taustan värikentät auringon korkeuden mukaan: yö, aamu tai ilta (hämärä), päivä. */
function blobsFor(alt, morning) {
  const dusk = morning ? PAL.aamu : PAL.ilta;
  if (alt <= -8) return PAL.yo;
  if (alt < -4) return blendPal(PAL.yo, dusk, (alt + 8) / 4); // hämärän vaihe on lyhyt ja kylläinen
  if (alt < 14) return blendPal(dusk, PAL.paiva, (alt + 4) / 18);
  return PAL.paiva;
}

/** Taustan pohjaväri: yö -> violetti hämärä -> vaalea päivä (ei harmaata välivaihetta). */
const BASE_NIGHT = [19, 15, 41];
const BASE_DUSK = [128, 104, 190];
const BASE_DAY = [252, 247, 255];
function baseColor(light) {
  return light < 0.5 ? mixLch(BASE_NIGHT, BASE_DUSK, light * 2) : mixLch(BASE_DUSK, BASE_DAY, (light - 0.5) * 2);
}

const DEFAULT = { alt: 25, bearing: 180, cloud: 0.3, precip: 0, snow: 0, wind: 3, windDir: 225, thunder: 0, fog: 0, moonPhase: 0.5, moonAlt: -90, moonHA: 12 };
const KEYS = Object.keys(DEFAULT);

// Akkubudjetti: animaatio pysähtyy, kun käyttäjä ei ole koskenut ruutuun IDLE_MS aikaan (silloin piirretään yksi kuva minuutissa),
// sateessa ja lumessa kuvataajuus on 20 kuvaa/s ja muuten 10. Alle 20 %:n akulla (ei latauksessa) tausta pysyy paikallaan.
const IDLE_MS = 10000;
const GAP_RAIN = 50;
const GAP_CALM = 100;
const GAP_IDLE = 60000;

function createSky(canvas, { reduceMotion = false, animate = true } = {}) {
  const ctx = canvas.getContext('2d');
  let w = 0;
  let h = 0;
  let dpr = 1;
  let raf = 0;
  let last = 0;
  let time = 0;
  let inited = false;
  let userAnim = animate;
  let still = reduceMotion || !userAnim; // true: ei animaatiota (liikkeen vähennys tai asetuksista pois)
  let saver = false; // akku vähissä
  let idleTimer = 0;
  let activeAt = globalThis.performance?.now?.() ?? 0; // viimeisin kosketus
  const cur = { ...DEFAULT, rainN: 0, snowN: 0 };
  const tgt = { ...DEFAULT };

  const rand = mulberry(20261014);
  const rain = Array.from({ length: 280 }, () => ({ x: rand(), y: rand(), v: 0.75 + rand() * 0.5, l: 0.6 + rand() * 0.8 }));
  const snow = Array.from({ length: 200 }, () => ({ x: rand(), y: rand(), v: 0.5 + rand() * 0.8, r: 1 + rand() * 2.2, ph: rand() * 6.28 }));
  const flash = { a: 0, next: 4, bolt: null };

  function resize() {
    const ndpr = Math.min(globalThis.devicePixelRatio || 1, 1.5); // pehmeä sisältö, ei tarvitse täyttä tarkkuutta
    const nw = Math.max(1, Math.round(canvas.clientWidth || globalThis.innerWidth || 400));
    const nh = Math.max(1, Math.round(canvas.clientHeight || globalThis.innerHeight || 800));
    if (nw === w && nh === h && ndpr === dpr) return; // ei muutosta: ei varata kangasta uudelleen
    dpr = ndpr;
    w = nw;
    h = nh;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!raf) draw(0);
  }

  function set(state, { snap = false } = {}) {
    for (const k of KEYS) if (state[k] != null && Number.isFinite(state[k])) tgt[k] = state[k];
    const asleep = !raf && idleTimer !== 0; // joutilas: ei animaatiota, joten tila vaihdetaan suoraan
    if (!inited || snap || still || saver || asleep) {
      for (const k of KEYS) cur[k] = tgt[k];
      cur.rainN = rainCount();
      cur.snowN = snowCount();
      inited = true;
    }
    if (!raf) draw(0);
  }

  const rainCount = () => (tgt.precip >= 0.05 ? clamp(30 + tgt.precip * 45, 0, 200) * (1 - tgt.snow) : 0);
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

  function draw(dt) {
    const alt = cur.alt;
    const cover = clamp(cur.cloud, 0, 1);
    const gloom = clamp(cover * 0.35 + (cur.precip > 0.3 ? 0.2 : 0) + cur.thunder * 0.25 + cur.fog * 0.3, 0, 0.7);
    const night = clamp((-alt - 3) / 10, 0, 1);
    const light = clamp((alt + 8) / 4, 0, 1);

    // Pohja ja liukuvat värikentät (konseptin aamu / päivä / ilta / yö)
    ctx.fillStyle = rgba(baseColor(light));
    ctx.fillRect(0, 0, w, h);
    const blobs = blobsFor(alt, cur.bearing < 180);
    const grey = mix([60, 55, 92], [206, 201, 226], light);
    const sx = w / 412;
    const sy = h / 915;
    blobs.forEach(([x, y, bw, bh, col, o], i) => {
      const dx = Math.sin(time * 0.045 * (1 + i * 0.27) + i * 2.1) * 22;
      const dy = Math.cos(time * 0.037 * (1 + i * 0.21) + i * 1.3) * 22;
      const cx = (x + bw / 2 + dx) * sx;
      const cy = (y + bh / 2 + dy) * sy;
      const r = (Math.max(bw, bh) / 2) * 1.2 * Math.max(sx, sy * 0.9);
      const c = mix(col, grey, gloom * 0.4);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, rgba(c, o));
      g.addColorStop(0.5, rgba(c, o * 0.62));
      g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    });

    // Sumu
    if (cur.fog > 0.03) {
      for (let i = 0; i < 3; i++) {
        const y = h * (0.4 + i * 0.16);
        const off = Math.sin(time * 0.05 + i * 2) * 40;
        const fg = ctx.createLinearGradient(0, y - h * 0.18, 0, y + h * 0.18);
        const fogCol = mix([205, 212, 224], skyColors(alt)[2], 0.2);
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
      ctx.strokeStyle = night > 0.5 ? 'rgba(170,195,235,0.42)' : isLightSky(alt) ? 'rgba(84,100,196,0.5)' : 'rgba(205,224,255,0.55)';
      ctx.lineWidth = 1;
      ctx.lineCap = 'round';
      ctx.beginPath();
      // Rauhallinen sade: hitaat, lyhyet viirut (konsepti: liike on hidasta ja pehmeää)
      for (let i = 0; i < nr; i++) {
        const d = rain[i];
        const y = (((d.y * h + time * 260 * d.v) % (h + 40)) + h + 40) % (h + 40) - 20;
        const x = (((d.x * w + y * slant * 0.6) % w) + w) % w;
        ctx.moveTo(x, y);
        ctx.lineTo(x + slant * 11 * d.l, y + 11 * d.l);
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

  const gapNow = () => (cur.rainN >= 1 || cur.snowN >= 1 || cur.thunder > 0.3 || flash.a > 0.01 ? GAP_RAIN : GAP_CALM);

  function loop(ts) {
    raf = 0;
    if (document.hidden) {
      raf = requestAnimationFrame(loop);
      return;
    }
    const idle = still || saver || ts - activeAt > IDLE_MS;
    if (!last || ts - last >= gapNow()) {
      const dt = last ? Math.min(0.15, (ts - last) / 1000) : 0.016;
      last = ts;
      step(dt);
      draw(dt);
    }
    if (idle) {
      // Kuva on piirretty. Nukutaan ilman rAF-herätyksiä: seuraava kuva minuutin päästä tai kosketuksesta.
      idleTimer = setTimeout(() => {
        idleTimer = 0;
        if (!raf) raf = requestAnimationFrame(loop);
      }, GAP_IDLE);
      return;
    }
    raf = requestAnimationFrame(loop);
  }

  function start() {
    if (raf || idleTimer) return;
    last = 0;
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    clearTimeout(idleTimer);
    idleTimer = 0;
  }

  /** Käyttäjä koski ruutuun: jatketaan animaatiota heti. */
  function poke() {
    activeAt = globalThis.performance?.now?.() ?? 0;
    if (still || saver) return;
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = 0;
    }
    if (!raf) {
      last = 0;
      raf = requestAnimationFrame(loop);
    }
  }

  /** Animaatio päälle tai pois (asetus). Pois-tilassa piirretään yksi kuva tilan muuttuessa ja yksi minuutissa. */
  function setAnimated(on) {
    userAnim = !!on;
    still = reduceMotion || !userAnim;
    poke();
  }

  // Käyttöjärjestelmän "vähennä liikettä" -asetus voi muuttua kesken käytön.
  try {
    const mq = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (mq) {
      const onMq = () => {
        reduceMotion = mq.matches;
        still = reduceMotion || !userAnim;
        poke();
      };
      mq.addEventListener?.('change', onMq);
    }
  } catch {
    /* vanha selain */
  }

  // Akkua säästetään, kun varaus on alle 20 % eikä laite lataudu (getBatteryia ei ole kaikissa selaimissa).
  try {
    globalThis.navigator?.getBattery?.()
      .then((b) => {
        const upd = () => {
          saver = b.level <= 0.2 && !b.charging;
          if (!saver) poke();
        };
        upd();
        b.addEventListener('levelchange', upd);
        b.addEventListener('chargingchange', upd);
      })
      .catch(() => {});
  } catch {
    /* ei tukea */
  }

  resize();
  let resizeTimer = 0;
  globalThis.addEventListener?.('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });
  return { set, resize, start, stop, poke, setAnimated, draw: () => draw(0), state: () => ({ ...cur }) };
}
return { isLightSky, skyColors, mixLch, blobsFor, createSky };
})();

// ---- meteogram.js ----
__m['meteogram'] = (() => {
// meteogram.js: SääÄlyn sääkaavio (pohja: UX-asiantuntijan viitetoteutus). Puhdas funktio, ei DOM:ia eikä riippuvuuksia.
// Piirtää: lämpötilakäyrä + epävarmuuskaista (mallien min–max), sadepalkit (+ vaalea "märin malli" -kate), tuulinuolet,
// yön varjostus, vuorokauden rajat ja "nyt"-merkki. Tuottaa SVG-merkkijonon, jonka päälle sivu rakentaa
// tarkastuspalkin (role="slider") ja taulukkovaihtoehdon.
//
// Syöte hours[]: fc.hours-rivejä alkaen kuluvasta tunnista (hours[0] = nykyinen tasatunti). Kentät:
//   t 'YYYY-MM-DDTHH:00' (paikallinen), temp, tLo?, tHi? (mallien vaihteluväli, blend.js), precip (mm; rivi j kattaa välin [t_j, t_j+1 h),
//   koska blend.js siirtää Open-Meteon "edellisen tunnin" suureet jäsennyksessä), precipHi? (märimmän mallin arvo), pop 0..1, snowShare 0..1,
//   wind, gust (m/s), dir (tulosuunta °), sym, isDay.
// Aikatulkinta: lämpötila, tuuli ja symboli ovat hetkiarvoja (x = tasatunti). Sadepalkki rivistä j kattaa välin [t_j, t_j+1 h).
// Kaikki mitat ovat CSS-pikseleitä: viewBox = säiliön leveys, joten tekstit pysyvät terävinä eikä mitään skaalata.

const WD = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];
const SEV = ['clear', 'mostly_clear', 'partly_cloudy', 'mostly_cloudy', 'overcast', 'fog', 'drizzle', 'rain_light', 'snow_light', 'sleet', 'rain', 'snow', 'rain_heavy', 'snow_heavy', 'thunder'];
const NAMES = { clear: 'selkeää', mostly_clear: 'enimmäkseen selkeää', partly_cloudy: 'puolipilvistä', mostly_cloudy: 'enimmäkseen pilvistä', overcast: 'pilvistä', fog: 'sumua', drizzle: 'tihkua', rain_light: 'heikkoa vesisadetta', rain: 'vesisadetta', rain_heavy: 'kovaa vesisadetta', sleet: 'räntää', snow_light: 'heikkoa lumisadetta', snow: 'lumisadetta', snow_heavy: 'kovaa lumisadetta', thunder: 'ukkosta' };
const COMPASS = ['pohjoisesta', 'koillisesta', 'idästä', 'kaakosta', 'etelästä', 'lounaasta', 'lännestä', 'luoteesta'];

const RANGES = {
  '24h': { bins: 24, binH: 1, every: 3 },
  '48h': { bins: 48, binH: 1, every: 6 },
  '7d': { bins: 56, binH: 3, every: 24 },
};

// ---------- pienet apurit ----------
const r1 = (x) => Math.round(x * 10) / 10;
const num = (x, d = 0) => (Math.round(Math.abs(x) * 10 ** d) / 10 ** d).toFixed(d).replace('.', ',');
const fmtT = (t) => { const r = Math.round(t); return r === 0 ? '0°' : (r < 0 ? '−' : '+') + Math.abs(r) + '°'; };
const fmtMmv = (v) => (v < 0.05 ? '0 mm' : num(v, v < 10 ? 1 : 0) + ' mm');
const pseudoMs = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), +iso.slice(11, 13), +(iso.slice(14, 16) || 0));
const hourOf = (iso) => +iso.slice(11, 13);
const wdOf = (iso) => WD[new Date(iso.slice(0, 10) + 'T00:00:00Z').getUTCDay()];
const dm = (iso) => `${+iso.slice(8, 10)}.${+iso.slice(5, 7)}.`;
const windClass = (v) => (v < 4 ? 0 : v < 8 ? 1 : v < 14 ? 2 : 3);
const compassFrom = (deg) => (deg == null ? '' : COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]);

/** Monotoninen kuutiointerpolaatio (Fritsch–Carlson): pehmeä käyrä, joka ei ylitä datapisteitä. */
function monotonePath(pts) {
  const n = pts.length;
  if (n < 2) return '';
  const dx = [], m = [], t = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${r1(pts[i][0] + h)} ${r1(pts[i][1] + t[i] * h)} ${r1(pts[i + 1][0] - h)} ${r1(pts[i + 1][1] - t[i + 1] * h)} ${r1(pts[i + 1][0])} ${r1(pts[i + 1][1])}`;
  }
  return d;
}

function niceStep(span) { for (const s of [1, 2, 3, 5, 10, 20]) if (span / s <= 4.01) return s; return 20; }
function niceTop(v) { for (const t of [1, 2, 4, 8, 16, 32]) if (v <= t) return t; return 32; }

function circMean(items) {
  let x = 0, y = 0;
  for (const it of items) { x += it.w * Math.sin((it.deg * Math.PI) / 180); y += it.w * Math.cos((it.deg * Math.PI) / 180); }
  return Math.abs(x) + Math.abs(y) < 1e-9 ? null : (((Math.atan2(x, y) * 180) / Math.PI) + 360) % 360;
}

/** Tuulinuoli osoittaa suuntaan, johon tuuli puhaltaa (tulosuunta + 180°), kuten meteoblue/Yr/IL. */
function arrow(x, y, s, dir, cls) {
  const rot = (((dir ?? 0) + 180) % 360).toFixed(0);
  return `<path class="${cls}" transform="translate(${r1(x)} ${r1(y)}) rotate(${rot})" d="M0 ${-s}L${r1(s * 0.62)} ${r1(s * 0.7)}L0 ${r1(s * 0.28)}L${r1(-s * 0.62)} ${r1(s * 0.7)}Z"/>`;
}

/** Sama kuvake kuin sovelluksessa: icon(sym,isDay,size) -> sisäkkäinen <svg x y>. icon-funktio annetaan valinnoissa. */
function nestedIcon(iconFn, sym, isDay, cx, y, size) {
  return iconFn(sym, isDay, size).replace('<svg class="wx"', `<svg class="wx" x="${r1(cx - size / 2)}" y="${r1(y)}"`);
}

function binsFor(hours, range) {
  const { bins, binH } = RANGES[range];
  const need = bins * binH + 1;
  const hs = hours.slice(0, need);
  const out = [];
  for (let j = 0; j + binH < hs.length; j += binH) {
    const a = hs.slice(j, j + binH); // sade ja puuskat: rivi j kattaa välin [t_j, t_j+1 h)
    const w = a.reduce((s, h) => s + h.precip, 0);
    const span = hs.slice(j, j + binH + 1);
    out.push({
      j, t: hs[j].t, t1: hs[j + binH].t,
      precip: w,
      precipHi: a.reduce((s, h) => s + (h.precipHi ?? h.precip), 0),
      pop: Math.max(...a.map((h) => h.pop ?? 0)),
      snowShare: w > 0 ? a.reduce((s, h) => s + h.precip * (h.snowShare ?? 0), 0) / w : a[0].snowShare ?? 0,
      tMid: span.reduce((s, h) => s + h.temp, 0) / span.length,
      wind: Math.max(...a.map((h) => h.wind)),
      gust: Math.max(...a.map((h) => h.gust ?? h.wind)),
      dir: circMean(a.map((h) => ({ deg: h.dir ?? 0, w: h.wind + 0.01 }))),
      sym: a.reduce((b, h) => (SEV.indexOf(h.sym) > SEV.indexOf(b) ? h.sym : b), a[0].sym),
    });
  }
  return { pts: hs, bins: out };
}

/**
 * @param {object[]} hours fc.hours alkaen nykyisestä tasatunnista
 * @param {object} o { range:'24h'|'48h'|'7d', width, nowFrac:0..1 (kuluva osuus ensimmäisestä tunnista), icon:(sym,isDay,size)=>svgString,
 *                     night:[[isoStart,isoEnd],…] (auringonlaskusta -nousuun, paikallinen aika), inspect:index|null, inspectIso:string|null (ensisijainen), compact:boolean, band:boolean, uid:string }
 */
function meteogram(hours, o = {}) {
  const range = o.range || '24h';
  const W = Math.round(o.width || 400);
  const compact = !!o.compact; // tekstikoko >= 150 %: vähemmän tekstiä, isompi fontti
  const uid = o.uid || 'mg';
  const R = RANGES[range];
  const { pts, bins } = binsFor(hours, range);
  const N = bins.length;
  const padL = 12, padR = 12;
  const plotW = W - padL - padR;
  const bw = plotW / N;
  const fs = compact ? 13 : 11; // pienin teksti 11 px (kaavion tikut), kompaktissa 13
  const H = { axis: compact ? 22 : 20, sym: 36, temp: 120, gap: 8, precip: 50, wind: compact ? 24 : 44 };
  const yAxis = 0, ySym = H.axis, yTemp = H.axis + H.sym, yPrec = yTemp + H.temp + H.gap, yWind = yPrec + H.precip + H.gap;
  const height = yWind + H.wind + 4;
  const xAt = (i) => padL + i * bw; // hetki i (0..N) tasatunnin tai 3 h:n rajalla
  const msStart = pseudoMs(pts[0].t);
  const binMs = R.binH * 3600000;
  const xOfIso = (iso) => padL + ((pseudoMs(iso) - msStart) / (N * binMs)) * plotW;
  const out = [];
  const cls = (c) => `class="${c}"`;
  // Tarkastuskohta voidaan antaa jakson alkuhetkenä (inspectIso): indeksi siirtyy, kun tasatunti vaihtuu, mutta hetki pysyy samana.
  const inspect = o.inspectIso != null ? bins.findIndex((b) => b.t === o.inspectIso) : o.inspect ?? -1;

  // --- lämpötila-asteikko ---
  const idx = (j) => j * R.binH;
  const tp = []; // [x,y-arvo]
  for (let i = 0; i <= N; i++) { const h = pts[Math.min(i * R.binH, pts.length - 1)]; tp.push({ x: xAt(i), v: h.temp, lo: h.tLo ?? h.temp, hi: h.tHi ?? h.temp, h }); }
  const showBand = o.band !== false && tp.some((p) => p.hi - p.lo > 0.3);
  let vmin = Math.min(...tp.map((p) => (showBand ? p.lo : p.v))), vmax = Math.max(...tp.map((p) => (showBand ? p.hi : p.v)));
  if (vmax - vmin < 5) { const c = (vmax + vmin) / 2; vmin = c - 2.5; vmax = c + 2.5; }
  const step = niceStep(vmax - vmin + 1);
  const lo = Math.floor((vmin - 0.4) / step) * step, hi = Math.ceil((vmax + 0.4) / step) * step;
  const tT = yTemp + 16, tB = yTemp + H.temp - 14; // vaakasuora ala ylä- ja alamerkinnöille
  const yv = (v) => tT + ((hi - v) / (hi - lo)) * (tB - tT);

  // --- yön varjostus ---
  const defs = `<defs><pattern id="${uid}-sl" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" class="mg-pat-bg"/><rect width="2" height="5" class="mg-pat-fg"/></pattern><pattern id="${uid}-sn" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" class="mg-snow-bg"/><circle cx="1.2" cy="1.2" r="0.9" class="mg-snow-dot"/><circle cx="3.2" cy="3.2" r="0.9" class="mg-snow-dot"/></pattern><clipPath id="${uid}-clip"><rect x="${padL}" y="0" width="${plotW}" height="${height}"/></clipPath></defs>`;
  out.push(defs, `<g clip-path="url(#${uid}-clip)">`);
  const nights = o.night || [];
  for (const [a, b] of nights) {
    const x0 = Math.max(padL, xOfIso(a)), x1 = Math.min(padL + plotW, xOfIso(b));
    if (x1 > x0) out.push(`<rect ${cls('mg-night')} x="${r1(x0)}" y="${ySym - 2}" width="${r1(x1 - x0)}" height="${r1(height - ySym - 2)}"/>`);
  }
  out.push('</g>');

  // --- ääriarvojen paikat (piirretään käyrän jälkeen; asteikon tekstit väistävät niitä) ---
  const iMax = tp.reduce((b, p, i) => (p.v > tp[b].v ? i : b), 0), iMin = tp.reduce((b, p, i) => (p.v < tp[b].v ? i : b), 0);
  const extList = tp[iMax].v - tp[iMin].v >= 1.5 ? [[iMax, true], [iMin, false]] : [[iMax, true]];
  const extPos = (i, above) => {
    const p = tp[i];
    const y = yv(p.v);
    const edge = showBand ? yv(above ? p.hi : p.lo) : y;
    return { p, y, x: Math.min(padL + plotW - 14, Math.max(padL + 16, p.x)), yb: above ? Math.min(y, edge) - 6 : Math.max(y, edge) + 15 };
  };
  const extBoxes = extList.map(([i, above]) => extPos(i, above));

  // --- ruudukko ja nollaviiva ---
  for (let v = lo; v <= hi + 1e-9; v += step) {
    const y = yv(v);
    const zero = v === 0;
    out.push(`<line ${cls(zero ? 'mg-zero' : 'mg-grid')} x1="${padL}" x2="${padL + plotW}" y1="${r1(y)}" y2="${r1(y)}"/>`);
    // Asteikon teksti jätetään pois, jos ääriarvon teksti on sen päällä (vasen reuna)
    const clash = extBoxes.some((e) => e.x < padL + 52 && Math.abs(e.yb - (y - 3)) < 13);
    if ((!compact || zero) && !clash) out.push(`<text ${cls('mg-tx mg-ytx')} x="${padL + 2}" y="${r1(y - 3)}" font-size="${fs}">${zero ? '0°' : fmtT(v)}</text>`);
  }

  // --- vuorokauden rajat ja aika-akseli ---
  const seen = new Set();
  for (let i = 0; i <= N; i++) {
    const h = pts[Math.min(i * R.binH, pts.length - 1)];
    const hr = hourOf(h.t);
    if (hr === 0 && i > 0 && i < N && R.binH <= 3) {
      out.push(`<line ${cls('mg-day')} x1="${r1(xAt(i))}" x2="${r1(xAt(i))}" y1="${yAxis + 2}" y2="${r1(yWind + H.wind)}"/>`);
    }
  }
  if (range === '7d') {
    // päivän nimi päivän sarakkeen keskelle
    const dates = [...new Set(pts.map((h) => h.t.slice(0, 10)))];
    for (const d of dates) {
      const x0 = Math.max(padL, xOfIso(d + 'T00:00')), x1 = Math.min(padL + plotW, xOfIso(d + 'T23:59'));
      if (x1 - x0 < 24) continue;
      const lbl = x1 - x0 >= 62 ? `${wdOf(d + 'T00:00')} ${dm(d + 'T00:00').slice(0, -1)}` : wdOf(d + 'T00:00'); // kapea (osittainen) päivä: vain viikonpäivä
      out.push(`<text ${cls('mg-tx mg-ax')} x="${r1((x0 + x1) / 2)}" y="${yAxis + 14}" text-anchor="middle" font-size="${fs}">${lbl}</text>`);
    }
  } else {
    const every = compact ? R.every * 2 : R.every;
    for (let i = 0; i <= N; i++) {
      const h = pts[i]; if (!h) continue;
      const hr = hourOf(h.t);
      if (hr % every !== 0) continue;
      const x = xAt(i);
      if (x < padL + 8 || x > padL + plotW - 8) continue;
      out.push(`<text ${cls('mg-tx mg-ax' + (hr === 0 ? ' mg-axd' : ''))} x="${r1(x)}" y="${yAxis + 14}" text-anchor="middle" font-size="${fs}">${hr === 0 ? wdOf(h.t) : String(hr).padStart(2, '0')}</text>`);
    }
  }

  // --- epävarmuuskaista ja lämpötilakäyrä ---
  if (showBand) {
    const up = monotonePath(tp.map((p) => [p.x, yv(p.hi)]));
    const dn = monotonePath(tp.map((p) => [p.x, yv(p.lo)]).reverse()).replace(/^M/, 'L');
    out.push(`<path ${cls('mg-band')} d="${up}${dn}Z"/>`);
  }
  out.push(`<path ${cls('mg-line')} d="${monotonePath(tp.map((p) => [p.x, yv(p.v)]))}"/>`);
  // ääriarvot (globaalit)
  for (const e of extBoxes) {
    out.push(`<circle ${cls('mg-dot')} cx="${r1(e.p.x)}" cy="${r1(e.y)}" r="3"/>`, `<text ${cls('mg-tx mg-ext')} x="${r1(e.x)}" y="${r1(e.yb)}" text-anchor="middle" font-size="${fs + 1}">${fmtT(e.p.v)}</text>`);
  }
  // nyt
  const nowX = xAt(0) + (o.nowFrac || 0) * bw;
  out.push(`<line ${cls('mg-now')} x1="${r1(nowX)}" x2="${r1(nowX)}" y1="${ySym + 4}" y2="${r1(yWind + H.wind)}"/>`);

  // --- sadepalkit ---
  const maxP = Math.max(0.5, ...bins.map((b) => Math.max(b.precip, b.precipHi)));
  const top = niceTop(maxP);
  const pH = H.precip - 6;
  const ph = (v) => (v >= 0.05 ? Math.min(pH, Math.max(2, (v / top) * pH)) : 0);
  const gap = bw >= 9 ? 1.5 : 1;
  out.push(`<line ${cls('mg-grid')} x1="${padL}" x2="${padL + plotW}" y1="${yPrec + H.precip - 4}" y2="${yPrec + H.precip - 4}"/>`);
  out.push(`<text ${cls('mg-tx mg-ytx')} x="${padL + 2}" y="${yPrec + 10}" font-size="${fs}">${top} mm${range === '7d' ? '/3 h' : '/h'}</text>`);
  let bestB = -1;
  bins.forEach((b, j) => {
    const x = xAt(j) + gap / 2, w = Math.max(1.5, bw - gap), base = yPrec + H.precip - 4;
    const hSolid = ph(b.precip), hHi = ph(b.precipHi);
    const kind = b.snowShare >= 0.6 ? 'sn' : b.snowShare >= 0.25 ? 'sl' : 'rn';
    if (hHi > hSolid + 1.5 && o.band !== false) out.push(`<rect ${cls('mg-hi')} x="${r1(x)}" y="${r1(base - hHi)}" width="${r1(w)}" height="${r1(hHi - hSolid)}" rx="1"/>`);
    if (hSolid > 0) {
      const fill = kind === 'rn' ? cls('mg-rain') : `class="mg-snowbar" fill="url(#${uid}-${kind})"`;
      out.push(`<rect ${fill} x="${r1(x)}" y="${r1(base - hSolid)}" width="${r1(w)}" height="${r1(hSolid)}" rx="${r1(Math.min(3, w / 2))}"/>`);
      if (bestB < 0 || b.precip > bins[bestB].precip) bestB = j;
    }
  });
  if (bestB >= 0 && bins[bestB].precip >= 0.3) {
    const b = bins[bestB];
    const x = Math.min(padL + plotW - 20, Math.max(padL + 70, xAt(bestB) + bw / 2)); // vasemmassa yläkulmassa on asteikon teksti
    out.push(`<text ${cls('mg-tx mg-pv')} x="${r1(x)}" y="${r1(yPrec + H.precip - 4 - ph(Math.max(b.precip, b.precipHi)) - 4)}" text-anchor="middle" font-size="${fs}">${fmtMmv(b.precip)}</text>`);
  }

  // --- tuuli ---
  const wy = yWind + (compact ? 12 : 14);
  const windAt = [];
  if (range === '7d') {
    const dates = [...new Set(pts.map((h) => h.t.slice(0, 10)))];
    for (const d of dates) {
      const x0 = Math.max(padL, xOfIso(d + 'T00:00')), x1 = Math.min(padL + plotW, xOfIso(d + 'T23:59'));
      if (x1 - x0 < 30) continue;
      const day = bins.filter((b) => b.t.slice(0, 10) === d);
      if (!day.length) continue;
      const m = day.reduce((a, b) => (b.wind > a.wind ? b : a), day[0]);
      windAt.push({ x: (x0 + x1) / 2, wind: m.wind, gust: m.gust, dir: m.dir });
    }
  } else {
    const every = compact ? R.every * 2 : R.every;
    for (let i = 0; i < pts.length && i <= N; i++) {
      const h = pts[i];
      if (hourOf(h.t) % every !== 0) continue;
      const x = xAt(i);
      if (x < padL + 12 || x > padL + plotW - 12) continue;
      windAt.push({ x, wind: h.wind, gust: h.gust ?? h.wind, dir: h.dir });
    }
  }
  for (const w of windAt) {
    const c = windClass(w.wind);
    const s = 5 + c * 1.4;
    out.push(arrow(w.x, wy + 2, s, w.dir, `mg-arrow mg-w${c}`));
    if (!compact) out.push(`<text ${cls('mg-tx mg-wv mg-w' + c)} x="${r1(w.x)}" y="${wy + 24}" text-anchor="middle" font-size="${fs}">${Math.round(w.wind)}${w.gust - w.wind >= 4 ? ` (${Math.round(w.gust)})` : ''}</text>`);
  }

  // --- symbolit ---
  // o.icon3d: 3D-kuvakkeet piirretään HTML:nä kaavion päälle (paikat palautetaan icons-taulukossa), SVG:hen ei tule kuvakkeita
  const icons = [];
  const putIcon = (sym, isDay, cx, y) => (o.icon3d ? icons.push({ sym, isDay, x: cx, y: y + 14 }) : out.push(nestedIcon(o.icon, sym, isDay, cx, y, 28)));
  if (o.icon || o.icon3d) {
    const sy = ySym + 2;
    if (range === '7d') {
      const dates = [...new Set(pts.map((h) => h.t.slice(0, 10)))];
      for (const d of dates) {
        const x0 = Math.max(padL, xOfIso(d + 'T00:00')), x1 = Math.min(padL + plotW, xOfIso(d + 'T23:59'));
        if (x1 - x0 < 30) continue;
        const day = bins.filter((b) => b.t.slice(0, 10) === d && hourOf(b.t) >= 6 && hourOf(b.t) < 21);
        const sym = (day.length ? day : bins.filter((b) => b.t.slice(0, 10) === d)).reduce((b, x) => (SEV.indexOf(x.sym) > SEV.indexOf(b) ? x.sym : b), 'clear');
        putIcon(sym, true, (x0 + x1) / 2, sy);
      }
    } else {
      const every = compact ? R.every * 2 : R.every;
      for (let i = 0; i < pts.length && i <= N; i++) {
        const h = pts[i];
        if (hourOf(h.t) % every !== 0) continue;
        const x = xAt(i);
        if (x < padL + 14 || x > padL + plotW - 14) continue;
        putIcon(h.sym, h.isDay, x, sy);
      }
    }
  }

  // --- tarkastuskohdistin ---
  if (inspect >= 0 && bins[inspect]) {
    const b = bins[inspect];
    const x = xAt(inspect) + bw / 2;
    out.push(`<line ${cls('mg-cur')} x1="${r1(x)}" x2="${r1(x)}" y1="${ySym}" y2="${r1(yWind + H.wind)}"/>`, `<circle ${cls('mg-curdot')} cx="${r1(x)}" cy="${r1(yv(b.tMid))}" r="5"/>`);
  }

  const svg = `<svg class="mg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}" aria-hidden="true" focusable="false">${out.join('')}</svg>`;

  // --- tarkastuspalkin tekstit ja saavutettavuus ---
  const readout = (j) => {
    const b = bins[j];
    const a = hourOf(b.t), z = hourOf(b.t1);
    const when = `${wdOf(b.t)} ${dm(b.t)} klo ${String(a).padStart(2, '0')}–${String(z).padStart(2, '0')}`;
    const rain = b.precip >= 0.1 ? `${fmtMmv(b.precip)}${b.pop >= 0.1 ? ` (${Math.round(b.pop * 100)} %)` : ''}` : 'ei sadetta';
    const g = b.gust - b.wind >= 4 ? ` (puuskat ${Math.round(b.gust)})` : '';
    return { when, temp: fmtT(b.tMid), sym: NAMES[b.sym], rain, wind: `${Math.round(b.wind)} m/s${g}`, from: compassFrom(b.dir), dir: b.dir,
      aria: `${when}: ${NAMES[b.sym]}, ${fmtT(b.tMid)}, ${rain}, tuuli ${Math.round(b.wind)} metriä sekunnissa${b.dir != null ? ' ' + compassFrom(b.dir) : ''}${g}` };
  };
  const tmax = Math.max(...tp.map((p) => p.v)), tmin = Math.min(...tp.map((p) => p.v));
  const wet = bins.filter((b) => b.precip >= 0.2);
  const total = bins.reduce((s, b) => s + b.precip, 0);
  const label = range === '24h' ? 'Seuraavat 24 tuntia' : range === '48h' ? 'Seuraavat 48 tuntia' : 'Seuraavat 7 päivää';
  const summary = `${label}: lämpötila ${fmtT(tmin)} … ${fmtT(tmax)}. ` + (wet.length ? `Sadetta yhteensä noin ${fmtMmv(total)}, ensimmäisenä ${wdOf(wet[0].t)} klo ${String(hourOf(wet[0].t)).padStart(2, '0')}. ` : 'Merkittävää sadetta ei odoteta. ') + `Tuuli enimmillään ${Math.round(Math.max(...bins.map((b) => b.wind)))} m/s.`;
  return { svg, width: W, height, bins, readout, summary, icons, inspect: inspect >= 0 ? inspect : null, geom: { padL, plotW, bw, N, ySym, yTemp, yPrec, yWind }, top };
}
return { RANGES, monotonePath, meteogram };
})();

// ---- ai.js ----
__m['ai'] = (() => {
// ai.js: Gemini-kutsut suoraan selaimesta omalla avaimella (avain pysyy vain tämän laitteen selaimessa).
// Tekoäly saa valmiin, koodilla lasketun datan ja selittää sen. Se ei laske lämpötiloja itse.

const { store, defaultFetch, weekday, localNow } = __m['util'];
const { nowPosition, snapshot, modelRows, modelDaily, SYMBOLS } = __m['blend'];

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

/** Tekoälyn tilat: internal = ei tekoälyä (sovelluksen oma laskenta), grounded = Gemini vain sovelluksen datalla, free = data + yleistieto. */
const AI_MODES = ['internal', 'grounded', 'free'];

const aiSettings = {
  key: () => store.str('geminiKey'),
  setKey: (k) => store.set('geminiKey', String(k || '').trim()),
  model: () => store.str('geminiModel') || DEFAULT_MODEL,
  setModel: (m) => store.set('geminiModel', String(m || '').trim()),
  /** Valittu tila. Ilman avainta käytössä on aina internal, vaikka tässä olisi jokin muu (ks. effectiveMode). */
  mode: () => {
    const m = store.str('aiMode', 'grounded');
    return AI_MODES.includes(m) ? m : 'grounded';
  },
  setMode: (m) => store.set('aiMode', AI_MODES.includes(m) ? m : 'grounded'),
};

/** Tila, jolla vastataan oikeasti: ilman avainta aina sovelluksen oma laskenta. */
function effectiveMode(hasKey, mode) {
  return hasKey && AI_MODES.includes(mode) ? mode : 'internal';
}

/** Lyhyt syy, jonka vuoksi Gemini ei vastannut. Näytetään vastauksen lähdemerkinnässä, kun vastaus tulee varalaskennasta. */
function shortReason(e) {
  const s = e?.status || 0;
  if (e?.kind === 'network') return 'ei verkkoyhteyttä';
  if (e?.kind === 'nokey') return 'avainta ei ole';
  if (e?.kind === 'blocked' || e?.kind === 'empty') return 'tyhjä vastaus';
  if (e?.kind === 'loop') return 'vastaus jäi kesken';
  if (s === 429) return 'kiintiö täynnä';
  if (s === 404) return 'mallia ei löytynyt';
  if (s === 401 || s === 403 || (s === 400 && /api key/i.test(e?.details || e?.message || ''))) return 'avain ei kelvannut';
  if (s >= 500) return 'palvelu ei vastaa';
  return 'virhe';
}

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

/**
 * Tiivis, koneluettava kuvaus ennusteesta tekoälylle. Kun results annetaan, mukaan tulevat myös
 * yksittäisten mallien omat luvut (nyt ja seuraavat päivät), jotta tekoäly voi kertoa, mitä mikin malli sanoo.
 */
function compactForecast(fc, nowMs, { hours = 48, results = null } = {}) {
  const { idx, frac, local } = nowPosition(fc, nowMs);
  const rows = fc.hours.slice(idx, idx + hours).map((h) => [h.t.slice(5, 16).replace('T', ' '), r1(h.temp), r1(h.feels), r1(h.precip), Math.round(h.pop * 100), Math.round(h.cloud), r1(h.wind), r1(h.gust), SYMBOLS[h.sym]]);
  const days = fc.days.slice(0, 7).map((d) => [d.date, weekday(d.date, true), r1(d.tmin), r1(d.tmax), r1(d.precip), r1(d.wind), SYMBOLS[d.sym]]);
  const h0 = fc.hours[idx];
  const next = fc.hours[idx + 1] || h0;
  const out = {
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
  if (results?.length) {
    const blendNow = snapshot(fc, idx, frac).temp;
    out.mallit_nyt = modelRows(results, fc, idx, frac, blendNow).map((r) =>
      r.ok
        ? { malli: r.model.short, lampotila_nyt_C: r1(r.temp), ero_yhdistelmaan_C: r1(r.delta), sade_24h_mm: r1(r.precip24) }
        : { malli: r.model.short, tila: r.skipped ? 'ei saatavilla' : r.coverage ? 'ei kata tätä paikkaa' : 'ei vastannut' },
    );
    out.mallit_paivittain_sarakkeet = ['paiva', 'alin_C', 'ylin_C', 'sade_mm', 'tuuli_max_ms'];
    out.mallit_paivittain = Object.fromEntries(modelDaily(results, fc, { days: 4 }).map((m) => [m.short, m.days]));
  }
  return out;
}

function placeLabel(place) {
  const lower = (x) => String(x ?? '').toLocaleLowerCase('fi-FI');
  return [place.name, place.region && lower(place.region) !== lower(place.name) ? place.region : ''].filter(Boolean).join(', ');
}

const RULES_GROUNDED = [
  'TÄRKEÄT SÄÄNNÖT:',
  '1. Vastaat vain alla olevan SÄÄDATAN perusteella. Se on sovelluksen eri säämalleista (ECMWF, ICON, MET Norway, Météo-France, UK Met Office, GFS, GEM, FMI) hakema ja koodilla yhdistämä ennuste, ja se on ainoa tietolähteesi sään nykytilasta ja ennusteesta.',
  '2. Älä käytä omaa tietoasi nykyisestä säästä, ennusteista, havainnoista tai uutisista. Älä keksi lukuja, aikoja, paikkoja tai malleja, joita datassa ei ole.',
  '3. Jokaisen mainitsemasi luvun pitää löytyä datasta tai olla siitä suoraan laskettu (summa, ero, pienin tai suurin arvo). Kun kerrot, mitä yksittäinen malli ennustaa, käytä kenttiä mallit_nyt ja mallit_paivittain ja mainitse mallin nimi.',
  '4. Jos kysymykseen ei voi vastata datalla (aihe ei ole sää, ajankohta on ennusteen ulkopuolella tai paikka puuttuu), sano se lyhyesti ja kerro, mihin datalla voi vastata. Älä arvaa.',
  '5. Käytännön vinkit (pukeutuminen, liukkaus, ulkoilu) saat antaa vain, kun ne perustuvat datan lukuihin. Kerro luvut, joihin vinkki perustuu.',
];

const RULES_FREE = [
  'SÄÄNNÖT:',
  '1. Sääluvut (lämpötila, sade, tuuli, ajat) tulevat vain alla olevasta SÄÄDATASTA. Data on usean säämallin (ECMWF, ICON, MET Norway ym.) koodilla laskettu yhdistelmä. Älä keksi lukuja, aikoja tai paikkoja, joita datassa ei ole.',
  '2. Yleistietoa saat käyttää ilmiöiden selittämiseen ja käytännön neuvoihin. Erota selvästi, mikä tulee datasta ja mikä on yleistietoa.',
  '3. Jos data ei riitä vastaukseen, sano se.',
];

function systemPrompt({ place, fc, nowMs, results = null, mode = 'grounded' }) {
  const ln = localNow(nowMs, fc.tz);
  const rules = mode === 'free' ? RULES_FREE : RULES_GROUNDED;
  return [
    'Olet SääÄly, suomenkielinen sääasiantuntija sääsovelluksessa.',
    ...rules,
    `Paikka: ${placeLabel(place)}. Paikallinen aika nyt: ${weekday(ln.date, true)} ${ln.date} klo ${ln.iso.slice(11)} (${fc.tz}). Kaikki datan ajat ovat tämän paikan paikallista aikaa.`,
    'Kirjoita selkeää, ystävällistä suomea. Ole ytimekäs: yleensä 3–6 lausetta. Käytä lämpötiloissa etumerkkiä (+5°, −3°) ja tuulessa yksikköä m/s.',
    'Jos mallit eroavat toisistaan (hajonta suuri), mainitse epävarmuus lyhyesti.',
    'Voit käyttää **lihavointia** ja lyhyitä luettelomerkkejä. Älä käytä otsikoita.',
    'Jos käyttäjä kysyy muun paikkakunnan kuin nykyisen paikan säästä, hae data get_forecast-työkalulla.',
    '',
    'SÄÄDATA (JSON):',
    JSON.stringify(compactForecast(fc, nowMs, { results })),
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
async function explain({ fc, place, nowMs, selection, results = null, mode = 'grounded', fetchFn = defaultFetch, signal }) {
  const key = aiSettings.key();
  const target =
    selection.type === 'now'
      ? 'tämä hetki ja seuraavat tunnit'
      : selection.type === 'hour'
        ? `tunti ${selection.label}`
        : `päivä ${selection.label}`;
  const ask = `Selitä sää ajankohdalle: ${target}. Kerro, mitä on tulossa ja mikä sen todennäköisesti aiheuttaa, jos data antaa siihen aihetta. Lopuksi yksi käytännön vinkki. Enintään 90 sanaa.`;
  const system = systemPrompt({ place, fc, nowMs, results, mode: mode === 'free' ? 'free' : 'grounded' });
  return withModelHeal(
    async (model) => textOf(await generate({ key, model, system, contents: [{ role: 'user', parts: [{ text: ask }] }], temperature: 0.4, fetchFn, signal })),
    { key, fetchFn },
  );
}

/**
 * Keskustelu. history: [{role:'user'|'assistant', text}], viimeinen on käyttäjän.
 * runTool(name, args) palauttaa tavallisen objektin (esim. paikan ennuste).
 */
async function chat({ fc, place, nowMs, history, results = null, mode = 'grounded', runTool, fetchFn = defaultFetch, signal, maxSteps = 4 }) {
  const key = aiSettings.key();
  const system = systemPrompt({ place, fc, nowMs, results, mode: mode === 'free' ? 'free' : 'grounded' });
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
return { GEMINI_BASE, DEFAULT_MODEL, AiError, AI_MODES, aiSettings, effectiveMode, shortReason, friendlyError, generate, textOf, listModels, pickFlash, compactForecast, placeLabel, systemPrompt, TOOLS, explain, chat };
})();

// ---- gazetteer.js ----
__m['gazetteer'] = (() => {
// gazetteer.js: tunnettujen paikkakuntien nimet ilman verkkoa. Chat tunnistaa näillä taivutetut nimet
// ("Rovaniemellä", "Tukholmassa") ja saa koordinaatit heti, ilman paikkahakua.
// Muut paikat haetaan Open-Meteon paikkahaulla (answer.js). Koordinaatit ovat keskustojen likiarvoja.

const { FI_CITIES } = __m['geo'];

/** [nimi, lat, lon, alue, maa] */
const FOREIGN_CITIES = [
  ['Tukholma', 59.3293, 18.0686, 'Tukholman lääni', 'Ruotsi'],
  ['Göteborg', 57.7089, 11.9746, 'Västra Götaland', 'Ruotsi'],
  ['Oslo', 59.9139, 10.7522, 'Oslo', 'Norja'],
  ['Tromssa', 69.6492, 18.9553, 'Troms', 'Norja'],
  ['Kööpenhamina', 55.6761, 12.5683, 'Tanskan pääkaupunkiseutu', 'Tanska'],
  ['Tallinna', 59.437, 24.7536, 'Harjumaa', 'Viro'],
  ['Tartto', 58.378, 26.729, 'Tartumaa', 'Viro'],
  ['Riika', 56.9496, 24.1052, 'Riika', 'Latvia'],
  ['Vilna', 54.6872, 25.2797, 'Vilnan lääni', 'Liettua'],
  ['Berliini', 52.52, 13.405, 'Berliini', 'Saksa'],
  ['Hampuri', 53.5511, 9.9937, 'Hampuri', 'Saksa'],
  ['München', 48.1351, 11.582, 'Baijeri', 'Saksa'],
  ['Pariisi', 48.8566, 2.3522, 'Île-de-France', 'Ranska'],
  ['Lontoo', 51.5074, -0.1278, 'Englanti', 'Britannia'],
  ['Dublin', 53.3498, -6.2603, 'Leinster', 'Irlanti'],
  ['Rooma', 41.9028, 12.4964, 'Lazio', 'Italia'],
  ['Milano', 45.4642, 9.19, 'Lombardia', 'Italia'],
  ['Venetsia', 45.4408, 12.3155, 'Veneto', 'Italia'],
  ['Madrid', 40.4168, -3.7038, 'Madrid', 'Espanja'],
  ['Barcelona', 41.3874, 2.1686, 'Katalonia', 'Espanja'],
  ['Valencia', 39.4699, -0.3763, 'Valencia', 'Espanja'],
  ['Alicante', 38.3452, -0.481, 'Valencia', 'Espanja'],
  ['Torrevieja', 37.9787, -0.6822, 'Valencia', 'Espanja'],
  ['Benidorm', 38.5411, -0.1225, 'Valencia', 'Espanja'],
  ['Murcia', 37.9922, -1.1307, 'Murcia', 'Espanja'],
  ['Malaga', 36.7213, -4.4214, 'Andalusia', 'Espanja'],
  ['Marbella', 36.5101, -4.8825, 'Andalusia', 'Espanja'],
  ['Fuengirola', 36.5397, -4.6247, 'Andalusia', 'Espanja'],
  ['Sevilla', 37.3891, -5.9845, 'Andalusia', 'Espanja'],
  ['Palma', 39.5696, 2.6502, 'Baleaarit', 'Espanja'],
  ['Mallorca', 39.6953, 3.0176, 'Baleaarit', 'Espanja'],
  ['Las Palmas', 28.1235, -15.4363, 'Kanariansaaret', 'Espanja'],
  ['Teneriffa', 28.2916, -16.6291, 'Kanariansaaret', 'Espanja'],
  ['Lissabon', 38.7223, -9.1393, 'Lissabon', 'Portugali'],
  ['Faro', 37.0194, -7.9304, 'Algarve', 'Portugali'],
  ['Amsterdam', 52.3676, 4.9041, 'Pohjois-Hollanti', 'Alankomaat'],
  ['Bryssel', 50.8503, 4.3517, 'Bryssel', 'Belgia'],
  ['Wien', 48.2082, 16.3738, 'Wien', 'Itävalta'],
  ['Praha', 50.0755, 14.4378, 'Praha', 'Tšekki'],
  ['Budapest', 47.4979, 19.0402, 'Budapest', 'Unkari'],
  ['Varsova', 52.2297, 21.0122, 'Masovia', 'Puola'],
  ['Krakova', 50.0647, 19.945, 'Pikku-Puola', 'Puola'],
  ['Ateena', 37.9838, 23.7275, 'Attika', 'Kreikka'],
  ['Istanbul', 41.0082, 28.9784, 'Istanbul', 'Turkki'],
  ['Antalya', 36.8969, 30.7133, 'Antalya', 'Turkki'],
  ['Pietari', 59.9343, 30.3351, 'Pietari', 'Venäjä'],
  ['Moskova', 55.7558, 37.6173, 'Moskova', 'Venäjä'],
  ['Reykjavik', 64.1466, -21.9426, 'Etelä-Islanti', 'Islanti'],
  ['New York', 40.7128, -74.006, 'New York', 'Yhdysvallat'],
  ['Los Angeles', 34.0522, -118.2437, 'Kalifornia', 'Yhdysvallat'],
  ['Bangkok', 13.7563, 100.5018, 'Bangkok', 'Thaimaa'],
  ['Phuket', 7.8804, 98.3923, 'Phuket', 'Thaimaa'],
  ['Tokio', 35.6762, 139.6503, 'Tokio', 'Japani'],
  ['Dubai', 25.2048, 55.2708, 'Dubai', 'Arabiemiirikunnat'],
  ['Kairo', 30.0444, 31.2357, 'Kairo', 'Egypti'],
  ['San Francisco', 37.7749, -122.4194, 'Kalifornia', 'Yhdysvallat'],
  ['Las Vegas', 36.1699, -115.1398, 'Nevada', 'Yhdysvallat'],
  ['Miami', 25.7617, -80.1918, 'Florida', 'Yhdysvallat'],
  ['Orlando', 28.5383, -81.3792, 'Florida', 'Yhdysvallat'],
  ['Chicago', 41.8781, -87.6298, 'Illinois', 'Yhdysvallat'],
  ['Toronto', 43.6532, -79.3832, 'Ontario', 'Kanada'],
  ['Hong Kong', 22.3193, 114.1694, 'Hongkong', 'Kiina'],
  ['Peking', 39.9042, 116.4074, 'Peking', 'Kiina'],
  ['Singapore', 1.3521, 103.8198, 'Singapore', 'Singapore'],
  ['Kuala Lumpur', 3.139, 101.6869, 'Kuala Lumpur', 'Malesia'],
  ['Abu Dhabi', 24.4539, 54.3773, 'Abu Dhabi', 'Arabiemiirikunnat'],
  ['Tel Aviv', 32.0853, 34.7818, 'Tel Aviv', 'Israel'],
  ['Buenos Aires', -34.6037, -58.3816, 'Buenos Aires', 'Argentiina'],
  ['Cape Town', -33.9249, 18.4241, 'Länsi-Kap', 'Etelä-Afrikka'],
  ['Sydney', -33.8688, 151.2093, 'Uusi Etelä-Wales', 'Australia'],
  ['Krabi', 8.0863, 98.9063, 'Krabi', 'Thaimaa'],
  ['Pattaya', 12.9236, 100.8825, 'Chonburi', 'Thaimaa'],
  ['Hurghada', 27.2579, 33.8116, 'Punainenmeri', 'Egypti'],
  ['Alanya', 36.5438, 32.0, 'Antalya', 'Turkki'],
  ['Kreeta', 35.2401, 24.8093, 'Kreeta', 'Kreikka'],
  ['Rodos', 36.4341, 28.2176, 'Etelä-Egeia', 'Kreikka'],
  ['Korfu', 39.6243, 19.9217, 'Joonian saaret', 'Kreikka'],
  ['Kypros', 35.1264, 33.4299, 'Kypros', 'Kypros'],
  ['Gran Canaria', 27.9202, -15.5474, 'Kanariansaaret', 'Espanja'],
  ['Lanzarote', 29.0469, -13.5899, 'Kanariansaaret', 'Espanja'],
  ['Fuerteventura', 28.3587, -14.0537, 'Kanariansaaret', 'Espanja'],
  ['Madeira', 32.6669, -16.9241, 'Madeira', 'Portugali'],
];


/** Suomalaiset matkailukohteet ja muut usein kysytyt paikat, joita ei ole FI_CITIES-listassa. [nimi, lat, lon, alue]. Koordinaatit ovat likiarvoja. */
const FI_EXTRA = [
  ['Levi', 67.8044, 24.8023, 'Lappi'],
  ['Ylläs', 67.58, 24.17, 'Lappi'],
  ['Ruka', 66.1666, 29.15, 'Pohjois-Pohjanmaa'],
  ['Pyhä', 67.0167, 27.1833, 'Lappi'],
  ['Saariselkä', 68.4167, 27.4167, 'Lappi'],
  ['Vuokatti', 64.1333, 28.2667, 'Kainuu'],
  ['Koli', 63.0944, 29.8044, 'Pohjois-Karjala'],
  ['Tahko', 62.6833, 27.9167, 'Pohjois-Savo'],
  ['Himos', 61.8667, 24.6167, 'Keski-Suomi'],
  ['Hetta', 68.3833, 23.6333, 'Lappi'],
  ['Kilpisjärvi', 69.05, 20.7833, 'Lappi'],
  ['Nuorgam', 70.0833, 27.8667, 'Lappi'],
  ['Salla', 66.8333, 28.6667, 'Lappi'],
  ['Kolari', 67.3333, 23.7833, 'Lappi'],
  ['Äänekoski', 62.6075, 25.7236, 'Keski-Suomi'],
  ['Jämsä', 61.8644, 25.1894, 'Keski-Suomi'],
  ['Pieksämäki', 62.3, 27.1333, 'Etelä-Savo'],
  ['Nurmes', 63.5417, 29.1417, 'Pohjois-Karjala'],
  ['Ähtäri', 62.55, 24.0667, 'Etelä-Pohjanmaa'],
  ['Kristiinankaupunki', 62.2744, 21.3778, 'Pohjanmaa'],
  ['Mäntsälä', 60.6397, 25.3194, 'Uusimaa'],
  ['Tammisaari', 59.9747, 23.4372, 'Uusimaa'],
  ['Kemiönsaari', 60.1667, 22.7333, 'Varsinais-Suomi'],
  ['Hailuoto', 65.0333, 24.7167, 'Pohjois-Pohjanmaa'],
];

/**
 * Lempinimet, ruotsinkieliset nimet ja lyhenteet -> virallinen nimi. Avain on vartalo (ilman ääkkösiä); taivutuspääte lisätään tarvittaessa
 * ("Hesassa", "Stadiin", "Åbossa"). Alle nelikirjaimiset lyhenteet tunnistetaan vain isolla alkukirjaimella.
 */
const ALIASES = {
  hesa: 'Helsinki', stadi: 'Helsinki', stad: 'Helsinki', hki: 'Helsinki', helsingfors: 'Helsinki',
  tampesteri: 'Tampere', tre: 'Tampere', tammerfors: 'Tampere',
  tku: 'Turku', abo: 'Turku', turu: 'Turku', lahde: 'Lahti', lahte: 'Lahti', // astevaihtelun vartalot (turussa, lahdessa)
  rova: 'Rovaniemi', roi: 'Rovaniemi',
  jkl: 'Jyväskylä', jyska: 'Jyväskylä', jyskä: 'Jyväskylä',
  lappee: 'Lappeenranta', villmanstrand: 'Lappeenranta',
  hamis: 'Hämeenlinna',
  kouvo: 'Kouvola',
  uleaborg: 'Oulu', vasa: 'Vaasa', borga: 'Porvoo', hango: 'Hanko', mariehamn: 'Maarianhamina', ahvenanmaa: 'Maarianhamina', aland: 'Maarianhamina',
  nyslott: 'Savonlinna', bjorneborg: 'Pori',
};

/** Taivutuspäätteet, pisimmät ensin. Pääte poistetaan, ja jäljelle jäävää vartaloa verrataan paikan nimeen. */
const CASE_SUFFIXES = [
  'issa', 'issä', 'ista', 'istä', 'illa', 'illä', 'ille', 'ilta', 'iltä',
  'ssa', 'ssä', 'sta', 'stä', 'lla', 'llä', 'lta', 'ltä', 'lle', 'ksi', 'iin', 'hin', 'seen', 'een',
  'na', 'nä', 'ta', 'tä', 'an', 'än', 'en', 'in', 'on', 'un', 'yn', 'ön', 'n', 'a', 'ä',
];

/** Puhekielen paikkapäätteet ("Turus", "Oulust", "Tampereel", "Rovaniemelt"). Vain isolla alkukirjaimella kirjoitetuille sanoille. */
/** Pienellä alkukirjaimella kirjoitettu sana tulkitaan paikaksi vain paikallissijoissa; genetiivi/partitiivi ("lapsen", "kotona") vaatisi isoa alkukirjainta. */
const LOCATIVE_SUFFIXES = ['issa', 'issä', 'ista', 'istä', 'illa', 'illä', 'ille', 'ilta', 'iltä', 'ssa', 'ssä', 'sta', 'stä', 'lla', 'llä', 'lta', 'ltä', 'lle', 'iin', 'hin', 'seen', 'uun', 'oon', 'aan', 'ään', 'yyn', 'öön'];

const COLLOQ_SUFFIXES = ['st', 'lt', 's', 'l'];

const lower = (s) => String(s).toLocaleLowerCase('fi-FI');
/** Pienaakkoset ilman ääkkösiä: vertailu kestää puuttuvat diakriitit ("jyvaskylassa"). */
const fold = (s) => lower(s).replace(/[äå]/g, 'a').replace(/ö/g, 'o');

const ENTRIES = [
  ...FI_CITIES.map(([name, lat, lon, region]) => ({ name, key: fold(name), lat, lon, region, country: 'Suomi' })),
  ...FI_EXTRA.filter(([n]) => !FI_CITIES.some((c) => c[0] === n)).map(([name, lat, lon, region]) => ({ name, key: fold(name), lat, lon, region, country: 'Suomi' })),
  ...FOREIGN_CITIES.map(([name, lat, lon, region, country]) => ({ name, key: fold(name), lat, lon, region, country })),
];
const BY_NAME = new Map(ENTRIES.map((e) => [e.name, e]));

function commonPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** Damerau-Levenshtein-etäisyys (vierekkäisten merkkien vaihto = 1). */
function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}

const ALIAS_ENDINGS = ['', 'ssa', 'sta', 'lla', 'lta', 'lle', 'n', 'a', 'an', 'in', 'iin', 'ista', 'issa', 'illa', 'ille', 's', 'st', 'l', 'lt'];

function asPlace(c) {
  return { name: c.name, region: c.region, country: c.country, lat: c.lat, lon: c.lon, offline: true };
}

/**
 * Tunnistaa taivutetun paikannimen tunnetuista paikoista. Palauttaa paikan tai null.
 * Taivutus voi muuttaa nimen loppua ("Turku" -> "Turussa", "Lahti" -> "Lahdessa", "Helsinki" -> "Helsingissä"),
 * joten sanasta poistetaan taivutuspääte ja vartaloa verrataan nimeen alkuosan perusteella.
 * Vertailu tehdään ilman ääkkösiä. Lisäksi tunnistetaan lempinimet ("Hesa", "Stadi", "Åbo"), puhekielen päätteet ("Turus")
 * ja yhden merkin kirjoitusvirheet ("Rovanimellä").
 */
function findOffline(word) {
  const raw = String(word).trim();
  const w = fold(raw);
  if (w.length < 3) return null;
  const capital = /^\p{Lu}/u.test(raw);

  // 1) lempinimet ja ruotsinkieliset nimet
  for (const [a, canon] of Object.entries(ALIASES)) {
    const key = fold(a);
    if (key.length <= 3 && !capital) continue;
    if (w === key || (w.startsWith(key) && ALIAS_ENDINGS.includes(w.slice(key.length)) && (capital || key.length >= 4))) {
      const c = BY_NAME.get(canon);
      if (c) return asPlace(c);
    }
  }

  // 2) taivutetut perusnimet
  let best = null;
  for (const c of ENTRIES) {
    let score = -1;
    if (w === c.key) score = 1000;
    else {
      const sufs = capital ? [...CASE_SUFFIXES.map(fold), ...COLLOQ_SUFFIXES] : LOCATIVE_SUFFIXES.map(fold);
      for (const suf of sufs) {
        if (w.length - suf.length < 3 || !w.endsWith(suf)) continue;
        const stem = w.slice(0, -suf.length);
        const cp = commonPrefix(stem, c.key);
        if (cp < Math.max(3, c.key.length - (c.key.length <= 5 ? 1 : 2))) continue;
        if (stem.length > c.key.length + 2 || stem.length < c.key.length - 3) continue;
        score = Math.max(score, cp * 10 - Math.abs(stem.length - c.key.length) - (COLLOQ_SUFFIXES.includes(suf) ? 1 : 0));
      }
    }
    if (score >= 0 && (!best || score > best.score)) best = { score, c };
  }
  if (best) return asPlace(best.c);

  // 3) yhden merkin kirjoitusvirhe (pitkät nimet, vähintään seitsemän merkin sana)
  if (w.length >= 7) {
    let bestT = null;
    for (const c of ENTRIES) {
      if (c.key.length < 6) continue;
      for (const suf of ['', ...CASE_SUFFIXES.map(fold)]) {
        if (suf && !w.endsWith(suf)) continue;
        const stem = suf ? w.slice(0, -suf.length) : w;
        if (stem.length < 5 || stem[0] !== c.key[0] || stem[1] !== c.key[1]) continue;
        const d = Math.min(editDistance(stem, c.key), editDistance(stem, c.key.slice(0, -1)), editDistance(stem, c.key.slice(0, -2)));
        if (d <= 1 && (!bestT || d < bestT.d)) bestT = { d, c };
      }
    }
    if (bestT) return asPlace(bestT.c);
  }
  return null;
}
return { FOREIGN_CITIES, FI_EXTRA, ALIASES, CASE_SUFFIXES, LOCATIVE_SUFFIXES, COLLOQ_SUFFIXES, lower, fold, editDistance, findOffline };
})();

// ---- nlu.js ----
__m['nlu'] = (() => {
// nlu.js: suomenkielisen sääkysymyksen jäsennys: aihe, ajankohta, paikka ja mallit.
// Puhdasta koodia: ei verkkokutsuja eikä kelloa. Ajankohdat jäsennetään symbolisesti ja answer.js ratkaisee ne
// ennusteen ja kellon perusteella.
//
// Suomen taivutus muuttaa sanojen loppua mutta harvoin alkua ("sataa", "sadetta", "sateella"),
// joten avainsanat tunnistetaan sanojen alkuosista.

const { CASE_SUFFIXES, findOffline } = __m['gazetteer'];

const lc = (s) => String(s ?? '').toLocaleLowerCase('fi-FI');

/** Sanat ilman välimerkkejä. Kellonajat ja päivämäärät ("15:30", "18.10") pysyvät yhtenä sanana. */
function tokenize(text) {
  return String(text ?? '').match(/[\p{L}\p{N}]+(?:[.:]\p{N}+)*/gu) || [];
}

/**
 * Sanan alkuosa: regexp, joka täsmää sanan (tai sanayhdistelmän) alkuun normalisoidussa tekstissä.
 * Kun kysymyksessä ei ole yhtään ääkköstä (FOLD), sanastoa kokeillaan myös ilman ääkkösiä ("tanaan", "lampotila", "yolla").
 * "sää" ja "yö" käsitellään erikseen, koska "saa" ("saako", "saari") ja "yo" ("york") ovat muita sanoja.
 */
let FOLD = false;
const FOLD_SAA = 'saa(?= |$)|saan(?= |$)|saata(?= |$)|saasta|saassa|saalle|saaenn|saatiedot';
const foldSrc = (a) => a.replace(/[äå]/g, 'a').replace(/ö/g, 'o');
class LexRe extends RegExp {
  constructor(alts, extra = []) {
    super('(?:^| )(?:' + alts.join('|') + ')', 'u');
    const f = alts.filter((a) => !/^(?:sää|yö)/.test(a)).map(foldSrc).concat(extra);
    if (alts.includes('sää')) f.push(FOLD_SAA);
    this.alt = f.length ? new RegExp('(?:^| )(?:' + f.join('|') + ')', 'u') : null;
  }
  exec(s) {
    return super.exec(s) || (FOLD && this.alt ? this.alt.exec(s) : null);
  }
}
const S = (alts, extra) => new LexRe(alts, extra);

// ---------- Aiheet ----------

const SUN_PHRASES = [
  'aurinko[a-zåäö]* (?:nou|las)',
  '(?:nou|las)[a-zåäö]* aurinko',
  'auringon ?(?:nou|las)',
  'pime',
  'hämär',
  'valois',
  'päivän pituu',
  'päivän kesto',
  'päivä on pitkä',
  'pitkä päivä',
  'kuinka pitkä (?:on )?päivä',
  'päivä pitene',
  'päivä lyhene',
  'kaamos',
  'yötön',
];
const SUN_RE = S(SUN_PHRASES);
const SUN_RE_ALL = new RegExp('(?:^| )(?:' + SUN_PHRASES.join('|') + ')[a-zåäö]*', 'gu');

const INTENT_RES = [
  ['snow', S(['lum', 'lunt', 'ensilum', 'ränt', 'rännä', 'pyry', 'hanki'])],
  [
    'rain',
    S(['sade', 'sate(?!l)', 'sataa', 'satako', 'sataisi', 'satanut', 'satava', 'kuuro', 'tihku', 'ripott', 'kaatosa', 'vesisa', 'vettä', 'kastu', 'pouta', 'kuiv', 'märk']),
  ],
  ['thunder', S(['ukkos', 'ukkon', 'ukkone', 'ukkose', 'ukon', 'salam(?!i)', 'jyrin', 'jyrise', 'rake(?:i|e)'])],
  [
    'ice',
    S(['liukas', 'liukk', 'liukuest', 'nasta(?:t|n)', 'nastoj', 'jäinen', 'jäiset', 'jäis', 'jäässä', 'jäätäv', 'kelirikko', 'huurre', 'kuura', 'halla', 'hallaa']),
  ],
  [
    'temp',
    S([
      'lämp', 'lämm(?!it)', 'kylm', 'pakka(?!us)', 'aste', 'plus', 'miinus', 'miinuks', 'viile', 'kuum(?!e(?: |$|e|tt))', 'helle', 'palel', 'hiki',
      'jäätyy', 'jäätyk', 'jäätyv', 'tuntuu', 'nollakel', 'nollan', 'kasvi', 'kukka', 'taimi',
    ]),
  ],
  ['wind', S(['tuul', 'puusk', 'myrsk', 'lumimyrsk', 'navak', 'tyyn', 'rajuil'])],
  [
    'clothing',
    S([
      'pukeu', 'pukis', 'pukea', 'pukei', 'vaate', 'takki', 'takk', 'tak(?:in|is|il|it)(?= |$)', 'tak(?:iss|ist|ill)', '(?:farkku|toppa|talvi|kuori|välikausi|nahka|untuva|tuuli)tak',
      'parka', 'pipo', 'hansk', 'lapas', 'kenkä', 'kengä', 'kenki', 'talvikeng', 'tennar', 'lenkkar', 'lenkkitoss', 'saapp', 'saapa', 'kumisaap', 'kumpp', 'paita',
      'shortse', 'shortsi', 'sortsi', 'housu', 'päälle', 'kerrospuk', 'toppa', 'kuoritakki', 'villa', 'huppar', 'hupari', 'kaulur', 'kaulaliin', 'sukat', 'hattu', 'lakki',
    ]),
  ],
  [
    'outdoor',
    S([
      'lenkk(?!ar|itoss)', 'lenki', 'juoks', 'juost', 'juokse', 'pyöräil', 'pyörä', 'kävel', 'ulkoil', 'retk', 'patikoi', 'patikka', 'vaelt', 'hiihto', 'hiihtä',
      'uimaan', 'uida', 'uinti', 'uimakel', 'grill', 'piknik', 'kalast', 'kalaan', 'ulos', 'rannal', 'ranta', 'golf', 'marjaan', 'marjast', 'sienest', 'sienikel',
      'pyykk', 'pyykin', 'pyykit', 'kuivata', 'kuivaus', 'ripusta', 'nurmik', 'ruohon', 'pihaa', 'pihan', 'pihatyö', 'kastel', 'maalata', 'maalaus', 'aidan', 'haravoi',
      'pestä', 'pesu', 'ikkunanpes',
      'paras (?:hetki|aika|ajankohta|sää|päivä|keli)', 'sopiva (?:aika|hetki|päivä)', 'milloin (?:kannattaa|voi|voisi|olisi|pääsee)',
      'kannattaako (?:lähteä|mennä)',
    ]),
  ],
  ['sun', SUN_RE],
  ['sky', S(['pilv', 'aurinko', 'auringo', 'selke', 'paista', 'sumu', 'sumui', 'utu', 'harmaa', 'taivas', 'tähti', 'tähd'])],
  ['air', S(['kosteu', 'kostea', 'ilmankosteu', 'ilmanpain', 'paine', 'hpa', 'barometr'])],
  [
    'models',
    S([
      'mallit', 'mallien', 'mallia', 'malli', 'säämall', 'sääpalv', 'ecmwf', 'ifs', 'icon', 'dwd', 'gfs', 'noaa', 'gem(?!ini)', 'ukmo',
      'met office', 'met nordic', 'metno', 'nordic', 'norway', 'arpege', 'météo', 'meteo', 'fmi', 'ilmatieteen', 'lähde(?: |$)', 'lähteet', 'lähteen', 'lähteit', 'lähteestä',
      'datasta', 'datan', 'data', 'palvelu',
    ]),
  ],
  ['confidence', S(['luotettav', 'varma', 'varmu', 'epävar', 'tarkk', 'hajont', 'eri mieltä', 'samaa mieltä', 'yhtä mieltä', 'yksimiel', 'ristiriit'])],
  ['tyres', S(['rengas', 'renkaa', 'renkaid', 'talvirenk', 'kesärenk', 'nastarenk', 'kitkarenk'])],
  ['drive', S(['ajokel', 'ajaa', 'ajamaan', 'ajelu', 'autolla', 'mökkimatk'])],
  ['moon', S(['täysikuu', 'uusikuu', 'täydenkuun', 'kuun (?:vaihe|nousu|lasku)', 'kuu (?:nousee|laskee|näkyy|paistaa)', 'milloin kuu', 'kuutamo'])],
  ['aurora', S(['revontul', 'aurora', 'northern'])],
  ['uv', S(['aurinkorasv', 'uv(?: |$)', 'auringonpolt', 'ruskett', 'aurinkosuoj', 'palaako', 'iho pala', 'ihon pala'])],
  ['icecover', S(['kantaa(?:ko)? jää', 'jään (?:paksuu|kanta)', 'jäällä'])],
  ['pollen', S(['siitepöl', 'allergi'])],
  ['aqi', S(['ilmanlaat', 'aqi', 'pienhiukk', 'ilmansaast'])],
  [
    'summary',
    S(['sää', 'sään', 'säätä', 'säästä', 'säässä', 'sääl', 'sääenn', 'sääti', 'ennuste', 'ennusta', 'yhteenve', 'tulossa', 'miltä näyttää', 'millai', 'minkälai', 'millane', 'minkälane', 'keli', 'ilma(?:t|a|ssa|sta|ja)?(?= |$)', 'ilmoj']),
  ],
  ['help', S(['apua', 'auta', 'apu(?= |$)', 'ohje', 'mitä osaat', 'mitä voit', 'mitä voin kysy', 'mitä voi kysy', 'osaatko', 'komento'])],
];

// Aiheet, joiden avainsanat eivät saa käynnistää paikkahakua (sanat, jotka näyttävät paikannimien taivutusmuodoilta)
// isLexical tarkistaa sanat suoraan INTENT_RES-taulukosta (myös ilman ääkkösiä, kun FOLD on päällä)

const TIME_LEX = S(
  [
    'tänään', 'tänä', 'huomen', 'huomis', 'ylihuomi', 'eilen', 'eilis', 'nyt', 'illa', 'ilta', 'aamu', 'aamup', 'yö', 'päivä', 'päivän', 'päiviä',
    'keskipäiv', 'iltapäiv', 'viikonlop', 'viikko', 'viikon', 'viikol', 'tunti', 'tunnin', 'tuntia', 'klo', 'kello', 'ensi', 'ens', 'seuraava', 'seuraavi',
    'lähitun', 'lähipäiv', 'lauantai', 'sunnuntai', 'maanantai', 'tiistai', 'keskiviikko', 'torstai', 'perjantai', 'pian', 'kohta',
    'päästä', 'kuluttua', 'jälkeen', 'asti', 'saakka', 'mennessä', 'aikana', 'viikkoa', 'kuukau', 'aamuy', 'aamul', 'yöl', 'yöst', 'vkl', 'vkonlop', 'vielä', 'edelleen', 'maissa', 'aikaan', 'puoli',
  ],
  ['yolla', 'yosta', 'yoksi', 'yona', 'yo(?= |$)'],
);

const STOP = new Set(
  (
    'mitä miten millai millainen minkälai missä milloin koska onko onkohan tuleeko tuleekohan voiko kannattaako pitääkö pitäisikö täällä tässä siellä ' +
    'sinne tänne kotona ulkona sisällä paljon paljonko kuinka vähän ja tai vai että kun jos kuin sekä mutta myös entä entäs sitten vielä jo kerro ' +
    'kertoisitko anna näytä haluan haluaisin tietää tarvitsen tarvitsenko saako saisiko hei moi moikka terve kiitos kiitti joo kyllä okei ok sitä ' +
    'tätä mikä mitkä kuka miksi mihin mistä mille kenen koko lähellä alueella seudulla kaupungissa maassa paikassa kylässä tarkoitan tarkoittaa ' +
    'gemini claude google openmeteo open meteo sääly sääälyn mieltä tulossa tulee tulevat tuleva odotettavissa luvassa ennustetaan lupaa näyttää ' +
    'ollut olla ole olisi oli ovat ovatko sanoo sanoa ennustaa kertoo kertoa pitää pitäisi kannattaa voin voiko voisi voisiko saa saisi paljon ' +
    'ihan hyvin huonosti oikein aika tosi vähän yhtään lainkaan lisää enemmän vähemmän taas vaikka koska siksi sillä siis eli tai ettei vai'
  ).split(' '),
);

for (const w of 'will would could can should does did are was were its the and for how what when where this that with you your please need needs going get gets feel feels like outside inside'.split(' ')) STOP.add(w);

const isLexical = (w) => INTENT_RES.some(([, re]) => re.test(w)) || TIME_LEX.test(w) || STOP.has(w);

// ---------- Ajankohta ----------

const WEEKDAYS = ['sunnuntai', 'maanantai', 'tiistai', 'keskiviikko', 'torstai', 'perjantai', 'lauantai'];
const MONTHS = ['tammi', 'helmi', 'maalis', 'huhti', 'touko', 'kesä', 'heinä', 'elo', 'syys', 'loka', 'marras', 'joulu'];
// Juhlapyhät: kiinteät päivämäärät tai laskettavat (juhannus, pääsiäinen ratkaistaan answer.js:ssä nykyhetken mukaan)
const HOLIDAYS = [
  [S(['jouluaatto']), { type: 'dates', list: [[24, 12]], label: 'jouluaattona' }],
  [S(['joulupäiv']), { type: 'dates', list: [[25, 12]], label: 'joulupäivänä' }],
  [S(['tapaninpäiv']), { type: 'dates', list: [[26, 12]], label: 'tapaninpäivänä' }],
  [S(['joulu(?:na|n|a|lle|sta)?(?: |$)']), { type: 'dates', list: [[24, 12], [25, 12], [26, 12]], label: 'jouluna' }],
  [S(['uudenvuodenaatto', 'uudenvuoden aatto', 'silvest']), { type: 'dates', list: [[31, 12]], label: 'uudenvuodenaattona' }],
  [S(['uudenvuodenpäiv', 'uudenvuoden päiv', 'uutena vuotena', 'uusivuosi', 'uudenvuoden']), { type: 'dates', list: [[1, 1]], label: 'uudenvuodenpäivänä' }],
  [S(['vappu', 'vapun']), { type: 'dates', list: [[30, 4], [1, 5]], label: 'vappuna' }],
  [S(['itsenäisyyspäiv']), { type: 'dates', list: [[6, 12]], label: 'itsenäisyyspäivänä' }],
  [S(['juhannu']), { type: 'juhannus', label: 'juhannuksena' }],
  [S(['pääsiäi', 'pitkäperjantai']), { type: 'easter', label: 'pääsiäisenä' }],
];

// Vuorokaudenajat tärkeysjärjestyksessä (pitempi sana ennen lyhyempää: aamuyö/aamupäivä ennen aamua)
const PART_TESTS = [
  [S(['aamuyö', 'aamuyl']), 'aamuyo'],
  [S(['aamupäiv']), 'aamupaiva'],
  [S(['aamu']), 'aamu'],
  [S(['keskipäiv']), 'keskipaiva'],
  [S(['iltapäiv']), 'iltapaiva'],
  [S(['illa', 'ilta(?!päiv)', 'illal', 'ilaal', 'ilal']), 'ilta'],
  [S(['päivällä', 'päiväsaik']), 'paiva'],
  [S(['yö(?!tön)'], ['yolla', 'yosta', 'yoksi', 'yona', 'yo(?= |$)']), 'yo'],
];

const NUMBER_WORDS = { puolen: 0, yhden: 1, parin: 2, kahden: 2, kolmen: 3, neljän: 4, viiden: 5, kuuden: 6, pari: 2, kaksi: 2, kolme: 3, neljä: 4, viisi: 5, kuusi: 6, seitsemän: 7 };

/**
 * Jäsentää ajankohdan symboliseksi kuvaukseksi:
 * { day: {type:'offset', n} | {type:'weekday', wd, next} | {type:'date', d, m, y} | {type:'weekend'} | {type:'week', which} | {type:'span', n} |
 *          {type:'month', m} | {type:'dates', list, label} | {type:'juhannus'|'easter', label} | {type:'far', label} | null,
 *   part: 'aamu'|'aamupaiva'|'keskipaiva'|'paiva'|'iltapaiva'|'ilta'|'yo'|null, parts?: [part, part, ...] (kun kysytään useampaa, "aamulla ja illalla"),
 *   hour, hourTo, ahead, now, soon, past, explicit }
 */
function parseWhen(raw, { nowHour = null } = {}) {
  let text = lc(raw);
  const when = { day: null, part: null, hour: null, hourTo: null, ahead: null, now: false, soon: false, past: false, explicit: false };

  // kellonaika: "klo 15", "kello 8.30", "klo 14-18", "15:30"
  const km = /(?:klo|kello)\s*(\d{1,2})(?:[.:](\d{2}))?(?:\s*(?:-|–|—|…|\.\.)\s*(?:klo\s*)?(\d{1,2})(?:[.:](\d{2}))?)?/u.exec(text);
  if (km && +km[1] <= 24) {
    when.hour = +km[1] % 24;
    if (km[3] != null && +km[3] <= 24) when.hourTo = +km[3] % 24 || 24;
    text = text.replace(km[0], ' ');
  } else {
    const cm = /(?:^|\s)(\d{1,2}):(\d{2})(?!\d)/u.exec(text);
    if (cm && +cm[1] <= 23 && +cm[2] <= 59) {
      when.hour = +cm[1];
      text = text.replace(cm[0], ' ');
    }
  }

  // "2 tunnin päästä", "tunnin päästä", "puolen tunnin päästä"
  const am = /(?:^|\s)(?:(\d{1,2}|puolen|parin|kahden|kolmen|neljän|viiden|kuuden)\s+)?tunnin\s+(?:päästä|kuluttua)/u.exec(text);
  if (am) {
    when.ahead = am[1] == null ? 1 : /^\d/.test(am[1]) ? +am[1] : (NUMBER_WORDS[am[1]] ?? 1);
    text = text.replace(am[0], ' ');
  }

  // päivämäärä: "18.10.", "18.10.2026", "20. lokakuuta"
  const dm = /(?:^|\s)(\d{1,2})\.\s?(\d{1,2})\.?(?:\s?(\d{4}))?(?!\d)/u.exec(text);
  if (dm && +dm[1] >= 1 && +dm[1] <= 31 && +dm[2] >= 1 && +dm[2] <= 12) {
    when.day = { type: 'date', d: +dm[1], m: +dm[2], y: dm[3] ? +dm[3] : null };
    text = text.replace(dm[0], ' ');
  } else {
    const mm = new RegExp('(?:^|\\s)(\\d{1,2})\\.?\\s*(' + MONTHS.join('|') + ')kuu', 'u').exec(text);
    if (mm && +mm[1] >= 1 && +mm[1] <= 31) {
      when.day = { type: 'date', d: +mm[1], m: MONTHS.indexOf(mm[2]) + 1, y: null };
      text = text.replace(mm[0], ' ');
    }
  }

  // "kolme päivää", "5 päivän ennuste", "seuraavat päivät"
  const N = tokenize(text).join(' ');
  const has = (re) => re.test(N);
  const sm = /(?:^| )(\d{1,2}|pari|kolme|neljä|viisi|kuusi|seitsemän)\s+(?:päivän|päivää|vuorokauden|vuorokautta|vrk)/u.exec(N);
  // "kolmen päivän päästä", "viikon päästä", viikonpäivän lyhenne ("pe aamuna", "la-iltana")
  const dm2 = /(?:^| )(\d{1,2}|pari|parin|kaksi|kahden|kolme|kolmen|neljä|neljän|viisi|viiden|kuusi|kuuden)\s+(?:päivän|vuorokauden)\s+(?:päästä|kuluttua)/u.exec(N);
  const weekAhead = /(?:^| )viikon\s+(?:päästä|kuluttua)/u.test(N);
  const abbr = /(?:^| )(ma|ti|ke|to|pe|la|su)(?= (?:aamu|aamup|aamuy|iltap|ilta|illa|yö|päivä|päivällä|klo|kello|\d))/u.exec(N);
  // kellonaika sanoin: "kuudelta", "puoli seitsemältä", "iltakuudelta", "yhdeksän maissa" (aamu/ilta päätellään sanasta tai nykyhetkestä)
  if (when.hour == null && when.ahead == null) {
    const ab = /(?:^| )(puoli )?(ilta|aamu)?(yhdeltätoista|kahdeltatoista|yhdeltä|kahdelta|kolmelta|neljältä|viideltä|kuudelta|seitsemältä|kahdeksalta|yhdeksältä|kymmeneltä)(?= |$)/u.exec(N);
    const nm = /(?:^| )(yksitoista|kaksitoista|yksi|kaksi|kolme|neljä|viisi|kuusi|seitsemän|kahdeksan|yhdeksän|kymmenen) (?:maissa|aikaan|tienoilla)(?= |$)/u.exec(N);
    const num = ab ? CLOCK_ABL[ab[3]] : nm ? CLOCK_NOM[nm[1]] : null;
    if (num != null) {
      let h = ab?.[1] ? (num === 1 ? 12 : num - 1) : num;
      const pm = ab?.[2] === 'ilta' || /(?:^| )(?:illa|ilta|iltap)/u.test(N);
      const am = ab?.[2] === 'aamu' || /(?:^| )(?:aamu|aamup|aamuy)/u.test(N);
      if (pm) h = h < 12 ? h + 12 : h;
      else if (!am) {
        const opts = h < 12 ? [h, h + 12] : [h];
        h = nowHour == null ? (h <= 6 ? h + 12 : h) : (opts.find((x) => x >= nowHour) ?? opts[0]);
      }
      when.hour = h % 24;
    }
  }

  // kuukausi ("joulukuussa"), vuodenaika ("kesällä"), "ensi vuonna" ja juhlapyhät: ennuste kattaa vain viikon, joten nämä ratkaistaan answer.js:ssä
  if (!when.day) {
    const mi = MONTHS.findIndex((m) => has(S([`${m}kuu`])));
    const far = /(?:^| )ensi (?:vuonna|vuoden|kuussa|kuun|kesänä|talvena|syksynä|keväänä)/u.exec(N);
    const season = /(?:^| )(?:kesällä|kesänä|kesäisin|kesälle|talvella|talvena|talvisin|talvelle|syksyllä|syksynä|syksyisin|keväällä|keväänä|keväisin)(?= |$)/u.exec(N);
    const holiday = HOLIDAYS.find(([re]) => re.test(N));
    if (mi >= 0) when.day = { type: 'month', m: mi + 1 };
    else if (far) when.day = { type: 'far', label: far[0].trim() };
    else if (season) when.day = { type: 'far', label: season[0].trim() };
    else if (holiday) when.day = { ...holiday[1] };
  }
  if (!when.day) {
    const wd = WEEKDAYS.findIndex((w) => has(S([w])));
    if (dm2) when.day = { type: 'offset', n: /^\d/.test(dm2[1]) ? +dm2[1] : (NUMBER_WORDS[dm2[1]] ?? 1) };
    else if (weekAhead) when.day = { type: 'offset', n: 7 };
    else if (wd >= 0) when.day = { type: 'weekday', wd, next: has(S(['ensi', 'ens(?= |$)', 'seuraava'])) };
    else if (abbr) when.day = { type: 'weekday', wd: ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'].indexOf(abbr[1]), next: false };
    else if (has(S(['viikonlop', 'vkl', 'vkonlop']))) when.day = { type: 'weekend' };
    else if (has(S(['ensi viikko', 'ensi viikon', 'ensi viikol', 'ensiviikko', 'ens viikko', 'ens viikon', 'ens viikol', 'ensviikko', 'ensviikol', 'seuraava viikko', 'seuraavalla viikolla']))) when.day = { type: 'week', which: 'next' };
    else if (sm) when.day = { type: 'span', n: Math.min(7, /^\d/.test(sm[1]) ? +sm[1] : (NUMBER_WORDS[sm[1]] ?? 3)) };
    else if (has(S(['viikon', 'koko viikko', 'tällä viikolla', 'viikolla', 'seuraavat viikko']))) when.day = { type: 'week', which: 'this' };
    else if (has(S(['lähipäivi', 'tulevina päivinä', 'tulevat päivät', 'seuraavina päivinä', 'seuraavat päivät', 'seuraavien päivien']))) when.day = { type: 'span', n: 4 };
    else if (has(S(['ylihuom']))) when.day = { type: 'offset', n: 2 };
    else if (has(S(['huomen', 'huomis']))) when.day = { type: 'offset', n: 1 };
    else if (has(S(['tänään', 'tänä', 'tämän päivän', 'tänäpäivänä']))) when.day = { type: 'offset', n: 0 };
  }
  when.past = has(S(['eilen', 'eilis', 'toissa']));
  if (when.past && !when.day) when.day = { type: 'offset', n: has(S(['toissa'])) ? -2 : -1 };

  // vuorokaudenaika (myös yhdyssanat: huomenaamuna, huomisiltana)
  const Np = N.replace(/(?:^| )(?:kummalla|millä|mille|minä|kummalle) päiv\S*/gu, ' '); // "kummalla päivällä" = kumpana päivänä, ei vuorokaudenaika
  const tom = /(?:^| )huom(?:is|en)(?:en )?(aamupäiv|iltapäiv|aamuyö|aamu|ilta|yö)/u.exec(N);
  if (tom) {
    when.part = { aamupäiv: 'aamupaiva', iltapäiv: 'iltapaiva', aamuyö: 'aamuyo', aamu: 'aamu', ilta: 'ilta', yö: 'yo' }[tom[1]];
    if (!when.day) when.day = { type: 'offset', n: 1 };
  } else {
    const hit = PART_TESTS.find(([re]) => re.test(Np));
    if (hit) when.part = hit[1];
    // "aamulla ja illalla": jokainen mainittu vuorokaudenaika vastataan erikseen
    if (when.hour == null) {
      const keys = [];
      for (const tok of Np.split(' ')) {
        const h = PART_TESTS.find(([re]) => re.test(tok));
        if (h && !keys.includes(h[1])) keys.push(h[1]);
      }
      if (keys.length > 1) when.parts = keys.slice(0, 3);
    }
  }

  when.now = has(S(['nyt', 'juuri nyt', 'tällä hetkellä', 'hetkellä', 'vielä', 'jo(?= |$)', 'edelleen', 'yhä(?= |$)']));
  when.soon = has(S(['lähitun', 'seuraavina tunteina', 'seuraavat tunnit', 'pian', 'hetken päästä', 'kohta', 'lähiaikoina']));
  when.explicit = Boolean(when.day || when.part || when.hour != null || when.ahead != null || when.now || when.soon || when.past);
  return when;
}

// ---------- Aktiviteetit ja mallit ----------

const ACTIVITIES = [
  [S(['lenkk(?!ar|itoss)', 'lenki', 'juoks', 'juost', 'juokse']), { id: 'run', to: 'lenkille' }],
  [S(['pyöräil', 'pyörä']), { id: 'bike', to: 'pyöräilemään' }],
  [S(['kävel']), { id: 'walk', to: 'kävelylle' }],
  [S(['retk', 'patikoi', 'patikka', 'vaelt']), { id: 'hike', to: 'retkelle' }],
  [S(['hiihto', 'hiihtä']), { id: 'ski', to: 'hiihtämään' }],
  [S(['uimaan', 'uida', 'uinti', 'uimakel']), { id: 'swim', to: 'uimaan' }],
  [S(['grill']), { id: 'grill', to: 'grillaamaan' }],
  [S(['piknik']), { id: 'picnic', to: 'piknikille' }],
  [S(['kalast', 'kalaan']), { id: 'fish', to: 'kalaan' }],
  [S(['pyykk', 'pyykin', 'pyykit', 'kuivata', 'kuivaus', 'ripusta']), { id: 'laundry', to: 'pyykin kuivatukseen' }],
  [S(['nurmik', 'ruohon', 'pihaa', 'pihan', 'pihatyö', 'kastel', 'maalata', 'maalaus', 'aidan', 'haravoi']), { id: 'lawn', to: 'pihatöihin' }],
  [S(['pestä', 'pesu', 'ikkunanpes']), { id: 'carwash', to: 'pesuun' }],
  [S(['golf']), { id: 'golf', to: 'golfaamaan' }],
  [S(['rannal', 'ranta']), { id: 'beach', to: 'rannalle' }],
  [S(['marjaan', 'marjast', 'sienest', 'sienikel']), { id: 'forage', to: 'metsään' }],
  [S(['ulkoil', 'ulos']), { id: 'outside', to: 'ulkoilemaan' }],
];

const MODEL_ALIASES = [
  ['ecmwf', S(['ecmwf', 'ifs'])],
  ['metno', S(['met nordic', 'metno', 'nordic', 'met norway', 'norway'])],
  ['icon', S(['icon', 'dwd'])],
  ['arpege', S(['arpege', 'météo', 'meteo'])],
  ['ukmo', S(['ukmo', 'met office'])],
  ['gfs', S(['gfs', 'noaa'])],
  ['gem', S(['gem(?!ini)', 'kanadan', 'environment canada'])],
  ['fmi', S(['fmi', 'ilmatieteen'])],
];

// ---------- Paikat ----------

/**
 * Hakusanat, joilla taivutettu paikannimi kokeillaan paikkahaussa. Taivutus muuttaa nimen loppua
 * ("Kemijärvi" -> "Kemijärvellä", "Lahti" -> "Lahdessa"), joten pääte poistetaan ja kokeillaan tavallisimmat perusmuodot.
 */
function placeQueries(word) {
  const w = lc(word);
  const out = [];
  const add = (q) => {
    if (q.length >= 3 && !out.includes(q)) out.push(q);
  };
  const suf = CASE_SUFFIXES.find((s) => s.length >= 2 && w.length - s.length >= 3 && w.endsWith(s));
  if (suf) {
    const stem = w.slice(0, -suf.length);
    if (/e$/u.test(stem)) {
      add(stem.slice(0, -1) + 'i'); // Kemijärve- -> Kemijärvi
      if (/de$/u.test(stem)) add(stem.slice(0, -2) + 'ti'); // Lahde- -> Lahti
    }
    add(stem);
    add(stem.replace(/([aeiouyäö])\1$/u, '$1'));
    add(stem + 'i');
  }
  add(w);
  if (!suf && w.length > 4) add(w.slice(0, -1));
  return out.slice(0, 5).map((q) => q.charAt(0).toUpperCase() + q.slice(1));
}

/**
 * Löytää kysymyksestä mahdolliset paikannimet:
 * { word, offline?: paikka, strong: boolean, queries?: [...] }. Tunnetut paikat (gazetteer) ratkeavat heti ilman verkkoa.
 */
const CLITIC = /(?:ko|kö|kaan|kään|han|hän|pa|pä)$/u;

function placeCandidates(raw) {
  const toks = [...String(raw ?? '').matchAll(/[\p{L}\p{N}]+/gu)].map((m, i) => ({ text: m[0], lower: lc(m[0]), i }));
  const offline = [];
  const strong = [];
  const weak = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    // Kaksiosaiset nimet isolla alkukirjaimella ("New Yorkissa", "Las Palmasissa")
    const nx = toks[k + 1];
    if (nx && /^\p{Lu}/u.test(t.text) && /^\p{Lu}/u.test(nx.text)) {
      const two = findOffline(`${t.text} ${nx.text}`);
      if (two && /\s/u.test(two.name)) {
        offline.push({ word: `${t.text} ${nx.text}`, offline: two, strong: true });
        k++;
        continue;
      }
    }
    if (t.text.length < 3 || /^\p{N}+$/u.test(t.text) || isLexical(t.lower)) continue;
    const off = findOffline(t.text);
    if (off) {
      offline.push({ word: t.text, offline: off, strong: true });
      continue;
    }
    // Kysymys- ja kieltopäätteiset sanat ("Menisinkö", "Sataako") ovat verbejä, eivät paikkoja.
    if (t.lower.length >= 6 && /(?:ko|kö|kaan|kään)$/u.test(t.lower)) continue;
    const hasSuffix = CASE_SUFFIXES.some((s) => s.length >= 2 && t.lower.length - s.length >= 3 && t.lower.endsWith(s));
    const capital = /^\p{Lu}/u.test(t.text);
    if (capital && (t.i > 0 || toks.length <= 3 || hasSuffix)) strong.push({ word: t.text, strong: true, queries: placeQueries(t.text) });
    else if (!capital && hasSuffix && !CLITIC.test(t.lower) && /(?:ssa|ssä|lla|llä|lta|ltä|sta|stä|lle)$/u.test(t.lower) && t.lower.length >= 7) {
      weak.push({ word: t.text, strong: false, queries: placeQueries(t.text) });
    }
  }
  return [...offline.slice(0, 2), ...strong.slice(0, 2), ...weak.slice(0, 1)].slice(0, 3);
}

// ---------- Kokonaisjäsennys ----------

const GREETING = /^(?:hei|moi|moikka|moro|terve|hello|hi|hyvää (?:päivää|iltaa|huomenta|yötä)|päivää|huomenta|iltaa)(?: |$)/u;
const THANKS = /(?:^| )(?:kiitos|kiitti|kiitoksia|thanks|thx)(?: |$)/u;

/** Valitsee aiheet: poistaa päällekkäiset ja järjestää kysymyksen mukaiseen järjestykseen (enintään kolme). */
function detectIntents(N) {
  const NwithoutSun = N.replace(SUN_RE_ALL, ' ');
  const found = [];
  for (const [id, re] of INTENT_RES) {
    const m = re.exec(id === 'sky' ? NwithoutSun : N);
    if (m) found.push({ id, at: m.index });
  }
  const ids = new Set(found.map((f) => f.id));
  if (ids.has('snow') && ids.has('rain') && !/(?:^| )(?:vesisa|vettä)/u.test(N)) ids.delete('rain');
  if (ids.has('models') && ids.has('confidence')) {
    // "Ovatko mallit samaa mieltä?" kysyy yksimielisyyttä; mallien taulukko vain, jos mallit nimetään tai pyydetään näyttämään
    if (/(?:^| )(?:ecmwf|ifs|icon|dwd|gfs|noaa|gem|ukmo|arpege|fmi|nordic|näytä|listaa|kerro)/u.test(N)) ids.delete('confidence');
    else ids.delete('models');
  } else if (ids.has('models')) ids.delete('confidence');
  if (ids.has('clothing')) for (const k of ['temp', 'rain', 'snow', 'wind', 'ice', 'sky']) if (!(k === 'rain' && /(?:^| )(?:sate{1,2}nvarj|sadevarj)/u.test(N))) ids.delete(k); // pukeutumisvastaus kattaa nämä; sateenvarjokysymys saa oman vastauksensa
  if (ids.has('clothing') && ids.has('outdoor') && !/(?:^| )(?:paras|milloin|kannattaa)/u.test(N)) ids.delete('outdoor');
  if (ids.has('outdoor') && /(?:^| )(?:pyykk|pyykin|pyykit|kuivat|kuivuu|kuivaus|ripust)/u.test(N)) for (const k of ['rain', 'temp', 'sky', 'wind']) ids.delete(k);
  if (ids.has('outdoor') && ids.has('rain') && /(?:^| )(?:sate{1,2}nvarj|sadevarj|sadetak|sadevaat)/u.test(N)) ids.delete('outdoor');
  if (ids.has('ice') && ids.has('rain') && /(?:^| )jäätäv/u.test(N)) ids.delete('rain');
  if (ids.has('ice') && ids.has('outdoor') && !/(?:^| )(?:paras|milloin|kannattaa|voiko|voinko|saako|sopii)/u.test(N)) ids.delete('outdoor');
  if (ids.has('tyres')) ids.delete('drive');
  const SPEC = ['tyres', 'drive', 'moon', 'aurora', 'uv', 'icecover', 'pollen', 'aqi'];
  if (SPEC.some((k) => ids.has(k))) for (const k of [...ids]) if (!SPEC.includes(k)) ids.delete(k);
  if (ids.has('outdoor') && ids.has('sky') && !/(?:^| )(?:pilv|aurinkoi|selke)/u.test(N)) ids.delete('sky');
  if (ids.size > 1) ids.delete('summary');
  if (ids.size > 1) ids.delete('help');
  return found
    .filter((f) => ids.has(f.id))
    .sort((a, b) => a.at - b.at)
    .map((f) => f.id)
    .slice(0, 3);
}

/**
 * Jäsentää kysymyksen. Palauttaa:
 * { raw, N, intents, when, models, activity, places, flags: { followUp, askWhen, local, there, compare, umbrella, frost, fog, storm, greeting, thanks } }
 */
function parseQuestion(text, { nowHour = null } = {}) {
  const raw0 = String(text ?? '').trim();
  const raw = enToFi(raw0);
  FOLD = !/[äöåÄÖÅ]/u.test(raw);
  try {
    return { ...parseCore(raw, nowHour), raw: raw0 };
  } finally {
    FOLD = false;
  }
}

function parseCore(raw, nowHour) {
  const tokens = tokenize(lc(raw));
  const N = tokens.join(' ');
  const when = parseWhen(raw, { nowHour });
  const intents = detectIntents(N);
  const activity = ACTIVITIES.find(([re]) => re.test(N))?.[1] || null;
  const models = MODEL_ALIASES.filter(([, re]) => re.test(N)).map(([key]) => key);
  const flags = {
    followUp: /^(?:entä|entäs|ja|sitten|myös|mites|mutta|sama|samoin|ja entä)(?: |$)/u.test(N),
    quantify: /^(?:kuinka paljon|paljonko|montako|kuinka kauan|kauanko|milloin|mihin aikaan|koska)(?: |$)/u.test(N),
    askWhen: /(?:^| )(?:milloin|mihin aikaan|koska|mihin asti|kuinka kauan|kauanko)(?: |$)/u.test(N),
    local: /(?:^| )(?:täällä|tässä|tällä paikkakunnalla|nykyisessä|nykyisen|kotona)(?: |$)/u.test(N),
    there: /(?:^| )(?:siellä|sinne|sielläkin|sieltä|tuolla|tuonne|tuolta)(?: |$)/u.test(N),
    unknownPlace: /(?:^| )(?:m[öo]k(?:k|i)|kes[äa]m[öo]k)/u.test(N),
    compare: /(?:^| )(?:(?:kuin|vs)(?: |$)|verrattuna|vertaa|vertaile|kumpi|kummalla|kummassa|enemmän|vähemmän|kylmemp|lämpimämp|viileämp|sateisemp|tuulisemp|aurinkoisemp)/u.test(N),
    either: /(?:^| )vai(?: |$)/u.test(N),
    superlative: /(?:^| )(?:lämpimin|kylmin|viilein|kuumin)/u.test(N),
    route: /(?:^| )\S+(?:sta|stä) (?:\S+ )?\S+(?:lle|hin|iin|seen)(?= |$)/u.test(N),
    onRoute: /(?:^| )(?:matkalla|reitillä|matkan varrella)(?: |$)/u.test(N),
    umbrella: /(?:^| )(?:sate{1,2}nvarj|sadevarj|sadetak[ki]|sadevaat|sadehous|kumisaap)/u.test(N),
    fog: /(?:^| )(?:sumu|sumui|usva|utu(?:inen|isia|ista)?(?: |$))/u.test(N),
    storm: /(?:^| )(?:myrsk|rajuilma|ankara tuuli)/u.test(N),
    frost: /(?:^| )(?:pakka(?!us)|miinus|jäätyy|jäätä|halla|nollan|kasvi|kukka|taimi)/u.test(N),
    smalltalk: /(?:^| )(?:mitä kuuluu|miten menee|how are you)/u.test(N),
    greeting: GREETING.test(N),
    thanks: THANKS.test(N),
  };
  const places = placeCandidates(raw);
  if ((flags.route && places.length >= 2) || (flags.onRoute && places.length >= 1)) {
    if (intents.every((i) => i === 'summary' || i === 'sky')) intents.splice(0, intents.length, 'drive');
  }
  return { raw, N, tokens, intents, when, models, activity, places, flags, days2: flags.compare || flags.either ? twoDays(N) : null };
}


// ---------- Apurit: englanti, kellonajat sanoin, kaksi päivää ----------

const CLOCK_ABL = { yhdeltä: 1, kahdelta: 2, kolmelta: 3, neljältä: 4, viideltä: 5, kuudelta: 6, seitsemältä: 7, kahdeksalta: 8, yhdeksältä: 9, kymmeneltä: 10, yhdeltätoista: 11, kahdeltatoista: 12 };
const CLOCK_NOM = { yksi: 1, kaksi: 2, kolme: 3, neljä: 4, viisi: 5, kuusi: 6, seitsemän: 7, kahdeksan: 8, yhdeksän: 9, kymmenen: 10, yksitoista: 11, kaksitoista: 12 };

/** Pieni englanti-suomi-sanasto: "will it rain tomorrow" -> "will it sataa huomenna". */
const EN = {
  weather: 'sää', forecast: 'ennuste', rain: 'sataa', raining: 'sataa', rainy: 'sateista', snow: 'lunta', snowing: 'lunta', snowy: 'lunta', wind: 'tuulee', windy: 'tuulista',
  cold: 'kylmä', warm: 'lämmin', hot: 'kuuma', temperature: 'lämpötila', tomorrow: 'huomenna', today: 'tänään', tonight: 'tänä yönä', now: 'nyt', weekend: 'viikonloppuna',
  wear: 'pukisin', jacket: 'takki', coat: 'takki', umbrella: 'sateenvarjo', sunset: 'auringonlasku', sunrise: 'auringonnousu', fog: 'sumua', foggy: 'sumua', thunder: 'ukkosta',
  storm: 'myrsky', icy: 'liukasta', slippery: 'liukasta', humidity: 'kosteus', pressure: 'ilmanpaine', cloudy: 'pilvistä', sunny: 'aurinkoista', feels: 'tuntuu',
  morning: 'aamulla', evening: 'illalla', night: 'yöllä', yesterday: 'eilen',
};
function enToFi(raw) {
  return raw.replace(/\p{L}+/gu, (w) => {
    const k = lc(w);
    return Object.hasOwn(EN, k) ? EN[k] : w;
  });
}

/** Kaksi eri päivää samassa kysymyksessä ("huomenna vai lauantaina") vertailua varten. */
function twoDays(N) {
  const out = [];
  const seen = new Set();
  for (const m of N.matchAll(/(?:^| )(tänään|huomenna|ylihuomenna|maanantai\S*|tiistai\S*|keskiviikko\S*|torstai\S*|perjantai\S*|lauantai\S*|sunnuntai\S*)(?= |$)/gu)) {
    const w = m[1];
    const d = w === 'tänään' ? { type: 'offset', n: 0 } : w === 'huomenna' ? { type: 'offset', n: 1 } : w === 'ylihuomenna' ? { type: 'offset', n: 2 } : { type: 'weekday', wd: WEEKDAYS.findIndex((x) => w.startsWith(x)), next: false };
    const key = JSON.stringify(d);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(d);
    }
  }
  return out.length >= 2 ? out.slice(0, 2) : null;
}
return { tokenize, parseWhen, placeQueries, placeCandidates, detectIntents, parseQuestion };
})();

// ---- advice.js ----
__m['advice'] = (() => {
// advice.js: neuvot ja huomiot yhdestä paikasta. Kaikki on koodilla laskettua ("koodi laskee, tekoäly selittää").
// Samaa logiikkaa käyttävät etusivun vastauskaista, chat ja myöhemmin Androidin widget ja ilmoitukset, joten
// funktiot ovat puhtaita (ei DOMia, ei verkkoa) ja kynnysarvot on koottu tähän yhteen paikkaan: ne ovat arvioita,
// joita viritetään käytön myötä.
//
// Nimeämisohje: koodin tuottamat arviot ovat "SääÄlyn arvio" tai "SääÄlyn huomio". Sana "varoitus" ja Ilmatieteen
// laitoksen keltainen/oranssi/punainen kuuluvat vain viranomaisen varoituksille.

const { nowPosition, wetSpans, windowPopPm, wQuantile, spanLabel, hh, endHour } = __m['blend'];
const { fmtNum, fmtTemp, fmtMm } = __m['util'];
const { windChill, wetBulb } = __m['phys'];

// ---------- Kynnysarvot ----------

const ADVICE = {
  // Pukeutuminen: "tuntuu kuin" -lämpötilan korjaukset
  activityOffset: { walk: 0, wait: -3, bike: -3, run: 8, ski: 8 },
  // Sateenvarjo: ikkunatodennäköisyys ja määrä
  umbrella: { yesP: 0.4, maybeP: 0.25, yesMm: 0.5, yesPeak: 0.3, maybeMm: 0.2, maybePeak: 0.1, ensYes: 0.5, ensMaybe: 0.3, windy: 8 },
  uvShow: 3,
  gustChip: 14,
  windChip: 10,
  // Omat huomiot (rajat perustuvat Ilmatieteen laitoksen varoitusrajoihin, mutta nimi ja ulkoasu ovat eri)
  gust: { summer: [15, 20, 25], winter: [20, 25, 30] }, // 1.5.–31.10. / 1.11.–30.4. (puuska, m/s)
  rain1h: [20, 30, 45],
  rain24h: [50, 70, 120],
  heat: [27, 30, 35],
  cold: { south: [-20, -30, -35], central: [-25, -35, -40], north: [-30, -40, -45] },
};

// ---------- Apuja ----------

const MINUS = '−';
const trange = (a, b) => (fmtTemp(a) === fmtTemp(b) ? fmtTemp(a) : `${fmtTemp(a)} … ${fmtTemp(b)}`);
const mps = (v) => `${fmtNum(v)} m/s`;
const isSummerSeason = (month) => month >= 5 && month <= 10; // 1.5.–31.10.

/** Tunnusluvut tuntivälille from..to (fc.hours-indeksit). */
function windowStats(fc, from, to) {
  const hs = fc.hours.slice(Math.max(0, from), to + 1);
  const o = {
    from, to, n: hs.length, feelMin: Infinity, feelMax: -Infinity, feelAvg: 0, tmin: Infinity, tmax: -Infinity,
    wind: 0, iWind: from, gust: 0, gustHi: 0, iGust: from, precip: 0, peak: 0, snowW: 0, popEns: 0, uv: 0, thunder: 0, cloud: 0,
  };
  hs.forEach((h, k) => {
    const i = from + k;
    o.feelMin = Math.min(o.feelMin, h.feels);
    o.feelMax = Math.max(o.feelMax, h.feels);
    o.feelAvg += h.feels;
    o.tmin = Math.min(o.tmin, h.temp);
    o.tmax = Math.max(o.tmax, h.temp);
    if (h.wind > o.wind) [o.wind, o.iWind] = [h.wind, i];
    if (h.gust > o.gust) [o.gust, o.iGust] = [h.gust, i];
    o.gustHi = Math.max(o.gustHi, h.gustHi ?? h.gust);
    o.precip += h.precip;
    o.peak = Math.max(o.peak, h.precip);
    o.snowW += h.precip * h.snowShare;
    if (h.popSrc === 'ens' && h.precip >= 0.05) o.popEns = Math.max(o.popEns, h.pop);
    o.uv = Math.max(o.uv, h.uv ?? 0);
    if (h.thunderShare >= 0.2) o.thunder = Math.max(o.thunder, h.thunderShare);
    o.cloud += h.cloud;
  });
  const n = Math.max(1, hs.length);
  o.feelAvg /= n;
  o.cloud /= n;
  o.snowShare = o.precip > 0 ? o.snowW / o.precip : 0;
  if (!hs.length) Object.assign(o, { feelMin: 0, feelMax: 0, tmin: 0, tmax: 0 });
  return o;
}

// ---------- Pukeutuminen ----------

/** Rajat ovat "tuntuu kuin" -lämpötilan ylärajoja. short = kaistan teksti, long = chatin vastaus. */
const OUTFIT = [
  { below: -25, key: 'extreme', short: 'Toppatakki ja lämpöalusvaatteet', long: 'Erittäin kylmää: pue lämpöalusvaatteet, villakerros, toppatakki, pipo, kunnon käsineet ja kaulaliina.' },
  { below: -15, key: 'severe', short: 'Talvitakki ja villakerros', long: 'Kovaa pakkasta: pue lämpöalusvaatteet, villapaita ja talvitakki sekä pipo, hanskat ja lämpimät kengät.' },
  { below: -7, key: 'cold', short: 'Talvitakki, pipo ja hanskat', long: 'Kylmää: pue talvitakki, pipo, hanskat ja lämpimät kengät. Kerrospukeutuminen toimii hyvin.' },
  { below: 0, key: 'frost', short: 'Lämmin takki ja pipo', long: 'Pakkasen puolella: pue lämmin takki, pipo ja ohuet hanskat.' },
  { below: 6, key: 'cool', short: 'Välikausitakki tai tuulitakki', long: 'Viileää: pue lämmin välikausitakki tai tuulitakki. Ohut pipo tai kauluri voi olla paikallaan.' },
  { below: 12, key: 'mild', short: 'Ohut takki tai huppari', long: 'Melko viileää: pue ohut takki tai paksu huppari.' },
  { below: 17, key: 'soft', short: 'Ohut kerros, kevyt takki varalle', long: 'Leutoa: pitkähihainen tai ohut kerros riittää. Kevyt takki varalle.' },
  { below: 22, key: 'warm', short: 'T-paita tai ohut paita riittää', long: 'Lämmintä: t-paita tai ohut paita riittää.' },
  { below: 28, key: 'hot', short: 'Kevyet ja ilmavat vaatteet', long: 'Lämmintä: kevyet ja ilmavat vaatteet. Muista juoda ja suojautua auringolta.' },
  { below: 999, key: 'scorching', short: 'Mahdollisimman kevyet vaatteet', long: 'Kuumaa: mahdollisimman kevyet vaatteet, aurinkosuoja ja riittävästi vettä.' },
];

/**
 * Pukeutumissuositus aikavälille. activity: walk | wait | bike | run | ski. sensitivity: −3…+3 °C
 * (negatiivinen = vilkuilee helposti, suositus on lämpimämpi).
 */
function outfit(fc, from, to, { activity = 'walk', sensitivity = 0 } = {}) {
  const st = windowStats(fc, from, to);
  const base = (st.feelAvg + st.feelMin) / 2;
  const ref = base + (ADVICE.activityOffset[activity] ?? 0) + sensitivity;
  const tier = OUTFIT.find((t) => ref < t.below) || OUTFIT.at(-1);
  const layered = st.feelMax - st.feelMin >= 8;
  const windproof = st.wind >= 8 || st.gust >= 12;
  return { ref, base, tier, layered, windproof, feelMin: st.feelMin, feelMax: st.feelMax, wind: st.wind, gust: st.gust, st };
}

// ---------- Sateenvarjo ----------

/**
 * Tarvitaanko sateenvarjoa? level: yes | maybe | no. Perustuu mallien ikkunatodennäköisyyteen ("sataako ainakin 0,3 mm
 * jossain vaiheessa ikkunaa"), joka on rehellisempi kuin tuntikohtainen luku, kun mallit ovat eri mieltä ajoituksesta.
 */
function umbrella(fc, from, to, { nowIdx = null } = {}) {
  const U = ADVICE.umbrella;
  const spans = wetSpans(fc, from, to);
  const st = windowStats(fc, from, to);
  const pm = fc.pm || [];
  const pwin = pm.length ? windowPopPm(pm, from, to, 0.3, fc.lead0 || 0) : null;
  const rainingNow = nowIdx != null && fc.hours[nowIdx] && fc.hours[nowIdx].precip >= 0.2 && fc.hours[nowIdx].popAgree >= 0.5;
  const p = pwin ?? st.popEns;
  const strong = p >= U.yesP || st.popEns >= U.ensYes;
  const some = p >= U.maybeP || st.popEns >= U.ensMaybe;
  let level = 'no';
  if (rainingNow || (strong && (st.precip >= U.yesMm || st.peak >= U.yesPeak))) level = 'yes';
  else if (some && (st.precip >= U.maybeMm || st.peak >= U.maybeMm / 2 || st.peak >= U.maybePeak)) level = 'maybe';
  const first = spans[0] || null;
  // Olomuoto: lumi ja räntä eivät tarvitse sateenvarjoa vaan päähineen ja kunnon kengät
  const share = first ? (first.kind === 'snow' ? 1 : first.kind === 'sleet' ? 0.5 : 0) : st.snowShare;
  const kind = share >= 0.6 ? 'snow' : share >= 0.25 ? 'sleet' : 'rain';
  // Tuuli sateen aikana: kova tuuli kääntää sateenvarjon
  let windWet = 0;
  if (first) for (let i = first.start; i <= first.end; i++) windWet = Math.max(windWet, fc.hours[i].wind);
  else windWet = st.wind;
  const windy = windWet >= U.windy;
  return { level, kind, windy, windWet, pwin, p, total: st.precip, peak: st.peak, spans, first, now: !!rainingNow };
}

/** Lyhyt aikamääre sateelle kaistan alariville: "sataa nyt, loppuu noin klo 16" tai "sade alkaa klo 14". */
function rainWhen(fc, u, nowIdx, today) {
  const s = u.first;
  if (!s) return '';
  if (u.now || (nowIdx != null && s.start <= nowIdx)) return `sataa nyt, loppuu noin klo ${endHour(fc.hours[s.end].t)}`;
  if (s.pwin != null && s.pwin < 0.6) return `sadetta mahdollisesti ${spanLabel(fc, s.start, s.end, today)}`;
  return `sade alkaa ${spanLabel(fc, s.start, s.start, today)}`;
}

// ---------- Liukkaus, halla, UV ----------

/**
 * Liukkausarvio tunneittain: 3 = jäätävää sadetta, 2 = liukasta (jäätyvät märät pinnat, märkä lumi), 1 = kuuraa.
 * Arvio laskee yhdistelmäennusteesta, joten nollakelin tuntumassa luku on varovainen. Ei ole tiesääpalvelun tieto.
 */
function slipperyHours(fc, from, to) {
  const hits = [];
  for (let i = from; i <= to; i++) {
    const h = fc.hours[i];
    if (!h) continue;
    const prev = fc.hours.slice(Math.max(0, i - 6), i);
    const prevT = prev.length ? prev[prev.length - 1].temp : h.temp;
    const wetBefore = prev.reduce((a, x) => a + (x.temp > 0.5 && x.snowShare < 0.6 ? x.precip : 0), 0);
    const liquid = h.precip * (1 - h.snowShare);
    const tw = wetBulb(h.temp, h.hum ?? 85);
    let level = 0;
    let why = '';
    if ((h.frzShare ?? 0) >= 0.3 && h.precip >= 0.05) (level = 3), (why = 'jäätävää sadetta');
    else if (liquid >= 0.1 && h.temp <= 0 && h.temp >= -6 && tw <= 0.5) (level = 3), (why = 'jäätävää sadetta');
    else if (wetBefore >= 0.5 && h.temp <= 0 && h.temp <= prevT + 0.3) (level = 2), (why = 'märät pinnat jäätyvät');
    else if (h.snowShare >= 0.25 && h.precip >= 0.1 && h.temp >= -2 && h.temp <= 1) (level = 2), (why = 'märkää lunta nollakelillä');
    else if (!h.isDay && h.temp >= -3 && h.temp <= 1.5 && (h.hum ?? 0) >= 90) (level = 1), (why = 'kuuraa');
    if (level) hits.push({ i, level, why });
  }
  return hits;
}

/** Yhteenveto liukkaudesta: vakavin taso ja sen jakso. */
function slippery(fc, from, to) {
  const hits = slipperyHours(fc, from, to);
  if (!hits.length) return { level: 0, hits };
  const top = Math.max(...hits.map((x) => x.level));
  const sel = hits.filter((x) => x.level >= Math.max(top, 2) || x.level === top);
  const start = sel[0].i;
  const end = sel.at(-1).i;
  return { level: top, start, end, why: sel[0].why, hits };
}

/**
 * Hallanvaara touko–syyskuussa: maanpinta voi olla nollassa, vaikka ilma on plussalla. Palauttaa ensimmäisen yhtenäisen
 * yöjakson (start..end), ei koko ikkunan yli, jotta aikamääre ei kata välissä olevaa päivää.
 */
function frostRisk(fc, from, to, month) {
  if (month < 5 || month > 9) return null;
  const hits = [];
  for (let i = from; i <= to; i++) {
    const h = fc.hours[i];
    if (h.isDay) continue;
    const d = h.cloud < 30 && h.wind < 3 ? 3 : h.cloud < 70 && h.wind < 5 ? 1.5 : 0.5;
    if (h.temp > 0 && h.temp - d <= 0) hits.push({ i, hard: false });
    else if (h.temp <= -2) hits.push({ i, hard: true });
  }
  if (!hits.length) return null;
  let end = 0;
  while (end + 1 < hits.length && hits[end + 1].i - hits[end].i <= 1) end++;
  const run = hits.slice(0, end + 1);
  return { start: run[0].i, end: run.at(-1).i, hard: run.some((x) => x.hard) };
}

/** UV-indeksi: näytetään vain, kun suojautuminen on järkevää (≥ 3). */
function uvAdvice(fc, from, to) {
  let max = 0;
  let a = -1;
  let b = -1;
  for (let i = from; i <= to; i++) {
    const u = fc.hours[i]?.uv ?? 0;
    max = Math.max(max, u);
    if (u >= ADVICE.uvShow) {
      if (a < 0) a = i;
      b = i;
    }
  }
  if (max < ADVICE.uvShow) return null;
  const rounded = Math.round(max);
  const band = max >= 8 ? 'erittäin korkea' : max >= 6 ? 'korkea' : 'kohtalainen';
  return { max: rounded, band, start: a, end: b };
}

// ---------- Omat huomiot ("SääÄlyn huomio") ----------

const LEVEL_WORD = ['', 'huomio', 'vahva huomio', 'erittäin vahva huomio'];

function p80(items) {
  return wQuantile(items, 0.8);
}

/**
 * Sään ääri-ilmiöt aikavälille. Rajat ovat Ilmatieteen laitoksen varoitusrajojen mukaiset, mutta tulos on oma arvio
 * mallidatasta eikä virallinen varoitus. Puuskissa käytetään mallien painotettua 80. persentiiliä (gustHi), koska mallit
 * aliarvioivat huippupuuskia ja yksi poikkeava malli ei saa laukaista huomiota yksin.
 */
function ownAlerts(fc, from, to, { month = 6, lat = 60 } = {}) {
  const A = ADVICE;
  const out = [];
  const hs = (i) => fc.hours[i];
  const lbl = (a, b) => spanLabel(fc, a, b, fc.hours[from].t.slice(0, 10));
  const lvl = (v, th) => (v >= th[2] ? 3 : v >= th[1] ? 2 : v >= th[0] ? 1 : 0);

  // Puuskat
  const gTh = isSummerSeason(month) ? A.gust.summer : A.gust.winter;
  let g = { v: 0, i: from };
  for (let i = from; i <= to; i++) if ((hs(i).gustHi ?? hs(i).gust) > g.v) g = { v: hs(i).gustHi ?? hs(i).gust, i };
  if (lvl(g.v, gTh)) {
    const l = lvl(g.v, gTh);
    let a = g.i;
    let b = g.i;
    while (a > from && (hs(a - 1).gustHi ?? hs(a - 1).gust) >= gTh[0]) a--;
    while (b < to && (hs(b + 1).gustHi ?? hs(b + 1).gust) >= gTh[0]) b++;
    out.push({ key: 'gust', level: l, title: l >= 3 ? 'Myrskyisiä puuskia' : l === 2 ? 'Erittäin kovia puuskia' : 'Kovia puuskia', text: `Puuskat voivat nousta jopa ${mps(g.v)} ${lbl(a, b)}. Varmista irtotavarat ja varo kaatuvia oksia.`, short: `puuskat jopa ${mps(g.v)} ${lbl(a, b)}`, start: a, end: b });
  }
  // Keskituuli (myrsky)
  const st = windowStats(fc, from, to);
  if (st.wind >= 21) out.push({ key: 'storm', level: 3, title: 'Myrskytuulta', text: `Keskituuli nousee jopa ${mps(st.wind)} ${lbl(st.iWind, st.iWind)}.`, short: `keskituuli jopa ${mps(st.wind)} ${lbl(st.iWind, st.iWind)}`, start: st.iWind, end: st.iWind });

  // Rankkasade: yksittäisten mallien tuntisade ja jakson kokonaissade (mallien 80. persentiili)
  const pm = fc.pm || [];
  if (pm.length) {
    let hr = { v: 0, i: from };
    for (let i = from; i <= to; i++) {
      const items = pm.filter((m) => m.p[i] != null).map((m) => ({ v: m.p[i], w: m.model.weight }));
      const v = items.length >= 2 ? p80(items) : 0;
      if (v > hr.v) hr = { v, i };
    }
    const l1 = lvl(hr.v, A.rain1h);
    const days = pm.map((m) => ({ v: m.p.slice(from, Math.min(to, from + 23) + 1).reduce((a, x) => a + (x ?? 0), 0), w: m.model.weight }));
    const tot = days.length >= 2 ? p80(days) : 0;
    const l24 = lvl(tot, A.rain24h);
    if (Math.max(l1, l24)) {
      const l = Math.max(l1, l24);
      out.push({ key: 'rain', level: l, title: 'Rankkasateen mahdollisuus', text: l1 >= l24 ? `Tunnissa voi sataa jopa ${fmtMm(hr.v)} ${lbl(hr.i, hr.i)}.` : `Vuorokaudessa voi sataa jopa ${fmtMm(tot)}.`, short: l1 >= l24 ? `jopa ${fmtMm(hr.v)} tunnissa ${lbl(hr.i, hr.i)}` : `jopa ${fmtMm(tot)} vuorokaudessa`, start: hr.i, end: hr.i });
    }
  }

  // Helle
  const tmax = Math.max(...fc.hours.slice(from, to + 1).map((h) => h.temp));
  const lh = lvl(tmax, A.heat);
  if (lh) out.push({ key: 'heat', level: lh, title: 'Helle', text: `Ylin lämpötila nousee noin ${fmtTemp(tmax)}. Juo riittävästi ja vältä rasitusta päivän kuumimpaan aikaan.`, short: `ylin noin ${fmtTemp(tmax)}`, start: from, end: to });

  // Kova pakkanen: ilman lämpötila tai tuulen viilennys, alue leveysasteen mukaan
  const zone = lat >= 66 ? 'north' : lat >= 62.5 ? 'central' : 'south';
  const cTh = A.cold[zone]; // [keltainen, oranssi, punainen] -raja; omissa huomioissa vain taso 1–3
  let c = { v: 99, i: from };
  for (let i = from; i <= to; i++) {
    const h = hs(i);
    const v = Math.min(h.temp, h.temp <= 10 ? windChill(h.wind, h.temp) : h.temp);
    if (v < c.v) c = { v, i };
  }
  const lcold = c.v <= cTh[2] ? 3 : c.v <= cTh[1] ? 2 : c.v <= cTh[0] ? 1 : 0;
  if (lcold) out.push({ key: 'cold', level: lcold, title: 'Kova pakkanen', text: `Pakkanen kiristyy jopa ${MINUS}${fmtNum(Math.abs(c.v))}° (tuulen viilennys mukaan lukien) ${lbl(c.i, c.i)}. Peitä iho ja vältä pitkää oleskelua ulkona.`, short: `jopa ${MINUS}${fmtNum(Math.abs(c.v))}° ${lbl(c.i, c.i)}`, start: c.i, end: c.i });

  // Ukkonen: vain mahdollisuus, ei prosenttia
  const thMin = month >= 5 && month <= 9 ? 0.2 : 0.6;
  let t0 = -1;
  let t1 = -1;
  for (let i = from; i <= to; i++) {
    if ((hs(i).thunderShare ?? 0) >= thMin) {
      if (t0 < 0) t0 = i;
      t1 = i;
    }
  }
  if (t0 >= 0) out.push({ key: 'thunder', level: 1, title: 'Ukkosen mahdollisuus', text: `Osa malleista ennustaa ukkosta ${lbl(t0, t1)}. Ukkosta ei voi ennustaa tarkasti: seuraa taivasta ja hakeudu ukkosella sisälle.`, short: lbl(t0, t1), start: t0, end: t1 });

  out.forEach((a) => (a.word = LEVEL_WORD[a.level]));
  return out.sort((a, b) => b.level - a.level);
}

// ---------- Vastauskaista ----------

/**
 * Ikkuna, jota vastauskaista koskee: aamulla koko päivä, päivällä seuraavat 6 tuntia, illalla ja yöllä huomisen päivä
 * (silloin kysytään yleensä seuraavan päivän pukeutumista). Palauttaa fc.hours-indeksit.
 */
function verdictWindow(fc, nowMs, force = 'auto') {
  const { idx, local } = nowPosition(fc, nowMs);
  const last = fc.hours.length - 1;
  const h = local.hour;
  const dayStr = local.date;
  const findDay = (date, hour) => fc.hours.findIndex((x) => x.t === `${date}T${String(hour).padStart(2, '0')}:00`);
  if (force === 'tomorrow') {
    const date = new Date(Date.parse(dayStr + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
    const a = findDay(date, 7);
    const b = findDay(date, 17);
    if (a >= 0 && b >= a) return { from: a, to: b, kind: 'tomorrow', label: 'huomenna', nowIdx: idx, forced: true };
  }
  if (force !== 'today' && (h >= 20 || h < 5)) {
    // Yö: huomisen aamusta iltapäivään (jos kello on 00–04, "huomenna" on tämä päivä)
    const date = h >= 20 ? new Date(Date.parse(dayStr + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10) : dayStr;
    const a = findDay(date, 7);
    const b = findDay(date, 17);
    if (a >= 0 && b >= a) return { from: a, to: b, kind: 'tomorrow', label: h >= 20 ? 'huomenna' : 'aamulla', nowIdx: idx };
  }
  if (h < 9) {
    const e18 = findDay(dayStr, 18);
    return { from: idx, to: Math.min(last, Math.max(idx + 1, e18 >= 0 ? e18 : idx + 12)), kind: 'day', label: 'tänään', nowIdx: idx };
  }
  return { from: idx, to: Math.min(last, idx + 6), kind: 'soon', label: 'seuraavat tunnit', nowIdx: idx };
}

/** "ei sadetta klo 21 asti · seuraava sade huomenna klo 00" tai "sade alkaa jo huomenna klo 00", jos ikkunan ulkopuolinen sade alkaa ennen sitä. */
function dryText(fc, win, nowIdx, today) {
  const { from, to } = win;
  const last = fc.hours.length - 1;
  if (win.kind === 'tomorrow' || win.kind === 'day') {
    const pre = wetSpans(fc, Math.max(0, from - 4), to).find((sp) => sp.start < from && sp.end >= from - 1);
    if (pre) return `sade alkaa jo ${spanLabel(fc, pre.start, pre.end, today)}`;
  }
  const next = to < last ? wetSpans(fc, to + 1, Math.min(last, to + 36))[0] : null;
  const base = `ei sadetta klo ${endHour(fc.hours[to].t)} asti`;
  return next ? `${base} · seuraava sade ${spanLabel(fc, next.start, next.end, today)}` : base;
}

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Vastauskaistan sisältö: enintään neljä kaistaa (takki, sateenvarjo + kaksi tärkeintä lisäkaistaa) ja yksi koodilla tehty lause.
 * Ääri-ilmiöt (alerts) palautetaan erikseen: ne näytetään sivun yläreunan huomiokaistalla, ei neuvojen joukossa.
 * opts.nowcast: tutkaennuste (nowcast.js) jos saatavilla; opts.month, opts.lat; opts.activity, opts.sensitivity.
 */
function verdict(fc, nowMs, opts = {}) {
  const win = verdictWindow(fc, nowMs, opts.window);
  const { from, to, nowIdx } = win;
  const today = fc.hours[nowIdx].t.slice(0, 10);
  const month = opts.month ?? +today.slice(5, 7);
  const lat = opts.lat ?? fc.lat ?? 60;
  const future = win.kind === 'tomorrow'; // huomisen ikkunassa "nyt" ei ole olennainen
  const a = fc.hours[from].t;
  const b = fc.hours[to].t;
  win.caption = win.kind === 'soon' ? 'Seuraavat 6 tuntia' : `${win.kind === 'tomorrow' ? 'Huomenna' : 'Tänään'} klo ${hh(a)}–${endHour(b)}`;
  void pad2;
  const o = outfit(fc, from, to, opts);
  const u = umbrella(fc, from, to, { nowIdx: future ? null : nowIdx });
  const sl = slippery(fc, from, to);
  const uv = uvAdvice(fc, from, to);
  const fr = frostRisk(fc, from, to, month);
  const alerts = ownAlerts(fc, from, Math.min(fc.hours.length - 1, Math.max(to, nowIdx + 24)), { month, lat });
  const chips = [];
  const parts = [];

  // Takki
  const extras = [];
  if (o.windproof && o.ref < 17) extras.push('tuulenpitävä uloin kerros');
  if (o.layered) extras.push('kerrospukeutuminen');
  chips.push({ key: 'coat', level: 'info', text: o.tier.short, sub: `tuntuu kuin ${trange(o.feelMin, o.feelMax)}`, extras });
  parts.push(o.ref >= 22 ? 'Takkia ei tarvita' : `Pukeudu: ${o.tier.short.charAt(0).toLowerCase()}${o.tier.short.slice(1)}`);

  // Sateenvarjo, tutkaennusteen kanssa
  const nc = !future && opts.nowcast && opts.nowcast.ok ? opts.nowcast : null;
  let level = u.level;
  let sub = '';
  if (nc) {
    if (nc.state === 'wet') (level = 'yes'), (sub = nc.endMin != null ? `sataa nyt, loppuu noin ${nc.endMin} min kuluttua` : 'sataa nyt');
    else if (nc.startMin != null && nc.startMin <= 120) (level = level === 'no' ? 'yes' : level), (sub = `sade alkaa noin ${nc.startMin} min kuluttua`);
  }
  if (!sub) sub = rainWhen(fc, u, future ? null : nowIdx, today);
  const lead = sub ? sub.split(' · ')[0] : '';
  const kindWord = u.kind === 'snow' ? 'Lunta' : u.kind === 'sleet' ? 'Räntää' : 'Sadetta';
  let text;
  let part;
  if (level === 'no') {
    text = 'Ei sateenvarjoa';
    sub = dryText(fc, win, nowIdx, today);
    part = 'Sateenvarjoa ei tarvita';
  } else if (u.kind === 'snow') {
    text = level === 'yes' ? 'Lunta tulossa' : 'Lumikuuron mahdollisuus';
    sub = [sub, 'huppu tai pipo, pitävät kengät'].filter(Boolean).join(' · ');
    part = `${kindWord} on tulossa${lead ? ` (${lead})` : ''}`;
  } else if (u.kind === 'sleet') {
    text = level === 'yes' ? 'Räntää tulossa' : 'Räntäkuuron mahdollisuus';
    sub = [sub, 'vedenpitävät kengät'].filter(Boolean).join(' · ');
    part = `${kindWord} on tulossa${lead ? ` (${lead})` : ''}`;
  } else if (u.windy) {
    text = level === 'yes' ? 'Sadetakki, ei sateenvarjoa' : 'Sadetakki varalle';
    sub = [sub, `tuulee ${mps(u.windWet)}`].filter(Boolean).join(' · ');
    part = `Ota sadetakki${lead ? ` (${lead})` : ''}: tuuli on liian kova sateenvarjolle`;
  } else {
    text = level === 'yes' ? 'Sateenvarjo mukaan' : 'Sateenvarjo varmuuden vuoksi';
    part = `${level === 'yes' ? 'Ota sateenvarjo mukaan' : 'Sateenvarjo voi olla tarpeen'}${lead ? ` (${lead})` : ''}`;
  }
  chips.push({ key: 'umbrella', level, text, sub, kind: u.kind });
  parts.push(part);

  // Lisäkaistat tärkeysjärjestyksessä
  const extra = [];
  if (sl.level >= 2 || (sl.level === 1 && win.kind !== 'soon')) {
    const when = spanLabel(fc, sl.start, sl.end, today);
    extra.push({ pri: 90 + sl.level, chip: { key: 'slippery', level: sl.level >= 2 ? 'warn' : 'info', text: sl.level === 3 ? 'Erittäin liukasta' : sl.level === 2 ? 'Liukkaan riski' : 'Kuuraa mahdollista', sub: `${when}: ${sl.why}` }, part: sl.level >= 2 ? `Liukkaan riski ${when}` : '' });
  }
  if (o.st.gust >= ADVICE.gustChip && !alerts.some((x) => x.key === 'gust' || x.key === 'storm')) extra.push({ pri: 60, chip: { key: 'wind', level: 'info', text: 'Tuulee kovaa', sub: `puuskat jopa ${mps(o.st.gust)} ${spanLabel(fc, o.st.iGust, o.st.iGust, today)}` }, part: `Tuulee kovaa (puuskat ${mps(o.st.gust)})` });
  if (uv) extra.push({ pri: 50, chip: { key: 'uv', level: 'info', text: `UV ${uv.max} · ${uv.band}`, sub: `suojaudu ${spanLabel(fc, uv.start, uv.end, today)}` }, part: '' });
  if (fr) extra.push({ pri: 55, chip: { key: 'frost', level: 'info', text: fr.hard ? 'Kova halla mahdollinen' : 'Hallanvaara', sub: `yöllä ${spanLabel(fc, fr.start, fr.end, today)}` }, part: 'Hallanvaara yöllä' });
  const fog = fc.hours.slice(from, to + 1).map((h, k) => ({ h, i: from + k })).filter((x) => x.h.sym === 'fog');
  if (fog.length) extra.push({ pri: 45, chip: { key: 'fog', level: 'info', text: 'Sumua mahdollista', sub: `näkyvyys voi olla heikko ${spanLabel(fc, fog[0].i, fog.at(-1).i, today)}` }, part: '' });
  extra.sort((x, y) => y.pri - x.pri);
  for (const e of extra.slice(0, 2)) {
    chips.push(e.chip);
    if (e.part) parts.push(e.part);
  }
  return { win, chips, alerts, sentence: `${parts.join('. ')}.`, outfit: o, umbrella: { ...u, level }, slippery: sl, uv, frost: fr };
}

/** Pelkkä chatin pukeutumisteksti (sama laskenta kuin kaistalla). */
function outfitSentence(o) {
  return o.tier.long;
}
return { ADVICE, windowStats, OUTFIT, outfit, umbrella, rainWhen, slipperyHours, slippery, frostRisk, uvAdvice, ownAlerts, verdictWindow, verdict, outfitSentence };
})();

// ---- answer.js ----
__m['answer'] = (() => {
// answer.js: SääÄlyn sisäinen vastausmoottori. Vastaa suomenkielisiin sääkysymyksiin pelkästään sovelluksen
// keräämän datan perusteella: usean säämallin yhdistelmä (fc) ja yksittäisten mallien omat luvut (results).
// Ei tekoälyä eikä omia verkkokutsuja. Paikkahaku ja muiden paikkojen ennusteet annetaan parametreina
// (ctx.geocode, ctx.forecastFor), joten moottori toimii ilman verkkoa ja on testattavissa.

const { parseQuestion } = __m['nlu'];
const { nowPosition, snapshot, SYMBOLS, wetSpans, rainSpansFrom, modelWindow, modelSeries, describeNow, describeDay } = __m['blend'];
const { sunEvents, dayLengthMs, moonInfo } = __m['sun'];
const { fmtTemp, fmtNum, fmtMm, windFrom, weekday, fmtDM, addDays, cap, localNow, zonedToUtcMs } = __m['util'];
const { placeKey, haversineKm } = __m['geo'];
const { outfit, slipperyHours } = __m['advice'];

// ---------- Apurit ----------

const lc = (s) => String(s ?? '').toLocaleLowerCase('fi-FI');
const pad2 = (n) => String(n).padStart(2, '0');
const hh = (iso) => iso.slice(11, 13);
const WD_LONG = ['sunnuntai', 'maanantai', 'tiistai', 'keskiviikko', 'torstai', 'perjantai', 'lauantai'];
const wdOf = (date) => new Date(date + 'T00:00:00Z').getUTCDay();
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const trange = (a, b) => (fmtTemp(a) === fmtTemp(b) ? fmtTemp(a) : `${fmtTemp(a)} … ${fmtTemp(b)}`);
const mps = (v) => `${fmtNum(v)} m/s`;
const pct = (p) => `${Math.round(p * 100)} %`;
const placeName = (p) => [p?.name, p?.region && lc(p.region) !== lc(p.name) ? p.region : ''].filter(Boolean).join(', ');

/** "tänään", "huomenna", "ylihuomenna" tai "lauantaina 24.10." */
function dayName(date, today) {
  const d = dayDiff(today, date);
  if (d === 0) return 'tänään';
  if (d === 1) return 'huomenna';
  if (d === 2) return 'ylihuomenna';
  return `${WD_LONG[wdOf(date)]}na ${fmtDM(date)}`;
}

/** Luettelon päiväotsikko: "Tänään", "Huomenna", "Lauantai 24.10." */
function dayHead(date, today) {
  const d = dayDiff(today, date);
  if (d === 0) return 'Tänään';
  if (d === 1) return 'Huomenna';
  return `${cap(WD_LONG[wdOf(date)])} ${fmtDM(date)}`;
}

const IDX = new WeakMap();
function idxMap(fc) {
  let m = IDX.get(fc);
  if (!m) {
    m = new Map(fc.hours.map((h, i) => [h.t, i]));
    IDX.set(fc, m);
  }
  return m;
}

// ---------- Ajankohdan ratkaisu ----------

const PARTS = {
  aamuyo: { from: 0, to: 6, word: 'aamuyöllä' },
  aamu: { from: 6, to: 10, word: 'aamulla' },
  aamupaiva: { from: 8, to: 12, word: 'aamupäivällä' },
  keskipaiva: { from: 11, to: 14, word: 'keskipäivällä' },
  paiva: { from: 9, to: 18, word: 'päivällä' },
  iltapaiva: { from: 12, to: 18, word: 'iltapäivällä' },
  ilta: { from: 17, to: 24, word: 'illalla' },
  yo: { from: 22, to: 30, word: 'yöllä' },
};

function validDate(y, m, d) {
  const s = `${y}-${pad2(m)}-${pad2(d)}`;
  const t = new Date(s + 'T00:00:00Z');
  return t.getUTCFullYear() === y && t.getUTCMonth() + 1 === m && t.getUTCDate() === d ? s : null;
}

const MONTH_STEMS = ['tammi', 'helmi', 'maalis', 'huhti', 'touko', 'kesä', 'heinä', 'elo', 'syys', 'loka', 'marras', 'joulu'];

/** Pääsiäissunnuntai (Meeus/Jones/Butcher) muodossa vvvv-kk-pp. */
function easterSunday(y) {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return validDate(y, month, day);
}

/** Päiväkuvaus -> { dates, label } paikallisen nykyhetken mukaan. */
function resolveDates(day, local) {
  const today = local.date;
  const wd = wdOf(today);
  const range = (from, n) => Array.from({ length: n }, (_, i) => addDays(from, i));
  switch (day.type) {
    case 'offset':
      return { dates: [addDays(today, day.n)] };
    case 'weekday': {
      let delta = (day.wd - wd + 7) % 7;
      if (day.next && delta === 0) delta = 7;
      return { dates: [addDays(today, delta)] };
    }
    case 'date': {
      const y0 = +today.slice(0, 4);
      let s = validDate(day.y ?? y0, day.m, day.d);
      if (s && !day.y && s < today && dayDiff(s, today) > 30) s = validDate(y0 + 1, day.m, day.d);
      return s ? { dates: [s] } : null;
    }
    case 'weekend': {
      if (wd === 0) return { dates: [today], label: 'viikonloppuna' };
      const toSat = (6 - wd + 7) % 7;
      return { dates: [addDays(today, toSat), addDays(today, toSat + 1)], label: 'viikonloppuna' };
    }
    case 'week': {
      if (day.which === 'next') {
        const toMon = ((1 - wd + 7) % 7) || 7;
        return { dates: range(addDays(today, toMon), 7), label: 'ensi viikolla' };
      }
      return { dates: range(today, ((7 - wd) % 7) + 1), label: 'tällä viikolla' };
    }
    case 'span':
      return { dates: range(today, day.n), label: day.n === 1 ? 'tänään' : `seuraavan ${day.n} päivän aikana` };
    case 'month': {
      const y0 = +today.slice(0, 4);
      const m0 = +today.slice(5, 7);
      const y = day.m < m0 ? y0 + 1 : y0;
      const from = day.m === m0 ? today : validDate(y, day.m, 1);
      const to = validDate(y, day.m, new Date(Date.UTC(y, day.m, 0)).getUTCDate());
      return { dates: range(from, dayDiff(from, to) + 1), label: `${MONTH_STEMS[day.m - 1]}kuussa` };
    }
    case 'dates': {
      const y0 = +today.slice(0, 4);
      const dates = day.list.map(([d, m]) => {
        const s = validDate(y0, m, d);
        return s < today && dayDiff(s, today) > 30 ? validDate(y0 + 1, m, d) : s;
      });
      return { dates, label: day.label };
    }
    case 'juhannus': {
      const y0 = +today.slice(0, 4);
      const sat = (y) => addDays(validDate(y, 6, 20), (6 - wdOf(validDate(y, 6, 20)) + 7) % 7);
      let s = sat(y0);
      if (addDays(s, 1) < today && dayDiff(s, today) > 30) s = sat(y0 + 1);
      return { dates: [addDays(s, -1), s, addDays(s, 1)], label: day.label };
    }
    case 'easter': {
      const y0 = +today.slice(0, 4);
      let e = easterSunday(y0);
      if (addDays(e, 1) < today && dayDiff(e, today) > 30) e = easterSunday(y0 + 1);
      return { dates: [addDays(e, -2), addDays(e, -1), e, addDays(e, 1)], label: day.label };
    }
    case 'far':
      return { dates: [], far: true, label: day.label }; // kuukausia kauempana oleva ajankohta (vuodenaika, "ensi vuonna")
    default:
      return null;
  }
}

/**
 * Kuvaus ajankohdasta ennusteen tuntiriveinä: { kind: 'point'|'range'|'days', from, to, days, dates, label, past, beyond, clipped, nowIdx, today }.
 * dates on kysytyt päivät sellaisinaan (myös ennusteen ulkopuolelta): niillä lasketaan auringon ajat tähtitieteellisesti.
 */
function resolveWindow(q, fc, nowMs, def = 'next24') {
  const when = q.when;
  const np = nowPosition(fc, nowMs);
  const today = np.local.date;
  const nowH = np.local.hour;
  const last = fc.hours.length - 1;
  const first = fc.hours[0].t;
  const map = idxMap(fc);
  const loc = (iso) => map.get(iso) ?? (iso < first ? -1 : last + 1);
  const at = (date, hour) => loc(`${addDays(date, Math.floor(hour / 24))}T${pad2(hour % 24)}:00`);
  const win = { kind: 'range', from: np.idx, to: np.idx, days: null, dates: null, label: '', past: false, beyond: false, clipped: false, nowIdx: np.idx, today, explicit: when.explicit };

  const D = when.day ? resolveDates(when.day, np.local) : null;
  if (D?.far) return { ...win, beyond: true, label: D.label };
  const part = when.part ? PARTS[when.part] : null;
  const dates = D?.dates ?? null;
  const yesterday = addDays(today, -1);

  const partLabel = (date, p, key) => {
    if (key === 'yo') return date === today || (nowH < 6 && date === yesterday) ? 'tänä yönä' : `${dayName(date, today)} yöllä`;
    if (key === 'ilta' && date === today) return 'tänä iltana';
    return `${dayName(date, today)} ${p.word}`;
  };

  let spec = null;
  let single = false;
  if (when.ahead != null) {
    const i = np.idx + when.ahead;
    Object.assign(win, { kind: 'point', from: i, to: i });
    win.label = `${when.ahead === 1 ? 'tunnin' : `${when.ahead} tunnin`} päästä${i <= last ? ` (klo ${hh(fc.hours[i].t)})` : ''}`;
  } else if (when.hour != null) {
    const h1 = when.hour;
    let h2 = when.hourTo != null ? when.hourTo : h1 + 1;
    if (h2 <= h1) h2 += 24;
    spec = { h1, h2, word: when.hourTo != null ? `klo ${h1}–${h2 % 24 || 24}` : `klo ${h1}` };
    single = when.hourTo == null;
  } else if (part) {
    spec = { h1: part.from, h2: part.to, part, key: when.part };
  }

  if (when.ahead == null && spec) {
    let ds = dates;
    if (!ds) {
      let d0 = today;
      if (spec.key === 'yo') {
        if (nowH < 6) d0 = yesterday;
      } else if (when.hour != null) {
        if (when.hour < nowH) d0 = addDays(today, 1);
      } else if (nowH >= spec.h2 - 1 && spec.h2 <= 24) d0 = addDays(today, 1);
      ds = [d0];
    }
    win.dates = ds;
    const wins = ds.map((date) => ({ date, from: at(date, spec.h1), to: at(date, spec.h2 - 1), label: spec.part ? partLabel(date, spec.part, spec.key) : `${dayName(date, today)} ${spec.word}` }));
    if (wins.length === 1) {
      Object.assign(win, { kind: single ? 'point' : 'range', from: wins[0].from, to: wins[0].to, label: wins[0].label });
    } else {
      win.kind = 'days';
      win.days = wins;
      win.label = `${D.label || 'seuraavina päivinä'} ${spec.part ? spec.part.word : spec.word}`;
    }
  } else if (when.ahead == null && dates) {
    win.dates = dates;
    if (dates.length === 1) Object.assign(win, { from: at(dates[0], 0), to: at(dates[0], 23), label: dayName(dates[0], today) });
    else {
      win.kind = 'days';
      win.days = dates.map((date) => ({ date, from: at(date, 0), to: at(date, 23), label: dayName(date, today) }));
      win.label = D.label || 'seuraavina päivinä';
    }
  } else if (when.ahead == null && when.now) {
    Object.assign(win, { kind: 'point', from: np.idx, to: np.idx, label: 'nyt' });
  } else if (when.ahead == null && when.soon) {
    Object.assign(win, { from: np.idx, to: np.idx + 5, label: 'lähimpien tuntien aikana' });
  } else if (when.ahead == null) {
    const len = def === 'next12' ? 12 : def === 'next36' ? 36 : def === 'next48' ? 48 : 24;
    if (def === 'today') Object.assign(win, { from: np.idx, to: at(today, 23), label: 'tänään' });
    else Object.assign(win, { from: np.idx, to: np.idx + len - 1, label: len === 24 ? 'seuraavan vuorokauden aikana' : `seuraavan ${len} tunnin aikana` });
  }

  // Rajaus ennusteen alueelle
  if (win.kind === 'days') {
    const cutEnd = win.days.some((d) => d.to > last); // ennuste loppuu kesken jakson (alussa menneitä päiviä pudottava rajaus ei ole "katkaisu")
    win.days = win.days.filter((d) => d.to >= 0 && d.from <= last).map((d) => ({ ...d, from: Math.max(0, d.from), to: Math.min(last, d.to) }));
    if (cutEnd) win.clipped = true;
    if (!win.days.length) {
      win.beyond = dates ? dates[0] > fc.hours[last].t.slice(0, 10) : true;
      win.past = !win.beyond; // kaikki päivät ovat ennusteen alkua edeltäviä
    } else {
      win.from = win.days[0].from;
      win.to = win.days.at(-1).to;
      win.past = win.days.every((d) => d.to < np.idx);
    }
  } else {
    if (win.from > last) win.beyond = true;
    else if (win.to < 0) win.past = true;
    else {
      if (win.to > last) win.clipped = true;
      win.from = Math.max(0, win.from);
      win.to = Math.min(last, win.to);
      win.past = win.to < np.idx;
    }
  }
  return win;
}

/** Jättää nykyhetkeä edeltävät tunnit pois (kysymys "sataako tänään" koskee jäljellä olevaa aikaa). */
function trim(w) {
  const cut = (a) => (a.to >= w.nowIdx && a.from < w.nowIdx ? { ...a, from: w.nowIdx } : a);
  if (w.kind === 'days') return { ...w, days: w.days.map(cut).filter((d) => d.to >= w.nowIdx) };
  return cut(w);
}

// ---------- Tunnusluvut aikaväliltä ----------

const WET_SYMS = new Set(['drizzle', 'rain_light', 'rain', 'rain_heavy', 'sleet', 'snow_light', 'snow', 'snow_heavy', 'thunder']);

function facts(fc, from, to) {
  const hs = fc.hours.slice(from, to + 1);
  const f = {
    from,
    to,
    n: hs.length,
    precip: 0,
    maxHourly: 0,
    popMax: 0,
    wetHours: 0,
    tmin: Infinity,
    tmax: -Infinity,
    iTmin: from,
    iTmax: from,
    feelMin: Infinity,
    feelMax: -Infinity,
    windMax: 0,
    iWind: from,
    gustMax: 0,
    iGust: from,
    cloud: 0,
    hum: 0,
    spread: 0,
    thunder: 0,
    snowW: 0,
  };
  const symCount = {};
  hs.forEach((h, k) => {
    const i = from + k;
    f.precip += h.precip;
    f.snowW += h.precip * h.snowShare;
    if (h.precip > f.maxHourly) f.maxHourly = h.precip;
    if (h.pop > f.popMax) f.popMax = h.pop;
    if (h.precip >= 0.2) f.wetHours++;
    if (h.temp < f.tmin) [f.tmin, f.iTmin] = [h.temp, i];
    if (h.temp > f.tmax) [f.tmax, f.iTmax] = [h.temp, i];
    f.feelMin = Math.min(f.feelMin, h.feels);
    f.feelMax = Math.max(f.feelMax, h.feels);
    if (h.wind > f.windMax) [f.windMax, f.iWind] = [h.wind, i];
    if (h.gust > f.gustMax) [f.gustMax, f.iGust] = [h.gust, i];
    f.cloud += h.cloud;
    f.hum += h.hum ?? 0;
    f.spread += h.spread ?? 0;
    if (h.sym === 'thunder' || h.thunderShare >= 0.2) f.thunder++;
    symCount[h.sym] = (symCount[h.sym] || 0) + 1;
  });
  const n = Math.max(1, hs.length);
  f.cloud /= n;
  f.hum /= n;
  f.spread /= n;
  f.feelAvg = hs.reduce((a, h) => a + h.feels, 0) / n;
  f.tavg = hs.reduce((a, h) => a + h.temp, 0) / n;
  f.dir = fc.hours[f.iWind]?.dir ?? null;
  f.snowShare = f.precip > 0 ? f.snowW / f.precip : 0;
  // Yleisin sääsymboli; sade voittaa, jos sitä on vähintään neljänneksellä tunneista
  const wet = Object.entries(symCount).filter(([s]) => WET_SYMS.has(s)).sort((a, b) => b[1] - a[1]);
  const wetN = wet.reduce((a, [, c]) => a + c, 0);
  if (symCount.thunder) f.sym = 'thunder';
  else if (wet.length && wetN >= Math.max(2, n * 0.25)) f.sym = wet[0][0];
  else f.sym = Object.entries(symCount).filter(([s]) => !WET_SYMS.has(s)).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'overcast';
  return f;
}

/** Yksittäisten mallien luvut aikaväliltä: vain mallit, joilla on dataa vähintään puolelle välistä. */
function modelStats(X, from, to) {
  const rows = modelWindow(X.results || [], X.fc, from, to).filter((r) => r.ok && r.cover >= 0.5);
  const all = modelWindow(X.results || [], X.fc, from, to);
  const tmaxs = rows.map((r) => r.tmax).filter((v) => v != null);
  const tmins = rows.map((r) => r.tmin).filter((v) => v != null);
  return {
    rows,
    all,
    n: rows.length,
    wet: rows.filter((r) => (r.precip ?? 0) >= 0.2).length,
    tmaxSpread: tmaxs.length ? Math.max(...tmaxs) - Math.min(...tmaxs) : 0,
    tminSpread: tmins.length ? Math.max(...tmins) - Math.min(...tmins) : 0,
  };
}

/** Lumisadetta senttimetreinä mallien omista lumisadearvoista (painotettu keskiarvo). */
function snowCm(X, from, to) {
  let sw = 0;
  let sv = 0;
  for (const r of X.results || []) {
    if (!r.ok) continue;
    const s = modelSeries(r, X.fc, 'snowfall');
    if (!s) continue;
    let sum = 0;
    let n = 0;
    for (let i = from; i <= to; i++) if (s[i] != null) (sum += s[i]), n++;
    if (n < (to - from + 1) / 2) continue;
    sw += r.model.weight;
    sv += r.model.weight * sum;
  }
  return sw ? sv / sw : null;
}

const spanClock = (fc, from, to, { range = false } = {}) => {
  const a = hh(fc.hours[from].t);
  const e = +hh(fc.hours[to].t) + 1;
  const b = e === 24 ? '24' : pad2(e % 24);
  return from === to && !range ? `klo ${a}` : `klo ${a}–${b}`;
};

/** Ajanjakso lauseeseen. Päivä mainitaan, jos jakso ei ole tämän päivän tai ikkunan oman päivän sisällä. */
function spanText(X, from, to, refDate = null, opts) {
  const date = X.fc.hours[from].t.slice(0, 10);
  const same = Array.isArray(refDate) ? refDate.includes(date) : date === refDate;
  const day = date === X.today || same ? '' : `${dayName(date, X.today)} `;
  return `${day}${spanClock(X.fc, from, to, opts)}`;
}

/** "huomenna noin klo 01" tai "noin klo 18" (tänään) */
function startText(X, i) {
  const date = X.fc.hours[i].t.slice(0, 10);
  return `${date === X.today ? '' : `${dayName(date, X.today)} `}noin klo ${hh(X.fc.hours[i].t)}`;
}

const windPhrase = (v) => (v < 0.5 ? 'Tyyntä' : v < 4 ? 'Heikkoa tuulta' : v < 8 ? 'Kohtalaista tuulta' : v < 14 ? 'Navakkaa tuulta' : v < 21 ? 'Kovaa tuulta' : 'Myrskytuulta');
const windAdv = (v) => (v < 4 ? 'heikosti' : v < 8 ? 'kohtalaisesti' : v < 14 ? 'navakasti' : v < 21 ? 'kovaa' : 'myrskyisesti');
const intensity = (mmh) => (mmh < 0.5 ? 'heikkoa' : mmh < 4 ? 'kohtalaista' : 'runsasta');
const KIND_WORD = { rain: 'vesisadetta', snow: 'lumisadetta', sleet: 'räntäsadetta' };

function refDateOf(X, w) {
  // Ikkunan päivä (tai yöikkunalla kaksi päivää), jos ikkuna on yhden "päivän" sisällä; silloin päivää ei toisteta jaksojen perässä
  const a = X.fc.hours[w.from]?.t.slice(0, 10);
  const b = X.fc.hours[w.to]?.t.slice(0, 10);
  if (!a || !/^(?:tänään|huomenna|ylihuomenna|[a-zäö]+na \d|tänä |klo)/.test(w.label)) return null;
  if (a === b) return a;
  return /(?:yö|yöllä|yönä)$/.test(w.label) ? [a, b] : null;
}

// ---------- Aihekohtaiset vastaukset ----------
// Jokainen palauttaa rivit (kappaleet tai "- " luettelon rivit). X = { fc, results, place, nowMs, today, ... }.

function dayList(X, w, line) {
  return w.days.map((d) => `- **${dayHead(d.date, X.today)}**: ${line(d)}`);
}

// --- Sade ja lumi ---

function rainLine(X, from, to, { snow = false, refDate = null } = {}) {
  const { fc } = X;
  let spans = wetSpans(fc, from, to);
  if (snow) spans = spans.filter((s) => s.kind === 'snow' || s.kind === 'sleet');
  const f = facts(fc, from, to);
  if (!spans.length) return { text: snow ? 'ei lumisadetta' : f.precip >= 0.1 ? `ei merkittävää sadetta (yhteensä ${fmtMm(f.precip)})` : 'ei sadetta', spans, f };
  const parts = spans.slice(0, 3).map((s) => {
    const mm = s.total >= 0.1 ? `, noin ${fmtMm(s.total)}` : '';
    const peak = Math.max(...fc.hours.slice(s.start, s.end + 1).map((h) => h.precip));
    const all = s.start <= from + 1 && s.end >= to - 1 && to - from >= 5;
    return `${intensity(peak)} ${KIND_WORD[s.kind]} ${all ? 'koko ajan' : spanText(X, s.start, s.end, refDate)}${mm}`;
  });
  return { text: parts.join('; '), spans, f };
}

/** Suurin tuuli sadejaksojen aikana (sateenvarjo ei pysy kovassa tuulessa). */
function wetWindMax(fc, spans) {
  let m = 0;
  for (const s of spans) for (let i = s.start; i <= s.end; i++) m = Math.max(m, fc.hours[i].wind);
  return m;
}

function composeRain(X, w, q, { snow = false } = {}) {
  const { fc } = X;
  const out = [];
  const head = cap(w.label);
  if (w.kind === 'days') {
    const per = w.days.map((d) => ({ d, r: rainLine(X, d.from, d.to, { snow, refDate: fc.hours[d.from].t.slice(0, 10) }) }));
    const tot = facts(fc, w.days[0].from, w.days.at(-1).to);
    if (!per.some((x) => x.r.spans.length)) {
      let line = `**${head} ${snow ? 'ei tule lunta' : 'ei sada'}.**`;
      if (snow) line += ` Lämpötila on ${trange(tot.tmin, tot.tmax)}${tot.tmin > 3 ? ', joten lunta ei ole tulossa' : ''}.`;
      else if (tot.popMax >= 0.3) line += ` Pieni kuuron mahdollisuus on (todennäköisyys enintään ${pct(tot.popMax)}).`;
      return [line];
    }
    out.push(`**${head}:**`);
    out.push(...per.map((x) => `- **${dayHead(x.d.date, X.today)}**: ${x.r.text}`));
    if (!snow && tot.precip >= 0.1) out.push(`Yhteensä noin ${fmtMm(tot.precip)} koko jaksolla.`);
    return out;
  }
  if (!snow && w.label === 'nyt' && !q.flags.umbrella) return rainNowNext(X, w);
  const f = facts(fc, w.from, w.to);
  const ref = refDateOf(X, w);
  const r = rainLine(X, w.from, w.to, { snow, refDate: ref });
  const ms = modelStats(X, w.from, w.to);
  const now = w.nowIdx;
  const wetNow = !snow && r.spans.length && r.spans[0].start <= now && r.spans[0].end >= now;

  if (!r.spans.length) {
    let line;
    if (snow) {
      const anyWet = wetSpans(fc, w.from, w.to);
      line = `**${head} ei tule lunta.**`;
      if (anyWet.length) line += ` ${cap(KIND_WORD[anyWet[0].kind])} on kuitenkin tulossa ${spanText(X, anyWet[0].start, anyWet[0].end, ref)}.`;
      else if (f.tmin > 3) line += ` Lämpötila on ${trange(f.tmin, f.tmax)}, joten lumi ei ole tulossa.`;
    } else {
      // Kuiva vastaus kertoo myös lämpötilan, jotta lyhyt vastaus on silti hyödyllinen
      line = `**${head} ei sada:** poutaa, ${trange(f.tmin, f.tmax)}.`;
      if (f.popMax >= 0.3 || f.precip >= 0.3) line += ` Pieni kuuron mahdollisuus kuitenkin on (todennäköisyys enintään ${pct(f.popMax)}${f.precip >= 0.1 ? `, yhteensä noin ${fmtMm(f.precip)}` : ''}).`;
      else if (f.popMax >= 0.1) line += ` Sateen todennäköisyys on enintään ${pct(f.popMax)}.`;
    }
    if (q.flags.umbrella) line = `Ei tarvita. ${line}`;
    out.push(line);
    if (!snow && ms.n >= 3 && ms.wet > 0) out.push(`${ms.wet}/${ms.n} mallia näyttää silti vähän sadetta.`);
    return out;
  }

  // Sadetta on
  if (q.flags.umbrella) {
    const need = f.precip >= 0.5 || (f.popMax >= 0.6 && f.precip >= 0.2);
    const windy = wetWindMax(fc, r.spans) >= 10;
    out.push(need ? (windy ? 'Kyllä: ota sadetakki, sillä tuuli on kova eikä sateenvarjo pysy hyvin.' : 'Kyllä, ota sateenvarjo tai sadetakki mukaan.') : 'Ei välttämättä: sade on vähäistä, mutta kuuro on mahdollinen.');
  }
  const s0 = r.spans[0];
  if (q.flags.askWhen && !snow) {
    const endClock = `noin klo ${pad2((+hh(fc.hours[s0.end].t) + 1) % 24)}`;
    const endAsk = /(?:^| )(?:loppu|päätty|lakka|ohi)/u.test(q.N);
    if (wetNow) out.push(`Sataa nyt, ja sade jatkuu ${endClock} asti.`);
    else if (endAsk) out.push(`Nyt ei sada. Seuraava sade alkaa ${startText(X, s0.start)} ja päättyy ${endClock}.`);
    else out.push(`Sade alkaa ${startText(X, s0.start)} ja kestää arviolta ${s0.end - s0.start + 1} h (${endClock} asti).`);
    out.push(`${cap(r.text)}.`);
  } else {
    out.push(`**${head} ${snow ? (r.spans.some((s) => s.kind === 'snow') ? 'sataa lunta' : 'sataa räntää') : 'sataa'}:** ${r.text}.`);
    if (snow) {
      const cm = snowCm(X, w.from, w.to);
      if (cm != null && cm >= 0.1) out.push(`Lunta kertyy mallien mukaan noin ${cm < 1 ? 'alle 1' : fmtNum(cm)} cm.`);
    } else {
      out.push(`Yhteensä noin ${fmtMm(f.precip)}, todennäköisyys enintään ${pct(f.popMax)}.`);
    }
  }
  if (ms.n >= 3) out.push(ms.wet === ms.n ? `Kaikki ${ms.n} mallia ennustavat sadetta.` : `${ms.wet}/${ms.n} mallia ennustaa sadetta.`);
  return out;
}

function composeSnow(X, w, q) {
  const out = [];
  if (q.N.includes('maassa') || q.N.includes('lumensyvy') || q.N.includes('lumipeit')) {
    out.push('Lumen syvyyttä maassa SääÄly ei tiedä, koska se käyttää vain ennusteita eikä havaintoja.');
  }
  out.push(...composeRain(X, w, q, { snow: true }));
  return out;
}

// --- Ukkonen ---

function composeThunder(X, w) {
  const { fc } = X;
  const t = trim(w);
  const range = t.kind === 'days' ? [t.days[0]?.from ?? w.from, t.days.at(-1)?.to ?? w.to] : [t.from, t.to];
  const hs = [];
  for (let i = range[0]; i <= range[1]; i++) if (fc.hours[i].sym === 'thunder' || fc.hours[i].thunderShare >= 0.15) hs.push(i);
  if (!hs.length) return [`Ukkosta ei ole odotettavissa ${w.label}.`];
  const strong = hs.filter((i) => fc.hours[i].sym === 'thunder');
  const a = hs[0];
  const b = hs.at(-1);
  const all = a <= range[0] + 1 && b >= range[1] - 1 && range[1] - range[0] >= 5;
  const when = all ? `koko ajan (${w.label})` : spanText(X, a, b, refDateOf(X, w));
  if (strong.length) return [`Ukkosta on mahdollista ${when}.`, 'Useat mallit ennustavat ukkosta: pysy tarvittaessa sisätiloissa ja vältä aukeita paikkoja ukkosen aikana.'];
  return [`Pieni ukkosen mahdollisuus ${when}: vain osa malleista ennustaa ukkosta.`];
}

// --- Lämpötila ---

function composeTemp(X, w, q) {
  const { fc } = X;
  if (w.kind === 'days') {
    const lines = dayList(X, w, (d) => {
      const f = facts(fc, d.from, d.to);
      return `${trange(f.tmin, f.tmax)}${f.feelMin <= f.tmin - 4 ? `, tuntuu kylmimmillään kuin ${fmtTemp(f.feelMin)}` : ''}`;
    });
    if (q.flags.superlative) {
      const cold = /(?:^| )(?:kylmin|viilein)/.test(q.N);
      const pick = w.days.map((d) => ({ d, f: facts(fc, d.from, d.to) })).sort((a, b) => (cold ? a.f.tmin - b.f.tmin : b.f.tmax - a.f.tmax))[0];
      lines.unshift(`**${cold ? 'Kylmin' : 'Lämpimin'} päivä on ${dayName(pick.d.date, X.today)}** (${fmtTemp(cold ? pick.f.tmin : pick.f.tmax)}).`);
    }
    return lines;
  }
  const out = [];
  const f = facts(fc, w.from, w.to);
  if (w.kind === 'point' || w.from === w.to) {
    const h = fc.hours[w.from];
    const isNow = w.label === 'nyt';
    const s = isNow ? snapshot(fc, w.from, nowPosition(fc, X.nowMs).frac) : h;
    const feels = Math.abs(s.feels - s.temp) >= 2 ? `, tuntuu kuin ${fmtTemp(s.feels)}` : '';
    out.push(`Lämpötila ${w.label} on **${fmtTemp(s.temp)}**${feels}.`);
    const ms = modelStats(X, w.from, w.to);
    if (ms.n >= 3) out.push(`Mallien välillä ${trange(Math.min(...ms.rows.map((r) => r.tmin)), Math.max(...ms.rows.map((r) => r.tmax)))}.`);
    return out;
  }
  const feels = f.feelMin <= f.tmin - 3 ? ` Tuntuu kylmimmillään kuin ${fmtTemp(f.feelMin)}.` : '';
  const ref = refDateOf(X, w);
  const range = `Lämpötila ${w.label}: **${trange(f.tmin, f.tmax)}** (alin ${spanText(X, f.iTmin, f.iTmin, ref)}, ylin ${spanText(X, f.iTmax, f.iTmax, ref)}).${feels}`;
  if (q.flags.frost || q.N.includes('pakkas') || q.N.includes('miinus')) {
    const cold = [];
    for (let i = w.from; i <= w.to; i++) if (fc.hours[i].temp < 0) cold.push(i);
    if (!cold.length) out.push(`**Pakkasta (alle 0°) ei ole odotettavissa ${w.label}.** Alin lämpötila on ${fmtTemp(f.tmin)}.`);
    else out.push(`**Pakkasta on ${spanText(X, cold[0], cold.at(-1), ref)}**, alimmillaan ${fmtTemp(f.tmin)}.`);
    out.push(range);
  } else out.push(range);
  return out;
}

// --- Tuuli ---

function composeWind(X, w, q) {
  const { fc } = X;
  if (w.kind === 'days') return dayList(X, w, (d) => {
    const f = facts(fc, d.from, d.to);
    return `${windPhrase(f.windMax).toLowerCase()}, enintään ${mps(f.windMax)}, puuskissa ${mps(f.gustMax)}`;
  });
  const f = facts(fc, w.from, w.to);
  const dir = f.dir != null ? ` ${windFrom(f.dir)}` : '';
  const out = [];
  const ref = refDateOf(X, w);
  const lowerFirst = (t) => t.charAt(0).toLowerCase() + t.slice(1);
  if (w.kind === 'point' || w.from === w.to) {
    const h = fc.hours[w.from];
    out.push(`**${cap(w.label)}:** ${lowerFirst(windPhrase(h.wind))}, **${mps(h.wind)}**${h.dir != null ? ` ${windFrom(h.dir)}` : ''}, puuskissa ${mps(h.gust)}.`);
  } else {
    out.push(`**${cap(w.label)}:** ${lowerFirst(windPhrase(f.windMax))}, enimmillään **${mps(f.windMax)}**${dir} ${spanText(X, f.iWind, f.iWind, ref)}, puuskissa jopa ${mps(f.gustMax)}.`);
    const calm = fc.hours.slice(w.from, w.to + 1).reduce((a, h) => a + h.wind, 0) / f.n;
    if (f.n > 3) out.push(`Keskimäärin tuuli on ${mps(calm)}.`);
  }
  if (q?.flags?.storm) {
    // Ilmatieteen laitoksen myrsky: keskituuli vähintään 21 m/s
    if (f.windMax >= 21) out.unshift(`**Myrskytuulta ennustetaan:** keskituuli nousee jopa ${mps(f.windMax)}.`);
    else out.unshift(`**Myrskyä (keskituuli vähintään 21 m/s) ei ole ennusteessa ${w.label}.** Kovin tuuli on ${mps(f.windMax)}, puuskat ${mps(f.gustMax)}.`);
  }
  if (f.gustMax >= 20) out.push('Puuskat ovat hyvin kovia. Tarkista Ilmatieteen laitoksen varoitukset ja varmista irtotavarat ulkona.');
  else if (f.gustMax >= 15) out.push('Puuskat voivat olla kovia. Varmista irtotavarat ulkona.');
  return out;
}

// --- Pukeutuminen ---

function composeClothing(X, w) {
  const { fc } = X;
  const t = trim(w);
  const rng = t.kind === 'days' ? [t.days[0].from, t.days.at(-1).to] : [t.from, t.to];
  const f = facts(fc, rng[0], rng[1]);
  const tier = outfit(fc, rng[0], rng[1], { sensitivity: X.sensitivity || 0 }).tier;
  const out = [];
  const label = w.kind === 'days' ? w.label : w.label;
  out.push(`**Pukeutuminen ${label}:** tuntuu kuin ${trange(f.feelMin, f.feelMax)}. ${tier.long}`);
  const extra = [];
  const snowy = f.snowShare >= 0.6 && f.precip >= 0.3;
  const sleet = f.snowShare >= 0.25 && f.snowShare < 0.6 && f.precip >= 0.3;
  const rainy = f.snowShare < 0.25 && (f.precip >= 0.5 || (f.popMax >= 0.6 && f.precip >= 0.2));
  const spans = wetSpans(fc, rng[0], rng[1]);
  const when = spans.length ? ` (${spanText(X, spans[0].start, spans[0].end, refDateOf(X, w))})` : '';
  if (snowy) extra.push(`Lunta on tulossa${when}: vedenpitävät talvikengät ja huppu tai pipo.`);
  else if (sleet) extra.push(`Räntää on tulossa${when}: vedenpitävät kengät ja sadetakki.`);
  else if (rainy) extra.push(wetWindMax(fc, spans) >= 10 ? `Sadetta${when}: sadetakki toimii sateenvarjoa paremmin, koska tuuli on kova.` : `Sadetta${when}: ota sadetakki tai sateenvarjo mukaan.`);
  else if (f.popMax >= 0.4) extra.push('Pieni kuuron mahdollisuus: kevyt sadetakki repussa riittää.');
  if (f.windMax >= 8) extra.push(`Tuulee ${windAdv(f.windMax)} (enintään ${mps(f.windMax)}), joten tuulenpitävä uloin kerros auttaa.`);
  if (f.feelMax - f.feelMin >= 8) extra.push(`Lämpötila vaihtelee (${trange(f.feelMin, f.feelMax)}), joten kerrospukeutuminen on viisasta.`);
  const slip = slipperyHours(fc, rng[0], rng[1]).filter((h) => h.level >= 2);
  if (slip.length) extra.push(`Liukkaan riski ${spanText(X, slip[0].i, slip.at(-1).i, refDateOf(X, w))}: valitse kengät, joissa on hyvä pito, tai liukuesteet.`);
  if (f.tmax >= 24 && f.cloud < 50) extra.push('Aurinkoisella ilmalla aurinkolasit ja aurinkosuoja ovat hyödyksi.');
  out.push(...extra);
  return out;
}

// --- Ulkoilu ---

const ACT = {
  run: { name: 'lenkille', temp: [2, 14], len: 1, dark: 1.5, wind: 8, rain: 3 },
  bike: { name: 'pyöräilemään', temp: [8, 22], len: 2, dark: 3, wind: 7, rain: 3 },
  walk: { name: 'kävelylle', temp: [3, 22], len: 1, dark: 1, wind: 10, rain: 2.5 },
  hike: { name: 'retkelle', temp: [3, 20], len: 3, dark: 6, wind: 10, rain: 3 },
  ski: { name: 'hiihtämään', temp: [-15, -2], len: 2, dark: 1, wind: 8, rain: 3 },
  swim: { name: 'uimaan', temp: [20, 32], len: 2, dark: 3, wind: 8, rain: 1.5, air: true },
  grill: { name: 'grillaamaan', temp: [10, 30], len: 2, dark: 0.5, wind: 9, rain: 4 },
  picnic: { name: 'piknikille', temp: [14, 28], len: 2, dark: 3, wind: 8, rain: 4 },
  fish: { name: 'kalaan', temp: [3, 22], len: 3, dark: 0.5, wind: 8, rain: 2 },
  outside: { name: 'ulkoilemaan', temp: [3, 22], len: 1, dark: 1, wind: 10, rain: 3 },
  laundry: { name: 'pyykin kuivatukseen', temp: [8, 30], len: 4, dark: 6, wind: 14, rain: 6, hum: true },
  lawn: { name: 'pihatöihin', temp: [5, 27], len: 3, dark: 8, wind: 12, rain: 5 },
  carwash: { name: 'auton pesuun', temp: [2, 30], len: 2, dark: 3, wind: 14, rain: 5 },
  golf: { name: 'golfaamaan', temp: [8, 28], len: 4, dark: 8, wind: 9, rain: 4 },
  beach: { name: 'rannalle', temp: [19, 34], len: 3, dark: 6, wind: 9, rain: 4, air: true },
  forage: { name: 'metsään', temp: [3, 22], len: 3, dark: 6, wind: 11, rain: 2.5 },
};

function hourScore(a, h) {
  const t = a.air ? h.temp : h.feels;
  let s = 10;
  if (t < a.temp[0]) s -= (a.temp[0] - t) * 0.8;
  if (t > a.temp[1]) s -= (t - a.temp[1]) * 0.8;
  s -= h.precip * a.rain + h.pop * 1.5;
  s -= Math.max(0, h.wind - a.wind) * 0.8 + Math.max(0, h.gust - 14) * 0.25;
  if (!h.isDay) s -= a.dark;
  if (a.name !== 'hiihtämään' && h.snowShare >= 0.6 && h.precip >= 0.1) s -= 1.5;
  if (h.thunderShare >= 0.2) s -= 8;
  if (a.hum) s -= Math.max(0, (h.hum ?? 70) - 75) * 0.12; // kostea ilma hidastaa kuivumista
  return s;
}

function composeOutdoor(X, w, q) {
  const { fc } = X;
  const act = ACT[q.activity?.id] || ACT.outside;
  const t = trim(w);
  const out = [];
  const spans = t.kind === 'days' ? t.days : [t];
  // Sopivin L tunnin jakso jokaiselta päivältä/ikkunasta
  const cands = [];
  for (const s of spans) {
    const L = Math.max(1, Math.min(act.len, s.to - s.from + 1));
    for (let i = s.from; i + L - 1 <= s.to; i++) {
      let sum = 0;
      for (let k = 0; k < L; k++) sum += hourScore(act, fc.hours[i + k]);
      cands.push({ i, to: i + L - 1, score: sum / L });
    }
  }
  if (!cands.length) return [`Ajanjaksolle (${w.label}) ei ole riittävästi ennustetunteja arvioon.`];
  // Ukkonen koko ajan: ulkoilu ei ole järkevää
  const stormy = (c) => fc.hours.slice(c.i, c.to + 1).some((h) => h.sym === 'thunder' || h.thunderShare >= 0.2);
  if (cands.every(stormy)) return [`**Ei kannata ${act.name === 'uimaan' ? 'uida' : 'lähteä ulos'}:** ukkosta on luvassa koko ajan (${w.label}).`, act.name === 'uimaan' ? 'Ukkosella ei pidä uida.' : 'Pysy ukkosen aikana sisätiloissa.'];
  cands.sort((a, b) => b.score - a.score || a.i - b.i);
  const best = cands[0];
  const second = cands.find((c) => Math.abs(c.i - best.i) >= 6 && c.score >= 7 && (fc.hours[c.i].isDay || !fc.hours[best.i].isDay));
  const describe = (c) => {
    const f = facts(fc, c.i, c.to);
    const bits = [fmtTemp(f.tavg)];
    bits.push(f.precip >= 0.2 ? `sadetta ${fmtMm(f.precip)}` : 'ei sadetta');
    bits.push(`tuuli ${mps(f.windMax)}`);
    if (!fc.hours[c.i].isDay) bits.push('pimeää');
    return `**${spanText(X, c.i, c.to, refDateOf(X, w), { range: true })}** (${bits.join(', ')})`;
  };
  const grade = best.score >= 8 ? 'hyvä' : best.score >= 5.5 ? 'kohtalainen' : 'heikko';
  const to = act.name;
  if (grade === 'hyvä') out.push(`${q.flags.askWhen ? '' : 'Kyllä, sopii. '}Paras ajankohta ${to} ${w.label}: ${describe(best)}.`);
  else if (grade === 'kohtalainen') out.push(`Voi mennä, mutta sää ei ole täydellinen. Paras ajankohta ${to} ${w.label}: ${describe(best)}.`);
  else out.push(`Ei erityisen hyvää hetkeä ${to} ${w.label}. Paras vaihtoehto on ${describe(best)}.`);
  if (second && grade !== 'heikko') out.push(`Toinen hyvä vaihtoehto: ${describe(second)}.`);
  // Syyt
  const bf = facts(fc, best.i, best.to);
  const why = [];
  if (grade !== 'hyvä') {
    if (bf.precip >= 0.3) why.push('sadetta');
    if (bf.windMax > act.wind) why.push(`tuulta (${mps(bf.windMax)})`);
    const tt = act.air ? bf.tavg : bf.feelAvg;
    if (tt < act.temp[0]) why.push('kylmää');
    if (tt > act.temp[1]) why.push('kuumaa');
    if (!fc.hours[best.i].isDay) why.push('pimeää');
    if (why.length) out.push(`Heikentäviä tekijöitä parhaallakin hetkellä: ${why.join(', ')}.`);
  }
  const wet = wetSpans(fc, t.kind === 'days' ? t.days[0].from : t.from, t.kind === 'days' ? t.days.at(-1).to : t.to).filter((s) => s.total >= 0.3);
  if (wet.length) out.push(`Vältä ${spanText(X, wet[0].start, wet[0].end, refDateOf(X, w))}: silloin sataa.`);
  if (act.air) out.push('Veden lämpötilaa SääÄly ei tiedä, joten tarkista se erikseen.');
  out.score = best.score;
  return out;
}

// --- Liukkaus ---

function composeIce(X, w) {
  const { fc } = X;
  const t = trim(w);
  const a = t.kind === 'days' ? t.days[0].from : t.from;
  const b = t.kind === 'days' ? t.days.at(-1).to : t.to;
  const f = facts(fc, a, b);
  const hits = slipperyHours(fc, a, b);
  const ref = refDateOf(X, w);
  const serious = hits.filter((h) => h.level >= 2);
  const out = [];
  if (serious.length) {
    const why = [...new Set(serious.map((h) => h.why))].join(', ');
    out.push(`Liukkautta on mahdollista ${spanText(X, serious[0].i, serious.at(-1).i, ref)}: ${why}. Lämpötila on silloin ${trange(Math.min(...serious.map((h) => fc.hours[h.i].temp)), Math.max(...serious.map((h) => fc.hours[h.i].temp)))}.`);
  } else if (hits.length) {
    out.push(`Aamulla tai yöllä voi esiintyä huurretta tai kuuraa ${spanText(X, hits[0].i, hits.at(-1).i, ref)} (lämpötila ${trange(f.tmin, f.tmax)}), mutta isompaa liukkautta ei ennusteesta näy.`);
  } else {
    out.push(`Liukkaus ei vaikuta todennäköiseltä ${w.label}: lämpötila on ${trange(f.tmin, f.tmax)}, eikä jäätävää sadetta ole odotettavissa.`);
  }
  out.push('Tämä on arvio ennusteesta eikä tiesääpalvelun tieto, joten katso myös ajokeli ennen lähtöä.');
  return out;
}

// --- Aurinko ---

function sunInfo(fc, date) {
  const ev = sunEvents(zonedToUtcMs(date + 'T00:00', fc.tz), fc.lat, fc.lon);
  const fmt = (ms) => (ms == null ? null : localNow(ms, fc.tz).iso.slice(11));
  return { ev, rise: fmt(ev.rise), set: fmt(ev.set), len: dayLengthMs(ev), polar: ev.polar };
}

function lenText(ms) {
  const m = Math.floor(ms / 60000);
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

function lenTrend(fc, date) {
  const s = sunInfo(fc, date);
  if (s.len == null || s.polar) return '';
  const prev = dayLengthMs(sunInfo(fc, addDays(date, -1)).ev);
  let trend = '';
  if (prev != null && Math.abs(s.len - prev) >= 5000) {
    const d = Math.round((s.len - prev) / 1000);
    const a = Math.abs(d);
    trend = `, ${d > 0 ? 'pitenee' : 'lyhenee'} ${a < 60 ? `${a} s` : `${Math.floor(a / 60)} min ${a % 60} s`} vuorokaudessa`;
  }
  return `päivän pituus ${lenText(s.len)}${trend}`;
}

function sunLine(fc, date, today) {
  const s = sunInfo(fc, date);
  if (s.polar === 'day') return `${cap(dayName(date, today))} aurinko ei laske (yötön yö).`;
  if (s.polar === 'night') return `${cap(dayName(date, today))} aurinko ei nouse (kaamos).`;
  const len = lenTrend(fc, date);
  return `${cap(dayName(date, today))}: aurinko nousee klo **${s.rise}** ja laskee klo **${s.set}**${len ? ` (${len})` : ''}.`;
}

function composeSun(X, w, q) {
  const { fc, today } = X;
  const np = nowPosition(fc, X.nowMs);
  const dateOf = (i) => fc.hours[Math.min(Math.max(i, 0), fc.hours.length - 1)].t.slice(0, 10);
  // Auringon ajat lasketaan tähtitieteellisesti, joten kysytty päivä saa olla ennusteen ulkopuolella (tai jo mennyt)
  const dates = w.dates?.length ? w.dates : w.kind === 'days' ? w.days.map((d) => d.date) : null;
  if (dates && dates.length > 1) {
    if (dates.length > 7) return [`**${cap(w.label || 'Jaksolla')}:**`, ...[dates[0], dates.at(-1)].map((d) => `- ${sunLine(fc, d, today)}`)];
    return dates.map((d) => `- ${sunLine(fc, d, today)}`);
  }
  const one = dates?.[0] ?? null;
  const asksLen = /(?:^| )(?:päivän pituu|päivän kesto|päivä on pitkä|pitkä päivä|kuinka pitkä)/u.test(q.N);
  if (asksLen) {
    const date = one ?? (w.explicit ? dateOf(w.from) : today);
    const s = sunInfo(fc, date);
    if (!s.polar && s.len != null) {
      const trend = lenTrend(fc, date).replace(/^päivän pituus [^,]*/, '');
      return [`${cap(dayName(date, today))} päivän pituus on **${lenText(s.len)}**: aurinko nousee klo ${s.rise} ja laskee klo ${s.set}${trend}.`];
    }
  }
  if (w.explicit) return [sunLine(fc, one ?? dateOf(w.from), today)];
  // Ei ajankohtaa: seuraava tapahtuma
  const s0 = sunInfo(fc, today);
  if (s0.polar) return [sunLine(fc, today, today)];
  const nowHM = np.local.iso.slice(11);
  const asksSet = /(?:^| )(?:lask|pime|hämär|iltaa)/u.test(q.N);
  const asksRise = /(?:^| )(?:nou|valois|aamu)/u.test(q.N) && !asksSet;
  if (asksSet && /(?:^| )(?:nou|valois)/u.test(q.N)) {
    // "milloin aurinko nousee ja laskee": molemmat samalta päivältä (tänään, jos lasku ei ole vielä ohi)
    const day0 = s0.set && nowHM < s0.set ? today : addDays(today, 1);
    return [sunLine(fc, day0, today)];
  }
  const first = asksRise ? s0.rise : s0.set;
  const day = first && nowHM < first ? today : addDays(today, 1);
  const s = day === today ? s0 : sunInfo(fc, day);
  const when = day === today ? 'tänään' : 'huomenna';
  const out = [asksRise ? `Aurinko nousee ${when} klo **${s.rise}**.` : `Aurinko laskee ${when} klo **${s.set}**.`];
  if (!asksRise && !asksSet) out[0] += ` Nousu on klo ${s.rise}.`;
  const len = lenTrend(fc, day);
  if (len) out.push(`${cap(len)}.`);
  return out;
}

// --- Pilvisyys ja aurinko ---

function composeFog(X, w) {
  const { fc } = X;
  const t = trim(w);
  const range = t.kind === 'days' ? [t.days[0]?.from ?? w.from, t.days.at(-1)?.to ?? w.to] : [t.from, t.to];
  const hs = [];
  for (let i = range[0]; i <= range[1]; i++) if (fc.hours[i].sym === 'fog') hs.push(i);
  if (!hs.length) return [`**Sumua ei ole ennusteessa ${w.label}.**`, 'Mallit eivät kuitenkaan ennusta paikallista aamu- ja iltasumua kovin tarkasti.'];
  const spans = [];
  let cur = [hs[0], hs[0]];
  for (const i of hs.slice(1)) {
    if (i === cur[1] + 1) cur[1] = i;
    else (spans.push(cur), (cur = [i, i]));
  }
  spans.push(cur);
  const ref = refDateOf(X, w);
  const all = spans.length === 1 && spans[0][0] <= range[0] + 1 && spans[0][1] >= range[1] - 1 && range[1] - range[0] >= 5;
  const when = all ? `koko ajan (${w.label})` : spans.slice(0, 3).map(([a, b]) => spanText(X, a, b, ref)).join(', ');
  return [`**Sumua on mahdollista ${when}.**`, 'Sumussa näkyvyys voi olla heikko, joten ota se huomioon liikkuessasi.'];
}

function composeSky(X, w, q) {
  if (q?.flags?.fog) return composeFog(X, w);
  const { fc } = X;
  const t = trim(w);
  if (t.kind === 'days') return dayList(X, t, (d) => {
    const f = facts(fc, d.from, d.to);
    return `${SYMBOLS[f.sym].toLowerCase()}, pilvisyys keskimäärin ${Math.round(f.cloud)} %`;
  });
  const f = facts(fc, t.from, t.to);
  const out = [];
  const sunny = [];
  for (let i = t.from; i <= t.to; i++) if (fc.hours[i].isDay && fc.hours[i].cloud < 35 && fc.hours[i].precip < 0.1) sunny.push(i);
  const day = fc.hours.slice(t.from, t.to + 1).some((h) => h.isDay);
  out.push(`**${cap(w.label)}:** ${SYMBOLS[f.sym].toLowerCase()}, pilvisyys keskimäärin ${Math.round(f.cloud)} %.`);
  if (sunny.length >= 3) {
    const spans = [];
    let cur = [sunny[0], sunny[0]];
    for (const i of sunny.slice(1)) {
      if (i === cur[1] + 1) cur[1] = i;
      else (spans.push(cur), (cur = [i, i]));
    }
    spans.push(cur);
    const best = spans.sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0];
    out.push(`Aurinkoista on ${spanText(X, best[0], best[1], refDateOf(X, w))}.`);
  } else if (sunny.length) out.push(`Aurinko pilkistää vain hetkittäin (${spanText(X, sunny[0], sunny.at(-1), refDateOf(X, w))}).`);
  else if (day) out.push('Aurinkoa ei juuri näy: päivällä on pilvistä tai sataa.');
  else out.push('Tänä aikana on pimeää, joten aurinkoa ei näy.');
  return out;
}

// --- Kosteus ja ilmanpaine ---

function composeAir(X, w, q) {
  const { fc } = X;
  const t = trim(w);
  const a = t.kind === 'days' ? t.days[0].from : t.from;
  const b = t.kind === 'days' ? t.days.at(-1).to : t.to;
  const f = facts(fc, a, b);
  const out = [];
  const asksPressure = /(?:^| )(?:paine|ilmanpain|hpa|barometr)/u.test(q.N);
  const h0 = fc.hours[a];
  const h1 = fc.hours[Math.min(fc.hours.length - 1, b)];
  if (asksPressure || !/kosteu|kostea/u.test(q.N)) {
    if (h0.press != null && h1.press != null) {
      const d = h1.press - h0.press;
      out.push(`Ilmanpaine on nyt ${fmtNum(h0.press)} hPa ja ${w.label} se ${Math.abs(d) < 1.5 ? 'pysyy lähes ennallaan' : d < 0 ? `laskee noin ${fmtNum(Math.abs(d))} hPa` : `nousee noin ${fmtNum(d)} hPa`} (${fmtNum(h1.press)} hPa).`);
      if (d <= -4) out.push('Nopeasti laskeva paine liittyy yleensä sään epävakaistumiseen.');
      else if (d >= 4) out.push('Nopeasti nouseva paine liittyy yleensä sään selkenemiseen.');
    }
  }
  if (!asksPressure || /kosteu|kostea/u.test(q.N)) out.push(`Ilmankosteus on ${w.label} keskimäärin ${Math.round(f.hum)} %.`);
  return out;
}

// --- Mallien omat luvut ---

const MODEL_NAMES = { ecmwf: 'ECMWF IFS', metno: 'MET Norway (MET Nordic)', icon: 'DWD ICON', arpege: 'Météo-France', ukmo: 'UK Met Office', gfs: 'NOAA GFS', gem: 'Kanadan GEM', dmi: 'DMI HARMONIE', fmi: 'Ilmatieteen laitos (FMI)' };

function modelLine(r, focus, point) {
  const t = point ? fmtTemp(r.tmin) : trange(r.tmin, r.tmax);
  const rain = r.precip == null ? 'sade –' : `sade ${fmtMm(r.precip)}`;
  const wind = r.wind == null ? '' : `tuuli enintään ${mps(r.wind)}${r.gust != null && r.gust - r.wind >= 4 ? ` (puuskat ${mps(r.gust)})` : ''}`;
  if (focus === 'rain' || focus === 'snow') return rain;
  if (focus === 'temp') return t;
  if (focus === 'wind') return wind;
  return [t, rain, wind].filter(Boolean).join(', ');
}

function composeModels(X, w, q, focus) {
  const { fc } = X;
  const t = w.kind === 'days' ? { from: w.days[0].from, to: w.days.at(-1).to } : w;
  const stats = modelStats(X, t.from, t.to);
  const point = t.from === t.to;
  const out = [];
  const want = q.models;
  const ms = fc.models.filter((m) => want.includes(m.key));
  // Nimetyt mallit, joita ei ole käytössä tai jotka eivät ulotu ajalle
  const missing = [];
  for (const key of want) {
    const info = fc.models.find((m) => m.key === key);
    const row = stats.rows.find((r) => r.model.key === key);
    if (!info && key === 'fmi') missing.push(`${MODEL_NAMES.fmi}: sen oma malli ei ole Open-Meteon tarjoamien mallien joukossa, joten sovellus ei käytä sitä. Virallinen ennuste löytyy osoitteesta ilmatieteenlaitos.fi`);
    else if (!info) missing.push(`${MODEL_NAMES[key]}: ei ole käytössä tässä sovelluksessa`);
    else if (!info.ok) missing.push(`${info.label}: ${info.skipped ? 'ei ole tällä hetkellä saatavilla' : info.coverage ? 'ei kata tätä paikkaa' : 'ei vastannut viimeisimmällä haulla'}`);
    else if (!row) missing.push(`${info.label}: ei ulotu tälle ajalle (esim. MET Nordic kattaa vain noin 2,5 vuorokautta)`);
  }
  void ms;
  const rows = want.length ? stats.rows.filter((r) => want.includes(r.model.key)) : stats.rows;
  const f = facts(fc, t.from, t.to);
  const blend = point ? fmtTemp(fc.hours[t.from].temp) : trange(f.tmin, f.tmax);
  if (!rows.length && !missing.length) return ['Yksikään malli ei ulotu tälle ajanjaksolle.'];
  if (want.length) {
    out.push(`**Mallien luvut ${w.label}:**`);
    out.push(...rows.map((r) => `- **${r.model.label}**: ${modelLine(r, focus, point)}`));
    out.push(...missing.map((m) => `- ${m}`));
    const blendText = focus === 'rain' || focus === 'snow' ? `sade ${fmtMm(f.precip)}` : focus === 'wind' ? `tuuli enintään ${mps(f.windMax)}` : focus === 'temp' ? blend : `${blend}, sade ${fmtMm(f.precip)}, tuuli enintään ${mps(f.windMax)}`;
    out.push(`Vertailuksi yhdistelmä: ${blendText}.`);
    return out;
  }
  out.push(`**Mallien luvut ${w.label}** (${stats.n} mallia):`);
  out.push(...rows.map((r) => `- **${r.model.short}**: ${modelLine(r, focus, point)}`));
  const blendText = focus === 'rain' || focus === 'snow' ? `sade ${fmtMm(f.precip)}` : focus === 'wind' ? `tuuli enintään ${mps(f.windMax)}` : focus === 'temp' ? blend : `${blend}, sade ${fmtMm(f.precip)}, tuuli enintään ${mps(f.windMax)}`;
  out.push(`- **Yhdistelmä**: ${blendText}`);
  out.push(...agreementLines(stats, point));
  if (missing.length) out.push(...missing.map((m) => `Huom. ${m}.`));
  return out;
}

function agreementLines(stats, point) {
  const out = [];
  if (stats.n < 2) return ['Vain yksi malli ulottuu tälle ajalle.'];
  const sp = Math.max(stats.tmaxSpread, point ? 0 : stats.tminSpread);
  out.push(sp <= 1.5 ? `Mallit ovat hyvin samaa mieltä lämpötilasta (ero ${fmtNum(sp, 1)}°).` : sp <= 3 ? `Mallien lämpötilaennusteissa on pientä hajontaa (ero ${fmtNum(sp, 1)}°).` : `Mallit eroavat lämpötilasta selvästi (ero ${fmtNum(sp, 1)}°), joten ennuste on epävarmempi.`);
  if (stats.wet === 0) out.push('Yksikään malli ei ennusta sadetta.');
  else if (stats.wet === stats.n) out.push(`Kaikki ${stats.n} mallia ennustavat sadetta.`);
  else out.push(`${stats.wet}/${stats.n} mallia ennustaa sadetta, joten sateen osalta mallit ovat erimielisiä.`);
  return out;
}

function composeConfidence(X, w) {
  const { fc } = X;
  const t = w.kind === 'days' ? { from: w.days[0].from, to: w.days.at(-1).to } : w;
  const f = facts(fc, t.from, t.to);
  const stats = modelStats(X, t.from, t.to);
  const out = [];
  const level = f.spread < 2 ? 'melko samaa mieltä' : f.spread < 4 ? 'osittain samaa mieltä' : 'selvästi eri mieltä';
  out.push(`Mallit ovat ${w.label} ${level}: lämpötilaennusteiden hajonta on keskimäärin ${fmtNum(f.spread, 1)}° (${fc.modelsUsed}/${fc.modelsTotal} mallia käytössä).`);
  if (stats.n >= 3) out.push(...agreementLines(stats, t.from === t.to).slice(1));
  const dev = stats.rows
    .map((r) => ({ r, d: r.tmax == null ? 0 : Math.abs(r.tmax - f.tmax) }))
    .sort((a, b) => b.d - a.d)[0];
  if (dev && dev.d >= 2) out.push(`Eniten yhdistelmästä poikkeaa ${dev.r.model.short} (ylin lämpötila ${fmtTemp(dev.r.tmax)}, yhdistelmä ${fmtTemp(f.tmax)}). Selvästi poikkeavat mallit jätetään yhdistelmästä pois.`);
  const far = fc.days.slice(3, 6);
  const near = fc.days.slice(0, 2);
  if (far.length >= 2 && near.length) {
    const avg = (ds) => ds.reduce((a, d) => a + facts(fc, d.from, d.to).spread, 0) / ds.length;
    const sf = avg(far);
    const sn = avg(near);
    if (sf >= sn + 0.5) out.push(`Epävarmuus kasvaa ajan myötä: 4.–6. päivän ennusteessa hajonta on keskimäärin ${fmtNum(sf, 1)}° (lähipäivinä ${fmtNum(sn, 1)}°).`);
    else out.push(`Hajonta pysyy samalla tasolla myös 4.–6. päivän ennusteessa (${fmtNum(sf, 1)}°). Kaukaisempi ennuste on silti aina epävarmempi kuin lähipäivät.`);
  }
  return out;
}

// --- Yhteenveto ---

function composeSummary(X, w) {
  const { fc, nowMs, today } = X;
  if (w.kind === 'days') {
    return dayList(X, w, (d) => {
      const f = facts(fc, d.from, d.to);
      const rain = f.precip >= 0.1 ? `, sadetta ${fmtMm(f.precip)}` : '';
      return `${SYMBOLS[f.sym].toLowerCase()}, ${trange(f.tmin, f.tmax)}${rain}, tuuli enintään ${mps(f.windMax)}`;
    });
  }
  const isNowish = !w.explicit || w.label === 'nyt' || w.label === 'lähimpien tuntien aikana';
  if (isNowish) {
    const lines = describeNow(fc, nowMs);
    const tomorrow = addDays(today, 1);
    const tl = describeDay(fc, tomorrow, nowMs)[0];
    return [lines.join(' '), ...(tl ? [tl] : [])];
  }
  const dayDate = fc.hours[w.from].t.slice(0, 10);
  const wholeDay = w.from === fc.days.find((d) => d.date === dayDate)?.from && w.to === fc.days.find((d) => d.date === dayDate)?.to;
  if (wholeDay) return [describeDay(fc, dayDate, nowMs).join(' ')];
  const f = facts(fc, w.from, w.to);
  const rain = f.precip >= 0.1 ? ` Sadetta ${fmtMm(f.precip)}, todennäköisyys enintään ${pct(f.popMax)}.` : ' Sadetta ei odoteta.';
  return [`${cap(w.label)}: ${SYMBOLS[f.sym].toLowerCase()}, ${trange(f.tmin, f.tmax)}.${rain} Tuuli enintään ${mps(f.windMax)}.`];
}

const HELP = [
  'Vastaan sovelluksen keräämän säädatan perusteella. Voit kysyä esimerkiksi:',
  '- **Sataako huomenna?** tai **Tarvitsenko sateenvarjon?**',
  '- **Mitä pukisin tänään?**',
  '- **Milloin on paras hetki lenkille?**',
  '- **Paljonko tuulee illalla?** tai **Onko huomenna liukasta?**',
  '- **Millainen sää on Rovaniemellä viikonloppuna?**',
  '- **Mitä ECMWF sanoo huomisesta?** tai **Ovatko mallit samaa mieltä?**',
  '- **Milloin aurinko laskee?**',
  '- **Kannattaako pyykit viedä ulos?** tai **Voiko huomenna ajaa Ouluun?**',
  '- **Kumpi on lämpimämpi, huomenna vai lauantaina?**',
];

const COMPOSERS = {
  rain: (X, w, q) => composeRain(X, trim(w), q),
  snow: (X, w, q) => composeSnow(X, trim(w), q),
  thunder: (X, w) => composeThunder(X, w),
  temp: (X, w, q) => composeTemp(X, w, q),
  wind: (X, w, q) => composeWind(X, trim(w), q),
  clothing: (X, w) => composeClothing(X, w),
  outdoor: (X, w, q) => composeOutdoor(X, w, q),
  ice: (X, w) => composeIce(X, w),
  sun: (X, w, q) => composeSun(X, w, q),
  sky: (X, w, q) => composeSky(X, w, q),
  air: (X, w, q) => composeAir(X, w, q),
  confidence: (X, w) => composeConfidence(X, w),
  summary: (X, w) => composeSummary(X, w),
  drive: (X, w) => composeDrive(X, w),
  tyres: (X) => composeTyres(X),
  moon: (X) => composeMoon(X),
  aurora: (X, w) => composeAurora(X, w),
  uv: () => [NO_DATA.uv],
  icecover: () => [NO_DATA.icecover],
  pollen: () => [NO_DATA.pollen],
  aqi: () => [NO_DATA.aqi],
};

/** Oletusikkuna aiheelle, kun kysymyksessä ei ole ajankohtaa. */
const DEFAULT_WINDOW = { clothing: 'next12', outdoor: 'next36', models: 'next24', confidence: 'next24', rain: 'next24', snow: 'next24', ice: 'next24', drive: 'next36', aurora: 'next12' };

function pastNote(w, X) {
  return `Ajankohta "${w.label}" on jo mennyt. SääÄly näyttää ennusteen nykyhetkestä eteenpäin eikä tunne menneitä havaintoja. Kysy sää nyt tai tulevilta päiviltä (ennuste ulottuu ${dayName(X.fc.days.at(-1).date, X.today)} asti).`;
}

// ---------- Paikat ----------

function commonPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** Valitsee paikkahaun tuloksesta nimeä vastaavan paikan. Heikko ehdokas (pienellä kirjoitettu sana) vaatii vahvemman osuman. */
function pickGeocoded(cand, list) {
  const qs = cand.queries.map(lc);
  let best = null;
  for (const r of list || []) {
    const rn = lc(r.name);
    for (const q of qs) {
      const cp = commonPrefix(q, rn);
      const ok = cp >= Math.max(3, Math.min(q.length, rn.length) - 2) && Math.abs(q.length - rn.length) <= 4;
      if (!ok) continue;
      if (!cand.strong && (q.length < 5 || Math.abs(rn.length - q.length) > 1 || (r.pop != null && r.pop < 3000 && cp < rn.length))) continue;
      const score = (rn === q ? 100 : 0) + cp * 2 + Math.min(20, Math.log10((r.pop || 1) + 1) * 3);
      if (!best || score > best.score) best = { score, r };
    }
  }
  return best?.r || null;
}

async function resolvePlaces(q, ctx, budget = { geocode: 4 }) {
  const found = [];
  const unresolved = [];
  for (const cand of q.places) {
    if (cand.offline) {
      found.push({ ...cand.offline, word: cand.word });
      continue;
    }
    let picked = null;
    let failed = null;
    for (const query of cand.queries.slice(0, 3)) {
      if (budget.geocode <= 0 || !ctx.geocode) break;
      budget.geocode--;
      try {
        picked = pickGeocoded(cand, await ctx.geocode(query));
      } catch (e) {
        failed = e;
        break;
      }
      if (picked) break;
    }
    if (picked) found.push({ name: picked.name, region: picked.region, country: picked.country, lat: picked.lat, lon: picked.lon, word: cand.word });
    else unresolved.push({ word: cand.word, strong: cand.strong, error: failed?.message || null });
  }
  return { found: found.filter((p, i) => found.findIndex((x) => placeKey(x) === placeKey(p)) === i), unresolved };
}

const isCurrent = (p, cur) => Boolean(cur) && (lc(p.name) === lc(cur.name) || haversineKm(p.lat, p.lon, cur.lat, cur.lon) < 12);

// ---------- Pääfunktio ----------

/**
 * Vastaa kysymykseen. ctx: { place, fc, results, nowMs, last, geocode(query), forecastFor(place), nowcast? }.
 * nowcast: tutkaennusteen tulkinta (nowcast.js summarizeNowcast), vain nykyiselle paikalle.
 * Palauttaa { text, intents, place, last, understood }. last tallennetaan seuraavaa kysymystä varten.
 */
async function answerQuestion(text, ctx) {
  const q = parseQuestion(text, { nowHour: ctx.fc ? localNow(ctx.nowMs, ctx.fc.tz).hour : null });
  const done = (t, extra = {}) => ({ text: t, intents: [], place: ctx.place, last: ctx.last || null, understood: true, ...extra });
  if (!ctx.fc) return done('Säädataa ei ole vielä ladattu. Odota hetki ja kysy uudelleen.', { understood: false });

  const last = ctx.last || null;
  let intents = [...q.intents];
  let activity = q.activity;
  const hasCue = q.places.length || q.when.explicit || q.flags.followUp || q.flags.there || q.flags.local || q.models.length || (q.flags.quantify && last?.intents?.length);
  // Paikannimi ilman sääsanoja ("Mikä on Suomen pääkaupunki?") ei ole sääkysymys, mutta pelkkä paikka ("Turku", "Turku huomenna") on.
  const placeWords = new Set(q.places.flatMap((p) => lc(p.word).split(' ')));
  const otherWords = q.tokens.filter((t) => t.length > 2 && !placeWords.has(t) && !/^\d/.test(t));
  const offTopic = !intents.length && !q.when.explicit && !q.flags.followUp && !q.flags.compare && !q.flags.there && !q.flags.local && !q.models.length && q.places.length > 0 && otherWords.length >= 1;

  if (q.flags.smalltalk && !intents.length) return done(['Kiitos, hyvää kuuluu! Sääasioissa minusta on eniten apua. Kokeile esimerkiksi:', ...HELP.slice(1, 4)].join('\n'));
  if (!intents.length && (!hasCue || offTopic)) {
    if (q.flags.thanks) return done('Ole hyvä! Kysy lisää säästä milloin tahansa.');
    if (q.flags.greeting) return done(['Hei! Olen SääÄly. Vastaan sääkysymyksiin sovelluksen keräämän datan perusteella.', ...HELP.slice(1, 5)].join('\n'));
    return done(['En ymmärtänyt kysymystä. Osaan vastata vain säähän liittyviin kysymyksiin.', ...HELP].join('\n'), { understood: false });
  }
  if (q.flags.followUp && !intents.length && !q.when.explicit && !q.places.length && !q.models.length && !q.flags.local && !q.flags.there) {
    return done('Mitä haluat tietää seuraavaksi? Voit vaihtaa ajan ("Entä huomenna?") tai paikan ("Entä Oulussa?").', { intents: last?.intents || [] });
  }
  let inherited = false;
  if (!intents.length) {
    if (q.models.length) intents = ['models'];
    else if (last?.intents?.length && (q.flags.followUp || q.flags.quantify || q.when.explicit || q.places.length)) {
      intents = [...last.intents];
      activity = activity || last.activity || null;
      inherited = true;
    } else intents = ['summary'];
  }

  // Jatkokysymys perii edellisen ajankohdan, ellei siinä ole omaa: "Sataako huomenna?" -> "Entä Rovaniemellä?" tarkoittaa huomista,
  // ja "Entä illalla?" saman päivän iltaa.
  let when = q.when;
  const lw = last?.when;
  if (lw?.explicit && (q.flags.followUp || inherited)) {
    if (!when.explicit) when = { ...lw };
    else if (!when.day && lw.day && (when.part || when.hour != null) && !when.now && !when.soon && when.ahead == null) when = { ...when, day: lw.day };
  }
  if (intents.includes('help') && intents.length === 1) return done(HELP.join('\n'), { intents });

  // Mallien omat luvut: aihe (sade, lämpö, tuuli) siirtyy mallivastaukseen
  let focus = null;
  if (intents.includes('models')) {
    focus = intents.find((i) => ['rain', 'snow', 'temp', 'wind'].includes(i)) || null;
    intents = intents.filter((i) => i === 'models' || !['rain', 'snow', 'temp', 'wind'].includes(i));
  }
  intents = intents.filter((i) => i !== 'help');

  // Paikka(t)
  const budget = { geocode: 4 };
  const { found, unresolved } = await resolvePlaces(q, ctx, budget);
  if (!found.length && q.flags.unknownPlace) return done('En tiedä, missä mökkisi on. Kirjoita paikkakunta (esimerkiksi "Sataako Kemiössä?") tai vaihda paikka yläreunan painikkeesta.', { intents });
  const loud = unresolved.filter((u) => u.strong && (!u.error || true));
  let places = found;
  if (!places.length) {
    if (loud.length && (q.flags.there || /(?:ssa|ssä|lla|llä|lta|ltä|sta|stä|lle)$/u.test(lc(loud[0].word)) || q.places.some((c) => !c.offline && c.strong && lc(c.word) !== lc(q.raw.split(/\s+/)[0] || '')))) {
      const u = loud[0];
      return done(`En löytänyt paikkaa "${u.word}"${u.error ? ` (paikkahaku ei onnistunut: ${u.error})` : ''}. Kirjoita paikkakunnan nimi mahdollisimman tarkasti tai vaihda paikka yläreunan painikkeesta.`, { intents });
    }
    if (q.flags.there && last?.place) places = [last.place];
    else if (q.flags.there) return done('En tiedä, mitä paikkaa tarkoitat sanalla "siellä". Kirjoita paikkakunnan nimi, esimerkiksi "Sataako Oulussa?".', { intents });
    else if (q.flags.followUp && last?.place && !q.flags.local) places = [last.place];
    else places = [ctx.place];
  }
  if (q.flags.compare && places.length === 1 && !isCurrent(places[0], ctx.place) && !q.flags.there) places = [places[0], ctx.place];
  if (q.flags.local && places.length && !places.some((p) => isCurrent(p, ctx.place))) places = [...places, ctx.place];
  places = places.slice(0, 2);
  if (places.length > 1) intents = intents.slice(0, 2);

  // Ladataan jokaisen paikan data ensin (virhe yhdessä paikassa ei kaada muita)
  const loaded = [];
  const blocks = [];
  let understood = true;
  for (const place of places) {
    const cur = isCurrent(place, ctx.place);
    let data = { fc: ctx.fc, results: ctx.results };
    if (!cur) {
      try {
        data = await ctx.forecastFor(place);
      } catch (e) {
        blocks.push(`**${placeName(place)}**\nPaikan säädataa ei saatu haettua (${e?.message || 'virhe'}). Yritä hetken päästä uudelleen.`);
        understood = false;
        continue;
      }
    }
    const used = cur ? ctx.place : place;
    loaded.push({ place: used, cur, X: { fc: data.fc, results: data.results, place: used, nowMs: ctx.nowMs, today: nowPosition(data.fc, ctx.nowMs).local.date, nowcast: cur ? ctx.nowcast || null : null } });
  }

  const qq = { ...q, activity, when };
  // Vertailu: kaksi päivää ("huomenna vai lauantaina") tai kaksi paikkaa ("Oulussa vai Tampereella")
  const cmpIntent = intents.find((i) => ['temp', 'rain', 'snow', 'wind', 'outdoor'].includes(i)) || (q.flags.compare ? 'temp' : null);
  let compared = false;
  if ((q.flags.compare || q.flags.either) && cmpIntent && loaded.length) {
    const dayCmp = Boolean(q.days2) && loaded.length === 1;
    const placeCmp = loaded.length === 2 && cmpIntent !== 'temp';
    if (dayCmp || placeCmp) {
      const items = dayCmp
        ? q.days2.map((d) => ({ X: loaded[0].X, qv: { ...qq, when: { ...qq.when, day: d, explicit: true } } }))
        : loaded.map((l) => ({ X: l.X, qv: qq, name: l.place.name }));
      const cmp = composeCompareGeneric(items, cmpIntent, qq, ctx.nowMs);
      if (cmp) {
        blocks.push(cmp);
        compared = true;
      }
    }
  }
  if (!compared && loaded.length === 2 && (intents[0] === 'temp' || (q.flags.compare && cmpIntent === 'temp'))) {
    const cmp = composeCompare(loaded, qq, ctx.nowMs);
    if (cmp) {
      blocks.push(cmp);
      compared = true;
    }
  }
  if (!blocks.length || loaded.length) {
    if (!compared) {
      for (const { place, cur, X } of loaded) {
        const header = loaded.length > 1 || !cur ? [`**${placeName(place)}**`] : [];
        const parts = [];
        // "aamulla ja illalla": jokainen mainittu vuorokaudenaika saa oman vastauksensa
        const whole = qq.when.parts ? { ...qq, when: { ...qq.when, part: null, parts: null } } : qq;
        const variants = qq.when.parts ? qq.when.parts.map((p) => ({ ...qq, when: { ...qq.when, part: p, parts: null } })) : [qq];
        for (const intent of intents) {
          let vs = variants;
          if (vs.length > 1) {
            // Jos koko päivä on ennusteen ulkopuolella (tai mennyt), siitä kerrotaan kerran eikä jokaiselle vuorokaudenajalle erikseen
            const wb = resolveWindow(whole, X.fc, X.nowMs, DEFAULT_WINDOW[intent] || 'next24');
            if ((wb.beyond || wb.past) && !(intent === 'sun' && wb.dates?.length)) vs = [whole];
          }
          parts.push([...new Set(vs.map((qv) => composeIntent(intent, qv, X, focus)))].join('\n\n'));
        }
        blocks.push([...header, ...parts].join('\n\n'));
      }
    }
  }

  const usedPlace = loaded[0]?.place || places[0];
  const f0 = loaded.length === 1 ? loaded[0].X.fc : null;
  return {
    text: blocks.join('\n\n').replace(/(\d{1,2}\.\d{1,2}\.)\.(?!\d)/g, '$1'), // päivämäärän (20.10.) perään ei tule toista pistettä
    intents,
    place: usedPlace,
    last: { place: usedPlace, intents, activity, when },
    understood,
    used: f0 ? { models: f0.modelsUsed, total: f0.modelsTotal } : null, // montako mallia vastauksen data perustuu (vain yhden paikan vastauksissa)
  };
}

/** Yhden aiheen vastaus yhdelle ajankohdalle: ratkaisee ikkunan ja kertoo, jos ajankohta on ennusteen ulkopuolella. */
function composeIntent(intent, qq, X, focus) {
  const w = resolveWindow(qq, X.fc, X.nowMs, DEFAULT_WINDOW[intent] || 'next24');
  const astro = intent === 'sun' && Boolean(w.dates?.length); // auringon ajat lasketaan tähtitieteellisesti: ennusteen ulkopuolinenkin päivä käy
  if (w.beyond && !astro) return `Ennuste ulottuu vain ${dayName(X.fc.days.at(-1).date, X.today)} asti, joten ${w.label || 'tuo ajankohta'} ei ole vielä ennusteessa.`;
  if (w.past && !astro) return pastNote(w, X);
  const lines = intent === 'models' ? composeModels(X, w, qq, focus) : COMPOSERS[intent](X, w, qq);
  if (w.clipped && !astro) lines.push(w.kind === 'days' ? `Ennuste kattaa vain ${dayName(X.fc.days.at(-1).date, X.today)} asti, joten vastaus koskee vain sitä osaa jaksosta.` : 'Ennuste ei ulotu koko ajanjaksolle, joten vastaus koskee vain ennusteen kattamaa osaa.');
  return lines.join('\n');
}

/** Kahden paikan lämpötilavertailu samalta ajalta. */
function composeCompare(loaded, q, nowMs) {
  const [A, B] = loaded;
  const wa = resolveWindow(q, A.X.fc, nowMs, 'next24');
  const wb = resolveWindow(q, B.X.fc, nowMs, 'next24');
  if (wa.beyond || wb.beyond || wa.past || wb.past || wa.kind === 'days') return null;
  const fa = facts(A.X.fc, wa.from, wa.to);
  const fb = facts(B.X.fc, wb.from, wb.to);
  const d = fa.tavg - fb.tavg;
  const na = A.place.name;
  const nb = B.place.name;
  const head = Math.abs(d) < 0.5 ? `**${na} ja ${nb} ovat lähes yhtä lämpimiä ${wa.label}.**` : `**${na} on ${d < 0 ? 'kylmempi' : 'lämpimämpi'} kuin ${nb} ${wa.label}.**`;
  const lines = [head, `- ${na}: ${trange(fa.tmin, fa.tmax)}`, `- ${nb}: ${trange(fb.tmin, fb.tmax)}`];
  if (Math.abs(d) >= 0.5) lines.push(`Keskilämpötilojen ero on noin ${fmtNum(Math.abs(d), 1)}°.`);
  return lines.join('\n');
}


// ---------- Uusia aiheita: sade nyt, ajokeli, renkaat, kuu, revontulet, vertailu ----------

/** "Sataako nyt / vielä / jo?": tilanne nyt ja seuraava muutos. */
function rainNowNext(X, w) {
  const { fc } = X;
  const now = w.nowIdx;
  const spans = rainSpansFrom(fc, now, 47);
  const s0 = spans[0];
  const peak = (s) => Math.max(...fc.hours.slice(s.start, s.end + 1).map((h) => h.precip));
  const endClock = (s) => `noin klo ${pad2((+hh(fc.hours[s.end].t) + 1) % 24)}`;
  // Tutka on havaintopohjainen ja kattaa seuraavat kaksi tuntia: se ratkaisee "sataako nyt" ja lähitunnit, mallit kertovat sateen lajin ja pidemmän ajan.
  const nc = X.nowcast?.ok ? X.nowcast : null;
  if (nc) {
    const kind = s0 && s0.start <= now + 1 ? KIND_WORD[s0.kind] : 'sadetta';
    if (nc.state === 'wet') return [`**Sataa nyt:** ${nc.word} ${kind}. Tutkan mukaan ${nc.tail}.`];
    if (nc.startMin != null) return [`**Nyt ei sada.** Tutkan mukaan ${nc.tail} (${nc.word}${s0 && s0.start <= now + 3 ? `, ${KIND_WORD[s0.kind]}, kestää ${endClock(s0)} asti` : ''}).`];
    if (!s0) return [`**Nyt ei sada**, eikä tutkan mukaan sada seuraavaan ${nc.tail.replace(/^ei sadetta seuraavaan /, '')}. Ennusteen mukaan sadetta ei ole luvassa myöskään seuraavan ${Math.min(48, fc.hours.length - now)} tunnin aikana.`];
    return [`**Nyt ei sada**, eikä tutkan mukaan sada seuraavaan ${nc.tail.replace(/^ei sadetta seuraavaan /, '')}. Ennusteen mukaan seuraava sade alkaa ${startText(X, s0.start)}: ${intensity(peak(s0))} ${KIND_WORD[s0.kind]}, kestää ${endClock(s0)} asti.`];
  }
  if (s0 && s0.start <= now) return [`**Sataa nyt:** ${intensity(peak(s0))} ${KIND_WORD[s0.kind]}. Sade jatkuu ennusteen mukaan ${endClock(s0)} asti.`];
  if (s0) return [`**Nyt ei sada.** Seuraava sade alkaa ${startText(X, s0.start)}: ${intensity(peak(s0))} ${KIND_WORD[s0.kind]}, kestää ${endClock(s0)} asti.`];
  return [`**Nyt ei sada**, eikä sadetta ole luvassa seuraavan ${Math.min(48, fc.hours.length - now)} tunnin aikana.`];
}

function composeDrive(X, w) {
  const { fc } = X;
  const t = trim(w);
  const a = t.kind === 'days' ? t.days[0].from : t.from;
  const b = t.kind === 'days' ? t.days.at(-1).to : t.to;
  const ref = refDateOf(X, w);
  const f = facts(fc, a, b);
  const bad = [];
  const slip = slipperyHours(fc, a, b).filter((h) => h.level >= 2);
  if (slip.length) bad.push(`liukkautta mahdollista ${spanText(X, slip[0].i, slip.at(-1).i, ref)} (${[...new Set(slip.map((h) => h.why))].join(', ')})`);
  const wet = wetSpans(fc, a, b).filter((s) => s.total >= 0.5);
  const snowy = wet.filter((s) => s.kind !== 'rain');
  if (snowy.length) bad.push(`${KIND_WORD[snowy[0].kind]} ${spanText(X, snowy[0].start, snowy[0].end, ref)}`);
  const heavy = wet.filter((s) => s.kind === 'rain' && Math.max(...fc.hours.slice(s.start, s.end + 1).map((h) => h.precip)) >= 4);
  if (heavy.length) bad.push(`runsasta sadetta ${spanText(X, heavy[0].start, heavy[0].end, ref)}`);
  const fog = [];
  for (let i = a; i <= b; i++) if (fc.hours[i].sym === 'fog') fog.push(i);
  if (fog.length) bad.push(`sumua ${spanText(X, fog[0], fog.at(-1), ref)}`);
  if (f.gustMax >= 20) bad.push(`kovia puuskia (enintään ${mps(f.gustMax)}) ${spanText(X, f.iGust, f.iGust, ref)}`);
  const head = `**Ajokeli ${w.label}:**`;
  const out = [bad.length ? `${head} huomioitavaa: ${bad.join('; ')}.` : `${head} ennusteen perusteella hyvä: ei liukkautta, merkittävää sadetta, sumua eikä kovaa tuulta. Lämpötila ${trange(f.tmin, f.tmax)}.`];
  out.push('Tämä on oma arvio ennusteesta eikä tiesääpalvelun tieto, joten tarkista tilanne ennen lähtöä.');
  return out;
}

function composeTyres(X) {
  const { fc } = X;
  const ds = fc.days.slice(0, 7);
  const mean = (d) => (d.tmin + d.tmax) / 2;
  const avg = ds.reduce((s, d) => s + mean(d), 0) / Math.max(1, ds.length);
  const cold = ds.filter((d) => mean(d) < 7).length;
  const verdict = cold >= Math.ceil(ds.length * 0.7) ? 'Talvirenkaiden aika on käsillä' : cold <= 1 ? 'Talvirenkaille ei ole vielä kiirettä' : 'Ollaan rajalla';
  return [
    `**${verdict}:** vuorokauden keskilämpötila on ennusteessa ${fmtTemp(avg)}, ja alle +7° se on ${cold}/${ds.length} päivänä.`,
    'Nyrkkisääntö: talvirenkaat, kun keskilämpötila pysyy alle +7°; kesärenkaat takaisin, kun se pysyy sen yli. Talvirengaspakko on 1.12.–28.2. (tarkista voimassa oleva sääntö Traficomilta), ja liukkaalla kelillä talvirenkaat tarvitaan muulloinkin.',
  ];
}

const moonName = (p) => (p < 0.03 || p > 0.97 ? 'uusikuu' : p < 0.22 ? 'kasvava sirppi' : p < 0.28 ? 'ensimmäinen neljännes' : p < 0.47 ? 'kasvava kuu' : p < 0.53 ? 'täysikuu' : p < 0.72 ? 'vähenevä kuu' : p < 0.78 ? 'viimeinen neljännes' : 'vähenevä sirppi');

function composeMoon(X) {
  const m = moonInfo(X.nowMs, X.fc.lat, X.fc.lon);
  const toFull = ((((0.5 - m.phase) % 1) + 1) % 1) * 29.530588853;
  const full = localNow(X.nowMs + toFull * 86400000, X.fc.tz).date;
  return [
    `Kuu on nyt **${moonName(m.phase)}**, noin ${Math.round(m.illum * 100)} % valaistu.`,
    `Seuraava täysikuu on noin ${dayName(full, X.today)}, laskettuna keskimääräisellä kiertoradalla (voi erota vuorokauden).`,
    'Kuun nousu- ja laskuaikoja SääÄly ei vielä laske.',
  ];
}

function composeAurora(X, w) {
  const { fc } = X;
  const t = trim(w);
  const a = t.kind === 'days' ? t.days[0].from : t.from;
  const b = t.kind === 'days' ? t.days.at(-1).to : t.to;
  const dark = [];
  for (let i = a; i <= b; i++) if (!fc.hours[i].isDay) dark.push(i);
  const out = ['SääÄly ei tiedä revontulten voimakkuutta (Kp-indeksiä), mutta pilvisyys kertoo, onko taivas auki.'];
  if (!dark.length) return [...out, `Ajanjaksolla (${w.label}) on valoisaa, joten revontulia ei näe ennen pimeää.`];
  const cloud = dark.reduce((s, i) => s + fc.hours[i].cloud, 0) / dark.length;
  const verdict = cloud < 30 ? 'taivas on lähes pilvetön' : cloud < 60 ? 'taivas on osin pilvessä' : 'taivas on pääosin pilvessä';
  out.push(`Pimeänä aikana klo ${hh(fc.hours[dark[0]].t)}–${pad2((+hh(fc.hours[dark.at(-1)].t) + 1) % 24)} pilvisyys on keskimäärin ${Math.round(cloud)} %: ${verdict}.`);
  return out;
}

const NO_DATA = {
  uv: 'SääÄly ei vielä hae UV-indeksiä, joten en voi sanoa, palaako iho tai tarvitaanko aurinkorasvaa. Pilvetön ja korkealla oleva aurinko nostaa UV-säteilyä eniten.',
  icecover: 'SääÄly ei tiedä jään paksuutta eikä kantavuutta, eikä jäälle mennä ennusteen perusteella. Tarkista jään kunto paikallisilta tahoilta.',
  pollen: 'SääÄly ei vielä hae siitepölytietoa. Tarkista tilanne siitepölytiedotteesta.',
  aqi: 'SääÄly ei vielä hae ilmanlaatutietoa. Tarkista tilanne ilmanlaatupalvelusta.',
};

/** Kahden päivän tai kahden paikan vertailu (sade, tuuli, ulkoilu, lämpö). items: [{ X, qv, name? }]. */
function composeCompareGeneric(items, intent, q, nowMs) {
  const rows = [];
  for (const it of items) {
    const w = resolveWindow(it.qv, it.X.fc, nowMs, DEFAULT_WINDOW[intent] || 'next24');
    if (w.beyond || w.past || w.kind === 'days') return null;
    const f = facts(it.X.fc, w.from, w.to);
    let v;
    let text;
    if (intent === 'rain' || intent === 'snow') {
      v = f.precip;
      text = f.precip >= 0.1 ? `${fmtMm(f.precip)}, todennäköisyys enintään ${pct(f.popMax)}` : 'ei sadetta';
    } else if (intent === 'wind') {
      v = f.windMax;
      text = `tuuli enintään ${mps(f.windMax)}, puuskissa ${mps(f.gustMax)}`;
    } else if (intent === 'outdoor') {
      const lines = composeOutdoor(it.X, w, it.qv);
      v = lines.score ?? -99;
      text = String(lines[0]).replace(/^Kyllä, sopii\. /, '');
    } else {
      v = f.tavg;
      text = trange(f.tmin, f.tmax);
    }
    rows.push({ label: it.name || cap(w.label), v, text });
  }
  const [a, b] = rows;
  const d = a.v - b.v;
  const lowWins = intent === 'rain' || intent === 'snow' || intent === 'wind';
  const win = (lowWins ? d < 0 : d > 0) ? a : b;
  let head;
  if (intent === 'rain' || intent === 'snow') head = Math.abs(d) < 0.3 ? (a.v < 0.1 && b.v < 0.1 ? 'Kummallakaan ei sada.' : 'Sadetta tulee suunnilleen yhtä paljon.') : `Vähemmän sataa: **${win.label}**.`;
  else if (intent === 'wind') head = Math.abs(d) < 1 ? 'Tuulta on suunnilleen yhtä paljon.' : `Tyynempää on: **${win.label}**.`;
  else if (intent === 'outdoor') head = Math.abs(d) < 0.8 ? 'Ajankohdat ovat suunnilleen yhtä hyviä.' : `Parempi vaihtoehto: **${win.label}**.`;
  else head = Math.abs(d) < 0.5 ? 'Lämpötila on suunnilleen sama.' : `Lämpimämpää on: **${win.label}**.`;
  return [head, ...rows.map((r) => `- **${r.label}**: ${r.text}`)].join('\n');
}
return { dayName, resolveWindow, facts, pickGeocoded, answerQuestion };
})();

// ---- sources.js ----
__m['sources'] = (() => {
// sources.js: valinnaisten ulkoisten tietolähteiden hallinta (tutkaennuste, varoitukset, ilmanlaatu).
// Periaate: lähde saa epäonnistua hiljaa. Käyttäjälle ei näytetä virheilmoituksia, ja epäonnistunutta lähdettä ei kokeilla heti uudelleen
// (porrastettu odotus 15 min, 1 h, 6 h, 24 h). Tila näkyy vain "Tietoja ja tietolähteet" -näkymässä ja diagnostiikassa.
// Selaimesta ei voi erottaa CORS-estoa verkkovirheestä, joten kaikki "ei vastannut" -tapaukset käsitellään samalla tavalla.

const { store } = __m['util'];

const SOURCE_INFO = {
  nowcast: {
    name: 'Tutkaennuste',
    provider: 'MET Norway Nowcast',
    url: 'https://api.met.no/weatherapi/nowcast/2.0/',
    license: 'CC BY 4.0 / NLOD',
    note: 'Tutkapohjainen sade seuraavalle kahdelle tunnille (Pohjoismaat).',
  },
  warnings: {
    name: 'Viralliset varoitukset',
    provider: 'Ilmatieteen laitos',
    url: 'https://www.ilmatieteenlaitos.fi/varoitukset',
    license: 'CC BY 4.0',
    note: 'Säävaroitukset (CAP-syöte) sijaintisi alueelle. Haetaan GitHubin kautta, koska Ilmatieteen laitoksen palvelu ei salli selaimen suoraa hakua. Jos tieto on yli puolitoista tuntia vanha, etusivu kertoo sen.',
  },
  obs: {
    name: 'Havainto',
    provider: 'Ilmatieteen laitos, avoin data',
    url: 'https://www.ilmatieteenlaitos.fi/avoin-data',
    license: 'CC BY 4.0',
    note: 'Lähimmän sääaseman mitattu lämpötila: vertailukohta ennusteelle (Varmuus-sivu).',
  },
  air: {
    name: 'Ilmanlaatu ja siitepöly',
    provider: 'Open-Meteo / CAMS',
    url: 'https://open-meteo.com/en/docs/air-quality-api',
    license: 'CC BY 4.0',
    note: 'Mallilaskelma, ei mittaus.',
  },
};

const WAIT_MIN = [15, 60, 360, 1440];

/** Muistinvarainen tallennus (esimerkkitilassa ei kirjoiteta oikeaan localStorageen). */
function memoryStorage() {
  const mem = {};
  return { object: (k) => mem[k] ?? null, set: (k, v) => ((mem[k] = v), true) };
}

function createGuard({ storage = store, clock = () => Date.now() } = {}) {
  const read = () => storage.object('src') || {};
  const entry = (id) => {
    const e = read()[id];
    return e && typeof e === 'object' ? e : {};
  };
  const put = (id, e) => storage.set('src', { ...read(), [id]: e });
  return {
    /** Saako lähdettä yrittää nyt? Epäonnistumisen jälkeen odotetaan. */
    canTry(id, now = clock()) {
      const e = entry(id);
      return !(Number(e.until) > now);
    },
    /** limited = lähde vastasi, mutta tietoa ei voinut käyttää (esim. vanhentunut peili tai ei kattavuutta). */
    ok(id, now = clock(), note = '', limited = false) {
      put(id, { fails: 0, until: 0, lastOk: now, note: String(note).slice(0, 80), ...(limited ? { limited: true } : {}) });
    },
    fail(id, err, now = clock()) {
      const e = entry(id);
      const fails = (Number(e.fails) || 0) + 1;
      put(id, { ...e, fails, until: now + WAIT_MIN[Math.min(fails, WAIT_MIN.length) - 1] * 60000, lastFail: now, error: String(err?.message || err || 'virhe').slice(0, 80) });
    },
    status(id) {
      return entry(id);
    },
  };
}

/**
 * Ajaa lähteen haun suojattuna. Palauttaa { value } onnistuessa, { skipped } kun odotusaika on käynnissä tai laite on offline,
 * ja { error } epäonnistuessa. Ei koskaan heitä. force ohittaa odotuksen (esim. käyttäjä päivitti käsin).
 */
async function runSource(guard, id, fn, { force = false, now = Date.now() } = {}) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { skipped: 'offline' };
  if (!force && !guard.canTry(id, now)) return { skipped: 'odotus' };
  try {
    const value = await fn();
    if (value && value.ok === false) {
      // Lähde vastasi, mutta ei kata paikkaa tai tieto puuttuu: ei virhe, mutta ei käyttökelpoista tietoa
      guard.ok(id, now, value.reason || '', true);
      return { value: null, reason: value.reason || 'ei kattavuutta', raw: value };
    }
    guard.ok(id, now, value?.note || '');
    return { value };
  } catch (e) {
    if (e?.name === 'AbortError' && e?.cancelled) return { skipped: 'peruttu' };
    guard.fail(id, e, now);
    return { error: e };
  }
}

/** Yksi rivi diagnostiikkaan ja tietoja-näkymään: "✓ Tutkaennuste (MET Norway Nowcast)" tai "– … ei vastannut (odotus 15 min)". */
function sourceLine(id, st, now = Date.now()) {
  const info = SOURCE_INFO[id];
  if (!info) return '';
  const head = `${info.name} (${info.provider})`;
  if (st?.lastFail && (!st.lastOk || st.lastFail > st.lastOk)) {
    const wait = Math.max(0, Math.ceil((Number(st.until) - now) / 60000));
    return `– ${head}: ei vastannut${st.error ? ` (${st.error})` : ''}${wait ? `, uusi yritys ${wait >= 90 ? `${Math.round(wait / 60)} h` : `${wait} min`} päästä` : ''}`;
  }
  if (st?.lastOk) return `${st.limited ? '!' : '✓'} ${head}${st.note ? `: ${st.note}` : ''}`;
  return `· ${head}: ei vielä kokeiltu`;
}

/**
 * Yksi verkkopyyntö aikarajalla ja ulkoisella peruutuksella; read(res) lukee vastauksen rungon saman aikarajan sisällä.
 * Heittää "<label>: aikakatkaisu", kun aikaraja täyttyy, ja AbortError (cancelled = true), kun signal peruttiin.
 */
async function timedRequest(fetchFn, url, init, { timeoutMs = 8000, signal = null, label = 'Haku' } = {}, read = (res) => res) {
  const ctl = new AbortController();
  let cancelled = false;
  const onAbort = () => {
    cancelled = true;
    ctl.abort();
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await read(await fetchFn(url, { ...init, signal: ctl.signal }));
  } catch (e) {
    if (cancelled) throw Object.assign(new Error('Peruttu'), { name: 'AbortError', cancelled: true });
    if (ctl.signal.aborted) throw new Error(`${label}: aikakatkaisu`);
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}
return { SOURCE_INFO, memoryStorage, createGuard, runSource, sourceLine, timedRequest };
})();

// ---- nowcast.js ----
__m['nowcast'] = (() => {
// nowcast.js: tutkapohjainen lähiennuste seuraavalle kahdelle tunnille (MET Norway Nowcast 2.0, kattaa Pohjoismaat).
// "Koodi laskee": sadeintensiteetit tulkitaan täällä, ja neuvokaista, chat ja (myöhemmin) widget käyttävät samaa tulosta.
// Lähde on lisä. Jos se ei vastaa, ei kata paikkaa tai on vanhentunut, sovellus toimii kuten ennenkin eikä näytä virhettä.
// Selaimesta ei voi asettaa User-Agent-otsikkoa, eikä CORS-tukea voi varmistaa tästä ympäristöstä: siksi haku on aina suojattu (sources.js).

const { defaultFetch } = __m['util'];
const { timedRequest } = __m['sources'];

const NOWCAST_BASE = 'https://api.met.no/weatherapi/nowcast/2.0/complete';

/** Tätä pienempi sadeintensiteetti (mm/h) on tutkakohinaa eikä kerro sateesta. */
const WET_MMH = 0.2;
/** Tätä vanhempaa ennustetta ei käytetä: lähiennuste vanhenee nopeasti. */
const STALE_MIN = 30;
const DEFAULT_STEP_MS = 5 * 60000;

function nowcastUrl(lat, lon) {
  const q = new URLSearchParams({ lat: Number(lat).toFixed(2), lon: Number(lon).toFixed(2) }); // 2 desimaalia riittää tutkalle (1 km ruudukko)
  return `${NOWCAST_BASE}?${q.toString()}`;
}

/**
 * Jäsentää MET:n vastauksen. Palauttaa { ok:false, reason } kun tutka ei kata paikkaa tai on pois käytöstä,
 * ja { ok:true, updated, steps:[{t, rate}] } muuten. Heittää vain, jos rakenne on odottamaton (silloin lähde merkitään epäonnistuneeksi).
 */
function parseNowcast(json) {
  const props = json?.properties;
  if (!props || !Array.isArray(props.timeseries)) throw new Error('Tutkaennusteen rakenne ei vastaa odotettua');
  const coverage = String(props.meta?.radar_coverage ?? 'ok').toLowerCase();
  if (coverage !== 'ok') return { ok: false, reason: coverage === 'no coverage' ? 'ei tutkakattavuutta' : 'tutka ei käytettävissä', coverage };
  const steps = [];
  for (const row of props.timeseries) {
    const t = Date.parse(row?.time);
    const rate = row?.data?.instant?.details?.precipitation_rate;
    // null ei saa muuttua nollaksi: puuttuva arvo on "ei tietoa", ei "kuivaa"
    if (Number.isFinite(t) && typeof rate === 'number' && Number.isFinite(rate)) steps.push({ t, rate: Math.max(0, rate) });
  }
  steps.sort((a, b) => a.t - b.t);
  if (steps.length < 3) throw new Error('Tutkaennusteessa ei ole sadearvioita');
  const updated = Date.parse(props.meta?.updated_at);
  return { ok: true, coverage, updated: Number.isFinite(updated) ? updated : steps[0].t, steps };
}

function stepMs(steps) {
  const d = [];
  for (let i = 1; i < steps.length; i++) d.push(steps[i].t - steps[i - 1].t);
  d.sort((a, b) => a - b);
  const m = d.length ? d[Math.floor(d.length / 2)] : DEFAULT_STEP_MS;
  return m >= 60000 && m <= 30 * 60000 ? m : DEFAULT_STEP_MS;
}

const round5 = (min) => Math.max(0, Math.round(min / 5) * 5);

/** Sateen voimakkuus suomeksi (mm/h): heikkoa, kohtalaista, runsasta, rankkaa. */
function intensityWord(mmh) {
  if (mmh < 0.5) return 'heikkoa';
  if (mmh < 4) return 'kohtalaista';
  if (mmh < 8) return 'runsasta';
  return 'rankkaa';
}

// "seuraavaan 2 tuntiin" (illatiivi) ja "seuraavat 2 tuntia" (partitiivi)
function horizonPhrase(min) {
  if (min >= 105) return { into: '2 tuntiin', for: '2 tuntia' };
  if (min >= 50) return { into: 'tuntiin', for: 'tunnin' };
  const m = Math.max(5, round5(min));
  return { into: `${m} minuuttiin`, for: `${m} minuuttia` };
}

/**
 * Tulkitsee jäsennetyn tutkaennusteen hetkelle nowMs. Kutsutaan uudelleen jokaisella piirrolla, jotta "15 min päästä" laskee itsestään.
 * Palauttaa { ok:false, reason } tai
 * { ok:true, state:'dry'|'wet', startMin, endMin, horizonMin, peak, mm, word, tail, line, updated }.
 *   tail: lauseenosa ilman alkua ("sade alkaa noin 15 min päästä"), line: valmis lause näkymälle.
 *   dry: startMin = sateen alkuun (null, jos ei sadetta ennustejaksolla)
 *   wet: endMin = sateen loppuun (null, jos sade jatkuu koko ennustejakson)
 * Yksittäinen märkä askel ei riitä (kohina): sateen pitää kestää vähintään kaksi peräkkäistä askelta tai olla yli 1 mm/h.
 */
function summarizeNowcast(nc, nowMs = Date.now()) {
  if (!nc) return { ok: false, reason: 'ei tietoa' };
  if (nc.ok === false) return { ok: false, reason: nc.reason || 'ei tietoa' };
  const steps = nc.steps;
  if (!Array.isArray(steps) || steps.length < 3) return { ok: false, reason: 'ei tietoa' };
  const dt = stepMs(steps);
  const endT = steps[steps.length - 1].t + dt;
  if (nowMs - nc.updated > STALE_MIN * 60000 || nowMs >= endT) return { ok: false, reason: 'vanhentunut', stale: true };

  let cur = 0;
  for (let i = 0; i < steps.length; i++) if (steps[i].t <= nowMs) cur = i;
  const last = steps.length - 1;
  const wetAt = (i) => i <= last && steps[i].rate >= WET_MMH;
  const wetRun = (i) => wetAt(i) && (steps[i].rate >= 1 || i === last || wetAt(i + 1) || (i > 0 && wetAt(i - 1)));
  const dryRun = (i) => !wetAt(i) && (i === last || !wetAt(i + 1));
  const minTo = (i) => (steps[i].t - nowMs) / 60000;
  const horizonMin = Math.floor((endT - nowMs) / 60000);
  const hz = horizonPhrase(horizonMin);
  const span = (from, to) => {
    let peak = 0;
    let mm = 0;
    for (let i = from; i <= Math.min(to, last); i++) {
      peak = Math.max(peak, steps[i].rate);
      mm += (steps[i].rate * dt) / 3600000;
    }
    return { peak, mm: Math.round(mm * 10) / 10 };
  };
  const out = { ok: true, updated: nc.updated, horizonMin };

  if (wetRun(cur)) {
    let j = -1;
    for (let i = cur + 1; i <= last; i++) {
      if (dryRun(i)) {
        j = i;
        break;
      }
    }
    const endMin = j >= 0 ? round5(minTo(j)) : null;
    const { peak, mm } = span(cur, j >= 0 ? j - 1 : last);
    const word = intensityWord(peak);
    const tail = endMin == null ? `sade jatkuu ainakin seuraavat ${hz.for}` : endMin <= 5 ? 'sade on loppumassa' : `sade päättyy noin ${endMin} min päästä`;
    return { ...out, state: 'wet', startMin: 0, endMin, peak, mm, word, tail, line: `Sataa nyt (${word}). Tutkan mukaan ${tail}.` };
  }

  let j = -1;
  for (let i = cur + 1; i <= last; i++) {
    if (wetRun(i)) {
      j = i;
      break;
    }
  }
  if (j < 0) {
    const tail = `ei sadetta seuraavaan ${hz.into}`;
    return { ...out, state: 'dry', startMin: null, endMin: null, peak: 0, mm: 0, word: '', tail, line: `Tutkan mukaan ${tail}.` };
  }
  const startMin = round5(minTo(j));
  const { peak, mm } = span(j, j + 11); // tunnin ajan alusta
  const word = intensityWord(peak);
  const tail = startMin <= 5 ? 'sade alkaa aivan pian' : `sade alkaa noin ${startMin} min päästä`;
  return { ...out, state: 'dry', startMin, endMin: null, peak, mm, word, tail, line: `Tutkan mukaan ${tail} (${word}).` };
}

/**
 * Hakee ja jäsentää ennusteen. Ei lisää muita otsikoita kuin Accept (CORS-turvallinen), eikä käytä välimuistiasetuksia.
 * Heittää verkko- ja rakennevirheistä (kutsuja suojaa ne sources.js:llä); palauttaa { ok:false } kun paikkaa ei katettu.
 */
function fetchNowcast(lat, lon, { fetchFn = defaultFetch, timeoutMs = 6000, signal = null } = {}) {
  return timedRequest(fetchFn, nowcastUrl(lat, lon), { headers: { Accept: 'application/json' } }, { timeoutMs, signal, label: 'Tutkaennuste' }, async (res) => {
    if (res.status === 400 || res.status === 404 || res.status === 422) return { ok: false, reason: 'ei tutkakattavuutta' };
    if (!res.ok) throw Object.assign(new Error(`Tutkaennuste: HTTP ${res.status}`), { status: res.status });
    return parseNowcast(await res.json());
  });
}
return { NOWCAST_BASE, WET_MMH, STALE_MIN, nowcastUrl, parseNowcast, intensityWord, summarizeNowcast, fetchNowcast };
})();

// ---- warnings.js ----
__m['warnings'] = (() => {
// warnings.js: Ilmatieteen laitoksen viralliset säävaroitukset (CAP 1.2 -syöte, alerts.fmi.fi).
// Selain ei voi hakea syötettä suoraan, koska palvelu ei salli sitä (CORS). Siksi GitHub Actions hakee syötteen itse (tools/mirror-warnings.mjs),
// tiivistää sen ja tallentaa repon haaraan warnings-data, josta sovellus lukee sen (MIRROR_URL). Syöte on koko Suomen kattava:
// vaikuttavat varoitukset valitaan laitteella pisteen ja monikulmion leikkauksella, joten sijaintia ei lähetetä mihinkään.
// Lähde on lisä: jos peili ei vastaa tai on vanhentunut, sovellus ei näytä virhettä (sources.js).
// Atom-syötteen CAP voi olla upotettuna, tekstinä <content>-elementin sisällä tai vain linkkinä; kaikki kolme tuetaan (peilityökalu käyttää näitä).
// XML luetaan pienellä omalla jäsentimellä (DOMParser ei ole Nodessa, ja jäsentimen pitää olla testattavissa ilman selainta).

const { defaultFetch, localNow } = __m['util'];
const { timedRequest } = __m['sources'];

const MIRROR_URL = 'https://raw.githubusercontent.com/juukal-ctrl/saaaly/warnings-data/warnings.json';
const FMI_WARNINGS_PAGE = 'https://www.ilmatieteenlaitos.fi/varoitukset';
const MAX_XML = 16_000_000; // oikea syöte sisältää kolmikielisiä monikulmioita ja voi olla useita megatavuja
const MAX_DEPTH = 64;

// ---------- XML ----------

const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENT[e] ?? m;
  });
const local = (name) => name.slice(name.indexOf(':') + 1); // nimiavaruuden etuliite pois: cap:alert -> alert
const TOKEN = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?][^\s/>]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)|(<)/g;
const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Pieni toleranssi XML-jäsennin: elementit, attribuutit, teksti, CDATA. Palauttaa { name, attrs, kids, text }-puun. Heittää, jos rakenne on rikki. */
function parseXml(src) {
  if (typeof src !== 'string' || src.length > MAX_XML) throw new Error('XML ei jäsenny');
  const root = { name: '#root', attrs: {}, kids: [], text: '' };
  const stack = [root];
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2] !== undefined) {
      if (stack.length < 2 || top.name !== local(m[2])) throw new Error('XML ei jäsenny');
      stack.pop();
    } else if (m[3] !== undefined) {
      const attrs = {};
      for (const a of m[4].matchAll(ATTR)) attrs[local(a[1])] = decode(a[2] ?? a[3] ?? '');
      const node = { name: local(m[3]), attrs, kids: [], text: '' };
      top.kids.push(node);
      if (!m[5]) {
        if (stack.length > MAX_DEPTH) throw new Error('XML ei jäsenny');
        stack.push(node);
      }
    } else if (m[6] !== undefined) top.text += decode(m[6]);
    else if (m[7] !== undefined) throw new Error('XML ei jäsenny');
  }
  if (stack.length !== 1 || !root.kids.length) throw new Error('XML ei jäsenny'); // tyhjä vastaus ei ole kelvollinen syöte
  return root;
}

const kids = (n, name) => n.kids.filter((k) => k.name === name);
const kid = (n, name) => n.kids.find((k) => k.name === name);
const txt = (n, name) => (kid(n, name)?.text || '').trim();
function findAll(n, name, out = []) {
  for (const k of n.kids) {
    if (k.name === name) out.push(k);
    findAll(k, name, out);
  }
  return out;
}

// ---------- CAP ----------

const parsePoly = (text) =>
  text
    .trim()
    .split(/\s+/)
    .map((pt) => pt.split(',').map(Number))
    .filter((p) => p.length === 2 && p.every(Number.isFinite)); // [lat, lon]

function alertNodes(root) {
  const alerts = findAll(root, 'alert');
  if (alerts.length) return alerts;
  // CAP voi olla Atom-merkinnän sisällä tekstinä (&lt;alert …&gt;)
  const out = [];
  for (const c of [...findAll(root, 'content'), ...findAll(root, 'summary')]) {
    const s = c.text.trim();
    if (!s.startsWith('<')) continue;
    try {
      out.push(...findAll(parseXml(s), 'alert'));
    } catch {
      /* yksi huono merkintä ei kaada muita */
    }
  }
  return out;
}

/** CAP-varoitukset (Atom-syötteestä tai yksittäisestä CAP-tiedostosta) litteiksi riveiksi yhdellä kielellä. Ei sisällä peruttuja, korvattuja eikä testiviestejä. */
function parseCapAlerts(xml, lang = 'fi-FI') {
  return capFromRoot(parseXml(xml), lang);
}

function capFromRoot(root, lang) {
  const nodes = alertNodes(root);
  const replaced = new Set(); // Cancel ja Update viittaavat aiempaan viestiin (references: "lähettäjä,tunniste,aika")
  for (const a of nodes) {
    const type = txt(a, 'msgType');
    if (type === 'Cancel' || type === 'Update') for (const r of txt(a, 'references').split(/\s+/)) if (r.split(',')[1]) replaced.add(r.split(',')[1]);
  }
  const out = [];
  const seen = new Set();
  for (const a of nodes) {
    const id = txt(a, 'identifier');
    if (txt(a, 'msgType') === 'Cancel' || replaced.has(id) || (id && seen.has(id))) continue;
    const status = txt(a, 'status');
    if (status && status !== 'Actual') continue; // Test, Exercise, Draft
    const infos = kids(a, 'info');
    const info = infos.find((i) => txt(i, 'language') === lang) || infos[0];
    if (!info) continue;
    if (id) seen.add(id);
    const params = Object.fromEntries(kids(info, 'parameter').map((p) => [txt(p, 'valueName'), txt(p, 'value')]));
    out.push({
      id,
      event: txt(info, 'event'),
      severity: txt(info, 'severity'),
      color: params.color || '',
      headline: txt(info, 'headline'),
      description: txt(info, 'description'),
      instruction: txt(info, 'instruction'),
      onset: Date.parse(txt(info, 'onset') || txt(info, 'effective') || txt(a, 'sent')),
      expires: Date.parse(txt(info, 'expires')),
      areas: kids(info, 'area').map((ar) => ({ desc: txt(ar, 'areaDesc'), polys: kids(ar, 'polygon').map((p) => parsePoly(p.text)).filter((r) => r.length >= 3) })),
    });
  }
  return out;
}

/** Atom-syöte: { alerts, links }. links on CAP-tiedostojen osoitteet silloin, kun merkinnät vain viittaavat niihin. */
function parseCapFeed(xml, lang = 'fi-FI') {
  const root = parseXml(xml);
  const alerts = capFromRoot(root, lang);
  const links = [];
  for (const entry of findAll(root, 'entry')) {
    for (const l of kids(entry, 'link')) {
      const href = l.attrs.href || '';
      if (/^https:\/\//.test(href) && (/cap/i.test(l.attrs.type || '') || /\.xml$/i.test(href)) && !links.includes(href)) links.push(href);
    }
  }
  return { alerts, links };
}

/** Syöte koskee vain Suomea (ja sen merialueita): muualla ei haeta eikä näytetä mitään. */
const inFinland = (lat, lon) => lat >= 59.4 && lat <= 70.2 && lon >= 19 && lon <= 32;

/** Säteenheitto-testi [lat, lon] -pisteistä koostuvalle renkaalle. */
function inPoly(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Voimassa olevat varoitukset, joiden alueeseen piste kuuluu. */
const warningsAt = (list, lat, lon, now = Date.now()) => list.filter((w) => w.expires > now && w.areas.some((a) => a.polys.some((r) => inPoly(lat, lon, r))));

// ---------- Näkymälle ----------

const WD = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];
const TZ = 'Europe/Helsinki';
const stamp = (ms) => {
  const l = localNow(ms, TZ);
  const [y, m, d] = l.date.split('-').map(Number);
  return { date: l.date, hour: l.hour, label: `${WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}.${m}.` };
};

/** "voimassa nyt, päättyy tänään klo 18" / "huomenna klo 06–12" / "ti 17.11. klo 22 – ke 18.11. klo 08" */
function whenText(onset, expires, nowMs) {
  const today = stamp(nowMs).date;
  const tomorrow = stamp(nowMs + 86400000).date;
  const day = (s) => (s.date === today ? 'tänään' : s.date === tomorrow ? 'huomenna' : s.label);
  const b = stamp(expires);
  if (!(onset > nowMs)) return `voimassa nyt, päättyy ${day(b)} klo ${b.hour}`;
  const a = stamp(onset);
  if (a.date === b.date) return `${day(a)} klo ${a.hour}–${b.hour}`;
  return `${day(a)} klo ${a.hour} – ${day(b)} klo ${b.hour}`;
}

const RANK = { Extreme: 3, Severe: 2, Moderate: 1 };
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Varoitukset alertsHtml-rivien muotoon ({severity, title, when, text}): vain voimassa olevat ja seuraavan 48 tunnin sisällä alkavat, vakavin ensin. */
function officialRows(list, lat, lon, nowMs, max = 3) {
  return warningsAt(list, lat, lon, nowMs)
    .filter((w) => RANK[w.severity] && !(w.onset > nowMs + 48 * 3600000)) // Minor ja tuntematon eivät ole varoituksia
    .sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.onset - b.onset)
    .slice(0, max)
    .map((w) => {
      const area = w.areas.find((a) => a.polys.some((r) => inPoly(lat, lon, r)))?.desc || '';
      return {
        id: w.id,
        severity: w.severity,
        title: w.event || w.headline || 'Säävaroitus',
        when: [area, whenText(w.onset, w.expires, nowMs)].filter(Boolean).join(' · '),
        time: whenText(w.onset, w.expires, nowMs),
        area,
        text: clip([w.description, w.instruction].filter(Boolean).join(' '), 600),
      };
    });
}

// ---------- Peili ----------

const MIRROR_VERSION = 1;
const MIRROR_MAX_AGE = 6 * 3600000; // tätä vanhempaa peiliä ei käytetä: varoitus on voinut tulla sen jälkeen
// Rajat on mitoitettu oikeasta aineistosta (17.11.2026: 7 varoitusta, enintään 35 aluetta ja 2177 pistettä per rengas, yhteensä 590 kt) reilusti yläkanttiin.
// Liikennesää-varoituksissa on kuntakohtaisia alueita kymmeniä, ja laajassa ilmiössä varoituksia on moninkertaisesti.
const MAX_JSON = 6_000_000;
const MAX_ALERTS = 200;
const MAX_AREAS = 500;
const MAX_POLYS = 50;
const MAX_RING = 20000;
const SEVERITIES = new Set(['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown']);
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const r3 = (n) => Math.round(n * 1000) / 1000; // 0,001 asteen tarkkuus (noin 100 m) riittää varoitusalueille ja pienentää tiedostoa

/** Tiivis, selaimelle sopiva muoto: sama kuin parseCapFeedin rivit, mutta pyöristetyin koordinaatein ja lyhennetyin tekstein. */
function buildMirror(alerts, nowMs = Date.now()) {
  const slim = (a) => ({
    id: str(a.id, 120),
    event: str(a.event, 120),
    severity: a.severity,
    color: str(a.color, 20),
    headline: str(a.headline, 200),
    description: str(a.description, 800),
    instruction: str(a.instruction, 800),
    onset: Number.isFinite(a.onset) ? a.onset : null,
    expires: a.expires,
    areas: a.areas.map((ar) => ({ desc: str(ar.desc, 120), polys: ar.polys.map((ring) => ring.map(([la, lo]) => [r3(la), r3(lo)])) })),
  });
  return {
    v: MIRROR_VERSION,
    source: 'alerts.fmi.fi',
    fetchedAt: new Date(nowMs).toISOString(),
    alerts: alerts
      .filter((a) => Number.isFinite(a.expires) && a.expires > nowMs - 3600000 && a.areas.length)
      .sort((a, b) => (RANK[b.severity] || 0) - (RANK[a.severity] || 0) || (a.onset || 0) - (b.onset || 0))
      .slice(0, MAX_ALERTS) // vakavimmat säilyvät, jos varoituksia on poikkeuksellisen paljon
      .map(slim),
  };
}

function cleanRing(r) {
  if (!Array.isArray(r) || r.length < 3 || r.length > MAX_RING) return null;
  for (const p of r) {
    // Suomi ja sen merialueet; muu kertoo rikkinäisestä tai väärästä aineistosta
    if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'number' || typeof p[1] !== 'number' || !(p[0] >= 50 && p[0] <= 75 && p[1] >= 10 && p[1] <= 40)) return null;
  }
  return r.map(([la, lo]) => [la, lo]);
}

const fmtStamp = (ms) => {
  const t = stamp(ms);
  return `${t.label} klo ${t.hour}`;
};

/**
 * Tarkistaa peilin ja palauttaa { ok:true, alerts, fetchedAt, note } tai { ok:false, reason }, kun peili on liian vanha.
 * Heittää, jos muoto ei täsmää. Aineisto ei ole luotettua: jokainen kenttä tarkistetaan ja rajataan, jotta rikkinäinen tiedosto ei kaada näkymää.
 */
function parseMirror(data, nowMs = Date.now()) {
  if (!data || typeof data !== 'object' || data.v !== MIRROR_VERSION || !Array.isArray(data.alerts)) throw new Error('Varoitukset: peilin muoto ei täsmää');
  const at = Date.parse(data.fetchedAt);
  if (!Number.isFinite(at)) throw new Error('Varoitukset: peilin aikaleima puuttuu');
  if (nowMs - at > MIRROR_MAX_AGE) return { ok: false, reason: `peili on vanhentunut (päivitetty ${fmtStamp(at)})`, fetchedAt: at };
  const alerts = [];
  for (const a of data.alerts.slice(0, MAX_ALERTS)) {
    if (!a || typeof a !== 'object' || typeof a.expires !== 'number' || !Number.isFinite(a.expires)) continue;
    const areas = (Array.isArray(a.areas) ? a.areas : [])
      .slice(0, MAX_AREAS)
      .map((ar) => ({ desc: str(ar?.desc, 120), polys: (Array.isArray(ar?.polys) ? ar.polys : []).slice(0, MAX_POLYS).map(cleanRing).filter(Boolean) }))
      .filter((ar) => ar.polys.length);
    if (!areas.length) continue;
    alerts.push({
      id: str(a.id, 120),
      event: str(a.event, 120),
      severity: SEVERITIES.has(a.severity) ? a.severity : '',
      color: str(a.color, 20),
      headline: str(a.headline, 200),
      description: str(a.description, 800),
      instruction: str(a.instruction, 800),
      onset: typeof a.onset === 'number' && Number.isFinite(a.onset) ? a.onset : 0,
      expires: a.expires,
      areas,
    });
  }
  return { ok: true, alerts, fetchedAt: at, note: `${alerts.length} voimassa tai tulossa koko maassa, peili päivitetty ${fmtStamp(at)}` };
}

// ---------- Haku ----------

/**
 * Hakee peilin ja palauttaa { ok:true, alerts, fetchedAt, note } (tai { ok:false, reason }, kun peili on vanhentunut).
 * Heittää verkko-, HTTP- ja rakennevirheistä (kutsuja suojaa ne sources.js:llä). Ei lisää omia otsikoita, joten CORS-esitarkistusta ei tarvita.
 */
async function fetchWarnings({ fetchFn = defaultFetch, timeoutMs = 8000, signal = null, now = Date.now() } = {}) {
  const opts = { timeoutMs, signal, label: 'Varoitukset' };
  const text = (res) => {
    if (!res.ok) throw Object.assign(new Error(res.status === 404 ? 'Varoitukset: peiliä ei löytynyt (GitHub Actions -ajo ei ole vielä luonut sitä)' : `Varoitukset: HTTP ${res.status}`), { status: res.status });
    return res.text();
  };
  const body = await timedRequest(fetchFn, MIRROR_URL, {}, opts, text);
  if (body.length > MAX_JSON) throw new Error('Varoitukset: peili on liian suuri');
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error('Varoitukset: peili ei ole luettavaa JSONia');
  }
  return parseMirror(data, now);
}
return { MIRROR_URL, FMI_WARNINGS_PAGE, parseXml, parseCapAlerts, parseCapFeed, inFinland, inPoly, warningsAt, whenText, officialRows, buildMirror, parseMirror, fetchWarnings };
})();

// ---- observations.js ----
__m['observations'] = (() => {
// observations.js: lähimmän Ilmatieteen laitoksen havaintoaseman mitattu lämpötila (avoin data, WFS-latauspalvelu, CC BY 4.0).
// Havainto on vertailukohta ennusteelle: Varmuus-sivu näyttää, kuinka lähellä SääÄlyn "nyt"-arvo on mitattua.
// Lähde on lisä. Jos palvelu ei vastaa, ei salli selaimen hakua tai lähellä ei ole asemaa, mitään ei näytetä (sources.js).

const { parseXml } = __m['warnings'];
const { timedRequest } = __m['sources'];
const { defaultFetch } = __m['util'];

const OBS_BASE = 'https://opendata.fmi.fi/wfs';
const MAX_TEXT = 2_000_000;
const MAX_KM = 35; // tätä kauempana oleva asema ei kuvaa paikan säätä

/** Hakuosoite: viimeisen tunnin lämpötila kymmenen minuutin välein lähimmältä asemalta. */
function obsUrl(lat, lon, nowMs = Date.now()) {
  const start = new Date(nowMs - 70 * 60000).toISOString().slice(0, 16) + ':00Z';
  const q = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'getFeature',
    storedquery_id: 'fmi::observations::weather::timevaluepair',
    latlon: `${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}`, // noin 1 km:n tarkkuus kuten muissa lähteissä; lähin asema löytyy silti
    maxlocations: '1',
    parameters: 't2m',
    timestep: '10',
    starttime: start,
  });
  return `${OBS_BASE}?${q.toString()}`;
}

function walk(n, fn) {
  for (const k of n.kids) {
    fn(k);
    walk(k, fn);
  }
}

const km = (a, b, c, d) => {
  const R = 6371;
  const dLat = ((c - a) * Math.PI) / 180;
  const dLon = ((d - b) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a * Math.PI) / 180) * Math.cos((c * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

/**
 * Jäsentää WFS-vastauksen (timevaluepair). Palauttaa { name, lat, lon, t, value } viimeisimmästä arvosta, joka ei ole NaN, tai null.
 * Aineisto ei ole luotettua: arvot tarkistetaan ja rajataan.
 */
function parseObs(xml) {
  const root = parseXml(xml);
  let name = '';
  let pos = null;
  const pts = [];
  walk(root, (n) => {
    if (n.name === 'name' && !name && /locationcode\/name/.test(n.attrs.codeSpace || '')) name = n.text.trim().slice(0, 60);
    if (n.name === 'pos' && !pos) {
      const p = n.text.trim().split(/\s+/).map(Number);
      if (p.length >= 2 && p.every(Number.isFinite)) pos = p;
    }
    if (n.name === 'MeasurementTVP') {
      const t = Date.parse((n.kids.find((k) => k.name === 'time')?.text || '').trim());
      const v = Number((n.kids.find((k) => k.name === 'value')?.text || '').trim());
      if (Number.isFinite(t) && Number.isFinite(v) && v > -60 && v < 50) pts.push({ t, v });
    }
  });
  if (!pts.length) return null;
  pts.sort((a, b) => a.t - b.t);
  const last = pts.at(-1);
  return { name, lat: pos ? pos[0] : null, lon: pos ? pos[1] : null, t: last.t, value: last.v };
}

/** Hakee havainnon. { ok:true, name, value, t, km, note } tai { ok:false, reason } (ei asemaa lähellä). Heittää verkko- ja muotovirheistä. */
async function fetchObs(lat, lon, { fetchFn = defaultFetch, now = Date.now(), timeoutMs = 8000, signal = null } = {}) {
  const text = await timedRequest(fetchFn, obsUrl(lat, lon, now), {}, { timeoutMs, signal, label: 'Havainto' }, (res) => {
    if (!res.ok) throw new Error(`Havainto: HTTP ${res.status}`);
    return res.text();
  });
  if (text.length > MAX_TEXT) throw new Error('Havainto: vastaus on liian suuri');
  const o = parseObs(text);
  if (!o) return { ok: false, reason: 'ei havaintoa viimeisen tunnin ajalta' };
  const dist = o.lat != null ? km(lat, lon, o.lat, o.lon) : null;
  if (dist != null && dist > MAX_KM) return { ok: false, reason: `lähin asema ${Math.round(dist)} km päässä` };
  if (now - o.t > 90 * 60000) return { ok: false, reason: 'havainto on vanha' };
  return { ok: true, ...o, km: dist, note: `${o.name || 'asema'}${dist != null ? `, ${Math.round(dist)} km` : ''}` };
}
return { OBS_BASE, obsUrl, parseObs, fetchObs };
})();

// ---- demo.js ----
__m['demo'] = (() => {
// demo.js: synteettinen säädata testeihin ja esikatseluun (?demo=1, ?demo=rain|snow|clear|thunder|fog).
// Tuottaa Open-Meteon vastausmuotoa, joten koko sovelluksen koodipolku (haku, jäsennys, yhdistely) on sama kuin oikealla datalla.

const { FI_CITIES, haversineKm } = __m['geo'];
const { sunPosition } = __m['sun'];
const { localNow, zonedToUtcMs, clamp } = __m['util'];
const { parseCapFeed, buildMirror } = __m['warnings'];

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

const HORIZON_H = { metno_nordic: 60, dmi_harmonie_arome_europe: 60 };
const ENS_POP = new Set(['ecmwf_ifs', 'icon_seamless', 'ukmo_seamless', 'gfs_seamless', 'gem_seamless']);
const UV_MODELS = new Set(['gfs_seamless', 'ukmo_seamless']);

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

  const keys = ['temperature_2m', 'relative_humidity_2m', 'precipitation', 'snowfall', 'weather_code', 'cloud_cover', 'pressure_msl', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'shortwave_radiation', 'precipitation_probability', 'uv_index'];
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
    hourly.relative_humidity_2m.push(Math.round(clamp(62 + 0.3 * cloud + (precip > 0 ? 8 : 0), 30, 100)));
    hourly.precipitation.push(+precip.toFixed(2));
    hourly.snowfall.push(+(precip * snowShare * 0.7).toFixed(2));
    hourly.weather_code.push(code);
    hourly.cloud_cover.push(Math.round(cloud));
    hourly.pressure_msl.push(+(1010 + 7 * Math.sin(i / 40)).toFixed(1));
    hourly.wind_speed_10m.push(+wind.toFixed(1));
    hourly.wind_gusts_10m.push(+(wind * 1.7).toFixed(1));
    hourly.wind_direction_10m.push(Math.round((225 + 40 * Math.sin(i / 23) + 360) % 360));
    const rad = sunAlt > 0 ? Math.max(0, 900 * Math.sin((sunAlt * Math.PI) / 180) * (1 - 0.75 * (cloud / 100))) : 0;
    hourly.shortwave_radiation.push(Math.round(rad));
    // Ensembleihin perustuva sateen todennäköisyys on vain osalla malleista (kuten oikeassa rajapinnassa)
    const hasPop = ENS_POP.has(modelId);
    hourly.precipitation_probability.push(hasPop ? Math.round(precip >= 0.1 ? clamp(52 + precip * 22 + (noise() - 0.5) * 16, 35, 98) : clamp(6 + 0.22 * cloud * (ev + ev2 + 0.1) + (noise() - 0.5) * 6, 0, 34)) : null);
    hourly.uv_index.push(UV_MODELS.has(modelId) ? +Math.max(0, 5.5 * Math.sin((Math.max(0, sunAlt) * Math.PI) / 180) * (1 - 0.7 * (cloud / 100))).toFixed(1) : null);
  }
  // Oikea rajapinta merkitsee sateen, puuskat, säteilyn, UV:n ja säätunnuksen tunnin loppuun: arvo kohdassa t koskee väliä t-1…t.
  // Tuotetaan sama muoto (siirto yhdellä eteenpäin), jotta weather.js:n siirto palauttaa tarkoitetun aikajanan.
  for (const k of ['precipitation', 'snowfall', 'wind_gusts_10m', 'shortwave_radiation', 'uv_index', 'precipitation_probability', 'weather_code']) {
    hourly[k] = [hourly[k][0] ?? null, ...hourly[k].slice(0, -1)];
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

/**
 * MET Nowcast 2.0 -muotoinen synteettinen vastaus (tutkaennuste kahdelle tunnille, viiden minuutin askelin), samassa sääskenaariossa kuin syntheticResponse.
 * Pohjoismaiden (tutkakattavuuden) ulkopuolella palautuu radar_coverage "no coverage".
 */
function syntheticNowcast({ lat, lon, nowMs = Date.now(), tz = 'Europe/Helsinki', scenario = 'mixed' }) {
  const t0 = Math.floor(nowMs / 300000) * 300000;
  const start = zonedToUtcMs(localNow(nowMs, tz).date + 'T00:00', tz);
  const sc = SCENARIOS[scenario];
  const covered = lat >= 54 && lat <= 72 && lon >= 3 && lon <= 35;
  const rate = (ms, k) => {
    const i = (ms - start) / 3600000;
    const r = sc ? sc.precip * (1 + 0.25 * Math.sin(k * 0.9)) : Math.exp(-(((i - 31) / 4.5) ** 2)) * 1.9 + 0.45 * Math.exp(-(((i - 82) / 5) ** 2)) * 1.2;
    return r < 0.1 ? 0 : +r.toFixed(1);
  };
  const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [+lon.toFixed(4), +lat.toFixed(4), 12] },
    properties: {
      meta: { updated_at: iso(t0), radar_coverage: covered ? 'ok' : 'no coverage', units: { precipitation_rate: 'mm/h' } },
      timeseries: Array.from({ length: 25 }, (_, k) => ({ time: iso(t0 + k * 300000), data: { instant: { details: { precipitation_rate: rate(t0 + k * 300000, k) } } } })),
    },
  };
}

const DEMO_WARNINGS = {
  thunder: ['Ukkosvaroitus', 'Severe', 'orange', 'Voimakkaita ukkoskuuroja, paikoin rakeita. Kuurojen mukana voi tulla puuskia yli 20 m/s.'],
  snow: ['Liukkausvaroitus', 'Moderate', 'yellow', 'Tiet ja kevyen liikenteen väylät voivat olla erittäin liukkaita.'],
};

/** CAP-muotoinen synteettinen varoitussyöte (Atom) Varsinais-Suomen alueelle; demo muuttaa sen peiliksi kuten oikea peilityökalu. Vain ukkos- ja lumiskenaariossa on varoitus; muuten syöte on tyhjä. */
function syntheticWarningsFeed({ nowMs = Date.now(), scenario = 'mixed' } = {}) {
  const d = DEMO_WARNINGS[scenario];
  const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
  const poly = '59.9,21.0 61.0,21.0 61.0,23.5 59.9,23.5 59.9,21.0';
  const entry = d
    ? `<entry><id>demo-1</id><title>${d[0]}</title><content type="text/xml"><alert xmlns="urn:oasis:names:tc:emergency:cap:1.2"><identifier>demo-1</identifier><sender>esimerkki</sender><sent>${iso(nowMs - 3600000)}</sent><status>Actual</status><msgType>Alert</msgType><scope>Public</scope><info><language>fi-FI</language><category>Met</category><event>${d[0]}</event><urgency>Immediate</urgency><severity>${d[1]}</severity><certainty>Likely</certainty><onset>${iso(nowMs - 3600000)}</onset><expires>${iso(nowMs + 5 * 3600000)}</expires><headline>${d[0]} Varsinais-Suomi (esimerkki)</headline><description>${d[3]}</description><instruction>Esimerkkitila: tämä varoitus on tekaistu.</instruction><parameter><valueName>color</valueName><value>${d[2]}</value></parameter><area><areaDesc>Varsinais-Suomi</areaDesc><polygon>${poly}</polygon></area></info></alert></content></entry>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Esimerkkivaroitukset</title>${entry}</feed>`;
}

/** WFS-muotoinen synteettinen havainto (timevaluepair): lämpötila on yhdistelmäennusteen tuntumassa, puoli astetta sivussa. */
function syntheticObs({ lat, lon, nowMs = Date.now(), scenario = 'mixed' }) {
  const sc = SCENARIOS[scenario];
  const base = sc ? sc.temp : 10;
  const t0 = Math.floor(nowMs / 600000) * 600000;
  const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
  const pts = Array.from({ length: 6 }, (_, k) => `<wml2:point><wml2:MeasurementTVP><wml2:time>${iso(t0 - (5 - k) * 600000)}</wml2:time><wml2:value>${(base - 0.6 + k * 0.05).toFixed(1)}</wml2:value></wml2:MeasurementTVP></wml2:point>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:gml="http://www.opengis.net/gml/3.2" xmlns:wml2="http://www.opengis.net/waterml/2.0" xmlns:target="http://xml.fmi.fi/namespace/om/atmosphericfeatures/1.1"><wfs:member><target:Location gml:id="loc-1"><gml:identifier codeSpace="http://xml.fmi.fi/namespace/stationcode/fmisid">100949</gml:identifier><gml:name codeSpace="http://xml.fmi.fi/namespace/locationcode/name">Esimerkkiasema</gml:name></target:Location><gml:Point gml:id="p-1"><gml:pos>${(lat + 0.04).toFixed(5)} ${(lon - 0.03).toFixed(5)} </gml:pos></gml:Point><wml2:MeasurementTimeseries gml:id="obs-t2m">${pts}</wml2:MeasurementTimeseries></wfs:member></wfs:FeatureCollection>`;
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
      if (id === 'fmi_seamless' || id === 'dead_model') return json({ error: true, reason: `Cannot initialize MultiDomains from invalid String value ${id} for key models` }, 400);
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
    if (url.hostname === 'api.met.no' && url.pathname.includes('/nowcast/')) {
      return json(syntheticNowcast({ lat: +url.searchParams.get('lat'), lon: +url.searchParams.get('lon'), nowMs: nowMs ?? Date.now(), scenario }));
    }
    if (url.hostname === 'raw.githubusercontent.com' && url.pathname.includes('/warnings-data/')) {
      const now = nowMs ?? Date.now();
      return json(buildMirror(parseCapFeed(syntheticWarningsFeed({ nowMs: now, scenario })).alerts, now)); // sama muoto kuin GitHub Actionsin tekemä peili
    }
    if (url.hostname === 'opendata.fmi.fi') {
      const [la, lo] = (url.searchParams.get('latlon') || '60.45,22.27').split(',').map(Number);
      return new Response(syntheticObs({ lat: la, lon: lo, nowMs: nowMs ?? Date.now(), scenario }), { headers: { 'content-type': 'text/xml' } });
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
return { syntheticResponse, syntheticNowcast, syntheticWarningsFeed, syntheticObs, makeDemoFetch };
})();

// ---- headline.js ----
__m['headline'] = (() => {
// headline.js: etusivun, tuntien, viikon ja varmuuden otsikot yhdestä paikasta.
// Kaikki sadeajat lasketaan samoista sadejaksoista (wetSpans / rainSpansFrom), jotta eri näkymät kertovat saman ajan.
// Puhtaita funktioita: ei DOMia, ei verkkoa.

const { nowPosition, rainSpansFrom, wetSpans, confidence, modelSeries } = __m['blend'];
const { outfit, slippery, ADVICE } = __m['advice'];
const { fmtTemp, fmtNum, weekday, fmtDM, addDays, cap } = __m['util'];

// ---------- Apuja ----------

/** "07" -> "7": juoksevassa tekstissä tunnit ilman etunollaa ("klo 7"). */
const H = (iso) => String(+iso.slice(11, 13));
/** Jakson viimeisen märän tunnin jälkeinen tunti: sade loppuu "klo 16" kun viimeinen märkä tunti on 15. */
const after = (iso) => String((+iso.slice(11, 13) + 1) % 24);
/** "klo 16 asti" / "keskiyöhön asti" */
const kloAsti = (h) => (h === '0' ? 'keskiyöhön' : `klo ${h}`);

const ESS = { su: 'sunnuntaina', ma: 'maanantaina', ti: 'tiistaina', ke: 'keskiviikkona', to: 'torstaina', pe: 'perjantaina', la: 'lauantaina' };

/** Päivä essiivissä: "tänään", "huomenna", "maanantaina". */
function dayEss(date, today) {
  if (date === today) return 'tänään';
  if (date === addDays(today, 1)) return 'huomenna';
  return ESS[weekday(date)];
}

/** Hetken nimi tekstissä: "klo 16", "huomenna klo 7", "yöllä klo 2", "ma klo 11". */
function whenText(iso, today, nowHour = 12) {
  const d = iso.slice(0, 10);
  const h = +iso.slice(11, 13);
  if (d === today) return `klo ${h}`;
  if (d === addDays(today, 1)) return h === 0 ? 'keskiyöllä' : nowHour >= 18 && h < 6 ? `yöllä klo ${h}` : `huomenna klo ${h}`;
  return `${weekday(d)} klo ${h}`;
}

const idxAt = (fc, date, hour) => fc.hours.findIndex((x) => x.t === `${date}T${String(hour).padStart(2, '0')}:00`);

const KIND = {
  rain: { word: 'Sade', now: 'Sataa nyt.', noun: 'sadetta' },
  snow: { word: 'Lumisade', now: 'Sataa lunta.', noun: 'lunta' },
  sleet: { word: 'Räntäsade', now: 'Sataa räntää.', noun: 'räntää' },
};

/** Tuulee sateen aikana niin kovaa, että sateenvarjo kääntyy. */
function windyDuring(fc, s) {
  let w = 0;
  for (let i = s.start; i <= s.end; i++) w = Math.max(w, fc.hours[i]?.wind ?? 0);
  return w >= ADVICE.umbrella.windy;
}

/** Toiminto rivin alkuun: mitä sade tarkoittaa käytännössä. */
function actionLine(fc, s, now) {
  if (s.kind === 'snow') return now ? 'Sataa lunta.' : s.pwin != null && s.pwin < 0.6 ? 'Lumikuuro mahdollinen.' : 'Lunta tulossa.';
  if (s.kind === 'sleet') return now ? 'Sataa räntää.' : s.pwin != null && s.pwin < 0.6 ? 'Räntäkuuro mahdollinen.' : 'Räntää tulossa.';
  if (windyDuring(fc, s)) return 'Sadetakki mukaan.';
  return now || s.pwin == null || s.pwin >= 0.6 ? 'Sateenvarjo mukaan.' : 'Sateenvarjo varmuuden vuoksi.';
}

/** Kuinka pitkään sade jatkuu, kun sataa jo. */
function untilLine(fc, s, today) {
  const word = KIND[s.kind]?.word || 'Sade';
  const len = s.end - s.start + 1;
  if (len >= 20) return s.kind === 'snow' ? 'Lumisade jatkuu koko vuorokauden.' : `${word} jatkuu koko vuorokauden.`;
  const endIso = fc.hours[Math.min(fc.hours.length - 1, s.end + 1)]?.t || fc.hours[s.end].t;
  const d = endIso.slice(0, 10);
  if (d === today || after(fc.hours[s.end].t) === '0') return `${word} jatkuu ${kloAsti(after(fc.hours[s.end].t))} asti.`;
  if (d === addDays(today, 1)) return +endIso.slice(11, 13) <= 9 ? `${word} jatkuu huomisaamuun.` : `${word} jatkuu huomiseen klo ${H(endIso)} asti.`;
  return `${word} jatkuu ${dayEss(d, today)} asti.`;
}

/** Sadejaksot, jotka osuvat väliin from..to (myös ennen väliä alkaneet). */
function spansIn(fc, from, to) {
  return wetSpans(fc, Math.max(0, from - 12), to).filter((s) => s.end >= from && s.start <= to);
}

/** Seuraava sade hetkestä fromIdx eteenpäin koko ennusteen ajalta, tai null. */
function nextRain(fc, fromIdx) {
  const last = fc.hours.length - 1;
  if (fromIdx > last) return null;
  return wetSpans(fc, fromIdx, last)[0] || null;
}

/** "Seuraava sade ma klo 11." tai "Ei sadetta lähipäivinä." */
function nextRainLine(fc, fromIdx, today, nowHour = 12) {
  const s = nextRain(fc, fromIdx);
  if (!s) return 'Ei sadetta lähipäivinä.';
  const noun = s.kind === 'snow' ? 'lumisade' : s.kind === 'sleet' ? 'räntäsade' : 'sade';
  return `Seuraava ${noun} ${whenText(fc.hours[s.start].t, today, nowHour)}.`;
}

function slipperyLine(fc, from, to, today, nowHour) {
  const sl = slippery(fc, from, to);
  if (sl.level < 2) return '';
  const a = fc.hours[sl.start].t;
  const b = fc.hours[sl.end].t;
  const prefix = a.slice(0, 10) === today ? '' : a.slice(0, 10) === addDays(today, 1) ? (nowHour >= 18 && +a.slice(11, 13) < 9 ? 'aamulla ' : 'huomenna ') : `${weekday(a.slice(0, 10))} `;
  const range = sl.start === sl.end ? `klo ${H(a)}` : `klo ${H(a)}–${after(b)}`;
  return `${sl.level === 3 ? 'Erittäin liukasta' : 'Liukasta'} ${prefix}${range}.`;
}

function gustLine(fc, from, to) {
  let g = 0;
  for (let i = from; i <= to; i++) g = Math.max(g, fc.hours[i]?.gust ?? 0);
  return g >= ADVICE.gustChip ? `Puuskat jopa ${fmtNum(g)} m/s.` : '';
}

const coatLine = (o) => (o.ref >= 22 ? 'Takkia ei tarvita.' : `${cap(o.tier.short)}.`);

// ---------- Etusivu ----------

/** Tämän päivän tarkasteluväli: nyt … klo 22 (vähintään 6 tuntia). */
function todayWindow(fc, nowMs) {
  const { idx, local } = nowPosition(fc, nowMs);
  const last = fc.hours.length - 1;
  const e22 = idxAt(fc, local.date, 22);
  return { from: idx, to: Math.min(last, Math.max(e22 >= 0 ? e22 : idx, idx + 6)), idx, local };
}

/** Huomisen päiväväli klo 7–21. null, jos ennuste ei ulotu huomiseen. */
function tomorrowWindow(fc, nowMs) {
  const { idx, local } = nowPosition(fc, nowMs);
  const d = addDays(local.date, 1);
  const a = idxAt(fc, d, 7);
  let b = idxAt(fc, d, 21);
  if (a < 0) return null;
  if (b < 0) b = fc.hours.length - 1;
  return { from: a, to: b, idx, local, date: d };
}

const ILL = { su: 'sunnuntaihin', ma: 'maanantaihin', ti: 'tiistaihin', ke: 'keskiviikkoon', to: 'torstaihin', pe: 'perjantaihin', la: 'lauantaihin' };

/** "klo 16", yöllä "klo 2", huomenna "huomiseen klo 14": käytetään muodossa "Kuivaa … asti". */
function untilWhen(iso, today, nowHour) {
  const d = iso.slice(0, 10);
  const h = +iso.slice(11, 13);
  if (d === addDays(today, 1) && h === 0) return 'keskiyöhön';
  if (d === today || (d === addDays(today, 1) && nowHour >= 18 && h < 9)) return `klo ${h}`;
  if (d === addDays(today, 1)) return `huomiseen klo ${h}`;
  return `${ILL[weekday(d)]} klo ${h}`;
}

/**
 * Etusivun otsikko. Kuivana päivänä ensin takki, sateella ensin sateenvarjo ja todellinen alkamis- tai loppumisaika.
 * day: 'today' | 'tomorrow'. nowcast: tutkaennusteen tulkinta (nowcast.js) tai null.
 * Palauttaa { l1, l2, small, wet, kicker, outfit }.
 */
function homeHeadline(fc, nowMs, { day = 'today', sensitivity = 0, nowcast = null } = {}) {
  if (day === 'tomorrow') {
    const w = tomorrowWindow(fc, nowMs);
    if (w) return tomorrowHeadline(fc, w, sensitivity);
  }
  const { from, to, idx, local } = todayWindow(fc, nowMs);
  const today = local.date;
  const hour = local.hour;
  const o = outfit(fc, from, to, { sensitivity });
  const spans = rainSpansFrom(fc, idx, 48);
  const h0 = fc.hours[idx];
  const nc = nowcast && nowcast.ok ? nowcast : null;
  // Sataako nyt: tutka ratkaisee, kun se on käytettävissä. Muuten mallien yhteinen sade tällä tunnilla.
  const cur = spans.find((s) => s.start <= idx);
  const modelNow = h0.precip >= 0.2 && (h0.popAgree ?? 0) >= 0.5;
  const wetNow = nc ? nc.state === 'wet' : Boolean(cur && modelNow);
  const sl = slipperyLine(fc, from, to, today, hour);

  if (wetNow) {
    const s = cur || { start: idx, end: idx, kind: h0.snowShare >= 0.6 ? 'snow' : h0.snowShare >= 0.25 ? 'sleet' : 'rain', pwin: 1 };
    let l2 = untilLine(fc, s, today);
    if (nc && nc.endMin != null && nc.endMin <= 90) l2 = `${KIND[s.kind]?.word || 'Sade'} lakkaa noin ${nc.endMin} min kuluttua.`;
    return { l1: actionLine(fc, s, true), l2, small: [coatLine(o), sl].filter(Boolean).join(' '), wet: true, kicker: '', outfit: o };
  }

  // Tuleva sade tämän päivän välillä. Kun tutka sanoo "kuivaa nyt", mallin seuraavan tunnin sade ei riitä.
  const soon = spans.find((s) => s.start <= to && (!nc || s.end > idx + 1));
  const ncSoon = nc && nc.startMin != null && nc.startMin <= 120;
  if (soon || ncSoon) {
    const s = soon || { start: idx + 1, end: idx + 2, kind: 'rain', pwin: 0.7 };
    const word = KIND[s.kind]?.word || 'Sade';
    let l2;
    if (ncSoon) {
      l2 = nc.startMin < 60 ? `${word} alkaa noin ${Math.max(5, nc.startMin)} min kuluttua.` : `${word} alkaa noin klo ${clockOf(nowMs + nc.startMin * 60000, fc.tz)}.`;
    } else if (s.start <= idx) {
      l2 = `${s.kind === 'snow' ? 'Lumikuuroja' : s.kind === 'sleet' ? 'Räntäkuuroja' : 'Sadekuuroja'} mahdollisia ${kloAsti(after(fc.hours[s.end].t))} asti.`;
    } else {
      l2 = `${word} alkaa ${s.timingUncertain ? 'noin ' : ''}${whenText(fc.hours[s.start].t, today, hour)}.`;
    }
    return { l1: actionLine(fc, s, false), l2, small: [coatLine(o), sl].filter(Boolean).join(' '), wet: true, kicker: '', outfit: o };
  }

  // Kuivaa koko tarkasteluvälin
  const next = spans.find((s) => s.start > to) || nextRain(fc, to + 1);
  const near = next && next.start - idx < 12;
  const l2 = near ? `Kuivaa ${untilWhen(fc.hours[next.start].t, today, hour)} asti.` : hour >= 18 || hour < 5 ? 'Kuivaa koko yön.' : 'Kuivaa koko päivän.';
  const small = sl || gustLine(fc, from, to) || (near ? '' : nextRainLine(fc, to + 1, today, hour));
  return { l1: coatLine(o), l2, small, wet: false, kicker: '', outfit: o };
}

function clockOf(ms, tz) {
  try {
    return new Date(ms).toLocaleTimeString('fi-FI', { hour: 'numeric', minute: '2-digit', timeZone: tz }).replace(':', '.');
  } catch {
    return new Date(ms).toLocaleTimeString('fi-FI', { hour: 'numeric', minute: '2-digit' }).replace(':', '.');
  }
}

function tomorrowHeadline(fc, w, sensitivity) {
  const { from, to, date, local } = w;
  const today = local.date;
  const o = outfit(fc, from, to, { sensitivity });
  const kicker = `Huomenna ${weekday(date)} ${fmtDM(date)}`;
  const spans = spansIn(fc, from, to);
  if (spans.length) {
    const s = spans[0];
    const word = KIND[s.kind]?.word || 'Sade';
    const cover = Math.min(s.end, to) - Math.max(s.start, from) + 1;
    let l2;
    if (cover >= 10) l2 = s.kind === 'snow' ? 'Lunta koko päivän.' : s.kind === 'sleet' ? 'Räntää koko päivän.' : 'Sataa koko päivän.';
    else if (s.start < from) l2 = `${cap(KIND[s.kind]?.noun || 'sadetta')} ${kloAsti(after(fc.hours[s.end].t))} asti.`;
    else l2 = `${word} alkaa ${s.timingUncertain ? 'noin ' : ''}klo ${H(fc.hours[s.start].t)}.`;
    const sl = slipperyLine(fc, from, to, date, 12);
    return { l1: actionLine(fc, s, false), l2, small: [coatLine(o), sl].filter(Boolean).join(' '), wet: true, kicker, outfit: o };
  }
  const small = slipperyLine(fc, from, to, date, 12) || gustLine(fc, from, to) || nextRainLine(fc, to + 1, today, 12);
  return { l1: coatLine(o), l2: 'Kuivaa koko päivän.', small, wet: false, kicker, outfit: o };
}

/** Huomisen tiivis kuva etusivun sankarille: ylin, aamun lämpötila, päivän sää ja tuuli. */
function tomorrowHero(fc, nowMs) {
  const w = tomorrowWindow(fc, nowMs);
  if (!w) return null;
  const d = fc.days.find((x) => x.date === w.date);
  if (!d) return null;
  const morning = fc.hours[idxAt(fc, w.date, 7)] || fc.hours[w.from];
  let wind = 0;
  for (let i = w.from; i <= w.to; i++) wind = Math.max(wind, fc.hours[i].wind);
  return { date: w.date, tmax: d.tmax, tmin: d.tmin, morning: morning.temp, sym: d.sym, wind, from: w.from, to: w.to };
}

// ---------- Tunnit ----------

/** Tunnit-näkymän otsikko seuraavalle vuorokaudelle. */
function hoursHeadline(fc, nowMs, nowcast = null) {
  const { idx, local } = nowPosition(fc, nowMs);
  const today = local.date;
  const hour = local.hour;
  const nc = nowcast && nowcast.ok ? nowcast : null;
  // Tutka ratkaisee nykyhetken kuten etusivulla: kun se sanoo "ei sada nyt", kuluva tunti ei ole sadetta.
  const s = rainSpansFrom(fc, nc && nc.state !== 'wet' ? idx + 1 : idx, 24)[0];
  const endIso = (sp) => fc.hours[Math.min(fc.hours.length - 1, sp.end + 1)].t;
  const close = s && s.start <= idx + 3 ? s : null; // mallin sade, joka osuu tutkan ajoitukseen
  if (nc && nc.state === 'wet') {
    const word = KIND[close?.kind]?.word || 'Sade';
    let l2 = '';
    if (nc.endMin != null && nc.endMin <= 90) l2 = `${word} lakkaa noin ${nc.endMin} min kuluttua.`;
    else if (close) l2 = close.end - idx + 1 >= 24 ? `${word} jatkuu koko vuorokauden.` : `${word} lakkaa ${whenText(endIso(close), today, hour)}.`;
    return [KIND[close?.kind]?.now || 'Sataa nyt.', l2];
  }
  if (nc && nc.startMin != null && nc.startMin <= 120) {
    const word = KIND[close?.kind]?.word || 'Sade';
    const noun = cap(KIND[close?.kind]?.noun || 'sadetta');
    const l1 = nc.startMin < 60 ? `${word} alkaa noin ${Math.max(5, nc.startMin)} min kuluttua.` : `${word} alkaa noin klo ${clockOf(nowMs + nc.startMin * 60000, fc.tz)}.`;
    let l2 = '';
    if (close) l2 = close.end - idx + 1 >= 24 ? `${noun} koko vuorokauden.` : close.end - close.start + 1 >= 12 ? `${noun} pitkään.` : `${noun} ${untilWhen(endIso(close), today, hour)} asti.`;
    return [l1, l2];
  }
  if (s && s.start <= idx) {
    const word = KIND[s.kind]?.word || 'Sade';
    const l2 = s.end - idx + 1 >= 24 ? `${word} jatkuu koko vuorokauden.` : `${word} lakkaa ${whenText(endIso(s), today, hour)}.`;
    return [KIND[s.kind]?.now || 'Sataa nyt.', l2];
  }
  if (s) {
    const noun = KIND[s.kind]?.noun || 'sadetta';
    const l2 = s.end - s.start + 1 >= 12 ? `Sitten ${noun} pitkään.` : `Sitten ${noun} ${untilWhen(endIso(s), today, hour)} asti.`;
    return [`Kuivaa ${untilWhen(fc.hours[s.start].t, today, hour)} asti.`, l2];
  }
  return ['Kuivaa koko vuorokauden.', nextRainLine(fc, idx + 24, today, hour)];
}

// ---------- Viikko ----------

const isWetDay = (d) => /rain|drizzle|sleet|snow|thunder/.test(d.sym) || d.precip >= 1;
const kindOfDay = (d) => (/snow/.test(d.sym) ? 'snow' : /sleet/.test(d.sym) ? 'sleet' : 'rain');

/** Viikon otsikko: lämpötilan suunta ja sateet. days: fc.days (7 ensimmäistä). */
function weekHeadline(days, today) {
  const ds = days.slice(0, 7);
  if (!ds.length) return ['', ''];
  // Lämpötila
  let t;
  const firstMax = ds[0].tmax;
  const thaw = ds.findIndex((d, i) => i > 0 && d.tmax >= 1);
  const freeze = ds.findIndex((d, i) => i > 0 && d.tmax < -0.5);
  if (firstMax < 0 && thaw > 0) t = `Pakkanen hellittää ${dayEss(ds[thaw].date, today)}.`;
  else if (firstMax >= 1 && freeze > 0) t = `Pakkanen palaa ${dayEss(ds[freeze].date, today)}.`;
  else {
    const n = Math.min(2, ds.length);
    const a = ds.slice(0, n).reduce((x, d) => x + d.tmax, 0) / n;
    const b = ds.slice(-n).reduce((x, d) => x + d.tmax, 0) / n;
    t = b - a >= 3 ? 'Viikon aikana lämpenee.' : a - b >= 3 ? 'Viikon aikana kylmenee.' : 'Lämpötila pysyy ennallaan.';
  }
  // Sade
  const wet = ds.map((d, i) => ({ d, i })).filter((x) => isWetDay(x.d));
  let r;
  const nounOf = (d) => ({ rain: 'sadetta', snow: 'lunta', sleet: 'räntää' })[kindOfDay(d)];
  if (!wet.length) r = 'Kuivaa koko viikon.';
  else if (wet.length >= ds.length - 1) r = wet.filter((x) => kindOfDay(x.d) === 'snow').length > wet.length / 2 ? 'Lumisateita lähes koko viikon.' : 'Sateista lähes koko viikon.';
  else if (wet.length === 1) r = `${cap(dayEss(wet[0].d.date, today))} ${nounOf(wet[0].d)}.`;
  else {
    const run = wet.every((x, k) => k === 0 || x.i === wet[k - 1].i + 1);
    const lastIdx = ds.length - 1;
    if (run && wet.at(-1).i === lastIdx && wet.length >= 3) r = `Sateinen jakso alkaa ${dayEss(wet[0].d.date, today)}.`;
    else if (wet.length === 2) r = `${cap(nounOf(wet[0].d))} ${dayEss(wet[0].d.date, today)} ja ${dayEss(wet[1].d.date, today)}.`;
    else {
      const most = wet.reduce((m, x) => (x.d.precip > m.d.precip ? x : m), wet[0]);
      r = `Sadetta useana päivänä, eniten ${dayEss(most.d.date, today)}.`;
    }
  }
  return [t, r];
}

/** "Viikonloppuna: la −6…+1°, su +1…+4°, su sadetta." tai '' (ei viikonloppua näkyvissä tai on jo sunnuntai). */
function weekendLine(days, today) {
  const wd = weekday(today);
  if (wd === 'su') return '';
  const we = days.slice(0, 7).filter((d) => ['la', 'su'].includes(weekday(d.date)) && d.date >= today);
  if (!we.length) return '';
  const parts = we.map((d) => `${weekday(d.date)} ${fmtTemp(d.tmin)}…${fmtTemp(d.tmax)}`);
  const wetDays = we.filter(isWetDay).map((d) => `${weekday(d.date)} ${({ rain: 'sadetta', snow: 'lunta', sleet: 'räntää' })[kindOfDay(d)]}`);
  const label = wd === 'la' ? 'Viikonloppu' : 'Viikonloppuna';
  return `${label}: ${[...parts, ...wetDays].join(', ')}.`;
}

/** Liukkaus päivälle: 0 = ei, 2 = liukasta, 3 = erittäin liukasta. */
function daySlippery(fc, d) {
  return slippery(fc, d.from, d.to).level >= 2 ? slippery(fc, d.from, d.to).level : 0;
}

// ---------- Varmuus ----------

const WORD = { high: 'luotettava', mid: 'melko luotettava', low: 'epävarma', single: 'vain yksi malli' };
const AGREE = { high: 'mallit samaa mieltä', mid: 'mallit osin eri mieltä', low: 'mallit eri mieltä', single: 'vain yksi malli vastasi' };

/** Yhden mallin keskimääräinen poikkeama yhdistelmästä välillä from..to. null, jos mallilla ei ole dataa välille. */
function modelDeviation(r, fc, from, to) {
  const T = modelSeries(r, fc, 'temperature_2m');
  if (!T) return null;
  let n = 0;
  let sum = 0;
  for (let i = from; i <= to; i++) {
    const v = T[i];
    if (v == null) continue;
    n++;
    sum += v - fc.hours[i].temp;
  }
  return n >= Math.max(1, (to - from + 1) * 0.5) ? sum / n : null;
}

/** Varmuus yhdelle välille: sama mittari (confidence) kuin muualla sovelluksessa, helmet malleittain ja sateen ajoitus. */
function certFor(fc, results, from, to, leadH) {
  const len = to - from + 1;
  const c = confidence(fc, from, len, leadH);
  const pearls = (results || [])
    .map((r, k) => ({ r, k }))
    .filter(({ r }) => !r.skipped && !r.coverage)
    .map(({ r, k }) => {
      const dev = r.ok ? modelDeviation(r, fc, from, to) : null;
      return { key: r.model.key, short: r.model.short || r.model.label, k, dev };
    });
  // Sateen alkamisaika vain, jos sade alkaa välin aikana (ei jo valmiiksi sataessa)
  const span = wetSpans(fc, Math.max(0, from - 6), to).find((x) => x.end >= from && x.start <= to) || null;
  let rain = '';
  if (span && span.start > from) {
    const noun = span.kind === 'snow' ? 'lumisade' : span.kind === 'sleet' ? 'räntäsade' : 'sade';
    const at = (i) => (+fc.hours[i].t.slice(11, 13) === 0 ? 'keskiyöllä' : `klo ${H(fc.hours[i].t)}`);
    const lo = span.startLo ?? span.start;
    const hi = span.startHi ?? span.start;
    if (hi - lo >= 2 && fc.hours[lo] && fc.hours[hi]) rain = `${noun} alkaa klo ${H(fc.hours[lo].t)}–${H(fc.hours[hi].t)} mallista riippuen`;
    else rain = `${noun} alkaa ${at(span.start)}`;
  }
  const sd = c.avg;
  const parts = [];
  const temp = `lämpötilassa useimmat mallit ±${fmtNum(Math.max(0.1, sd), 1)}°`;
  if (c.level === 'single') parts.push('vertailua ei voi tehdä');
  else if (c.why === 'rain') parts.push(rain ? `ero sateen ajoituksessa: ${rain}` : 'ero sateen ajoituksessa', temp);
  else if (c.why === 'wind') parts.push('ero tuulen voimakkuudessa', temp);
  else {
    parts.push(temp);
    if (rain) parts.push(rain);
  }
  return { level: c.level, word: WORD[c.level], agree: AGREE[c.level], sd, why: c.why, pearls, rain, sub: parts.join(' · '), from, to };
}

/** Tänään (nyt … klo 22) ja huomenna (klo 6–22). results: mallien vastaukset (helmiä varten). */
function certaintyInfo(fc, results, nowMs) {
  const tw = todayWindow(fc, nowMs);
  const today = certFor(fc, results, tw.from, tw.to, 0);
  const d1 = addDays(tw.local.date, 1);
  const a = idxAt(fc, d1, 6);
  let b = idxAt(fc, d1, 22);
  if (b < 0) b = fc.hours.length - 1;
  const tomorrow = a >= 0 ? certFor(fc, results, a, b, Math.max(0, a - tw.idx)) : null;
  const l1 = today.level === 'single' ? 'Vain yksi malli vastasi.' : `Tänään ${today.word}.`;
  let l2 = '';
  if (tomorrow && tomorrow.level !== 'single') l2 = tomorrow.level === today.level && today.level === 'high' ? 'Huomennakin luotettava.' : `Huomenna ${tomorrow.word}.`;
  return { today, tomorrow, l1, l2 };
}

/** Lyhyt varmuussana muualle (esim. tuntirivin lisätiedot). */
function certaintyWord(level) {
  return WORD[level] || '';
}
return { dayEss, whenText, nextRain, nextRainLine, todayWindow, tomorrowWindow, homeHeadline, tomorrowHero, hoursHeadline, weekHeadline, weekendLine, daySlippery, certaintyInfo, certaintyWord };
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

// Pehmeät 3D-kuvakkeet (esirenderöidyt webp-kuvat, tyylit app.css:ssä). Pienemmät ruudut käyttävät samoja kuvia.
const KEY3D = {
  clear: ['sun', 'moon'],
  mostly_clear: ['part_sun', 'moonpart'],
  partly_cloudy: ['part', 'moonpart'],
  mostly_cloudy: ['part_cloud', 'moonpart'],
  overcast: ['cloud', 'cloud'],
  fog: ['cloud', 'cloud'],
  drizzle: ['rain', 'rain'],
  rain_light: ['rain', 'rain'],
  rain: ['rain', 'rain'],
  rain_heavy: ['rain', 'rain'],
  sleet: ['rain', 'rain'],
  snow_light: ['snow', 'snow'],
  snow: ['snow', 'snow'],
  snow_heavy: ['snow', 'snow'],
  thunder: ['storm', 'storm'],
};

/** Kuvakkeen avain 3D-kuvalle, esim. "d-sun" tai "n-moonpart". */
function icon3dKey(sym, isDay = true) {
  const k = KEY3D[sym] || KEY3D.overcast;
  return (isDay ? 'd-' : 'n-') + k[isDay ? 0 : 1];
}

/** 3D-kuvake. Koko tulee CSS-muuttujasta, jotta tyylit pysyvät tiedostossa (ei sisäisiä kokoja merkkijonoissa). */
function icon3d(sym, isDay = true, size = 48) {
  const heavy = sym === 'rain_heavy' || sym === 'snow_heavy' ? ' wx3-heavy' : '';
  const fog = sym === 'fog' ? '<i class="wx3-fog"></i>' : '';
  const st = size ? ` style="--s:${size}px"` : ''; // 0 = koko tulee ympäröivästä CSS-muuttujasta
  return `<span class="wx3 wx-${icon3dKey(sym, isDay)}${heavy}"${st} aria-hidden="true">${fog}</span>`;
}
return { icon, icon3dKey, icon3d };
})();

// ---- views.js ----
__m['views'] = (() => {
// views.js: näkymät HTML-merkkijonoina. Puhtaita funktioita: sama syöte antaa saman HTML:n.
// Kaikki dynaaminen teksti kulkee esc()-funktion kautta.

const { escapeHtml: esc, fmtTemp, fmtNum, fmtMm, windFrom, weekday, fmtDM, addDays, cap, mdToHtml, zonedToUtcMs, localNow } = __m['util'];
const { SYMBOLS, nowPosition, snapshot, modelRows, describeNow, describeDay, describeHour, popText } = __m['blend'];
const { homeHeadline, hoursHeadline, weekHeadline, weekendLine, daySlippery, certaintyInfo, tomorrowHero, tomorrowWindow } = __m['headline'];
const { icon, icon3d } = __m['icons'];
const { meteogram, RANGES } = __m['meteogram'];
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
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.1"/></svg>',
};

/** Neuvojen piirrokset: yksinkertaiset viivakuvat, väri tulee tekstistä (currentColor). */
const GLYPH = {
  coat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3.5L5 6 3 11l3 1.2V21h12v-8.8L21 11l-2-5-4-2.5"/><path d="M9 3.5c.6 1.6 1.7 2.5 3 2.5s2.4-.9 3-2.5M12 6v15"/></svg>',
  umbrella: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 0 1 18 0H3z"/><path d="M12 12v6.5a2 2 0 0 1-4 0"/><path d="M12 3v-1"/></svg>',
  snow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9M9.5 4.8L12 7l2.5-2.2M9.5 19.2L12 17l2.5 2.2"/></svg>',
  ice: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20l3-7 3 3 3-8 5 12H5z"/><path d="M4 4l2 2M9 3v3M19 4l-2 2"/></svg>',
  wind: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3M3 12h7"/></svg>',
  uv: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></svg>',
  frost: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M5 7.5l14 9M19 7.5l-14 9"/><circle cx="12" cy="12" r="2"/></svg>',
  fog: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h12M7 12h13M4 16h10M10 20h8"/></svg>',
  alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l9 16H3l9-16z"/><path d="M12 10v4.5M12 17v.1"/></svg>',
  air: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9c3-3 6 3 9 0s4-2 7 0M4 15c3-3 6 3 9 0s4-2 7 0"/></svg>',
  pollen: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2.2"/><path d="M12 9.8V4M12 14.2V20M9.8 12H4M14.2 12H20M10.4 10.4L6.5 6.5M13.6 13.6l3.9 3.9M13.6 10.4l3.9-3.9M10.4 13.6l-3.9 3.9"/></svg>',
  radar: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6-4"/></svg>',
  aurora: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18c2-6 4-9 6-9s2 5 4 5 3-7 5-7 3 4 3 11"/></svg>',
  station: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M7 21h10M8.5 8a5 5 0 0 1 7 0M6 5.5a8.5 8.5 0 0 1 12 0"/></svg>',
  road: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3L4 21M16 3l4 18M12 4v3M12 10v4M12 17v3"/></svg>',
};

/** "juuri nyt", "3 min sitten", "1 h 20 min sitten". */
function agoText(ms) {
  const m = Math.floor(Math.max(0, ms) / 60000);
  if (m < 1) return 'juuri nyt';
  if (m < 60) return `${m} min sitten`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h < 24) return r ? `${h} h ${r} min sitten` : `${h} h sitten`;
  return `${Math.floor(h / 24)} vrk sitten`;
}
const STALE_MIN = 60;

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
  const fmt = (ms) => (ms == null ? '–' : localNow(ms, fc.tz).iso.slice(11).replace(':', '.'));
  const len = dayLengthMs(ev);
  const prev = dayLengthMs(sunEvents(dayStart - 86400000, fc.lat, fc.lon));
  let txt = `Aurinko ${fmt(ev.rise)}–${fmt(ev.set)}`;
  if (len != null && len > 0 && len < 86400000) {
    const m = Math.floor(len / 60000);
    txt += `, päivä ${Math.floor(m / 60)} h ${m % 60} min`;
    if (prev != null && prev > 0 && prev < 86400000) {
      const d = Math.round((len - prev) / 1000);
      const a = Math.abs(d);
      if (a >= 5) txt += `, ${d > 0 ? 'pitenee' : 'lyhenee'} ${a < 60 ? `${a} s` : `${Math.floor(a / 60)} min ${a % 60} s`}`;
    }
  }
  return txt;
}

const hr = (iso) => (iso.slice(11, 13) === '00' ? '00' : String(+iso.slice(11, 13)));

/**
 * Sankari: iso lämpötila, 3D-objekti ja kolme pientä riviä. Tilat: nyt, radalta valittu tunti ja huomenna.
 * Sijoittelu: app.css, .stage.
 */
function heroHtml({ fc, nowMs, sel = { type: 'now' }, day = 'today' }) {
  const { idx, frac, local } = nowPosition(fc, nowMs);
  let temp;
  let sym;
  let isDay;
  let lines;
  let sr;
  let chip = '';
  const th = sel.type !== 'hour' && day === 'tomorrow' ? tomorrowHero(fc, nowMs) : null;
  if (sel.type === 'hour' && fc.hours.some((x) => x.t === sel.iso)) {
    const h = fc.hours.find((x) => x.t === sel.iso);
    const d = h.t.slice(0, 10);
    const lbl = `${d === local.date ? 'tänään' : d === addDays(local.date, 1) ? 'huomenna' : weekday(d)} klo ${hr(h.t)}`;
    temp = h.temp;
    sym = h.sym;
    isDay = h.isDay;
    chip = `<button class="hero-chip" type="button" data-act="now" aria-label="${esc(`Näytetään ${lbl}. Palaa nykyhetkeen`)}">${esc(cap(lbl))}${SVG.close}</button>`;
    lines = [`tuntuu kuin ${fmtTemp(h.feels)}`, `${SYMBOLS[h.sym].toLowerCase()} · ${fmtNum(h.wind)} m/s`];
    sr = `${cap(lbl)}: ${fmtTemp(h.temp)}, tuntuu kuin ${fmtTemp(h.feels)}, ${SYMBOLS[h.sym].toLowerCase()}, tuuli ${fmtNum(h.wind)} m/s.`;
  } else if (th) {
    temp = th.tmax;
    sym = th.sym;
    isDay = true;
    chip = `<span class="hero-chip still">Huomenna ${esc(weekday(th.date))} ${esc(fmtDM(th.date))}</span>`;
    lines = [`aamulla ${fmtTemp(th.morning)} · alin ${fmtTemp(th.tmin)}`, `${SYMBOLS[th.sym].toLowerCase()} · ${fmtNum(th.wind)} m/s`];
    sr = `Huomenna ${weekday(th.date, true)} ${fmtDM(th.date)}: ylin ${fmtTemp(th.tmax)}, aamulla ${fmtTemp(th.morning)}, alin ${fmtTemp(th.tmin)}, ${SYMBOLS[th.sym].toLowerCase()}.`;
  } else {
    const s = snapshot(fc, idx, frac);
    const d = fc.days.find((x) => x.date === local.date) || fc.days[0];
    temp = s.temp;
    sym = s.sym;
    isDay = s.isDay;
    lines = [`tuntuu kuin ${fmtTemp(s.feels)}`, `${SYMBOLS[s.sym].toLowerCase()} · ${fmtNum(s.wind)} m/s`, `tänään ${fmtTemp(d.tmin)}…${fmtTemp(d.tmax)}`];
    sr = `Sää nyt: ${fmtTemp(s.temp)}, tuntuu kuin ${fmtTemp(s.feels)}, ${SYMBOLS[s.sym].toLowerCase()}, tuuli ${fmtNum(s.wind)} m/s. Tänään alin ${fmtTemp(d.tmin)}, ylin ${fmtTemp(d.tmax)}.`;
  }
  return `
    <div class="temp" aria-hidden="true">${esc(fmtTemp(temp))}</div>
    <div class="hero-icon">${icon3d(sym, isDay, 0)}</div>
    <p class="sr-only">${esc(sr)}</p>
    <div class="hero-lines">${chip}${lines.map((l, k) => `<span class="hl-${k}" aria-hidden="true">${esc(l)}</span>`).join('')}</div>`;
}

/** "Nyt"-rivin lisätiedot Tunnit-näkymässä: kosteus, paine, pilvisyys, aurinko ja päivitysaika. */
function nowExtrasHtml({ fc, nowMs, fetchedAt = 0, loading = false }) {
  const { idx, frac, local } = nowPosition(fc, nowMs);
  const s = snapshot(fc, idx, frac);
  const age = nowMs - fetchedAt;
  const stale = !loading && fetchedAt && age >= STALE_MIN * 60000;
  const updated = loading ? 'Päivitetään…' : fetchedAt ? `Päivitetty ${agoText(age)}` : '';
  return `<li>Kosteus ${Math.round(s.hum ?? 0)} % · ilmanpaine ${Math.round(s.press ?? 0)} hPa</li>
    <li>${esc(sunLine(fc, local.date))}</li>
    ${updated ? `<li class="${stale ? 'stale' : ''}">${esc(updated)}${stale ? ' <span class="stale-tag">vanhentunut</span>' : ''}</li>` : ''}`;
}

// ---------- Huomiot ja neuvot ----------

const OWN_COVERED_BY = { thunder: /ukkos/i, gust: /tuuli|myrsky|puusk/i, storm: /tuuli|myrsky/i, rain: /sade/i, heat: /helle|kuuma/i, cold: /pakkas|kylm/i };
const SEV = { Moderate: ['yellow', 'Keltainen varoitus'], Severe: ['orange', 'Oranssi varoitus'], Extreme: ['red', 'Punainen varoitus'] };
const FMI_WARN = 'https://www.ilmatieteenlaitos.fi/varoitukset';

/**
 * Etusivun varoitusrivi radan yläpuolella: viralliset varoitukset (värillinen rengas) ja SääÄlyn omat huomiot (katkoviiva).
 * officialState 'unknown' tai varoitustiedon ikä yli 90 min: rauhallinen siru, jossa tiedon ikä ja linkki Ilmatieteen laitokselle.
 */
function alertsHtml({ alerts = [], official = [], officialState = 'ok', checkedAt = 0, nowMs = 0 }) {
  const off = official.slice(0, 3);
  const dup = (a) => off.some((o) => OWN_COVERED_BY[a.key]?.test(o.title || ''));
  const old = checkedAt && nowMs && nowMs - checkedAt > 90 * 60000;
  const unknown = officialState === 'unknown' || old;
  const own = alerts.filter((a) => a.level >= 1 && !dup(a)).slice(0, Math.max(0, 2 - off.length));
  if (!own.length && !off.length && !unknown) return '';
  const rows = [];
  for (const o of off) {
    const [cls, word] = SEV[o.severity] || SEV.Moderate;
    // Tiivis yhteenveto (otsikko + voimassaoloaika yhdellä rivillä); alue ja lähde avautuvassa osassa.
    const src = [o.area, 'Ilmatieteen laitos'].filter(Boolean).join(' · ');
    rows.push(`<details class="alert off sev-${cls}"><summary><i class="sev-dot" aria-hidden="true"></i><span class="a-txt"><b>${esc(word)} · ${esc(o.title)}</b><small>${esc(o.time || o.when || '')}</small></span>${SVG.caret}</summary>${o.text ? `<p>${esc(o.text)}</p>` : ''}<p class="fine">${esc(src)}</p></details>`);
  }
  for (const a of own) {
    rows.push(`<details class="alert own"><summary><i class="sev-dot" aria-hidden="true"></i><span class="a-txt"><b>${esc(a.title)}</b><small>${esc(a.short || '')} · SääÄlyn huomio</small></span>${SVG.caret}</summary><p>${esc(a.text)}</p><p class="fine">Oma laskenta mallidatasta, ei virallinen varoitus. <a href="${FMI_WARN}" target="_blank" rel="noopener">Viralliset varoitukset</a></p></details>`);
  }
  if (unknown) {
    const d = checkedAt ? new Date(checkedAt) : null;
    const t = d ? `${d.toDateString() === new Date(nowMs || Date.now()).toDateString() ? '' : `${d.getDate()}.${d.getMonth() + 1}. `}klo ${d.getHours()}.${String(d.getMinutes()).padStart(2, '0')}` : '';
    const txt = d ? `Varoitustieto ${t}` : 'Varoituksia ei voitu tarkistaa';
    rows.push(`<a class="alert-chip" href="${FMI_WARN}" target="_blank" rel="noopener"><i aria-hidden="true"></i>${esc(txt)} · tarkista Ilmatieteen laitokselta</a>`);
  }
  return `<div class="alert-list" role="region" aria-label="Varoitukset ja huomiot">${rows.join('')}</div>`;
}

/** Etusivun otsikko: kaksi riviä (toiminto + aika) ja pieni lisärivi. Ei laatikoita eikä painikkeita. */
function verdictHtml({ hl }) {
  return `<p class="vsay"><b>${esc(hl.l1)}</b><span>${esc(hl.l2)}</span></p>${hl.small ? `<p class="vsmall">${esc(hl.small)}</p>` : ''}`;
}

// ---------- Tuntirata ----------

// Radan tuntipaikat esirenderöidyssä radassa (412 x 750 -yksikön alue): c = kuvakkeen keskipiste, d = piste radan pinnalla.
// Paikat on valittu käsin radan ulkokaarteisiin niin, että teksti (vasen yläkulma) ja Kysy-pilleri (alareuna) jäävät vapaiksi.
const TRACK_START = [290, 170];
const TRACK = [
  { c: [380, 236], d: [359.5, 238.0] },
  { c: [380, 330], d: [351.3, 317.2] },
  { c: [300, 420], d: [283.4, 379.0] },
  { c: [226, 424], d: [224.0, 390.1] },
  { c: [152, 430], d: [142.3, 400.1] },
  { c: [96, 624], d: [113.3, 570.2] },
  { c: [168, 628], d: [172.8, 579.4] },
  { c: [240, 636], d: [250.7, 593.8] },
  { c: [382, 560], d: [331.1, 601.2] },
  { c: [382, 650], d: [357.1, 654.2] },
];
const TRACK_HOURS = TRACK.length;
const pct = (v, total) => `${((v / total) * 100).toFixed(2)}%`;

/** Tunnit kromiradalla: jokaisella tunnilla oma 3D-objekti, lämpötila ja kellonaika. Huomenna-tilassa huomisen aamusta alkaen. */
function trackHtml({ fc, nowMs, sel, day = 'today' }) {
  const { idx } = nowPosition(fc, nowMs);
  let start = idx + 1;
  let label = 'nyt';
  if (day === 'tomorrow') {
    const w = tomorrowWindow(fc, nowMs);
    if (w) (start = w.from), (label = 'huomenna');
  }
  const out = [`<span class="th-start" style="left:${pct(TRACK_START[0], 412)};top:${pct(TRACK_START[1], 750)}" aria-hidden="true">${label}</span>`];
  TRACK.forEach((pt, k) => {
    const h = fc.hours[start + k];
    if (!h) return;
    const pressed = sel.type === 'hour' && sel.iso === h.t;
    const name = `${weekday(h.t.slice(0, 10))} klo ${hr(h.t)}, ${SYMBOLS[h.sym]}, ${fmtTemp(h.temp)}`;
    out.push(`<i class="td" style="left:${pct(pt.d[0], 412)};top:${pct(pt.d[1], 750)}"></i>`);
    out.push(
      `<button class="th" type="button" style="left:${pct(pt.c[0], 412)};top:${pct(pt.c[1], 750)}" data-act="hour" data-iso="${esc(h.t)}" aria-pressed="${pressed}" aria-label="${esc(name)}"><span class="th-ic">${icon3d(h.sym, h.isDay, 0)}</span><b>${esc(fmtTemp(h.temp))}</b><span>klo ${hh(h.t)}</span></button>`,
    );
  });
  return `<div class="trk-img" aria-hidden="true"></div>${out.join('')}`;
}

// ---------- Selitys ----------

function selectionLines(fc, sel, nowMs) {
  if (sel.type === 'hour') {
    const i = fc.hours.findIndex((h) => h.t === sel.iso);
    return i < 0 ? [] : describeHour(fc, i);
  }
  if (sel.type === 'day') return describeDay(fc, sel.date, nowMs);
  return describeNow(fc, nowMs);
}

// ---------- Sääkaavio ----------

const MG_LABELS = { '24h': '24 h', '48h': '48 h', '7d': '7 vrk' };

/** Yöjaksot kaavion varjostukseen: peräkkäiset tunnit, joissa aurinko on laskenut. [alku, loppu] paikallisena ISO-aikana. */
function nightSpans(hours) {
  const spans = [];
  let start = null;
  for (let i = 0; i < hours.length; i++) {
    if (!hours[i].isDay && start == null) start = hours[i].t;
    if (hours[i].isDay && start != null) {
      spans.push([start, hours[i].t]);
      start = null;
    }
  }
  if (start != null) spans.push([start, hours[hours.length - 1].t.slice(0, 11) + '23:59']);
  return spans;
}

/** Sääkaavio: lämpötilakäyrä ja epävarmuuskaista, sadepalkit, tuulinuolet. Tarkastus (inspect) näyttää yhden jakson luvut. */
function meteoHtml({ fc, nowMs, range = '24h', inspectIso = null, width = 360, compact = false }) {
  const r = RANGES[range] ? range : '24h';
  const { idx, frac } = nowPosition(fc, nowMs);
  const hours = fc.hours.slice(idx);
  if (hours.length < 6) return '';
  const mg = meteogram(hours, { range: r, width, nowFrac: frac, icon3d: true, night: nightSpans(hours), inspectIso, compact, uid: 'mg' });
  const ics = (mg.icons || []).map((c) => `<span class="mg-ic" style="left:${((c.x / mg.width) * 100).toFixed(2)}%;top:${((c.y / mg.height) * 100).toFixed(2)}%">${icon3d(c.sym, c.isDay, 0)}</span>`).join('');
  const n = mg.bins.length;
  const sel = mg.inspect;
  const ro = sel != null ? mg.readout(sel) : null;
  const seg = Object.keys(RANGES)
    .map((k) => `<button class="seg" type="button" data-act="mg-range" data-range="${k}" aria-pressed="${k === r}">${MG_LABELS[k]}</button>`)
    .join('');
  const step = r === '7d' ? 4 : 3;
  const rows = [];
  for (let j = 0; j < n; j += step) {
    const x = mg.readout(j);
    rows.push(`<tr><th scope="row">${esc(x.when)}</th><td>${esc(x.temp)}</td><td>${esc(x.sym)}</td><td>${esc(x.rain)}</td><td>${esc(x.wind)}${x.from ? ` ${esc(x.from)}` : ''}</td></tr>`);
  }
  const readText = ro
    ? `<b>${esc(ro.when)}</b> · ${esc(ro.temp)} · ${esc(ro.sym)} · ${esc(ro.rain)} · tuuli ${esc(ro.wind)}${ro.from ? ` ${esc(ro.from)}` : ''}`
    : esc(mg.summary);
  return `
    <div class="mg-head"><div class="modebar mg-seg" role="group" aria-label="Kaavion aikaväli">${seg}</div></div>
    <div class="mg-wrap" id="mgWrap" tabindex="0" role="slider" aria-label="Tarkastele sääkaaviota nuolinäppäimillä tai koskettamalla" aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="${n - 1}" aria-valuenow="${sel ?? 0}" aria-valuetext="${esc(ro ? ro.aria : mg.summary)}" data-w="${mg.width}" data-n="${n}" data-range="${r}">${mg.svg}${ics}</div>
    <p class="mg-read" id="mgRead">${readText}</p>
    <p class="mg-legend">Viiva: lämpötila · vaalea alue: mallien vaihteluväli · palkit: sade mm/${r === '7d' ? '3 h' : 'h'} · nuolet: tuulen suunta ja m/s</p>
    <details class="mg-table"><summary>Kaavio taulukkona</summary><div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col">Aika</th><th scope="col">Lämpö</th><th scope="col">Sää</th><th scope="col">Sade</th><th scope="col">Tuuli</th></tr></thead><tbody>${rows.join('')}</tbody></table></div></details>`;
}

// ---------- Tunnit ----------

/** Tunnin lisätiedot riville avattuna: tuntuu kuin, tuuli, sade, pilvisyys ja mallien ero. */
function hourDetailsHtml(fc, i, { now = false, nowMs, fetchedAt = 0, loading = false, obs = null } = {}) {
  const h = fc.hours[i];
  const gust = h.gust - h.wind >= 3 ? `, puuskat ${fmtNum(h.gust)} m/s` : '';
  const rain = h.precip >= 0.05 ? `Sade ${fmtMm(h.precip)} tunnissa · ${popText(h)}` : h.pop >= 0.15 ? `Ei sadetta todennäköisesti · ${popText(h)}` : 'Ei sadetta';
  const spread = Number.isFinite(h.spread) ? ` · mallien ero ${fmtNum(h.spread, 1)}°` : '';
  const q = `Millainen sää on ${now ? 'nyt' : `klo ${hr(h.t)}`}?`;
  return `<div class="hv-more" id="hm-${esc(h.t)}"><ul class="plain">
    <li>Tuntuu kuin ${esc(fmtTemp(h.feels))}</li>
    <li>Tuuli ${fmtNum(h.wind)} m/s ${esc(windFrom(h.dir))}${esc(gust)}</li>
    <li>${esc(rain)}</li>
    <li>Pilvisyys ${Math.round(h.cloud ?? 0)} %${esc(spread)}</li>
    ${now && obs ? `<li>Mitattu ${esc(fmtTemp(obs.value, { digits: 1 }))} · ${esc(obs.name || 'lähin asema')}</li>` : ''}
    ${now ? nowExtrasHtml({ fc, nowMs, fetchedAt, loading }) : ''}
  </ul><button class="pill sm" type="button" data-act="ask-open" data-q="${esc(q)}">${SVG.spark}Kysy tästä tunnista</button></div>`;
}

/** Tutkan kahden tunnin sadekäyrä, kun sade on lähellä. raw: nowcast.js:n jäsentämä { steps:[{t, rate}] }. */
function radarHtml({ raw, nc, nowMs, tz }) {
  if (!raw?.steps?.length || !nc?.ok) return '';
  const near = nc.state === 'wet' || (nc.startMin != null && nc.startMin <= 120);
  if (!near) return '';
  const steps = raw.steps.filter((s) => s.t >= nowMs - 5 * 60000 && s.t <= nowMs + 125 * 60000);
  if (steps.length < 3) return '';
  const max = Math.max(1, ...steps.map((s) => s.rate));
  const bars = steps.map((s) => `<i style="height:${Math.max(2, Math.round((Math.min(s.rate, max) / max) * 100))}%"${s.rate >= 0.2 ? '' : ' class="dry"'}></i>`).join('');
  const clock = (ms) => new Date(ms).toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit', timeZone: tz }).replace(':', '.');
  // Otsikko kertoo jo ajoituksen: kuvateksti kertoo voimakkuuden. Ruudunlukija saa koko lauseen.
  const cap2 = nc.word ? `Tutka: ${nc.word} sadetta ${nc.state === 'wet' ? 'nyt' : 'tulossa'}` : 'Tutka: sadetta lähellä';
  return `<div class="radar" role="img" aria-label="${esc(`Tutka: ${nc.line || ''}`)}"><p class="radar-t">${GLYPH.radar}<span>${esc(cap2)}</span></p>
    <div class="radar-bars">${bars}</div><div class="radar-ax"><span>nyt</span><span>${esc(clock(nowMs + 60 * 60000))}</span><span>${esc(clock(nowMs + 120 * 60000))}</span></div></div>`;
}

/**
 * Tunnit-sivu: otsikko, Lista/Kaavio-valinta ja tuntilista kromipunoksen vieressä. Rivin napautus avaa lisätiedot paikallaan.
 * day 'tomorrow': huomisen tunnit klo 6–23. more: 48 tuntia 13 sijaan.
 */
function hoursPageHtml({ fc, nowMs, day = 'today', open = null, more = false, view = 'list', radar = '', fetchedAt = 0, loading = false, obs = null, nowcast = null }) {
  const { idx, local } = nowPosition(fc, nowMs);
  let hs;
  let kick;
  let l1;
  let l2;
  if (day === 'tomorrow' && tomorrowWindow(fc, nowMs)) {
    const w = tomorrowWindow(fc, nowMs);
    const a = fc.hours.findIndex((x) => x.t === `${w.date}T06:00`);
    hs = fc.hours.slice(a >= 0 ? a : w.from, (a >= 0 ? a : w.from) + 18).map((h, k) => ({ h, i: (a >= 0 ? a : w.from) + k }));
    const th = homeHeadline(fc, nowMs, { day: 'tomorrow' });
    const d = fc.days.find((x) => x.date === w.date);
    kick = `Tunnit · huomenna ${weekday(w.date)} ${fmtDM(w.date)}`;
    l1 = th.l2;
    l2 = d ? `Ylin ${fmtTemp(d.tmax)}, alin ${fmtTemp(d.tmin)}.` : '';
  } else {
    hs = fc.hours.slice(idx, idx + (more ? 48 : 13)).map((h, k) => ({ h, i: idx + k }));
    kick = `Tunnit · ${weekday(local.date, true)}`;
    [l1, l2] = hoursHeadline(fc, nowMs, nowcast);
  }
  const dry = hs.every(({ h }) => (h.pop ?? 0) < 0.1 && h.precip < 0.1);
  const isNow = (i) => day !== 'tomorrow' && i === idx;
  const rows = [];
  let block = [];
  const flush = () => {
    if (block.length) rows.push(`<div class="hv-block"><div class="braid" aria-hidden="true"></div>${block.join('')}</div>`);
    block = [];
  };
  hs.forEach(({ h, i }, k) => {
    const date = h.t.slice(0, 10);
    if (k > 0 && hr(h.t) === '00') {
      flush();
      rows.push(`<p class="hv-sep">${esc(cap(weekday(date, true)))} ${esc(fmtDM(date))}</p>`);
    }
    const now = isNow(i);
    const pc = popPctRow(h);
    const expanded = open === h.t;
    const name = `${now ? 'Nyt' : `${weekday(date)} klo ${hr(h.t)}`}, ${SYMBOLS[h.sym]}, ${fmtTemp(h.temp)}${dry ? '' : `, sateen todennäköisyys ${pc} %`}`;
    block.push(`<div class="hv-item"><button class="hv${now ? ' now' : ''}" type="button" data-act="hrow" data-iso="${esc(h.t)}" aria-expanded="${expanded}" aria-controls="hm-${esc(h.t)}" aria-label="${esc(name)}">
      <span class="hv-t"><i></i>${now ? 'nyt' : hh(h.t)}</span>${icon3d(h.sym, h.isDay, 0)}<span class="hv-temp">${esc(fmtTemp(h.temp))}</span>${dry ? '' : `<span class="hv-bar" aria-hidden="true"><b style="width:${pc}%"></b></span><span class="hv-pc">${pc} %</span>`}</button>
      ${expanded ? hourDetailsHtml(fc, i, { now, nowMs, fetchedAt, loading, obs }) : ''}</div>`);
  });
  flush();
  const moreBtn = day === 'tomorrow' ? '' : `<button class="more-btn" type="button" data-act="hours-more" aria-expanded="${more}">${more ? 'Näytä vähemmän' : 'Näytä 48 tuntia'}</button>`;
  const seg = `<div class="modebar hv-seg" role="group" aria-label="Näkymä"><button class="seg" type="button" data-act="hours-view" data-view="list" aria-pressed="${view !== 'chart'}">Lista</button><button class="seg" type="button" data-act="hours-view" data-view="chart" aria-pressed="${view === 'chart'}">Kaavio</button></div>`;
  return `<p class="kick">${esc(kick)}</p><h2 class="hl"><b>${esc(l1)}</b><span>${esc(l2)}</span></h2>${seg}${radar}
    ${view === 'chart' ? '<p class="hint">Liu\'uta sormea kaaviossa, niin näet tunnin tiedot.</p>' : `${dry ? '' : '<p class="hv-cap" aria-hidden="true">sateen todennäköisyys</p>'}<div class="hvs${dry ? ' dry' : ''}" id="strip">${rows.join('')}</div>${moreBtn}`}`;
}

/** Sateen todennäköisyys riville kymmenen prosentin tarkkuudella (0, 10 … 90). */
function popPctRow(h) {
  const p = h.popSrc === 'ens' ? h.pop : Math.max(h.pop ?? 0, h.popAgree ?? 0);
  return Math.min(90, Math.round(Math.max(0, p) * 10) * 10);
}

// ---------- Viikko ----------

/** Päivän tunnit vaakasuuntaisena nauhana päivän rivin alla. */
function dayHoursHtml({ fc, nowMs, day }) {
  const { idx, local } = nowPosition(fc, nowMs);
  const hours = fc.hours.filter((h, i) => h.t.slice(0, 10) === day.date && (day.date !== local.date || i >= idx));
  if (!hours.length) return '';
  const wind = Math.max(...hours.map((h) => h.wind || 0));
  const bits = [`ylin ${fmtTemp(day.tmax)}, alin ${fmtTemp(day.tmin)}`, day.precip >= 0.1 ? `sadetta ${fmtMm(day.precip)}` : 'ei merkittävää sadetta', `tuulta enintään ${fmtNum(wind)} m/s`];
  const cells = hours.map((h) => {
    const p = h.precip >= 0.1 ? fmtMm(h.precip).replace(' mm', '') : '';
    return `<div class="hr" role="listitem" data-iso="${esc(h.t)}" aria-label="${esc(`klo ${hr(h.t)}, ${SYMBOLS[h.sym]}, ${fmtTemp(h.temp)}${p ? `, sadetta ${p} mm` : ''}`)}">
      <span class="hr-t">${hh(h.t)}</span>${icon3d(h.sym, h.isDay, 0)}<span class="hr-temp">${esc(fmtTemp(h.temp))}</span><span class="hr-p">${p ? esc(p) + ' mm' : ''}</span></div>`;
  });
  return `<div class="day-hours" id="dh-${esc(day.date)}" role="region" aria-label="${esc(`Tuntiennuste ${weekday(day.date)} ${fmtDM(day.date)}`)}">
    <p class="dh-sum">${esc(bits.join(' · '))}</p><div class="dstrip" role="list" data-date="${esc(day.date)}">${cells.join('')}</div></div>`;
}

/** Viikko-sivu: otsikko, viikonloppu, ja päivät kromikapseleina yhteisellä lämpöasteikolla. Päivän napautus avaa sen tunnit. */
function weekPageHtml({ fc, nowMs, open = null }) {
  const { idx, frac, local } = nowPosition(fc, nowMs);
  const today = local.date;
  const days = fc.days.slice(0, 7);
  const lo = Math.min(...days.map((d) => d.tmin));
  const hi = Math.max(...days.map((d) => d.tmax));
  const span = hi - lo || 1;
  const pos = (t) => ((t - lo) / span) * 100;
  const nowT = snapshot(fc, idx, frac).temp;
  const rows = days.map((d, k) => {
    const left = pos(d.tmin);
    const width = Math.max(0, pos(d.tmax) - left);
    const name = k === 0 ? 'Tänään' : cap(weekday(d.date));
    const sub = k === 0 ? `${weekday(d.date)} ${fmtDM(d.date)}` : fmtDM(d.date);
    const wetSym = /rain|drizzle|sleet|snow|thunder/.test(d.sym);
    const rain = wetSym && d.precip >= 0.1 ? fmtMm(d.precip) : d.precip >= 0.5 && (d.pwin ?? 0) >= 0.2 ? `${Math.round((d.pwin ?? 0) * 10) * 10} %` : '';
    const slip = daySlippery(fc, d);
    const expanded = open === d.date;
    const dot = d.date === today ? `<i class="wd-now" style="left:${Math.max(0, Math.min(100, pos(nowT))).toFixed(1)}%" aria-hidden="true"></i>` : '';
    const label = `${k === 0 ? 'Tänään' : weekday(d.date, true)} ${fmtDM(d.date)}, ${SYMBOLS[d.sym]}, alin ${fmtTemp(d.tmin)}, ylin ${fmtTemp(d.tmax)}${rain ? `, sade ${rain}` : ''}${slip ? ', liukasta' : ''}. ${expanded ? 'Piilota tunnit' : 'Näytä tunnit'}`;
    return `<div class="wd-item"><button class="wd" type="button" data-act="day" data-date="${esc(d.date)}" aria-expanded="${expanded}" aria-controls="dh-${esc(d.date)}" aria-label="${esc(label)}">
      <span class="wd-n"><b>${esc(name)}</b><small>${esc(sub)}</small></span>${icon3d(d.sym, true, 0)}
      <span class="wd-r" aria-hidden="true"><span class="wd-cap" style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%"><em class="lo">${esc(fmtTemp(d.tmin))}</em><em class="hi">${esc(fmtTemp(d.tmax))}</em></span>${dot}</span>
      <span class="wd-x" aria-hidden="true">${rain ? `<span>${esc(rain)}</span>` : ''}${slip ? '<span class="slip">liukasta</span>' : ''}</span></button>
      ${expanded ? dayHoursHtml({ fc, nowMs, day: d }) : ''}</div>`;
  });
  const [w1, w2] = weekHeadline(days, today);
  const we = weekendLine(days, today);
  return `<p class="kick">Seuraavat ${days.length} päivää</p><h2 class="hl"><b>${esc(w1)}</b><span>${esc(w2)}</span></h2>
    ${we ? `<p class="wk-sub">${esc(we)}</p>` : ''}<p class="hint">Napauta päivää, niin näet sen tunnit.</p><div class="wds">${rows.join('')}</div>`;
}

// ---------- Varmuus ----------

/**
 * Helmet: yksi helmi per malli. Vaakasijainti = mallin keskimääräinen ero SääÄlyn ennusteesta (±4 °C koko leveydellä).
 * Päällekkäiset helmet asettuvat tiiviiksi rykelmäksi lähimpään vapaaseen kohtaan, joten yksimieliset mallit näkyvät rypäänä.
 */
function pearlsHtml(c, label) {
  const PX = 3.9; // noin 390 px leveä alue: 1 % ≈ 3,9 px
  const D = 36; // helmien keskipisteiden vähimmäisetäisyys (px)
  const items = c.pearls
    .filter((p) => p.dev != null)
    .map((p) => ({ ...p, tx: Math.max(6, Math.min(94, 50 + (p.dev / 4) * 44)) }))
    .sort((a, b) => Math.abs(a.dev) - Math.abs(b.dev));
  const placed = [];
  for (const p of items) {
    let best = null;
    for (let dy = -60; dy <= 60; dy += 4) {
      for (let dx = -80; dx <= 80; dx += 4) {
        const x = p.tx * PX + dx;
        if (x < 6 * PX || x > 94 * PX) continue;
        if (placed.some((q) => Math.hypot(q.x - x, q.y - dy) < D)) continue;
        const score = dx * dx + 1.7 * dy * dy;
        if (!best || score < best.score) best = { x, y: dy, score };
      }
    }
    if (!best) best = { x: p.tx * PX, y: 0 };
    p.x = best.x;
    p.y = best.y;
    placed.push(p);
  }
  const missing = c.pearls.filter((p) => p.dev == null).map((p) => p.short);
  const sign = (v) => `${v > 0.05 ? '+' : v < -0.05 ? '−' : '±'}${fmtNum(Math.abs(v), 1)}°`;
  const desc = `${label}: ${items.map((p) => `${p.short} ${sign(p.dev)}`).join(', ')}`;
  return `<div class="pearls" role="img" aria-label="${esc(desc)}"><span class="pl-axis"></span><span class="pl-lab l">kylmempi</span><span class="pl-lab c">SääÄly</span><span class="pl-lab r">lämpimämpi</span>
    ${placed.map((p) => `<i class="pearl pk${p.k % 8}" style="left:${(p.x / PX).toFixed(1)}%;--o:${p.y}px" title="${esc(`${p.short} ${sign(p.dev)}`)}"></i>`).join('')}</div>
    ${missing.length ? `<p class="pl-miss">Ei mukana: ${esc(missing.join(', '))}</p>` : ''}`;
}

/** Varmuus-sivu: otsikko, helmirypäät tänään ja huomenna, selityskortit, mallivertailu. */
function certPageHtml({ fc, results, nowMs, obs = null }) {
  const ci = certaintyInfo(fc, results, nowMs);
  const card = (c, label) => `<div class="glass cert-c"><b>${esc(label)} · ${esc(c.agree)}</b><span>${esc(c.sub)}</span></div>`;
  let obsCard = '';
  if (obs && Number.isFinite(obs.value)) {
    const { idx, frac } = nowPosition(fc, nowMs);
    const s = snapshot(fc, idx, frac);
    const diff = s.temp - obs.value;
    const at = new Date(obs.t).toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit', timeZone: fc.tz }).replace(':', '.');
    const verdict = Math.abs(diff) < 1 ? 'ennuste osuu' : Math.abs(diff) < 2.5 ? 'ennuste lähellä' : diff > 0 ? 'ennuste liian lämmin' : 'ennuste liian kylmä';
    obsCard = `<div class="glass cert-c obs"><b>Havainto · ${esc(verdict)}</b><span>${esc(`${obs.name || 'Lähin asema'}${Number.isFinite(obs.km) ? ` (${Math.round(obs.km)} km)` : ''} mittasi ${fmtTemp(obs.value, { digits: 1 })} klo ${at}. SääÄly: ${fmtTemp(s.temp, { digits: 1 })}, ero ${fmtNum(Math.abs(diff), 1)}°.`)}</span><small>Ilmatieteen laitoksen avoin data</small></div>`;
  }
  return `<p class="kick">Varmuus</p><h2 class="hl"><b>${esc(ci.l1)}</b><span>${esc(ci.l2)}</span></h2>
    <p class="cert-d">Jokainen helmi on yksi säämalli: vasemmalla kylmempi, oikealla lämpimämpi kuin SääÄlyn ennuste. Mitä tiiviimpi rypäs, sitä varmempi ennuste.</p>
    ${pearlsHtml(ci.today, 'Tänään')}${card(ci.today, 'Tänään')}
    ${obsCard}
    ${ci.tomorrow ? pearlsHtml(ci.tomorrow, 'Huomenna') + card(ci.tomorrow, 'Huomenna') : ''}`;
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
      <summary><span class="label">Mallivertailu</span><span class="sum">${fc.modelsUsed}/${fc.modelsTotal} mallia · suurin ero nyt ${fmtNum(s.spread, 1)}°</span>${SVG.caret}</summary>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th scope="col">Malli</th><th scope="col">Lämpö nyt</th><th scope="col">Ero</th><th scope="col">Sade 24 h</th></tr></thead>
        <tbody>${body}
          <tr class="blend"><th scope="row">Yhdistelmä</th><td>${esc(fmtTemp(s.temp, { digits: 1 }))}</td><td class="delta">0,0</td><td>${esc(fmtMm(fc.hours.slice(idx, idx + 24).reduce((a, h) => a + h.precip, 0)))}</td></tr>
        </tbody></table></div>
      <p class="note">Ero kertoo, kuinka paljon malli poikkeaa yhdistelmästä. Selvästi poikkeavat mallit jätetään yhdistelmästä pois. Vertaa lukemaa Ilmatieteen laitoksen havaintoon.</p>
    </details>`;
}

// ---------- Vastausten lähde ----------

const MODE_INFO = {
  internal: {
    label: 'Oma laskenta',
    note: 'Ei tekoälyä: vastaukset lasketaan sovelluksen keräämästä säädatasta, myös yksittäisten säämallien luvuista. Toimii ilman avainta eikä kuluta Gemini-kiintiötä.',
  },
  grounded: {
    label: 'Gemini + data',
    note: 'Gemini kirjoittaa vastauksen, mutta saa tietää vain sovelluksen säädatan eikä saa käyttää muuta tietoa säästä. Jos Gemini ei vastaa, vastaus tulee sovelluksen omasta laskennasta ja siitä kerrotaan.',
  },
  free: {
    label: 'Gemini vapaa',
    note: 'Luvut tulevat aina sovelluksen datasta, mutta Gemini saa lisäksi käyttää yleistietoa ilmiöiden selittämiseen ja neuvoihin.',
  },
};

const modeNote = ({ mode, hasKey }) => (hasKey ? MODE_INFO[mode]?.note || '' : `${MODE_INFO.internal.note} Lisää Gemini-avain, jos haluat käyttää myös Geminiä.`);

/** Kolmen tilan valitsin. Ilman avainta Gemini-vaihtoehdot ovat himmeitä, ja painallus vie avaimen lisäämiseen. */
function modeSwitchHtml({ mode, hasKey }) {
  const eff = hasKey ? mode : 'internal';
  const segs = Object.entries(MODE_INFO)
    .map(([key, info]) => {
      const off = key !== 'internal' && !hasKey;
      return `<button class="seg${off ? ' off' : ''}" type="button" data-act="mode" data-mode="${key}" aria-pressed="${key === eff}"${off ? ' aria-disabled="true"' : ''}>${esc(info.label)}</button>`;
    })
    .join('');
  return `<div class="modebar" role="group" aria-label="Vastausten lähde">${segs}</div>`;
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

function settingsSheetHtml({ hasKey, mode = 'internal', model, refreshMin, models, demo, sens = 0, anim = true, advOpen = false }) {
  const opts = [5, 10, 15, 30].map((m) => `<option value="${m}" ${m === refreshMin ? 'selected' : ''}>${m} min</option>`).join('');
  const datalist = (models || []).map((m) => `<option value="${esc(m)}"></option>`).join('');
  return `
    <div class="sheet-head"><h2>Asetukset</h2><button class="icon-btn" type="button" data-act="close" aria-label="Sulje">${SVG.close}</button></div>
    <div class="sheet-scroll">
      <div class="quick"><button id="refreshBtn" class="btn ghost" type="button" data-act="refresh">${SVG.refresh}<span>Päivitä sää</span></button><button class="btn ghost" type="button" data-act="locate">${SVG.locate}<span>Käytä sijaintiani</span></button></div>
      ${demo ? '<p class="note demo-note">Esimerkkitila: sää, paikkahaku ja nimet ovat tekaistuja, eikä Gemini ole käytössä. Chat vastaa silti sovelluksen omalla laskennalla.</p>' : ''}
      <section class="set">
        <h3>Pukeutuminen</h3>
        <p class="note">Etusivun vaateneuvo ja chat arvioivat pukeutumisen "tuntuu kuin" -lämpötilasta. Säädä, jos palelet helposti tai kestät kylmää hyvin.</p>
        <label for="sens">Kylmänsietokyky</label>
        <select id="sens">${[[-3, 'Palelen helposti'], [0, 'Normaali'], [3, 'Kestän kylmää']].map(([v, l]) => `<option value="${v}" ${v === sens ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </section>
      <section class="set">
        <h3>Päivitys</h3>
        <label for="refresh">Päivitysväli, kun sovellus on auki</label>
        <select id="refresh">${opts}</select>
      </section>
      <section class="set">
        <h3>Ulkoasu</h3>
        <label for="anim">Animoitu tausta</label>
        <select id="anim"><option value="on" ${anim ? 'selected' : ''}>Päällä (pysähtyy 10 s kosketuksettomana)</option><option value="off" ${anim ? '' : 'selected'}>Pois (säästää akkua)</option></select>
        <p class="note">Tausta pysähtyy myös, kun puhelimen virransäästö on päällä tai akku on lähes tyhjä.</p>
      </section>
      <section class="set">
        <h3>Tiedot</h3>
        <div class="inline"><button class="btn ghost" type="button" data-act="open-about">Tietoja ja tietolähteet</button><button class="btn ghost" type="button" data-act="wipe">Tyhjennä tallennetut tiedot</button></div>
      </section>
      <details class="set adv" id="advSet"${advOpen ? ' open' : ''}>
        <summary><h3>Lisäasetukset</h3><span class="note">Chatin vastausten lähde, Gemini ja diagnostiikka</span>${SVG.caret}</summary>
        <section class="set">
          <h3>Vastausten lähde</h3>
          <p class="note">Valitse, mistä chatin vastaukset ja selitykset tulevat.</p>
          ${modeSwitchHtml({ mode, hasKey })}
          <p class="note" id="modeNote">${esc(modeNote({ mode, hasKey }))}</p>
        </section>
        <section class="set">
          <h3>Gemini-avain</h3>
          <p class="note">Avain tallentuu vain tämän laitteen selaimeen. Hae ilmainen avain osoitteesta <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>.</p>
          <label for="key">Gemini API -avain</label>
          <div class="inline"><input id="key" class="secret" type="text" inputmode="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${hasKey ? 'Avain tallennettu' : 'AIza…'}"><button class="btn" type="button" data-act="save-key">Tallenna</button></div>
          <label for="model">Malli</label>
          <div class="inline"><input id="model" list="modelList" value="${esc(model)}" autocomplete="off" spellcheck="false"><datalist id="modelList">${datalist}</datalist><button class="btn" type="button" data-act="list-models">Hae mallit</button></div>
          <div class="inline"><button class="btn" type="button" data-act="test-ai">Testaa yhteys</button>${hasKey ? '<button class="btn ghost" type="button" data-act="clear-key">Poista avain</button>' : ''}</div>
          <p class="note" id="aiNote" aria-live="polite"></p>
        </section>
        <section class="set">
          <h3>Diagnostiikka</h3>
          <p class="note">Tarkistaa, vastaako jokainen säämalli ja palvelu. Jos jokin ei toimi, kopioi raportti ja lähetä se kehittäjälle.</p>
          <div class="inline"><button class="btn" type="button" data-act="diag">Aja diagnostiikka</button><button class="btn ghost" type="button" data-act="diag-copy">Kopioi raportti</button></div>
          <pre id="diag" class="diag" aria-live="polite"></pre>
        </section>
      </details>
    </div>`;
}

/** Ensikäyttökortti: sijaintilupaa ei kysytä ennen kuin käyttäjä painaa nappia. */
function welcomeHtml({ cities = [] }) {
  const chips = cities.map((c) => `<button class="pill sm" type="button" data-act="welcome-city" data-city="${esc(c)}">${esc(c)}</button>`).join('');
  return `
    <h2>Näytä sää sijainnissasi</h2>
    <p>Sijainti lähetetään vain sääpalvelulle (Open-Meteo) ennusteen hakua varten. Sitä ei tallenneta palvelimelle, eikä sovellus seuraa sinua.</p>
    <div class="inline"><button class="btn" type="button" data-act="welcome-locate">Käytä sijaintiani</button><button class="btn ghost" type="button" data-act="open-search">Valitse paikkakunta</button></div>
    <div class="city-chips" aria-label="Suuria kaupunkeja">${chips}</div>`;
}

/** Tietoja-paneeli: lähteet ja lisenssit, yksityisyys ja rajoitukset. */
function aboutSheetHtml({ version, demo, sources = [] }) {
  return `
    <div class="sheet-head"><h2>Tietoja ja tietolähteet</h2><button class="icon-btn" type="button" data-act="close" aria-label="Sulje">${SVG.close}</button></div>
    <div class="sheet-scroll">
      <section class="set">
        <h3>SääÄly ${esc(version)}</h3>
        <p class="note">SääÄly yhdistää usean säämallin ennusteen yhdeksi ja kertoo tuloksen suomeksi. Luvut laskee koodi, selitykset kirjoittaa sovelluksen oma laskenta tai valinnaisesti Gemini. Kokeiluversio: tärkeissä päätöksissä ja vaaratilanteissa katso <a href="https://www.ilmatieteenlaitos.fi/varoitukset" target="_blank" rel="noopener">Ilmatieteen laitoksen varoitukset</a>.</p>
        ${demo ? '<p class="note demo-note">Esimerkkitila: kaikki tiedot ovat tekaistuja.</p>' : ''}
      </section>
      <section class="set">
        <h3>Sääennusteet</h3>
        <p class="note">Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a> (CC BY 4.0). Open-Meteon kautta käytetään malleja: ECMWF IFS, MET Norway (MET Nordic), DMI HARMONIE, DWD ICON, Météo-France, UK Met Office, NOAA GFS ja Environment Canada GEM. Yhdistelmä, sateen ajoitus, "tuntuu kuin" -lämpötila ja neuvot ovat SääÄlyn omaa laskentaa. "Tuntuu kuin" noudattaa Ilmatieteen laitoksen kaavaa.</p>
        <p class="note">Ilmatieteen laitoksen oma malli ei ole Open-Meteossa, joten sitä ei käytetä. Virallinen ennuste ja varoitukset: <a href="https://www.ilmatieteenlaitos.fi/" target="_blank" rel="noopener">ilmatieteenlaitos.fi</a>.</p>
      </section>
      <section class="set">
        <h3>Lisälähteet</h3>
        <p class="note">Nämä ovat valinnaisia: jos lähde ei vastaa tai ei kata paikkaasi, SääÄly toimii ilman sitä eikä näytä virhettä.</p>
        <ul class="plain">
          <li>Tutkaennuste (sade seuraavien kahden tunnin aikana, Pohjoismaat): <a href="https://api.met.no/weatherapi/nowcast/2.0/documentation" target="_blank" rel="noopener">MET Norway Nowcast</a>, CC BY 4.0.</li>
          <li>Viralliset säävaroitukset (Suomi): <a href="https://www.ilmatieteenlaitos.fi/varoitukset" target="_blank" rel="noopener">Ilmatieteen laitos</a>, CAP-syöte, CC BY 4.0. Koko maan syöte ladataan ja oma alueesi valitaan laitteella, joten sijaintiasi ei lähetetä.</li>
        </ul>
        ${sources.length ? `<ul class="plain src-status" aria-label="Lähteiden tila">${sources.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
      </section>
      <section class="set">
        <h3>Paikat</h3>
        <p class="note">Paikkahaku: Open-Meteo / GeoNames. Paikannimet sijainnista: BigDataCloud ja © OpenStreetMap-tekijät.</p>
      </section>
      <section class="set">
        <h3>Mihin tietosi menevät</h3>
        <ul class="plain">
          <li><b>Sijainti</b> (koordinaatit) lähtee Open-Meteolle ennusteen hakua varten, MET Norwayn tutkaennusteelle ja BigDataCloudille paikannimen hakua varten.</li>
          <li><b>Hakusanat</b> lähtevät Open-Meteon paikkahakuun.</li>
          <li><b>Gemini</b> (valinnainen): jos lisäät avaimen, kysymyksesi ja sovelluksen säädata lähetetään Googlelle. Avain tallentuu vain tämän laitteen selaimeen.</li>
          <li>Ei mainoksia, ei analytiikkaa, ei seurantaa eikä omaa palvelinta. Paikka, asetukset ja välimuisti tallentuvat vain tämän laitteen selaimeen (Tiedot-kohdasta ne voi tyhjentää).</li>
        </ul>
      </section>
      <section class="set">
        <h3>Rajoitukset</h3>
        <p class="note">Ennusteet ovat arvioita. Sadetodennäköisyys ja neuvot ovat SääÄlyn omia laskelmia, eivät viranomaisen varoituksia eivätkä lääketieteellisiä ohjeita. Mallit ovat usein samaa mieltä ja silti väärässä, esimerkiksi sumussa ja järvien tai meren vaikutuksessa.</p>
      </section>
    </div>`;
}

const CHAT_CHIPS = ['Milloin sataa seuraavan kerran?', 'Mitä pukisin huomenna?', 'Millainen viikonloppu on tulossa?', 'Milloin on paras hetki lenkille?', 'Millainen sää on Rovaniemellä?'];

function chatSheetHtml({ mode = 'internal', hasKey = false, hasMessages = false, chips = CHAT_CHIPS }) {
  const list = chips.map((q) => `<button class="pill" type="button" data-act="ask" data-q="${esc(q)}">${esc(q)}</button>`).join('');
  const src = MODE_INFO[hasKey ? mode : 'internal']?.label || MODE_INFO.internal.label;
  return `
    <div class="sheet-head"><h2>Kysy SääÄlyltä</h2><div class="head-actions"><button class="pill sm" id="chatClear" type="button" data-act="chat-clear" ${hasMessages ? '' : 'hidden'}>Tyhjennä</button><button class="icon-btn" type="button" data-act="close" aria-label="Sulje">${SVG.close}</button></div></div>
    <p class="chat-src">Vastaa: ${esc(src)} · <button class="linkish" type="button" data-act="open-adv">vaihda</button></p>
    <div class="sheet-scroll chat-scroll" id="msgs" role="log" aria-live="polite"></div>
    <div class="chips">${list}</div>
    <form class="composer" data-form="chat">
      <textarea id="msg" rows="1" placeholder="Kysy mitä tahansa säästä" aria-label="Viesti"></textarea>
      <button class="send" type="submit" aria-label="Lähetä">${SVG.send}</button>
    </form>`;
}

function messageHtml(m) {
  if (m.role === 'user') return `<div class="msg user"><p>${esc(m.text)}</p></div>`;
  if (m.error) return `<div class="msg bot err"><p>${esc(m.text)}</p></div>`;
  const src = m.src ? `<div class="src">${esc(m.src)}</div>` : '';
  return `<div class="msg bot"><div class="md">${mdToHtml(m.text)}</div>${src}</div>`;
}

const typingHtml = '<div class="msg bot typing" aria-label="SääÄly kirjoittaa"><span></span><span></span><span></span></div>';

/** Tyhjän chatin aloitus: SääÄlyn selitys nykyhetkestä ensimmäisenä viestinä. intro: { text, md, src }. */
function chatEmptyHtml({ mode = 'internal', intro = null }) {
  const first = intro?.text ? `<div class="msg bot intro"><div class="md">${intro.md ? mdToHtml(intro.text) : `<p>${esc(intro.text)}</p>`}</div>${intro.src ? `<div class="src">${esc(intro.src)}</div>` : ''}</div>` : '';
  const note = mode === 'internal' ? 'Vastaan sovelluksen keräämän säädatan perusteella. Kysy esimerkiksi sateesta, tuulesta, pukeutumisesta, ulkoilusta tai muun paikkakunnan säästä.' : 'Gemini vastaa sovelluksen keräämän säädatan perusteella. Kysy esimerkiksi pukeutumisesta, ulkoilusta tai muun paikkakunnan säästä.';
  return `${first}<p class="note center">${note}</p>`;
}
return { SVG, GLYPH, agoText, STALE_MIN, selLabel, placeHtml, sunLine, heroHtml, alertsHtml, verdictHtml, TRACK_HOURS, trackHtml, selectionLines, nightSpans, meteoHtml, radarHtml, hoursPageHtml, weekPageHtml, certPageHtml, modelsHtml, MODE_INFO, modeNote, modeSwitchHtml, searchSheetHtml, resultsHtml, settingsSheetHtml, welcomeHtml, aboutSheetHtml, CHAT_CHIPS, chatSheetHtml, messageHtml, typingHtml, chatEmptyHtml };
})();

// ---- cube.js ----
__m['cube'] = (() => {
// cube.js: neljä sivua näytön kokoisen kuution kylkinä. Sormi kääntää kuutiota, irrotus kääntää lähimmälle kyljelle
// (nopea pyyhkäisy seuraavalle), ja kuutio jatkaa ympäri: Varmuudesta eteenpäin tulee Koti.
// Levossa kuutio on litteä: vain näkyvä kylki on esillä ilman 3D-muunnoksia (terävä teksti, kevyt piirto, muut kyljet inert).
// Pystyvieritys jää selaimelle (touch-action: pan-y), joten sivujen oma vieritys ja vedä-päivittääksesi toimivat kuten ennenkin.

const FACES = 4;
const mod = (n, m) => ((n % m) + m) % m;

/** Kyljen i paikka katsojaan nähden, kun kuution asento on p (sivuina): 0 edessä, ±1 sivulla, ±2 takana. */
function relPos(i, p, n = FACES) {
  let r = mod(i - p, n);
  if (r > n / 2) r -= n;
  return r;
}

/** Lyhin kääntö sivulta a sivulle b (kylkinä, -1, 0, 1 tai 2). */
function shortestStep(a, b, n = FACES) {
  let d = mod(b - a, n);
  if (d > n / 2) d -= n;
  return d;
}

const FLICK = 0.0005; // sivua millisekunnissa (412 px:n ruudulla noin 0,2 px/ms)
const NUDGE = 0.33; // hidas veto riittää, kun kuutio on kääntynyt kolmanneksen

/** Mihin kuutio asettuu irrotettaessa: liikkeessä oleva pyyhkäisy vie sen suuntaan, hidas veto kolmanneksen jälkeen. Enintään yksi kylki aloituksesta. */
function settleTarget(p, from, v) {
  let t;
  if (v > FLICK) t = Math.floor(p + 1e-6) + 1;
  else if (v < -FLICK) t = Math.ceil(p - 1e-6) - 1;
  else t = from + (p - from > NUDGE ? 1 : p - from < -NUDGE ? -1 : 0);
  return Math.max(from - 1, Math.min(from + 1, t));
}

/** Nopeus (sivua/ms) viimeisen 100 ms:n näytteistä [aika, asento]. */
function velocity(samples) {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = samples[0];
  for (const s of samples) if (last[0] - s[0] <= 100) {
    first = s;
    break;
  }
  const dt = last[0] - first[0];
  return dt > 0 ? (last[1] - first[1]) / dt : 0;
}

/**
 * root: kuution ikkuna (#pages), jonka sisällä .cube ja sen sisällä kyljet (.face).
 * onSettle(i) kutsutaan, kun kuutio on levossa uudella tai samalla kyljellä; onStart, kun kääntö alkaa.
 * ignore: valitsin alueille, joiden vaakaveto kuuluu niille itselleen (tuntinauha, sääkaavio).
 */
function createCube(root, { onSettle = () => {}, onStart = () => {}, onTurn = () => {}, reduceMotion = false, ignore = '' } = {}) {
  const cube = root.querySelector('.cube');
  const faces = [...cube.children];
  const n = faces.length;
  let p = 0; // jatkuva asento sivuina
  let page = 0; // levossa näkyvä kylki
  let half = 0;
  let anim = 0;
  let drag = null;
  let suppressClick = false;
  let near = 0; // lähin kylki käännön aikana (pisteet seuraavat sitä)
  const vis = faces.map(() => null);

  function layout() {
    half = (root.clientWidth || innerWidth) / 2;
    root.style.setProperty('--cube-w', `${half * 2}px`);
    if (!root.classList.contains('cube-rest')) {
      faces.forEach((f, i) => (f.style.transform = `rotateY(${i * 90}deg) translateZ(${half}px)`));
      render();
    }
  }

  function setVis(i, on) {
    if (vis[i] === on) return;
    vis[i] = on;
    faces[i].style.visibility = on ? 'visible' : 'hidden';
  }

  function render() {
    cube.style.transform = `translateZ(${-half}px) rotateY(${(-p * 90).toFixed(3)}deg)`;
    faces.forEach((f, i) => {
      const r = Math.abs(relPos(i, p, n));
      setVis(i, r < 0.999);
      f.style.setProperty('--turn', Math.min(1, r).toFixed(3));
    });
    const k = mod(Math.round(p), n);
    if (k !== near) onTurn((near = k));
  }

  function enter3d() {
    if (!root.classList.contains('cube-rest')) return;
    root.classList.remove('cube-rest');
    faces.forEach((f, i) => (f.style.transform = `rotateY(${i * 90}deg) translateZ(${half}px)`));
    render();
  }

  function rest() {
    root.classList.add('cube-rest');
    cube.style.transform = '';
    faces.forEach((f, i) => {
      const on = i === page;
      f.style.transform = '';
      f.style.removeProperty('--turn');
      vis[i] = null;
      f.style.visibility = on ? '' : 'hidden';
      f.inert = !on;
      if (on) f.removeAttribute('aria-hidden');
      else f.setAttribute('aria-hidden', 'true');
    });
  }

  function finish() {
    anim = 0;
    const prev = page;
    page = mod(Math.round(p), n);
    p = page;
    near = page;
    rest();
    // Ilman liikettä kylki vaihtuu häivyttäen, jotta vaihdon huomaa.
    if (reduceMotion && prev !== page) faces[page].animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
    onSettle(page);
  }

  function animateTo(target, v = 0) {
    cancelAnimationFrame(anim);
    const from = p;
    const dist = target - from;
    if (reduceMotion || Math.abs(dist) < 0.002) {
      p = target;
      finish();
      return;
    }
    enter3d();
    const dur = Math.max(240, Math.min(560, (Math.abs(dist) / Math.max(Math.abs(v), 0.0012)) * 1.6));
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      p = from + dist * (1 - Math.pow(1 - k, 3));
      render();
      if (k < 1) anim = requestAnimationFrame(step);
      else {
        p = target;
        finish();
      }
    };
    anim = requestAnimationFrame(step);
  }

  /** Kääntää kyljelle i lyhintä reittiä (animate false: heti). */
  function go(i, { animate = true } = {}) {
    if (drag) return;
    const resting = root.classList.contains('cube-rest');
    const base = resting ? page : Math.round(p);
    const d = shortestStep(mod(base, n), mod(i, n), n);
    if (resting && !d) return;
    if (!animate) {
      cancelAnimationFrame(anim);
      p = base + d;
      finish();
      return;
    }
    animateTo(base + d);
  }

  root.addEventListener('pointerdown', (e) => {
    suppressClick = false;
    if (drag || (e.pointerType === 'mouse' && e.button !== 0) || !e.isPrimary) return;
    if (ignore && e.target.closest?.(ignore)) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lock: null, base: p, from: Math.round(p), samples: [] };
  });

  root.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.lock) {
      if (Math.hypot(dx, dy) < 8) return;
      drag.lock = Math.abs(dx) > Math.abs(dy) * 1.15 ? 'x' : 'y';
      if (drag.lock === 'y') {
        drag = null;
        return;
      }
      cancelAnimationFrame(anim);
      anim = 0;
      drag.base = p;
      drag.from = Math.round(p);
      drag.x0 = e.clientX;
      try {
        root.setPointerCapture(e.pointerId);
      } catch {
        /* ei väliä */
      }
      if (!reduceMotion) enter3d();
      onStart();
    }
    const w = half * 2 || 1;
    const np = Math.max(drag.from - 1, Math.min(drag.from + 1, drag.base - (e.clientX - drag.x0) / w));
    drag.samples.push([e.timeStamp, np]);
    if (drag.samples.length > 12) drag.samples.shift();
    drag.dx = e.clientX - drag.x0;
    suppressClick = true;
    if (!reduceMotion) {
      p = np;
      render();
    }
  });

  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (d.lock !== 'x') return;
    if (reduceMotion) {
      // Ilman liikettä: riittävän pitkä veto vaihtaa kyljen heti.
      const w = half * 2 || 1;
      const t = Math.abs(d.dx || 0) > w * 0.18 ? d.from + (d.dx < 0 ? 1 : -1) : d.from;
      p = t;
      finish();
      return;
    }
    // Irrotushetki on viimeinen näyte: paikallaan pidetty sormi irrotettaessa ei ole pyyhkäisy.
    d.samples.push([e.timeStamp, p]);
    const v = e.type === 'pointercancel' ? 0 : velocity(d.samples);
    animateTo(settleTarget(p, d.from, v), v);
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  // Veto ei ole napautus: estetään vedon perään tuleva klikkaus (tunti, rivi, painike).
  root.addEventListener(
    'click',
    (e) => {
      if (suppressClick) {
        suppressClick = false;
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true,
  );

  layout();
  rest();
  return {
    go,
    layout,
    get page() {
      return page;
    },
    /** Testeille ja kuvakaappauksille: kuutio asentoon p ilman animaatiota (levossa takaisin kutsulla go). */
    peek(pos) {
      cancelAnimationFrame(anim);
      anim = 0;
      enter3d();
      p = pos;
      render();
    },
  };
}
return { FACES, mod, relPos, shortestStep, settleTarget, velocity, createCube };
})();

// ---- app.js ----
__m['app'] = (() => {
// app.js: sovelluksen tila, tapahtumat, päivityssilmukka ja näkymien yhdistäminen.
// Laskenta on moduuleissa (weather, blend, geo, ai); tämä tiedosto vain kutsuu niitä ja piirtää tuloksen.

const { store, defaultFetch, debounce, localNow, zonedToUtcMs, fmtTemp, fmtNum, escapeHtml: esc } = __m['util'];
const { MODELS } = __m['models'];
const { fetchAll, summarizeErrors } = __m['weather'];
const { blendForecast, nowPosition, snapshot } = __m['blend'];
const { searchPlaces, reverseGeocode, getPosition, placeKey, haversineKm, FI_CITIES } = __m['geo'];
const { sunPosition, moonInfo } = __m['sun'];
const { createSky, skyColors, isLightSky } = __m['sky'];
const { RANGES: MG_RANGES } = __m['meteogram'];
const { aiSettings, effectiveMode, shortReason, explain, chat, listModels, pickFlash, generate, textOf, compactForecast, placeLabel } = __m['ai'];
const { answerQuestion } = __m['answer'];
const { verdict } = __m['advice'];
const { fetchNowcast, summarizeNowcast, nowcastUrl } = __m['nowcast'];
const { createGuard, runSource, memoryStorage, sourceLine } = __m['sources'];
const { fetchWarnings, officialRows, inFinland, MIRROR_URL } = __m['warnings'];
const { fetchObs } = __m['observations'];
const { makeDemoFetch } = __m['demo'];
const { agoText, selLabel, placeHtml, heroHtml, verdictHtml, alertsHtml, welcomeHtml, aboutSheetHtml, meteoHtml, selectionLines, hoursPageHtml, weekPageHtml, certPageHtml, radarHtml, trackHtml, modelsHtml, searchSheetHtml, resultsHtml, settingsSheetHtml, chatSheetHtml, messageHtml, typingHtml, chatEmptyHtml, modeNote } = __m['views'];
const { homeHeadline } = __m['headline'];
const { createCube } = __m['cube'];

const VERSION = '0.7.1';
const BUILD = 'ec21e63229'; // korvataan julkaisussa (tools/build.mjs); kehityspuussa paikanvaraaja
const SCHEMA = 1; // tallennetun datan rakenne; kasvata, kun avaimia muutetaan epäyhteensopivasti

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
// Valinnaiset lähteet (tutkaennuste, varoitukset): epäonnistunutta ei kokeilla heti uudelleen, eikä käyttäjälle näytetä virhettä (sources.js)
const sources = createGuard({ storage: DEMO ? memoryStorage() : store, clock: () => nowMs() });

const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEFAULT_PLACE = { name: 'Helsinki', region: 'Uusimaa', country: 'Suomi', lat: 60.1699, lon: 24.9384, mode: 'default' };
const DEMO_PLACE = { name: 'Turku', region: 'Varsinais-Suomi', country: 'Suomi', lat: 60.4518, lon: 22.2666, mode: 'manual' };
const REFRESH_OPTIONS = [5, 10, 15, 30];
const CACHE_MAX_AGE = 24 * 3600 * 1000;
const CACHE_V = 2; // kasvata, kun tallennetun datan muoto tai tulkinta muuttuu (v2: "edellisen tunnin" suureet siirretty jäsennyksessä)

const $ = (sel, root = document) => root.querySelector(sel);
const el = {
  sky: $('#sky'),
  place: $('#placeBtn'),
  banner: $('#banner'),
  update: $('#update'),
  app: $('#app'),
  welcome: $('#welcome'),
  pages: $('#pages'),
  pgHome: $('#pgHome'),
  alerts: $('#alerts'),
  hero: $('#hero'),
  verdict: $('#verdict'),
  stage: $('#stage'),
  track: $('#track'),
  hourly: $('#hourly'),
  daily: $('#daily'),
  meteo: $('#meteo'),
  models: $('#models'),
  certainty: $('#certainty'),
  fab: $('#fab'),
  dots: $('#dots'),
  hint: $('#swipeHint'),
  sheet: $('#sheet'),
  panel: $('#sheetPanel'),
  theme: $('meta[name="theme-color"]'),
};

// ---------- Tila ----------

const savedRefresh = store.num('refreshMin', 10);
const state = {
  place: null,
  results: null,
  fc: null,
  fetchedAt: 0,
  loading: false,
  manualLoad: false,
  error: '',
  sel: { type: 'now' },
  dayOpen: null, // Viikko-sivun päivä, jonka tunnit näytetään sen rivin alla
  page: 0, // näkyvä sivu: 0 koti, 1 tunnit, 2 viikko, 3 varmuus
  hourOpen: null, // Tunnit-sivun avattu tunti (lisätiedot rivin alla)
  hoursMore: false, // Tunnit-sivulla 48 tuntia 13 sijaan
  hoursView: store.str('hoursView', 'list') === 'chart' ? 'chart' : 'list',
  ai: { status: 'idle', text: '', error: '', fp: '' },
  refreshMin: REFRESH_OPTIONS.includes(savedRefresh) ? savedRefresh : 10,
  sheet: null,
  found: [],
  recent: store.array('recent').filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon)),
  chat: [],
  chatBusy: false,
  chatLast: null, // vastausmoottorin muisti: edellisen kysymyksen paikka, aihe ja ajankohta ("Entä huomenna?")
  models: [],
  banner: null,
  first: false, // ensimmäinen käynnistys: näytetään paikan valintakortti, eikä sijaintilupaa kysytä ennen kuin käyttäjä painaa
  sens: Math.max(-3, Math.min(3, store.num('sens', 0))), // kylmänsietokyky: −3 (palelen helposti) … +3 (kestän kylmää)
  vday: 'today', // yläpalkin valinta: 'today' | 'tomorrow' (etusivu ja Tunnit näyttävät valitun päivän)
  mg: { range: Object.hasOwn(MG_RANGES, store.str('mgRange', '24h')) ? store.str('mgRange', '24h') : '24h', inspectIso: null }, // sääkaavio: aikaväli ja tarkastettu hetki
  nowcast: null, // tutkaennusteen tulkinta nykyhetkelle (nowcast.js), jos saatavilla
  nc: { raw: null, key: '', at: 0, ttl: 0 }, // viimeisin haettu tutkaennuste, paikka ja haun ajankohta
  warn: { raw: null, at: 0 }, // koko maan CAP-varoitukset (warnings.js); oma alue valitaan piirrettäessä
  official: [], // viralliset varoitukset (warnings.js), jos saatavilla
  obs: { raw: null, key: '', at: 0 }, // lähimmän sääaseman havainto (observations.js), jos saatavilla
};

// Gemini on käytettävissä vain, kun avain on tallennettu (esimerkkitilassa ei koskaan). Ilman sitä vastataan sovelluksen omalla laskennalla.
const keyOn = () => !DEMO && Boolean(aiSettings.key());
const aiMode = () => effectiveMode(keyOn(), aiSettings.mode()); // internal | grounded | free
const geminiOn = () => aiMode() !== 'internal';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Piirtäminen ----------

const last = {};

/** Tunnistaa fokusoidun painikkeen data-attribuuteista, jotta sen voi löytää uudelleenpiirron jälkeen. */
function focusSelector(a) {
  const q = (v) => String(v).replace(/["\\]/g, '\\$&');
  const parts = ['data-act', 'data-iso', 'data-date', 'data-i', 'id'].filter((k) => a.getAttribute(k) != null).map((k) => `[${k}="${q(a.getAttribute(k))}"]`);
  return parts.length ? `${a.tagName.toLowerCase()}${parts.join('')}` : null;
}

function patch(key, node, html) {
  if (last[key] === html) return false;
  last[key] = html;
  // Uudelleenpiirto korvaa painikkeet. Fokus palautetaan samaan kohtaan, ettei näppäimistö- tai ruudunlukijakäyttäjä putoa sivun alkuun.
  const a = document.activeElement;
  const sel = a && a !== document.body && node.contains(a) ? focusSelector(a) : null;
  node.innerHTML = html;
  if (sel) {
    try {
      node.querySelector(sel)?.focus({ preventScroll: true });
    } catch {
      /* huono valitsin: ei väliä */
    }
  }
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
  $('#refreshBtn')?.classList.toggle('spin', state.loading && (state.manualLoad || !state.fc));
}

/** SääÄlyn selitys nykyhetkestä näkyy chatin ensimmäisenä viestinä (aiemmin etusivun kortti). */
function renderAi() {
  if (state.sheet === 'chat' && !state.chat.length) renderChat();
}

function chatIntro() {
  if (!state.fc) return null;
  if (geminiOn() && state.ai.status === 'done' && state.ai.text) return { text: state.ai.text, md: true, src: 'SääÄly kertoo · Gemini' };
  const lines = selectionLines(state.fc, { type: 'now' }, nowMs());
  return lines.length ? { text: lines.join(' '), md: false, src: `SääÄly kertoo · oma laskenta, ${state.fc.modelsUsed}/${state.fc.modelsTotal} mallia` } : null;
}

/** Etusivun otsikko ja varoitusrivi: laskenta headline.js:ssä ja advice.js:ssä, tässä vain piirretään. */
function renderAdvice(fc, now) {
  state.nowcast = currentNowcast(now);
  state.official = currentOfficial(now);
  let hl = null;
  let v = null;
  try {
    hl = homeHeadline(fc, now, { day: state.vday, sensitivity: state.sens, nowcast: state.nowcast });
  } catch {
    hl = null; // neuvot ovat lisä, eivätkä saa kaataa muuta näkymää
  }
  try {
    v = verdict(fc, now, { window: 'today', lat: state.place?.lat, sensitivity: state.sens, nowcast: state.nowcast });
  } catch {
    v = null;
  }
  document.querySelectorAll('#hdSeg .seg').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.day === state.vday)));
  el.verdict.hidden = !hl;
  patch('verdict', el.verdict, hl ? verdictHtml({ hl }) : '');
  const html = alertsHtml({ alerts: v?.alerts || [], official: state.official, officialState: officialState(now), checkedAt: state.warn.fetchedAt || 0, nowMs: now });
  el.alerts.hidden = !html;
  if (patch('alerts', el.alerts, html)) sizeStage();
}

/** Etusivun näyttämö mahtuu ruudulle: korkeus = sivu − varoitusrivi − alapalkki. Leveys seuraa radan kuvasuhdetta (412 x 750). */
function sizeStage() {
  const pg = el.pgHome;
  if (!pg || el.stage.classList.contains('stage-off')) {
    el.stage.style.width = '';
    return;
  }
  const H = pg.clientHeight;
  const W = pg.clientWidth;
  if (!H || !W) return;
  const top = el.alerts.hidden ? 0 : el.alerts.offsetHeight + 6;
  const pill = el.fab ? el.fab.getBoundingClientRect().height + 8 : 110;
  // Radan alimmat merkit ovat 94 %:n korkeudella: niiden on jäätävä alapalkin yläpuolelle. Kuvan loppu saa jäädä palkin alle.
  const h = (H - top - pill) / 0.94;
  const fit = (h * 412) / 750;
  const w = Math.round(Math.max(260, Math.min(W, fit)));
  el.stage.style.width = `${w}px`;
  // Hyvin lyhyellä ruudulla (monta varoitusta) näyttämö ei mahdu: sivu vierii, ja loppuun jää tilaa palkin yli.
  // Väli on ::after-elementti (muuttuja), ei sivun täyte: sivun oma koko ei muutu, joten ResizeObserver ei kierrä.
  pg.style.setProperty('--stage-pad', fit < 260 ? `${Math.ceil(pill)}px` : '0px');
}

// ---------- Valinnaiset lähteet ----------

const NC_TTL = 5 * 60000; // tutkaennuste päivittyy viiden minuutin välein
const NC_TTL_NOCOV = 60 * 60000; // kattavuuden ulkopuolella kysytään harvoin
let ncBusy = false;
const ncKey = (p) => (p && Number.isFinite(p.lat) && Number.isFinite(p.lon) ? `${p.lat.toFixed(2)},${p.lon.toFixed(2)}` : '');

/** Tutkaennusteen tulkinta hetkelle now; null, jos ei saatavilla, vanhentunut tai haettu toiselle paikalle. */
function currentNowcast(now) {
  const nc = state.nc;
  if (!nc.raw || nc.key !== ncKey(state.place)) return null;
  const s = summarizeNowcast(nc.raw, now);
  return s.ok ? s : null;
}

/** Hakee tutkaennusteen, jos edellinen on vanha (tai ignoreAge). Ei koskaan heitä eikä näytä virhettä; epäonnistumisen jälkeen sources.js pitää taukoa. */
async function refreshNowcast({ ignoreAge = false } = {}) {
  const p = state.place;
  const key = ncKey(p);
  if (!key || ncBusy) return;
  const now = nowMs();
  const nc = state.nc;
  if (!ignoreAge && nc.key === key && now - nc.at < nc.ttl) return;
  ncBusy = true;
  try {
    const r = await runSource(sources, 'nowcast', () => fetchNowcast(p.lat, p.lon, { fetchFn }), { now });
    if (ncKey(state.place) === key && 'value' in r) state.nc = { raw: r.value, key, at: now, ttl: r.value ? NC_TTL : NC_TTL_NOCOV }; // value null = tutka ei kata paikkaa
  } finally {
    ncBusy = false;
  }
  if (state.fc) {
    renderAdvice(state.fc, nowMs());
    renderHours();
  }
}

const OBS_TTL = 10 * 60000; // asemat mittaavat kymmenen minuutin välein
let obsBusy = false;

/** Lähimmän aseman havainto, jos se on haettu tälle paikalle eikä ole vanha. */
function currentObs(now) {
  const o = state.obs;
  if (!o.raw || o.key !== ncKey(state.place) || now - o.raw.t > 90 * 60000) return null;
  return o.raw;
}

/** Hakee havainnon Suomessa olevalle paikalle. Hiljainen lisälähde kuten tutkaennuste. */
async function refreshObs({ ignoreAge = false } = {}) {
  const p = state.place;
  const key = ncKey(p);
  if (!key || obsBusy || !inFinland(p.lat, p.lon)) return;
  const now = nowMs();
  if (!ignoreAge && state.obs.key === key && now - state.obs.at < OBS_TTL) return;
  obsBusy = true;
  try {
    const r = await runSource(sources, 'obs', () => fetchObs(p.lat, p.lon, { fetchFn, now }), { now });
    if (ncKey(state.place) === key && 'value' in r) state.obs = { raw: r.value, key, at: now };
  } finally {
    obsBusy = false;
  }
  if (state.fc) {
    renderHours();
    patch('certainty', el.certainty, certPageHtml({ fc: state.fc, results: state.results, nowMs: nowMs(), obs: currentObs(nowMs()) }));
  }
}

const WARN_TTL = 15 * 60000; // CAP-syöte päivittyy useita kertoja päivässä; neljännestunnin välein riittää
let warnBusy = false;

/** Oman paikan viralliset varoitukset hetkelle now (tyhjä, jos syötettä ei ole haettu tai paikka on Suomen ulkopuolella). */
function currentOfficial(now) {
  const p = state.place;
  if (!state.warn.raw || !p || !inFinland(p.lat, p.lon)) return [];
  try {
    return officialRows(state.warn.raw, p.lat, p.lon, now);
  } catch {
    return [];
  }
}

/** Onko virallisten varoitusten tila tiedossa? 'unknown' = niitä ei voitu tarkistaa (haku epäonnistui, peili vanhentunut tai laite offline). */
function officialState(now) {
  const p = state.place;
  if (!p || !inFinland(p.lat, p.lon)) return 'ok';
  const st = sources.status('warnings');
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (state.warn.stale) return 'unknown';
  if (state.warn.at && now - state.warn.at > 6 * 3600000) return 'unknown';
  if (!state.warn.raw) return offline || Number(st.lastFail) > (Number(st.lastOk) || 0) ? 'unknown' : 'ok';
  return Number(st.lastFail) > (Number(st.lastOk) || 0) && now - state.warn.at > 30 * 60000 ? 'unknown' : 'ok';
}

/** Hakee Ilmatieteen laitoksen varoitussyötteen, jos edellinen on vanha. Hiljainen varmistus kuten tutkaennusteessa; Suomen ulkopuolella ei haeta. */
async function refreshWarnings({ ignoreAge = false } = {}) {
  const p = state.place;
  if (!p || warnBusy || !inFinland(p.lat, p.lon)) return;
  const now = nowMs();
  if (!ignoreAge && state.warn.at && now - state.warn.at < WARN_TTL) return;
  warnBusy = true;
  try {
    const r = await runSource(sources, 'warnings', () => fetchWarnings({ fetchFn, now }), { now });
    // Vanhentunut peili (value null) ei ole virhe, mutta uutta tietoa ei ole: edellinen lista jää voimaan ja seuraavaa hakua odotetaan normaalisti
    if ('value' in r) state.warn = { raw: r.value ? r.value.alerts : state.warn.raw, at: now, stale: !r.value, fetchedAt: r.value ? r.value.fetchedAt : (r.raw?.fetchedAt ?? state.warn.fetchedAt) };
  } finally {
    warnBusy = false;
  }
  if (state.fc) renderAdvice(state.fc, nowMs());
}

function renderWelcome() {
  const show = state.first && !state.sheet;
  el.welcome.hidden = !show;
  patch('welcome', el.welcome, show ? welcomeHtml({ cities: FI_CITIES.slice(0, 10).map((c) => c[0]) }) : '');
}

// ---------- Sääkaavio ----------

function renderMeteo(now = nowMs()) {
  if (!state.fc || !el.meteo) return;
  const avail = Math.round(el.meteo.clientWidth || innerWidth - 64);
  const width = Math.max(260, Math.min(640, avail + 12)); // .mg-wrap ulottuu 6 px sisältöalueen ulkopuolelle
  const compact = parseFloat(getComputedStyle(document.documentElement).fontSize) >= 22; // suuri tekstikoko: vähemmän tekstiä kaaviossa
  patch('meteo', el.meteo, meteoHtml({ fc: state.fc, nowMs: now, range: state.mg.range, inspectIso: state.mg.inspectIso, width, compact }));
}

/** Kaavion jakson alkuhetki (paikallinen ISO) annetulle indeksille nykyisellä aikavälillä. */
function mgIsoAt(j) {
  const { fc } = state;
  if (!fc) return null;
  const { idx } = nowPosition(fc, nowMs());
  return fc.hours[idx + j * (MG_RANGES[state.mg.range]?.binH || 1)]?.t ?? null;
}

function mgIndexAt(wrap, clientX) {
  const rect = wrap.getBoundingClientRect();
  const W = Number(wrap.dataset.w) || rect.width;
  const n = Number(wrap.dataset.n) || 1;
  const x = ((clientX - rect.left) / (rect.width || 1)) * W;
  return Math.max(0, Math.min(n - 1, Math.floor(((x - 12) / (W - 24)) * n)));
}

function mgInspect(j) {
  const iso = j == null ? null : mgIsoAt(j);
  if (state.mg.inspectIso === iso) return;
  state.mg.inspectIso = iso;
  renderMeteo();
}

function bindMeteo() {
  let drag = false;
  let pending = null;
  const flush = () => {
    const p = pending;
    pending = null;
    const wrap = $('#mgWrap');
    if (p != null && wrap) mgInspect(mgIndexAt(wrap, p));
  };
  document.addEventListener('pointerdown', (ev) => {
    if (!ev.target.closest?.('#mgWrap')) return;
    drag = true;
    pending = ev.clientX;
    flush();
  });
  document.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    if (pending == null) requestAnimationFrame(flush);
    pending = ev.clientX;
  });
  document.addEventListener('pointercancel', () => (drag = false));
  document.addEventListener('pointerup', () => {
    if (!drag) return;
    drag = false;
    // Tarkastuskohdan piirtäminen korvasi napautetun solmun, jolloin selaimen oma fokusointi (mousedown) osui irrotettuun solmuun ja poisti fokuksen.
    // Palautetaan fokus kaavioon vasta kun hiiri-/kosketustapahtumat on käsitelty, jotta nuolinäppäimet toimivat napautuksen jälkeen.
    setTimeout(() => {
      const wrap = $('#mgWrap');
      if (wrap && document.activeElement !== wrap) wrap.focus({ preventScroll: true });
    }, 0);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.target.id !== 'mgWrap') return;
    const n = Number(ev.target.dataset.n) || 1;
    const cur = Number(ev.target.getAttribute('aria-valuenow')) || 0;
    const has = state.mg.inspectIso != null;
    const keys = { ArrowLeft: has ? cur - 1 : 0, ArrowRight: has ? cur + 1 : 0, ArrowDown: has ? cur - 1 : 0, ArrowUp: has ? cur + 1 : 0, Home: 0, End: n - 1 };
    if (ev.key === 'Escape' && has) {
      ev.preventDefault();
      ev.stopPropagation();
      mgInspect(null);
    } else if (ev.key in keys) {
      ev.preventDefault();
      mgInspect(Math.max(0, Math.min(n - 1, keys[ev.key])));
    }
  });
  let lastW = 0;
  window.addEventListener(
    'resize',
    debounce(() => {
      const w = el.meteo?.clientWidth || 0;
      if (state.fc && Math.abs(w - lastW) > 4) {
        lastW = w;
        renderMeteo();
      }
    }, 150),
  );
}

function renderAll() {
  renderHeader();
  renderWelcome();
  if (!state.fc) {
    patch('hero', el.hero, state.error ? problemHtml(state.error) : SKELETON);
    el.stage.classList.add('stage-off');
    el.track.hidden = true;
    patch('track', el.track, '');
    el.verdict.hidden = true;
    el.alerts.hidden = true;
    patch('verdict', el.verdict, '');
    patch('alerts', el.alerts, '');
    for (const k of ['hourly', 'daily', 'certainty', 'models']) patch(k, el[k], '');
    el.meteo.hidden = true;
    sizeStage();
    return;
  }
  const now = nowMs();
  const { fc, sel } = state;
  const day = state.vday;
  patch('hero', el.hero, heroHtml({ fc, nowMs: now, sel, day }));
  el.stage.classList.remove('stage-off');
  el.track.hidden = false;
  patch('track', el.track, trackHtml({ fc, nowMs: now, sel, day }));
  renderAdvice(fc, now);
  renderHours(now);
  renderWeek(now);
  patch('certainty', el.certainty, certPageHtml({ fc, results: state.results, nowMs: now, obs: currentObs(now) }));
  const wasOpen = $('.models-d', el.models)?.open;
  if (patch('models', el.models, modelsHtml({ results: state.results, fc, nowMs: now })) && wasOpen) $('.models-d', el.models).open = true;
  sizeStage();
}

/** Tunnit-sivu: lista tai kaavio. Tutkan käyrä näkyy, kun sade on alle kahden tunnin päässä. */
function renderHours(now = nowMs()) {
  const { fc } = state;
  if (!fc) return;
  const chart = state.hoursView === 'chart';
  const raw = state.nc.key === ncKey(state.place) ? state.nc.raw : null;
  const radar = state.vday === 'today' ? radarHtml({ raw, nc: state.nowcast, nowMs: now, tz: fc.tz }) : '';
  patch('hourly', el.hourly, hoursPageHtml({ fc, nowMs: now, day: state.vday, open: state.hourOpen, more: state.hoursMore, view: state.hoursView, radar, fetchedAt: state.fetchedAt, loading: state.loading && state.manualLoad, obs: currentObs(now), nowcast: state.vday === 'today' ? state.nowcast : null }));
  el.meteo.hidden = !chart;
  if (chart) renderMeteo(now);
}

/** Viikko-sivu. Avatun päivän tuntinauha aloittaa aamusta (tänään nykyhetkestä). */
function renderWeek(now = nowMs()) {
  const { fc } = state;
  if (!fc) return;
  if (state.dayOpen && !fc.days.slice(0, 7).some((d) => d.date === state.dayOpen)) state.dayOpen = null;
  const dayLeft = $('.dstrip', el.daily)?.scrollLeft || 0;
  if (patch('daily', el.daily, weekPageHtml({ fc, nowMs: now, open: state.dayOpen }))) {
    const ds = $('.dstrip', el.daily);
    if (ds) {
      if (dayLeft && ds.dataset.date === state.dayScrolled) ds.scrollLeft = dayLeft;
      else {
        const first = ds.querySelector('.hr');
        const morning = ds.querySelector('.hr[data-iso$="T07:00"]');
        ds.scrollLeft = morning && first ? Math.max(0, morning.offsetLeft - first.offsetLeft) : 0;
        state.dayScrolled = ds.dataset.date;
      }
    }
  }
}

// ---------- Sivut ----------

let pageEntry = false; // alisivulle siirtyminen lisää historiaan yhden merkinnän: Androidin takaisin palaa kotiin
let ignorePop = false;

let cube = null; // sivukuutio (js/cube.js)

function goPage(i, { smooth = true } = {}) {
  cube?.go(i, { animate: smooth });
}

/** Kuutio asettui kyljelle i: pisteet, historia (Androidin takaisin palaa kotiin) ja vihjeen piilotus. */
function markDot(i) {
  el.dots?.querySelectorAll('button').forEach((b) => (+b.dataset.page === i ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')));
}

function onPageChange(i) {
  markDot(i);
  if (i === state.page) return;
  const prev = state.page;
  state.page = i;
  if (prev === 0 && i > 0 && !pageEntry && !state.sheet) {
    try {
      history.pushState({ saaalyPage: true }, '');
      pageEntry = true;
    } catch {
      pageEntry = false;
    }
  } else if (i === 0 && pageEntry && !state.sheet) {
    pageEntry = false;
    ignorePop = true;
    try {
      history.back();
    } catch {
      ignorePop = false;
    }
  }
  if (el.hint && !el.hint.hidden) {
    el.hint.hidden = true;
    store.set('swiped', true);
  }
}

/** Kerran laitteella: vihje sivujen pyyhkäisystä, kunnes käyttäjä vaihtaa sivua. */
function maybeHint() {
  if (DEMO || store.bool('swiped', false) || !el.hint || !state.fc) return;
  el.hint.hidden = false;
  setTimeout(() => {
    if (!el.hint.hidden) el.hint.hidden = true;
  }, 9000);
}

/** Uuden version ilmoitus: oma elementtinsä, jota paikan vaihto tai haku ei tyhjennä. */
function showUpdate(on) {
  if (!el.update) return;
  el.update.hidden = !on;
  el.update.dataset.kind = 'info';
  el.update.innerHTML = on ? '<span>Uusi versio SääÄlystä on saatavilla.</span><button type="button" data-act="update-app">Päivitä</button>' : '';
}

let updateCheckedAt = 0;
async function checkForUpdate({ force = false } = {}) {
  if (DEMO || BUILD.startsWith('__') || !navigator.onLine) return;
  const t = Date.now();
  if (!force && t - updateCheckedAt < 30 * 60000) return;
  updateCheckedAt = t;
  try {
    const res = await fetch('version.json', { cache: 'no-store' });
    if (!res.ok) return;
    const v = await res.json();
    if (v && typeof v.build === 'string' && /^[0-9a-f]{6,}$/.test(v.build) && v.build !== BUILD) showUpdate(true);
  } catch {
    /* ei verkkoa tai tiedostoa: kokeillaan myöhemmin */
  }
}

async function updateApp() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch {
    /* ei väliä */
  }
  location.reload();
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
  sky = createSky(el.sky, { reduceMotion, animate: store.bool('anim', true) });
  sky.start();
}

function setThemeColor(alt) {
  const c = skyColors(alt)[0].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  el.theme?.setAttribute('content', '#' + c);
  const light = isLightSky(alt);
  document.body.classList.toggle('light', light);
  el.theme?.parentNode?.querySelector('meta[name="color-scheme"]')?.setAttribute('content', light ? 'light' : 'dark');
}

function skyIdle() {
  const p = state.place;
  const sun = sunPosition(nowMs(), p.lat, p.lon);
  const moon = moonInfo(nowMs(), p.lat, p.lon);
  sky.set({ alt: sun.altitudeDeg, bearing: sun.bearingDeg, cloud: 0.4, precip: 0, snow: 0, wind: 3, windDir: 225, thunder: 0, fog: 0, moonPhase: moon.phase, moonAlt: moon.altitudeDeg, moonHA: moon.hourAngle }, { snap: true });
  setThemeColor(sun.altitudeDeg);
}

/** Taivaan tila nykyhetkelle. Valittu tunti ei vaihda taustaa eikä teemaa: tausta kertoo aina, millainen sää on nyt. */
function skyStateFor() {
  const { fc } = state;
  const now = nowMs();
  const { idx, frac } = nowPosition(fc, now);
  const h = snapshot(fc, idx, frac);
  const sun = sunPosition(now, fc.lat, fc.lon);
  const moon = moonInfo(now, fc.lat, fc.lon);
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
  store.set('cache', { v: CACHE_V, placeKey: placeKey(state.place), fetchedAt: state.fetchedAt, results: slim });
}

function restoreCache() {
  if (DEMO) return false;
  const c = store.object('cache');
  if (!c || c.v !== CACHE_V || !Array.isArray(c.results) || c.placeKey !== placeKey(state.place)) return false;
  if (nowMs() - c.fetchedAt > CACHE_MAX_AGE) return false;
  try {
    const results = c.results.map((r) => ({ ...r, model: MODELS.find((m) => m.key === r.key) })).filter((r) => r.model);
    state.fc = blendForecast(results, { nowMs: nowMs() });
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
let inflight = null; // käynnissä oleva haku: { key, ctl, promise }

function validateSelection() {
  const { fc, sel } = state;
  if (!fc) return;
  const { idx, local } = nowPosition(fc, nowMs());
  if (sel.type === 'hour') {
    const i = fc.hours.findIndex((h) => h.t === sel.iso);
    if (i < idx) state.sel = { type: 'now' };
  } else if (sel.type !== 'now') state.sel = { type: 'now' };
  if (state.hourOpen && !fc.hours.some((h, i) => h.t === state.hourOpen && i >= idx)) state.hourOpen = null;
  void local;
}

/** Yksi haku kerrallaan: sama paikka käynnissä -> odotetaan sitä; toinen paikka -> vanha haku perutaan. */
function load({ manual = false } = {}) {
  if (!state.place) return Promise.resolve();
  const key = placeKey(state.place);
  if (inflight && inflight.key === key) {
    if (manual) {
      state.manualLoad = true;
      renderHeader();
    }
    return inflight.promise;
  }
  inflight?.ctl.abort();
  const entry = { key, ctl: new AbortController(), promise: null };
  inflight = entry;
  entry.promise = runLoad({ manual, signal: entry.ctl.signal }).finally(() => {
    if (inflight === entry) inflight = null;
  });
  return entry.promise;
}

async function runLoad({ manual = false, signal } = {}) {
  const seq = ++loadSeq;
  const place = state.place;
  state.loading = true;
  state.manualLoad = manual || !state.fc;
  renderAll();
  let results = [];
  try {
    results = await fetchAll(place.lat, place.lon, { fetchFn, noCache: manual, now: nowMs(), signal });
  } catch {
    results = [];
  }
  if (seq !== loadSeq) return; // paikka vaihtui tai uudempi haku on käynnissä
  state.loading = false;
  let fc = null;
  try {
    fc = blendForecast(results, { nowMs: nowMs() });
  } catch {
    fc = null;
  }
  if (!fc) {
    const why = summarizeErrors(results);
    const net = results.length && results.every((r) => r.kind === 'network' || r.kind === 'timeout');
    const hint = net ? ' Tarkista verkkoyhteys. Jos verkko toimii muuten, sisällönesto voi estää osoitteen api.open-meteo.com.' : '';
    if (state.fc) {
      setBanner({ id: 'stale', kind: 'warn', text: `Päivitys ei onnistunut. Näytetään ennuste, joka haettiin ${agoText(nowMs() - state.fetchedAt)}.`, action: { act: 'refresh', label: 'Yritä uudelleen' } });
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
  maybeHint();
  if (state.sheet === 'chat') syncAi({ immediate: true });
  void refreshNowcast({ ignoreAge: manual });
  void refreshWarnings({ ignoreAge: manual });
  void refreshObs({ ignoreAge: manual });
}

// ---------- Paikka ----------

function setPlace(place) {
  state.place = place;
  state.fc = null;
  state.results = null;
  state.error = '';
  state.sel = { type: 'now' };
  state.dayOpen = null;
  state.ai = { status: 'idle', text: '', error: '', fp: '' };
  state.chatLast = null;
  setBanner(null);
  persistPlace();
  skyIdle();
  renderAll();
  load();
}

function pickPlace(p) {
  if (!p) return;
  state.first = false;
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
  state.first = false;
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
const AI_CACHE_MAX = 50;
let aiSeq = 0;
let aiAbort = null;

function selection() {
  return { type: 'now', label: 'nyt' };
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
  void sel;
  return [placeKey(place), 'now', 'nyt', local.iso.slice(0, 13), wet, Math.round(fc.hours[idx].temp / 3), aiSettings.model(), aiMode()].join('|');
}

function syncAi({ immediate = false } = {}) {
  // Selitys näkyy vain chatin ensimmäisenä viestinä: Geminiä ei kutsuta, kun chat on kiinni
  if (!state.fc || !state.place?.name || state.sheet !== 'chat') return;
  const fp = aiFingerprint();
  if (state.ai.fp === fp && state.ai.status !== 'idle') return;
  const cached = aiCache.get(fp);
  if (cached) {
    state.ai = { status: 'done', text: cached, error: '', fp };
    renderAi();
    return;
  }
  state.ai = { status: geminiOn() ? 'loading' : 'idle', text: '', error: '', fp };
  renderAi();
  if (geminiOn()) {
    if (immediate) runAi();
    else runAiSoon();
  }
}

async function runAi({ force = false } = {}) {
  if (!state.fc || !state.place?.name || !geminiOn()) return;
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
    const text = await explain({ fc: state.fc, place: state.place, nowMs: nowMs(), selection: selection(), results: state.results, mode: aiMode(), fetchFn, signal: aiAbort.signal });
    if (mySeq !== aiSeq) return;
    aiCache.set(fp, text);
    if (aiCache.size > AI_CACHE_MAX) aiCache.delete(aiCache.keys().next().value); // vanhin pois (Map säilyttää lisäysjärjestyksen)
    state.ai = { status: 'done', text, error: '', fp };
  } catch (e) {
    if (mySeq !== aiSeq || e?.kind === 'abort') return;
    state.ai = { status: 'error', text: '', error: e?.message || 'Tuntematon virhe', fp };
  }
  renderAi();
}
const runAiSoon = debounce(() => runAi(), 450);

/** Radan tunnin valinta näkyy etusivun sankarissa paikallaan: sivu ei vieritä minnekään. */
function select(sel) {
  state.sel = sel;
  renderAll();
}

// ---------- Päivityssilmukka ----------

let tickTimer = 0;

function tick() {
  if (!state.fc || state.loading) return;
  if (nowMs() - state.fetchedAt >= state.refreshMin * 60000 - 1000) {
    load();
    return;
  }
  void refreshNowcast();
  void refreshWarnings();
  void refreshObs();
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
const TITLES = { search: 'Paikkakunta', settings: 'Asetukset', chat: 'Kysy SääÄlyltä', about: 'Tietoja ja tietolähteet' };

function sheetContent(kind) {
  if (kind === 'search') return searchSheetHtml({ recent: state.recent });
  if (kind === 'chat') return chatSheetHtml({ mode: aiMode(), hasKey: keyOn(), hasMessages: state.chat.length > 0 });
  if (kind === 'about') return aboutSheetHtml({ version: VERSION, demo: DEMO, sources: ['nowcast', 'warnings', 'obs'].map((id) => sourceLine(id, sources.status(id), nowMs())) });
  return settingsSheetHtml({ hasKey: keyOn(), mode: aiMode(), model: aiSettings.model(), refreshMin: state.refreshMin, models: state.models, demo: DEMO, sens: state.sens, anim: store.bool('anim', true) });
}

function openSheet(kind) {
  const already = Boolean(state.sheet);
  if (!already) lastFocus = document.activeElement;
  state.sheet = kind;
  el.panel.dataset.kind = kind;
  el.panel.setAttribute('aria-label', TITLES[kind]);
  el.panel.innerHTML = sheetContent(kind);
  if (kind === 'chat') {
    chatShown = 0;
    renderChat();
    syncAi();
  }
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

/** Chat: uudet viestit lisätään loppuun (ruudunlukija lukee vain uuden viestin), tyhjä keskustelu piirretään kokonaan. */
let chatShown = 0;
function renderChat() {
  const box = $('#msgs');
  if (!box || state.sheet !== 'chat') return;
  const n = state.chat.length;
  box.querySelector('.typing')?.remove();
  if (n && box.dataset.mode === 'msgs' && n >= chatShown) {
    for (const m of state.chat.slice(chatShown)) box.insertAdjacentHTML('beforeend', messageHtml(m));
  } else {
    box.innerHTML = n ? state.chat.map(messageHtml).join('') : chatEmptyHtml({ mode: aiMode(), intro: chatIntro() });
    box.dataset.mode = n ? 'msgs' : 'empty';
  }
  chatShown = n;
  if (state.chatBusy) box.insertAdjacentHTML('beforeend', typingHtml);
  box.scrollTop = box.scrollHeight;
  const send = $('.send');
  if (send) send.disabled = state.chatBusy;
  const clear = $('#chatClear');
  if (clear) clear.hidden = !state.chat.length || state.chatBusy;
}

const placeData = new Map();

/** Minkä tahansa paikan yhdistetty ennuste (chat ja Geminin työkalu). Pidetään muistissa 10 min, jotta jatkokysymykset eivät hae uudelleen. */
async function forecastFor(place) {
  const key = placeKey(place);
  const hit = placeData.get(key);
  if (hit && nowMs() - hit.at < 10 * 60000) return hit;
  const results = await fetchAll(place.lat, place.lon, { fetchFn, now: nowMs() });
  let fc = null;
  try {
    fc = blendForecast(results, { nowMs: nowMs() });
  } catch {
    fc = null;
  }
  if (!fc) throw new Error(`yksikään säämalli ei vastannut. ${summarizeErrors(results)}`);
  const data = { at: nowMs(), fc, results };
  placeData.set(key, data);
  if (placeData.size > 8) placeData.delete(placeData.keys().next().value);
  return data;
}

async function runTool(name, args) {
  if (name !== 'get_forecast') throw new Error('Tuntematon työkalu');
  const q = String(args.place || '').trim();
  const found = await searchPlaces(q, { fetchFn, count: 3 });
  if (!found.length) throw new Error(`Paikkaa "${q}" ei löytynyt`);
  const p = found[0];
  const { fc, results } = await forecastFor(p);
  return { paikka: placeLabel(p), ...compactForecast(fc, nowMs(), { hours: 36, results }) };
}

/** Vastaa sovelluksen omalla laskennalla: ei tekoälyä eikä Gemini-kutsuja. */
async function internalAnswer(text) {
  const out = await answerQuestion(text, {
    place: state.place,
    fc: state.fc,
    results: state.results,
    nowMs: nowMs(),
    last: state.chatLast,
    sensitivity: state.sens,
    nowcast: currentNowcast(nowMs()),
    geocode: (q) => searchPlaces(q, { fetchFn, count: 5 }),
    forecastFor,
  });
  state.chatLast = out.last || null;
  return out;
}

/** Keskusteluhistoria Geminille: vuorottelevat roolit, alkaa käyttäjän viestillä, virheviestit pois. */
function chatHistory() {
  const out = [];
  for (const m of state.chat) {
    if (m.error) continue;
    const prev = out.at(-1);
    if (prev && prev.role === m.role) prev.text += `\n${m.text}`;
    else out.push({ role: m.role, text: m.text });
  }
  const tail = out.slice(-12);
  while (tail.length && tail[0].role !== 'user') tail.shift();
  return tail;
}

async function sendChat(text) {
  text = String(text || '').trim();
  if (!text || state.chatBusy) return;
  state.chat.push({ role: 'user', text });
  state.chatBusy = true;
  const ta = $('#msg');
  if (ta) {
    ta.value = '';
    ta.style.height = '';
  }
  renderChat();
  const mode = aiMode();
  let msg = null;
  let why = '';
  if (mode !== 'internal' && state.fc) {
    try {
      const out = await chat({ fc: state.fc, place: state.place, nowMs: nowMs(), history: chatHistory(), results: state.results, mode, runTool, fetchFn });
      msg = { role: 'assistant', text: out, src: mode === 'free' ? 'Gemini · sovelluksen data + yleistieto' : 'Gemini · data: sovelluksen säämallit' };
    } catch (e) {
      why = shortReason(e); // Gemini ei vastannut: vastataan sovelluksen omalla laskennalla ja kerrotaan syy
    }
  }
  if (!msg) {
    try {
      const out = await internalAnswer(text);
      const base = `Sovelluksen oma laskenta${out.used ? ` · ${out.used.models}/${out.used.total} mallia` : ''}`;
      msg = { role: 'assistant', text: out.text, src: why ? `Gemini ei vastannut (${why}) · ${base[0].toLowerCase()}${base.slice(1)}` : base };
    } catch (e) {
      msg = { role: 'assistant', text: `Vastaus epäonnistui: ${e?.message || 'tuntematon virhe'}`, error: true };
    }
  }
  state.chat.push(msg);
  state.chatBusy = false;
  renderChat();
}

// ---------- Vastausten lähde ----------

/** Päivittää kaikki näkyvät tilavalitsimet ja selitystekstin (chat-paneelissa ja asetuksissa) paikallaan. */
function refreshModeUi() {
  const eff = aiMode();
  const key = keyOn();
  document.querySelectorAll('.modebar .seg').forEach((b) => {
    const off = b.dataset.mode !== 'internal' && !key;
    b.setAttribute('aria-pressed', String(b.dataset.mode === eff));
    b.classList.toggle('off', off);
    if (off) b.setAttribute('aria-disabled', 'true');
    else b.removeAttribute('aria-disabled');
  });
  const note = $('#modeNote');
  if (note) note.textContent = modeNote({ mode: eff, hasKey: key });
}

function setMode(m) {
  aiSettings.setMode(m);
  refreshModeUi();
  state.ai = { status: 'idle', text: '', error: '', fp: '' };
  syncAi({ immediate: true });
  renderAi();
  if (!state.chat.length) renderChat(); // tyhjän keskustelun ohjeteksti riippuu tilasta
}

function pickMode(m) {
  if (m !== 'internal' && !keyOn()) {
    if (state.sheet !== 'settings') openSheet('settings');
    aiNote(DEMO ? 'Esimerkkitilassa Gemini ei ole käytössä.' : 'Lisää ensin Gemini-avain, niin voit käyttää Geminiä.', 'warn');
    return;
  }
  if (m === aiMode()) return;
  setMode(m);
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
  // Avain lähetetään HTTP-otsikossa: välilyönti, rivinvaihto tai muu kuin ASCII-merkki (esim. kopioitu viivasymboli) rikkoisi pyynnön tai viittaisi väärään tekstiin
  if (!/^[\x21-\x7e]+$/.test(v)) return aiNote('Avaimessa on merkkejä, joita Gemini-avaimessa ei ole (esimerkiksi välilyönti, rivinvaihto tai erikoismerkki). Liitä pelkkä avain.', 'warn');
  if (!aiSettings.setKey(v)) return aiNote('Avainta ei voitu tallentaa: selaimen tallennustila ei ole käytössä (esimerkiksi yksityinen selaus tai täysi tallennustila).', 'bad');
  if (aiSettings.mode() === 'internal') aiSettings.setMode('grounded'); // avaimen lisääjä haluaa yleensä Geminin käyttöön
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
  aiNote('Avain poistettu. Chat vastaa jatkossa sovelluksen omalla laskennalla.', 'ok');
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
  push(`Paikka: ${p ? `${p.name || '(nimi puuttuu)'}, ${p.region || '-'} (${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}) [${p.mode}]` : '-'}`);
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
    const fc = blendForecast(results, { nowMs: t });
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
  if (state.fc) {
    const t1 = performance.now();
    try {
      const out = await answerQuestion('Sataako huomenna?', { place: state.place, fc: state.fc, results: state.results, nowMs: t, last: null, geocode: async () => [], forecastFor });
      push(`Oma vastausmoottori: ${out.text ? '✓' : '✗ tyhjä vastaus'} ${Math.round(performance.now() - t1)} ms (chat-tila: ${aiMode() === 'internal' ? 'oma laskenta' : `Gemini, ${aiMode() === 'free' ? 'vapaa' : 'vain sovelluksen data'}`})`);
    } catch (e) {
      push(`Oma vastausmoottori: ✗ ${e.message}`);
    }
  }
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
  await probeSources(push, p, t);
  push('');
  push('Valmis.');
}

/** Kokeilee valinnaiset lähteet oikeasti (ohittaa tauon), jotta CORS-esto tai verkkovika näkyy tässä eikä käyttäjälle virheenä. */
async function probeSources(push, p, t) {
  push('');
  push('Valinnaiset lähteet (sovellus toimii ilman niitä):');
  const t0 = performance.now();
  const r = await runSource(sources, 'nowcast', () => fetchNowcast(p.lat, p.lon, { fetchFn }), { force: true, now: t });
  const ms = Math.round(performance.now() - t0);
  if (r.value) {
    state.nc = { raw: r.value, key: ncKey(p), at: t, ttl: NC_TTL };
    const s = summarizeNowcast(r.value, t);
    push(`  ✓ Tutkaennuste (MET Norway) ${ms} ms, ${r.value.steps.length} askelta${s.ok ? `: ${s.line}` : ''}`);
  } else if ('value' in r) push(`  – Tutkaennuste: ei kata tätä paikkaa (${r.reason})`);
  else if (r.error) push(`  ✗ Tutkaennuste: ${await explainFetchError(r.error, nowcastUrl(p.lat, p.lon))}`);
  else push(`  – Tutkaennuste: ohitettu (${r.skipped})`);
  if (!inFinland(p.lat, p.lon)) return push('  – Viralliset varoitukset: koskevat vain Suomea');
  const t1 = performance.now();
  const w = await runSource(sources, 'warnings', () => fetchWarnings({ fetchFn }), { force: true, now: t });
  const wms = Math.round(performance.now() - t1);
  if (w.value) {
    state.warn = { raw: w.value.alerts, at: t };
    push(`  ✓ Viralliset varoitukset (Ilmatieteen laitos, GitHub-peilin kautta) ${wms} ms, ${w.value.note}; ${officialRows(w.value.alerts, p.lat, p.lon, t).length} tällä paikalla`);
  } else if ('value' in w) push(`  – Viralliset varoitukset: ${w.reason}`);
  else if (w.error) push(`  ✗ Viralliset varoitukset: ${await explainFetchError(w.error, MIRROR_URL)}`);
  else push(`  – Viralliset varoitukset: ohitettu (${w.skipped})`);
}

/**
 * Selittää, miksi haku epäonnistui. Selain ei kerro CORS-estoa verkkovirheestä (molemmat ovat TypeError), joten asia selvitetään erikseen:
 * no-cors-haku onnistuu, jos palvelu vastaa mutta ei salli lukemista (CORS), ja selaimen tietoturvailmoitus kertoo, jos CSP esti haun.
 */
async function explainFetchError(err, url) {
  if (!(err instanceof TypeError)) return err?.message || String(err);
  let csp = '';
  const onViolation = (ev) => {
    csp = `${ev.violatedDirective || 'connect-src'}${ev.blockedURI ? ` esti ${ev.blockedURI}` : ''}`;
  };
  document.addEventListener('securitypolicyviolation', onViolation);
  try {
    await fetchFn(url, { mode: 'no-cors', cache: 'no-store' });
    return 'palvelu vastaa, mutta selain ei anna sovelluksen lukea vastausta (palvelu ei salli hakua selaimesta, CORS)';
  } catch {
    await new Promise((r) => setTimeout(r, 60)); // tietoturvailmoitus saapuu tapahtumana hieman haun hylkäämisen jälkeen
    return csp ? `selaimen tietoturvapolitiikka (CSP) esti haun (${csp})` : 'palveluun ei saatu yhteyttä (verkko, DNS tai palvelu ei vastaa)';
  } finally {
    document.removeEventListener('securitypolicyviolation', onViolation);
  }
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
  'open-about': () => openSheet('about'),
  'update-app': () => updateApp(),
  'mg-range': (t) => {
    const r = t.dataset.range;
    if (!Object.hasOwn(MG_RANGES, r) || r === state.mg.range) return;
    state.mg = { range: r, inspectIso: null };
    store.set('mgRange', r);
    renderMeteo();
  },
  'ask-open': (t) => {
    openSheet('chat');
    sendChat(t.dataset.q);
  },
  'welcome-locate': () => {
    state.first = false;
    locate();
  },
  'welcome-city': (t) => {
    const c = FI_CITIES.find((x) => x[0] === t.dataset.city);
    if (!c) return;
    state.first = false;
    setPlace({ name: c[0], region: c[3], country: 'Suomi', lat: c[1], lon: c[2], mode: 'manual' });
    rememberRecent(state.place);
  },
  'open-diag': () => {
    openSheet('settings');
    const adv = $('#advSet', el.panel);
    if (adv) adv.open = true;
    setTimeout(runDiagnostics, 80);
  },
  'open-adv': () => {
    openSheet('settings');
    const adv = $('#advSet', el.panel);
    if (adv) {
      adv.open = true;
      setTimeout(() => adv.scrollIntoView({ block: 'start' }), 80);
    }
  },
  page: (t) => goPage(+t.dataset.page || 0),
  hrow: (t) => {
    const iso = t.dataset.iso;
    state.hourOpen = state.hourOpen === iso ? null : iso;
    renderHours();
  },
  'hours-more': () => {
    state.hoursMore = !state.hoursMore;
    renderHours();
  },
  'hours-view': (t) => {
    const v = t.dataset.view === 'chart' ? 'chart' : 'list';
    if (v === state.hoursView) return;
    state.hoursView = v;
    store.set('hoursView', v);
    renderHours();
  },
  locate: () => locate(),
  refresh: () => load({ manual: true }),
  now: () => select({ type: 'now' }),
  hour: (t) => select(state.sel.type === 'hour' && state.sel.iso === t.dataset.iso ? { type: 'now' } : { type: 'hour', iso: t.dataset.iso }),
  day: (t) => {
    const date = t.dataset.date;
    state.dayOpen = state.dayOpen === date ? null : date;
    state.dayScrolled = '';
    renderWeek();
    if (state.dayOpen)
      requestAnimationFrame(() => {
        const box = $('.day-hours', el.daily);
        if (box) box.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
      });
  },
  vday: (t) => {
    const d = t.dataset.day === 'tomorrow' ? 'tomorrow' : 'today';
    if (d === state.vday) return;
    state.vday = d;
    state.sel = { type: 'now' };
    state.hourOpen = null;
    renderAll();
  },
  'ai-run': () => runAi({ force: true }),
  pick: (t) => pickPlace(state.found[+t.dataset.i]),
  'pick-recent': (t) => pickPlace(state.recent[+t.dataset.i]),
  ask: (t) => sendChat(t.dataset.q),
  mode: (t) => pickMode(t.dataset.mode),
  'mode-on': () => pickMode(aiSettings.mode() === 'internal' ? 'grounded' : aiSettings.mode()),
  'chat-clear': () => {
    state.chat = [];
    state.chatLast = null;
    renderChat();
  },
  'save-key': saveKey,
  'clear-key': clearKey,
  'list-models': findModels,
  'test-ai': testAi,
  diag: runDiagnostics,
  'diag-copy': copyDiag,
  wipe: wipeAll,
};

/** Vedä alas päivittääksesi: sivun yläreunasta vetäminen päivittää tiedot (ei lataa sivua uudelleen). Päivitys on rajattu 60 sekuntiin. */
const PTR_THRESHOLD = 72;
const PTR_COOLDOWN_MS = 60000;

function bindPullToRefresh() {
  const ind = $('#ptr');
  if (!ind) return;
  let y0 = null;
  let x0 = 0;
  let pulled = 0;
  const reset = () => {
    y0 = null;
    pulled = 0;
    ind.hidden = true;
    ind.style.transform = '';
    ind.dataset.ready = '0';
  };
  document.addEventListener(
    'touchstart',
    (ev) => {
      const t = ev.target;
      const inStrip = t.closest?.('.dstrip, #mgWrap, .sheet, textarea, input, select');
      const page = t.closest?.('.page');
      if (state.sheet || inStrip || !page || page.scrollTop > 0 || ev.touches.length !== 1) y0 = null;
      else (y0 = ev.touches[0].clientY), (x0 = ev.touches[0].clientX), (pulled = 0);
    },
    { passive: true },
  );
  document.addEventListener(
    'touchmove',
    (ev) => {
      if (y0 == null) return;
      // Sivujen vaakapyyhkäisy ei ole päivitysveto
      if (Math.abs(ev.touches[0].clientX - x0) > Math.abs(ev.touches[0].clientY - y0) + 6) {
        reset();
        return;
      }
      pulled = Math.max(0, ev.touches[0].clientY - y0);
      if (pulled < 12) return;
      ind.hidden = false;
      ind.dataset.ready = pulled >= PTR_THRESHOLD ? '1' : '0';
      ind.style.transform = `translate(-50%, ${Math.min(pulled, 110) - 52}px) rotate(${Math.min(pulled, 110) * 2}deg)`;
    },
    { passive: true },
  );
  const end = () => {
    if (y0 == null) return;
    const go = pulled >= PTR_THRESHOLD;
    reset();
    if (!go || state.loading) return;
    if (state.fc && nowMs() - state.fetchedAt < PTR_COOLDOWN_MS) {
      setBanner({ id: 'fresh', kind: 'info', text: `Tiedot ovat tuoreet, päivitetty ${agoText(nowMs() - state.fetchedAt)}.` });
      setTimeout(() => state.banner?.id === 'fresh' && setBanner(null), 3500);
    } else load({ manual: true });
  };
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', reset, { passive: true });
}

function bindEvents() {
  bindPullToRefresh();
  bindMeteo();
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
    if (ev.target.id === 'sens') {
      const v = Math.max(-3, Math.min(3, Number(ev.target.value) || 0));
      state.sens = v;
      store.set('sens', v);
      renderAll();
    }
    if (ev.target.id === 'anim') {
      const on = ev.target.value !== 'off';
      store.set('anim', on);
      sky?.setAnimated(on);
    }
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
      return;
    }
    if (ignorePop) {
      ignorePop = false;
      return;
    }
    if (state.page > 0) {
      pageEntry = false;
      goPage(0);
    }
  });
  if (el.pages) {
    cube = createCube(el.pages, {
      onSettle: onPageChange,
      onTurn: markDot,
      reduceMotion,
      // Näiden vaakaveto kuuluu niille itselleen: päivän tuntinauha ja sääkaavion tarkastelu.
      ignore: '.dstrip, #mgWrap, input, textarea, select',
    });
  }
  if (typeof ResizeObserver === 'function' && el.pgHome) new ResizeObserver(() => sizeStage()).observe(el.pgHome);
  window.addEventListener('resize', debounce(() => cube?.layout(), 120));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      tick();
      checkForUpdate();
      sky?.poke();
    }
  });
  window.addEventListener('online', () => {
    load();
    checkForUpdate();
  });
  // Animaatio pysähtyy, kun ruutuun ei kosketa (akku): kosketus, vieritys tai näppäin herättää sen.
  for (const type of ['pointerdown', 'touchstart', 'keydown']) document.addEventListener(type, () => sky?.poke(), { passive: true, capture: true });
  document.addEventListener('scroll', () => sky?.poke(), { passive: true, capture: true });
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
  if (!DEMO && store.num('schema', 0) < SCHEMA) store.set('schema', SCHEMA); // tulevat tallennuksen muutokset siirretään tämän numeron perusteella
  const saved = DEMO ? null : store.object('place');
  const usable = saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lon) ? saved : null;
  const first = !usable && !DEMO;
  state.place = DEMO ? { ...DEMO_PLACE } : usable || { ...DEFAULT_PLACE };
  skyIdle();
  if (restoreCache()) updateSky(true);
  renderAll();
  if (DEMO) setBanner({ kind: 'info', text: `Esimerkkitila: sää ja paikannimet ovat tekaistuja${scenario !== 'mixed' ? ` (${scenario})` : ''}.` });

  // Ensimmäisellä käynnistyksellä ei kysytä sijaintilupaa kylmiltään: näytetään kortti, ja selain kysyy vasta napin painalluksesta.
  // Jos lupa on jo annettu, paikannetaan heti ilman ylimääräistä oletuspaikan hakua (yksi haku kahden sijaan).
  if (first) {
    const perm = await geoPermission();
    if (perm === 'granted') locate({ quiet: false });
    else {
      state.first = true;
      state.place = { ...DEFAULT_PLACE, note: 'oletuspaikka' };
      renderAll();
      if (perm === 'denied') setBanner({ kind: 'warn', text: 'Sijaintilupa on estetty. Valitse paikkakunta tai salli sijainti selaimen sivuasetuksista.' });
      load();
    }
  } else {
    load();
    if (state.fc) syncAi({ immediate: true });
    // Tallennettu GPS-paikka: tarkistetaan hiljaa, onko käyttäjä siirtynyt (yli 3 km), kun lupa on jo annettu.
    if (!DEMO && usable?.mode === 'gps' && (await geoPermission()) === 'granted') locate({ quiet: true });
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
  setTimeout(checkForUpdate, 4000, { force: true });
}

globalThis.__saaaly = { state, VERSION, BUILD, load, select, checkForUpdate, explainFetchError, goPage, get cube() { return cube; } };
boot();
})();
})();

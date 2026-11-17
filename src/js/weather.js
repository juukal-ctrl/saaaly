// weather.js: säädatan haku Open-Meteosta. Jokainen malli haetaan omana kutsunaan, mutta enintään
// muutama kerrallaan (rajapinta hylkää liian monta samanaikaista kutsua). fetchModel ei koskaan heitä
// virhettä, joten yksi huono malli ei kaada koko hakua.

import { MODELS } from './models.js';
import { defaultFetch, store } from './util.js';

export const API_BASE = 'https://api.open-meteo.com/v1/forecast';

// Vain vakiomuuttujia, joita rajapinta tukee. Puuttuva muuttuja palautuu null-arvoina.
// Tuntuu kuin -lämpötila lasketaan itse (Ilmatieteen laitoksen kaava) lämpötilasta, kosteudesta, tuulesta ja säteilystä,
// joten apparent_temperature ja is_day eivät ole mukana.
export const HOURLY = [
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
export const BACKWARD = ['precipitation', 'snowfall', 'wind_gusts_10m', 'shortwave_radiation', 'uv_index', 'precipitation_probability', 'weather_code'];

export class ApiError extends Error {
  constructor(message, { status = 0, kind = 'http' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind;
  }
}

export function buildUrl(lat, lon, id, { days = 7 } = {}) {
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

export function parseModelResponse(json, id) {
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
export async function fetchModel(model, lat, lon, { fetchFn = defaultFetch, noCache = false, days = 7, now = Date.now(), timeoutMs = 15000, sleepFn = defaultSleep, retries = 2, signal = null } = {}) {
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
export async function fetchAll(lat, lon, { models = MODELS, fetchFn = defaultFetch, noCache = false, days = 7, now = Date.now(), timeoutMs = 10000, concurrency = 3, sleepFn, deadlineMs = 10000, signal = null } = {}) {
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

export function summarizeErrors(results) {
  const bad = results.filter((r) => !r.ok && !r.skipped && !r.coverage);
  if (!bad.length) return 'Ei virheitä';
  const first = bad[0];
  const same = bad.every((r) => r.error === first.error);
  return same ? first.error : bad.map((r) => `${r.model.short}: ${r.error}`).join('; ');
}

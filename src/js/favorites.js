// favorites.js: tallennetut suosikkipaikat ja niiden kevyt "nyt"-sää paikkalistaan.
// Puhtaita funktioita (testattavissa ilman selainta); app.js tallentaa listan store-apurilla ja piirtää sen.
// Suosikki on { name, region, country, lat, lon, home? }. Koti (home) on aina listan ensimmäinen, ja niitä on enintään yksi.

import { haversineKm } from './geo.js';
import { timedRequest } from './sources.js';
import { defaultFetch } from './util.js';

export const FAV_MAX = 8;
export const FAV_SAME_KM = 1; // alle kilometrin päässä oleva paikka on sama paikka (sama tarkkuus kuin säähaussa)
export const FAV_WX_TTL = 15 * 60000; // suosikkien nykysää haetaan enintään neljännestunnin välein
const NAME_MAX = 80;

const str = (v, max = NAME_MAX) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Siistii yhden tallennetun paikan. Väärän muotoinen (käsin muokattu, rikkoutunut) palauttaa null. */
export function normalizeFav(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const lat = Number(p.lat);
  const lon = Number(p.lon);
  const name = str(p.name);
  if (!name || typeof p.lat === 'boolean' || typeof p.lon === 'boolean' || p.lat == null || p.lon == null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const out = { name, region: str(p.region), country: str(p.country), lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 };
  if (p.home === true) out.home = true;
  return out;
}

/** Sama paikka: alle kilometrin päässä toisistaan (nimi voi olla eri, esim. GPS:n kaupunginosa ja haun kaupunki). */
export function samePlace(a, b) {
  if (!a || !b || !Number.isFinite(+a.lat) || !Number.isFinite(+b.lat)) return false;
  return haversineKm(+a.lat, +a.lon, +b.lat, +b.lon) < FAV_SAME_KM;
}

/** Järjestää: koti ensin (vain yksi), muuten tallennusjärjestys. Poistaa kaksoiskappaleet ja rajaa määrän. */
function tidy(list) {
  const out = [];
  for (const p of list) {
    if (!p || out.some((q) => samePlace(q, p))) continue;
    out.push(p);
  }
  const hi = out.findIndex((p) => p.home);
  const sorted = hi > 0 ? [out[hi], ...out.slice(0, hi), ...out.slice(hi + 1)] : out;
  return sorted.slice(0, FAV_MAX).map((p, i) => {
    const { home, ...rest } = p;
    return i === 0 && home ? { ...rest, home: true } : rest;
  });
}

/** Lukee suosikit tallennetusta arvosta (mikä tahansa JSON). Rikkinäinen data ei kaada: kelvottomat rivit jätetään pois. */
export function parseFavs(raw) {
  if (!Array.isArray(raw)) return [];
  return tidy(raw.slice(0, 50).map(normalizeFav));
}

export const findFav = (list, p) => (p ? list.findIndex((q) => samePlace(q, p)) : -1);
export const isFav = (list, p) => findFav(list, p) >= 0;

/**
 * Lisää suosikin. Palauttaa { list, ok, reason }: reason 'dup' (jo listalla), 'full' (enintään FAV_MAX) tai 'bad' (kelvoton paikka).
 * Ensimmäisestä suosikista tulee koti, ellei kotia ole.
 */
export function addFav(list, p, { home = false } = {}) {
  const f = normalizeFav({ ...p, home: false });
  if (!f) return { list, ok: false, reason: 'bad' };
  if (isFav(list, f)) return { list, ok: false, reason: 'dup' };
  if (list.length >= FAV_MAX) return { list, ok: false, reason: 'full' };
  const next = home || !list.length ? [{ ...f, home: true }, ...list.map(({ home: _h, ...r }) => r)] : [...list, f];
  return { list: tidy(next), ok: true, reason: '' };
}

/** Poistaa suosikin (sama paikka ~1 km:n sisällä). Jos koti poistuu, seuraavasta ei tule kotia automaattisesti. */
export function removeFav(list, p) {
  const i = findFav(list, p);
  if (i < 0) return list;
  return list.filter((_, k) => k !== i);
}

/** Lisää tai poistaa; palauttaa { list, ok, reason, on } (on = onko paikka nyt suosikki). */
export function toggleFav(list, p) {
  if (isFav(list, p)) return { list: removeFav(list, p), ok: true, reason: '', on: false };
  const r = addFav(list, p);
  return { ...r, on: r.ok };
}

/** Tekee suosikista kodin (siirtyy ensimmäiseksi). Jo kotina oleva: koti poistuu (paikka jää suosikiksi). */
export function toggleHome(list, p) {
  const i = findFav(list, p);
  if (i < 0) return list;
  if (list[i].home) return list.map(({ home: _h, ...r }) => r);
  return tidy([{ ...list[i], home: true }, ...list.filter((_, k) => k !== i).map(({ home: _h, ...r }) => r)]);
}

// ---------- Nykysää ----------

/** WMO-säätunnus (Open-Meteo weather_code) sovelluksen symboliksi (icons.js, blend.js SYMBOLS). */
export function codeToSym(code) {
  const c = Number(code);
  if (!Number.isFinite(c)) return 'overcast';
  if (c === 0) return 'clear';
  if (c === 1) return 'mostly_clear';
  if (c === 2) return 'partly_cloudy';
  if (c === 3) return 'overcast';
  if (c === 45 || c === 48) return 'fog';
  if (c >= 51 && c <= 55) return 'drizzle';
  if (c === 56 || c === 57 || c === 66 || c === 67) return 'sleet';
  if (c === 61 || c === 80) return 'rain_light';
  if (c === 63 || c === 81) return 'rain';
  if (c === 65 || c === 82) return 'rain_heavy';
  if (c === 71 || c === 77 || c === 85) return 'snow_light';
  if (c === 73) return 'snow';
  if (c === 75 || c === 86) return 'snow_heavy';
  if (c >= 95 && c <= 99) return 'thunder';
  return 'overcast';
}

const coord = (v) => Number(v).toFixed(2); // noin 1 km, kuten muissa hauissa

/** Yksi kevyt haku usealle paikalle: Open-Meteo hyväksyy pilkuin erotellut koordinaatit. */
export function currentUrl(places) {
  const q = new URLSearchParams({
    latitude: places.map((p) => coord(p.lat)).join(','),
    longitude: places.map((p) => coord(p.lon)).join(','),
    current: 'temperature_2m,weather_code,is_day',
    timezone: 'auto',
  });
  return `https://api.open-meteo.com/v1/forecast?${q.toString()}`;
}

/** Jäsentää vastauksen (yksi paikka = olio, monta = taulukko). Palauttaa n alkiota: { temp, sym, isDay } tai null. */
export function parseCurrent(json, n) {
  const arr = Array.isArray(json) ? json : json && typeof json === 'object' ? [json] : [];
  return Array.from({ length: n }, (_, i) => {
    const c = arr[i]?.current;
    const t = Number(c?.temperature_2m);
    if (!c || c.temperature_2m == null || !Number.isFinite(t) || t < -90 || t > 60) return null;
    return { temp: t, sym: codeToSym(c.weather_code), isDay: c.is_day == null ? true : Number(c.is_day) === 1 };
  });
}

/** Hakee nykysään annetuille paikoille yhdellä pyynnöllä. Heittää virheen; peruttu haku heittää AbortErrorin. */
export async function fetchCurrent(places, { fetchFn = defaultFetch, signal = null, timeoutMs = 8000 } = {}) {
  if (!places.length) return [];
  const json = await timedRequest(fetchFn, currentUrl(places), {}, { timeoutMs, signal, label: 'Suosikkien sää' }, async (res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
  return parseCurrent(json, places.length);
}

/** Välimuistin avain paikalle (sama pyöristys kuin haussa). */
export const wxKey = (p) => `${coord(p.lat)},${coord(p.lon)}`;

/** Lukee tallennetun nykysäävälimuistin; rikkinäiset rivit pois. */
export function parseWxCache(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw).slice(0, 40)) {
    if (!/^-?\d+\.\d\d,-?\d+\.\d\d$/.test(k) || !v || typeof v !== 'object') continue;
    if (!Number.isFinite(v.temp) || !Number.isFinite(v.at) || typeof v.sym !== 'string') continue;
    out[k] = { temp: v.temp, sym: v.sym, isDay: v.isDay !== false, at: v.at };
  }
  return out;
}

/** Paikat, joiden nykysää puuttuu tai on vanhempi kuin FAV_WX_TTL. */
export function staleFavs(list, cache, now) {
  return list.filter((p) => {
    const c = cache[wxKey(p)];
    return !c || now - c.at >= FAV_WX_TTL || c.at > now + 60000;
  });
}

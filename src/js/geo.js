// geo.js: paikkahaku, paikannimen selvitys koordinaateista ja sijainnin pyytäminen.
// Paikannimi tulee oikeasta käänteisestä geokoodauksesta, ei tekoälyn arvauksesta.
// Ketju: BigDataCloud -> OpenStreetMap Nominatim -> lähin suomalainen kaupunki (offline) -> koordinaatit.

import { defaultFetch, fmtCoord } from './util.js';

/** Maakuntien nimet: englanti/ruotsi -> suomi. Avaimet pienillä kirjaimilla. */
export const FI_REGIONS = {
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

export function localizeRegion(name) {
  if (!name) return '';
  return FI_REGIONS[name.trim().toLowerCase()] || name.trim();
}

/** Suuria suomalaisia kaupunkeja: [nimi, lat, lon, maakunta]. Käytetään vain nimen varapolkuna. */
export const FI_CITIES = [
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

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function nearestCity(lat, lon) {
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
export async function searchPlaces(query, { fetchFn = defaultFetch, count = 8 } = {}) {
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
export async function reverseGeocode(lat, lon, { fetchFn = defaultFetch } = {}) {
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

export function placeKey(p) {
  return `${Number(p.lat).toFixed(2)},${Number(p.lon).toFixed(2)}`;
}

export function placeSubtitle(p) {
  return [p.region, p.country].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(', ');
}

/** Selaimen paikannus lupausmuodossa, suomenkielisillä virheillä. */
export function getPosition({ timeoutMs = 12000, maximumAge = 300000 } = {}) {
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

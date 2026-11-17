// gazetteer.js: tunnettujen paikkakuntien nimet ilman verkkoa. Chat tunnistaa näillä taivutetut nimet
// ("Rovaniemellä", "Tukholmassa") ja saa koordinaatit heti, ilman paikkahakua.
// Muut paikat haetaan Open-Meteon paikkahaulla (answer.js). Koordinaatit ovat keskustojen likiarvoja.

import { FI_CITIES } from './geo.js';

/** [nimi, lat, lon, alue, maa] */
export const FOREIGN_CITIES = [
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
export const FI_EXTRA = [
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
export const ALIASES = {
  hesa: 'Helsinki', stadi: 'Helsinki', stad: 'Helsinki', hki: 'Helsinki', helsingfors: 'Helsinki',
  tampesteri: 'Tampere', tre: 'Tampere', tammerfors: 'Tampere',
  tku: 'Turku', abo: 'Turku',
  rova: 'Rovaniemi', roi: 'Rovaniemi',
  jkl: 'Jyväskylä', jyska: 'Jyväskylä', jyskä: 'Jyväskylä',
  lappee: 'Lappeenranta', villmanstrand: 'Lappeenranta',
  hamis: 'Hämeenlinna',
  kouvo: 'Kouvola',
  uleaborg: 'Oulu', vasa: 'Vaasa', borga: 'Porvoo', hango: 'Hanko', mariehamn: 'Maarianhamina', ahvenanmaa: 'Maarianhamina', aland: 'Maarianhamina',
  nyslott: 'Savonlinna', bjorneborg: 'Pori',
};

/** Taivutuspäätteet, pisimmät ensin. Pääte poistetaan, ja jäljelle jäävää vartaloa verrataan paikan nimeen. */
export const CASE_SUFFIXES = [
  'issa', 'issä', 'ista', 'istä', 'illa', 'illä', 'ille', 'ilta', 'iltä',
  'ssa', 'ssä', 'sta', 'stä', 'lla', 'llä', 'lta', 'ltä', 'lle', 'ksi', 'iin', 'hin', 'seen', 'een',
  'na', 'nä', 'ta', 'tä', 'an', 'än', 'en', 'in', 'on', 'un', 'yn', 'ön', 'n', 'a', 'ä',
];

/** Puhekielen paikkapäätteet ("Turus", "Oulust", "Tampereel", "Rovaniemelt"). Vain isolla alkukirjaimella kirjoitetuille sanoille. */
export const COLLOQ_SUFFIXES = ['st', 'lt', 's', 'l'];

export const lower = (s) => String(s).toLocaleLowerCase('fi-FI');
/** Pienaakkoset ilman ääkkösiä: vertailu kestää puuttuvat diakriitit ("jyvaskylassa"). */
export const fold = (s) => lower(s).replace(/[äå]/g, 'a').replace(/ö/g, 'o');

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
export function editDistance(a, b) {
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
export function findOffline(word) {
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
      const sufs = capital ? [...CASE_SUFFIXES.map(fold), ...COLLOQ_SUFFIXES] : CASE_SUFFIXES.map(fold);
      for (const suf of sufs) {
        if (w.length - suf.length < 3 || !w.endsWith(suf)) continue;
        const stem = w.slice(0, -suf.length);
        const cp = commonPrefix(stem, c.key);
        if (cp < Math.max(3, c.key.length - 2)) continue;
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

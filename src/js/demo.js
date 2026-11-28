// demo.js: synteettinen säädata testeihin ja esikatseluun (?demo=1, ?demo=rain|snow|clear|thunder|fog), myös ilmanlaatu ja siitepöly.
// Tuottaa Open-Meteon vastausmuotoa, joten koko sovelluksen koodipolku (haku, jäsennys, yhdistely) on sama kuin oikealla datalla.

import { FI_CITIES, haversineKm } from './geo.js';
import { sunPosition } from './sun.js';
import { localNow, zonedToUtcMs, clamp } from './util.js';
import { parseCapFeed, buildMirror } from './warnings.js';

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

/**
 * Esimerkkitilan sää kartalla: itään liikkuva sadevyöhyke ja kuuroja (mm/h), pilvisyys (%) ja lumen osuus.
 * Sama kenttä antaa tutkan (menneet kehykset) ja ennusteen (tulevat tunnit), joten kartta liikkuu johdonmukaisesti.
 */
export function syntheticMapWx(lon, lat, tMs, scenario = 'mixed', anchorMs = 0) {
  const S = { clear: [0, 0.12], rain: [1.5, 0.96], snow: [1.1, 0.96], thunder: [2.6, 0.8], fog: [0.1, 0.98], mixed: [1, 0.7] }[scenario] || [1, 0.7];
  // Vyöhyke kulkee esimerkkipaikan (Turku) yli hetkellä anchorMs (+ viive): sateisissa esimerkeissä nyt, sekasäässä illalla.
  const x = (lon - 22.27) * 55.7;
  const y = (lat - 60.45) * 111.2;
  const h = (tMs - anchorMs) / 3.6e6 - (scenario === 'mixed' ? 10 : 0);
  const X = x - 34 * h;
  const Y = y - 9 * h;
  const u = X * 0.55 + Y * 0.83;
  const across = ((((u + 550) % 1100) + 1100) % 1100) - 550;
  const front = Math.exp(-(across * across) / (2 * 80 * 80));
  const cells = Math.max(0, Math.sin(X / 23 + 0.4) * Math.sin(Y / 31 + 1.1) * Math.sin((X - Y) / 47 + 0.3));
  let precip = S[0] * (front * (0.5 + 1.1 * cells) + (scenario === 'thunder' ? 1.4 * cells * cells : 0));
  if (precip < 0.06) precip = 0;
  const swirl = 0.5 + 0.5 * Math.sin(X / 160 + 0.8) * Math.cos(Y / 210 - 0.4);
  const cloud = 100 * clamp(S[1] * (0.3 + 0.7 * Math.max(front * 1.3, swirl)), 0, 1);
  return { precip, cloud, snow: scenario === 'snow' ? 1 : 0 };
}

/** Monen pisteen ennuste (Open-Meteon muoto, timeformat=unixtime) esimerkkitilan karttaan. */
export function syntheticGrid({ lats, lons, nowMs = Date.now(), hours = 25, scenario = 'mixed' }) {
  const t0 = Math.floor(nowMs / 3600000) * 3600000;
  const time = Array.from({ length: hours }, (_, i) => (t0 + i * 3600000) / 1000);
  return lats.map((la, k) => {
    const lo = lons[k];
    const cloud_cover = [];
    const precipitation = [];
    const snowfall = [];
    for (const t of time) {
      const w = syntheticMapWx(lo, la, t * 1000, scenario, nowMs);
      cloud_cover.push(Math.round(w.cloud));
      precipitation.push(Math.round(w.precip * 10) / 10);
      snowfall.push(w.snow ? Math.round(w.precip * 7) / 10 : 0);
    }
    return { latitude: la, longitude: lo, hourly: { time, cloud_cover, precipitation, snowfall } };
  });
}

/** Suosikkien nykysää (Open-Meteon current-muoto, monta pistettä = taulukko) samasta esimerkkisäästä kuin ennuste. */
export function syntheticCurrent({ lats, lons, nowMs = Date.now(), scenario = 'mixed' }) {
  const out = lats.map((la, k) => {
    const lo = lons[k];
    const r = syntheticResponse({ lat: la, lon: lo, modelId: 'ecmwf_ifs', nowMs, days: 2, scenario });
    const iso = localNow(nowMs, 'Europe/Helsinki').iso.slice(0, 13) + ':00';
    const i = Math.max(0, r.hourly.time.indexOf(iso));
    const isDay = sunPosition(nowMs, la, lo).altitudeDeg > 0 ? 1 : 0;
    return { latitude: la, longitude: lo, current: { time: iso, temperature_2m: r.hourly.temperature_2m[i], weather_code: r.hourly.weather_code[Math.min(i + 1, r.hourly.weather_code.length - 1)], is_day: isDay } };
  });
  return out.length === 1 ? out[0] : out;
}

/** RainViewerin weather-maps.json esimerkkinä: 13 kehystä 10 minuutin välein. */
export function syntheticRadarMaps(nowMs = Date.now()) {
  const last = Math.floor(nowMs / 600000) * 600 - 600;
  const past = Array.from({ length: 13 }, (_, i) => {
    const time = last - (12 - i) * 600;
    return { time, path: `/v2/radar/demo${time}` };
  });
  return { version: '2.0', generated: last + 60, host: 'https://tilecache.rainviewer.com', radar: { past } };
}

/** Rakentaa Open-Meteon muotoisen vastauksen yhdelle mallille. */
export function syntheticResponse({ lat, lon, modelId, nowMs = Date.now(), days = 7, tz = 'Europe/Helsinki', scenario = 'mixed' }) {
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
export function syntheticNowcast({ lat, lon, nowMs = Date.now(), tz = 'Europe/Helsinki', scenario = 'mixed' }) {
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

// Siitepölykaudet esimerkkitilassa (Lounais-Suomi): huippupäivä vuoden alusta, leveys (vrk) ja huippupitoisuus (kpl/m³).
const POLLEN_SEASON = { alder_pollen: [95, 10, 160], birch_pollen: [132, 8, 650], grass_pollen: [178, 14, 55], mugwort_pollen: [214, 8, 24], ragweed_pollen: [236, 9, 2] };
const AQ_BANDS = { pm2_5: [10, 20, 25, 50, 75], pm10: [20, 40, 50, 100, 150], nitrogen_dioxide: [40, 90, 120, 230, 340], ozone: [50, 100, 130, 240, 380] };

/** Saasteen osaindeksi 0–100+ (20 yksikköä luokkaa kohden), josta eurooppalainen indeksi on suurin. */
function subIndex(v, th) {
  const edges = [0, ...th];
  for (let k = 1; k < edges.length; k++) if (v < edges[k]) return (k - 1) * 20 + ((v - edges[k - 1]) / (edges[k] - edges[k - 1])) * 20;
  return 100 + (v - th.at(-1)) / 5;
}

/**
 * Open-Meteo Air Quality -muotoinen synteettinen vastaus (timeformat=unixtime, 4 vrk). Siitepöly noudattaa kasvukautta (talvella null kuten oikeassa
 * rajapinnassa), päivärytmiä ja sadetta; sumuskenaariossa inversio heikentää ilmanlaatua aamulla. UV samasta auringon korkeudesta kuin säämalleissa.
 */
export function syntheticAir({ lat, lon, nowMs = Date.now(), tz = 'Europe/Helsinki', scenario = 'mixed', days = 4 }) {
  const t0 = Date.UTC(...new Date(nowMs).toISOString().slice(0, 10).split('-').map((x, k) => (k === 1 ? +x - 1 : +x)));
  const sc = SCENARIOS[scenario];
  const time = [];
  const hourly = { time };
  for (const k of ['european_aqi', 'pm2_5', 'pm10', 'nitrogen_dioxide', 'ozone', 'uv_index', ...Object.keys(POLLEN_SEASON)]) hourly[k] = [];
  const noise = rng(hashStr(`air${scenario}`));
  for (let i = 0; i < days * 24; i++) {
    const ms = t0 + i * 3600000;
    time.push(ms / 1000);
    const ln = localNow(ms, tz);
    const doy = Math.round((Date.parse(ln.date + 'T00:00:00Z') - Date.UTC(+ln.date.slice(0, 4), 0, 1)) / 86400000) + 1;
    const hr = ln.hour + ln.minute / 60;
    const rush = Math.exp(-(((hr - 8) / 1.6) ** 2)) + 0.8 * Math.exp(-(((hr - 16.5) / 1.8) ** 2));
    const sunAlt = sunPosition(ms, lat, lon).altitudeDeg;
    const wet = sc ? sc.precip > 0 : Math.exp(-(((i - 31) / 4.5) ** 2)) > 0.3;
    const cloud = sc ? sc.cloud : 50;
    const inv = scenario === 'fog' ? 3.2 : scenario === 'snow' ? 1.4 : 1;
    const pm25 = (3 + 5 * rush) * inv * (wet ? 0.6 : 1) + noise() * 1.5;
    const pm10 = pm25 * 1.7 + noise() * 2;
    const no2 = (6 + 26 * rush) * inv + noise() * 3;
    const o3 = Math.max(10, 38 + 30 * Math.max(0, Math.sin((sunAlt * Math.PI) / 180)) * (1 - cloud / 160) - no2 * 0.3 + noise() * 4);
    const aqi = Math.max(subIndex(pm25, AQ_BANDS.pm2_5), subIndex(pm10, AQ_BANDS.pm10), subIndex(no2, AQ_BANDS.nitrogen_dioxide), subIndex(o3, AQ_BANDS.ozone));
    hourly.pm2_5.push(+pm25.toFixed(1));
    hourly.pm10.push(+pm10.toFixed(1));
    hourly.nitrogen_dioxide.push(+no2.toFixed(1));
    hourly.ozone.push(+o3.toFixed(1));
    hourly.european_aqi.push(Math.round(aqi));
    hourly.uv_index.push(+Math.max(0, 5.5 * Math.sin((Math.max(0, sunAlt) * Math.PI) / 180) * (1 - 0.7 * (cloud / 100))).toFixed(2));
    // Kasvukauden ulkopuolella (loka–helmikuu) CAMS ei anna siitepölyä: null, ei nolla
    const season = doy >= 60 && doy <= 273;
    const diurnal = 0.35 + 0.65 * Math.exp(-(((hr - 14) / 4) ** 2));
    const washout = sc ? (sc.snow ? 0 : sc.precip > 0 ? 0.15 : 1) : wet ? 0.25 : 1;
    for (const [k, [peak, width, max]] of Object.entries(POLLEN_SEASON)) {
      if (!season) {
        hourly[k].push(null);
        continue;
      }
      const v = max * Math.exp(-(((doy - peak) / width) ** 2)) * diurnal * washout * (0.85 + 0.3 * noise());
      hourly[k].push(v < 0.05 ? 0 : +v.toFixed(1));
    }
  }
  return { latitude: +lat.toFixed(2), longitude: +lon.toFixed(2), generationtime_ms: 0.4, utc_offset_seconds: 0, timezone: 'GMT', hourly_units: { european_aqi: 'EAQI', birch_pollen: 'grains/m³' }, hourly };
}

const DEMO_WARNINGS = {
  thunder: ['Ukkosvaroitus', 'Severe', 'orange', 'Voimakkaita ukkoskuuroja, paikoin rakeita. Kuurojen mukana voi tulla puuskia yli 20 m/s.'],
  snow: ['Liukkausvaroitus', 'Moderate', 'yellow', 'Tiet ja kevyen liikenteen väylät voivat olla erittäin liukkaita.'],
};

/** CAP-muotoinen synteettinen varoitussyöte (Atom) Varsinais-Suomen alueelle; demo muuttaa sen peiliksi kuten oikea peilityökalu. Vain ukkos- ja lumiskenaariossa on varoitus; muuten syöte on tyhjä. */
export function syntheticWarningsFeed({ nowMs = Date.now(), scenario = 'mixed' } = {}) {
  const d = DEMO_WARNINGS[scenario];
  const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
  const poly = '59.9,21.0 61.0,21.0 61.0,23.5 59.9,23.5 59.9,21.0';
  const entry = d
    ? `<entry><id>demo-1</id><title>${d[0]}</title><content type="text/xml"><alert xmlns="urn:oasis:names:tc:emergency:cap:1.2"><identifier>demo-1</identifier><sender>esimerkki</sender><sent>${iso(nowMs - 3600000)}</sent><status>Actual</status><msgType>Alert</msgType><scope>Public</scope><info><language>fi-FI</language><category>Met</category><event>${d[0]}</event><urgency>Immediate</urgency><severity>${d[1]}</severity><certainty>Likely</certainty><onset>${iso(nowMs - 3600000)}</onset><expires>${iso(nowMs + 5 * 3600000)}</expires><headline>${d[0]} Varsinais-Suomi (esimerkki)</headline><description>${d[3]}</description><instruction>Esimerkkitila: tämä varoitus on tekaistu.</instruction><parameter><valueName>color</valueName><value>${d[2]}</value></parameter><area><areaDesc>Varsinais-Suomi</areaDesc><polygon>${poly}</polygon></area></info></alert></content></entry>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Esimerkkivaroitukset</title>${entry}</feed>`;
}

/** WFS-muotoinen synteettinen havainto (timevaluepair): lämpötila on yhdistelmäennusteen tuntumassa, puoli astetta sivussa. */
export function syntheticObs({ lat, lon, nowMs = Date.now(), scenario = 'mixed' }) {
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
export function makeDemoFetch({ scenario = 'mixed', nowMs, log } = {}) {
  return async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    log?.(url.href);
    if (url.hostname === 'api.open-meteo.com' && url.searchParams.get('current')) {
      const lats = (url.searchParams.get('latitude') || '').split(',').map(Number);
      const lons = (url.searchParams.get('longitude') || '').split(',').map(Number);
      return json(syntheticCurrent({ lats, lons, nowMs: nowMs ?? Date.now(), scenario }));
    }
    if (url.hostname === 'api.open-meteo.com' && (url.searchParams.get('latitude') || '').includes(',')) {
      const lats = url.searchParams.get('latitude').split(',').map(Number);
      const lons = url.searchParams.get('longitude').split(',').map(Number);
      return json(syntheticGrid({ lats, lons, nowMs: nowMs ?? Date.now(), hours: +url.searchParams.get('forecast_hours') || 25, scenario }));
    }
    if (url.hostname === 'api.rainviewer.com') return json(syntheticRadarMaps(nowMs ?? Date.now()));
    if (url.hostname === 'air-quality-api.open-meteo.com') return json(syntheticAir({ lat: +url.searchParams.get('latitude'), lon: +url.searchParams.get('longitude'), nowMs: nowMs ?? Date.now(), scenario, days: +url.searchParams.get('forecast_days') || 4 }));
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

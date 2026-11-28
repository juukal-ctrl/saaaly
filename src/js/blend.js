// blend.js: usean mallin yhdistäminen yhdeksi ennusteeksi. Kaikki laskenta on deterministista koodia.
// Tekoäly ei koske lukuihin, se vain selittää valmiin tuloksen.

import { clamp, lerp, localNow, zonedToUtcMs, fmtTemp, fmtNum, fmtMm, windFrom, weekday, fmtDM, cap } from './util.js';
import { sunPosition } from './sun.js';
import { weightAt } from './models.js';
import { fmiFeelsLike, wetBulb } from './phys.js';

const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);
const FRZ_CODES = new Set([56, 57, 66, 67]); // jäätävä tihku ja jäätävä vesisade: ei räntää, vaan jäätävää vettä
const THUNDER_CODES = new Set([95, 96, 99]);
const FOG_CODES = new Set([45, 48]);

export const SYMBOLS = {
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

export function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function wMedian(items) {
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

export function wMean(items) {
  let sw = 0;
  let sv = 0;
  for (const x of items) {
    sw += x.w;
    sv += x.w * x.v;
  }
  return sw ? sv / sw : null;
}

/** Painotettu kvantiili (q 0..1). */
export function wQuantile(items, q) {
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
export function combine(items, absFloor) {
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
export function phaseShare(T, RH) {
  const tw = wetBulb(T, RH ?? 85);
  return clamp((1.5 - tw) / 2, 0, 1);
}

/** Todennäköisyys, että aikavälillä (fc.hours-indeksit from..to) sataa vähintään thr mm: mallien painotettu osuus. pm = fc.pm. */
export function windowPopPm(pm, from, to, thr = 0.3, lead0 = 0) {
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

export function cloudSymbol(cloud) {
  if (cloud < 10) return 'clear';
  if (cloud < 30) return 'mostly_clear';
  if (cloud < 60) return 'partly_cloudy';
  if (cloud < 85) return 'mostly_cloudy';
  return 'overcast';
}

export function pickSymbol({ precip, cloud, snowShare = 0, thunderShare = 0, fogShare = 0, rawPrecip = 0 }) {
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
export function blendForecast(results, { nowMs } = {}) {
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
    const pwin = windowPopPm(pm, from, to, 0.3, lead0); // mallien painot ennusteen iän mukaan kuten wetSpans-funktiossa
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

export function nowPosition(fc, nowMs) {
  const ln = localNow(nowMs, fc.tz);
  const hourIso = ln.iso.slice(0, 13) + ':00';
  let idx = fc.hours.findIndex((h) => h.t === hourIso);
  let frac = ln.minute / 60;
  if (idx < 0) {
    // Tunti puuttuu (ennusteen ulkopuolella tai aukko keskellä, kun mikään malli ei antanut lämpötilaa): viimeisin edeltävä tunti
    idx = 0;
    for (let i = 0; i < fc.hours.length && fc.hours[i].t <= hourIso; i++) idx = i;
    frac = 0;
  }
  return { idx, frac, local: ln };
}

export function snapshot(fc, idx, frac = 0) {
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

/** Jokaisen mallin oma lämpötila nyt (interpoloitu) ja ero yhdistelmään. idx on fc.hours-indeksi, ei aikajanan indeksi. */
export function modelRows(results, fc, idx, frac, blendTemp) {
  const ti = timeIndex(fc);
  return results.map((r) => {
    if (!r.ok) return { model: r.model, ok: false, skipped: !!r.skipped, coverage: !!r.coverage, error: r.error };
    const arr = r.data.vars.temperature_2m;
    // fc.align ottaa aikajanan indeksin: hours-indeksi muunnetaan aikaleiman kautta (hours ohittaa tunnit, joilta lämpötila puuttuu)
    const jOf = (i) => (fc.hours[i] ? fc.align[r.model.key]?.(ti.get(fc.hours[i].t)) : null);
    const at = (i) => {
      const j = jOf(i);
      const v = j == null ? null : arr[j];
      return v == null || !Number.isFinite(v) ? null : v;
    };
    const a = at(idx);
    const b = at(idx + 1) ?? a;
    const temp = a == null ? null : lerp(a, b, frac);
    let p24 = 0;
    const parr = r.data.vars.precipitation;
    for (let i = idx; i < Math.min(fc.hours.length, idx + 24); i++) {
      const j = jOf(i);
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
export function modelSeries(result, fc, variable) {
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
export function modelWindow(results, fc, from, to) {
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
export function modelDaily(results, fc, { days = 4 } = {}) {
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
export function confidence(fc, from, len = 12, leadH = 0) {
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
export const popPct = (p) => clamp(Math.round(p * 10) * 10, 10, 90);

/** Sateen todennäköisyys sanoin: oikea ensembletodennäköisyys tai mallien yksimielisyys, ei koskaan "100 %". */
export function popText(h) {
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
export function rainSpansFrom(fc, fromIdx, horizonH) {
  const last = fc.hours.length - 1;
  return wetSpans(fc, fromIdx, Math.min(last, fromIdx + horizonH + 12)).filter((sp) => sp.start <= fromIdx + horizonH);
}

export function wetSpans(fc, from, to, { minPwin = 0.3 } = {}) {
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
export const hh = (iso) => iso.slice(11, 13);
export const endHour = (iso) => String((+iso.slice(11, 13) + 1) % 24).padStart(2, '0');

export function whenLabel(iso, today) {
  const d = iso.slice(0, 10);
  if (d === today) return '';
  const tomorrow = new Date(today + 'T00:00:00Z');
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (d === tomorrow.toISOString().slice(0, 10)) return 'huomenna ';
  return weekday(d) + ' ';
}

const LONG_SPAN_H = 20; // tästä pituudesta alkaen "klo 14–15" olisi harhaanjohtava: loppuhetki on jo seuraavana päivänä

/** Lyhyt aikamääre tuntijaksolle: "klo 14–17" (tai "huomenna klo 06–09"). Yksi tunti: "klo 14". Pitkä jakso: "klo 14 alkaen (noin 22 h)". */
export function spanLabel(fc, start, end, today) {
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

export function describeNow(fc, nowMs) {
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

export function describeHour(fc, idx) {
  const h = fc.hours[idx];
  const d = h.t.slice(0, 10);
  const out = [];
  out.push(`${cap(weekday(d, true))} ${fmtDM(d)} klo ${hh(h.t)}: ${SYMBOLS[h.sym].toLowerCase()}, ${fmtTemp(h.temp)}.`);
  out.push(windText(h));
  if (h.precip >= 0.1) out.push(`Sadetta noin ${fmtMm(h.precip)} tunnissa, ${popText(h)}.`);
  else out.push('Sadetta ei odoteta.');
  return out;
}

export function describeDay(fc, date, nowMs) {
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

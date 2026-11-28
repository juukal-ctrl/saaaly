// answer.js: SääÄlyn sisäinen vastausmoottori. Vastaa suomenkielisiin sääkysymyksiin pelkästään sovelluksen
// keräämän datan perusteella: usean säämallin yhdistelmä (fc) ja yksittäisten mallien omat luvut (results).
// Ei tekoälyä eikä omia verkkokutsuja. Paikkahaku ja muiden paikkojen ennusteet annetaan parametreina
// (ctx.geocode, ctx.forecastFor), joten moottori toimii ilman verkkoa ja on testattavissa.

import { parseQuestion } from './nlu.js';
import { nowPosition, snapshot, SYMBOLS, wetSpans, rainSpansFrom, modelWindow, modelSeries, describeNow, describeDay } from './blend.js';
import { sunEvents, dayLengthMs, moonInfo } from './sun.js';
import { fmtTemp, fmtNum, fmtMm, windFrom, weekday, fmtDM, addDays, cap, localNow, zonedToUtcMs } from './util.js';
import { placeKey, haversineKm } from './geo.js';
import { outfit, slipperyHours } from './advice.js';
import { matchInflected, fold } from './gazetteer.js';

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
export function dayName(date, today) {
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
export function resolveWindow(q, fc, nowMs, def = 'next24') {
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

export function facts(fc, from, to) {
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
export function pickGeocoded(cand, list) {
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

/** Käyttäjän suosikki kysymyksen sanalle ("Rukalla", "Mökkilässä"): taivutus kuten tunnetuilla paikoilla. */
function favoriteFor(cand, favs) {
  if (!Array.isArray(favs) || !favs.length) return null;
  const entries = favs.filter((f) => f && f.name && Number.isFinite(f.lat) && Number.isFinite(f.lon)).map((f) => ({ ...f, key: fold(f.name) }));
  const hit = matchInflected(cand.word, entries) || (cand.offline ? entries.find((e) => e.key === fold(cand.offline.name)) : null);
  return hit ? { name: hit.name, region: hit.region || '', country: hit.country || '', lat: hit.lat, lon: hit.lon, favorite: true } : null;
}

async function resolvePlaces(q, ctx, budget = { geocode: 4 }) {
  const found = [];
  const unresolved = [];
  for (const cand of q.places) {
    // Suosikit ensin: käyttäjän tallentama paikka voittaa samannimisen paikkahaun tuloksen eikä vaadi verkkoa
    const fav = favoriteFor(cand, ctx.favorites);
    if (fav) {
      found.push({ ...fav, word: cand.word });
      continue;
    }
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
 * Vastaa kysymykseen. ctx: { place, fc, results, nowMs, last, geocode(query), forecastFor(place), nowcast?, favorites? }.
 * favorites: käyttäjän suosikkipaikat (favorites.js); niiden nimet ratkeavat ennen paikkahakua.
 * nowcast: tutkaennusteen tulkinta (nowcast.js summarizeNowcast), vain nykyiselle paikalle.
 * Palauttaa { text, intents, place, last, understood }. last tallennetaan seuraavaa kysymystä varten.
 */
export async function answerQuestion(text, ctx) {
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

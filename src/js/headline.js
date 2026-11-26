// headline.js: etusivun, tuntien, viikon ja varmuuden otsikot yhdestä paikasta.
// Kaikki sadeajat lasketaan samoista sadejaksoista (wetSpans / rainSpansFrom), jotta eri näkymät kertovat saman ajan.
// Puhtaita funktioita: ei DOMia, ei verkkoa.

import { nowPosition, rainSpansFrom, wetSpans, confidence, modelSeries } from './blend.js';
import { outfit, slippery, ADVICE } from './advice.js';
import { fmtTemp, fmtNum, weekday, fmtDM, addDays, cap } from './util.js';

// ---------- Apuja ----------

/** "07" -> "7": juoksevassa tekstissä tunnit ilman etunollaa ("klo 7"). */
const H = (iso) => String(+iso.slice(11, 13));
/** Jakson viimeisen märän tunnin jälkeinen tunti: sade loppuu "klo 16" kun viimeinen märkä tunti on 15. */
const after = (iso) => String((+iso.slice(11, 13) + 1) % 24);
/** "klo 16 asti" / "keskiyöhön asti" */
const kloAsti = (h) => (h === '0' ? 'keskiyöhön' : `klo ${h}`);

const ESS = { su: 'sunnuntaina', ma: 'maanantaina', ti: 'tiistaina', ke: 'keskiviikkona', to: 'torstaina', pe: 'perjantaina', la: 'lauantaina' };

/** Päivä essiivissä: "tänään", "huomenna", "maanantaina". */
export function dayEss(date, today) {
  if (date === today) return 'tänään';
  if (date === addDays(today, 1)) return 'huomenna';
  return ESS[weekday(date)];
}

/** Hetken nimi tekstissä: "klo 16", "huomenna klo 7", "yöllä klo 2", "ma klo 11". */
export function whenText(iso, today, nowHour = 12) {
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
export function nextRain(fc, fromIdx) {
  const last = fc.hours.length - 1;
  if (fromIdx > last) return null;
  return wetSpans(fc, fromIdx, last)[0] || null;
}

/** "Seuraava sade ma klo 11." tai "Ei sadetta lähipäivinä." */
export function nextRainLine(fc, fromIdx, today, nowHour = 12) {
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
export function todayWindow(fc, nowMs) {
  const { idx, local } = nowPosition(fc, nowMs);
  const last = fc.hours.length - 1;
  const e22 = idxAt(fc, local.date, 22);
  return { from: idx, to: Math.min(last, Math.max(e22 >= 0 ? e22 : idx, idx + 6)), idx, local };
}

/** Huomisen päiväväli klo 7–21. null, jos ennuste ei ulotu huomiseen. */
export function tomorrowWindow(fc, nowMs) {
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
export function homeHeadline(fc, nowMs, { day = 'today', sensitivity = 0, nowcast = null } = {}) {
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
export function tomorrowHero(fc, nowMs) {
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
export function hoursHeadline(fc, nowMs, nowcast = null) {
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
export function weekHeadline(days, today) {
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
export function weekendLine(days, today) {
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
export function daySlippery(fc, d) {
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
export function certaintyInfo(fc, results, nowMs) {
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
export function certaintyWord(level) {
  return WORD[level] || '';
}

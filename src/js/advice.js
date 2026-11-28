// advice.js: neuvot ja huomiot yhdestä paikasta. Kaikki on koodilla laskettua ("koodi laskee, tekoäly selittää").
// Samaa logiikkaa käyttävät etusivun vastauskaista, chat ja myöhemmin Androidin widget ja ilmoitukset, joten
// funktiot ovat puhtaita (ei DOMia, ei verkkoa) ja kynnysarvot on koottu tähän yhteen paikkaan: ne ovat arvioita,
// joita viritetään käytön myötä.
//
// Nimeämisohje: koodin tuottamat arviot ovat "SääÄlyn arvio" tai "SääÄlyn huomio". Sana "varoitus" ja Ilmatieteen
// laitoksen keltainen/oranssi/punainen kuuluvat vain viranomaisen varoituksille.

import { nowPosition, wetSpans, windowPopPm, wQuantile, spanLabel, hh, endHour } from './blend.js';
import { fmtNum, fmtTemp, fmtMm } from './util.js';
import { windChill, wetBulb } from './phys.js';

// ---------- Kynnysarvot ----------

export const ADVICE = {
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
export function windowStats(fc, from, to) {
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
export const OUTFIT = [
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
export function outfit(fc, from, to, { activity = 'walk', sensitivity = 0 } = {}) {
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
export function umbrella(fc, from, to, { nowIdx = null } = {}) {
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
export function rainWhen(fc, u, nowIdx, today) {
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
export function slipperyHours(fc, from, to) {
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
export function slippery(fc, from, to) {
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
export function frostRisk(fc, from, to, month) {
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
export function uvAdvice(fc, from, to) {
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
export function ownAlerts(fc, from, to, { month = 6, lat = 60 } = {}) {
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
export function verdictWindow(fc, nowMs, force = 'auto') {
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

/**
 * Vastauskaistan sisältö: enintään neljä kaistaa (takki, sateenvarjo + kaksi tärkeintä lisäkaistaa) ja yksi koodilla tehty lause.
 * Ääri-ilmiöt (alerts) palautetaan erikseen: ne näytetään sivun yläreunan huomiokaistalla, ei neuvojen joukossa.
 * opts.nowcast: tutkaennuste (nowcast.js) jos saatavilla; opts.month, opts.lat; opts.activity, opts.sensitivity.
 */
export function verdict(fc, nowMs, opts = {}) {
  const win = verdictWindow(fc, nowMs, opts.window);
  const { from, to, nowIdx } = win;
  const today = fc.hours[nowIdx].t.slice(0, 10);
  const month = opts.month ?? +today.slice(5, 7);
  const lat = opts.lat ?? fc.lat ?? 60;
  const future = win.kind === 'tomorrow'; // huomisen ikkunassa "nyt" ei ole olennainen
  const a = fc.hours[from].t;
  const b = fc.hours[to].t;
  win.caption = win.kind === 'soon' ? 'Seuraavat 6 tuntia' : `${win.kind === 'tomorrow' ? 'Huomenna' : 'Tänään'} klo ${hh(a)}–${endHour(b)}`;
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
export function outfitSentence(o) {
  return o.tier.long;
}

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

export const RANGES = {
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
export function monotonePath(pts) {
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
export function meteogram(hours, o = {}) {
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
      out.push(`<rect ${fill} x="${r1(x)}" y="${r1(base - hSolid)}" width="${r1(w)}" height="${r1(hSolid)}" rx="1"/>`);
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
  if (o.icon) {
    const sy = ySym + 2;
    if (range === '7d') {
      const dates = [...new Set(pts.map((h) => h.t.slice(0, 10)))];
      for (const d of dates) {
        const x0 = Math.max(padL, xOfIso(d + 'T00:00')), x1 = Math.min(padL + plotW, xOfIso(d + 'T23:59'));
        if (x1 - x0 < 30) continue;
        const day = bins.filter((b) => b.t.slice(0, 10) === d && hourOf(b.t) >= 6 && hourOf(b.t) < 21);
        const sym = (day.length ? day : bins.filter((b) => b.t.slice(0, 10) === d)).reduce((b, x) => (SEV.indexOf(x.sym) > SEV.indexOf(b) ? x.sym : b), 'clear');
        out.push(nestedIcon(o.icon, sym, true, (x0 + x1) / 2, sy, 28));
      }
    } else {
      const every = compact ? R.every * 2 : R.every;
      for (let i = 0; i < pts.length && i <= N; i++) {
        const h = pts[i];
        if (hourOf(h.t) % every !== 0) continue;
        const x = xAt(i);
        if (x < padL + 14 || x > padL + plotW - 14) continue;
        out.push(nestedIcon(o.icon, h.sym, h.isDay, x, sy, 28));
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
  return { svg, width: W, height, bins, readout, summary, inspect: inspect >= 0 ? inspect : null, geom: { padL, plotW, bw, N, ySym, yTemp, yPrec, yWind }, top };
}

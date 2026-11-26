// views.js: näkymät HTML-merkkijonoina. Puhtaita funktioita: sama syöte antaa saman HTML:n.
// Kaikki dynaaminen teksti kulkee esc()-funktion kautta.

import { escapeHtml as esc, fmtTemp, fmtNum, fmtMm, windFrom, weekday, fmtDM, addDays, cap, mdToHtml, zonedToUtcMs, localNow } from './util.js';
import { SYMBOLS, nowPosition, snapshot, modelRows, describeNow, describeDay, describeHour, popText } from './blend.js';
import { homeHeadline, hoursHeadline, weekHeadline, weekendLine, daySlippery, certaintyInfo, tomorrowHero, tomorrowWindow } from './headline.js';
import { icon, icon3d } from './icons.js';
import { meteogram, RANGES } from './meteogram.js';
import { sunEvents, dayLengthMs } from './sun.js';
import { placeSubtitle } from './geo.js';

export const SVG = {
  locate: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.4 5.7"/><path d="M20 4v7h-7"/></svg>',
  sliders: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9M18 7h2M4 17h2M11 17h9"/><circle cx="15.5" cy="7" r="2.3"/><circle cx="8.5" cy="17" r="2.3"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-3-7z"/></svg>',
  spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  caret: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>',
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.1"/></svg>',
};

/** Neuvojen piirrokset: yksinkertaiset viivakuvat, väri tulee tekstistä (currentColor). */
export const GLYPH = {
  coat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3.5L5 6 3 11l3 1.2V21h12v-8.8L21 11l-2-5-4-2.5"/><path d="M9 3.5c.6 1.6 1.7 2.5 3 2.5s2.4-.9 3-2.5M12 6v15"/></svg>',
  umbrella: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 0 1 18 0H3z"/><path d="M12 12v6.5a2 2 0 0 1-4 0"/><path d="M12 3v-1"/></svg>',
  snow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9M9.5 4.8L12 7l2.5-2.2M9.5 19.2L12 17l2.5 2.2"/></svg>',
  ice: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20l3-7 3 3 3-8 5 12H5z"/><path d="M4 4l2 2M9 3v3M19 4l-2 2"/></svg>',
  wind: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3M3 12h7"/></svg>',
  uv: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></svg>',
  frost: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M5 7.5l14 9M19 7.5l-14 9"/><circle cx="12" cy="12" r="2"/></svg>',
  fog: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h12M7 12h13M4 16h10M10 20h8"/></svg>',
  alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l9 16H3l9-16z"/><path d="M12 10v4.5M12 17v.1"/></svg>',
  air: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9c3-3 6 3 9 0s4-2 7 0M4 15c3-3 6 3 9 0s4-2 7 0"/></svg>',
  pollen: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2.2"/><path d="M12 9.8V4M12 14.2V20M9.8 12H4M14.2 12H20M10.4 10.4L6.5 6.5M13.6 13.6l3.9 3.9M13.6 10.4l3.9-3.9M10.4 13.6l-3.9 3.9"/></svg>',
  radar: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6-4"/></svg>',
  aurora: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18c2-6 4-9 6-9s2 5 4 5 3-7 5-7 3 4 3 11"/></svg>',
  station: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M7 21h10M8.5 8a5 5 0 0 1 7 0M6 5.5a8.5 8.5 0 0 1 12 0"/></svg>',
  road: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3L4 21M16 3l4 18M12 4v3M12 10v4M12 17v3"/></svg>',
};

/** "juuri nyt", "3 min sitten", "1 h 20 min sitten". */
export function agoText(ms) {
  const m = Math.floor(Math.max(0, ms) / 60000);
  if (m < 1) return 'juuri nyt';
  if (m < 60) return `${m} min sitten`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h < 24) return r ? `${h} h ${r} min sitten` : `${h} h sitten`;
  return `${Math.floor(h / 24)} vrk sitten`;
}
export const STALE_MIN = 60;

const hh = (iso) => iso.slice(11, 13);
const clock = (ms) => new Date(ms).toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' });

export function selLabel(sel) {
  if (sel.type === 'hour') return `${weekday(sel.iso.slice(0, 10))} ${fmtDM(sel.iso.slice(0, 10))} klo ${hh(sel.iso)}`;
  if (sel.type === 'day') return `${cap(weekday(sel.date, true))} ${fmtDM(sel.date)}`;
  return 'nyt';
}

// ---------- Otsikko ----------

export function placeHtml(place) {
  if (!place || !place.name) return '<span class="place-name"><span class="pn">Haetaan sijaintia…</span></span><span class="place-sub">Hetki vain</span>';
  const sub = placeSubtitle(place);
  const note = place.note ? ` (${place.note})` : '';
  const pin = place.gps ? `<span class="pin" title="Perustuu sijaintiisi">${SVG.locate}</span>` : '';
  return `<span class="place-name">${pin}<span class="pn">${esc(place.name)}</span>${SVG.caret}</span><span class="place-sub">${esc(sub)}${esc(note)}</span>`;
}

// ---------- Sankari ----------

export function sunLine(fc, localDate) {
  const dayStart = zonedToUtcMs(localDate + 'T00:00', fc.tz);
  const ev = sunEvents(dayStart, fc.lat, fc.lon);
  if (ev.polar === 'day') return 'Aurinko ei laske (yötön yö)';
  if (ev.polar === 'night') return 'Aurinko ei nouse (kaamos)';
  const fmt = (ms) => (ms == null ? '–' : localNow(ms, fc.tz).iso.slice(11).replace(':', '.'));
  const len = dayLengthMs(ev);
  const prev = dayLengthMs(sunEvents(dayStart - 86400000, fc.lat, fc.lon));
  let txt = `Aurinko ${fmt(ev.rise)}–${fmt(ev.set)}`;
  if (len != null && len > 0 && len < 86400000) {
    const m = Math.floor(len / 60000);
    txt += `, päivä ${Math.floor(m / 60)} h ${m % 60} min`;
    if (prev != null && prev > 0 && prev < 86400000) {
      const d = Math.round((len - prev) / 1000);
      const a = Math.abs(d);
      if (a >= 5) txt += `, ${d > 0 ? 'pitenee' : 'lyhenee'} ${a < 60 ? `${a} s` : `${Math.floor(a / 60)} min ${a % 60} s`}`;
    }
  }
  return txt;
}

const hr = (iso) => (iso.slice(11, 13) === '00' ? '00' : String(+iso.slice(11, 13)));

/**
 * Sankari: iso lämpötila, 3D-objekti ja kolme pientä riviä. Tilat: nyt, radalta valittu tunti ja huomenna.
 * Sijoittelu: app.css, .stage.
 */
export function heroHtml({ fc, nowMs, sel = { type: 'now' }, day = 'today' }) {
  const { idx, frac, local } = nowPosition(fc, nowMs);
  let temp;
  let sym;
  let isDay;
  let lines;
  let sr;
  let chip = '';
  const th = sel.type !== 'hour' && day === 'tomorrow' ? tomorrowHero(fc, nowMs) : null;
  if (sel.type === 'hour' && fc.hours.some((x) => x.t === sel.iso)) {
    const h = fc.hours.find((x) => x.t === sel.iso);
    const d = h.t.slice(0, 10);
    const lbl = `${d === local.date ? 'tänään' : d === addDays(local.date, 1) ? 'huomenna' : weekday(d)} klo ${hr(h.t)}`;
    temp = h.temp;
    sym = h.sym;
    isDay = h.isDay;
    chip = `<button class="hero-chip" type="button" data-act="now" aria-label="${esc(`Näytetään ${lbl}. Palaa nykyhetkeen`)}">${esc(cap(lbl))}${SVG.close}</button>`;
    lines = [`tuntuu kuin ${fmtTemp(h.feels)}`, `${SYMBOLS[h.sym].toLowerCase()} · ${fmtNum(h.wind)} m/s`];
    sr = `${cap(lbl)}: ${fmtTemp(h.temp)}, tuntuu kuin ${fmtTemp(h.feels)}, ${SYMBOLS[h.sym].toLowerCase()}, tuuli ${fmtNum(h.wind)} m/s.`;
  } else if (th) {
    temp = th.tmax;
    sym = th.sym;
    isDay = true;
    chip = `<span class="hero-chip still">Huomenna ${esc(weekday(th.date))} ${esc(fmtDM(th.date))}</span>`;
    lines = [`aamulla ${fmtTemp(th.morning)} · alin ${fmtTemp(th.tmin)}`, `${SYMBOLS[th.sym].toLowerCase()} · ${fmtNum(th.wind)} m/s`];
    sr = `Huomenna ${weekday(th.date, true)} ${fmtDM(th.date)}: ylin ${fmtTemp(th.tmax)}, aamulla ${fmtTemp(th.morning)}, alin ${fmtTemp(th.tmin)}, ${SYMBOLS[th.sym].toLowerCase()}.`;
  } else {
    const s = snapshot(fc, idx, frac);
    const d = fc.days.find((x) => x.date === local.date) || fc.days[0];
    temp = s.temp;
    sym = s.sym;
    isDay = s.isDay;
    lines = [`tuntuu kuin ${fmtTemp(s.feels)}`, `${SYMBOLS[s.sym].toLowerCase()} · ${fmtNum(s.wind)} m/s`, `tänään ${fmtTemp(d.tmin)}…${fmtTemp(d.tmax)}`];
    sr = `Sää nyt: ${fmtTemp(s.temp)}, tuntuu kuin ${fmtTemp(s.feels)}, ${SYMBOLS[s.sym].toLowerCase()}, tuuli ${fmtNum(s.wind)} m/s. Tänään alin ${fmtTemp(d.tmin)}, ylin ${fmtTemp(d.tmax)}.`;
  }
  return `
    <div class="temp" aria-hidden="true">${esc(fmtTemp(temp))}</div>
    <div class="hero-icon">${icon3d(sym, isDay, 0)}</div>
    <p class="sr-only">${esc(sr)}</p>
    <div class="hero-lines">${chip}${lines.map((l, k) => `<span class="hl-${k}" aria-hidden="true">${esc(l)}</span>`).join('')}</div>`;
}

/** "Nyt"-rivin lisätiedot Tunnit-näkymässä: kosteus, paine, pilvisyys, aurinko ja päivitysaika. */
function nowExtrasHtml({ fc, nowMs, fetchedAt = 0, loading = false }) {
  const { idx, frac, local } = nowPosition(fc, nowMs);
  const s = snapshot(fc, idx, frac);
  const age = nowMs - fetchedAt;
  const stale = !loading && fetchedAt && age >= STALE_MIN * 60000;
  const updated = loading ? 'Päivitetään…' : fetchedAt ? `Päivitetty ${agoText(age)}` : '';
  return `<li>Kosteus ${Math.round(s.hum ?? 0)} % · ilmanpaine ${Math.round(s.press ?? 0)} hPa</li>
    <li>${esc(sunLine(fc, local.date))}</li>
    ${updated ? `<li class="${stale ? 'stale' : ''}">${esc(updated)}${stale ? ' <span class="stale-tag">vanhentunut</span>' : ''}</li>` : ''}`;
}

// ---------- Huomiot ja neuvot ----------

const OWN_COVERED_BY = { thunder: /ukkos/i, gust: /tuuli|myrsky|puusk/i, storm: /tuuli|myrsky/i, rain: /sade/i, heat: /helle|kuuma/i, cold: /pakkas|kylm/i };
const SEV = { Moderate: ['yellow', 'Keltainen varoitus'], Severe: ['orange', 'Oranssi varoitus'], Extreme: ['red', 'Punainen varoitus'] };
const FMI_WARN = 'https://www.ilmatieteenlaitos.fi/varoitukset';

/**
 * Etusivun varoitusrivi radan yläpuolella: viralliset varoitukset (värillinen rengas) ja SääÄlyn omat huomiot (katkoviiva).
 * officialState 'unknown' tai varoitustiedon ikä yli 90 min: rauhallinen siru, jossa tiedon ikä ja linkki Ilmatieteen laitokselle.
 */
export function alertsHtml({ alerts = [], official = [], officialState = 'ok', checkedAt = 0, nowMs = 0 }) {
  const off = official.slice(0, 3);
  const dup = (a) => off.some((o) => OWN_COVERED_BY[a.key]?.test(o.title || ''));
  const old = checkedAt && nowMs && nowMs - checkedAt > 90 * 60000;
  const unknown = officialState === 'unknown' || old;
  const own = alerts.filter((a) => a.level >= 1 && !dup(a)).slice(0, Math.max(0, 2 - off.length));
  if (!own.length && !off.length && !unknown) return '';
  const rows = [];
  for (const o of off) {
    const [cls, word] = SEV[o.severity] || SEV.Moderate;
    // Tiivis yhteenveto (otsikko + voimassaoloaika yhdellä rivillä); alue ja lähde avautuvassa osassa.
    const src = [o.area, 'Ilmatieteen laitos'].filter(Boolean).join(' · ');
    rows.push(`<details class="alert off sev-${cls}"><summary><i class="sev-dot" aria-hidden="true"></i><span class="a-txt"><b>${esc(word)} · ${esc(o.title)}</b><small>${esc(o.time || o.when || '')}</small></span>${SVG.caret}</summary>${o.text ? `<p>${esc(o.text)}</p>` : ''}<p class="fine">${esc(src)}</p></details>`);
  }
  for (const a of own) {
    rows.push(`<details class="alert own"><summary><i class="sev-dot" aria-hidden="true"></i><span class="a-txt"><b>${esc(a.title)}</b><small>${esc(a.short || '')} · SääÄlyn huomio</small></span>${SVG.caret}</summary><p>${esc(a.text)}</p><p class="fine">Oma laskenta mallidatasta, ei virallinen varoitus. <a href="${FMI_WARN}" target="_blank" rel="noopener">Viralliset varoitukset</a></p></details>`);
  }
  if (unknown) {
    const d = checkedAt ? new Date(checkedAt) : null;
    const t = d ? `${d.toDateString() === new Date(nowMs || Date.now()).toDateString() ? '' : `${d.getDate()}.${d.getMonth() + 1}. `}klo ${d.getHours()}.${String(d.getMinutes()).padStart(2, '0')}` : '';
    const txt = d ? `Varoitustieto ${t}` : 'Varoituksia ei voitu tarkistaa';
    rows.push(`<a class="alert-chip" href="${FMI_WARN}" target="_blank" rel="noopener"><i aria-hidden="true"></i>${esc(txt)} · tarkista Ilmatieteen laitokselta</a>`);
  }
  return `<div class="alert-list" role="region" aria-label="Varoitukset ja huomiot">${rows.join('')}</div>`;
}

/** Etusivun otsikko: kaksi riviä (toiminto + aika) ja pieni lisärivi. Ei laatikoita eikä painikkeita. */
export function verdictHtml({ hl }) {
  return `<p class="vsay"><b>${esc(hl.l1)}</b><span>${esc(hl.l2)}</span></p>${hl.small ? `<p class="vsmall">${esc(hl.small)}</p>` : ''}`;
}

// ---------- Tuntirata ----------

// Radan tuntipaikat esirenderöidyssä radassa (412 x 750 -yksikön alue): c = kuvakkeen keskipiste, d = piste radan pinnalla.
// Paikat on valittu käsin radan ulkokaarteisiin niin, että teksti (vasen yläkulma) ja Kysy-pilleri (alareuna) jäävät vapaiksi.
const TRACK_START = [290, 170];
const TRACK = [
  { c: [380, 236], d: [359.5, 238.0] },
  { c: [380, 330], d: [351.3, 317.2] },
  { c: [300, 420], d: [283.4, 379.0] },
  { c: [226, 424], d: [224.0, 390.1] },
  { c: [152, 430], d: [142.3, 400.1] },
  { c: [96, 624], d: [113.3, 570.2] },
  { c: [168, 628], d: [172.8, 579.4] },
  { c: [240, 636], d: [250.7, 593.8] },
  { c: [382, 560], d: [331.1, 601.2] },
  { c: [382, 650], d: [357.1, 654.2] },
];
export const TRACK_HOURS = TRACK.length;
const pct = (v, total) => `${((v / total) * 100).toFixed(2)}%`;

/** Tunnit kromiradalla: jokaisella tunnilla oma 3D-objekti, lämpötila ja kellonaika. Huomenna-tilassa huomisen aamusta alkaen. */
export function trackHtml({ fc, nowMs, sel, day = 'today' }) {
  const { idx } = nowPosition(fc, nowMs);
  let start = idx + 1;
  let label = 'nyt';
  if (day === 'tomorrow') {
    const w = tomorrowWindow(fc, nowMs);
    if (w) (start = w.from), (label = 'huomenna');
  }
  const out = [`<span class="th-start" style="left:${pct(TRACK_START[0], 412)};top:${pct(TRACK_START[1], 750)}" aria-hidden="true">${label}</span>`];
  TRACK.forEach((pt, k) => {
    const h = fc.hours[start + k];
    if (!h) return;
    const pressed = sel.type === 'hour' && sel.iso === h.t;
    const name = `${weekday(h.t.slice(0, 10))} klo ${hr(h.t)}, ${SYMBOLS[h.sym]}, ${fmtTemp(h.temp)}`;
    out.push(`<i class="td" style="left:${pct(pt.d[0], 412)};top:${pct(pt.d[1], 750)}"></i>`);
    out.push(
      `<button class="th" type="button" style="left:${pct(pt.c[0], 412)};top:${pct(pt.c[1], 750)}" data-act="hour" data-iso="${esc(h.t)}" aria-pressed="${pressed}" aria-label="${esc(name)}"><span class="th-ic">${icon3d(h.sym, h.isDay, 0)}</span><b>${esc(fmtTemp(h.temp))}</b><span>klo ${hh(h.t)}</span></button>`,
    );
  });
  return `<div class="trk-img" aria-hidden="true"></div>${out.join('')}`;
}

// ---------- Selitys ----------

export function selectionLines(fc, sel, nowMs) {
  if (sel.type === 'hour') {
    const i = fc.hours.findIndex((h) => h.t === sel.iso);
    return i < 0 ? [] : describeHour(fc, i);
  }
  if (sel.type === 'day') return describeDay(fc, sel.date, nowMs);
  return describeNow(fc, nowMs);
}

// ---------- Sääkaavio ----------

const MG_LABELS = { '24h': '24 h', '48h': '48 h', '7d': '7 vrk' };

/** Yöjaksot kaavion varjostukseen: peräkkäiset tunnit, joissa aurinko on laskenut. [alku, loppu] paikallisena ISO-aikana. */
export function nightSpans(hours) {
  const spans = [];
  let start = null;
  for (let i = 0; i < hours.length; i++) {
    if (!hours[i].isDay && start == null) start = hours[i].t;
    if (hours[i].isDay && start != null) {
      spans.push([start, hours[i].t]);
      start = null;
    }
  }
  if (start != null) spans.push([start, hours[hours.length - 1].t.slice(0, 11) + '23:59']);
  return spans;
}

/** Sääkaavio: lämpötilakäyrä ja epävarmuuskaista, sadepalkit, tuulinuolet. Tarkastus (inspect) näyttää yhden jakson luvut. */
export function meteoHtml({ fc, nowMs, range = '24h', inspectIso = null, width = 360, compact = false }) {
  const r = RANGES[range] ? range : '24h';
  const { idx, frac } = nowPosition(fc, nowMs);
  const hours = fc.hours.slice(idx);
  if (hours.length < 6) return '';
  const mg = meteogram(hours, { range: r, width, nowFrac: frac, icon3d: true, night: nightSpans(hours), inspectIso, compact, uid: 'mg' });
  const ics = (mg.icons || []).map((c) => `<span class="mg-ic" style="left:${((c.x / mg.width) * 100).toFixed(2)}%;top:${((c.y / mg.height) * 100).toFixed(2)}%">${icon3d(c.sym, c.isDay, 0)}</span>`).join('');
  const n = mg.bins.length;
  const sel = mg.inspect;
  const ro = sel != null ? mg.readout(sel) : null;
  const seg = Object.keys(RANGES)
    .map((k) => `<button class="seg" type="button" data-act="mg-range" data-range="${k}" aria-pressed="${k === r}">${MG_LABELS[k]}</button>`)
    .join('');
  const step = r === '7d' ? 4 : 3;
  const rows = [];
  for (let j = 0; j < n; j += step) {
    const x = mg.readout(j);
    rows.push(`<tr><th scope="row">${esc(x.when)}</th><td>${esc(x.temp)}</td><td>${esc(x.sym)}</td><td>${esc(x.rain)}</td><td>${esc(x.wind)}${x.from ? ` ${esc(x.from)}` : ''}</td></tr>`);
  }
  const readText = ro
    ? `<b>${esc(ro.when)}</b> · ${esc(ro.temp)} · ${esc(ro.sym)} · ${esc(ro.rain)} · tuuli ${esc(ro.wind)}${ro.from ? ` ${esc(ro.from)}` : ''}`
    : esc(mg.summary);
  return `
    <div class="mg-head"><div class="modebar mg-seg" role="group" aria-label="Kaavion aikaväli">${seg}</div></div>
    <div class="mg-wrap" id="mgWrap" tabindex="0" role="slider" aria-label="Tarkastele sääkaaviota nuolinäppäimillä tai koskettamalla" aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="${n - 1}" aria-valuenow="${sel ?? 0}" aria-valuetext="${esc(ro ? ro.aria : mg.summary)}" data-w="${mg.width}" data-n="${n}" data-range="${r}">${mg.svg}${ics}</div>
    <p class="mg-read" id="mgRead">${readText}</p>
    <p class="mg-legend">Viiva: lämpötila · vaalea alue: mallien vaihteluväli · palkit: sade mm/${r === '7d' ? '3 h' : 'h'} · nuolet: tuulen suunta ja m/s</p>
    <details class="mg-table"><summary>Kaavio taulukkona</summary><div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col">Aika</th><th scope="col">Lämpö</th><th scope="col">Sää</th><th scope="col">Sade</th><th scope="col">Tuuli</th></tr></thead><tbody>${rows.join('')}</tbody></table></div></details>`;
}

// ---------- Tunnit ----------

/** Tunnin lisätiedot riville avattuna: tuntuu kuin, tuuli, sade, pilvisyys ja mallien ero. */
function hourDetailsHtml(fc, i, { now = false, nowMs, fetchedAt = 0, loading = false, obs = null } = {}) {
  const h = fc.hours[i];
  const gust = h.gust - h.wind >= 3 ? `, puuskat ${fmtNum(h.gust)} m/s` : '';
  const rain = h.precip >= 0.05 ? `Sade ${fmtMm(h.precip)} tunnissa · ${popText(h)}` : h.pop >= 0.15 ? `Ei sadetta todennäköisesti · ${popText(h)}` : 'Ei sadetta';
  const spread = Number.isFinite(h.spread) ? ` · mallien ero ${fmtNum(h.spread, 1)}°` : '';
  const q = `Millainen sää on ${now ? 'nyt' : `klo ${hr(h.t)}`}?`;
  return `<div class="hv-more" id="hm-${esc(h.t)}"><ul class="plain">
    <li>Tuntuu kuin ${esc(fmtTemp(h.feels))}</li>
    <li>Tuuli ${fmtNum(h.wind)} m/s ${esc(windFrom(h.dir))}${esc(gust)}</li>
    <li>${esc(rain)}</li>
    <li>Pilvisyys ${Math.round(h.cloud ?? 0)} %${esc(spread)}</li>
    ${now && obs ? `<li>Mitattu ${esc(fmtTemp(obs.value, { digits: 1 }))} · ${esc(obs.name || 'lähin asema')}</li>` : ''}
    ${now ? nowExtrasHtml({ fc, nowMs, fetchedAt, loading }) : ''}
  </ul><button class="pill sm" type="button" data-act="ask-open" data-q="${esc(q)}">${SVG.spark}Kysy tästä tunnista</button></div>`;
}

/** Tutkan kahden tunnin sadekäyrä, kun sade on lähellä. raw: nowcast.js:n jäsentämä { steps:[{t, rate}] }. */
export function radarHtml({ raw, nc, nowMs, tz }) {
  if (!raw?.steps?.length || !nc?.ok) return '';
  const near = nc.state === 'wet' || (nc.startMin != null && nc.startMin <= 120);
  if (!near) return '';
  const steps = raw.steps.filter((s) => s.t >= nowMs - 5 * 60000 && s.t <= nowMs + 125 * 60000);
  if (steps.length < 3) return '';
  const max = Math.max(1, ...steps.map((s) => s.rate));
  const bars = steps.map((s) => `<i style="height:${Math.max(2, Math.round((Math.min(s.rate, max) / max) * 100))}%"${s.rate >= 0.2 ? '' : ' class="dry"'}></i>`).join('');
  const clock = (ms) => new Date(ms).toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit', timeZone: tz }).replace(':', '.');
  // Otsikko kertoo jo ajoituksen: kuvateksti kertoo voimakkuuden. Ruudunlukija saa koko lauseen.
  const cap2 = nc.word ? `Tutka: ${nc.word} sadetta ${nc.state === 'wet' ? 'nyt' : 'tulossa'}` : 'Tutka: sadetta lähellä';
  return `<div class="radar" role="img" aria-label="${esc(`Tutka: ${nc.line || ''}`)}"><p class="radar-t">${GLYPH.radar}<span>${esc(cap2)}</span></p>
    <div class="radar-bars">${bars}</div><div class="radar-ax"><span>nyt</span><span>${esc(clock(nowMs + 60 * 60000))}</span><span>${esc(clock(nowMs + 120 * 60000))}</span></div></div>`;
}

/**
 * Tunnit-sivu: otsikko, Lista/Kaavio-valinta ja tuntilista kromipunoksen vieressä. Rivin napautus avaa lisätiedot paikallaan.
 * day 'tomorrow': huomisen tunnit klo 6–23. more: 48 tuntia 13 sijaan.
 */
export function hoursPageHtml({ fc, nowMs, day = 'today', open = null, more = false, view = 'list', radar = '', fetchedAt = 0, loading = false, obs = null, nowcast = null }) {
  const { idx, local } = nowPosition(fc, nowMs);
  let hs;
  let kick;
  let l1;
  let l2;
  if (day === 'tomorrow' && tomorrowWindow(fc, nowMs)) {
    const w = tomorrowWindow(fc, nowMs);
    const a = fc.hours.findIndex((x) => x.t === `${w.date}T06:00`);
    hs = fc.hours.slice(a >= 0 ? a : w.from, (a >= 0 ? a : w.from) + 18).map((h, k) => ({ h, i: (a >= 0 ? a : w.from) + k }));
    const th = homeHeadline(fc, nowMs, { day: 'tomorrow' });
    const d = fc.days.find((x) => x.date === w.date);
    kick = `Tunnit · huomenna ${weekday(w.date)} ${fmtDM(w.date)}`;
    l1 = th.l2;
    l2 = d ? `Ylin ${fmtTemp(d.tmax)}, alin ${fmtTemp(d.tmin)}.` : '';
  } else {
    hs = fc.hours.slice(idx, idx + (more ? 48 : 13)).map((h, k) => ({ h, i: idx + k }));
    kick = `Tunnit · ${weekday(local.date, true)}`;
    [l1, l2] = hoursHeadline(fc, nowMs, nowcast);
  }
  const dry = hs.every(({ h }) => (h.pop ?? 0) < 0.1 && h.precip < 0.1);
  const isNow = (i) => day !== 'tomorrow' && i === idx;
  const rows = [];
  let block = [];
  const flush = () => {
    if (block.length) rows.push(`<div class="hv-block"><div class="braid" aria-hidden="true"></div>${block.join('')}</div>`);
    block = [];
  };
  hs.forEach(({ h, i }, k) => {
    const date = h.t.slice(0, 10);
    if (k > 0 && hr(h.t) === '00') {
      flush();
      rows.push(`<p class="hv-sep">${esc(cap(weekday(date, true)))} ${esc(fmtDM(date))}</p>`);
    }
    const now = isNow(i);
    const pc = popPctRow(h);
    const expanded = open === h.t;
    const name = `${now ? 'Nyt' : `${weekday(date)} klo ${hr(h.t)}`}, ${SYMBOLS[h.sym]}, ${fmtTemp(h.temp)}${dry ? '' : `, sateen todennäköisyys ${pc} %`}`;
    block.push(`<div class="hv-item"><button class="hv${now ? ' now' : ''}" type="button" data-act="hrow" data-iso="${esc(h.t)}" aria-expanded="${expanded}" aria-controls="hm-${esc(h.t)}" aria-label="${esc(name)}">
      <span class="hv-t"><i></i>${now ? 'nyt' : hh(h.t)}</span>${icon3d(h.sym, h.isDay, 0)}<span class="hv-temp">${esc(fmtTemp(h.temp))}</span>${dry ? '' : `<span class="hv-bar" aria-hidden="true"><b style="width:${pc}%"></b></span><span class="hv-pc">${pc} %</span>`}</button>
      ${expanded ? hourDetailsHtml(fc, i, { now, nowMs, fetchedAt, loading, obs }) : ''}</div>`);
  });
  flush();
  const moreBtn = day === 'tomorrow' ? '' : `<button class="more-btn" type="button" data-act="hours-more" aria-expanded="${more}">${more ? 'Näytä vähemmän' : 'Näytä 48 tuntia'}</button>`;
  const seg = `<div class="modebar hv-seg" role="group" aria-label="Näkymä"><button class="seg" type="button" data-act="hours-view" data-view="list" aria-pressed="${view !== 'chart'}">Lista</button><button class="seg" type="button" data-act="hours-view" data-view="chart" aria-pressed="${view === 'chart'}">Kaavio</button></div>`;
  return `<p class="kick">${esc(kick)}</p><h2 class="hl"><b>${esc(l1)}</b><span>${esc(l2)}</span></h2>${seg}${radar}
    ${view === 'chart' ? '<p class="hint">Liu\'uta sormea kaaviossa, niin näet tunnin tiedot.</p>' : `${dry ? '' : '<p class="hv-cap" aria-hidden="true">sateen todennäköisyys</p>'}<div class="hvs${dry ? ' dry' : ''}" id="strip">${rows.join('')}</div>${moreBtn}`}`;
}

/** Sateen todennäköisyys riville kymmenen prosentin tarkkuudella (0, 10 … 90). */
function popPctRow(h) {
  const p = h.popSrc === 'ens' ? h.pop : Math.max(h.pop ?? 0, h.popAgree ?? 0);
  return Math.min(90, Math.round(Math.max(0, p) * 10) * 10);
}

// ---------- Viikko ----------

/** Päivän tunnit vaakasuuntaisena nauhana päivän rivin alla. */
function dayHoursHtml({ fc, nowMs, day }) {
  const { idx, local } = nowPosition(fc, nowMs);
  const hours = fc.hours.filter((h, i) => h.t.slice(0, 10) === day.date && (day.date !== local.date || i >= idx));
  if (!hours.length) return '';
  const wind = Math.max(...hours.map((h) => h.wind || 0));
  const bits = [`ylin ${fmtTemp(day.tmax)}, alin ${fmtTemp(day.tmin)}`, day.precip >= 0.1 ? `sadetta ${fmtMm(day.precip)}` : 'ei merkittävää sadetta', `tuulta enintään ${fmtNum(wind)} m/s`];
  const cells = hours.map((h) => {
    const p = h.precip >= 0.1 ? fmtMm(h.precip).replace(' mm', '') : '';
    return `<div class="hr" role="listitem" data-iso="${esc(h.t)}" aria-label="${esc(`klo ${hr(h.t)}, ${SYMBOLS[h.sym]}, ${fmtTemp(h.temp)}${p ? `, sadetta ${p} mm` : ''}`)}">
      <span class="hr-t">${hh(h.t)}</span>${icon3d(h.sym, h.isDay, 0)}<span class="hr-temp">${esc(fmtTemp(h.temp))}</span><span class="hr-p">${p ? esc(p) + ' mm' : ''}</span></div>`;
  });
  return `<div class="day-hours" id="dh-${esc(day.date)}" role="region" aria-label="${esc(`Tuntiennuste ${weekday(day.date)} ${fmtDM(day.date)}`)}">
    <p class="dh-sum">${esc(bits.join(' · '))}</p><div class="dstrip" role="list" data-date="${esc(day.date)}">${cells.join('')}</div></div>`;
}

/** Viikko-sivu: otsikko, viikonloppu, ja päivät kromikapseleina yhteisellä lämpöasteikolla. Päivän napautus avaa sen tunnit. */
export function weekPageHtml({ fc, nowMs, open = null }) {
  const { idx, frac, local } = nowPosition(fc, nowMs);
  const today = local.date;
  const days = fc.days.slice(0, 7);
  const lo = Math.min(...days.map((d) => d.tmin));
  const hi = Math.max(...days.map((d) => d.tmax));
  const span = hi - lo || 1;
  const pos = (t) => ((t - lo) / span) * 100;
  const nowT = snapshot(fc, idx, frac).temp;
  const rows = days.map((d, k) => {
    const left = pos(d.tmin);
    const width = Math.max(0, pos(d.tmax) - left);
    const name = k === 0 ? 'Tänään' : cap(weekday(d.date));
    const sub = k === 0 ? `${weekday(d.date)} ${fmtDM(d.date)}` : fmtDM(d.date);
    const wetSym = /rain|drizzle|sleet|snow|thunder/.test(d.sym);
    const rain = wetSym && d.precip >= 0.1 ? fmtMm(d.precip) : d.precip >= 0.5 && (d.pwin ?? 0) >= 0.2 ? `${Math.round((d.pwin ?? 0) * 10) * 10} %` : '';
    const slip = daySlippery(fc, d);
    const expanded = open === d.date;
    const dot = d.date === today ? `<i class="wd-now" style="left:${Math.max(0, Math.min(100, pos(nowT))).toFixed(1)}%" aria-hidden="true"></i>` : '';
    const label = `${k === 0 ? 'Tänään' : weekday(d.date, true)} ${fmtDM(d.date)}, ${SYMBOLS[d.sym]}, alin ${fmtTemp(d.tmin)}, ylin ${fmtTemp(d.tmax)}${rain ? `, sade ${rain}` : ''}${slip ? ', liukasta' : ''}. ${expanded ? 'Piilota tunnit' : 'Näytä tunnit'}`;
    return `<div class="wd-item"><button class="wd" type="button" data-act="day" data-date="${esc(d.date)}" aria-expanded="${expanded}" aria-controls="dh-${esc(d.date)}" aria-label="${esc(label)}">
      <span class="wd-n"><b>${esc(name)}</b><small>${esc(sub)}</small></span>${icon3d(d.sym, true, 0)}
      <span class="wd-r" aria-hidden="true"><span class="wd-cap" style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%"><em class="lo">${esc(fmtTemp(d.tmin))}</em><em class="hi">${esc(fmtTemp(d.tmax))}</em></span>${dot}</span>
      <span class="wd-x" aria-hidden="true">${rain ? `<span>${esc(rain)}</span>` : ''}${slip ? '<span class="slip">liukasta</span>' : ''}</span></button>
      ${expanded ? dayHoursHtml({ fc, nowMs, day: d }) : ''}</div>`;
  });
  const [w1, w2] = weekHeadline(days, today);
  const we = weekendLine(days, today);
  return `<p class="kick">Seuraavat ${days.length} päivää</p><h2 class="hl"><b>${esc(w1)}</b><span>${esc(w2)}</span></h2>
    ${we ? `<p class="wk-sub">${esc(we)}</p>` : ''}<p class="hint">Napauta päivää, niin näet sen tunnit.</p><div class="wds">${rows.join('')}</div>`;
}

// ---------- Varmuus ----------

/**
 * Helmet: yksi helmi per malli. Vaakasijainti = mallin keskimääräinen ero SääÄlyn ennusteesta (±4 °C koko leveydellä).
 * Päällekkäiset helmet asettuvat tiiviiksi rykelmäksi lähimpään vapaaseen kohtaan, joten yksimieliset mallit näkyvät rypäänä.
 */
function pearlsHtml(c, label) {
  const PX = 3.9; // noin 390 px leveä alue: 1 % ≈ 3,9 px
  const D = 36; // helmien keskipisteiden vähimmäisetäisyys (px)
  const items = c.pearls
    .filter((p) => p.dev != null)
    .map((p) => ({ ...p, tx: Math.max(6, Math.min(94, 50 + (p.dev / 4) * 44)) }))
    .sort((a, b) => Math.abs(a.dev) - Math.abs(b.dev));
  const placed = [];
  for (const p of items) {
    let best = null;
    for (let dy = -60; dy <= 60; dy += 4) {
      for (let dx = -80; dx <= 80; dx += 4) {
        const x = p.tx * PX + dx;
        if (x < 6 * PX || x > 94 * PX) continue;
        if (placed.some((q) => Math.hypot(q.x - x, q.y - dy) < D)) continue;
        const score = dx * dx + 1.7 * dy * dy;
        if (!best || score < best.score) best = { x, y: dy, score };
      }
    }
    if (!best) best = { x: p.tx * PX, y: 0 };
    p.x = best.x;
    p.y = best.y;
    placed.push(p);
  }
  const missing = c.pearls.filter((p) => p.dev == null).map((p) => p.short);
  const sign = (v) => `${v > 0.05 ? '+' : v < -0.05 ? '−' : '±'}${fmtNum(Math.abs(v), 1)}°`;
  const desc = `${label}: ${items.map((p) => `${p.short} ${sign(p.dev)}`).join(', ')}`;
  return `<div class="pearls" role="img" aria-label="${esc(desc)}"><span class="pl-axis"></span><span class="pl-lab l">kylmempi</span><span class="pl-lab c">SääÄly</span><span class="pl-lab r">lämpimämpi</span>
    ${placed.map((p) => `<i class="pearl pk${p.k % 8}" style="left:${(p.x / PX).toFixed(1)}%;--o:${p.y}px" title="${esc(`${p.short} ${sign(p.dev)}`)}"></i>`).join('')}</div>
    ${missing.length ? `<p class="pl-miss">Ei mukana: ${esc(missing.join(', '))}</p>` : ''}`;
}

/** Varmuus-sivu: otsikko, helmirypäät tänään ja huomenna, selityskortit, mallivertailu. */
export function certPageHtml({ fc, results, nowMs, obs = null }) {
  const ci = certaintyInfo(fc, results, nowMs);
  const card = (c, label) => `<div class="glass cert-c"><b>${esc(label)} · ${esc(c.agree)}</b><span>${esc(c.sub)}</span></div>`;
  let obsCard = '';
  if (obs && Number.isFinite(obs.value)) {
    const { idx, frac } = nowPosition(fc, nowMs);
    const s = snapshot(fc, idx, frac);
    const diff = s.temp - obs.value;
    const at = new Date(obs.t).toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit', timeZone: fc.tz }).replace(':', '.');
    const verdict = Math.abs(diff) < 1 ? 'ennuste osuu' : Math.abs(diff) < 2.5 ? 'ennuste lähellä' : diff > 0 ? 'ennuste liian lämmin' : 'ennuste liian kylmä';
    obsCard = `<div class="glass cert-c obs"><b>Havainto · ${esc(verdict)}</b><span>${esc(`${obs.name || 'Lähin asema'}${Number.isFinite(obs.km) ? ` (${Math.round(obs.km)} km)` : ''} mittasi ${fmtTemp(obs.value, { digits: 1 })} klo ${at}. SääÄly: ${fmtTemp(s.temp, { digits: 1 })}, ero ${fmtNum(Math.abs(diff), 1)}°.`)}</span><small>Ilmatieteen laitoksen avoin data</small></div>`;
  }
  return `<p class="kick">Varmuus</p><h2 class="hl"><b>${esc(ci.l1)}</b><span>${esc(ci.l2)}</span></h2>
    <p class="cert-d">Jokainen helmi on yksi säämalli: vasemmalla kylmempi, oikealla lämpimämpi kuin SääÄlyn ennuste. Mitä tiiviimpi rypäs, sitä varmempi ennuste.</p>
    ${pearlsHtml(ci.today, 'Tänään')}${card(ci.today, 'Tänään')}
    ${obsCard}
    ${ci.tomorrow ? pearlsHtml(ci.tomorrow, 'Huomenna') + card(ci.tomorrow, 'Huomenna') : ''}`;
}

// ---------- Mallivertailu ----------

export function modelsHtml({ results, fc, nowMs }) {
  const { idx, frac } = nowPosition(fc, nowMs);
  const s = snapshot(fc, idx, frac);
  const rows = modelRows(results, fc, idx, frac, s.temp);
  const body = rows
    .map((r) => {
      if (!r.ok) {
        const state = r.skipped ? 'ei saatavilla' : r.coverage ? 'ei kata tätä paikkaa' : 'ei vastannut';
        return `<tr class="off"><th scope="row">${esc(r.model.short)}</th><td colspan="3">${state}${r.coverage ? '' : `<small>${esc(r.error || '')}</small>`}</td></tr>`;
      }
      const d = r.delta;
      const cls = r.temp == null ? 'off' : Math.abs(d) <= 1 ? 'ok' : Math.abs(d) <= 2.5 ? 'mid' : 'far';
      const dtxt = d == null ? '–' : (d > 0 ? '+' : d < 0 ? '−' : '') + fmtNum(Math.abs(d), 1);
      return `<tr class="${cls}"><th scope="row">${esc(r.model.short)}</th><td>${r.temp == null ? '–' : esc(fmtTemp(r.temp, { digits: 1 }))}</td><td class="delta">${esc(dtxt)}</td><td>${esc(fmtMm(r.precip24))}</td></tr>`;
    })
    .join('');
  return `
    <details class="models-d">
      <summary><span class="label">Mallivertailu</span><span class="sum">${fc.modelsUsed}/${fc.modelsTotal} mallia · suurin ero nyt ${fmtNum(s.spread, 1)}°</span>${SVG.caret}</summary>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th scope="col">Malli</th><th scope="col">Lämpö nyt</th><th scope="col">Ero</th><th scope="col">Sade 24 h</th></tr></thead>
        <tbody>${body}
          <tr class="blend"><th scope="row">Yhdistelmä</th><td>${esc(fmtTemp(s.temp, { digits: 1 }))}</td><td class="delta">0,0</td><td>${esc(fmtMm(fc.hours.slice(idx, idx + 24).reduce((a, h) => a + h.precip, 0)))}</td></tr>
        </tbody></table></div>
      <p class="note">Ero kertoo, kuinka paljon malli poikkeaa yhdistelmästä. Selvästi poikkeavat mallit jätetään yhdistelmästä pois. Vertaa lukemaa Ilmatieteen laitoksen havaintoon.</p>
    </details>`;
}

// ---------- Vastausten lähde ----------

export const MODE_INFO = {
  internal: {
    label: 'Oma laskenta',
    note: 'Ei tekoälyä: vastaukset lasketaan sovelluksen keräämästä säädatasta, myös yksittäisten säämallien luvuista. Toimii ilman avainta eikä kuluta Gemini-kiintiötä.',
  },
  grounded: {
    label: 'Gemini + data',
    note: 'Gemini kirjoittaa vastauksen, mutta saa tietää vain sovelluksen säädatan eikä saa käyttää muuta tietoa säästä. Jos Gemini ei vastaa, vastaus tulee sovelluksen omasta laskennasta ja siitä kerrotaan.',
  },
  free: {
    label: 'Gemini vapaa',
    note: 'Luvut tulevat aina sovelluksen datasta, mutta Gemini saa lisäksi käyttää yleistietoa ilmiöiden selittämiseen ja neuvoihin.',
  },
};

export const modeNote = ({ mode, hasKey }) => (hasKey ? MODE_INFO[mode]?.note || '' : `${MODE_INFO.internal.note} Lisää Gemini-avain, jos haluat käyttää myös Geminiä.`);

/** Kolmen tilan valitsin. Ilman avainta Gemini-vaihtoehdot ovat himmeitä, ja painallus vie avaimen lisäämiseen. */
export function modeSwitchHtml({ mode, hasKey }) {
  const eff = hasKey ? mode : 'internal';
  const segs = Object.entries(MODE_INFO)
    .map(([key, info]) => {
      const off = key !== 'internal' && !hasKey;
      return `<button class="seg${off ? ' off' : ''}" type="button" data-act="mode" data-mode="${key}" aria-pressed="${key === eff}"${off ? ' aria-disabled="true"' : ''}>${esc(info.label)}</button>`;
    })
    .join('');
  return `<div class="modebar" role="group" aria-label="Vastausten lähde">${segs}</div>`;
}

// ---------- Sivupaneelit ----------

export function searchSheetHtml({ recent }) {
  const rec = (recent || [])
    .map((p, i) => `<button class="row-btn" type="button" data-act="pick-recent" data-i="${i}"><b>${esc(p.name)}</b><small>${esc(placeSubtitle(p))}</small></button>`)
    .join('');
  return `
    <div class="sheet-head"><h2>Paikkakunta</h2><button class="icon-btn" type="button" data-act="close" aria-label="Sulje">${SVG.close}</button></div>
    <div class="sheet-scroll">
      <form class="search" data-form="search" role="search">${SVG.search}<input id="q" name="q" type="search" placeholder="Hae paikkakuntaa" autocomplete="off" autocapitalize="words" enterkeyhint="search" aria-label="Hae paikkakuntaa"></form>
      <button class="row-btn locate" type="button" data-act="locate">${SVG.locate}<span><b>Käytä sijaintiani</b><small>Paikannus selaimen kautta</small></span></button>
      <div id="results" class="results" aria-live="polite"></div>
      ${rec ? `<div class="label">Viimeksi katsotut</div><div class="results">${rec}</div>` : ''}
    </div>`;
}

export function resultsHtml(list, status) {
  if (status) return `<p class="note">${esc(status)}</p>`;
  return list.map((p, i) => `<button class="row-btn" type="button" data-act="pick" data-i="${i}"><b>${esc(p.name)}</b><small>${esc(placeSubtitle(p))}</small></button>`).join('');
}

export function settingsSheetHtml({ hasKey, mode = 'internal', model, refreshMin, models, demo, sens = 0, anim = true, advOpen = false }) {
  const opts = [5, 10, 15, 30].map((m) => `<option value="${m}" ${m === refreshMin ? 'selected' : ''}>${m} min</option>`).join('');
  const datalist = (models || []).map((m) => `<option value="${esc(m)}"></option>`).join('');
  return `
    <div class="sheet-head"><h2>Asetukset</h2><button class="icon-btn" type="button" data-act="close" aria-label="Sulje">${SVG.close}</button></div>
    <div class="sheet-scroll">
      <div class="quick"><button id="refreshBtn" class="btn ghost" type="button" data-act="refresh">${SVG.refresh}<span>Päivitä sää</span></button><button class="btn ghost" type="button" data-act="locate">${SVG.locate}<span>Käytä sijaintiani</span></button></div>
      ${demo ? '<p class="note demo-note">Esimerkkitila: sää, paikkahaku ja nimet ovat tekaistuja, eikä Gemini ole käytössä. Chat vastaa silti sovelluksen omalla laskennalla.</p>' : ''}
      <section class="set">
        <h3>Pukeutuminen</h3>
        <p class="note">Etusivun vaateneuvo ja chat arvioivat pukeutumisen "tuntuu kuin" -lämpötilasta. Säädä, jos palelet helposti tai kestät kylmää hyvin.</p>
        <label for="sens">Kylmänsietokyky</label>
        <select id="sens">${[[-3, 'Palelen helposti'], [0, 'Normaali'], [3, 'Kestän kylmää']].map(([v, l]) => `<option value="${v}" ${v === sens ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </section>
      <section class="set">
        <h3>Päivitys</h3>
        <label for="refresh">Päivitysväli, kun sovellus on auki</label>
        <select id="refresh">${opts}</select>
      </section>
      <section class="set">
        <h3>Ulkoasu</h3>
        <label for="anim">Animoitu tausta</label>
        <select id="anim"><option value="on" ${anim ? 'selected' : ''}>Päällä (pysähtyy 10 s kosketuksettomana)</option><option value="off" ${anim ? '' : 'selected'}>Pois (säästää akkua)</option></select>
        <p class="note">Tausta pysähtyy myös, kun puhelimen virransäästö on päällä tai akku on lähes tyhjä.</p>
      </section>
      <section class="set">
        <h3>Tiedot</h3>
        <div class="inline"><button class="btn ghost" type="button" data-act="open-about">Tietoja ja tietolähteet</button><button class="btn ghost" type="button" data-act="wipe">Tyhjennä tallennetut tiedot</button></div>
      </section>
      <details class="set adv" id="advSet"${advOpen ? ' open' : ''}>
        <summary><h3>Lisäasetukset</h3><span class="note">Chatin vastausten lähde, Gemini ja diagnostiikka</span>${SVG.caret}</summary>
        <section class="set">
          <h3>Vastausten lähde</h3>
          <p class="note">Valitse, mistä chatin vastaukset ja selitykset tulevat.</p>
          ${modeSwitchHtml({ mode, hasKey })}
          <p class="note" id="modeNote">${esc(modeNote({ mode, hasKey }))}</p>
        </section>
        <section class="set">
          <h3>Gemini-avain</h3>
          <p class="note">Avain tallentuu vain tämän laitteen selaimeen. Hae ilmainen avain osoitteesta <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>.</p>
          <label for="key">Gemini API -avain</label>
          <div class="inline"><input id="key" class="secret" type="text" inputmode="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${hasKey ? 'Avain tallennettu' : 'AIza…'}"><button class="btn" type="button" data-act="save-key">Tallenna</button></div>
          <label for="model">Malli</label>
          <div class="inline"><input id="model" list="modelList" value="${esc(model)}" autocomplete="off" spellcheck="false"><datalist id="modelList">${datalist}</datalist><button class="btn" type="button" data-act="list-models">Hae mallit</button></div>
          <div class="inline"><button class="btn" type="button" data-act="test-ai">Testaa yhteys</button>${hasKey ? '<button class="btn ghost" type="button" data-act="clear-key">Poista avain</button>' : ''}</div>
          <p class="note" id="aiNote" aria-live="polite"></p>
        </section>
        <section class="set">
          <h3>Diagnostiikka</h3>
          <p class="note">Tarkistaa, vastaako jokainen säämalli ja palvelu. Jos jokin ei toimi, kopioi raportti ja lähetä se kehittäjälle.</p>
          <div class="inline"><button class="btn" type="button" data-act="diag">Aja diagnostiikka</button><button class="btn ghost" type="button" data-act="diag-copy">Kopioi raportti</button></div>
          <pre id="diag" class="diag" aria-live="polite"></pre>
        </section>
      </details>
    </div>`;
}

/** Ensikäyttökortti: sijaintilupaa ei kysytä ennen kuin käyttäjä painaa nappia. */
export function welcomeHtml({ cities = [] }) {
  const chips = cities.map((c) => `<button class="pill sm" type="button" data-act="welcome-city" data-city="${esc(c)}">${esc(c)}</button>`).join('');
  return `
    <h2>Näytä sää sijainnissasi</h2>
    <p>Sijainti lähetetään vain sääpalvelulle (Open-Meteo) ennusteen hakua varten. Sitä ei tallenneta palvelimelle, eikä sovellus seuraa sinua.</p>
    <div class="inline"><button class="btn" type="button" data-act="welcome-locate">Käytä sijaintiani</button><button class="btn ghost" type="button" data-act="open-search">Valitse paikkakunta</button></div>
    <div class="city-chips" aria-label="Suuria kaupunkeja">${chips}</div>`;
}

/** Tietoja-paneeli: lähteet ja lisenssit, yksityisyys ja rajoitukset. */
export function aboutSheetHtml({ version, demo, sources = [] }) {
  return `
    <div class="sheet-head"><h2>Tietoja ja tietolähteet</h2><button class="icon-btn" type="button" data-act="close" aria-label="Sulje">${SVG.close}</button></div>
    <div class="sheet-scroll">
      <section class="set">
        <h3>SääÄly ${esc(version)}</h3>
        <p class="note">SääÄly yhdistää usean säämallin ennusteen yhdeksi ja kertoo tuloksen suomeksi. Luvut laskee koodi, selitykset kirjoittaa sovelluksen oma laskenta tai valinnaisesti Gemini. Kokeiluversio: tärkeissä päätöksissä ja vaaratilanteissa katso <a href="https://www.ilmatieteenlaitos.fi/varoitukset" target="_blank" rel="noopener">Ilmatieteen laitoksen varoitukset</a>.</p>
        ${demo ? '<p class="note demo-note">Esimerkkitila: kaikki tiedot ovat tekaistuja.</p>' : ''}
      </section>
      <section class="set">
        <h3>Sääennusteet</h3>
        <p class="note">Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a> (CC BY 4.0). Open-Meteon kautta käytetään malleja: ECMWF IFS, MET Norway (MET Nordic), DMI HARMONIE, DWD ICON, Météo-France, UK Met Office, NOAA GFS ja Environment Canada GEM. Yhdistelmä, sateen ajoitus, "tuntuu kuin" -lämpötila ja neuvot ovat SääÄlyn omaa laskentaa. "Tuntuu kuin" noudattaa Ilmatieteen laitoksen kaavaa.</p>
        <p class="note">Ilmatieteen laitoksen oma malli ei ole Open-Meteossa, joten sitä ei käytetä. Virallinen ennuste ja varoitukset: <a href="https://www.ilmatieteenlaitos.fi/" target="_blank" rel="noopener">ilmatieteenlaitos.fi</a>.</p>
      </section>
      <section class="set">
        <h3>Lisälähteet</h3>
        <p class="note">Nämä ovat valinnaisia: jos lähde ei vastaa tai ei kata paikkaasi, SääÄly toimii ilman sitä eikä näytä virhettä.</p>
        <ul class="plain">
          <li>Tutkaennuste (sade seuraavien kahden tunnin aikana, Pohjoismaat): <a href="https://api.met.no/weatherapi/nowcast/2.0/documentation" target="_blank" rel="noopener">MET Norway Nowcast</a>, CC BY 4.0.</li>
          <li>Viralliset säävaroitukset (Suomi): <a href="https://www.ilmatieteenlaitos.fi/varoitukset" target="_blank" rel="noopener">Ilmatieteen laitos</a>, CAP-syöte, CC BY 4.0. Koko maan syöte ladataan ja oma alueesi valitaan laitteella, joten sijaintiasi ei lähetetä.</li>
        </ul>
        ${sources.length ? `<ul class="plain src-status" aria-label="Lähteiden tila">${sources.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
      </section>
      <section class="set">
        <h3>Paikat</h3>
        <p class="note">Paikkahaku: Open-Meteo / GeoNames. Paikannimet sijainnista: BigDataCloud ja © OpenStreetMap-tekijät.</p>
      </section>
      <section class="set">
        <h3>Mihin tietosi menevät</h3>
        <ul class="plain">
          <li><b>Sijainti</b> (koordinaatit) lähtee Open-Meteolle ennusteen hakua varten, MET Norwayn tutkaennusteelle ja BigDataCloudille paikannimen hakua varten.</li>
          <li><b>Hakusanat</b> lähtevät Open-Meteon paikkahakuun.</li>
          <li><b>Gemini</b> (valinnainen): jos lisäät avaimen, kysymyksesi ja sovelluksen säädata lähetetään Googlelle. Avain tallentuu vain tämän laitteen selaimeen.</li>
          <li>Ei mainoksia, ei analytiikkaa, ei seurantaa eikä omaa palvelinta. Paikka, asetukset ja välimuisti tallentuvat vain tämän laitteen selaimeen (Tiedot-kohdasta ne voi tyhjentää).</li>
        </ul>
      </section>
      <section class="set">
        <h3>Rajoitukset</h3>
        <p class="note">Ennusteet ovat arvioita. Sadetodennäköisyys ja neuvot ovat SääÄlyn omia laskelmia, eivät viranomaisen varoituksia eivätkä lääketieteellisiä ohjeita. Mallit ovat usein samaa mieltä ja silti väärässä, esimerkiksi sumussa ja järvien tai meren vaikutuksessa.</p>
      </section>
    </div>`;
}

export const CHAT_CHIPS = ['Milloin sataa seuraavan kerran?', 'Mitä pukisin huomenna?', 'Millainen viikonloppu on tulossa?', 'Milloin on paras hetki lenkille?', 'Millainen sää on Rovaniemellä?'];

export function chatSheetHtml({ mode = 'internal', hasKey = false, hasMessages = false, chips = CHAT_CHIPS }) {
  const list = chips.map((q) => `<button class="pill" type="button" data-act="ask" data-q="${esc(q)}">${esc(q)}</button>`).join('');
  const src = MODE_INFO[hasKey ? mode : 'internal']?.label || MODE_INFO.internal.label;
  return `
    <div class="sheet-head"><h2>Kysy SääÄlyltä</h2><div class="head-actions"><button class="pill sm" id="chatClear" type="button" data-act="chat-clear" ${hasMessages ? '' : 'hidden'}>Tyhjennä</button><button class="icon-btn" type="button" data-act="close" aria-label="Sulje">${SVG.close}</button></div></div>
    <p class="chat-src">Vastaa: ${esc(src)} · <button class="linkish" type="button" data-act="open-adv">vaihda</button></p>
    <div class="sheet-scroll chat-scroll" id="msgs" role="log" aria-live="polite"></div>
    <div class="chips">${list}</div>
    <form class="composer" data-form="chat">
      <textarea id="msg" rows="1" placeholder="Kysy mitä tahansa säästä" aria-label="Viesti"></textarea>
      <button class="send" type="submit" aria-label="Lähetä">${SVG.send}</button>
    </form>`;
}

export function messageHtml(m) {
  if (m.role === 'user') return `<div class="msg user"><p>${esc(m.text)}</p></div>`;
  if (m.error) return `<div class="msg bot err"><p>${esc(m.text)}</p></div>`;
  const src = m.src ? `<div class="src">${esc(m.src)}</div>` : '';
  return `<div class="msg bot"><div class="md">${mdToHtml(m.text)}</div>${src}</div>`;
}

export const typingHtml = '<div class="msg bot typing" aria-label="SääÄly kirjoittaa"><span></span><span></span><span></span></div>';

/** Tyhjän chatin aloitus: SääÄlyn selitys nykyhetkestä ensimmäisenä viestinä. intro: { text, md, src }. */
export function chatEmptyHtml({ mode = 'internal', intro = null }) {
  const first = intro?.text ? `<div class="msg bot intro"><div class="md">${intro.md ? mdToHtml(intro.text) : `<p>${esc(intro.text)}</p>`}</div>${intro.src ? `<div class="src">${esc(intro.src)}</div>` : ''}</div>` : '';
  const note = mode === 'internal' ? 'Vastaan sovelluksen keräämän säädatan perusteella. Kysy esimerkiksi sateesta, tuulesta, pukeutumisesta, ulkoilusta tai muun paikkakunnan säästä.' : 'Gemini vastaa sovelluksen keräämän säädatan perusteella. Kysy esimerkiksi pukeutumisesta, ulkoilusta tai muun paikkakunnan säästä.';
  return `${first}<p class="note center">${note}</p>`;
}

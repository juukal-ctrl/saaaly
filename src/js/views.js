// views.js: näkymät HTML-merkkijonoina. Puhtaita funktioita: sama syöte antaa saman HTML:n.
// Kaikki dynaaminen teksti kulkee esc()-funktion kautta.

import { escapeHtml as esc, fmtTemp, fmtNum, fmtMm, windFrom, weekday, fmtDM, cap, mdToHtml, zonedToUtcMs, localNow } from './util.js';
import { SYMBOLS, nowPosition, snapshot, modelRows, confidence, describeNow, describeDay, describeHour, popText } from './blend.js';
import { icon } from './icons.js';
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

function sunLine(fc, localDate) {
  const dayStart = zonedToUtcMs(localDate + 'T00:00', fc.tz);
  const ev = sunEvents(dayStart, fc.lat, fc.lon);
  if (ev.polar === 'day') return 'Aurinko ei laske (yötön yö)';
  if (ev.polar === 'night') return 'Aurinko ei nouse (kaamos)';
  const fmt = (ms) => (ms == null ? '–' : localNow(ms, fc.tz).iso.slice(11));
  const len = dayLengthMs(ev);
  const prev = dayLengthMs(sunEvents(dayStart - 86400000, fc.lat, fc.lon));
  let txt = `${fmt(ev.rise)}–${fmt(ev.set)}`;
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

/** Sankarin yläosa: lämpötila, symboli, tila ja päivän ääriarvot. Vastauskaista tulee heti sen alle. */
export function heroHtml({ fc, nowMs }) {
  const { idx, frac, local } = nowPosition(fc, nowMs);
  const s = snapshot(fc, idx, frac);
  const day = fc.days.find((d) => d.date === local.date) || fc.days[0];
  const t = fmtTemp(s.temp);
  const feelsDiff = Math.abs(s.feels - s.temp) >= 2 ? `, tuntuu kuin ${fmtTemp(s.feels)}` : '';
  return `
    <div class="hero-main">
      <div class="temp" aria-hidden="true">${/^[+−]/.test(t) ? `<span class="t-sign">${esc(t[0])}</span>` : ''}<span class="t-num">${esc(t.replace(/^[+−]/, '').slice(0, -1))}</span><span class="t-deg">°</span></div>
      <div class="hero-icon">${icon(s.sym, s.isDay, 104)}</div>
    </div>
    <p class="sr-only">Sää nyt: ${esc(fmtTemp(s.temp))}${esc(feelsDiff)}, ${esc(SYMBOLS[s.sym].toLowerCase())}.</p>
    <div class="cond" aria-hidden="true">${esc(SYMBOLS[s.sym])}</div>
    <div class="range">Tänään ylin ${esc(fmtTemp(day.tmax))}, alin ${esc(fmtTemp(day.tmin))}</div>`;
}

/** Sankarin alaosa: tuntuu kuin, tuuli, sade, ennusteen luotettavuus, lisätiedot ja päivitysaika. */
export function heroRestHtml({ fc, nowMs, fetchedAt, loading, modelsUsed, modelsTotal }) {
  const { idx, frac, local } = nowPosition(fc, nowMs);
  const s = snapshot(fc, idx, frac);
  const conf = confidence(fc, idx);
  const gust = s.gust - s.wind >= 3 ? `<small>puuskat ${fmtNum(s.gust)} m/s</small>` : '';
  const dot = { high: 'good', mid: 'warn', low: 'bad', single: 'warn' }[conf.level];
  const rainSmall = s.precip >= 0.05 || s.pop >= 0.2 ? popText(s) : 'ei sadetta';
  const age = nowMs - fetchedAt;
  const stale = !loading && age >= STALE_MIN * 60000;
  const updated = loading ? 'Päivitetään…' : `Päivitetty ${agoText(age)}`;
  return `
    <dl class="stats">
      <div><dt>Tuntuu kuin</dt><dd>${esc(fmtTemp(s.feels))}</dd></div>
      <div><dt>Tuuli</dt><dd>${fmtNum(s.wind)} m/s<small>${esc(windFrom(s.dir))}</small>${gust}</dd></div>
      <div><dt>Sade tunnissa</dt><dd>${esc(fmtMm(s.precip))}<small>${esc(rainSmall)}</small></dd></div>
    </dl>
    <div class="meta conf">
      <span class="dot ${dot}"></span>
      <span>${esc(conf.text)} (${modelsUsed}/${modelsTotal} mallia)</span>
    </div>
    <details class="more">
      <summary><span>Lisätiedot</span>${SVG.caret}</summary>
      <dl class="stats stats-more">
        <div><dt>Kosteus</dt><dd>${Math.round(s.hum ?? 0)} %</dd></div>
        <div><dt>Ilmanpaine</dt><dd>${Math.round(s.press ?? 0)} hPa</dd></div>
        <div><dt>Pilvisyys</dt><dd>${Math.round(s.cloud)} %</dd></div>
      </dl>
      <div class="sun">${SVG.sun}<span>${esc(sunLine(fc, local.date))}</span></div>
    </details>
    <div class="meta sub${stale ? ' stale' : ''}">${esc(updated)}${stale ? ' <span class="stale-tag">vanhentunut</span>' : ''}</div>`;
}

// ---------- Huomiot ja neuvot ----------

const OWN_COVERED_BY = { thunder: /ukkos/i, gust: /tuuli|myrsky|puusk/i, storm: /tuuli|myrsky/i, rain: /sade/i, heat: /helle|kuuma/i, cold: /pakkas|kylm/i };
const SEV = { Moderate: ['yellow', 'Keltainen varoitus'], Severe: ['orange', 'Oranssi varoitus'], Extreme: ['red', 'Punainen varoitus'] };

/** Sivun yläreunan huomiokaista: viralliset varoitukset (täytetty väri) ja SääÄlyn omat huomiot (katkoviiva, neutraali). */
export function alertsHtml({ alerts = [], official = [] }) {
  const off = official.slice(0, 3);
  // Viralliset ensin. Oma huomio, jonka virallinen varoitus jo kattaa (esim. ukkonen), jätetään pois, ja rivejä on yhteensä enintään kolme,
  // ettei huomiokaista työnnä lämpötilaa ja vastauskaistaa ruudun alareunaan.
  const dup = (a) => off.some((o) => OWN_COVERED_BY[a.key]?.test(o.title || ''));
  const own = alerts.filter((a) => a.level >= 1 && !dup(a)).slice(0, 3 - off.length);
  if (!own.length && !off.length) return '';
  const offRows = off
    .map((o) => {
      const [cls, word] = SEV[o.severity] || SEV.Moderate;
      return `<details class="alert off sev-${cls}"><summary>${GLYPH.alert}<span class="a-txt"><b>${esc(word)} · ${esc(o.title)}</b><small>${esc(o.when || '')}</small></span><span class="badge">Ilmatieteen laitos</span>${SVG.caret}</summary><p>${esc(o.text || '')}</p></details>`;
    })
    .join('');
  const ownRows = own
    .map(
      (a) =>
        `<details class="alert own"><summary>${GLYPH.alert}<span class="a-txt"><b>${esc(a.title)}</b><small>${esc(a.short || '')}</small></span><span class="badge">SääÄlyn huomio</span>${SVG.caret}</summary><p>${esc(a.text)}</p><p class="fine">Oma laskenta mallidatasta, ei virallinen varoitus. <a href="https://www.ilmatieteenlaitos.fi/varoitukset" target="_blank" rel="noopener">Viralliset varoitukset</a></p></details>`,
    )
    .join('');
  return `<div class="alert-list" role="region" aria-label="Säähuomiot">${offRows}${ownRows}</div>`;
}

const ROW_GLYPH = { slippery: 'ice', wind: 'wind', uv: 'uv', frost: 'frost', fog: 'fog' };

/** Vastauskaista: takki ja sateenvarjo isoina, loput kapeina riveinä. nowcastLine: tutkaennusteen lause tai ''. */
export function verdictHtml({ v, nowcastLine = '' }) {
  const [coat, umb, ...rest] = v.chips;
  const tomorrow = v.win.kind === 'tomorrow';
  const coatSub = [coat.sub, ...(coat.extras || [])].filter(Boolean).join(' · ');
  const umbGlyph = umb.kind === 'rain' ? GLYPH.umbrella : GLYPH.snow;
  const askCoat = tomorrow ? 'Mitä pukisin huomenna?' : 'Mitä pukisin tänään?';
  const askRain = tomorrow ? 'Sataako huomenna?' : 'Sataako tänään?';
  const rows = rest
    .map((c) => `<li class="vrow ${esc(c.level)}">${GLYPH[ROW_GLYPH[c.key]] || SVG.info}<span><b>${esc(c.text)}</b>${c.sub ? `<small>${esc(c.sub)}</small>` : ''}</span></li>`)
    .join('');
  return `
    <div class="row between v-head"><h2 class="label">Mitä päälle ja mukaan</h2><span class="tag">${esc(v.win.caption)}</span></div>
    ${nowcastLine ? `<p class="vnow" role="status" aria-live="polite">${GLYPH.radar}<span>${esc(nowcastLine)}</span></p>` : ''}
    <div class="vgrid">
      <button class="vcell coat" type="button" data-act="ask-open" data-q="${esc(askCoat)}">${GLYPH.coat}<span><b>${esc(coat.text)}</b><small>${esc(coatSub)}</small></span></button>
      <button class="vcell umb ${esc(umb.level)}" type="button" data-act="ask-open" data-q="${esc(askRain)}">${umbGlyph}<span><b>${esc(umb.text)}</b><small>${esc(umb.sub)}</small></span></button>
    </div>
    ${rows ? `<ul class="vrows">${rows}</ul>` : ''}
    <p class="fine">SääÄlyn oma arvio mallidatasta, ei virallinen ohje.</p>`;
}

// ---------- Tekoälykortti ----------

export function selectionLines(fc, sel, nowMs) {
  if (sel.type === 'hour') {
    const i = fc.hours.findIndex((h) => h.t === sel.iso);
    return i < 0 ? [] : describeHour(fc, i);
  }
  if (sel.type === 'day') return describeDay(fc, sel.date, nowMs);
  return describeNow(fc, nowMs);
}

export function aiHtml({ fc, nowMs, sel, ai, hasKey, mode = 'internal' }) {
  const lines = selectionLines(fc, sel, nowMs);
  const internal = mode === 'internal';
  let body;
  let tag;
  let action = '';
  if (!internal && ai.status === 'done' && ai.text) {
    body = `<div class="md">${mdToHtml(ai.text)}</div>`;
    tag = 'Tekoäly (Gemini)';
    action = `<button class="pill" data-act="ai-run" type="button">${SVG.refresh}Päivitä</button>`;
  } else {
    body = `<p>${esc(lines.join(' '))}</p>`;
    if (internal) tag = `Sovelluksen oma laskenta · ${fc.modelsUsed}/${fc.modelsTotal} mallia`;
    else if (ai.status === 'loading') tag = 'Tekoäly kirjoittaa selitystä…';
    else if (ai.status === 'error') tag = 'Tekoälyn selitys ei onnistunut';
    else tag = 'Laskennallinen yhteenveto';
    if (internal) action = hasKey ? `<button class="pill" data-act="mode-on" type="button">${SVG.spark}Ota Gemini käyttöön</button>` : `<button class="pill" data-act="open-settings" type="button">${SVG.spark}Lisää Gemini-avain</button>`;
    else if (ai.status !== 'loading') action = `<button class="pill" data-act="ai-run" type="button">${SVG.spark}${ai.status === 'error' ? 'Yritä uudelleen' : 'Selitä tekoälyllä'}</button>`;
  }
  const err = !internal && ai.status === 'error' ? `<p class="warn-text" role="alert">${esc(ai.error)}</p>` : '';
  const chip =
    sel.type === 'now'
      ? '<span class="chip-sm">nyt</span>'
      : `<button class="chip-sm active" data-act="now" type="button" aria-label="Palaa nykyhetkeen">${esc(selLabel(sel))}${SVG.close}</button>`;
  return `
    <div class="row between"><h2 class="label">SääÄly kertoo</h2>${chip}</div>
    <div class="ai-text ${!internal && ai.status === 'loading' ? 'busy' : ''}">${body}${err}</div>
    <div class="row between ai-foot"><span class="tag">${esc(tag)}</span>${action}</div>`;
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
  const mg = meteogram(hours, { range: r, width, nowFrac: frac, icon, night: nightSpans(hours), inspectIso, compact, uid: 'mg' });
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
    <div class="mg-head"><h2 class="label">Sääkaavio</h2><div class="modebar mg-seg" role="group" aria-label="Kaavion aikaväli">${seg}</div></div>
    <div class="mg-wrap" id="mgWrap" tabindex="0" role="slider" aria-label="Tarkastele sääkaaviota nuolinäppäimillä tai koskettamalla" aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="${n - 1}" aria-valuenow="${sel ?? 0}" aria-valuetext="${esc(ro ? ro.aria : mg.summary)}" data-w="${mg.width}" data-n="${n}" data-range="${r}">${mg.svg}</div>
    <p class="mg-read" id="mgRead">${readText}</p>
    <p class="mg-legend">Viiva: lämpötila · vaalea alue: mallien vaihteluväli · palkit: sade mm/${r === '7d' ? '3 h' : 'h'} · nuolet: tuulen suunta ja m/s</p>
    <details class="mg-table"><summary>Kaavio taulukkona</summary><div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col">Aika</th><th scope="col">Lämpö</th><th scope="col">Sää</th><th scope="col">Sade</th><th scope="col">Tuuli</th></tr></thead><tbody>${rows.join('')}</tbody></table></div></details>`;
}

// ---------- Tunnit ja päivät ----------

export function hourlyHtml({ fc, nowMs, sel }) {
  const { idx } = nowPosition(fc, nowMs);
  const cells = fc.hours.slice(idx, idx + 48).map((h, i) => {
    const date = h.t.slice(0, 10);
    const first = i === 0;
    const flag = first || hh(h.t) === '00' ? weekday(date) : '';
    const pressed = first ? sel.type === 'now' : sel.type === 'hour' && sel.iso === h.t;
    const act = first ? 'now' : 'hour';
    const p = h.precip >= 0.1 ? fmtMm(h.precip).replace(' mm', '') : '';
    return `<button class="hr" type="button" data-act="${act}" data-iso="${esc(h.t)}" aria-pressed="${pressed}" aria-label="${esc(`${weekday(date)} klo ${hh(h.t)}, ${SYMBOLS[h.sym]}, ${fmtTemp(h.temp)}`)}">
      <span class="hr-d">${esc(flag)}</span><span class="hr-t">${first ? 'Nyt' : hh(h.t)}</span>${icon(h.sym, h.isDay, 30)}
      <span class="hr-temp">${esc(fmtTemp(h.temp))}</span><span class="hr-p">${p ? esc(p) + ' mm' : ''}</span></button>`;
  });
  return `<h2 class="label">Seuraavat tunnit</h2><div class="strip" id="strip">${cells.join('')}</div>`;
}

export function dailyHtml({ fc, nowMs, sel }) {
  const today = nowPosition(fc, nowMs).local.date;
  const days = fc.days.slice(0, 7);
  const lo = Math.min(...days.map((d) => d.tmin));
  const hi = Math.max(...days.map((d) => d.tmax));
  const span = hi - lo || 1;
  const rows = days.map((d) => {
    const left = ((d.tmin - lo) / span) * 100;
    const width = Math.max(5, ((d.tmax - d.tmin) / span) * 100);
    const label = d.date === today ? 'Tänään' : `${weekday(d.date)} ${fmtDM(d.date)}`;
    const pressed = sel.type === 'day' && sel.date === d.date;
    return `<button class="day" type="button" data-act="day" data-date="${esc(d.date)}" aria-pressed="${pressed}" aria-label="${esc(`${label}, ${SYMBOLS[d.sym]}, ylin ${fmtTemp(d.tmax)}, alin ${fmtTemp(d.tmin)}`)}">
      <span class="day-n">${esc(label)}</span>${icon(d.sym, true, 30)}
      <span class="rng"><span class="lo">${esc(fmtTemp(d.tmin))}</span><span class="track"><span class="fill" style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%"></span></span><span class="hi">${esc(fmtTemp(d.tmax))}</span></span>
      <span class="day-p">${d.precip >= 0.1 ? esc(fmtMm(d.precip)) : '–'}</span></button>`;
  });
  return `<h2 class="label">${days.length} päivän ennuste</h2><div class="days">${rows.join('')}</div>`;
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
      <summary><span class="label">Mallivertailu</span><span class="sum">${fc.modelsUsed}/${fc.modelsTotal} mallia, hajonta nyt ${fmtNum(s.spread, 1)}°</span>${SVG.caret}</summary>
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

export function settingsSheetHtml({ hasKey, mode = 'internal', model, refreshMin, models, demo, sens = 0, anim = true }) {
  const opts = [5, 10, 15, 30].map((m) => `<option value="${m}" ${m === refreshMin ? 'selected' : ''}>${m} min</option>`).join('');
  const datalist = (models || []).map((m) => `<option value="${esc(m)}"></option>`).join('');
  return `
    <div class="sheet-head"><h2>Asetukset</h2><button class="icon-btn" type="button" data-act="close" aria-label="Sulje">${SVG.close}</button></div>
    <div class="sheet-scroll">
      ${demo ? '<p class="note demo-note">Esimerkkitila: sää, paikkahaku ja nimet ovat tekaistuja, eikä Gemini ole käytössä. Chat vastaa silti sovelluksen omalla laskennalla.</p>' : ''}
      <section class="set">
        <h3>Vastausten lähde</h3>
        <p class="note">Valitse, mistä chatin vastaukset ja tekoälykortin selitykset tulevat.</p>
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
        <h3>Pukeutuminen</h3>
        <p class="note">Vastauskaista ja chat arvioivat pukeutumisen "tuntuu kuin" -lämpötilasta. Säädä, jos palelet helposti tai kestät kylmää hyvin.</p>
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
        <h3>Diagnostiikka</h3>
        <p class="note">Tarkistaa, vastaako jokainen säämalli ja palvelu. Jos jokin ei toimi, kopioi raportti ja lähetä se kehittäjälle.</p>
        <div class="inline"><button class="btn" type="button" data-act="diag">Aja diagnostiikka</button><button class="btn ghost" type="button" data-act="diag-copy">Kopioi raportti</button></div>
        <pre id="diag" class="diag" aria-live="polite"></pre>
      </section>
      <section class="set">
        <h3>Tiedot</h3>
        <div class="inline"><button class="btn ghost" type="button" data-act="open-about">Tietoja ja tietolähteet</button><button class="btn ghost" type="button" data-act="wipe">Tyhjennä tallennetut tiedot</button></div>
      </section>
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

export const CHAT_CHIPS = ['Mitä pukisin tänään?', 'Sataako huomenna?', 'Milloin on paras hetki lenkille?', 'Mitä mallit ennustavat huomiselle?', 'Millainen sää on Rovaniemellä?'];

export function chatSheetHtml({ mode = 'internal', hasKey = false, hasMessages = false }) {
  const chips = CHAT_CHIPS.map((q) => `<button class="pill" type="button" data-act="ask" data-q="${esc(q)}">${esc(q)}</button>`).join('');
  return `
    <div class="sheet-head"><h2>Kysy SääÄlyltä</h2><div class="head-actions"><button class="pill sm" id="chatClear" type="button" data-act="chat-clear" ${hasMessages ? '' : 'hidden'}>Tyhjennä</button><button class="icon-btn" type="button" data-act="close" aria-label="Sulje">${SVG.close}</button></div></div>
    ${modeSwitchHtml({ mode, hasKey })}
    <div class="sheet-scroll chat-scroll" id="msgs" aria-live="polite"></div>
    <div class="chips">${chips}</div>
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

export function chatEmptyHtml({ mode = 'internal' }) {
  if (mode === 'internal') return '<p class="note center">Vastaan sovelluksen keräämän säädatan perusteella: yhdistelmäennusteen ja yksittäisten säämallien lukujen avulla. Kysy esimerkiksi sateesta, tuulesta, pukeutumisesta, ulkoilusta tai muun paikkakunnan säästä.</p>';
  if (mode === 'free') return '<p class="note center">Gemini vastaa sovelluksen keräämän säädatan perusteella ja voi käyttää lisäksi yleistietoa ilmiöiden selittämiseen. Kysy esimerkiksi pukeutumisesta, ulkoilusta tai muun paikkakunnan säästä.</p>';
  return '<p class="note center">Gemini vastaa vain sovelluksen keräämän säädatan perusteella. Kysy esimerkiksi pukeutumisesta, ulkoilusta tai muun paikkakunnan säästä.</p>';
}

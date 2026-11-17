// warnings.js: Ilmatieteen laitoksen viralliset säävaroitukset (CAP 1.2 -syöte, alerts.fmi.fi).
// Selain ei voi hakea syötettä suoraan, koska palvelu ei salli sitä (CORS). Siksi GitHub Actions hakee syötteen itse (tools/mirror-warnings.mjs),
// tiivistää sen ja tallentaa repon haaraan warnings-data, josta sovellus lukee sen (MIRROR_URL). Syöte on koko Suomen kattava:
// vaikuttavat varoitukset valitaan laitteella pisteen ja monikulmion leikkauksella, joten sijaintia ei lähetetä mihinkään.
// Lähde on lisä: jos peili ei vastaa tai on vanhentunut, sovellus ei näytä virhettä (sources.js).
// Atom-syötteen CAP voi olla upotettuna, tekstinä <content>-elementin sisällä tai vain linkkinä; kaikki kolme tuetaan (peilityökalu käyttää näitä).
// XML luetaan pienellä omalla jäsentimellä (DOMParser ei ole Nodessa, ja jäsentimen pitää olla testattavissa ilman selainta).

import { defaultFetch, localNow } from './util.js';
import { timedRequest } from './sources.js';

export const MIRROR_URL = 'https://raw.githubusercontent.com/juukal-ctrl/saaaly/warnings-data/warnings.json';
export const FMI_WARNINGS_PAGE = 'https://www.ilmatieteenlaitos.fi/varoitukset';
const MAX_XML = 16_000_000; // oikea syöte sisältää kolmikielisiä monikulmioita ja voi olla useita megatavuja
const MAX_DEPTH = 64;

// ---------- XML ----------

const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENT[e] ?? m;
  });
const local = (name) => name.slice(name.indexOf(':') + 1); // nimiavaruuden etuliite pois: cap:alert -> alert
const TOKEN = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?][^\s/>]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)|(<)/g;
const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Pieni toleranssi XML-jäsennin: elementit, attribuutit, teksti, CDATA. Palauttaa { name, attrs, kids, text }-puun. Heittää, jos rakenne on rikki. */
export function parseXml(src) {
  if (typeof src !== 'string' || src.length > MAX_XML) throw new Error('XML ei jäsenny');
  const root = { name: '#root', attrs: {}, kids: [], text: '' };
  const stack = [root];
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2] !== undefined) {
      if (stack.length < 2 || top.name !== local(m[2])) throw new Error('XML ei jäsenny');
      stack.pop();
    } else if (m[3] !== undefined) {
      const attrs = {};
      for (const a of m[4].matchAll(ATTR)) attrs[local(a[1])] = decode(a[2] ?? a[3] ?? '');
      const node = { name: local(m[3]), attrs, kids: [], text: '' };
      top.kids.push(node);
      if (!m[5]) {
        if (stack.length > MAX_DEPTH) throw new Error('XML ei jäsenny');
        stack.push(node);
      }
    } else if (m[6] !== undefined) top.text += decode(m[6]);
    else if (m[7] !== undefined) throw new Error('XML ei jäsenny');
  }
  if (stack.length !== 1 || !root.kids.length) throw new Error('XML ei jäsenny'); // tyhjä vastaus ei ole kelvollinen syöte
  return root;
}

const kids = (n, name) => n.kids.filter((k) => k.name === name);
const kid = (n, name) => n.kids.find((k) => k.name === name);
const txt = (n, name) => (kid(n, name)?.text || '').trim();
function findAll(n, name, out = []) {
  for (const k of n.kids) {
    if (k.name === name) out.push(k);
    findAll(k, name, out);
  }
  return out;
}

// ---------- CAP ----------

const parsePoly = (text) =>
  text
    .trim()
    .split(/\s+/)
    .map((pt) => pt.split(',').map(Number))
    .filter((p) => p.length === 2 && p.every(Number.isFinite)); // [lat, lon]

function alertNodes(root) {
  const alerts = findAll(root, 'alert');
  if (alerts.length) return alerts;
  // CAP voi olla Atom-merkinnän sisällä tekstinä (&lt;alert …&gt;)
  const out = [];
  for (const c of [...findAll(root, 'content'), ...findAll(root, 'summary')]) {
    const s = c.text.trim();
    if (!s.startsWith('<')) continue;
    try {
      out.push(...findAll(parseXml(s), 'alert'));
    } catch {
      /* yksi huono merkintä ei kaada muita */
    }
  }
  return out;
}

/** CAP-varoitukset (Atom-syötteestä tai yksittäisestä CAP-tiedostosta) litteiksi riveiksi yhdellä kielellä. Ei sisällä peruttuja, korvattuja eikä testiviestejä. */
export function parseCapAlerts(xml, lang = 'fi-FI') {
  return capFromRoot(parseXml(xml), lang);
}

function capFromRoot(root, lang) {
  const nodes = alertNodes(root);
  const replaced = new Set(); // Cancel ja Update viittaavat aiempaan viestiin (references: "lähettäjä,tunniste,aika")
  for (const a of nodes) {
    const type = txt(a, 'msgType');
    if (type === 'Cancel' || type === 'Update') for (const r of txt(a, 'references').split(/\s+/)) if (r.split(',')[1]) replaced.add(r.split(',')[1]);
  }
  const out = [];
  const seen = new Set();
  for (const a of nodes) {
    const id = txt(a, 'identifier');
    if (txt(a, 'msgType') === 'Cancel' || replaced.has(id) || (id && seen.has(id))) continue;
    const status = txt(a, 'status');
    if (status && status !== 'Actual') continue; // Test, Exercise, Draft
    const infos = kids(a, 'info');
    const info = infos.find((i) => txt(i, 'language') === lang) || infos[0];
    if (!info) continue;
    if (id) seen.add(id);
    const params = Object.fromEntries(kids(info, 'parameter').map((p) => [txt(p, 'valueName'), txt(p, 'value')]));
    out.push({
      id,
      event: txt(info, 'event'),
      severity: txt(info, 'severity'),
      color: params.color || '',
      headline: txt(info, 'headline'),
      description: txt(info, 'description'),
      instruction: txt(info, 'instruction'),
      onset: Date.parse(txt(info, 'onset') || txt(info, 'effective') || txt(a, 'sent')),
      expires: Date.parse(txt(info, 'expires')),
      areas: kids(info, 'area').map((ar) => ({ desc: txt(ar, 'areaDesc'), polys: kids(ar, 'polygon').map((p) => parsePoly(p.text)).filter((r) => r.length >= 3) })),
    });
  }
  return out;
}

/** Atom-syöte: { alerts, links }. links on CAP-tiedostojen osoitteet silloin, kun merkinnät vain viittaavat niihin. */
export function parseCapFeed(xml, lang = 'fi-FI') {
  const root = parseXml(xml);
  const alerts = capFromRoot(root, lang);
  const links = [];
  for (const entry of findAll(root, 'entry')) {
    for (const l of kids(entry, 'link')) {
      const href = l.attrs.href || '';
      if (/^https:\/\//.test(href) && (/cap/i.test(l.attrs.type || '') || /\.xml$/i.test(href)) && !links.includes(href)) links.push(href);
    }
  }
  return { alerts, links };
}

/** Syöte koskee vain Suomea (ja sen merialueita): muualla ei haeta eikä näytetä mitään. */
export const inFinland = (lat, lon) => lat >= 59.4 && lat <= 70.2 && lon >= 19 && lon <= 32;

/** Säteenheitto-testi [lat, lon] -pisteistä koostuvalle renkaalle. */
export function inPoly(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Voimassa olevat varoitukset, joiden alueeseen piste kuuluu. */
export const warningsAt = (list, lat, lon, now = Date.now()) => list.filter((w) => w.expires > now && w.areas.some((a) => a.polys.some((r) => inPoly(lat, lon, r))));

// ---------- Näkymälle ----------

const WD = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];
const TZ = 'Europe/Helsinki';
const stamp = (ms) => {
  const l = localNow(ms, TZ);
  const [y, m, d] = l.date.split('-').map(Number);
  return { date: l.date, hour: l.hour, label: `${WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}.${m}.` };
};

/** "voimassa nyt, päättyy tänään klo 18" / "huomenna klo 06–12" / "ti 17.11. klo 22 – ke 18.11. klo 08" */
export function whenText(onset, expires, nowMs) {
  const today = stamp(nowMs).date;
  const tomorrow = stamp(nowMs + 86400000).date;
  const day = (s) => (s.date === today ? 'tänään' : s.date === tomorrow ? 'huomenna' : s.label);
  const b = stamp(expires);
  if (!(onset > nowMs)) return `voimassa nyt, päättyy ${day(b)} klo ${b.hour}`;
  const a = stamp(onset);
  if (a.date === b.date) return `${day(a)} klo ${a.hour}–${b.hour}`;
  return `${day(a)} klo ${a.hour} – ${day(b)} klo ${b.hour}`;
}

const RANK = { Extreme: 3, Severe: 2, Moderate: 1 };
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Varoitukset alertsHtml-rivien muotoon ({severity, title, when, text}): vain voimassa olevat ja seuraavan 48 tunnin sisällä alkavat, vakavin ensin. */
export function officialRows(list, lat, lon, nowMs, max = 3) {
  return warningsAt(list, lat, lon, nowMs)
    .filter((w) => RANK[w.severity] && !(w.onset > nowMs + 48 * 3600000)) // Minor ja tuntematon eivät ole varoituksia
    .sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.onset - b.onset)
    .slice(0, max)
    .map((w) => {
      const area = w.areas.find((a) => a.polys.some((r) => inPoly(lat, lon, r)))?.desc || '';
      return {
        id: w.id,
        severity: w.severity,
        title: w.event || w.headline || 'Säävaroitus',
        when: [area, whenText(w.onset, w.expires, nowMs)].filter(Boolean).join(' · '),
        text: clip([w.description, w.instruction].filter(Boolean).join(' '), 600),
      };
    });
}

// ---------- Peili ----------

const MIRROR_VERSION = 1;
const MIRROR_MAX_AGE = 6 * 3600000; // tätä vanhempaa peiliä ei käytetä: varoitus on voinut tulla sen jälkeen
const MAX_JSON = 2_000_000;
const MAX_ALERTS = 200;
const MAX_AREAS = 40;
const MAX_POLYS = 40;
const MAX_RING = 5000;
const SEVERITIES = new Set(['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown']);
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const r3 = (n) => Math.round(n * 1000) / 1000; // 0,001 asteen tarkkuus (noin 100 m) riittää varoitusalueille ja pienentää tiedostoa

/** Tiivis, selaimelle sopiva muoto: sama kuin parseCapFeedin rivit, mutta pyöristetyin koordinaatein ja lyhennetyin tekstein. */
export function buildMirror(alerts, nowMs = Date.now()) {
  const slim = (a) => ({
    id: str(a.id, 120),
    event: str(a.event, 120),
    severity: a.severity,
    color: str(a.color, 20),
    headline: str(a.headline, 200),
    description: str(a.description, 800),
    instruction: str(a.instruction, 800),
    onset: Number.isFinite(a.onset) ? a.onset : null,
    expires: a.expires,
    areas: a.areas.map((ar) => ({ desc: str(ar.desc, 120), polys: ar.polys.map((ring) => ring.map(([la, lo]) => [r3(la), r3(lo)])) })),
  });
  return {
    v: MIRROR_VERSION,
    source: 'alerts.fmi.fi',
    fetchedAt: new Date(nowMs).toISOString(),
    alerts: alerts
      .filter((a) => Number.isFinite(a.expires) && a.expires > nowMs - 3600000 && a.areas.length)
      .sort((a, b) => (RANK[b.severity] || 0) - (RANK[a.severity] || 0) || (a.onset || 0) - (b.onset || 0))
      .slice(0, MAX_ALERTS) // vakavimmat säilyvät, jos varoituksia on poikkeuksellisen paljon
      .map(slim),
  };
}

function cleanRing(r) {
  if (!Array.isArray(r) || r.length < 3 || r.length > MAX_RING) return null;
  for (const p of r) {
    // Suomi ja sen merialueet; muu kertoo rikkinäisestä tai väärästä aineistosta
    if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'number' || typeof p[1] !== 'number' || !(p[0] >= 50 && p[0] <= 75 && p[1] >= 10 && p[1] <= 40)) return null;
  }
  return r.map(([la, lo]) => [la, lo]);
}

const fmtStamp = (ms) => {
  const t = stamp(ms);
  return `${t.label} klo ${t.hour}`;
};

/**
 * Tarkistaa peilin ja palauttaa { ok:true, alerts, fetchedAt, note } tai { ok:false, reason }, kun peili on liian vanha.
 * Heittää, jos muoto ei täsmää. Aineisto ei ole luotettua: jokainen kenttä tarkistetaan ja rajataan, jotta rikkinäinen tiedosto ei kaada näkymää.
 */
export function parseMirror(data, nowMs = Date.now()) {
  if (!data || typeof data !== 'object' || data.v !== MIRROR_VERSION || !Array.isArray(data.alerts)) throw new Error('Varoitukset: peilin muoto ei täsmää');
  const at = Date.parse(data.fetchedAt);
  if (!Number.isFinite(at)) throw new Error('Varoitukset: peilin aikaleima puuttuu');
  if (nowMs - at > MIRROR_MAX_AGE) return { ok: false, reason: `peili on vanhentunut (päivitetty ${fmtStamp(at)})` };
  const alerts = [];
  for (const a of data.alerts.slice(0, MAX_ALERTS)) {
    if (!a || typeof a !== 'object' || typeof a.expires !== 'number' || !Number.isFinite(a.expires)) continue;
    const areas = (Array.isArray(a.areas) ? a.areas : [])
      .slice(0, MAX_AREAS)
      .map((ar) => ({ desc: str(ar?.desc, 120), polys: (Array.isArray(ar?.polys) ? ar.polys : []).slice(0, MAX_POLYS).map(cleanRing).filter(Boolean) }))
      .filter((ar) => ar.polys.length);
    if (!areas.length) continue;
    alerts.push({
      id: str(a.id, 120),
      event: str(a.event, 120),
      severity: SEVERITIES.has(a.severity) ? a.severity : '',
      color: str(a.color, 20),
      headline: str(a.headline, 200),
      description: str(a.description, 800),
      instruction: str(a.instruction, 800),
      onset: typeof a.onset === 'number' && Number.isFinite(a.onset) ? a.onset : 0,
      expires: a.expires,
      areas,
    });
  }
  return { ok: true, alerts, fetchedAt: at, note: `${alerts.length} voimassa tai tulossa koko maassa, peili päivitetty ${fmtStamp(at)}` };
}

// ---------- Haku ----------

/**
 * Hakee peilin ja palauttaa { ok:true, alerts, fetchedAt, note } (tai { ok:false, reason }, kun peili on vanhentunut).
 * Heittää verkko-, HTTP- ja rakennevirheistä (kutsuja suojaa ne sources.js:llä). Ei lisää omia otsikoita, joten CORS-esitarkistusta ei tarvita.
 */
export async function fetchWarnings({ fetchFn = defaultFetch, timeoutMs = 8000, signal = null, now = Date.now() } = {}) {
  const opts = { timeoutMs, signal, label: 'Varoitukset' };
  const text = (res) => {
    if (!res.ok) throw Object.assign(new Error(res.status === 404 ? 'Varoitukset: peiliä ei löytynyt (GitHub Actions -ajo ei ole vielä luonut sitä)' : `Varoitukset: HTTP ${res.status}`), { status: res.status });
    return res.text();
  };
  const body = await timedRequest(fetchFn, MIRROR_URL, {}, opts, text);
  if (body.length > MAX_JSON) throw new Error('Varoitukset: peili on liian suuri');
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error('Varoitukset: peili ei ole luettavaa JSONia');
  }
  return parseMirror(data, now);
}

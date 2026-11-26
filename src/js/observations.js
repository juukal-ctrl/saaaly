// observations.js: lähimmän Ilmatieteen laitoksen havaintoaseman mitattu lämpötila (avoin data, WFS-latauspalvelu, CC BY 4.0).
// Havainto on vertailukohta ennusteelle: Varmuus-sivu näyttää, kuinka lähellä SääÄlyn "nyt"-arvo on mitattua.
// Lähde on lisä. Jos palvelu ei vastaa, ei salli selaimen hakua tai lähellä ei ole asemaa, mitään ei näytetä (sources.js).

import { parseXml } from './warnings.js';
import { timedRequest } from './sources.js';
import { defaultFetch } from './util.js';

export const OBS_BASE = 'https://opendata.fmi.fi/wfs';
const MAX_TEXT = 2_000_000;
const MAX_KM = 35; // tätä kauempana oleva asema ei kuvaa paikan säätä

/** Hakuosoite: viimeisen tunnin lämpötila kymmenen minuutin välein lähimmältä asemalta. */
export function obsUrl(lat, lon, nowMs = Date.now()) {
  const start = new Date(nowMs - 70 * 60000).toISOString().slice(0, 16) + ':00Z';
  const q = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'getFeature',
    storedquery_id: 'fmi::observations::weather::timevaluepair',
    latlon: `${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}`, // noin 1 km:n tarkkuus kuten muissa lähteissä; lähin asema löytyy silti
    maxlocations: '1',
    parameters: 't2m',
    timestep: '10',
    starttime: start,
  });
  return `${OBS_BASE}?${q.toString()}`;
}

function walk(n, fn) {
  for (const k of n.kids) {
    fn(k);
    walk(k, fn);
  }
}

const km = (a, b, c, d) => {
  const R = 6371;
  const dLat = ((c - a) * Math.PI) / 180;
  const dLon = ((d - b) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a * Math.PI) / 180) * Math.cos((c * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

/**
 * Jäsentää WFS-vastauksen (timevaluepair). Palauttaa { name, lat, lon, t, value } viimeisimmästä arvosta, joka ei ole NaN, tai null.
 * Aineisto ei ole luotettua: arvot tarkistetaan ja rajataan.
 */
export function parseObs(xml) {
  const root = parseXml(xml);
  let name = '';
  let pos = null;
  const pts = [];
  walk(root, (n) => {
    if (n.name === 'name' && !name && /locationcode\/name/.test(n.attrs.codeSpace || '')) name = n.text.trim().slice(0, 60);
    if (n.name === 'pos' && !pos) {
      const p = n.text.trim().split(/\s+/).map(Number);
      if (p.length >= 2 && p.every(Number.isFinite)) pos = p;
    }
    if (n.name === 'MeasurementTVP') {
      const t = Date.parse((n.kids.find((k) => k.name === 'time')?.text || '').trim());
      const v = Number((n.kids.find((k) => k.name === 'value')?.text || '').trim());
      if (Number.isFinite(t) && Number.isFinite(v) && v > -60 && v < 50) pts.push({ t, v });
    }
  });
  if (!pts.length) return null;
  pts.sort((a, b) => a.t - b.t);
  const last = pts.at(-1);
  return { name, lat: pos ? pos[0] : null, lon: pos ? pos[1] : null, t: last.t, value: last.v };
}

/** Hakee havainnon. { ok:true, name, value, t, km, note } tai { ok:false, reason } (ei asemaa lähellä). Heittää verkko- ja muotovirheistä. */
export async function fetchObs(lat, lon, { fetchFn = defaultFetch, now = Date.now(), timeoutMs = 8000, signal = null } = {}) {
  const text = await timedRequest(fetchFn, obsUrl(lat, lon, now), {}, { timeoutMs, signal, label: 'Havainto' }, (res) => {
    if (!res.ok) throw new Error(`Havainto: HTTP ${res.status}`);
    return res.text();
  });
  if (text.length > MAX_TEXT) throw new Error('Havainto: vastaus on liian suuri');
  const o = parseObs(text);
  if (!o) return { ok: false, reason: 'ei havaintoa viimeisen tunnin ajalta' };
  const dist = o.lat != null ? km(lat, lon, o.lat, o.lon) : null;
  if (dist != null && dist > MAX_KM) return { ok: false, reason: `lähin asema ${Math.round(dist)} km päässä` };
  if (now - o.t > 90 * 60000) return { ok: false, reason: 'havainto on vanha' };
  return { ok: true, ...o, km: dist, note: `${o.name || 'asema'}${dist != null ? `, ${Math.round(dist)} km` : ''}` };
}

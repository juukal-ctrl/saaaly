// nowcast.js: tutkapohjainen lähiennuste seuraavalle kahdelle tunnille (MET Norway Nowcast 2.0, kattaa Pohjoismaat).
// "Koodi laskee": sadeintensiteetit tulkitaan täällä, ja neuvokaista, chat ja (myöhemmin) widget käyttävät samaa tulosta.
// Lähde on lisä. Jos se ei vastaa, ei kata paikkaa tai on vanhentunut, sovellus toimii kuten ennenkin eikä näytä virhettä.
// Selaimesta ei voi asettaa User-Agent-otsikkoa, eikä CORS-tukea voi varmistaa tästä ympäristöstä: siksi haku on aina suojattu (sources.js).

import { defaultFetch } from './util.js';
import { timedRequest } from './sources.js';

export const NOWCAST_BASE = 'https://api.met.no/weatherapi/nowcast/2.0/complete';

/** Tätä pienempi sadeintensiteetti (mm/h) on tutkakohinaa eikä kerro sateesta. */
export const WET_MMH = 0.2;
/** Tätä vanhempaa ennustetta ei käytetä: lähiennuste vanhenee nopeasti. */
export const STALE_MIN = 30;
const DEFAULT_STEP_MS = 5 * 60000;

export function nowcastUrl(lat, lon) {
  const q = new URLSearchParams({ lat: Number(lat).toFixed(2), lon: Number(lon).toFixed(2) }); // 2 desimaalia riittää tutkalle (1 km ruudukko)
  return `${NOWCAST_BASE}?${q.toString()}`;
}

/**
 * Jäsentää MET:n vastauksen. Palauttaa { ok:false, reason } kun tutka ei kata paikkaa tai on pois käytöstä,
 * ja { ok:true, updated, steps:[{t, rate}] } muuten. Heittää vain, jos rakenne on odottamaton (silloin lähde merkitään epäonnistuneeksi).
 */
export function parseNowcast(json) {
  const props = json?.properties;
  if (!props || !Array.isArray(props.timeseries)) throw new Error('Tutkaennusteen rakenne ei vastaa odotettua');
  const coverage = String(props.meta?.radar_coverage ?? 'ok').toLowerCase();
  if (coverage !== 'ok') return { ok: false, reason: coverage === 'no coverage' ? 'ei tutkakattavuutta' : 'tutka ei käytettävissä', coverage };
  const steps = [];
  for (const row of props.timeseries) {
    const t = Date.parse(row?.time);
    const rate = row?.data?.instant?.details?.precipitation_rate;
    // null ei saa muuttua nollaksi: puuttuva arvo on "ei tietoa", ei "kuivaa"
    if (Number.isFinite(t) && typeof rate === 'number' && Number.isFinite(rate)) steps.push({ t, rate: Math.max(0, rate) });
  }
  steps.sort((a, b) => a.t - b.t);
  if (steps.length < 3) throw new Error('Tutkaennusteessa ei ole sadearvioita');
  const updated = Date.parse(props.meta?.updated_at);
  return { ok: true, coverage, updated: Number.isFinite(updated) ? updated : steps[0].t, steps };
}

function stepMs(steps) {
  const d = [];
  for (let i = 1; i < steps.length; i++) d.push(steps[i].t - steps[i - 1].t);
  d.sort((a, b) => a - b);
  const m = d.length ? d[Math.floor(d.length / 2)] : DEFAULT_STEP_MS;
  return m >= 60000 && m <= 30 * 60000 ? m : DEFAULT_STEP_MS;
}

const round5 = (min) => Math.max(0, Math.round(min / 5) * 5);

/** Sateen voimakkuus suomeksi (mm/h): heikkoa, kohtalaista, runsasta, rankkaa. */
export function intensityWord(mmh) {
  if (mmh < 0.5) return 'heikkoa';
  if (mmh < 4) return 'kohtalaista';
  if (mmh < 8) return 'runsasta';
  return 'rankkaa';
}

// "seuraavaan 2 tuntiin" (illatiivi) ja "seuraavat 2 tuntia" (partitiivi)
function horizonPhrase(min) {
  if (min >= 105) return { into: '2 tuntiin', for: '2 tuntia' };
  if (min >= 50) return { into: 'tuntiin', for: 'tunnin' };
  const m = Math.max(5, round5(min));
  return { into: `${m} minuuttiin`, for: `${m} minuuttia` };
}

/**
 * Tulkitsee jäsennetyn tutkaennusteen hetkelle nowMs. Kutsutaan uudelleen jokaisella piirrolla, jotta "15 min päästä" laskee itsestään.
 * Palauttaa { ok:false, reason } tai
 * { ok:true, state:'dry'|'wet', startMin, endMin, horizonMin, peak, mm, word, tail, line, updated }.
 *   tail: lauseenosa ilman alkua ("sade alkaa noin 15 min päästä"), line: valmis lause näkymälle.
 *   dry: startMin = sateen alkuun (null, jos ei sadetta ennustejaksolla)
 *   wet: endMin = sateen loppuun (null, jos sade jatkuu koko ennustejakson)
 * Yksittäinen märkä askel ei riitä (kohina): sateen pitää kestää vähintään kaksi peräkkäistä askelta tai olla yli 1 mm/h.
 */
export function summarizeNowcast(nc, nowMs = Date.now()) {
  if (!nc) return { ok: false, reason: 'ei tietoa' };
  if (nc.ok === false) return { ok: false, reason: nc.reason || 'ei tietoa' };
  const steps = nc.steps;
  if (!Array.isArray(steps) || steps.length < 3) return { ok: false, reason: 'ei tietoa' };
  const dt = stepMs(steps);
  const endT = steps[steps.length - 1].t + dt;
  if (nowMs - nc.updated > STALE_MIN * 60000 || nowMs >= endT) return { ok: false, reason: 'vanhentunut', stale: true };

  let cur = 0;
  for (let i = 0; i < steps.length; i++) if (steps[i].t <= nowMs) cur = i;
  const last = steps.length - 1;
  const wetAt = (i) => i <= last && steps[i].rate >= WET_MMH;
  const wetRun = (i) => wetAt(i) && (steps[i].rate >= 1 || i === last || wetAt(i + 1) || (i > 0 && wetAt(i - 1)));
  const dryRun = (i) => !wetAt(i) && (i === last || !wetAt(i + 1));
  const minTo = (i) => (steps[i].t - nowMs) / 60000;
  const horizonMin = Math.floor((endT - nowMs) / 60000);
  const hz = horizonPhrase(horizonMin);
  const span = (from, to) => {
    let peak = 0;
    let mm = 0;
    for (let i = from; i <= Math.min(to, last); i++) {
      peak = Math.max(peak, steps[i].rate);
      mm += (steps[i].rate * dt) / 3600000;
    }
    return { peak, mm: Math.round(mm * 10) / 10 };
  };
  const out = { ok: true, updated: nc.updated, horizonMin };

  if (wetRun(cur)) {
    let j = -1;
    for (let i = cur + 1; i <= last; i++) {
      if (dryRun(i)) {
        j = i;
        break;
      }
    }
    const endMin = j >= 0 ? round5(minTo(j)) : null;
    const { peak, mm } = span(cur, j >= 0 ? j - 1 : last);
    const word = intensityWord(peak);
    const tail = endMin == null ? `sade jatkuu ainakin seuraavat ${hz.for}` : endMin <= 5 ? 'sade on loppumassa' : `sade päättyy noin ${endMin} min päästä`;
    return { ...out, state: 'wet', startMin: 0, endMin, peak, mm, word, tail, line: `Sataa nyt (${word}). Tutkan mukaan ${tail}.` };
  }

  let j = -1;
  for (let i = cur + 1; i <= last; i++) {
    if (wetRun(i)) {
      j = i;
      break;
    }
  }
  if (j < 0) {
    const tail = `ei sadetta seuraavaan ${hz.into}`;
    return { ...out, state: 'dry', startMin: null, endMin: null, peak: 0, mm: 0, word: '', tail, line: `Tutkan mukaan ${tail}.` };
  }
  const startMin = round5(minTo(j));
  const { peak, mm } = span(j, j + Math.max(1, Math.round(3600000 / dt)) - 1); // tunnin ajan alusta (askelpituus vaihtelee)
  const word = intensityWord(peak);
  const tail = startMin <= 5 ? 'sade alkaa aivan pian' : `sade alkaa noin ${startMin} min päästä`;
  return { ...out, state: 'dry', startMin, endMin: null, peak, mm, word, tail, line: `Tutkan mukaan ${tail} (${word}).` };
}

/**
 * Hakee ja jäsentää ennusteen. Ei lisää muita otsikoita kuin Accept (CORS-turvallinen), eikä käytä välimuistiasetuksia.
 * Heittää verkko- ja rakennevirheistä (kutsuja suojaa ne sources.js:llä); palauttaa { ok:false } kun paikkaa ei katettu.
 */
export function fetchNowcast(lat, lon, { fetchFn = defaultFetch, timeoutMs = 6000, signal = null } = {}) {
  return timedRequest(fetchFn, nowcastUrl(lat, lon), { headers: { Accept: 'application/json' } }, { timeoutMs, signal, label: 'Tutkaennuste' }, async (res) => {
    if (res.status === 400 || res.status === 404 || res.status === 422) return { ok: false, reason: 'ei tutkakattavuutta' };
    if (!res.ok) throw Object.assign(new Error(`Tutkaennuste: HTTP ${res.status}`), { status: res.status });
    return parseNowcast(await res.json());
  });
}

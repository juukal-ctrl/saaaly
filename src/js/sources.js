// sources.js: valinnaisten ulkoisten tietolähteiden hallinta (tutkaennuste, varoitukset, ilmanlaatu).
// Periaate: lähde saa epäonnistua hiljaa. Käyttäjälle ei näytetä virheilmoituksia, ja epäonnistunutta lähdettä ei kokeilla heti uudelleen
// (porrastettu odotus 15 min, 1 h, 6 h, 24 h). Tila näkyy vain "Tietoja ja tietolähteet" -näkymässä ja diagnostiikassa.
// Selaimesta ei voi erottaa CORS-estoa verkkovirheestä, joten kaikki "ei vastannut" -tapaukset käsitellään samalla tavalla.

import { store } from './util.js';

export const SOURCE_INFO = {
  nowcast: {
    name: 'Tutkaennuste',
    provider: 'MET Norway Nowcast',
    url: 'https://api.met.no/weatherapi/nowcast/2.0/',
    license: 'CC BY 4.0 / NLOD',
    note: 'Tutkapohjainen sade seuraavalle kahdelle tunnille (Pohjoismaat).',
  },
  warnings: {
    name: 'Viralliset varoitukset',
    provider: 'Ilmatieteen laitos',
    url: 'https://www.ilmatieteenlaitos.fi/varoitukset',
    license: 'CC BY 4.0',
    note: 'Säävaroitukset (CAP-syöte) sijaintisi alueelle. Haetaan GitHubin kautta, koska Ilmatieteen laitoksen palvelu ei salli selaimen suoraa hakua. Jos tieto on yli puolitoista tuntia vanha, etusivu kertoo sen.',
  },
  obs: {
    name: 'Havainto',
    provider: 'Ilmatieteen laitos, avoin data',
    url: 'https://www.ilmatieteenlaitos.fi/avoin-data',
    license: 'CC BY 4.0',
    note: 'Lähimmän sääaseman mitattu lämpötila: vertailukohta ennusteelle (Varmuus-sivu).',
  },
  air: {
    name: 'Ilmanlaatu ja siitepöly',
    provider: 'Open-Meteo / CAMS',
    url: 'https://open-meteo.com/en/docs/air-quality-api',
    license: 'CC BY 4.0',
    note: 'Mallilaskelma, ei mittaus.',
  },
};

const WAIT_MIN = [15, 60, 360, 1440];

/** Muistinvarainen tallennus (esimerkkitilassa ei kirjoiteta oikeaan localStorageen). */
export function memoryStorage() {
  const mem = {};
  return { object: (k) => mem[k] ?? null, set: (k, v) => ((mem[k] = v), true) };
}

export function createGuard({ storage = store, clock = () => Date.now() } = {}) {
  const read = () => storage.object('src') || {};
  const entry = (id) => {
    const e = read()[id];
    return e && typeof e === 'object' ? e : {};
  };
  const put = (id, e) => storage.set('src', { ...read(), [id]: e });
  return {
    /** Saako lähdettä yrittää nyt? Epäonnistumisen jälkeen odotetaan. */
    canTry(id, now = clock()) {
      const e = entry(id);
      return !(Number(e.until) > now);
    },
    /** limited = lähde vastasi, mutta tietoa ei voinut käyttää (esim. vanhentunut peili tai ei kattavuutta). */
    ok(id, now = clock(), note = '', limited = false) {
      put(id, { fails: 0, until: 0, lastOk: now, note: String(note).slice(0, 80), ...(limited ? { limited: true } : {}) });
    },
    fail(id, err, now = clock()) {
      const e = entry(id);
      const fails = (Number(e.fails) || 0) + 1;
      put(id, { ...e, fails, until: now + WAIT_MIN[Math.min(fails, WAIT_MIN.length) - 1] * 60000, lastFail: now, error: String(err?.message || err || 'virhe').slice(0, 80) });
    },
    status(id) {
      return entry(id);
    },
  };
}

/**
 * Ajaa lähteen haun suojattuna. Palauttaa { value } onnistuessa, { skipped } kun odotusaika on käynnissä tai laite on offline,
 * ja { error } epäonnistuessa. Ei koskaan heitä. force ohittaa odotuksen (esim. käyttäjä päivitti käsin).
 */
export async function runSource(guard, id, fn, { force = false, now = Date.now() } = {}) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { skipped: 'offline' };
  if (!force && !guard.canTry(id, now)) return { skipped: 'odotus' };
  try {
    const value = await fn();
    if (value && value.ok === false) {
      // Lähde vastasi, mutta ei kata paikkaa tai tieto puuttuu: ei virhe, mutta ei käyttökelpoista tietoa
      guard.ok(id, now, value.reason || '', true);
      return { value: null, reason: value.reason || 'ei kattavuutta', raw: value };
    }
    guard.ok(id, now, value?.note || '');
    return { value };
  } catch (e) {
    if (e?.name === 'AbortError' && e?.cancelled) return { skipped: 'peruttu' };
    guard.fail(id, e, now);
    return { error: e };
  }
}

/** Yksi rivi diagnostiikkaan ja tietoja-näkymään: "✓ Tutkaennuste (MET Norway Nowcast)" tai "– … ei vastannut (odotus 15 min)". */
export function sourceLine(id, st, now = Date.now()) {
  const info = SOURCE_INFO[id];
  if (!info) return '';
  const head = `${info.name} (${info.provider})`;
  if (st?.lastFail && (!st.lastOk || st.lastFail > st.lastOk)) {
    const wait = Math.max(0, Math.ceil((Number(st.until) - now) / 60000));
    return `– ${head}: ei vastannut${st.error ? ` (${st.error})` : ''}${wait ? `, uusi yritys ${wait >= 90 ? `${Math.round(wait / 60)} h` : `${wait} min`} päästä` : ''}`;
  }
  if (st?.lastOk) return `${st.limited ? '!' : '✓'} ${head}${st.note ? `: ${st.note}` : ''}`;
  return `· ${head}: ei vielä kokeiltu`;
}

/**
 * Yksi verkkopyyntö aikarajalla ja ulkoisella peruutuksella; read(res) lukee vastauksen rungon saman aikarajan sisällä.
 * Heittää "<label>: aikakatkaisu", kun aikaraja täyttyy, ja AbortError (cancelled = true), kun signal peruttiin.
 */
export async function timedRequest(fetchFn, url, init, { timeoutMs = 8000, signal = null, label = 'Haku' } = {}, read = (res) => res) {
  const ctl = new AbortController();
  let cancelled = false;
  const onAbort = () => {
    cancelled = true;
    ctl.abort();
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await read(await fetchFn(url, { ...init, signal: ctl.signal }));
  } catch (e) {
    if (cancelled) throw Object.assign(new Error('Peruttu'), { name: 'AbortError', cancelled: true });
    if (ctl.signal.aborted) throw new Error(`${label}: aikakatkaisu`);
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

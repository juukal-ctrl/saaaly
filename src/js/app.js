// app.js: sovelluksen tila, tapahtumat, päivityssilmukka ja näkymien yhdistäminen.
// Laskenta on moduuleissa (weather, blend, geo, ai); tämä tiedosto vain kutsuu niitä ja piirtää tuloksen.

import { store, defaultFetch, debounce, localNow, zonedToUtcMs, fmtTemp, fmtNum, escapeHtml as esc } from './util.js';
import { MODELS } from './models.js';
import { fetchAll, summarizeErrors } from './weather.js';
import { blendForecast, nowPosition, snapshot } from './blend.js';
import { searchPlaces, reverseGeocode, getPosition, placeKey, haversineKm, FI_CITIES } from './geo.js';
import { sunPosition, moonInfo } from './sun.js';
import { createSky, skyColors, isLightSky } from './sky.js';
import { RANGES as MG_RANGES } from './meteogram.js';
import { aiSettings, effectiveMode, shortReason, explain, chat, listModels, pickFlash, generate, textOf, compactForecast, placeLabel } from './ai.js';
import { answerQuestion } from './answer.js';
import { verdict } from './advice.js';
import { fetchNowcast, summarizeNowcast, nowcastUrl } from './nowcast.js';
import { createGuard, runSource, memoryStorage, sourceLine } from './sources.js';
import { fetchWarnings, officialRows, inFinland, MIRROR_URL } from './warnings.js';
import { fetchObs } from './observations.js';
import { makeDemoFetch } from './demo.js';
import { agoText, staleText, selLabel, placeHtml, heroHtml, verdictHtml, alertsHtml, welcomeHtml, aboutSheetHtml, meteoHtml, selectionLines, hoursPageHtml, weekPageHtml, certPageHtml, radarHtml, trackHtml, modelsHtml, searchSheetHtml, resultsHtml, settingsSheetHtml, chatSheetHtml, messageHtml, typingHtml, chatEmptyHtml, modeNote } from './views.js';
import { homeHeadline } from './headline.js';
import { createCube, createCubeChrome } from './cube.js';
import { createMapView } from './mapview.js';
import { FOREIGN_CITIES } from './gazetteer.js';

const VERSION = '0.8.0';
const BUILD = '__BUILD__'; // korvataan julkaisussa (tools/build.mjs); kehityspuussa paikanvaraaja
const SCHEMA = 1; // tallennetun datan rakenne; kasvata, kun avaimia muutetaan epäyhteensopivasti

// ---------- Ympäristö ----------

const params = new URLSearchParams(location.search);
const demoParam = params.get('demo');
const DEMO = Boolean(globalThis.SAAALY_DEMO) || demoParam !== null;
const SCENARIOS = ['clear', 'rain', 'snow', 'thunder', 'fog', 'mixed'];
const scenario = SCENARIOS.includes(demoParam) ? demoParam : SCENARIOS.includes(globalThis.SAAALY_SCENARIO) ? globalThis.SAAALY_SCENARIO : 'mixed';

// ?demo&at=2026-12-24T15:00:00%2B02:00 siirtää kellon (vain esimerkkitilassa, näkymien tarkistamiseen)
const T0 = Date.now();
const atMs = DEMO ? Date.parse(params.get('at') || '') : NaN;
const nowMs = Number.isFinite(atMs) ? () => atMs + (Date.now() - T0) : () => Date.now();
const fetchFn = DEMO ? makeDemoFetch({ scenario, nowMs: Number.isFinite(atMs) ? atMs : undefined }) : defaultFetch;
// Valinnaiset lähteet (tutkaennuste, varoitukset): epäonnistunutta ei kokeilla heti uudelleen, eikä käyttäjälle näytetä virhettä (sources.js)
const sources = createGuard({ storage: DEMO ? memoryStorage() : store, clock: () => nowMs() });

const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEFAULT_PLACE = { name: 'Helsinki', region: 'Uusimaa', country: 'Suomi', lat: 60.1699, lon: 24.9384, mode: 'default' };
const DEMO_PLACE = { name: 'Turku', region: 'Varsinais-Suomi', country: 'Suomi', lat: 60.4518, lon: 22.2666, mode: 'manual' };
const REFRESH_OPTIONS = [5, 10, 15, 30];
const CACHE_MAX_AGE = 24 * 3600 * 1000;
const CACHE_V = 2; // kasvata, kun tallennetun datan muoto tai tulkinta muuttuu (v2: "edellisen tunnin" suureet siirretty jäsennyksessä)

const $ = (sel, root = document) => root.querySelector(sel);
const el = {
  sky: $('#sky'),
  place: $('#placeBtn'),
  banner: $('#banner'),
  update: $('#update'),
  app: $('#app'),
  welcome: $('#welcome'),
  pages: $('#pages'),
  pgHome: $('#pgHome'),
  alerts: $('#alerts'),
  hero: $('#hero'),
  verdict: $('#verdict'),
  stage: $('#stage'),
  track: $('#track'),
  hourly: $('#hourly'),
  daily: $('#daily'),
  meteo: $('#meteo'),
  models: $('#models'),
  certainty: $('#certainty'),
  fab: $('#fab'),
  dots: $('#dots'),
  hint: $('#swipeHint'),
  sheet: $('#sheet'),
  panel: $('#sheetPanel'),
  theme: $('meta[name="theme-color"]'),
};

// ---------- Tila ----------

const savedRefresh = store.num('refreshMin', 10);
const state = {
  place: null,
  results: null,
  fc: null,
  fetchedAt: 0,
  loading: false,
  manualLoad: false,
  error: '',
  sel: { type: 'now' },
  dayOpen: null, // Viikko-sivun päivä, jonka tunnit näytetään sen rivin alla
  page: 0, // näkyvä sivu: 0 koti, 1 tunnit, 2 viikko, 3 varmuus
  hourOpen: null, // Tunnit-sivun avattu tunti (lisätiedot rivin alla)
  hoursMore: false, // Tunnit-sivulla 48 tuntia 13 sijaan
  hoursView: store.str('hoursView', 'list') === 'chart' ? 'chart' : 'list',
  ai: { status: 'idle', text: '', error: '', fp: '' },
  refreshMin: REFRESH_OPTIONS.includes(savedRefresh) ? savedRefresh : 10,
  sheet: null,
  found: [],
  recent: store.array('recent').filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon)),
  chat: [],
  chatBusy: false,
  chatLast: null, // vastausmoottorin muisti: edellisen kysymyksen paikka, aihe ja ajankohta ("Entä huomenna?")
  models: [],
  banner: null,
  first: false, // ensimmäinen käynnistys: näytetään paikan valintakortti, eikä sijaintilupaa kysytä ennen kuin käyttäjä painaa
  sens: Math.max(-3, Math.min(3, store.num('sens', 0))), // kylmänsietokyky: −3 (palelen helposti) … +3 (kestän kylmää)
  vday: 'today', // yläpalkin valinta: 'today' | 'tomorrow' (etusivu ja Tunnit näyttävät valitun päivän)
  mg: { range: Object.hasOwn(MG_RANGES, store.str('mgRange', '24h')) ? store.str('mgRange', '24h') : '24h', inspectIso: null }, // sääkaavio: aikaväli ja tarkastettu hetki
  nowcast: null, // tutkaennusteen tulkinta nykyhetkelle (nowcast.js), jos saatavilla
  nc: { raw: null, key: '', at: 0, ttl: 0 }, // viimeisin haettu tutkaennuste, paikka ja haun ajankohta
  warn: { raw: null, at: 0 }, // koko maan CAP-varoitukset (warnings.js); oma alue valitaan piirrettäessä
  official: [], // viralliset varoitukset (warnings.js), jos saatavilla
  obs: { raw: null, key: '', at: 0 }, // lähimmän sääaseman havainto (observations.js), jos saatavilla
};

// Gemini on käytettävissä vain, kun avain on tallennettu (esimerkkitilassa ei koskaan). Ilman sitä vastataan sovelluksen omalla laskennalla.
const keyOn = () => !DEMO && Boolean(aiSettings.key());
const aiMode = () => effectiveMode(keyOn(), aiSettings.mode()); // internal | grounded | free
const geminiOn = () => aiMode() !== 'internal';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Piirtäminen ----------

const last = {};

/** Tunnistaa fokusoidun painikkeen data-attribuuteista, jotta sen voi löytää uudelleenpiirron jälkeen. */
function focusSelector(a) {
  const q = (v) => String(v).replace(/["\\]/g, '\\$&');
  const parts = ['data-act', 'data-iso', 'data-date', 'data-i', 'id'].filter((k) => a.getAttribute(k) != null).map((k) => `[${k}="${q(a.getAttribute(k))}"]`);
  return parts.length ? `${a.tagName.toLowerCase()}${parts.join('')}` : null;
}

function patch(key, node, html) {
  if (last[key] === html) return false;
  last[key] = html;
  // Uudelleenpiirto korvaa painikkeet. Fokus palautetaan samaan kohtaan, ettei näppäimistö- tai ruudunlukijakäyttäjä putoa sivun alkuun.
  const a = document.activeElement;
  const sel = a && a !== document.body && node.contains(a) ? focusSelector(a) : null;
  node.innerHTML = html;
  if (sel) {
    try {
      node.querySelector(sel)?.focus({ preventScroll: true });
    } catch {
      /* huono valitsin: ei väliä */
    }
  }
  return true;
}

const SKELETON =
  '<div aria-busy="true"><div class="sk sk-temp"></div><div class="sk sk-line"></div><div class="sk sk-panel"></div></div><p class="hero-note" role="status">Haetaan säätä…</p>';

function problemHtml(message) {
  return `<div class="problem" role="alert"><h2>Säätä ei saatu haettua</h2><p>${esc(message)}</p>
    <div class="inline"><button class="btn" type="button" data-act="refresh">Yritä uudelleen</button><button class="btn ghost" type="button" data-act="open-diag">Diagnostiikka</button></div></div>`;
}

function renderHeader() {
  const html = placeHtml(state.place);
  if (last.header !== html) {
    last.header = html;
    el.place.innerHTML = html;
    el.place.removeAttribute('aria-label'); // nimi tulee näkyvästä tekstistä ja piilotekstistä (placeHtml, WCAG 2.5.3)
  }
  $('#refreshBtn')?.classList.toggle('spin', state.loading && (state.manualLoad || !state.fc));
}

/** SääÄlyn selitys nykyhetkestä näkyy chatin ensimmäisenä viestinä (aiemmin etusivun kortti). */
function renderAi() {
  if (state.sheet === 'chat' && !state.chat.length) renderChat();
}

function chatIntro() {
  if (!state.fc) return null;
  if (geminiOn() && state.ai.status === 'done' && state.ai.text) return { text: state.ai.text, md: true, src: 'SääÄly kertoo · Gemini' };
  const lines = selectionLines(state.fc, { type: 'now' }, nowMs());
  return lines.length ? { text: lines.join(' '), md: false, src: `SääÄly kertoo · oma laskenta, ${state.fc.modelsUsed}/${state.fc.modelsTotal} mallia` } : null;
}

/** Etusivun otsikko ja varoitusrivi: laskenta headline.js:ssä ja advice.js:ssä, tässä vain piirretään. */
function renderAdvice(fc, now) {
  state.nowcast = currentNowcast(now);
  state.official = currentOfficial(now);
  let hl = null;
  let v = null;
  try {
    hl = homeHeadline(fc, now, { day: state.vday, sensitivity: state.sens, nowcast: state.nowcast });
  } catch {
    hl = null; // neuvot ovat lisä, eivätkä saa kaataa muuta näkymää
  }
  try {
    v = verdict(fc, now, { window: 'today', lat: state.place?.lat, sensitivity: state.sens, nowcast: state.nowcast });
  } catch {
    v = null;
  }
  document.querySelectorAll('#hdSeg .seg').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.day === state.vday)));
  el.verdict.hidden = !hl;
  patch('verdict', el.verdict, hl ? verdictHtml({ hl }) : '');
  const html = alertsHtml({ alerts: v?.alerts || [], official: state.official, officialState: officialState(now), checkedAt: state.warn.fetchedAt || 0, nowMs: now });
  el.alerts.hidden = !html;
  if (patch('alerts', el.alerts, html)) sizeStage();
}

/** Etusivun näyttämö mahtuu ruudulle: korkeus = sivu − varoitusrivi − alapalkki. Leveys seuraa radan kuvasuhdetta (412 x 750). */
function sizeStage() {
  const pg = el.pgHome;
  if (!pg || el.stage.classList.contains('stage-off')) {
    el.stage.style.width = '';
    return;
  }
  const H = pg.clientHeight;
  const W = pg.clientWidth;
  if (!H || !W) return;
  const top = el.alerts.hidden ? 0 : el.alerts.offsetHeight + 6;
  const pill = el.fab ? el.fab.getBoundingClientRect().height + 8 : 110;
  // Radan alimmat merkit ovat 94 %:n korkeudella: niiden on jäätävä alapalkin yläpuolelle. Kuvan loppu saa jäädä palkin alle.
  const h = (H - top - pill) / 0.94;
  const fit = (h * 412) / 750;
  const w = Math.round(Math.max(260, Math.min(W, fit)));
  el.stage.style.width = `${w}px`;
  // Hyvin lyhyellä ruudulla (monta varoitusta) näyttämö ei mahdu: sivu vierii, ja loppuun jää tilaa palkin yli.
  // Väli on ::after-elementti (muuttuja), ei sivun täyte: sivun oma koko ei muutu, joten ResizeObserver ei kierrä.
  pg.style.setProperty('--stage-pad', fit < 260 ? `${Math.ceil(pill)}px` : '0px');
}

// ---------- Valinnaiset lähteet ----------

const NC_TTL = 5 * 60000; // tutkaennuste päivittyy viiden minuutin välein
const NC_TTL_NOCOV = 60 * 60000; // kattavuuden ulkopuolella kysytään harvoin
let ncBusy = false;
const ncKey = (p) => (p && Number.isFinite(p.lat) && Number.isFinite(p.lon) ? `${p.lat.toFixed(2)},${p.lon.toFixed(2)}` : '');

/** Tutkaennusteen tulkinta hetkelle now; null, jos ei saatavilla, vanhentunut tai haettu toiselle paikalle. */
function currentNowcast(now) {
  const nc = state.nc;
  if (!nc.raw || nc.key !== ncKey(state.place)) return null;
  const s = summarizeNowcast(nc.raw, now);
  return s.ok ? s : null;
}

/** Hakee tutkaennusteen, jos edellinen on vanha (tai ignoreAge). Ei koskaan heitä eikä näytä virhettä; epäonnistumisen jälkeen sources.js pitää taukoa. */
async function refreshNowcast({ ignoreAge = false } = {}) {
  const p = state.place;
  const key = ncKey(p);
  if (!key || ncBusy) return;
  const now = nowMs();
  const nc = state.nc;
  if (!ignoreAge && nc.key === key && now - nc.at < nc.ttl) return;
  ncBusy = true;
  try {
    const r = await runSource(sources, 'nowcast', () => fetchNowcast(p.lat, p.lon, { fetchFn }), { now });
    if (ncKey(state.place) === key && 'value' in r) state.nc = { raw: r.value, key, at: now, ttl: r.value ? NC_TTL : NC_TTL_NOCOV }; // value null = tutka ei kata paikkaa
  } finally {
    ncBusy = false;
  }
  if (state.fc) {
    renderAdvice(state.fc, nowMs());
    renderHours();
  }
}

const OBS_TTL = 10 * 60000; // asemat mittaavat kymmenen minuutin välein
let obsBusy = false;

/** Lähimmän aseman havainto, jos se on haettu tälle paikalle eikä ole vanha. */
function currentObs(now) {
  const o = state.obs;
  if (!o.raw || o.key !== ncKey(state.place) || now - o.raw.t > 90 * 60000) return null;
  return o.raw;
}

/** Hakee havainnon Suomessa olevalle paikalle. Hiljainen lisälähde kuten tutkaennuste. */
async function refreshObs({ ignoreAge = false } = {}) {
  const p = state.place;
  const key = ncKey(p);
  if (!key || obsBusy || !inFinland(p.lat, p.lon)) return;
  const now = nowMs();
  if (!ignoreAge && state.obs.key === key && now - state.obs.at < OBS_TTL) return;
  obsBusy = true;
  try {
    const r = await runSource(sources, 'obs', () => fetchObs(p.lat, p.lon, { fetchFn, now }), { now });
    if (ncKey(state.place) === key && 'value' in r) state.obs = { raw: r.value, key, at: now };
  } finally {
    obsBusy = false;
  }
  if (state.fc) {
    renderHours();
    patch('certainty', el.certainty, certPageHtml({ fc: state.fc, results: state.results, nowMs: nowMs(), obs: currentObs(nowMs()) }));
  }
}

const WARN_TTL = 15 * 60000; // CAP-syöte päivittyy useita kertoja päivässä; neljännestunnin välein riittää
let warnBusy = false;

/** Oman paikan viralliset varoitukset hetkelle now (tyhjä, jos syötettä ei ole haettu tai paikka on Suomen ulkopuolella). */
function currentOfficial(now) {
  const p = state.place;
  if (!state.warn.raw || !p || !inFinland(p.lat, p.lon)) return [];
  try {
    return officialRows(state.warn.raw, p.lat, p.lon, now);
  } catch {
    return [];
  }
}

/** Onko virallisten varoitusten tila tiedossa? 'unknown' = niitä ei voitu tarkistaa (haku epäonnistui, peili vanhentunut tai laite offline). */
function officialState(now) {
  const p = state.place;
  if (!p || !inFinland(p.lat, p.lon)) return 'ok';
  const st = sources.status('warnings');
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (state.warn.stale) return 'unknown';
  if (state.warn.at && now - state.warn.at > 6 * 3600000) return 'unknown';
  if (!state.warn.raw) return offline || Number(st.lastFail) > (Number(st.lastOk) || 0) ? 'unknown' : 'ok';
  return Number(st.lastFail) > (Number(st.lastOk) || 0) && now - state.warn.at > 30 * 60000 ? 'unknown' : 'ok';
}

/** Hakee Ilmatieteen laitoksen varoitussyötteen, jos edellinen on vanha. Hiljainen varmistus kuten tutkaennusteessa; Suomen ulkopuolella ei haeta. */
async function refreshWarnings({ ignoreAge = false } = {}) {
  const p = state.place;
  if (!p || warnBusy || !inFinland(p.lat, p.lon)) return;
  const now = nowMs();
  if (!ignoreAge && state.warn.at && now - state.warn.at < WARN_TTL) return;
  warnBusy = true;
  try {
    const r = await runSource(sources, 'warnings', () => fetchWarnings({ fetchFn, now }), { now });
    // Vanhentunut peili (value null) ei ole virhe, mutta uutta tietoa ei ole: edellinen lista jää voimaan ja seuraavaa hakua odotetaan normaalisti
    if ('value' in r) state.warn = { raw: r.value ? r.value.alerts : state.warn.raw, at: now, stale: !r.value, fetchedAt: r.value ? r.value.fetchedAt : (r.raw?.fetchedAt ?? state.warn.fetchedAt) };
  } finally {
    warnBusy = false;
  }
  if (state.fc) renderAdvice(state.fc, nowMs());
}

function renderWelcome() {
  const show = state.first && !state.sheet;
  el.welcome.hidden = !show;
  patch('welcome', el.welcome, show ? welcomeHtml({ cities: FI_CITIES.slice(0, 10).map((c) => c[0]) }) : '');
}

// ---------- Sääkaavio ----------

function renderMeteo(now = nowMs()) {
  if (!state.fc || !el.meteo) return;
  const avail = Math.round(el.meteo.clientWidth || innerWidth - 64);
  const width = Math.max(260, Math.min(640, avail + 12)); // .mg-wrap ulottuu 6 px sisältöalueen ulkopuolelle
  const compact = parseFloat(getComputedStyle(document.documentElement).fontSize) >= 22; // suuri tekstikoko: vähemmän tekstiä kaaviossa
  patch('meteo', el.meteo, meteoHtml({ fc: state.fc, nowMs: now, range: state.mg.range, inspectIso: state.mg.inspectIso, width, compact }));
}

/** Kaavion jakson alkuhetki (paikallinen ISO) annetulle indeksille nykyisellä aikavälillä. */
function mgIsoAt(j) {
  const { fc } = state;
  if (!fc) return null;
  const { idx } = nowPosition(fc, nowMs());
  return fc.hours[idx + j * (MG_RANGES[state.mg.range]?.binH || 1)]?.t ?? null;
}

function mgIndexAt(wrap, clientX) {
  const rect = wrap.getBoundingClientRect();
  const W = Number(wrap.dataset.w) || rect.width;
  const n = Number(wrap.dataset.n) || 1;
  const x = ((clientX - rect.left) / (rect.width || 1)) * W;
  return Math.max(0, Math.min(n - 1, Math.floor(((x - 12) / (W - 24)) * n)));
}

function mgInspect(j) {
  const iso = j == null ? null : mgIsoAt(j);
  if (state.mg.inspectIso === iso) return;
  state.mg.inspectIso = iso;
  renderMeteo();
}

function bindMeteo() {
  let drag = false;
  let pending = null;
  const flush = () => {
    const p = pending;
    pending = null;
    const wrap = $('#mgWrap');
    if (p != null && wrap) mgInspect(mgIndexAt(wrap, p));
  };
  document.addEventListener('pointerdown', (ev) => {
    if (!ev.target.closest?.('#mgWrap')) return;
    drag = true;
    pending = ev.clientX;
    flush();
  });
  document.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    if (pending == null) requestAnimationFrame(flush);
    pending = ev.clientX;
  });
  document.addEventListener('pointercancel', () => (drag = false));
  document.addEventListener('pointerup', () => {
    if (!drag) return;
    drag = false;
    // Tarkastuskohdan piirtäminen korvasi napautetun solmun, jolloin selaimen oma fokusointi (mousedown) osui irrotettuun solmuun ja poisti fokuksen.
    // Palautetaan fokus kaavioon vasta kun hiiri-/kosketustapahtumat on käsitelty, jotta nuolinäppäimet toimivat napautuksen jälkeen.
    setTimeout(() => {
      const wrap = $('#mgWrap');
      if (wrap && document.activeElement !== wrap) wrap.focus({ preventScroll: true });
    }, 0);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.target.id !== 'mgWrap') return;
    const n = Number(ev.target.dataset.n) || 1;
    const cur = Number(ev.target.getAttribute('aria-valuenow')) || 0;
    const has = state.mg.inspectIso != null;
    const keys = { ArrowLeft: has ? cur - 1 : 0, ArrowRight: has ? cur + 1 : 0, ArrowDown: has ? cur - 1 : 0, ArrowUp: has ? cur + 1 : 0, Home: 0, End: n - 1 };
    if (ev.key === 'Escape' && has) {
      ev.preventDefault();
      ev.stopPropagation();
      mgInspect(null);
    } else if (ev.key in keys) {
      ev.preventDefault();
      mgInspect(Math.max(0, Math.min(n - 1, keys[ev.key])));
    }
  });
  let lastW = 0;
  window.addEventListener(
    'resize',
    debounce(() => {
      const w = el.meteo?.clientWidth || 0;
      if (state.fc && Math.abs(w - lastW) > 4) {
        lastW = w;
        renderMeteo();
      }
    }, 150),
  );
}

function renderAll() {
  renderHeader();
  renderWelcome();
  if (!state.fc) {
    patch('hero', el.hero, state.error ? problemHtml(state.error) : SKELETON);
    el.stage.classList.add('stage-off');
    el.track.hidden = true;
    patch('track', el.track, '');
    el.verdict.hidden = true;
    el.alerts.hidden = true;
    patch('verdict', el.verdict, '');
    patch('alerts', el.alerts, '');
    for (const k of ['hourly', 'daily', 'certainty', 'models']) patch(k, el[k], '');
    el.meteo.hidden = true;
    sizeStage();
    return;
  }
  const now = nowMs();
  const { fc, sel } = state;
  const day = state.vday;
  patch('hero', el.hero, heroHtml({ fc, nowMs: now, sel, day }));
  el.stage.classList.remove('stage-off');
  el.track.hidden = false;
  patch('track', el.track, trackHtml({ fc, nowMs: now, sel, day }));
  renderAdvice(fc, now);
  renderHours(now);
  renderWeek(now);
  patch('certainty', el.certainty, certPageHtml({ fc, results: state.results, nowMs: now, obs: currentObs(now) }));
  const wasOpen = $('.models-d', el.models)?.open;
  if (patch('models', el.models, modelsHtml({ results: state.results, fc, nowMs: now })) && wasOpen) $('.models-d', el.models).open = true;
  sizeStage();
}

/** Tunnit-sivu: lista tai kaavio. Tutkan käyrä näkyy, kun sade on alle kahden tunnin päässä. */
function renderHours(now = nowMs()) {
  const { fc } = state;
  if (!fc) return;
  const chart = state.hoursView === 'chart';
  const raw = state.nc.key === ncKey(state.place) ? state.nc.raw : null;
  const radar = state.vday === 'today' ? radarHtml({ raw, nc: state.nowcast, nowMs: now, tz: fc.tz }) : '';
  patch('hourly', el.hourly, hoursPageHtml({ fc, nowMs: now, day: state.vday, open: state.hourOpen, more: state.hoursMore, view: state.hoursView, radar, fetchedAt: state.fetchedAt, loading: state.loading && state.manualLoad, obs: currentObs(now), nowcast: state.vday === 'today' ? state.nowcast : null }));
  el.meteo.hidden = !chart;
  if (chart) renderMeteo(now);
}

/** Viikko-sivu. Avatun päivän tuntinauha aloittaa aamusta (tänään nykyhetkestä). */
function renderWeek(now = nowMs()) {
  const { fc } = state;
  if (!fc) return;
  if (state.dayOpen && !fc.days.slice(0, 7).some((d) => d.date === state.dayOpen)) state.dayOpen = null;
  const dayLeft = $('.dstrip', el.daily)?.scrollLeft || 0;
  if (patch('daily', el.daily, weekPageHtml({ fc, nowMs: now, open: state.dayOpen }))) {
    const ds = $('.dstrip', el.daily);
    if (ds) {
      if (dayLeft && ds.dataset.date === state.dayScrolled) ds.scrollLeft = dayLeft;
      else {
        const first = ds.querySelector('.hr');
        const morning = ds.querySelector('.hr[data-iso$="T07:00"]');
        ds.scrollLeft = morning && first ? Math.max(0, morning.offsetLeft - first.offsetLeft) : 0;
        state.dayScrolled = ds.dataset.date;
      }
    }
  }
}

// ---------- Sivut ----------

let pageEntry = false; // alisivulle siirtyminen lisää historiaan yhden merkinnän: Androidin takaisin palaa kotiin
let ignorePop = false;

let cube = null; // sivukuutio (js/cube.js)

function goPage(i, { smooth = true } = {}) {
  cube?.go(i, { animate: smooth });
}

/** Kuutio asettui kyljelle i: pisteet, historia (Androidin takaisin palaa kotiin) ja vihjeen piilotus. */
function markDot(i) {
  el.dots?.querySelectorAll('button').forEach((b) => (+b.dataset.page === i ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')));
}

function onPageChange(i) {
  markDot(i);
  if (i === state.page) return;
  const prev = state.page;
  state.page = i;
  if (prev === 0 && i > 0 && !pageEntry && !state.sheet) {
    try {
      history.pushState({ saaalyPage: true }, '');
      pageEntry = true;
    } catch {
      pageEntry = false;
    }
  } else if (i === 0 && pageEntry && !state.sheet) {
    pageEntry = false;
    ignorePop = true;
    try {
      history.back();
    } catch {
      ignorePop = false;
    }
  }
  if (el.hint && !el.hint.hidden) {
    el.hint.hidden = true;
    store.set('swiped', true);
  }
}

/** Kerran laitteella: vihje sivujen pyyhkäisystä, kunnes käyttäjä vaihtaa sivua. */
function maybeHint() {
  if (DEMO || store.bool('swiped', false) || !el.hint || !state.fc) return;
  el.hint.hidden = false;
  setTimeout(() => {
    if (!el.hint.hidden) el.hint.hidden = true;
  }, 9000);
}

/** Uuden version ilmoitus: oma elementtinsä, jota paikan vaihto tai haku ei tyhjennä. */
function showUpdate(on) {
  if (!el.update) return;
  el.update.hidden = !on;
  el.update.dataset.kind = 'info';
  el.update.innerHTML = on ? '<span>Uusi versio SääÄlystä on saatavilla.</span><button type="button" data-act="update-app">Päivitä</button>' : '';
}

let updateCheckedAt = 0;
async function checkForUpdate({ force = false } = {}) {
  if (DEMO || BUILD.startsWith('__') || !navigator.onLine) return;
  const t = Date.now();
  if (!force && t - updateCheckedAt < 30 * 60000) return;
  updateCheckedAt = t;
  try {
    const res = await fetch('version.json', { cache: 'no-store' });
    if (!res.ok) return;
    const v = await res.json();
    if (v && typeof v.build === 'string' && /^[0-9a-f]{6,}$/.test(v.build) && v.build !== BUILD) showUpdate(true);
  } catch {
    /* ei verkkoa tai tiedostoa: kokeillaan myöhemmin */
  }
}

async function updateApp() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch {
    /* ei väliä */
  }
  location.reload();
}

/** Tallennettu ennuste näkyy, mutta uutta ei saatu: kerrotaan, milloin näkyvä ennuste on haettu ja onko verkko poissa. */
function staleBanner() {
  if (!state.fc || !state.fetchedAt) return;
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  setBanner({ id: 'stale', kind: 'warn', text: staleText({ fetchedAt: state.fetchedAt, nowMs: nowMs(), offline }), action: { act: 'refresh', label: 'Yritä uudelleen' } });
}

function setBanner(b) {
  state.banner = b;
  if (!b) {
    el.banner.hidden = true;
    el.banner.textContent = '';
    return;
  }
  el.banner.dataset.kind = b.kind || 'info';
  el.banner.innerHTML = `<span>${esc(b.text)}</span>${b.action ? `<button type="button" data-act="${esc(b.action.act)}">${esc(b.action.label)}</button>` : ''}`;
  el.banner.hidden = false;
}

// ---------- Taivas ----------

let sky = null;

function initSky() {
  sky = createSky(el.sky, { reduceMotion, animate: store.bool('anim', true) });
  sky.start();
}

function setThemeColor(alt) {
  const c = skyColors(alt)[0].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  el.theme?.setAttribute('content', '#' + c);
  const light = isLightSky(alt);
  document.body.classList.toggle('light', light);
  el.theme?.parentNode?.querySelector('meta[name="color-scheme"]')?.setAttribute('content', light ? 'light' : 'dark');
}

function skyIdle() {
  const p = state.place;
  const sun = sunPosition(nowMs(), p.lat, p.lon);
  const moon = moonInfo(nowMs(), p.lat, p.lon);
  sky.set({ alt: sun.altitudeDeg, bearing: sun.bearingDeg, cloud: 0.4, precip: 0, snow: 0, wind: 3, windDir: 225, thunder: 0, fog: 0, moonPhase: moon.phase, moonAlt: moon.altitudeDeg, moonHA: moon.hourAngle }, { snap: true });
  setThemeColor(sun.altitudeDeg);
}

/** Taivaan tila nykyhetkelle. Valittu tunti ei vaihda taustaa eikä teemaa: tausta kertoo aina, millainen sää on nyt. */
function skyStateFor() {
  const { fc } = state;
  const now = nowMs();
  const { idx, frac } = nowPosition(fc, now);
  const h = snapshot(fc, idx, frac);
  const sun = sunPosition(now, fc.lat, fc.lon);
  const moon = moonInfo(now, fc.lat, fc.lon);
  return {
    moonPhase: moon.phase,
    moonAlt: moon.altitudeDeg,
    moonHA: moon.hourAngle,
    alt: sun.altitudeDeg,
    bearing: sun.bearingDeg,
    cloud: (h.cloud ?? 50) / 100,
    precip: h.precip || 0,
    snow: h.snowShare || 0,
    wind: h.wind || 0,
    windDir: h.dir ?? 225,
    thunder: h.thunderShare >= 0.34 && h.precip >= 0.05 ? 1 : 0,
    fog: h.sym === 'fog' ? 0.85 : 0,
  };
}

function updateSky(snap = false) {
  if (!state.fc) return;
  const st = skyStateFor();
  sky.set(st, { snap: snap || reduceMotion });
  setThemeColor(st.alt);
}

// ---------- Välimuisti ----------

function persistPlace() {
  if (DEMO || !state.place?.name) return;
  store.set('place', state.place);
}

function persistCache() {
  if (DEMO || !state.results) return;
  const slim = state.results.map((r) =>
    r.ok
      ? { ok: true, key: r.model.key, id: r.id, data: r.data, ms: r.ms }
      : { ok: false, key: r.model.key, id: r.id, error: r.error, skipped: !!r.skipped, coverage: !!r.coverage, status: r.status, ms: r.ms },
  );
  store.set('cache', { v: CACHE_V, placeKey: placeKey(state.place), fetchedAt: state.fetchedAt, results: slim });
}

function restoreCache() {
  if (DEMO) return false;
  const c = store.object('cache');
  if (!c || c.v !== CACHE_V || !Array.isArray(c.results) || c.placeKey !== placeKey(state.place)) return false;
  if (nowMs() - c.fetchedAt > CACHE_MAX_AGE) return false;
  try {
    const results = c.results.map((r) => ({ ...r, model: MODELS.find((m) => m.key === r.key) })).filter((r) => r.model);
    state.fc = blendForecast(results, { nowMs: nowMs() });
    state.results = results;
    state.fetchedAt = c.fetchedAt;
    return true;
  } catch {
    state.fc = null;
    state.results = null;
    return false;
  }
}

function rememberRecent(p) {
  const key = placeKey(p);
  state.recent = [{ name: p.name, region: p.region, country: p.country, lat: p.lat, lon: p.lon }, ...state.recent.filter((r) => placeKey(r) !== key)].slice(0, 6);
  store.set('recent', state.recent);
}

// ---------- Datan haku ----------

let loadSeq = 0;
let inflight = null; // käynnissä oleva haku: { key, ctl, promise }

function validateSelection() {
  const { fc, sel } = state;
  if (!fc) return;
  const { idx, local } = nowPosition(fc, nowMs());
  if (sel.type === 'hour') {
    const i = fc.hours.findIndex((h) => h.t === sel.iso);
    if (i < idx) state.sel = { type: 'now' };
  } else if (sel.type !== 'now') state.sel = { type: 'now' };
  if (state.hourOpen && !fc.hours.some((h, i) => h.t === state.hourOpen && i >= idx)) state.hourOpen = null;
  void local;
}

/** Yksi haku kerrallaan: sama paikka käynnissä -> odotetaan sitä; toinen paikka -> vanha haku perutaan. */
function load({ manual = false } = {}) {
  if (!state.place) return Promise.resolve();
  const key = placeKey(state.place);
  if (inflight && inflight.key === key) {
    if (manual) {
      state.manualLoad = true;
      renderHeader();
    }
    return inflight.promise;
  }
  inflight?.ctl.abort();
  const entry = { key, ctl: new AbortController(), promise: null };
  inflight = entry;
  entry.promise = runLoad({ manual, signal: entry.ctl.signal }).finally(() => {
    if (inflight === entry) inflight = null;
  });
  return entry.promise;
}

async function runLoad({ manual = false, signal } = {}) {
  const seq = ++loadSeq;
  const place = state.place;
  state.loading = true;
  state.manualLoad = manual || !state.fc;
  renderAll();
  let results = [];
  try {
    results = await fetchAll(place.lat, place.lon, { fetchFn, noCache: manual, now: nowMs(), signal });
  } catch {
    results = [];
  }
  if (seq !== loadSeq) return; // paikka vaihtui tai uudempi haku on käynnissä
  state.loading = false;
  let fc = null;
  try {
    fc = blendForecast(results, { nowMs: nowMs() });
  } catch {
    fc = null;
  }
  if (!fc) {
    const why = summarizeErrors(results);
    const net = results.length && results.every((r) => r.kind === 'network' || r.kind === 'timeout');
    const hint = net ? ' Tarkista verkkoyhteys. Jos verkko toimii muuten, sisällönesto voi estää osoitteen api.open-meteo.com.' : '';
    if (state.fc) {
      staleBanner();
    } else {
      state.error = `Yksikään säämalli ei vastannut. ${why}.${hint}`;
    }
    renderAll();
    return;
  }
  state.results = results;
  state.fc = fc;
  state.fetchedAt = nowMs();
  state.error = '';
  if (state.banner?.id === 'stale') setBanner(null);
  validateSelection();
  persistCache();
  renderAll();
  updateSky();
  maybeHint();
  if (state.sheet === 'chat') syncAi({ immediate: true });
  void refreshNowcast({ ignoreAge: manual });
  void refreshWarnings({ ignoreAge: manual });
  void refreshObs({ ignoreAge: manual });
}

// ---------- Paikka ----------

function setPlace(place) {
  state.place = place;
  state.fc = null;
  state.results = null;
  state.error = '';
  state.sel = { type: 'now' };
  state.dayOpen = null;
  state.ai = { status: 'idle', text: '', error: '', fp: '' };
  state.chatLast = null;
  setBanner(null);
  persistPlace();
  skyIdle();
  renderAll();
  load();
}

function pickPlace(p) {
  if (!p) return;
  state.first = false;
  closeSheet();
  setPlace({ name: p.name, region: p.region, country: p.country, lat: p.lat, lon: p.lon, mode: 'manual' });
  rememberRecent(state.place);
}

async function geoPermission() {
  try {
    return (await navigator.permissions.query({ name: 'geolocation' })).state;
  } catch {
    return 'unknown';
  }
}

async function locate({ quiet = false } = {}) {
  state.first = false;
  if (state.sheet) closeSheet();
  if (!quiet) setBanner({ kind: 'info', text: 'Haetaan sijaintia…' });
  let pos;
  try {
    pos = DEMO ? { lat: DEMO_PLACE.lat, lon: DEMO_PLACE.lon } : await getPosition();
  } catch (e) {
    setBanner(quiet ? null : { kind: 'warn', text: e.message });
    return;
  }
  setBanner(null);
  const cur = state.place;
  if (quiet && cur?.mode === 'gps' && cur.name && haversineKm(cur.lat, cur.lon, pos.lat, pos.lon) < 3) return; // ei merkittävää liikettä
  const place = { name: '', region: '', country: '', lat: pos.lat, lon: pos.lon, gps: true, mode: 'gps' };
  setPlace(place);
  const geo = await reverseGeocode(pos.lat, pos.lon, { fetchFn });
  if (state.place !== place) return; // käyttäjä ehti valita toisen paikan
  Object.assign(place, { name: geo.name, region: geo.region, country: geo.country, note: geo.note || '' });
  persistPlace();
  renderAll();
  syncAi({ immediate: true });
}

let searchSeq = 0;
async function doSearch() {
  const q = ($('#q')?.value || '').trim();
  const out = $('#results');
  if (!out) return;
  const seq = ++searchSeq;
  if (q.length < 2) {
    state.found = [];
    out.innerHTML = '';
    return;
  }
  out.innerHTML = resultsHtml([], 'Haetaan…');
  try {
    const list = await searchPlaces(q, { fetchFn });
    if (seq !== searchSeq) return;
    state.found = list;
    out.innerHTML = resultsHtml(list, list.length ? '' : `Ei tuloksia haulle "${q}".`);
  } catch (e) {
    if (seq !== searchSeq) return;
    out.innerHTML = resultsHtml([], `Haku epäonnistui: ${e.message}`);
  }
}
const searchSoon = debounce(doSearch, 280);

// ---------- Valinta ja tekoälyn selitys ----------

const aiCache = new Map();
const AI_CACHE_MAX = 50;
let aiSeq = 0;
let aiAbort = null;

function selection() {
  return { type: 'now', label: 'nyt' };
}

/** Selityksen tunniste: sama paikka, valinta ja tunti + sateiden ajoitus. Näin selitystä ei pyydetä turhaan joka päivityksellä. */
function aiFingerprint() {
  const { fc, sel, place } = state;
  const { idx, local } = nowPosition(fc, nowMs());
  const wet = fc.hours
    .slice(idx, idx + 24)
    .map((h, i) => (h.precip >= 0.2 ? i : -1))
    .filter((i) => i >= 0)
    .join(',');
  void sel;
  return [placeKey(place), 'now', 'nyt', local.iso.slice(0, 13), wet, Math.round(fc.hours[idx].temp / 3), aiSettings.model(), aiMode()].join('|');
}

function syncAi({ immediate = false } = {}) {
  // Selitys näkyy vain chatin ensimmäisenä viestinä: Geminiä ei kutsuta, kun chat on kiinni
  if (!state.fc || !state.place?.name || state.sheet !== 'chat') return;
  const fp = aiFingerprint();
  if (state.ai.fp === fp && state.ai.status !== 'idle') return;
  const cached = aiCache.get(fp);
  if (cached) {
    state.ai = { status: 'done', text: cached, error: '', fp };
    renderAi();
    return;
  }
  state.ai = { status: geminiOn() ? 'loading' : 'idle', text: '', error: '', fp };
  renderAi();
  if (geminiOn()) {
    if (immediate) runAi();
    else runAiSoon();
  }
}

async function runAi({ force = false } = {}) {
  if (!state.fc || !state.place?.name || !geminiOn()) return;
  const fp = aiFingerprint();
  if (!force && aiCache.has(fp)) {
    state.ai = { status: 'done', text: aiCache.get(fp), error: '', fp };
    renderAi();
    return;
  }
  aiAbort?.abort();
  aiAbort = new AbortController();
  const mySeq = ++aiSeq;
  state.ai = { status: 'loading', text: '', error: '', fp };
  renderAi();
  try {
    const text = await explain({ fc: state.fc, place: state.place, nowMs: nowMs(), selection: selection(), results: state.results, mode: aiMode(), fetchFn, signal: aiAbort.signal });
    if (mySeq !== aiSeq) return;
    aiCache.set(fp, text);
    if (aiCache.size > AI_CACHE_MAX) aiCache.delete(aiCache.keys().next().value); // vanhin pois (Map säilyttää lisäysjärjestyksen)
    state.ai = { status: 'done', text, error: '', fp };
  } catch (e) {
    if (mySeq !== aiSeq || e?.kind === 'abort') return;
    state.ai = { status: 'error', text: '', error: e?.message || 'Tuntematon virhe', fp };
  }
  renderAi();
}
const runAiSoon = debounce(() => runAi(), 450);

/** Radan tunnin valinta näkyy etusivun sankarissa paikallaan: sivu ei vieritä minnekään. */
function select(sel) {
  state.sel = sel;
  renderAll();
}

// ---------- Päivityssilmukka ----------

let tickTimer = 0;

function tick() {
  if (!state.fc || state.loading) return;
  if (nowMs() - state.fetchedAt >= state.refreshMin * 60000 - 1000) {
    load();
    return;
  }
  void refreshNowcast();
  void refreshWarnings();
  void refreshObs();
  validateSelection();
  renderAll();
  updateSky();
  syncAi();
}

function startTimers() {
  clearInterval(tickTimer);
  tickTimer = setInterval(tick, 30000);
}

// ---------- Paneelit ----------

let lastFocus = null;
let hasEntry = false;
const TITLES = { search: 'Paikkakunta', settings: 'Asetukset', chat: 'Kysy SääÄlyltä', about: 'Tietoja ja tietolähteet' };

function sheetContent(kind) {
  if (kind === 'search') return searchSheetHtml({ recent: state.recent });
  if (kind === 'chat') return chatSheetHtml({ mode: aiMode(), hasKey: keyOn(), hasMessages: state.chat.length > 0 });
  if (kind === 'about') return aboutSheetHtml({ version: VERSION, demo: DEMO, sources: ['nowcast', 'warnings', 'obs', 'radarmap', 'cloudmap'].map((id) => sourceLine(id, sources.status(id), nowMs())) });
  return settingsSheetHtml({ hasKey: keyOn(), mode: aiMode(), model: aiSettings.model(), refreshMin: state.refreshMin, models: state.models, demo: DEMO, sens: state.sens, anim: store.bool('anim', true) });
}

// ---------- Kartta (Tutka ja Pilvet) ----------

let mapView = null;
let mapEntry = false;

function openMap(tab = 'radar') {
  if (state.sheet) closeSheet();
  if (!mapView) {
    mapView = createMapView($('#mapView'), {
      getPlace: () => state.place,
      getTz: () => state.fc?.tz || 'Europe/Helsinki',
      nowMs,
      fetchFn,
      fetchStatic: defaultFetch,
      demo: DEMO,
      scenario,
      cities: [...FI_CITIES, ...FOREIGN_CITIES],
      onSource: (id, ok, info) => (ok ? sources.ok(id, nowMs(), info) : sources.fail(id, info, nowMs())),
      onClose: () => {
        el.app.inert = false;
        el.fab.inert = false;
        sky?.start();
        if (mapEntry) {
          mapEntry = false;
          ignorePop = true;
          try {
            history.back();
          } catch {
            ignorePop = false;
          }
        }
      },
    });
  }
  if (mapView.isOpen) return;
  el.app.inert = true;
  el.fab.inert = true;
  sky?.stop();
  try {
    history.pushState({ saaalyMap: true }, '');
    mapEntry = true;
  } catch {
    mapEntry = false;
  }
  mapView.open(tab);
}

function openSheet(kind) {
  const already = Boolean(state.sheet);
  if (!already) lastFocus = document.activeElement;
  state.sheet = kind;
  el.panel.dataset.kind = kind;
  el.panel.setAttribute('aria-label', TITLES[kind]);
  el.panel.innerHTML = sheetContent(kind);
  if (kind === 'chat') {
    chatShown = 0;
    renderChat();
    syncAi();
  }
  el.sheet.hidden = false;
  el.app.inert = true;
  el.fab.inert = true;
  document.body.classList.add('sheet-open');
  if (!already) {
    requestAnimationFrame(() => el.sheet.classList.add('open'));
    sky?.stop();
    try {
      history.pushState({ saaalySheet: true }, '');
      hasEntry = true;
    } catch {
      hasEntry = false;
    }
  }
  setTimeout(() => (kind === 'search' ? $('#q', el.panel) : el.panel)?.focus({ preventScroll: true }), 60);
}

function closeSheet() {
  if (!state.sheet) return;
  state.sheet = null;
  el.sheet.classList.remove('open');
  el.app.inert = false;
  el.fab.inert = false;
  document.body.classList.remove('sheet-open');
  sky?.start();
  if (hasEntry) {
    // Oma merkintä pois historiasta; sen popstate ohitetaan, jotta alisivulla (Tunnit, Viikko, Varmuus) pysytään.
    hasEntry = false;
    ignorePop = true;
    try {
      history.back();
    } catch {
      ignorePop = false;
    }
  }
  setTimeout(() => {
    if (!state.sheet) el.sheet.hidden = true;
  }, 220);
  if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
}

function trapTab(ev) {
  const items = [...el.panel.querySelectorAll('button:not([disabled]), input:not([disabled]), select, textarea:not([disabled]), a[href], summary')].filter((n) => n.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const lastItem = items[items.length - 1];
  if (ev.shiftKey && (document.activeElement === first || document.activeElement === el.panel)) {
    ev.preventDefault();
    lastItem.focus();
  } else if (!ev.shiftKey && document.activeElement === lastItem) {
    ev.preventDefault();
    first.focus();
  }
}

// ---------- Chat ----------

/** Chat: uudet viestit lisätään loppuun (ruudunlukija lukee vain uuden viestin), tyhjä keskustelu piirretään kokonaan. */
let chatShown = 0;
function renderChat() {
  const box = $('#msgs');
  if (!box || state.sheet !== 'chat') return;
  const n = state.chat.length;
  box.querySelector('.typing')?.remove();
  if (n && box.dataset.mode === 'msgs' && n >= chatShown) {
    for (const m of state.chat.slice(chatShown)) box.insertAdjacentHTML('beforeend', messageHtml(m));
  } else {
    box.innerHTML = n ? state.chat.map(messageHtml).join('') : chatEmptyHtml({ mode: aiMode(), intro: chatIntro() });
    box.dataset.mode = n ? 'msgs' : 'empty';
  }
  chatShown = n;
  if (state.chatBusy) box.insertAdjacentHTML('beforeend', typingHtml);
  box.scrollTop = box.scrollHeight;
  const send = $('.send');
  if (send) send.disabled = state.chatBusy;
  const clear = $('#chatClear');
  if (clear) clear.hidden = !state.chat.length || state.chatBusy;
}

const placeData = new Map();

/** Minkä tahansa paikan yhdistetty ennuste (chat ja Geminin työkalu). Pidetään muistissa 10 min, jotta jatkokysymykset eivät hae uudelleen. */
async function forecastFor(place) {
  const key = placeKey(place);
  const hit = placeData.get(key);
  if (hit && nowMs() - hit.at < 10 * 60000) return hit;
  const results = await fetchAll(place.lat, place.lon, { fetchFn, now: nowMs() });
  let fc = null;
  try {
    fc = blendForecast(results, { nowMs: nowMs() });
  } catch {
    fc = null;
  }
  if (!fc) throw new Error(`yksikään säämalli ei vastannut. ${summarizeErrors(results)}`);
  const data = { at: nowMs(), fc, results };
  placeData.set(key, data);
  if (placeData.size > 8) placeData.delete(placeData.keys().next().value);
  return data;
}

async function runTool(name, args) {
  if (name !== 'get_forecast') throw new Error('Tuntematon työkalu');
  const q = String(args.place || '').trim();
  const found = await searchPlaces(q, { fetchFn, count: 3 });
  if (!found.length) throw new Error(`Paikkaa "${q}" ei löytynyt`);
  const p = found[0];
  const { fc, results } = await forecastFor(p);
  return { paikka: placeLabel(p), ...compactForecast(fc, nowMs(), { hours: 36, results }) };
}

/** Vastaa sovelluksen omalla laskennalla: ei tekoälyä eikä Gemini-kutsuja. */
async function internalAnswer(text) {
  const out = await answerQuestion(text, {
    place: state.place,
    fc: state.fc,
    results: state.results,
    nowMs: nowMs(),
    last: state.chatLast,
    sensitivity: state.sens,
    nowcast: currentNowcast(nowMs()),
    geocode: (q) => searchPlaces(q, { fetchFn, count: 5 }),
    forecastFor,
  });
  state.chatLast = out.last || null;
  return out;
}

/** Keskusteluhistoria Geminille: vuorottelevat roolit, alkaa käyttäjän viestillä, virheviestit pois. */
function chatHistory() {
  const out = [];
  for (const m of state.chat) {
    if (m.error) continue;
    const prev = out.at(-1);
    if (prev && prev.role === m.role) prev.text += `\n${m.text}`;
    else out.push({ role: m.role, text: m.text });
  }
  const tail = out.slice(-12);
  while (tail.length && tail[0].role !== 'user') tail.shift();
  return tail;
}

async function sendChat(text) {
  text = String(text || '').trim();
  if (!text || state.chatBusy) return;
  state.chat.push({ role: 'user', text });
  state.chatBusy = true;
  const ta = $('#msg');
  if (ta) {
    ta.value = '';
    ta.style.height = '';
  }
  renderChat();
  const mode = aiMode();
  let msg = null;
  let why = '';
  if (mode !== 'internal' && state.fc) {
    try {
      const out = await chat({ fc: state.fc, place: state.place, nowMs: nowMs(), history: chatHistory(), results: state.results, mode, runTool, fetchFn });
      msg = { role: 'assistant', text: out, src: mode === 'free' ? 'Gemini · sovelluksen data + yleistieto' : 'Gemini · data: sovelluksen säämallit' };
    } catch (e) {
      why = shortReason(e); // Gemini ei vastannut: vastataan sovelluksen omalla laskennalla ja kerrotaan syy
    }
  }
  if (!msg) {
    try {
      const out = await internalAnswer(text);
      const base = `Sovelluksen oma laskenta${out.used ? ` · ${out.used.models}/${out.used.total} mallia` : ''}`;
      msg = { role: 'assistant', text: out.text, src: why ? `Gemini ei vastannut (${why}) · ${base[0].toLowerCase()}${base.slice(1)}` : base };
    } catch (e) {
      msg = { role: 'assistant', text: `Vastaus epäonnistui: ${e?.message || 'tuntematon virhe'}`, error: true };
    }
  }
  state.chat.push(msg);
  state.chatBusy = false;
  renderChat();
}

// ---------- Vastausten lähde ----------

/** Päivittää kaikki näkyvät tilavalitsimet ja selitystekstin (chat-paneelissa ja asetuksissa) paikallaan. */
function refreshModeUi() {
  const eff = aiMode();
  const key = keyOn();
  document.querySelectorAll('.modebar .seg').forEach((b) => {
    const off = b.dataset.mode !== 'internal' && !key;
    b.setAttribute('aria-pressed', String(b.dataset.mode === eff));
    b.classList.toggle('off', off);
    if (off) b.setAttribute('aria-disabled', 'true');
    else b.removeAttribute('aria-disabled');
  });
  const note = $('#modeNote');
  if (note) note.textContent = modeNote({ mode: eff, hasKey: key });
}

function setMode(m) {
  aiSettings.setMode(m);
  refreshModeUi();
  state.ai = { status: 'idle', text: '', error: '', fp: '' };
  syncAi({ immediate: true });
  renderAi();
  if (!state.chat.length) renderChat(); // tyhjän keskustelun ohjeteksti riippuu tilasta
}

function pickMode(m) {
  if (m !== 'internal' && !keyOn()) {
    if (state.sheet !== 'settings') openSheet('settings');
    aiNote(DEMO ? 'Esimerkkitilassa Gemini ei ole käytössä.' : 'Lisää ensin Gemini-avain, niin voit käyttää Geminiä.', 'warn');
    return;
  }
  if (m === aiMode()) return;
  setMode(m);
}

// ---------- Asetukset ----------

const aiNote = (text, kind = '') => {
  const n = $('#aiNote');
  if (n) {
    n.textContent = text;
    n.dataset.kind = kind;
  }
};

function saveKey() {
  const input = $('#key');
  const v = input?.value.trim();
  if (!v) return aiNote('Liitä avain kenttään ja paina Tallenna.', 'warn');
  // Avain lähetetään HTTP-otsikossa: välilyönti, rivinvaihto tai muu kuin ASCII-merkki (esim. kopioitu viivasymboli) rikkoisi pyynnön tai viittaisi väärään tekstiin
  if (!/^[\x21-\x7e]+$/.test(v)) return aiNote('Avaimessa on merkkejä, joita Gemini-avaimessa ei ole (esimerkiksi välilyönti, rivinvaihto tai erikoismerkki). Liitä pelkkä avain.', 'warn');
  if (!aiSettings.setKey(v)) return aiNote('Avainta ei voitu tallentaa: selaimen tallennustila ei ole käytössä (esimerkiksi yksityinen selaus tai täysi tallennustila).', 'bad');
  if (aiSettings.mode() === 'internal') aiSettings.setMode('grounded'); // avaimen lisääjä haluaa yleensä Geminin käyttöön
  const m = $('#model')?.value.trim();
  if (m) aiSettings.setModel(m);
  openSheet('settings');
  aiNote('Avain tallennettu tähän laitteeseen. Voit testata yhteyden.', 'ok');
  state.ai = { status: 'idle', text: '', error: '', fp: '' };
  syncAi();
}

function clearKey() {
  aiSettings.setKey('');
  openSheet('settings');
  aiNote('Avain poistettu. Chat vastaa jatkossa sovelluksen omalla laskennalla.', 'ok');
  state.ai = { status: 'idle', text: '', error: '', fp: '' };
  renderAi();
}

async function testAi() {
  const key = aiSettings.key();
  if (!key) return aiNote('Lisää ensin avain.', 'warn');
  const model = $('#model')?.value.trim() || aiSettings.model();
  aiSettings.setModel(model);
  aiNote('Testataan…');
  const t0 = performance.now();
  try {
    const res = await generate({ key, model, contents: [{ role: 'user', parts: [{ text: 'Vastaa yhdellä sanalla: toimii' }] }], temperature: 0, fetchFn });
    aiNote(`Yhteys toimii. ${model} vastasi ${Math.round(performance.now() - t0)} ms (“${textOf(res).slice(0, 40)}”).`, 'ok');
  } catch (e) {
    aiNote(e.message + (e.status === 404 ? ' Paina "Hae mallit".' : ''), 'bad');
  }
}

async function findModels() {
  const key = aiSettings.key();
  if (!key) return aiNote('Lisää ensin avain.', 'warn');
  aiNote('Haetaan malleja…');
  try {
    const names = (await listModels({ key, fetchFn })).filter((n) => n.startsWith('gemini'));
    state.models = names;
    const list = $('#modelList');
    if (list) list.innerHTML = names.map((n) => `<option value="${esc(n)}"></option>`).join('');
    const best = pickFlash(names);
    const current = $('#model')?.value.trim();
    if (best && current && !names.includes(current)) {
      $('#model').value = best;
      aiNote(`Löytyi ${names.length} mallia. Mallia "${current}" ei ole, ehdotus: ${best}. Paina Testaa yhteys.`, 'warn');
    } else {
      aiNote(`Löytyi ${names.length} mallia${best ? `. Uusin Flash: ${best}` : ''}.`, 'ok');
    }
  } catch (e) {
    aiNote(e.message, 'bad');
  }
}

let diagText = '';

async function runDiagnostics() {
  const out = $('#diag');
  if (!out) return;
  const lines = [];
  const push = (s) => {
    lines.push(s);
    diagText = lines.join('\n');
    out.textContent = diagText;
    out.scrollTop = out.scrollHeight;
  };
  const t = nowMs();
  const p = state.place;
  push(`SääÄly ${VERSION}, diagnostiikka${DEMO ? ' (ESIMERKKITILA, data tekaistua)' : ''}`);
  push(`Laitteen aika: ${new Date(t).toString()}`);
  push(`Laitteen aikavyöhyke: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  push(`Verkko: ${navigator.onLine ? 'online' : 'OFFLINE'}, suojattu yhteys: ${globalThis.isSecureContext}, sijaintilupa: ${await geoPermission()}`);
  push(`Selain: ${navigator.userAgent}`);
  push(`Paikka: ${p ? `${p.name || '(nimi puuttuu)'}, ${p.region || '-'} (${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}) [${p.mode}]` : '-'}`);
  if (!p) return;
  push('');
  push('Säämallit (haetaan uudelleen ilman välimuistia):');
  const results = await fetchAll(p.lat, p.lon, { fetchFn, noCache: true, now: t });
  for (const r of results) {
    if (!r.ok) {
      const why = r.skipped ? 'ei saatavilla, ohitettu' : r.coverage ? 'ei kata tätä paikkaa (normaalia alueelliselle mallille)' : r.error;
      push(`  ${r.coverage ? '–' : '✗'} ${r.model.short} (${r.id}): ${why}`);
      continue;
    }
    // Sama interpolointi kuin yhdistelmässä, jotta mallien luvut ja yhdistelmä ovat vertailukelpoisia.
    const ln = localNow(t, r.data.tz);
    const i = r.data.time.indexOf(ln.iso.slice(0, 13) + ':00');
    const arr = r.data.vars.temperature_2m;
    const a = i >= 0 ? arr[i] : null;
    const b = i >= 0 && arr[i + 1] != null ? arr[i + 1] : a;
    const v = a == null ? null : a + (b - a) * (ln.minute / 60);
    push(`  ✓ ${r.model.short} (${r.id}) ${r.ms} ms, nyt ${v == null ? 'ei arvoa' : fmtTemp(v, { digits: 1 })}, aikasarja ${r.data.time[0].slice(5, 10)}…${r.data.time.at(-1).slice(5, 10)}`);
  }
  try {
    const fc = blendForecast(results, { nowMs: t });
    const { idx, frac, local } = nowPosition(fc, t);
    const s = snapshot(fc, idx, frac);
    push(`Aikavyöhyke ${fc.tz}, paikallinen aika nyt ${local.iso.slice(11)}`);
    push(`Yhdistelmä nyt: ${fmtTemp(s.temp, { digits: 1 })}, hajonta ${fmtNum(s.spread, 1)}°, ${fc.modelsUsed}/${fc.modelsTotal} mallia`);
    push(/suomi|finland/i.test(p.country || '') ? 'Vertaa tätä lukua Ilmatieteen laitoksen havaintoon lähimmältä asemalta.' : 'Vertaa tätä lukua paikalliseen havaintoon tai toiseen sääsovellukseen.');
  } catch (e) {
    push(`Yhdistely epäonnistui: ${e.message}`);
  }
  push('');
  try {
    const found = await searchPlaces('Turku', { fetchFn });
    push(`Paikkahaku: ✓ ${found.length} tulosta`);
  } catch (e) {
    push(`Paikkahaku: ✗ ${e.message}`);
  }
  const geo = await reverseGeocode(p.lat, p.lon, { fetchFn });
  push(`Paikannimi: ${geo.name || '-'} (${geo.source})${geo.errors?.length ? `, varalle siirryttiin: ${geo.errors.join('; ')}` : ''}`);
  const key = aiSettings.key();
  if (state.fc) {
    const t1 = performance.now();
    try {
      const out = await answerQuestion('Sataako huomenna?', { place: state.place, fc: state.fc, results: state.results, nowMs: t, last: null, geocode: async () => [], forecastFor });
      push(`Oma vastausmoottori: ${out.text ? '✓' : '✗ tyhjä vastaus'} ${Math.round(performance.now() - t1)} ms (chat-tila: ${aiMode() === 'internal' ? 'oma laskenta' : `Gemini, ${aiMode() === 'free' ? 'vapaa' : 'vain sovelluksen data'}`})`);
    } catch (e) {
      push(`Oma vastausmoottori: ✗ ${e.message}`);
    }
  }
  if (DEMO) push('Gemini: ei käytössä esimerkkitilassa');
  else if (!key) push('Gemini: ei avainta');
  else {
    const t0 = performance.now();
    try {
      await generate({ key, model: aiSettings.model(), contents: [{ role: 'user', parts: [{ text: 'Vastaa: ok' }] }], temperature: 0, fetchFn });
      push(`Gemini: ✓ ${aiSettings.model()} vastasi ${Math.round(performance.now() - t0)} ms`);
    } catch (e) {
      push(`Gemini: ✗ ${e.message}${e.details ? ` [${String(e.details).slice(0, 120)}]` : ''}`);
    }
  }
  await probeSources(push, p, t);
  push('');
  push('Valmis.');
}

/** Kokeilee valinnaiset lähteet oikeasti (ohittaa tauon), jotta CORS-esto tai verkkovika näkyy tässä eikä käyttäjälle virheenä. */
async function probeSources(push, p, t) {
  push('');
  push('Valinnaiset lähteet (sovellus toimii ilman niitä):');
  const t0 = performance.now();
  const r = await runSource(sources, 'nowcast', () => fetchNowcast(p.lat, p.lon, { fetchFn }), { force: true, now: t });
  const ms = Math.round(performance.now() - t0);
  if (r.value) {
    state.nc = { raw: r.value, key: ncKey(p), at: t, ttl: NC_TTL };
    const s = summarizeNowcast(r.value, t);
    push(`  ✓ Tutkaennuste (MET Norway) ${ms} ms, ${r.value.steps.length} askelta${s.ok ? `: ${s.line}` : ''}`);
  } else if ('value' in r) push(`  – Tutkaennuste: ei kata tätä paikkaa (${r.reason})`);
  else if (r.error) push(`  ✗ Tutkaennuste: ${await explainFetchError(r.error, nowcastUrl(p.lat, p.lon))}`);
  else push(`  – Tutkaennuste: ohitettu (${r.skipped})`);
  if (!inFinland(p.lat, p.lon)) return push('  – Viralliset varoitukset: koskevat vain Suomea');
  const t1 = performance.now();
  const w = await runSource(sources, 'warnings', () => fetchWarnings({ fetchFn }), { force: true, now: t });
  const wms = Math.round(performance.now() - t1);
  if (w.value) {
    state.warn = { raw: w.value.alerts, at: t };
    push(`  ✓ Viralliset varoitukset (Ilmatieteen laitos, GitHub-peilin kautta) ${wms} ms, ${w.value.note}; ${officialRows(w.value.alerts, p.lat, p.lon, t).length} tällä paikalla`);
  } else if ('value' in w) push(`  – Viralliset varoitukset: ${w.reason}`);
  else if (w.error) push(`  ✗ Viralliset varoitukset: ${await explainFetchError(w.error, MIRROR_URL)}`);
  else push(`  – Viralliset varoitukset: ohitettu (${w.skipped})`);
}

/**
 * Selittää, miksi haku epäonnistui. Selain ei kerro CORS-estoa verkkovirheestä (molemmat ovat TypeError), joten asia selvitetään erikseen:
 * no-cors-haku onnistuu, jos palvelu vastaa mutta ei salli lukemista (CORS), ja selaimen tietoturvailmoitus kertoo, jos CSP esti haun.
 */
async function explainFetchError(err, url) {
  if (!(err instanceof TypeError)) return err?.message || String(err);
  let csp = '';
  const onViolation = (ev) => {
    csp = `${ev.violatedDirective || 'connect-src'}${ev.blockedURI ? ` esti ${ev.blockedURI}` : ''}`;
  };
  document.addEventListener('securitypolicyviolation', onViolation);
  try {
    await fetchFn(url, { mode: 'no-cors', cache: 'no-store' });
    return 'palvelu vastaa, mutta selain ei anna sovelluksen lukea vastausta (palvelu ei salli hakua selaimesta, CORS)';
  } catch {
    await new Promise((r) => setTimeout(r, 60)); // tietoturvailmoitus saapuu tapahtumana hieman haun hylkäämisen jälkeen
    return csp ? `selaimen tietoturvapolitiikka (CSP) esti haun (${csp})` : 'palveluun ei saatu yhteyttä (verkko, DNS tai palvelu ei vastaa)';
  } finally {
    document.removeEventListener('securitypolicyviolation', onViolation);
  }
}

async function copyDiag() {
  const text = diagText || $('#diag')?.textContent || '';
  const btn = $('[data-act="diag-copy"]');
  if (!text) {
    if (btn) btn.textContent = 'Aja ensin diagnostiikka';
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch {
      /* ei onnistunut */
    }
    ta.remove();
  }
  if (btn) {
    btn.textContent = 'Kopioitu';
    setTimeout(() => (btn.textContent = 'Kopioi raportti'), 1600);
  }
}

function wipeAll() {
  if (!confirm('Tyhjennetäänkö kaikki tallennetut tiedot tältä laitteelta (paikka, Gemini-avain, asetukset)?')) return;
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('saaaly.'))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ei väliä */
  }
  location.reload();
}

// ---------- Tapahtumat ----------

const ACTIONS = {
  close: () => closeSheet(),
  'open-search': () => openSheet('search'),
  'open-settings': () => openSheet('settings'),
  'open-chat': () => openSheet('chat'),
  'open-map': (t) => openMap(t.dataset.tab || 'radar'),
  'open-about': () => openSheet('about'),
  'update-app': () => updateApp(),
  'mg-range': (t) => {
    const r = t.dataset.range;
    if (!Object.hasOwn(MG_RANGES, r) || r === state.mg.range) return;
    state.mg = { range: r, inspectIso: null };
    store.set('mgRange', r);
    renderMeteo();
  },
  'ask-open': (t) => {
    openSheet('chat');
    sendChat(t.dataset.q);
  },
  'welcome-locate': () => {
    state.first = false;
    locate();
  },
  'welcome-city': (t) => {
    const c = FI_CITIES.find((x) => x[0] === t.dataset.city);
    if (!c) return;
    state.first = false;
    setPlace({ name: c[0], region: c[3], country: 'Suomi', lat: c[1], lon: c[2], mode: 'manual' });
    rememberRecent(state.place);
  },
  'open-diag': () => {
    openSheet('settings');
    const adv = $('#advSet', el.panel);
    if (adv) adv.open = true;
    setTimeout(runDiagnostics, 80);
  },
  'open-adv': () => {
    openSheet('settings');
    const adv = $('#advSet', el.panel);
    if (adv) {
      adv.open = true;
      setTimeout(() => adv.scrollIntoView({ block: 'start' }), 80);
    }
  },
  page: (t) => goPage(+t.dataset.page || 0),
  hrow: (t) => {
    const iso = t.dataset.iso;
    state.hourOpen = state.hourOpen === iso ? null : iso;
    renderHours();
  },
  'hours-more': () => {
    state.hoursMore = !state.hoursMore;
    renderHours();
  },
  'hours-view': (t) => {
    const v = t.dataset.view === 'chart' ? 'chart' : 'list';
    if (v === state.hoursView) return;
    state.hoursView = v;
    store.set('hoursView', v);
    renderHours();
  },
  locate: () => locate(),
  refresh: () => load({ manual: true }),
  now: () => select({ type: 'now' }),
  hour: (t) => select(state.sel.type === 'hour' && state.sel.iso === t.dataset.iso ? { type: 'now' } : { type: 'hour', iso: t.dataset.iso }),
  day: (t) => {
    const date = t.dataset.date;
    state.dayOpen = state.dayOpen === date ? null : date;
    state.dayScrolled = '';
    renderWeek();
    if (state.dayOpen)
      requestAnimationFrame(() => {
        const box = $('.day-hours', el.daily);
        if (box) box.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
      });
  },
  vday: (t) => {
    const d = t.dataset.day === 'tomorrow' ? 'tomorrow' : 'today';
    if (d === state.vday) return;
    state.vday = d;
    state.sel = { type: 'now' };
    state.hourOpen = null;
    renderAll();
  },
  'ai-run': () => runAi({ force: true }),
  pick: (t) => pickPlace(state.found[+t.dataset.i]),
  'pick-recent': (t) => pickPlace(state.recent[+t.dataset.i]),
  ask: (t) => sendChat(t.dataset.q),
  mode: (t) => pickMode(t.dataset.mode),
  'mode-on': () => pickMode(aiSettings.mode() === 'internal' ? 'grounded' : aiSettings.mode()),
  'chat-clear': () => {
    state.chat = [];
    state.chatLast = null;
    renderChat();
  },
  'save-key': saveKey,
  'clear-key': clearKey,
  'list-models': findModels,
  'test-ai': testAi,
  diag: runDiagnostics,
  'diag-copy': copyDiag,
  wipe: wipeAll,
};

/** Vedä alas päivittääksesi: sivun yläreunasta vetäminen päivittää tiedot (ei lataa sivua uudelleen). Päivitys on rajattu 60 sekuntiin. */
const PTR_THRESHOLD = 72;
const PTR_COOLDOWN_MS = 60000;

function bindPullToRefresh() {
  const ind = $('#ptr');
  if (!ind) return;
  let y0 = null;
  let x0 = 0;
  let pulled = 0;
  const reset = () => {
    y0 = null;
    pulled = 0;
    ind.hidden = true;
    ind.style.transform = '';
    ind.dataset.ready = '0';
  };
  document.addEventListener(
    'touchstart',
    (ev) => {
      const t = ev.target;
      const inStrip = t.closest?.('.dstrip, #mgWrap, .sheet, textarea, input, select');
      const page = t.closest?.('.page');
      if (state.sheet || inStrip || !page || page.scrollTop > 0 || ev.touches.length !== 1) y0 = null;
      else (y0 = ev.touches[0].clientY), (x0 = ev.touches[0].clientX), (pulled = 0);
    },
    { passive: true },
  );
  document.addEventListener(
    'touchmove',
    (ev) => {
      if (y0 == null) return;
      // Sivujen vaakapyyhkäisy ei ole päivitysveto
      if (Math.abs(ev.touches[0].clientX - x0) > Math.abs(ev.touches[0].clientY - y0) + 6) {
        reset();
        return;
      }
      pulled = Math.max(0, ev.touches[0].clientY - y0);
      if (pulled < 12) return;
      ind.hidden = false;
      ind.dataset.ready = pulled >= PTR_THRESHOLD ? '1' : '0';
      ind.style.transform = `translate(-50%, ${Math.min(pulled, 110) - 52}px) rotate(${Math.min(pulled, 110) * 2}deg)`;
    },
    { passive: true },
  );
  const end = () => {
    if (y0 == null) return;
    const go = pulled >= PTR_THRESHOLD;
    reset();
    if (!go || state.loading) return;
    if (state.fc && nowMs() - state.fetchedAt < PTR_COOLDOWN_MS) {
      setBanner({ id: 'fresh', kind: 'info', text: `Tiedot ovat tuoreet, päivitetty ${agoText(nowMs() - state.fetchedAt)}.` });
      setTimeout(() => state.banner?.id === 'fresh' && setBanner(null), 3500);
    } else load({ manual: true });
  };
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', reset, { passive: true });
}

function bindEvents() {
  bindPullToRefresh();
  bindMeteo();
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest?.('[data-act]');
    const fn = t && ACTIONS[t.dataset.act];
    if (fn) fn(t, ev);
  });

  document.addEventListener('submit', (ev) => {
    const kind = ev.target.dataset?.form;
    if (!kind) return;
    ev.preventDefault();
    if (kind === 'search') doSearch();
    if (kind === 'chat') sendChat($('#msg')?.value);
  });

  document.addEventListener('input', (ev) => {
    if (ev.target.id === 'q') searchSoon();
    if (ev.target.id === 'msg') {
      ev.target.style.height = 'auto';
      ev.target.style.height = Math.min(ev.target.scrollHeight, 124) + 'px';
    }
  });

  document.addEventListener('change', (ev) => {
    if (ev.target.id === 'sens') {
      const v = Math.max(-3, Math.min(3, Number(ev.target.value) || 0));
      state.sens = v;
      store.set('sens', v);
      renderAll();
    }
    if (ev.target.id === 'anim') {
      const on = ev.target.value !== 'off';
      store.set('anim', on);
      sky?.setAnimated(on);
    }
    if (ev.target.id === 'refresh') {
      const v = Number(ev.target.value);
      if (REFRESH_OPTIONS.includes(v)) {
        state.refreshMin = v;
        store.set('refreshMin', v);
      }
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (state.sheet && ev.key === 'Escape') closeSheet();
    else if (state.sheet && ev.key === 'Tab') trapTab(ev);
    else if (ev.target.id === 'msg' && ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing && matchMedia('(pointer: fine)').matches) {
      ev.preventDefault();
      sendChat(ev.target.value);
    }
  });

  window.addEventListener('popstate', () => {
    if (mapView?.isOpen) {
      mapEntry = false;
      mapView.close();
      return;
    }
    if (state.sheet) {
      hasEntry = false;
      closeSheet();
      return;
    }
    if (ignorePop) {
      ignorePop = false;
      return;
    }
    if (state.page > 0) {
      pageEntry = false;
      goPage(0);
    }
  });
  if (el.pages) {
    // Sivun alue alkaa yläpalkin ja ilmoitusten alta: paikka luetaan virrassa olevasta varauksesta.
    const slot = $('#pagesSlot');
    const measureTop = () => el.pages.style.setProperty('--top-h', `${slot ? slot.offsetTop : 0}px`);
    measureTop();
    if (typeof ResizeObserver === 'function' && slot) new ResizeObserver(measureTop).observe(slot);
    const chrome = createCubeChrome({
      app: el.app,
      faces: [...el.pages.querySelectorAll('.face')],
      sky: $('#sky'),
      skyVersion: () => sky?.frames?.() ?? NaN,
      chrome: () => [$('.top', el.app), el.banner, el.welcome, el.fab],
    });
    cube = createCube(el.pages, {
      onSettle: onPageChange,
      onTurn: markDot,
      onEnter: chrome.enter,
      onFrame: chrome.frame,
      onRest: chrome.rest,
      reduceMotion,
      // Näiden vaakaveto kuuluu niille itselleen: päivän tuntinauha ja sääkaavion tarkastelu.
      ignore: '.dstrip, #mgWrap, input, textarea, select',
    });
  }
  if (typeof ResizeObserver === 'function' && el.pgHome) new ResizeObserver(() => sizeStage()).observe(el.pgHome);
  window.addEventListener('resize', debounce(() => cube?.layout(), 120));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      tick();
      checkForUpdate();
      sky?.poke();
    }
  });
  window.addEventListener('offline', () => {
    if (!DEMO) staleBanner();
  });
  window.addEventListener('online', () => {
    load();
    checkForUpdate();
  });
  // Animaatio pysähtyy, kun ruutuun ei kosketa (akku): kosketus, vieritys tai näppäin herättää sen.
  for (const type of ['pointerdown', 'touchstart', 'keydown']) document.addEventListener(type, () => sky?.poke(), { passive: true, capture: true });
  document.addEventListener('scroll', () => sky?.poke(), { passive: true, capture: true });
}

// ---------- Käynnistys ----------

function registerWorker() {
  if (DEMO || !('serviceWorker' in navigator)) return;
  if (!(location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

/** Aloitusnäytön pikakuvakkeet (manifest.webmanifest: shortcuts): ?avaa=kysy, kartta, tunnit tai viikko. */
function openShortcut() {
  const what = params.get('avaa');
  if (!what) return;
  try {
    const u = new URL(location.href);
    u.searchParams.delete('avaa'); // uudelleenlataus ei avaa samaa uudelleen
    history.replaceState(history.state, '', u.pathname + u.search + u.hash);
  } catch {
    /* ei väliä */
  }
  if (what === 'kysy') openSheet('chat');
  else if (what === 'kartta') openMap('radar');
  else if (what === 'tunnit') goPage(1, { smooth: false });
  else if (what === 'viikko') goPage(2, { smooth: false });
}

async function boot() {
  initSky();
  bindEvents();
  if (!DEMO && store.num('schema', 0) < SCHEMA) store.set('schema', SCHEMA); // tulevat tallennuksen muutokset siirretään tämän numeron perusteella
  const saved = DEMO ? null : store.object('place');
  const usable = saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lon) ? saved : null;
  const first = !usable && !DEMO;
  state.place = DEMO ? { ...DEMO_PLACE } : usable || { ...DEFAULT_PLACE };
  skyIdle();
  if (restoreCache()) updateSky(true);
  renderAll();
  if (DEMO) setBanner({ kind: 'info', text: `Esimerkkitila: sää ja paikannimet ovat tekaistuja${scenario !== 'mixed' ? ` (${scenario})` : ''}.` });

  // Ensimmäisellä käynnistyksellä ei kysytä sijaintilupaa kylmiltään: näytetään kortti, ja selain kysyy vasta napin painalluksesta.
  // Jos lupa on jo annettu, paikannetaan heti ilman ylimääräistä oletuspaikan hakua (yksi haku kahden sijaan).
  if (first) {
    const perm = await geoPermission();
    if (perm === 'granted') locate({ quiet: false });
    else {
      state.first = true;
      state.place = { ...DEFAULT_PLACE, note: 'oletuspaikka' };
      renderAll();
      if (perm === 'denied') setBanner({ kind: 'warn', text: 'Sijaintilupa on estetty. Valitse paikkakunta tai salli sijainti selaimen sivuasetuksista.' });
      load();
    }
  } else {
    load();
    if (state.fc) syncAi({ immediate: true });
    // Tallennettu GPS-paikka: tarkistetaan hiljaa, onko käyttäjä siirtynyt (yli 3 km), kun lupa on jo annettu.
    if (!DEMO && usable?.mode === 'gps' && (await geoPermission()) === 'granted') locate({ quiet: true });
  }
  if (!state.place.name && !first) {
    // Tallennetulta paikalta puuttui nimi (sovellus suljettiin kesken haun)
    reverseGeocode(state.place.lat, state.place.lon, { fetchFn }).then((geo) => {
      Object.assign(state.place, { name: geo.name, region: geo.region, country: geo.country, note: geo.note || '' });
      persistPlace();
      renderAll();
      syncAi({ immediate: true });
    });
  }
  openShortcut();
  startTimers();
  if (document.readyState === 'complete') registerWorker();
  else window.addEventListener('load', registerWorker);
  setTimeout(checkForUpdate, 4000, { force: true });
}

globalThis.__saaaly = { state, VERSION, BUILD, load, select, checkForUpdate, explainFetchError, goPage, openMap, get cube() { return cube; }, get map() { return mapView; } };
boot();

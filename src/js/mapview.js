// mapview.js: koko näytön kartta, välilehdet Tutka (havaittu sade 2 h, RainViewer) ja Pilvet (pilvisyys ja sade
// seuraavalle vuorokaudelle, Open-Meteon monen pisteen ennuste). Pohjakartta on sovelluksen oma (Natural Earth),
// joten karttapohjaa ei haeta muualta eikä sijainti lähde karttapalveluille.
// Kartta liikkuu sormella, zoomautuu nipistämällä, kaksoisnapautuksella ja painikkeilla. Esimerkkitilassa sää on keksittyä.

import { makeView, panView, zoomView, resizeView, project, unproject, tileZoom, tilesFor, radarTileUrl, pickFrames, decodeBasemap, pickBasemap, drawBasemap, placeLabels, makeGrid, gridCovers, gridUrl, parseGrid, sampleGrid, cloudColor, precipColor, paintField, edgeFade, viewFrom } from './geomap.js';
import { syntheticMapWx } from './demo.js';
import { partsIn, localNow, escapeHtml as esc } from './util.js';

export const RV_JSON = 'https://api.rainviewer.com/public/weather-maps.json';
const MAP_DIR = 'maps/'; // julkaisussa sama kansio kuin sivu (tools/build.mjs korvaa)
const BASEMAPS = [
  ['nordic', [4, 53, 45, 72.5]],
  ['europe', [-32, 26, 50, 72.5]],
];
const KM = { radar: 320, cloud: 480 };
const RV_TTL = 5 * 60000;
const GRID_TTL = 30 * 60000;
const MAX_LOADS = 6; // samanaikaiset tiilihaut (RainViewerin raja on 100 pyyntöä minuutissa)

const PALETTE = {
  light: { water: '#cfdff2', land: '#f6f1fa', coast: 'rgba(110, 128, 182, 0.42)', border: 'rgba(124, 98, 176, 0.5)' },
  dark: { water: '#121733', land: '#262a52', coast: 'rgba(160, 172, 236, 0.3)', border: 'rgba(196, 176, 255, 0.4)' },
};

function withTimeout(fetchFn, url, ms) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), ms);
  return fetchFn(url, ctl ? { signal: ctl.signal } : undefined).finally(() => clearTimeout(timer));
}

/** Tutkan aikateksti: "klo 10.40 · 20 min sitten" tai "klo 11.00 · uusin". */
export function radarTimeText(tMs, nowMs, tz, newest) {
  const p = partsIn(tMs, tz);
  const clock = `klo ${p.h}.${String(p.mi).padStart(2, '0')}`;
  const ago = Math.max(0, Math.round((nowMs - tMs) / 60000));
  const agoText = ago >= 60 ? `${Math.floor(ago / 60)} t${ago % 60 ? ` ${ago % 60} min` : ''} sitten` : `${ago} min sitten`;
  if (newest) return `${clock} · uusin${ago >= 15 ? `, ${agoText}` : ''}`;
  return `${clock} · ${agoText}`;
}

/** Ennusteen aikateksti: "nyt", "tänään klo 14", "huomenna klo 6" tai viikonpäivä. */
export function forecastTimeText(tMs, nowMs, tz) {
  if (Math.abs(tMs - nowMs) < 30 * 60000) return 'nyt';
  const a = localNow(nowMs, tz);
  const b = localNow(tMs, tz);
  const day = b.date === a.date ? 'tänään' : Date.parse(`${b.date}T00:00Z`) - Date.parse(`${a.date}T00:00Z`) === 86400000 ? 'huomenna' : ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'][new Date(`${b.date}T12:00Z`).getUTCDay()];
  if (b.hour === 0) return day === 'huomenna' ? 'keskiyöllä' : `${day} klo 00`;
  return `${day} klo ${b.hour}`;
}

export function createMapView(root, { getPlace, getTz = () => 'Europe/Helsinki', nowMs = () => Date.now(), fetchFn = (...a) => fetch(...a), fetchStatic = (...a) => fetch(...a), demo = false, scenario = 'mixed', cities = [], onClose = () => {}, onSource = () => {} } = {}) {
  const $ = (s) => root.querySelector(s);
  const stage = $('.mv-stage');
  const baseCv = $('.mv-base');
  const wxCv = $('.mv-wx');
  const marks = $('.mv-marks');
  const statusEl = $('.mv-status');
  const timeEl = $('.mv-time');
  const range = $('.mv-range');
  const playBtn = $('.mv-play');
  const legend = $('.mv-legend');
  const attr = $('.mv-attr');
  const S = {
    open: false,
    tab: 'radar',
    view: null,
    dpr: 1,
    maps: {},
    mapName: null,
    frames: [],
    frame: 0,
    host: '',
    rvJson: null,
    rvAt: 0,
    grid: null,
    gridData: null,
    gridAt: 0,
    hour: 0,
    playing: false,
    timer: 0,
    seq: 0,
    lastFocus: null,
  };
  const tiles = new Map(); // url -> { img, ok }
  const queue = [];
  let loading = 0;
  let wxRaf = 0;
  const off = typeof document !== 'undefined' ? document.createElement('canvas') : null; // pienoiskangas kentille

  const dark = () => !document.body.classList.contains('light');
  const place = () => getPlace() || { lat: 60.17, lon: 24.94 };

  // ---------- Piirto ----------

  function sizeCanvases() {
    const w = Math.max(1, stage.clientWidth);
    const h = Math.max(1, stage.clientHeight);
    S.dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    for (const cv of [baseCv, wxCv]) {
      cv.width = Math.round(w * S.dpr);
      cv.height = Math.round(h * S.dpr);
    }
    return [w, h];
  }

  function drawBase() {
    const ctx = baseCv.getContext('2d');
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    drawBasemap(ctx, S.view, S.maps[S.mapName] || null, PALETTE[dark() ? 'dark' : 'light']);
  }

  function drawMarks() {
    const p = place();
    const me = project(S.view, p.lon, p.lat);
    // Nimet eivät jää painikkeiden ja paneelin alle.
    const sr = stage.getBoundingClientRect();
    const avoid = ['.mv-top', '.mv-zoom', '.mv-panel']
      .map((q) => $(q)?.getBoundingClientRect())
      .filter((r) => r && r.width)
      .map((r) => ({ x0: r.left - sr.left - 4, y0: r.top - sr.top - 4, x1: r.right - sr.left + 4, y1: r.bottom - sr.top + 4 }));
    const labels = placeLabels(S.view, cities, { skip: me, skipW: p.name ? p.name.length * 7.4 + 26 : 0, avoid });
    const own = p.name ? `<span class="mv-label mv-here" style="left:${(me[0] + 12).toFixed(1)}px;top:${me[1].toFixed(1)}px">${esc(p.name)}</span>` : '';
    marks.innerHTML =
      labels.map((l) => `<span class="mv-label" style="left:${l.x.toFixed(1)}px;top:${l.y.toFixed(1)}px">${esc(l.name)}</span>`).join('') +
      own +
      `<i class="mv-me" style="left:${me[0].toFixed(1)}px;top:${me[1].toFixed(1)}px"></i>`;
  }

  function fieldLayer(sample) {
    const step = 4;
    const W = Math.ceil(S.view.w / step);
    const H = Math.ceil(S.view.h / step);
    off.width = W;
    off.height = H;
    const octx = off.getContext('2d');
    const img = octx.createImageData(W, H);
    paintField(img, S.view, step, sample);
    octx.putImageData(img, 0, 0);
    return off;
  }

  function drawWx() {
    wxRaf = 0;
    const ctx = wxCv.getContext('2d');
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ctx.clearRect(0, 0, S.view.w, S.view.h);
    ctx.imageSmoothingEnabled = true;
    if (S.tab === 'radar') {
      const f = S.frames[S.frame];
      if (!f) return;
      if (demo) {
        const layer = fieldLayer((lon, lat) => {
          const w = syntheticMapWx(lon, lat, f.t, scenario, S.anchor);
          return precipColor(w.precip, 0);
        });
        ctx.drawImage(layer, 0, 0, S.view.w, S.view.h);
        return;
      }
      ctx.globalAlpha = 0.9;
      for (const t of tilesFor(S.view, tileZoom(S.view))) {
        const e = tiles.get(radarTileUrl(S.host, f.path, t));
        if (e?.ok) ctx.drawImage(e.img, t.px, t.py, t.size, t.size);
      }
      ctx.globalAlpha = 1;
      return;
    }
    const d = S.gridData;
    if (!d || !S.grid) return;
    const k = S.hour;
    const g = S.grid;
    const darkMode = dark();
    const layer = fieldLayer((lon, lat) => {
      const fade = edgeFade(g, lon, lat);
      if (!(fade > 0)) return null;
      const cl = cloudColor(sampleGrid(g, d.cloud[k], lon, lat), darkMode);
      const mm = sampleGrid(g, d.precip[k], lon, lat);
      const sn = sampleGrid(g, d.snow[k], lon, lat);
      const pr = precipColor(mm, mm > 0 ? Math.min(1, (sn * 0.7) / Math.max(mm, 0.01)) : 0, darkMode);
      let c = cl;
      if (pr) c = c ? mix(c, pr) : pr;
      return c ? [c[0], c[1], c[2], c[3] * fade] : null;
    });
    ctx.drawImage(layer, 0, 0, S.view.w, S.view.h);
  }

  const mix = (under, over) => {
    const a = over[3] + under[3] * (1 - over[3]);
    const f = (i) => (over[i] * over[3] + under[i] * under[3] * (1 - over[3])) / (a || 1);
    return [f(0), f(1), f(2), a];
  };

  const queueWx = () => {
    if (!wxRaf) wxRaf = requestAnimationFrame(drawWx);
  };

  function drawAll() {
    if (!S.view) return;
    const name = pickBasemap(S.view, BASEMAPS);
    if (name && !S.maps[name]) loadBasemap(name);
    S.mapName = name;
    drawBase();
    drawMarks();
    drawWx();
  }

  // ---------- Pohjakartta ----------

  const mapLoads = {};
  function loadBasemap(name) {
    if (mapLoads[name]) return mapLoads[name];
    const inline = globalThis.SAAALY_MAPS?.[name];
    mapLoads[name] = (inline ? Promise.resolve(inline) : fetchStatic(`${MAP_DIR}map-${name}.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`pohjakartta ${r.status}`)))))
      .then((data) => {
        S.maps[name] = decodeBasemap(data);
        if (S.open && S.mapName === name) {
          drawBase();
        }
      })
      .catch(() => {
        delete mapLoads[name];
      });
    return mapLoads[name];
  }

  // ---------- Tutka ----------

  function pump() {
    while (loading < MAX_LOADS && queue.length) {
      const url = queue.shift();
      const e = tiles.get(url);
      if (!e || e.started) continue;
      e.started = true;
      loading++;
      e.img.onload = () => {
        loading--;
        e.ok = true;
        if (S.open && S.tab === 'radar') queueWx();
        pump();
      };
      e.img.onerror = () => {
        loading--;
        e.failed = true;
        pump();
      };
      e.img.src = url;
    }
  }

  function wantTiles() {
    if (demo || !S.frames.length) return;
    const ts = tilesFor(S.view, tileZoom(S.view));
    const order = [S.frames.length - 1, ...S.frames.map((_, i) => i).filter((i) => i !== S.frames.length - 1)];
    queue.length = 0;
    for (const i of order) {
      for (const t of ts) {
        const url = radarTileUrl(S.host, S.frames[i].path, t);
        if (!tiles.has(url)) {
          const img = new Image();
          img.decoding = 'async';
          tiles.set(url, { img, ok: false });
        }
        const e = tiles.get(url);
        if (!e.started) queue.push(url);
      }
    }
    pump();
  }

  async function loadRadar() {
    const seq = ++S.seq;
    const now = nowMs();
    if (demo) {
      const last = Math.floor(now / 600000) * 600000;
      S.frames = Array.from({ length: 7 }, (_, i) => ({ t: last - (6 - i) * 1200000, path: '' }));
      S.frame = S.frames.length - 1;
      status('');
      afterFrames();
      return;
    }
    if (!S.rvJson || now - S.rvAt > RV_TTL) {
      status('Haetaan tutkaa…');
      try {
        const res = await withTimeout(fetchFn, RV_JSON, 9000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        S.rvJson = json;
        S.rvAt = now;
        onSource('radarmap', true, `${(json?.radar?.past || []).length} kehystä`);
      } catch (err) {
        onSource('radarmap', false, err);
        if (seq === S.seq) status('Tutka ei vastannut juuri nyt.', true);
        return;
      }
    }
    if (seq !== S.seq) return;
    S.host = String(S.rvJson.host || 'https://tilecache.rainviewer.com');
    S.frames = pickFrames(S.rvJson?.radar?.past).map((f) => ({ t: f.time * 1000, path: f.path }));
    if (!S.frames.length) {
      status('Tutkakuvia ei ole juuri nyt saatavilla.', true);
      return;
    }
    S.frame = S.frames.length - 1;
    status('');
    afterFrames();
    wantTiles();
  }

  // ---------- Pilvet ----------

  async function loadGrid(force = false) {
    const seq = ++S.seq;
    const now = nowMs();
    if (!force && S.gridData && now - S.gridAt < GRID_TTL && gridCovers(S.grid, S.view)) {
      afterFrames();
      return;
    }
    const grid = makeGrid(S.view);
    status('Haetaan ennustetta…');
    try {
      const res = await withTimeout(fetchFn, gridUrl(grid), 15000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = parseGrid(await res.json(), grid);
      if (seq !== S.seq) return;
      S.grid = grid;
      S.gridData = data;
      S.gridAt = now;
      onSource('cloudmap', true, `${grid.rows * grid.cols} pistettä`);
    } catch (err) {
      onSource('cloudmap', false, err);
      if (seq === S.seq) status('Ennuste ei vastannut juuri nyt.', true);
      return;
    }
    status('');
    const t0 = now - 30 * 60000;
    const i = S.gridData.times.findIndex((t) => t >= t0);
    S.hour = Math.max(0, i);
    afterFrames();
  }

  // ---------- Aikajana ----------

  function steps() {
    return S.tab === 'radar' ? S.frames.length : S.gridData ? S.gridData.times.length : 0;
  }

  function current() {
    return S.tab === 'radar' ? S.frame : S.hour;
  }

  function label() {
    const tz = getTz();
    if (S.tab === 'radar') {
      const f = S.frames[S.frame];
      return f ? radarTimeText(f.t, nowMs(), tz, S.frame === S.frames.length - 1) : '';
    }
    const t = S.gridData?.times[S.hour];
    return t ? forecastTimeText(t, nowMs(), tz) : '';
  }

  function afterFrames() {
    const n = steps();
    range.max = String(Math.max(0, n - 1));
    range.value = String(current());
    range.disabled = n < 2;
    playBtn.disabled = n < 2;
    updateTime();
    drawWx();
    if (S.tab === 'radar' && n > 1 && !S.playing && !S.userPaused && !reduce()) play(true);
  }

  function updateTime() {
    const t = label();
    timeEl.textContent = t;
    range.setAttribute('aria-valuetext', t);
  }

  function setStep(i) {
    const n = steps();
    if (!n) return;
    const k = ((i % n) + n) % n;
    if (S.tab === 'radar') S.frame = k;
    else S.hour = k;
    range.value = String(k);
    updateTime();
    queueWx();
  }

  const reduce = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function play(on) {
    clearTimeout(S.timer);
    S.playing = on;
    playBtn.classList.toggle('on', on);
    playBtn.setAttribute('aria-label', on ? 'Pysäytä' : 'Toista');
    playBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (!on) return;
    const tick = () => {
      if (!S.playing || !S.open) return;
      const n = steps();
      const next = current() + 1 >= n ? 0 : current() + 1;
      setStep(next);
      const last = next === n - 1;
      S.timer = setTimeout(tick, last ? 1500 : S.tab === 'radar' ? 650 : 520);
    };
    S.timer = setTimeout(tick, current() === steps() - 1 ? 900 : 650);
  }

  // ---------- Tila ja välilehdet ----------

  function status(text, retry = false) {
    statusEl.hidden = !text;
    statusEl.innerHTML = text ? `<span>${esc(text)}</span>${retry ? '<button type="button" data-mv="retry">Yritä uudelleen</button>' : ''}` : '';
  }

  function chrome() {
    root.querySelectorAll('[data-mv="tab"]').forEach((b) => {
      const on = b.dataset.tab === S.tab;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    legend.innerHTML =
      S.tab === 'radar'
        ? '<span class="lg-bar lg-rain"></span><span class="lg-l">heikko</span><span class="lg-r">rankka sade tai lumi</span>'
        : '<span class="lg-bar lg-cloud"></span><span class="lg-l">selkeä</span><span class="lg-r">pilvinen</span><span class="lg-snow"><i class="rain"></i>sade</span><span class="lg-snow"><i></i>lumi</span>';
    attr.innerHTML = demo
      ? 'Esimerkkitila: kartan sää on keksittyä. Pohjakartta: Natural Earth.'
      : S.tab === 'radar'
        ? 'Tutka: <a href="https://www.rainviewer.com" target="_blank" rel="noopener">RainViewer</a> · havainnot 20 min välein · pohjakartta: Natural Earth'
        : 'Ennuste: <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a> (säämallit, noin 45 km:n ruudukko) · pohjakartta: Natural Earth';
  }

  function setTab(tab) {
    play(false);
    S.userPaused = false;
    S.tab = tab === 'cloud' ? 'cloud' : 'radar';
    chrome();
    timeEl.textContent = '';
    status('');
    const want = KM[S.tab];
    if (S.view && Math.abs(S.view.km - want) / want > 0.02 && !S.moved) {
      const p = place();
      S.view = makeView({ lon: p.lon, lat: p.lat, km: want, w: S.view.w, h: S.view.h });
      drawAll();
    } else drawWx();
    if (S.tab === 'radar') loadRadar();
    else loadGrid();
  }

  function recenter() {
    const p = place();
    S.moved = false;
    S.view = makeView({ lon: p.lon, lat: p.lat, km: KM[S.tab], w: S.view.w, h: S.view.h });
    viewChanged();
  }

  function viewChanged() {
    drawAll();
    if (S.tab === 'radar') wantTiles();
    else if (!gridCovers(S.grid, S.view)) loadGridSoon();
  }

  let gridTimer = 0;
  function loadGridSoon() {
    clearTimeout(gridTimer);
    gridTimer = setTimeout(() => loadGrid(true), 500);
  }

  // ---------- Eleet ----------

  const pts = new Map();
  let g0 = null; // eleen alku: { view, m0, d0 }
  let lastTap = 0;
  const layers = [baseCv, wxCv, marks];

  function mid() {
    const a = [...pts.values()];
    const m = a.reduce((s, p) => [s[0] + p.x, s[1] + p.y], [0, 0]).map((v) => v / a.length);
    const d = a.length > 1 ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 0;
    return { m, d };
  }

  function local(e) {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function begin() {
    const { m, d } = mid();
    g0 = { view: S.view, m0: m, d0: d, f: 1, m1: m, moved: false };
  }

  function preview() {
    const { m0, m1, f } = g0;
    for (const el of layers) {
      el.style.transformOrigin = `${m0[0]}px ${m0[1]}px`;
      el.style.transform = `translate(${m1[0] - m0[0]}px, ${m1[1] - m0[1]}px) scale(${f})`;
    }
  }

  function commit() {
    for (const el of layers) el.style.transform = '';
    if (!g0?.moved) return;
    const { view, m0, m1, f } = g0;
    const z = zoomView(view, f, m0[0], m0[1]);
    S.view = panView(z, m1[0] - m0[0], m1[1] - m0[1]);
    S.moved = true;
    viewChanged();
  }

  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture?.(e.pointerId);
    pts.set(e.pointerId, local(e));
    if (pts.size <= 2) begin();
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !g0) return;
    pts.set(e.pointerId, local(e));
    const { m, d } = mid();
    g0.m1 = m;
    g0.f = pts.size > 1 && g0.d0 > 0 ? Math.max(0.2, Math.min(5, d / g0.d0)) : 1;
    if (Math.hypot(m[0] - g0.m0[0], m[1] - g0.m0[1]) > 4 || Math.abs(g0.f - 1) > 0.02) g0.moved = true;
    if (g0.moved) preview();
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    const wasMoved = g0?.moved;
    const p = pts.get(e.pointerId);
    commit();
    pts.delete(e.pointerId);
    if (pts.size) begin();
    else {
      g0 = null;
      if (!wasMoved && e.type === 'pointerup') {
        const now = Date.now();
        if (now - lastTap < 320) {
          S.view = zoomView(S.view, 2, p.x, p.y);
          S.moved = true;
          viewChanged();
          lastTap = 0;
        } else lastTap = now;
      }
    }
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const p = local(e);
      S.view = zoomView(S.view, Math.pow(1.0018, -e.deltaY), p.x, p.y);
      S.moved = true;
      viewChanged();
    },
    { passive: false },
  );

  // ---------- Ohjaimet ----------

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mv]');
    if (!b) return;
    const act = b.dataset.mv;
    if (act === 'close') close();
    else if (act === 'tab') setTab(b.dataset.tab);
    else if (act === 'zoom-in' || act === 'zoom-out') {
      S.view = zoomView(S.view, act === 'zoom-in' ? 1.6 : 1 / 1.6);
      S.moved = true;
      viewChanged();
    } else if (act === 'recenter') recenter();
    else if (act === 'play') {
      S.userPaused = S.playing;
      play(!S.playing);
    } else if (act === 'retry') {
      S.rvJson = null;
      if (S.tab === 'radar') loadRadar();
      else loadGrid(true);
    }
  });
  range.addEventListener('input', () => {
    S.userPaused = true;
    play(false);
    setStep(Number(range.value));
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      const items = [...root.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href]')].filter((n) => n.offsetParent !== null);
      if (!items.length) return;
      const i = items.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        items[items.length - 1].focus();
      } else if (!e.shiftKey && i === items.length - 1) {
        e.preventDefault();
        items[0].focus();
      }
    }
  });

  function onResize() {
    if (!S.open || !S.view) return;
    const [w, h] = sizeCanvases();
    S.view = resizeView(S.view, w, h);
    viewChanged();
  }
  globalThis.addEventListener?.('resize', onResize);

  // ---------- Avaus ja sulkeminen ----------

  function open(tab = 'radar') {
    S.lastFocus = document.activeElement;
    S.open = true;
    root.hidden = false;
    root.classList.toggle('demo', demo);
    document.body.classList.add('map-open');
    const [w, h] = sizeCanvases();
    const p = place();
    S.tab = tab === 'cloud' ? 'cloud' : 'radar';
    S.moved = false;
    S.userPaused = false;
    S.view = makeView({ lon: p.lon, lat: p.lat, km: KM[S.tab], w, h });
    S.anchor = S.anchor || nowMs();
    chrome();
    drawAll();
    if (S.tab === 'radar') loadRadar();
    else loadGrid();
    requestAnimationFrame(() => root.classList.add('open'));
    setTimeout(() => $('[data-mv="close"]')?.focus({ preventScroll: true }), 60);
  }

  function close() {
    if (!S.open) return;
    S.open = false;
    S.seq++;
    play(false);
    root.classList.remove('open');
    document.body.classList.remove('map-open');
    queue.length = 0;
    setTimeout(() => {
      if (!S.open) root.hidden = true;
    }, 200);
    onClose();
    if (S.lastFocus?.isConnected) S.lastFocus.focus({ preventScroll: true });
  }

  return {
    open,
    close,
    get isOpen() {
      return S.open;
    },
    /** Testeille: tila ja näkymä. */
    debug: () => ({ tab: S.tab, frames: S.frames.length, frame: S.frame, hour: S.hour, hours: S.gridData?.times.length || 0, km: S.view?.km, lat: S.view?.lat, lon: S.view?.lon, map: S.mapName, base: Boolean(S.maps[S.mapName]), tilesOk: [...tiles.values()].filter((e) => e.ok).length, grid: S.grid ? S.grid.rows * S.grid.cols : 0, playing: S.playing }),
    setStep,
    unproject: (x, y) => unproject(S.view, x, y),
    viewFrom,
  };
}

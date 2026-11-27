// geomap.js: kartan laskenta ilman DOMia. Web Mercator -projektio (sama kuin karttatiilissä), näkymä ja tiilet,
// pohjakartan purku ja piirto kankaalle, ennusteruudukko (Open-Meteo: monta pistettä yhdellä haulla) ja värit.

export const TILE = 256;
const D2R = Math.PI / 180;
const EARTH_KM = 40075.017;
export const KM_MIN = 60;
export const KM_MAX = 1600;

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** lon/lat -> maailmakoordinaatit 0..1 (Web Mercator). */
export function merc(lon, lat) {
  const s = Math.sin(clamp(lat, -85.05, 85.05) * D2R);
  return [lon / 360 + 0.5, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}

/** Maailmakoordinaatit -> lon/lat. */
export function unmerc(x, y) {
  return [(x - 0.5) * 360, Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / D2R];
}

/** Näkymä keskipisteestä (maailmakoordinaatit) ja mittakaavasta (pikseliä maailmayksikköä kohti). */
export function viewFrom(cx, cy, scale, w, h) {
  const [lon, lat] = unmerc(cx, cy);
  return { lon, lat, km: (w / scale) * EARTH_KM * Math.cos(lat * D2R), w, h, cx, cy, scale };
}

/** Näkymä paikan ympärille: leveys km:nä. */
export function makeView({ lon, lat, km, w, h }) {
  const [cx, cy] = merc(lon, lat);
  return viewFrom(cx, cy, (w / clamp(km, KM_MIN, KM_MAX)) * EARTH_KM * Math.cos(lat * D2R), w, h);
}

export function project(view, lon, lat) {
  const [x, y] = merc(lon, lat);
  return [(x - view.cx) * view.scale + view.w / 2, (y - view.cy) * view.scale + view.h / 2];
}

export function unproject(view, px, py) {
  return unmerc(view.cx + (px - view.w / 2) / view.scale, view.cy + (py - view.h / 2) / view.scale);
}

export function viewBounds(view) {
  const [w, n] = unproject(view, 0, 0);
  const [e, s] = unproject(view, view.w, view.h);
  return { w, s, e, n };
}

/** Siirto pikseleinä (sormen liike): kartta seuraa sormea. */
export function panView(view, dx, dy) {
  return viewFrom(view.cx - dx / view.scale, clamp(view.cy - dy / view.scale, 0.02, 0.98), view.scale, view.w, view.h);
}

/** Zoomaus kertoimella f niin, että piste (px, py) pysyy paikallaan. Leveys rajataan KM_MIN..KM_MAX. */
export function zoomView(view, f, px = view.w / 2, py = view.h / 2) {
  const kmNew = clamp(view.km / f, KM_MIN, KM_MAX);
  const scale = view.scale * (view.km / kmNew);
  const wx = view.cx + (px - view.w / 2) / view.scale;
  const wy = view.cy + (py - view.h / 2) / view.scale;
  return viewFrom(wx - (px - view.w / 2) / scale, wy - (py - view.h / 2) / scale, scale, view.w, view.h);
}

/** Sama kohta uuteen kokoon (näytön koon muutos). */
export function resizeView(view, w, h) {
  return viewFrom(view.cx, view.cy, view.scale * (w / view.w), w, h);
}

// ---------- Tiilet (tutka) ----------

/** Tiilitaso: mieluummin vähemmän ja hieman suurennettuja tiiliä (tutkan pyyntöraja), korkeintaan max. */
export function tileZoom(view, max = 7, min = 2) {
  return clamp(Math.floor(Math.log2(view.scale / TILE) + 0.25), min, max);
}

/** Näkymän peittävät tiilet tasolla z: { z, x, y, px, py, size } (px, py = vasen yläkulma näytöllä). */
export function tilesFor(view, z) {
  const n = 2 ** z;
  const size = view.scale / n;
  const left = view.cx - view.w / 2 / view.scale;
  const top = view.cy - view.h / 2 / view.scale;
  const x0 = Math.floor(left * n);
  const x1 = Math.floor((left + view.w / view.scale) * n - 1e-9);
  const y0 = Math.max(0, Math.floor(top * n));
  const y1 = Math.min(n - 1, Math.floor((top + view.h / view.scale) * n - 1e-9));
  const out = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      out.push({ z, x: ((x % n) + n) % n, y, px: (x / n - view.cx) * view.scale + view.w / 2, py: (y / n - view.cy) * view.scale + view.h / 2, size });
    }
  }
  return out;
}

/** RainViewerin tiili: 256 px, värimaailma Universal Blue (2) ja pehmennys; lumi samoilla väreillä kuin sade (1_0), jotta se näkyy vaalealla kartalla. */
export function radarTileUrl(host, path, t) {
  return `${host}${path}/256/${t.z}/${t.x}/${t.y}/2/1_0.png`;
}

/** Tutkan kehykset: joka toinen 10 minuutin kehys (20 min välein) uusimmasta taaksepäin, vanhin ensin. */
export function pickFrames(past, step = 2, max = 7) {
  const list = (Array.isArray(past) ? past : []).filter((f) => f && Number.isFinite(f.time) && typeof f.path === 'string').sort((a, b) => a.time - b.time);
  const out = [];
  for (let i = list.length - 1; i >= 0 && out.length < max; i -= step) out.unshift(list[i]);
  return out;
}

// ---------- Pohjakartta (Natural Earth, maps/map-*.json) ----------

/** Purkaa pakatun pohjakartan: renkaat maailmakoordinaateiksi ja jokaiselle rajaava laatikko. */
export function decodeBasemap(data) {
  const q = data.q || 1000;
  const dec = (a) => {
    const pts = new Float64Array(a.length);
    let x = 0;
    let y = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < a.length; i += 2) {
      x += a[i];
      y += a[i + 1];
      const [mx, my] = merc(x / q, y / q);
      pts[i] = mx;
      pts[i + 1] = my;
      if (mx < minX) minX = mx;
      if (mx > maxX) maxX = mx;
      if (my < minY) minY = my;
      if (my > maxY) maxY = my;
    }
    return { pts, box: [minX, minY, maxX, maxY] };
  };
  return { box: data.box, land: (data.land || []).map(dec), isle: (data.isle || []).map(dec), lake: (data.lake || []).map(dec), border: (data.border || []).map(dec) };
}

/** Kumpi pohjakartta näkymälle: tarkka pohjoismainen, jos näkymä on sen alueella, muuten Euroopan karkeampi; muuten ei mitään. */
export function pickBasemap(view, boxes) {
  const b = viewBounds(view);
  for (const [name, box] of boxes) if (b.w >= box[0] && b.e <= box[2] && b.s >= box[1] && b.n <= box[3]) return name;
  for (const [name, box] of boxes) if (view.lon >= box[0] && view.lon <= box[2] && view.lat >= box[1] && view.lat <= box[3]) return name;
  return null;
}

function visible(view, box) {
  const l = view.cx - view.w / 2 / view.scale;
  const t = view.cy - view.h / 2 / view.scale;
  return !(box[2] < l || box[0] > l + view.w / view.scale || box[3] < t || box[1] > t + view.h / view.scale);
}

function trace(ctx, view, ring, close) {
  const p = ring.pts;
  const s = view.scale;
  const ox = view.w / 2 - view.cx * s;
  const oy = view.h / 2 - view.cy * s;
  ctx.moveTo(p[0] * s + ox, p[1] * s + oy);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] * s + ox, p[i + 1] * s + oy);
  if (close) ctx.closePath();
}

/** Piirtää pohjakartan: meri, maa ja saaret, järvet, rantaviiva ja valtakunnanrajat. */
export function drawBasemap(ctx, view, map, colors) {
  ctx.fillStyle = colors.water;
  ctx.fillRect(0, 0, view.w, view.h);
  if (!map) return;
  const fill = (rings, color) => {
    ctx.beginPath();
    for (const r of rings) if (visible(view, r.box)) trace(ctx, view, r, true);
    ctx.fillStyle = color;
    ctx.fill();
  };
  fill(map.land, colors.land);
  fill(map.isle, colors.land);
  fill(map.lake, colors.water);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const r of map.land) if (visible(view, r.box)) trace(ctx, view, r, true);
  for (const r of map.lake) if (visible(view, r.box)) trace(ctx, view, r, true);
  ctx.strokeStyle = colors.coast;
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.beginPath();
  for (const r of map.border) if (visible(view, r.box)) trace(ctx, view, r, false);
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Kaupunkien nimet: tärkeimmät ensin, päällekkäiset jätetään pois. cities: [[nimi, lat, lon], ...]. */
export function placeLabels(view, cities, { max = 14, skip = null, skipW = 0, avoid = [], charW = 6.6, h = 16, pad = 6 } = {}) {
  const taken = avoid.map((r) => ({ ...r }));
  const out = [];
  if (skip) taken.push({ x0: skip[0] - 14, y0: skip[1] - 14, x1: skip[0] + 14 + skipW, y1: skip[1] + 14 });
  for (const [name, lat, lon] of cities) {
    if (out.length >= max) break;
    const [x, y] = project(view, lon, lat);
    if (x < 8 || y < 8 || x > view.w - 8 || y > view.h - 8) continue;
    const w = name.length * charW + 10;
    const r = { x0: x - 4, y0: y - h / 2 - pad / 2, x1: x + w + 4, y1: y + h / 2 + pad / 2 };
    if (taken.some((t) => !(r.x1 < t.x0 || r.x0 > t.x1 || r.y1 < t.y0 || r.y0 > t.y1))) continue;
    taken.push(r);
    out.push({ name, x, y });
  }
  return out;
}

// ---------- Ennusteruudukko (Open-Meteo) ----------

/** Säännöllinen lat/lon-ruudukko näkymän ympärille: väli noin stepKm, enintään maxPts pistettä. */
export function makeGrid(view, { stepKm = Math.max(12, Math.min(60, view.km / 12)), maxPts = 250, margin = 0.08 } = {}) {
  const b = viewBounds(view);
  const mx = (b.e - b.w) * margin;
  const my = (b.n - b.s) * margin;
  const w = b.w - mx;
  const e = b.e + mx;
  const s = b.s - my;
  const n = b.n + my;
  const latMid = (s + n) / 2;
  let dLat = stepKm / 111.2;
  let dLon = stepKm / (111.32 * Math.cos(latMid * D2R));
  let rows = Math.ceil((n - s) / dLat) + 1;
  let cols = Math.ceil((e - w) / dLon) + 1;
  for (let i = 0; rows * cols > maxPts && i < 40; i++) {
    const k = Math.max(1.03, Math.sqrt((rows * cols) / maxPts) * 0.98);
    dLat *= k;
    dLon *= k;
    rows = Math.ceil((n - s) / dLat) + 1;
    cols = Math.ceil((e - w) / dLon) + 1;
  }
  const r2 = (v) => Math.round(v * 100) / 100;
  const lats = Array.from({ length: rows }, (_, i) => r2(n - i * dLat));
  const lons = Array.from({ length: cols }, (_, j) => r2(w + j * dLon));
  return { rows, cols, lats, lons, n: lats[0], w: lons[0], dLat: (lats[0] - lats[rows - 1]) / Math.max(1, rows - 1), dLon: (lons[cols - 1] - lons[0]) / Math.max(1, cols - 1) };
}

/** Kattaako ruudukko näkymän, ja onko se tarpeeksi tiheä (zoomatessa lähelle haetaan tiheämpi)? */
export function gridCovers(grid, view) {
  if (!grid) return false;
  const b = viewBounds(view);
  const s = grid.lats[grid.rows - 1];
  const e = grid.lons[grid.cols - 1];
  const fine = grid.dLat * 111.2 <= Math.max(14, view.km / 5);
  return fine && b.w >= grid.w && b.e <= e && b.s >= s && b.n <= grid.n;
}

/** Open-Meteon monen pisteen haku: pilvisyys, sade ja lumi tunneittain. */
export function gridUrl(grid, hours = 25) {
  const lat = [];
  const lon = [];
  for (const la of grid.lats) for (const lo of grid.lons) {
    lat.push(la);
    lon.push(lo);
  }
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat.join(',')}&longitude=${lon.join(',')}&hourly=cloud_cover,precipitation,snowfall&forecast_hours=${hours}&timeformat=unixtime&timezone=GMT`;
}

/** Jäsentää monen pisteen vastauksen: aikojen lista ja jokaiselle ajalle kentät rivi kerrallaan. */
export function parseGrid(json, grid) {
  const list = Array.isArray(json) ? json : [json];
  const N = grid.rows * grid.cols;
  if (list.length !== N) throw new Error(`ruudukko: ${list.length}/${N} pistettä`);
  const times = (list[0]?.hourly?.time || []).map(Number);
  if (!times.length) throw new Error('ruudukko: ei aikoja');
  const make = () => times.map(() => new Float32Array(N).fill(NaN));
  const cloud = make();
  const precip = make();
  const snow = make();
  list.forEach((o, k) => {
    const h = o?.hourly || {};
    for (let t = 0; t < times.length; t++) {
      const c = h.cloud_cover?.[t];
      const p = h.precipitation?.[t];
      const sn = h.snowfall?.[t];
      if (Number.isFinite(c)) cloud[t][k] = c;
      if (Number.isFinite(p)) precip[t][k] = p;
      if (Number.isFinite(sn)) snow[t][k] = sn;
    }
  });
  return { times: times.map((t) => t * 1000), cloud, precip, snow };
}

/** Bilineaarinen arvo kohdassa (lon, lat); NaN ruudukon ulkopuolella. */
export function sampleGrid(grid, field, lon, lat) {
  const fx = (lon - grid.w) / grid.dLon;
  const fy = (grid.n - lat) / grid.dLat;
  if (!(fx >= 0 && fy >= 0 && fx <= grid.cols - 1 && fy <= grid.rows - 1)) return NaN;
  const x0 = Math.min(grid.cols - 2, Math.floor(fx));
  const y0 = Math.min(grid.rows - 2, Math.floor(fy));
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (y, x) => field[y * grid.cols + x];
  const a = at(y0, x0);
  const b = at(y0, x0 + 1);
  const c = at(y0 + 1, x0);
  const d = at(y0 + 1, x0 + 1);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

// ---------- Värit ----------

const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Pilvisyys 0–100 % -> [r, g, b, a] (a 0..1): selkeä läpinäkyvä, pilvinen harsona. */
export function cloudColor(v, dark) {
  if (!(v > 8)) return null;
  const t = smooth(8, 100, v);
  return dark ? [226, 228, 246, 0.1 + 0.55 * t] : [104, 110, 146, 0.1 + 0.5 * t];
}

/** Sade mm/h -> väri; snowShare 0..1 sävyttää lumen turkoosiksi (vaalea kartta) tai valkeaksi (tumma kartta). */
export function precipColor(mm, snowShare = 0, dark = false) {
  if (!(mm >= 0.03)) return null;
  const fadeIn = smooth(0.03, 0.3, mm); // pehmeä reuna: ei portaita heikon sateen rajalla
  const t = smooth(0.08, 6, Math.log1p(mm * 2) * 1.35);
  const stops = [
    [0, [128, 182, 255, 0.42]],
    [0.4, [72, 122, 246, 0.62]],
    [0.75, [66, 62, 214, 0.76]],
    [1, [152, 52, 206, 0.86]],
  ];
  let c = stops[stops.length - 1][1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const k = (t - t0) / (t1 - t0 || 1);
      c = c0.map((v, j) => v + (c1[j] - v) * k);
      break;
    }
  }
  if (snowShare > 0) {
    const s = clamp(snowShare, 0, 1);
    const to = dark ? [214, 238, 255] : [38, 172, 206];
    c = [c[0] + (to[0] - c[0]) * s, c[1] + (to[1] - c[1]) * s, c[2] + (to[2] - c[2]) * s, c[3]];
  }
  return [c[0], c[1], c[2], c[3] * fadeIn];
}

/**
 * Täyttää kuvadatan (pieni kangas, step px per kuvapiste) kentän väreillä. sample(lon, lat) -> [r,g,b,a] tai null.
 * Mercatorissa pituusaste riippuu vain x:stä ja leveysaste vain y:stä, joten ne lasketaan kerran sarakkeelle ja riville.
 */
export function paintField(img, view, step, sample) {
  const { width: W, height: H, data } = img;
  const lons = new Float64Array(W);
  const lats = new Float64Array(H);
  for (let x = 0; x < W; x++) lons[x] = unproject(view, (x + 0.5) * step, 0)[0];
  for (let y = 0; y < H; y++) lats[y] = unproject(view, 0, (y + 0.5) * step)[1];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = sample(lons[x], lats[y]);
      const i = (y * W + x) * 4;
      if (!c) {
        data[i + 3] = 0;
        continue;
      }
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = Math.round(clamp(c[3], 0, 1) * 255);
    }
  }
  return img;
}

/** Ruudukon reunoilla kenttä häivytetään (ei kovaa reunaa). Palauttaa kertoimen 0..1. */
export function edgeFade(grid, lon, lat) {
  const fx = (lon - grid.w) / grid.dLon;
  const fy = (grid.n - lat) / grid.dLat;
  const d = Math.min(fx, fy, grid.cols - 1 - fx, grid.rows - 1 - fy);
  return clamp(d / 0.7, 0, 1);
}

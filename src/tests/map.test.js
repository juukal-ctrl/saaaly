import test from 'node:test';
import assert from 'node:assert/strict';
import { merc, unmerc, makeView, project, unproject, panView, zoomView, tileZoom, tilesFor, radarTileUrl, pickFrames, makeGrid, gridCovers, gridUrl, parseGrid, sampleGrid, cloudColor, precipColor, decodeBasemap, pickBasemap, placeLabels, edgeFade, KM_MIN, KM_MAX } from '../js/geomap.js';
import { radarTimeText, forecastTimeText } from '../js/mapview.js';
import { syntheticGrid, syntheticRadarMaps, syntheticMapWx, makeDemoFetch } from '../js/demo.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('kartta: Mercator-projektio menee edestakaisin', () => {
  for (const [lon, lat] of [[22.27, 60.45], [-4.42, 36.72], [0, 0], [179, -60]]) {
    const [x, y] = merc(lon, lat);
    const [lo, la] = unmerc(x, y);
    assert.ok(near(lo, lon, 1e-9) && near(la, lat, 1e-9), `${lon},${lat}`);
  }
  assert.deepEqual(merc(0, 0), [0.5, 0.5]);
});

test('kartta: näkymä keskittyy paikkaan, ja siirto ja zoomaus pitävät pisteet paikoillaan', () => {
  const v = makeView({ lon: 22.27, lat: 60.45, km: 320, w: 412, h: 860 });
  const [x, y] = project(v, 22.27, 60.45);
  assert.ok(near(x, 206) && near(y, 430));
  assert.ok(near(v.km, 320, 1e-6));
  // Siirto: kartta seuraa sormea
  const p = panView(v, 50, -30);
  const [x2, y2] = project(p, 22.27, 60.45);
  assert.ok(near(x2, 256, 1e-6) && near(y2, 400, 1e-6));
  // Zoomaus pisteen ympäri: piste pysyy samassa kohdassa
  const [lon, lat] = unproject(v, 100, 200);
  const z = zoomView(v, 2, 100, 200);
  const [x3, y3] = project(z, lon, lat);
  assert.ok(near(x3, 100, 1e-6) && near(y3, 200, 1e-6));
  assert.ok(near(z.scale, v.scale * 2, 1e-6));
  // Rajat
  assert.ok(zoomView(v, 100).km >= KM_MIN - 1e-9);
  assert.ok(zoomView(v, 0.001).km <= KM_MAX + 1e-9);
});

test('kartta: tutkatiilet peittävät näkymän ja osoite on RainViewerin muotoa', () => {
  const v = makeView({ lon: 22.27, lat: 60.45, km: 320, w: 412, h: 860 });
  const z = tileZoom(v);
  assert.ok(z >= 2 && z <= 7);
  const ts = tilesFor(v, z);
  assert.ok(ts.length >= 2 && ts.length <= 12, `tiiliä ${ts.length}`);
  const minX = Math.min(...ts.map((t) => t.px));
  const minY = Math.min(...ts.map((t) => t.py));
  const maxX = Math.max(...ts.map((t) => t.px + t.size));
  const maxY = Math.max(...ts.map((t) => t.py + t.size));
  assert.ok(minX <= 0 && minY <= 0 && maxX >= 412 && maxY >= 860, 'tiilet eivät peitä näkymää');
  assert.equal(radarTileUrl('https://tilecache.rainviewer.com', '/v2/radar/abc', { z: 6, x: 36, y: 18 }), 'https://tilecache.rainviewer.com/v2/radar/abc/256/6/36/18/2/1_0.png');
  // Tiilitaso ei koskaan ylitä ilmaisen käytön rajaa 7
  assert.equal(tileZoom(makeView({ lon: 22, lat: 60, km: 60, w: 1200, h: 900 })), 7);
});

test('kartta: tutkasta joka toinen kehys, uusin aina mukana', () => {
  const past = Array.from({ length: 13 }, (_, i) => ({ time: 1000 + i * 600, path: `/p${i}` }));
  const f = pickFrames(past);
  assert.equal(f.length, 7);
  assert.equal(f[f.length - 1].path, '/p12');
  assert.equal(f[0].path, '/p0');
  assert.deepEqual(pickFrames([{ time: 'x' }, null]), []);
});

test('kartta: ennusteruudukko kattaa näkymän ja pysyy pistemäärärajassa', () => {
  const v = makeView({ lon: 22.27, lat: 60.45, km: 480, w: 412, h: 860 });
  const g = makeGrid(v);
  assert.ok(g.rows * g.cols <= 250, `${g.rows * g.cols} pistettä`);
  assert.ok(g.dLat * 111.2 < 60, `väli ${g.dLat * 111.2} km`);
  assert.ok(gridCovers(g, v));
  assert.ok(!gridCovers(g, panView(v, 2000, 0)));
  // Lähelle zoomatessa harva ruudukko ei kelpaa, vaan haetaan tiheämpi
  assert.ok(!gridCovers(g, zoomView(v, 6)));
  const url = gridUrl(g);
  assert.match(url, /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=[-\d.,]+&longitude=[-\d.,]+&hourly=cloud_cover,precipitation,snowfall&forecast_hours=25&timeformat=unixtime&timezone=GMT$/);
  assert.equal(new URL(url).searchParams.get('latitude').split(',').length, g.rows * g.cols);
});

test('kartta: ruudukon jäsennys ja bilineaarinen arvo', () => {
  const g = { rows: 2, cols: 2, lats: [61, 60], lons: [22, 23], n: 61, w: 22, dLat: 1, dLon: 1 };
  const mk = (c) => ({ hourly: { time: [3600, 7200], cloud_cover: [c, c], precipitation: [c / 100, 0], snowfall: [0, 0] } });
  const d = parseGrid([mk(0), mk(100), mk(0), mk(100)], g);
  assert.deepEqual(d.times, [3600000, 7200000]);
  assert.ok(near(sampleGrid(g, d.cloud[0], 22.5, 60.5), 50));
  assert.ok(near(sampleGrid(g, d.cloud[0], 22.25, 60.9), 25));
  assert.ok(Number.isNaN(sampleGrid(g, d.cloud[0], 21.9, 60.5)));
  assert.equal(edgeFade(g, 22, 60.5), 0);
  assert.equal(edgeFade(g, 22.5, 60.5) > 0.5, true);
  assert.throws(() => parseGrid([mk(0)], g), /1\/4/);
});

test('kartta: värit selkeälle, pilvelle, sateelle ja lumelle', () => {
  assert.equal(cloudColor(3, false), null);
  const c = cloudColor(100, false);
  assert.ok(c[3] > 0.5);
  assert.equal(precipColor(0.02), null);
  const light = precipColor(0.3);
  const heavy = precipColor(8);
  assert.ok(heavy[3] > light[3]);
  const snow = precipColor(0.6, 1);
  assert.notDeepEqual(snow, precipColor(0.6, 0), 'lumi erottuu sateesta');
  assert.ok(precipColor(0.6, 1, true)[0] > 200, 'tummalla kartalla lumi on vaalea');
});

test('kartta: pohjakartan purku, valinta ja nimien sijoittelu', () => {
  const data = { v: 1, q: 1000, box: [4, 53, 45, 72.5], land: [[22000, 60000, 1000, 0, 0, 1000, -1000, 0]], isle: [], lake: [], border: [[24000, 60000, 0, 500]] };
  const m = decodeBasemap(data);
  assert.equal(m.land.length, 1);
  assert.equal(m.land[0].pts.length, 8);
  const [x, y] = merc(23, 60);
  assert.ok(near(m.land[0].pts[2], x) && near(m.land[0].pts[3], y));
  const boxes = [['nordic', [4, 53, 45, 72.5]], ['europe', [-32, 26, 50, 72.5]]];
  assert.equal(pickBasemap(makeView({ lon: 22.27, lat: 60.45, km: 320, w: 412, h: 860 }), boxes), 'nordic');
  assert.equal(pickBasemap(makeView({ lon: -4.42, lat: 36.72, km: 320, w: 412, h: 860 }), boxes), 'europe');
  assert.equal(pickBasemap(makeView({ lon: -74, lat: 40.7, km: 320, w: 412, h: 860 }), boxes), null);
  const v = makeView({ lon: 22.27, lat: 60.45, km: 320, w: 412, h: 860 });
  const labels = placeLabels(v, [['Turku', 60.45, 22.27], ['Kaarina', 60.41, 22.37], ['Salo', 60.38, 23.13], ['Tallinna', 59.44, 24.75]], { skip: project(v, 22.27, 60.45) });
  assert.ok(!labels.some((l) => l.name === 'Turku'), 'oman paikan päälle ei tule toista nimeä');
  assert.ok(labels.some((l) => l.name === 'Salo'));
});

test('kartta: aikatekstit', () => {
  const tz = 'Europe/Helsinki';
  const now = Date.parse('2026-10-14T10:40:00Z'); // klo 13.40
  assert.equal(radarTimeText(Date.parse('2026-10-14T10:30:00Z'), now, tz, true), 'klo 13.30 · uusin');
  assert.equal(radarTimeText(Date.parse('2026-10-14T09:50:00Z'), now, tz, false), 'klo 12.50 · 50 min sitten');
  assert.equal(radarTimeText(Date.parse('2026-10-14T08:30:00Z'), now, tz, false), 'klo 11.30 · 2 t 10 min sitten');
  assert.equal(radarTimeText(Date.parse('2026-10-14T09:40:00Z'), now, tz, false), 'klo 12.40 · 1 t sitten');
  assert.equal(forecastTimeText(Date.parse('2026-10-14T11:00:00Z'), now, tz), 'nyt');
  assert.equal(forecastTimeText(Date.parse('2026-10-14T15:00:00Z'), now, tz), 'tänään klo 18');
  assert.equal(forecastTimeText(Date.parse('2026-10-15T03:00:00Z'), now, tz), 'huomenna klo 6');
  assert.equal(forecastTimeText(Date.parse('2026-10-14T21:00:00Z'), now, tz), 'keskiyöllä');
});

test('kartta: esimerkkitila antaa ruudukon ja tutkan kehysluettelon samassa muodossa kuin palvelut', async () => {
  const now = Date.parse('2026-10-14T10:40:00Z');
  const grid = syntheticGrid({ lats: [60.4, 60.5], lons: [22.2, 22.3], nowMs: now, scenario: 'rain' });
  assert.equal(grid.length, 2);
  assert.equal(grid[0].hourly.time.length, 25);
  assert.ok(grid[0].hourly.precipitation.some((v) => v > 0), 'sadeskenaariossa sataa');
  const rv = syntheticRadarMaps(now);
  assert.equal(rv.radar.past.length, 13);
  assert.ok(rv.radar.past.every((f) => f.time <= now / 1000));
  const fetchFn = makeDemoFetch({ scenario: 'rain', nowMs: now });
  const v = makeView({ lon: 22.27, lat: 60.45, km: 320, w: 412, h: 860 });
  const g = makeGrid(v);
  const res = await fetchFn(gridUrl(g));
  const parsed = parseGrid(await res.json(), g);
  assert.equal(parsed.cloud.length, 25);
  // Sadevyöhyke kulkee esimerkkipaikan yli: sadeskenaariossa sataa nyt, sekasäässä ei vielä
  assert.ok(syntheticMapWx(22.27, 60.45, now, 'rain', now).precip > 0.1);
  assert.equal(syntheticMapWx(22.27, 60.45, now, 'mixed', now).precip, 0);
  assert.equal(syntheticMapWx(22.27, 60.45, now, 'clear', now).precip, 0);
});

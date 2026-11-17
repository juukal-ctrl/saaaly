import test from 'node:test';
import assert from 'node:assert/strict';
import { sunPosition, sunEvents, dayLengthMs, moonInfo } from '../js/sun.js';
import { zonedToUtcMs, localNow } from '../js/util.js';

const TURKU = { lat: 60.4518, lon: 22.2666 };

test('auringon korkeus Turussa keskikesän aurinkoaamuna', () => {
  const p = sunPosition(Date.UTC(2026, 5, 21, 10, 30), TURKU.lat, TURKU.lon);
  assert.ok(p.altitudeDeg > 51 && p.altitudeDeg < 55, `korkeus ${p.altitudeDeg}`);
  assert.ok(Math.abs(p.bearingDeg - 180) < 6, `suunta ${p.bearingDeg}`);
});

test('aurinko on yöllä horisontin alla ja aamulla idässä', () => {
  const night = sunPosition(Date.UTC(2026, 9, 14, 23, 0), TURKU.lat, TURKU.lon);
  assert.ok(night.altitudeDeg < -20);
  const morning = sunPosition(zonedToUtcMs('2026-10-14T09:30', 'Europe/Helsinki'), TURKU.lat, TURKU.lon);
  assert.ok(morning.bearingDeg > 100 && morning.bearingDeg < 160, `suunta ${morning.bearingDeg}`);
});

test('nousu ja lasku Turussa 14.10.', () => {
  const start = zonedToUtcMs('2026-10-14T00:00', 'Europe/Helsinki');
  const ev = sunEvents(start, TURKU.lat, TURKU.lon);
  const rise = localNow(ev.rise, 'Europe/Helsinki');
  const set = localNow(ev.set, 'Europe/Helsinki');
  assert.equal(ev.polar, null);
  assert.ok(rise.hour >= 7 && rise.hour <= 8, `nousu ${rise.iso}`);
  assert.ok(set.hour >= 17 && set.hour <= 18, `lasku ${set.iso}`);
  const len = dayLengthMs(ev) / 3600000;
  assert.ok(len > 10 && len < 10.7, `päivän pituus ${len}`);
});

test('päivä lyhenee syksyllä ja pitenee keväällä', () => {
  const len = (date) => dayLengthMs(sunEvents(zonedToUtcMs(date + 'T00:00', 'Europe/Helsinki'), TURKU.lat, TURKU.lon));
  assert.ok(len('2026-10-15') < len('2026-10-14'));
  assert.ok(len('2026-03-02') > len('2026-03-01'));
});

test('napapiirin pohjoispuolella on yötön yö ja kaamos', () => {
  const day = sunEvents(zonedToUtcMs('2026-06-21T00:00', 'Europe/Helsinki'), 67.42, 26.59);
  assert.equal(day.polar, 'day');
  const night = sunEvents(zonedToUtcMs('2026-12-21T00:00', 'Europe/Helsinki'), 67.42, 26.59);
  assert.equal(night.polar, 'night');
  assert.equal(dayLengthMs(day), 86400000);
  assert.equal(dayLengthMs(night), 0);
});

test('kuun vaihe: uusikuu 10.10.2026 ja täysikuu 26.10.2026', () => {
  const dist = (a, b) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b));
  assert.ok(dist(moonInfo(Date.UTC(2026, 9, 10, 15, 50), 60.45, 22.27).phase, 0) < 0.03);
  assert.ok(dist(moonInfo(Date.UTC(2026, 9, 26, 4, 12), 60.45, 22.27).phase, 0.5) < 0.03);
  const m = moonInfo(Date.UTC(2026, 9, 14, 17, 4), 60.45, 22.27);
  assert.ok(m.phase > 0.1 && m.phase < 0.2, `vaihe ${m.phase}`); // kasvava sirppi
  assert.ok(m.illum > 0.1 && m.illum < 0.3);
});

test('kasvava kuu on illalla taivaalla lounaassa ja aamulla horisontin alla', () => {
  const evening = moonInfo(Date.UTC(2026, 9, 14, 17, 4), 60.45, 22.27);
  assert.ok(evening.altitudeDeg > 5 && evening.hourAngle > 0, `ilta ${evening.altitudeDeg}`);
  const morning = moonInfo(Date.UTC(2026, 9, 14, 4, 0), 60.45, 22.27);
  assert.ok(morning.altitudeDeg < 0, `aamu ${morning.altitudeDeg}`);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtTemp, fmtNum, fmtMm, windFrom, weekday, fmtDM, addDays, localNow, zonedToUtcMs, mdToHtml, MINUS } from '../js/util.js';

test('fmtTemp käyttää suomalaista etumerkkiä ja oikeaa miinusta', () => {
  assert.equal(fmtTemp(9.2), '+9°');
  assert.equal(fmtTemp(-3.4), MINUS + '3°');
  assert.equal(fmtTemp(0.2), '0°');
  assert.equal(fmtTemp(-0.4), '0°');
  assert.equal(fmtTemp(9.5), '+10°');
  assert.equal(fmtTemp(-9.5), MINUS + '10°');
  assert.equal(fmtTemp(null), '–');
  assert.equal(fmtTemp(NaN), '–');
  assert.equal(fmtTemp(9.26, { digits: 1 }), '+9,3°');
  assert.equal(fmtTemp(9.2, { sign: false }), '9°');
});

test('fmtNum ja fmtMm käyttävät desimaalipilkkua', () => {
  assert.equal(fmtNum(3.14159, 1), '3,1');
  assert.equal(fmtMm(0.03), '0 mm');
  assert.equal(fmtMm(0.4), '0,4 mm');
  assert.equal(fmtMm(2.4), '2,4 mm');
  assert.equal(fmtMm(12.34), '12 mm');
});

test('windFrom antaa tulosuunnan elatiivissa', () => {
  const cases = { 0: 'pohjoisesta', 45: 'koillisesta', 90: 'idästä', 135: 'kaakosta', 180: 'etelästä', 225: 'lounaasta', 270: 'lännestä', 315: 'luoteesta', 350: 'pohjoisesta', 361: 'pohjoisesta' };
  for (const [deg, name] of Object.entries(cases)) assert.equal(windFrom(+deg), name, deg);
  assert.equal(windFrom(null), '');
});

test('päivämääräapurit', () => {
  assert.equal(weekday('2026-10-14'), 'ke');
  assert.equal(weekday('2026-10-14', true), 'keskiviikko');
  assert.equal(fmtDM('2026-10-04'), '4.10.');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('localNow antaa paikallisen ajan kesä- ja talviaikana', () => {
  assert.equal(localNow(Date.UTC(2026, 9, 14, 17, 4), 'Europe/Helsinki').iso, '2026-10-14T20:04');
  assert.equal(localNow(Date.UTC(2026, 11, 1, 10, 0), 'Europe/Helsinki').iso, '2026-12-01T12:00');
  assert.equal(localNow(Date.UTC(2026, 9, 14, 21, 30), 'Europe/Helsinki').date, '2026-10-15');
  assert.equal(localNow(Date.UTC(2026, 0, 1, 0, 0), 'UTC').hour, 0);
  // virheellinen aikavyöhyke ei kaada
  assert.equal(localNow(Date.UTC(2026, 0, 1, 5, 0), 'Ei/Olemassa').hour, 5);
});

test('zonedToUtcMs huomioi kesäaikasiirtymät', () => {
  assert.equal(zonedToUtcMs('2026-10-14T20:00', 'Europe/Helsinki'), Date.UTC(2026, 9, 14, 17, 0));
  assert.equal(zonedToUtcMs('2026-12-01T12:00', 'Europe/Helsinki'), Date.UTC(2026, 11, 1, 10, 0));
  assert.equal(zonedToUtcMs('2026-10-24T12:00', 'Europe/Helsinki'), Date.UTC(2026, 9, 24, 9, 0));
  assert.equal(zonedToUtcMs('2026-10-25T12:00', 'Europe/Helsinki'), Date.UTC(2026, 9, 25, 10, 0));
  assert.equal(zonedToUtcMs('2026-03-28T12:00', 'Europe/Helsinki'), Date.UTC(2026, 2, 28, 10, 0));
  assert.equal(zonedToUtcMs('2026-03-29T12:00', 'Europe/Helsinki'), Date.UTC(2026, 2, 29, 9, 0));
});

test('mdToHtml: lihavointi, listat ja otsikot', () => {
  assert.equal(mdToHtml('**Hei** maailma'), '<p><strong>Hei</strong> maailma</p>');
  assert.equal(mdToHtml('Lämpö on **+9°** nyt'), '<p>Lämpö on <strong>+9°</strong> nyt</p>');
  assert.equal(mdToHtml('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(mdToHtml('* a\n* b'), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(mdToHtml('1. eka\n2. toka'), '<ol><li>eka</li><li>toka</li></ol>');
  assert.equal(mdToHtml('# Otsikko'), '<p><strong>Otsikko</strong></p>');
  assert.equal(mdToHtml('a\nb'), '<p>a<br>b</p>');
  assert.equal(mdToHtml('eka\n\ntoka'), '<p>eka</p><p>toka</p>');
  assert.equal(mdToHtml('**ei lista**'), '<p><strong>ei lista</strong></p>');
  assert.equal(mdToHtml('*kursiivi* ja `koodi`'), '<p><em>kursiivi</em> ja <code>koodi</code></p>');
  assert.ok(!mdToHtml('teksti **lihava**').includes('**'));
});

test('mdToHtml estää HTML-injektion', () => {
  const out = mdToHtml('<script>alert(1)</script> <img src=x onerror=alert(1)> **[x](javascript:alert(1))**');
  assert.ok(!out.includes('<script'));
  assert.ok(!out.includes('<img'));
  assert.ok(out.includes('&lt;script&gt;'));
});

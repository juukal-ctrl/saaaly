import test from 'node:test';
import assert from 'node:assert/strict';
import { parseXml, parseCapAlerts, parseCapFeed, inPoly, warningsAt, whenText, officialRows, fetchWarnings, buildMirror, parseMirror, MIRROR_URL } from '../js/warnings.js';
import { NOW, HOUR, TURKU_POLY, OULU_POLY, TURKU, OULU, HELSINKI, iso, cap, defaults, atom, entry } from './cap-fixtures.js';

test('parseXml: entiteetit, CDATA, molemmat lainausmerkit, itsesulkeutuvat elementit, kommentit ja nimiavaruuden etuliitteet', () => {
  const r = parseXml(`<?xml version="1.0"?><!DOCTYPE x><!-- kommentti --><a:root xmlns:a="u" k='1' l="2"><a:t>x &amp; y &lt; &#65;&#x42;</a:t><c><![CDATA[<raw & text>]]></c><e/></a:root>`);
  const root = r.kids[0];
  assert.equal(root.name, 'root');
  assert.deepEqual(root.attrs, { a: 'u', k: '1', l: '2' });
  assert.equal(root.kids[0].text, 'x & y < AB');
  assert.equal(root.kids[1].text, '<raw & text>');
  assert.equal(root.kids[2].name, 'e');
});

test('parseXml: rikkinäinen XML heittää', () => {
  for (const bad of ['<a><b></a></b>', '<a>', '</a>', '<a>1 < 2</a>', '', null]) assert.throws(() => parseXml(bad), /XML ei jäsenny/, String(bad));
  assert.throws(() => parseXml('<a>' + 'x'.repeat(16_100_000) + '</a>'), /XML ei jäsenny/);
  assert.throws(() => parseXml('<a>'.repeat(80) + '</a>'.repeat(80)), /XML ei jäsenny/);
});

test('parseCapFeed: upotetut varoitukset, kielen valinta ja kentät', () => {
  const feed = atom([entry(cap(defaults({ id: 'a1' }))), entry(cap(defaults({ id: 'a2', severity: 'Severe', area: 'Pohjois-Pohjanmaa', poly: OULU_POLY })))]);
  const { alerts, links } = parseCapFeed(feed);
  assert.equal(alerts.length, 2);
  assert.equal(links.length, 0);
  const a = alerts[0];
  assert.equal(a.event, 'Tuulivaroitus'); // fi-FI, ei sv-FI eikä en-GB
  assert.equal(a.severity, 'Moderate');
  assert.equal(a.color, 'yellow');
  assert.equal(a.description, 'Kuvaus: Tuulivaroitus & puuskia <20 m/s.');
  assert.equal(a.expires, NOW + 6 * HOUR);
  assert.equal(a.areas[0].polys[0].length, 5);
  assert.deepEqual(a.areas[0].polys[0][0], [60.2, 21.8]);
  assert.equal(parseCapAlerts(feed, 'en-GB')[0].event, 'Wind warning');
  assert.equal(parseCapAlerts(feed, 'de-DE')[0].event, 'Tuulivaroitus'); // tuntematon kieli: ensimmäinen info
});

test('warningsAt: osuu vain oman alueen varoitukseen ja vain voimassa olevaan', () => {
  const { alerts } = parseCapFeed(atom([entry(cap(defaults({ id: 'a1' }))), entry(cap(defaults({ id: 'a2', area: 'Pohjois-Pohjanmaa', poly: OULU_POLY })))]));
  assert.deepEqual(warningsAt(alerts, ...TURKU, NOW).map((w) => w.id), ['a1']);
  assert.deepEqual(warningsAt(alerts, ...OULU, NOW).map((w) => w.id), ['a2']);
  assert.deepEqual(warningsAt(alerts, ...HELSINKI, NOW), []);
  assert.deepEqual(warningsAt(alerts, ...TURKU, NOW + 7 * HOUR), [], 'vanhentunut ei näy');
});

test('CAP tekstinä <content>-elementin sisällä (escapettu) jäsentyy samoin', () => {
  const escaped = cap(defaults({ id: 'esc' })).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const { alerts } = parseCapFeed(atom([entry(escaped)]));
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].id, 'esc');
  assert.equal(alerts[0].description, 'Kuvaus: Tuulivaroitus & puuskia <20 m/s.');
  assert.equal(warningsAt(alerts, ...TURKU, NOW).length, 1);
});

test('nimiavaruuden etuliite (cap:alert) ja yksittäinen CAP-tiedosto', () => {
  const xml = cap(defaults({ id: 'p1' })).replace(/<(\/?)([a-zA-Z]+)/g, '<$1cap:$2').replace('xmlns=', 'xmlns:cap=').replace('<cap:alert xmlns', '<cap:alert xmlns');
  const alerts = parseCapAlerts(xml);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].id, 'p1');
});

test('Cancel, Update ja muut tilat: peruttu, korvattu ja testiviesti jäävät pois', () => {
  const feed = atom([
    entry(cap(defaults({ id: 'old' }))),
    entry(cap(defaults({ id: 'new', msgType: 'Update', refs: 'fmi,old,2026-11-17T09:00:00Z' }))),
    entry(cap(defaults({ id: 'gone' }))),
    entry(cap(defaults({ id: 'cancel', msgType: 'Cancel', refs: 'fmi,gone,2026-11-17T09:00:00Z' }))),
    entry(cap(defaults({ id: 'test', status: 'Test' }))),
    entry(cap(defaults({ id: 'new' }))), // sama tunniste kahdesti: yksi riittää
  ]);
  assert.deepEqual(parseCapAlerts(feed).map((a) => a.id), ['new']);
});

test('linkkimerkinnät: CAP-tiedostojen osoitteet kerätään, ja upotettu sisältö luetaan suoraan', () => {
  const links = Array.from({ length: 5 }, (_, i) => `https://alerts.fmi.fi/cap/2026/11-17/${i}.xml`);
  const feed = atom(links.map((h, i) => `<entry><id>${i}</id><title>t</title><link rel="alternate" type="application/cap+xml" href="${h}"/></entry>`));
  assert.equal(parseCapFeed(feed).alerts.length, 0);
  assert.deepEqual(parseCapFeed(feed).links, links);
  const both = atom([entry(cap(defaults({ id: 'a1' })), '<link rel="alternate" type="application/cap+xml" href="https://alerts.fmi.fi/cap/x.xml"/>')]);
  assert.equal(parseCapFeed(both).alerts.length, 1);
  assert.equal(parseCapFeed(both).links.length, 1);
});

// ---------- peili ----------

const alertsOf = (...os) => parseCapAlerts(atom(os.map((o) => entry(cap(o)))));
const reply = (body, status = 200) => async (url, init) => ({ ok: status < 400, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), url, init });

test('buildMirror: pyöristää koordinaatit, järjestää vakavimmat ensin ja pudottaa jo päättyneet', () => {
  const alerts = alertsOf(
    defaults({ id: 'y', severity: 'Moderate', poly: '60.123456,21.987654 60.7,21.8 60.7,22.8 60.123456,21.987654' }),
    defaults({ id: 'o', severity: 'Severe' }),
    defaults({ id: 'old', expires: NOW - 2 * HOUR }),
  );
  const m = buildMirror(alerts, NOW);
  assert.equal(m.v, 1);
  assert.equal(Date.parse(m.fetchedAt), NOW);
  assert.deepEqual(m.alerts.map((a) => a.id), ['o', 'y']); // Severe ensin; päättynyt (yli tunti sitten) pois
  assert.deepEqual(m.alerts[1].areas[0].polys[0][0], [60.123, 21.988]);
  assert.ok(JSON.stringify(m).length < 2000, 'tiivis muoto');
});

test('buildMirror: enintään 200 varoitusta, vakavimmat säilyvät', () => {
  const many = Array.from({ length: 230 }, (_, i) => ({ ...alertsOf(defaults({ id: 'x' }))[0], id: `m${i}`, severity: i === 229 ? 'Extreme' : 'Moderate' }));
  const m = buildMirror(many, NOW);
  assert.equal(m.alerts.length, 200);
  assert.equal(m.alerts[0].id, 'm229');
});

test('parseMirror: täysi kierros buildMirrorista, ja officialRows toimii sen tuloksella', () => {
  const m = buildMirror(alertsOf(defaults({ id: 'a1', event: 'Tuulivaroitus' }), defaults({ id: 'a2', severity: 'Severe', area: 'Pohjois-Pohjanmaa', poly: OULU_POLY })), NOW);
  const r = parseMirror(JSON.parse(JSON.stringify(m)), NOW + 10 * 60000);
  assert.equal(r.ok, true);
  assert.equal(r.alerts.length, 2);
  assert.match(r.note, /2 voimassa tai tulossa koko maassa, peili päivitetty ti 17\.11\. klo 12/);
  const rows = officialRows(r.alerts, ...TURKU, NOW);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Tuulivaroitus');
  assert.equal(officialRows(r.alerts, ...HELSINKI, NOW).length, 0);
});

test('parseMirror: väärä muoto heittää, liian vanha peili ei kelpaa', () => {
  const good = buildMirror(alertsOf(defaults({ id: 'a1' })), NOW);
  for (const bad of [null, 'x', [], {}, { ...good, v: 2 }, { ...good, alerts: 'ei' }, { ...good, fetchedAt: 'eilen' }, { ...good, fetchedAt: undefined }]) assert.throws(() => parseMirror(bad, NOW), /Varoitukset: peilin/, JSON.stringify(bad)?.slice(0, 40));
  const stale = parseMirror(good, NOW + 7 * HOUR);
  assert.equal(stale.ok, false);
  assert.match(stale.reason, /vanhentunut \(päivitetty ti 17\.11\. klo 12\)/);
  assert.equal(parseMirror(good, NOW + 5 * HOUR).ok, true);
  assert.equal(parseMirror({ ...good, alerts: [] }, NOW).alerts.length, 0, 'tyhjä peili on kelvollinen: ei voimassa olevia varoituksia');
});

test('parseMirror: vihamielinen tai rikkinäinen aineisto siivotaan eikä kaada', () => {
  const ring = [[60.2, 21.8], [60.7, 21.8], [60.7, 22.8]];
  const ok = { id: 'ok', event: 'E', severity: 'Severe', onset: NOW, expires: NOW + HOUR, areas: [{ desc: 'A', polys: [ring] }] };
  const hostile = [
    null,
    'merkkijono',
    { ...ok, id: 'ei-expires', expires: null },
    { ...ok, id: 'expires-teksti', expires: '2026-11-17' },
    { ...ok, id: 'ei-alueita', areas: [] },
    { ...ok, id: 'ei-alueita2', areas: 'x' },
    { ...ok, id: 'rengas-liian-lyhyt', areas: [{ desc: 'A', polys: [[[60, 21], [61, 21]]] }] },
    { ...ok, id: 'piste-ulkona', areas: [{ desc: 'A', polys: [[[60, 21], [61, 21], [999, 22]]] }] },
    { ...ok, id: 'piste-teksti', areas: [{ desc: 'A', polys: [[[60, 21], [61, 21], ['62', '22']]] }] },
    { ...ok, id: 'x'.repeat(500), event: 42, severity: 'Hirveä', headline: { a: 1 }, description: 'd'.repeat(5000), onset: 'huomenna' },
  ];
  const r = parseMirror({ v: 1, fetchedAt: iso(NOW), alerts: [ok, ...hostile] }, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.alerts.length, 2);
  assert.equal(r.alerts[0].id, 'ok');
  const last = r.alerts[1];
  assert.equal(last.id.length, 120);
  assert.equal(last.event, '');
  assert.equal(last.severity, '');
  assert.equal(last.headline, '');
  assert.equal(last.description.length, 800);
  assert.equal(last.onset, 0);
  const huge = Array.from({ length: 500 }, (_, i) => ({ ...ok, id: `h${i}` }));
  assert.equal(parseMirror({ v: 1, fetchedAt: iso(NOW), alerts: huge }, NOW).alerts.length, 200);
});

test('fetchWarnings: hakee peilin ilman omia otsikoita (ei CORS-esitarkistusta) ja palauttaa huomautuksen', async () => {
  const calls = [];
  const m = buildMirror(alertsOf(defaults({ id: 'a1' })), NOW);
  const fetchFn = async (url, init) => (calls.push([url, init]), reply(m)(url, init));
  const r = await fetchWarnings({ fetchFn, now: NOW + 60000 });
  assert.equal(r.ok, true);
  assert.equal(r.alerts.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], MIRROR_URL);
  assert.deepEqual(Object.keys(calls[0][1]), ['signal'], 'ei omia otsikoita');
  assert.match(MIRROR_URL, /^https:\/\/raw\.githubusercontent\.com\/juukal-ctrl\/saaaly\/warnings-data\/warnings\.json$/);
});

test('fetchWarnings: 404 kertoo ettei peiliä ole vielä, muut virheet heitetään sellaisenaan', async () => {
  await assert.rejects(fetchWarnings({ fetchFn: reply('', 404) }), (e) => e.status === 404 && /peiliä ei löytynyt/.test(e.message));
  await assert.rejects(fetchWarnings({ fetchFn: reply('', 503) }), (e) => e.status === 503 && /HTTP 503/.test(e.message));
  await assert.rejects(fetchWarnings({ fetchFn: reply('<html>ei json</html>') }), /ei ole luettavaa JSONia/);
  await assert.rejects(fetchWarnings({ fetchFn: reply('{"v":2}') }), /peilin muoto/);
  await assert.rejects(fetchWarnings({ fetchFn: reply(' '.repeat(2_000_001)) }), /liian suuri/);
  await assert.rejects(fetchWarnings({ fetchFn: async () => Promise.reject(new TypeError('Failed to fetch')) }), /Failed to fetch/);
});

test('fetchWarnings: vanhentunut peili ei ole virhe vaan { ok:false, reason }', async () => {
  const m = buildMirror(alertsOf(defaults({ id: 'a1' })), NOW);
  const r = await fetchWarnings({ fetchFn: reply(m), now: NOW + 8 * HOUR });
  assert.equal(r.ok, false);
  assert.match(r.reason, /vanhentunut/);
});

test('fetchWarnings: aikakatkaisu ja peruutus', async () => {
  const hang = (url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' }))));
  await assert.rejects(fetchWarnings({ fetchFn: hang, timeoutMs: 20 }), /aikakatkaisu/);
  const ctl = new AbortController();
  const p = fetchWarnings({ fetchFn: hang, timeoutMs: 5000, signal: ctl.signal });
  setTimeout(() => ctl.abort(), 10);
  await assert.rejects(p, (e) => e.cancelled === true);
});

test('inPoly: koveran monikulmion sisä- ja ulkopuoli', () => {
  const L = [[0, 0], [0, 10], [10, 10], [10, 6], [4, 6], [4, 4], [10, 4], [10, 0], [0, 0]]; // C-muoto
  assert.equal(inPoly(2, 2, L), true);
  assert.equal(inPoly(5, 5, L), false); // C:n aukko
  assert.equal(inPoly(5, 8, L), true);
  assert.equal(inPoly(11, 5, L), false);
});

test('whenText: nyt, tänään, huomenna ja usean päivän jakso', () => {
  const t = (s) => Date.parse(s);
  assert.equal(whenText(NOW - HOUR, t('2026-11-17T18:00:00+02:00'), NOW), 'voimassa nyt, päättyy tänään klo 18');
  assert.equal(whenText(t('2026-11-17T15:00:00+02:00'), t('2026-11-17T21:00:00+02:00'), NOW), 'tänään klo 15–21');
  assert.equal(whenText(t('2026-11-18T06:00:00+02:00'), t('2026-11-18T12:00:00+02:00'), NOW), 'huomenna klo 6–12');
  assert.equal(whenText(t('2026-11-17T22:00:00+02:00'), t('2026-11-19T08:00:00+02:00'), NOW), 'tänään klo 22 – to 19.11. klo 8');
});

test('officialRows: vakavin ensin, alue ja aika mukana, Minor ja kaukainen varoitus pois, enintään kolme', () => {
  const { alerts } = parseCapFeed(
    atom([
      entry(cap(defaults({ id: 'y', severity: 'Moderate' }))),
      entry(cap(defaults({ id: 'o', severity: 'Severe', event: 'Ukkosvaroitus', onset: NOW + 2 * HOUR, expires: NOW + 5 * HOUR }))),
      entry(cap(defaults({ id: 'm', severity: 'Minor' }))),
      entry(cap(defaults({ id: 'far', severity: 'Extreme', onset: NOW + 72 * HOUR, expires: NOW + 80 * HOUR }))),
      entry(cap(defaults({ id: 'o2', area: 'Oulu', poly: OULU_POLY }))),
    ]),
  );
  const rows = officialRows(alerts, ...TURKU, NOW);
  assert.deepEqual(rows.map((r) => r.id), ['o', 'y']);
  assert.equal(rows[0].severity, 'Severe');
  assert.equal(rows[0].title, 'Ukkosvaroitus');
  assert.equal(rows[0].when, 'Varsinais-Suomi · tänään klo 14–17');
  assert.equal(rows[1].when, 'Varsinais-Suomi · voimassa nyt, päättyy tänään klo 18');
  assert.match(rows[1].text, /Varaudu\.$/);
  assert.deepEqual(officialRows(alerts, ...HELSINKI, NOW), []);
});

test('esimerkkitilan varoitussyöte jäsentyy ja osuu vain Varsinais-Suomeen', async () => {
  const { syntheticWarningsFeed } = await import('../js/demo.js');
  const feed = (scenario) => parseCapFeed(syntheticWarningsFeed({ nowMs: NOW, scenario }));
  const thunder = feed('thunder').alerts;
  assert.equal(thunder.length, 1);
  assert.equal(officialRows(thunder, ...TURKU, NOW)[0].severity, 'Severe');
  assert.equal(officialRows(thunder, ...TURKU, NOW)[0].title, 'Ukkosvaroitus');
  assert.deepEqual(officialRows(thunder, ...HELSINKI, NOW), []);
  assert.equal(feed('snow').alerts[0].severity, 'Moderate');
  assert.equal(feed('mixed').alerts.length, 0);
});

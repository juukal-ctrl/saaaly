import test from 'node:test';
import assert from 'node:assert/strict';
import { parseXml, parseCapAlerts, parseCapFeed, inPoly, warningsAt, whenText, officialRows, fetchWarnings, FEED_URL } from '../js/warnings.js';

const NOW = Date.parse('2026-11-17T12:00:00+02:00'); // tiistai
const HOUR = 3600000;

// Turku (60.45, 22.27) ja Oulu (65.01, 25.47) ovat omissa monikulmioissaan; Helsinki (60.17, 24.94) kummankin ulkopuolella
const TURKU_POLY = '60.2,21.8 60.7,21.8 60.7,22.8 60.2,22.8 60.2,21.8';
const OULU_POLY = '64.8,25.0 65.2,25.0 65.2,26.0 64.8,26.0 64.8,25.0';
const TURKU = [60.45, 22.27];
const OULU = [65.01, 25.47];
const HELSINKI = [60.17, 24.94];

const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');

function info(lang, { event, severity, onset, expires, area, poly, color = 'yellow' }) {
  return `<info><language>${lang}</language><category>Met</category><event>${event}</event><urgency>Future</urgency><severity>${severity}</severity><certainty>Likely</certainty>
    <onset>${iso(onset)}</onset><expires>${iso(expires)}</expires><headline>${event} ${area}</headline><description>Kuvaus: ${event} &amp; puuskia &lt;20 m/s.</description><instruction>Varaudu.</instruction>
    <parameter><valueName>color</valueName><value>${color}</value></parameter>
    <area><areaDesc>${area}</areaDesc><polygon>${poly}</polygon></area></info>`;
}

function cap(o) {
  const { id = 'id1', status = 'Actual', msgType = 'Alert', refs = '', ns = 'xmlns' } = o;
  return `<alert ${ns}="urn:oasis:names:tc:emergency:cap:1.2"><identifier>${id}</identifier><sender>fmi</sender><sent>${iso(NOW - HOUR)}</sent><status>${status}</status><msgType>${msgType}</msgType><scope>Public</scope>${refs ? `<references>${refs}</references>` : ''}
    ${info('fi-FI', { ...o, event: o.event || 'Tuulivaroitus' })}${info('sv-FI', { ...o, event: 'Vindvarning' })}${info('en-GB', { ...o, event: 'Wind warning' })}</alert>`;
}

const defaults = (extra) => ({ severity: 'Moderate', onset: NOW - HOUR, expires: NOW + 6 * HOUR, area: 'Varsinais-Suomi', poly: TURKU_POLY, ...extra });
const atom = (entries) => `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Varoitukset</title>${entries.join('')}</feed>`;
const entry = (inner, link = '') => `<entry><id>e</id><title>Varoitus</title>${link}<content type="text/xml">${inner}</content></entry>`;

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
  assert.throws(() => parseXml('<a>' + 'x'.repeat(3_100_000) + '</a>'), /XML ei jäsenny/);
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

test('linkkimerkinnät: osoitteet kerätään ja fetchWarnings hakee ne (enintään maxLinks)', async () => {
  const links = Array.from({ length: 5 }, (_, i) => `https://alerts.fmi.fi/cap/2026/11-17/${i}.xml`);
  const feed = atom(links.map((h, i) => `<entry><id>${i}</id><title>t</title><link rel="alternate" type="application/cap+xml" href="${h}"/></entry>`));
  assert.equal(parseCapFeed(feed).alerts.length, 0);
  assert.deepEqual(parseCapFeed(feed).links, links);
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push([url, init]);
    const body = url === FEED_URL ? feed : cap(defaults({ id: url.slice(-5) }));
    return { ok: true, status: 200, text: async () => body };
  };
  const r = await fetchWarnings({ fetchFn, maxLinks: 3 });
  assert.equal(r.ok, true);
  assert.equal(r.alerts.length, 3);
  assert.equal(calls.length, 4); // syöte + 3 liitettä
  for (const [, init] of calls) assert.deepEqual(Object.keys(init), ['signal'], 'ei omia otsikoita (CORS-esitarkistus)');
});

test('fetchWarnings: upotettu sisältö ei hae liitteitä; HTTP-virhe ja rikkinäinen XML heitetään', async () => {
  const ok = atom([entry(cap(defaults({ id: 'a1' })), '<link rel="alternate" type="application/cap+xml" href="https://alerts.fmi.fi/cap/x.xml"/>')]);
  let n = 0;
  const r = await fetchWarnings({ fetchFn: async () => (n++, { ok: true, status: 200, text: async () => ok }) });
  assert.equal(r.alerts.length, 1);
  assert.equal(n, 1);
  await assert.rejects(fetchWarnings({ fetchFn: async () => ({ ok: false, status: 503, text: async () => '' }) }), (e) => e.status === 503);
  await assert.rejects(fetchWarnings({ fetchFn: async () => ({ ok: true, status: 200, text: async () => '<feed><entry></feed>' }) }), /XML ei jäsenny/);
  await assert.rejects(fetchWarnings({ fetchFn: async () => Promise.reject(new TypeError('Failed to fetch')) }), /Failed to fetch/);
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

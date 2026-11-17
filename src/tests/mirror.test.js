// Peilityökalu (tools/mirror-warnings.mjs): Atom-syöte -> tiivistelmä, jonka sovellus lukee. Ajetaan myös komentoriviltä oikeilla tiedostoilla.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mirrorFromFeed, fitMirror, FEED_URL } from '../tools/mirror-warnings.mjs';
import { parseMirror, officialRows } from '../js/warnings.js';
import { NOW, HOUR, OULU_POLY, TURKU, cap, defaults, atom, entry } from './cap-fixtures.js';

const TOOL = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'mirror-warnings.mjs');

test('FEED_URL on Ilmatieteen laitoksen suomenkielinen Atom-syöte', () => {
  assert.equal(FEED_URL, 'https://alerts.fmi.fi/cap/feed/atom_fi-FI.xml');
});

test('upotetut varoitukset: kolmikielisestä CAPista tulee suomenkielinen rivi, ja sovellus lukee tuloksen', async () => {
  const xml = atom([entry(cap(defaults({ id: 'a1' }))), entry(cap(defaults({ id: 'a2', severity: 'Severe', area: 'Pohjois-Pohjanmaa', poly: OULU_POLY })))]);
  const { mirror, stats } = await mirrorFromFeed(xml, { nowMs: NOW });
  assert.deepEqual(stats, { fromFeed: 2, linked: 0, total: 2 });
  assert.equal(mirror.alerts[0].id, 'a2'); // Severe ensin
  assert.equal(mirror.alerts[1].event, 'Tuulivaroitus');
  const r = parseMirror(JSON.parse(JSON.stringify(mirror)), NOW);
  assert.equal(officialRows(r.alerts, ...TURKU, NOW)[0].title, 'Tuulivaroitus');
});

test('linkkimerkinnät: CAP-tiedostot haetaan (enintään maxLinks), yksi huono liite ei kaada muita', async () => {
  const links = Array.from({ length: 5 }, (_, i) => `https://alerts.fmi.fi/cap/2026/11-17/${i}.xml`);
  const xml = atom(links.map((h, i) => `<entry><id>${i}</id><title>t</title><link rel="alternate" type="application/cap+xml" href="${h}"/></entry>`));
  const asked = [];
  const fetchFn = async (url) => {
    asked.push(url);
    if (url.endsWith('/1.xml')) throw new Error('HTTP 500');
    if (url.endsWith('/2.xml')) return '<ei-xml';
    return cap(defaults({ id: `l${asked.length}` }));
  };
  const { mirror, stats } = await mirrorFromFeed(xml, { fetchFn, nowMs: NOW, maxLinks: 4 });
  assert.equal(asked.length, 4);
  assert.deepEqual(asked, links.slice(0, 4));
  assert.equal(mirror.alerts.length, 2); // 0 ja 3 onnistuivat
  assert.equal(stats.linked, 2);
});

test('tyhjä syöte (ei merkintöjä) ja pelkkiä päättyneitä varoituksia ovat kelvollisia tyhjiä peilejä', async () => {
  const empty = await mirrorFromFeed(atom([]), { nowMs: NOW });
  assert.deepEqual(empty.mirror.alerts, []);
  const expired = await mirrorFromFeed(atom([entry(cap(defaults({ id: 'old', expires: NOW - 3 * HOUR })))]), { nowMs: NOW });
  assert.deepEqual(expired.mirror.alerts, []);
  const cancelled = await mirrorFromFeed(atom([entry(cap(defaults({ id: 'c', msgType: 'Cancel', refs: 'fmi,gone,2026-11-17T09:00:00Z' })))]), { nowMs: NOW });
  assert.deepEqual(cancelled.mirror.alerts, []);
});

test('merkintöjä ilman CAP-sisältöä heittää: tyhjää peiliä ei kirjoiteta, kun muoto on voinut muuttua', async () => {
  const xml = atom(['<entry><id>1</id><title>Keltainen tuulivaroitus</title><summary>Tekstiä ilman CAPia</summary></entry>']);
  await assert.rejects(mirrorFromFeed(xml, { nowMs: NOW }), /muoto on voinut muuttua/);
  await assert.rejects(mirrorFromFeed('<ei-xml', { nowMs: NOW }), /XML ei jäsenny/);
});

test('fitMirror: liian suuri peili typistetään pudottamalla lievimmät, vakavimmat säilyvät', async () => {
  const big = (n) => Array.from({ length: n }, (_, i) => `${(60 + (i % 90) / 100).toFixed(4)},${(22 + (i % 70) / 100).toFixed(4)}`).join(' ');
  const xml = atom([
    ...Array.from({ length: 12 }, (_, i) => entry(cap(defaults({ id: `m${i}`, poly: big(400) })))),
    entry(cap(defaults({ id: 'punainen', severity: 'Extreme', poly: big(400) }))),
  ]);
  const { mirror } = await mirrorFromFeed(xml, { nowMs: NOW });
  const full = JSON.stringify(mirror).length;
  assert.ok(full > 50_000);
  const same = fitMirror(mirror, full + 1);
  assert.equal(same.dropped, 0);
  const small = fitMirror(mirror, Math.floor(full / 3));
  assert.ok(small.json.length <= Math.floor(full / 3));
  assert.ok(small.dropped > 0 && small.dropped < 13);
  assert.equal(JSON.parse(small.json).alerts[0].id, 'punainen', 'vakavin varoitus säilyy aina');
  assert.throws(() => fitMirror(mirror, 100), /liian suuri/);
});

test('komentorivi: kirjoittaa peilin tiedostoon; --soft ei epäonnistu virheessä eikä kirjoita tiedostoa', () => {
  const dir = mkdtempSync(join(tmpdir(), 'peili-'));
  try {
    const feed = join(dir, 'syote.xml');
    const out = join(dir, 'warnings.json');
    writeFileSync(feed, atom([entry(cap(defaults({ id: 'a1', expires: Date.now() + 6 * HOUR })))]));
    const ok = spawnSync(process.execPath, [TOOL, out, '--from', feed], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr + ok.stdout);
    assert.match(ok.stdout, /Peili kirjoitettu: 1 varoitusta/);
    const m = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(parseMirror(m, Date.now()).alerts.length, 1);

    const bad = join(dir, 'rikki.xml');
    writeFileSync(bad, '<ei-xml');
    const out2 = join(dir, 'ei-kirjoiteta.json');
    const hard = spawnSync(process.execPath, [TOOL, out2, '--from', bad], { encoding: 'utf8' });
    assert.equal(hard.status, 1);
    assert.match(hard.stdout, /Varoitusten peilaus epäonnistui/);
    const soft = spawnSync(process.execPath, [TOOL, out2, '--from', bad, '--soft'], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true' } });
    assert.equal(soft.status, 0);
    assert.match(soft.stdout, /^::warning title=Varoitusten peilaus::/m);
    assert.ok(!existsSync(out2), 'virheessä ei kirjoiteta tulostiedostoa, joten edellinen peili jää voimaan');

    assert.equal(spawnSync(process.execPath, [TOOL], { encoding: 'utf8' }).status, 2, 'ilman tulostiedostoa kerrotaan käyttö');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

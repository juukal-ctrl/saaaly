// tools/mirror-warnings.mjs: hakee Ilmatieteen laitoksen CAP-syötteen ja kirjoittaa siitä tiivistelmän, jonka sovellus lukee (js/warnings.js: buildMirror).
// Selain ei voi hakea syötettä suoraan (palvelu ei salli CORS-hakua), joten tämä ajetaan GitHub Actionsissa (.github/workflows/mirror-warnings.yml)
// neljännestunnin välein ja tulos julkaistaan repon haaraan warnings-data.
//
// Käyttö: node tools/mirror-warnings.mjs <tulostiedosto> [--from <syöte.xml>] [--soft]
//   --from  lukee syötteen paikallisesta tiedostosta verkon sijaan (kokeilu ja testit)
//   --soft  virhe kirjataan varoituksena eikä prosessi epäonnistu (Actions: ei toistuvia virhesähköposteja). Tulostiedostoa ei silloin kirjoiteta,
//           joten edellinen peili jää voimaan.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseCapFeed, parseCapAlerts, buildMirror } from '../js/warnings.js';

export const FEED_URL = 'https://alerts.fmi.fi/cap/feed/atom_fi-FI.xml';
const MAX_BYTES = 15_000_000;
const MAX_OUT = 1_800_000; // sovellus hylkää yli 2 Mt:n peilin

async function get(url, label) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'SaaAly-peilaus (+https://github.com/juukal-ctrl/saaaly)', accept: 'application/atom+xml, application/cap+xml, application/xml;q=0.9, */*;q=0.5' },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error(`${label}: vastaus on liian suuri`);
  return text;
}

/**
 * Atom-syötteen teksti -> { mirror, stats }. Jos merkinnät vain linkittävät CAP-tiedostoihin, haetaan ne (enintään maxLinks).
 * Heittää, jos syötteessä on merkintöjä mutta ei CAP-sisältöä lainkaan: silloin muoto on voinut muuttua, eikä tyhjää peiliä saa kirjoittaa
 * (se näyttäisi käyttäjälle "ei varoituksia" silloin, kun varoituksia ei vain osata lukea).
 */
export async function mirrorFromFeed(xml, { fetchFn = (u) => get(u, 'CAP-liite'), nowMs = Date.now(), maxLinks = 80 } = {}) {
  const feed = parseCapFeed(xml, 'fi-FI');
  const alerts = [...feed.alerts];
  let linked = 0;
  if (!alerts.length && feed.links.length) {
    for (const u of feed.links.slice(0, maxLinks)) {
      try {
        const got = parseCapAlerts(await fetchFn(u), 'fi-FI');
        alerts.push(...got);
        if (got.length) linked++;
      } catch {
        /* yksi huono liite ei kaada muita */
      }
    }
  }
  const hasEntries = /<entry[\s>]/i.test(xml);
  const hasCap = feed.links.length > 0 || /<(?:\w+:)?alert[\s>]/i.test(xml) || /&lt;(?:\w+:)?alert[\s>]/i.test(xml);
  if (hasEntries && !hasCap) throw new Error('syötteessä on merkintöjä, mutta niissä ei ole CAP-sisältöä (muoto on voinut muuttua)');
  const mirror = buildMirror(alerts, nowMs);
  return { mirror, stats: { fromFeed: feed.alerts.length, linked, total: mirror.alerts.length } };
}

/**
 * Sovittaa peilin kokorajaan. Poikkeuksellisen laajassa sääilmiössä varoituksia voi olla paljon, ja juuri silloin peilin on päivityttävä:
 * vakavimmat (mirror.alerts on jo vakavin ensin) säilytetään ja loput pudotetaan, kunnes tulos mahtuu.
 */
export function fitMirror(mirror, maxChars = MAX_OUT) {
  let m = mirror;
  let json = JSON.stringify(m);
  while (json.length > maxChars && m.alerts.length > 1) {
    m = { ...m, alerts: m.alerts.slice(0, Math.max(1, Math.floor(m.alerts.length * 0.8))) };
    json = JSON.stringify(m);
  }
  if (json.length > maxChars) throw new Error(`peili on liian suuri (${json.length} merkkiä) myös yhdellä varoituksella`);
  return { json, dropped: mirror.alerts.length - m.alerts.length };
}

async function main(argv) {
  const args = argv.slice(2);
  const soft = args.includes('--soft');
  const fromAt = args.indexOf('--from');
  const from = fromAt >= 0 ? args[fromAt + 1] : '';
  const out = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--from');
  if (!out) {
    console.error('Käyttö: node tools/mirror-warnings.mjs <tulostiedosto> [--from <syöte.xml>] [--soft]');
    process.exit(2);
  }
  try {
    const xml = from ? readFileSync(from, 'utf8') : await get(FEED_URL, 'Syöte');
    const { mirror, stats } = await mirrorFromFeed(xml);
    const { json, dropped } = fitMirror(mirror);
    if (dropped) console.log(process.env.GITHUB_ACTIONS ? `::warning title=Varoitusten peilaus::Peili oli liian suuri: ${dropped} lievintä varoitusta jätettiin pois` : `Peili oli liian suuri: ${dropped} lievintä varoitusta jätettiin pois`);
    writeFileSync(out, json);
    console.log(`Peili kirjoitettu: ${stats.total - dropped} varoitusta (${stats.fromFeed} syötteessä, ${stats.linked} liitteistä), ${json.length} merkkiä, aika ${mirror.fetchedAt}`);
  } catch (e) {
    const msg = `Varoitusten peilaus epäonnistui: ${e?.message || e}`;
    console.log(process.env.GITHUB_ACTIONS ? `::warning title=Varoitusten peilaus::${msg}` : msg);
    process.exitCode = soft ? 0 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv);

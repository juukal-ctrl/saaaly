// tools/publish.mjs: kopioi julkaise/-kansion tiedostot repon juureen, josta GitHub Pages tarjoilee ne.
// Käyttö repossa (lähdekoodi on kansiossa src/):  cd src && node tools/build.mjs && node tools/publish.mjs
// Sen jälkeen: git add -A && git commit && git push. Skripti ei koske gitiin.

import { readFileSync, readdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'julkaise');
const dest = resolve(root, '..');

const EXPECTED = [
  'app.css',
  'crash.js',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'icon.svg',
  'index.html',
  'manifest.webmanifest',
  'saaaly.js',
  'sw.js',
  'version.json',
  'trk-d.webp',
  'trk-n.webp',
  'braid.webp',
  'cap.webp',
  'pearls.webp',
  'inter-display-regular.woff',
  'inter-display-medium.woff',
  'inter-display-semibold.woff',
  'inter-display-bold.woff',
  'inter-OFL.txt',
  ...['d-sun', 'd-part_sun', 'd-part', 'd-part_cloud', 'd-cloud', 'd-rain', 'd-snow', 'd-storm', 'n-moon', 'n-moonpart', 'n-cloud', 'n-rain', 'n-snow', 'n-storm'].map((n) => `wx-${n}.webp`),
];

function fail(msg) {
  console.error('Julkaisu keskeytettiin: ' + msg);
  process.exit(1);
}

// Turva: kopioidaan vain repon juureen (siellä on .nojekyll), ei satunnaiseen hakemistoon.
if (!existsSync(join(dest, '.nojekyll'))) fail(`${dest} ei näytä repon juurelta (tiedosto .nojekyll puuttuu). Aja skripti repon kansiosta src/.`);
if (!existsSync(site)) fail('julkaise/ puuttuu. Aja ensin: node tools/build.mjs');

const have = readdirSync(site).sort();
if (JSON.stringify(have) !== JSON.stringify([...EXPECTED].sort())) {
  fail(`julkaise/ ei sisällä täsmälleen odotettuja ${EXPECTED.length} tiedostoa.\n  löytyi: ${have.join(', ')}\n  odotettiin: ${EXPECTED.join(', ')}`);
}

// Tiedostojen pitää olla samasta käännöksestä: versiotunnus löytyy version.json:sta, sw.js:stä ja saaaly.js:stä.
const build = JSON.parse(readFileSync(join(site, 'version.json'), 'utf8')).build;
for (const f of ['sw.js', 'saaaly.js']) {
  if (!readFileSync(join(site, f), 'utf8').includes(build)) fail(`${f} ei sisällä versiotunnusta ${build}: julkaise/ on vanhentunut. Aja: node tools/build.mjs`);
}

const changed = [];
const same = [];
for (const f of EXPECTED) {
  const from = join(site, f);
  const to = join(dest, f);
  const equal = existsSync(to) && readFileSync(from).equals(readFileSync(to));
  if (equal) same.push(f);
  else {
    copyFileSync(from, to);
    changed.push(f);
  }
}
console.log(`Versio ${JSON.parse(readFileSync(join(site, 'version.json'), 'utf8')).version}, tunnus ${build}`);
console.log(`Päivitetty repon juureen: ${changed.length ? changed.join(', ') : '(ei muutoksia)'}`);
if (same.length) console.log(`Ennallaan: ${same.join(', ')}`);

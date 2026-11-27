// Julkaisukansion (julkaise/) tarkistukset. Kansio tehdään komennolla "node tools/build.mjs".
// Jos jokin testi kaatuu viestiin "aja: node tools/build.mjs", kansio on vanhentunut lähdekoodiin nähden.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'julkaise');
const HINT = ' (aja: node tools/build.mjs)';
const EXPECTED = ['index.html', 'crash.js', 'saaaly.js', 'app.css', 'sw.js', 'version.json', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
const WX = 'd-cloud d-part d-part_cloud d-part_sun d-rain d-snow d-storm d-sun n-cloud n-moon n-moonpart n-rain n-snow n-storm'.split(' ').map((n) => `wx-${n}.webp`).concat(['trk-d.webp', 'trk-n.webp', 'braid.webp', 'cap.webp', 'pearls.webp']);
const FONTS = ['inter-display-regular.woff', 'inter-display-medium.woff', 'inter-display-semibold.woff', 'inter-display-bold.woff'];
const MAPS = ['map-nordic.json', 'map-europe.json'];
EXPECTED.push(...WX, ...FONTS, 'inter-OFL.txt', ...MAPS);

const read = (name) => readFileSync(join(site, name), 'utf8');
const names = () => readdirSync(site).sort();
const flatten = (s) => s.replace(/(["'])(?:css|icons|fonts)\//g, '$1');
const isLocal = (u) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(u);

function refs() {
  const html = read('index.html');
  const fromHtml = [...html.matchAll(/<(?:link|script)\b[^>]*?\s(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  const manifest = JSON.parse(read('manifest.webmanifest'));
  const shell = [...read('sw.js').match(/const SHELL = \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  return { fromHtml, manifest, fromManifest: manifest.icons.map((i) => i.src), shell };
}

test('julkaise/ sisältää täsmälleen julkaistavat tiedostot eikä yhtään alikansiota', () => {
  assert.deepEqual(names(), [...EXPECTED].sort(), 'tiedostolista poikkeaa odotetusta' + HINT);
  for (const n of names()) assert.ok(statSync(join(site, n)).isFile(), `${n} ei ole tiedosto`);
});

test('julkaise/ vastaa lähdekansiota (ei vanhentuneita kopioita)', () => {
  const same = (a, b, label) => assert.ok(readFileSync(a).equals(readFileSync(b)), `${label} on vanhentunut${HINT}`);
  // Julkaisussa pohjakartat ovat samassa kansiossa: vain MAP_DIR eroaa lähteestä.
  assert.equal(read('saaaly.js'), readFileSync(join(root, 'saaaly.js'), 'utf8').replace("const MAP_DIR = 'maps/';", "const MAP_DIR = '';"), `saaaly.js on vanhentunut${HINT}`);
  for (const m of MAPS) same(join(site, m), join(root, 'maps', m), m);
  same(join(site, 'crash.js'), join(root, 'crash.js'), 'crash.js');
  // julkaistussa tyylitiedostossa kuvapolut on litistetty (url(../icons/x) -> url(x))
  assert.equal(read('app.css'), readFileSync(join(root, 'css/app.css'), 'utf8').replace(/url\(\.\.\/(?:icons|fonts)\//g, 'url('), `app.css on vanhentunut${HINT}`);
  for (const f of ['icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', ...WX]) same(join(site, f), join(root, 'icons', f), f);
  for (const f of FONTS) same(join(site, f), join(root, 'fonts', f), f);
  same(join(site, 'inter-OFL.txt'), join(root, 'fonts', 'OFL.txt'), 'inter-OFL.txt');
  for (const f of ['index.html', 'manifest.webmanifest', 'sw.js']) {
    const built = read(f)
      .replace(/const BUILD = '[0-9a-f]{10}';/, "const BUILD = '__BUILD__';")
      .replace(/\n<meta http-equiv="Content-Security-Policy"[^>]*>/, ''); // CSP lisätään vain julkaistuun sivuun
    assert.equal(built, flatten(readFileSync(join(root, f), 'utf8')), `${f} on vanhentunut${HINT}`);
  }
});

test('index.html, manifest ja service worker viittaavat vain julkaise/-kansion tiedostoihin suhteellisilla poluilla', () => {
  const { fromHtml, manifest, fromManifest, shell } = refs();
  for (const need of ['crash.js', 'saaaly.js', 'app.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png']) assert.ok(fromHtml.includes(need), `index.html ei viittaa tiedostoon ${need}`);
  const files = new Set(names());
  for (const ref of [...fromHtml, ...fromManifest, ...shell].filter(isLocal)) {
    assert.ok(!ref.startsWith('/'), `polku ei saa alkaa kauttaviivalla (projektisivu on alipolussa): ${ref}`);
    if (ref === './') continue;
    assert.ok(files.has(ref), `julkaise/-kansiosta puuttuu viitattu tiedosto: ${ref}`);
  }
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
});

test('service workerin kuori sisältää kaikki sivun tarvitsemat tiedostot (toimii ilman verkkoa)', () => {
  const { fromHtml, shell } = refs();
  assert.ok(shell.includes('./') && shell.includes('index.html'), 'sivu puuttuu kuoresta');
  for (const ref of fromHtml.filter(isLocal)) assert.ok(shell.includes(ref), `puuttuu SHELL-listasta: ${ref}`);
});

test('PNG-kuvakkeet ovat manifestissa ilmoitetun kokoisia', () => {
  const { manifest } = refs();
  const png = manifest.icons.filter((i) => i.type === 'image/png');
  assert.equal(png.length, 3);
  for (const icon of png) {
    const buf = readFileSync(join(site, icon.src));
    assert.equal(buf.subarray(1, 4).toString('latin1'), 'PNG', `${icon.src} ei ole PNG-tiedosto`);
    assert.equal(`${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`, icon.sizes, `${icon.src}: todellinen koko poikkeaa ilmoitetusta`);
  }
  assert.ok(png.some((i) => i.sizes === '192x192' && i.purpose === 'any'));
  assert.ok(png.some((i) => i.sizes === '512x512' && i.purpose === 'any'));
  assert.ok(png.some((i) => i.purpose === 'maskable'));
});

test('versiotunnus on sama saaaly.js:ssä, sw.js:ssä ja version.json:ssa, ja versio vastaa package.json-tiedostoa', () => {
  const info = JSON.parse(read('version.json'));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.match(info.build, /^[0-9a-f]{10}$/, 'version.json: build-tunnus puuttuu' + HINT);
  assert.equal(info.version, pkg.version);
  assert.ok(read('saaaly.js').includes(`const BUILD = '${info.build}';`), 'saaaly.js:n BUILD ei vastaa version.json-tiedostoa' + HINT);
  assert.ok(read('sw.js').includes(`const BUILD = '${info.build}';`), 'sw.js:n BUILD ei vastaa version.json-tiedostoa' + HINT);
  assert.ok(read('saaaly.js').includes(`const VERSION = '${pkg.version}';`), 'app.js:n VERSION ei vastaa package.json-versiota');
  const shell = refs().shell;
  assert.ok(!shell.includes('version.json'), 'version.json ei saa olla välimuistissa (SHELL)');
});

// ---- Content-Security-Policy ----

const LINK_ONLY = new Set(['www.ilmatieteenlaitos.fi', 'open-meteo.com', 'aistudio.google.com', 'www.w3.org', 'www.rainviewer.com']); // linkkejä tai nimiavaruuksia, ei verkkopyyntöjä

function csp() {
  const m = read('index.html').match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(m, 'julkaise/index.html:stä puuttuu CSP-meta' + HINT);
  return Object.fromEntries(m[1].split(/;\s*/).map((d) => [d.split(' ')[0], d.split(' ').slice(1)]));
}

test('CSP on ensimmäisenä head-elementissä, kieltää oletuksena kaiken eikä salli skripteille inline- tai eval-suoritusta', () => {
  const html = read('index.html');
  assert.equal(html.match(/Content-Security-Policy/g).length, 1);
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'), 'CSP pitää olla ennen ensimmäistä skriptiä');
  const p = csp();
  assert.deepEqual(p['default-src'], ["'none'"]);
  assert.deepEqual(p['script-src'], ["'self'"]);
  assert.deepEqual(p['object-src'], ["'none'"]);
  assert.deepEqual(p['base-uri'], ["'none'"]);
  assert.ok(!JSON.stringify(p).includes('unsafe-eval'));
  assert.ok(!html.includes('<script>'), 'julkaistussa sivussa ei saa olla inline-skriptejä');
  assert.ok(!/\son[a-z]+="/i.test(html), 'julkaistussa sivussa ei saa olla inline-tapahtumankäsittelijöitä');
});

test('CSP:n sallimat osoitteet ovat täsmälleen ne, joita koodi käyttää (ei vanhentuneita, ei puuttuvia)', () => {
  // Haettavat osoitteet (connect-src) ja kuvina näytettävät (img-src, tutkatiilet).
  const allowed = [...csp()['connect-src'], ...csp()['img-src']].filter((x) => x.startsWith('https://')).map((x) => x.slice(8));
  const used = new Set();
  for (const f of readdirSync(join(root, 'js')).filter((n) => n.endsWith('.js'))) {
    for (const m of readFileSync(join(root, 'js', f), 'utf8').matchAll(/https:\/\/([a-z0-9.-]+)/gi)) used.add(m[1]);
  }
  for (const h of used) if (!LINK_ONLY.has(h)) assert.ok(allowed.includes(h), `koodi käyttää osoitetta ${h}, jota CSP ei salli (lisää se tools/build.mjs:n CSP_CONNECT-listaan tai LINK_ONLY, jos kyse on vain linkistä)`);
  for (const h of allowed) assert.ok(used.has(h), `CSP sallii osoitteen ${h}, jota koodi ei käytä (poista se tools/build.mjs:stä)`);
});

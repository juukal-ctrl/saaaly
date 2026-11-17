// tools/build.mjs: yhdistää js/-moduulit yhdeksi tiedostoksi (saaaly.js) ja tekee yksitiedostoisen esikatselusivun.
// Ei ulkoisia riippuvuuksia: poistaa import/export-lauseet ja kääntää jokaisen moduulin omaksi funktiokseen.
// Käyttö: node tools/build.mjs

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const jsDir = join(root, 'js');

const IMPORT_RE = /^import\s+([\s\S]*?)\s+from\s+'(\.\/[\w.-]+\.js)';?[ \t]*$/gm;
const EXPORT_RE = /^export\s+(async\s+function\*?|function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;

function transform(name, src) {
  const deps = [];
  let code = src.replace(IMPORT_RE, (m, clause, spec) => {
    const dep = spec.replace(/^\.\//, '').replace(/\.js$/, '');
    deps.push(dep);
    const c = clause.trim();
    if (c.startsWith('{')) {
      const names = c
        .slice(1, -1)
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => x.replace(/\s+as\s+/, ': '));
      return `const { ${names.join(', ')} } = __m['${dep}'];`;
    }
    const ns = /^\*\s+as\s+(\w+)$/.exec(c);
    if (ns) return `const ${ns[1]} = __m['${dep}'];`;
    throw new Error(`${name}.js: tukematon import-muoto: ${m}`);
  });
  const exports = [];
  code = code.replace(EXPORT_RE, (m, kw, id) => {
    exports.push(id);
    return `${kw.replace(/\s+/g, ' ')} ${id}`;
  });
  if (/^export\s/m.test(code)) throw new Error(`${name}.js: tukematon export-muoto`);
  if (/\bimport\.meta\b/.test(code)) throw new Error(`${name}.js: import.meta ei ole tuettu`);
  if (/^import\s/m.test(code)) throw new Error(`${name}.js: import-lause jäi muuntamatta`);
  return { deps, code, exports };
}

const order = [];
const mods = {};
const state = {};
function visit(name, chain = []) {
  if (state[name] === 'done') return;
  if (state[name] === 'busy') throw new Error(`Kehäriippuvuus: ${[...chain, name].join(' -> ')}`);
  state[name] = 'busy';
  const t = transform(name, readFileSync(join(jsDir, `${name}.js`), 'utf8'));
  mods[name] = t;
  t.deps.forEach((d) => visit(d, [...chain, name]));
  state[name] = 'done';
  order.push(name);
}
visit('app');

let bundle = '// GENEROITU TIEDOSTO. Älä muokkaa: lähdekoodi on js/-kansiossa. Tämä tehdään komennolla "node tools/build.mjs".\n';
bundle += "(() => {\n'use strict';\nconst __m = {};\n";
for (const name of order) {
  const m = mods[name];
  bundle += `\n// ---- ${name}.js ----\n__m['${name}'] = (() => {\n${m.code.trimEnd()}\n${m.exports.length ? `return { ${m.exports.join(', ')} };\n` : ''}})();\n`;
}
bundle += '})();\n';
if (/<\/script/i.test(bundle)) throw new Error('Paketti sisältää </script-merkkijonon, jota ei voi upottaa HTML:ään');

// ---- Content-Security-Policy ----
// Sallitut verkko-osoitteet: vain ne palvelut, joihin sovellus oikeasti ottaa yhteyttä (README: "Tietolähteet"). Uusi lähde = uusi rivi tähän.
// tests/deploy.test.js varmistaa, että jokainen tässä mainittu osoite löytyy lähdekoodista ja että koodin hakemat osoitteet on sallittu.
// 'unsafe-inline' tyyleissä tarvitaan, koska näkymät kirjoittavat muutaman style-attribuutin (päivien lämpötilapalkit). Skripteille ei sallita sitä.
const CSP_CONNECT = [
  'https://api.open-meteo.com',
  'https://geocoding-api.open-meteo.com',
  'https://api.bigdatacloud.net',
  'https://nominatim.openstreetmap.org',
  'https://generativelanguage.googleapis.com',
  'https://api.met.no',
  'https://raw.githubusercontent.com', // varoitusten peili (haara warnings-data), ks. js/warnings.js
];
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  `connect-src 'self' ${CSP_CONNECT.join(' ')}`,
  "manifest-src 'self'",
  "worker-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ');
const CSP_ANCHOR = '<meta charset="utf-8">';

// Versiotunnus: muuttuu aina, kun jokin julkaistava tiedosto muuttuu. Sovellus vertaa sitä version.json-tiedostoon ja ilmoittaa uudesta versiosta.
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (!bundle.includes("'__BUILD__'")) throw new Error("app.js:stä puuttuu BUILD-paikanvaraaja '__BUILD__'");
const hash = createHash('sha1').update(bundle).update(CSP);
for (const f of ['css/app.css', 'index.html', 'crash.js', 'manifest.webmanifest', 'sw.js']) hash.update(readFileSync(join(root, f)));
const BUILD = hash.digest('hex').slice(0, 10);
bundle = bundle.replace("'__BUILD__'", `'${BUILD}'`);

writeFileSync(join(root, 'saaaly.js'), bundle);
console.log(`saaaly.js: ${order.length} moduulia, ${(bundle.length / 1024).toFixed(1)} kt, versio ${pkg.version}, tunnus ${BUILD} (${order.join(', ')})`);

// ---- Yksitiedostoinen esikatselu (esimerkkidata, ei verkkoyhteyksiä) ----
let html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'css/app.css'), 'utf8');
const svgPath = join(root, 'icons/icon.svg');
const svg = existsSync(svgPath) ? readFileSync(svgPath, 'utf8') : '';
html = html
  .replace('<link rel="stylesheet" href="css/app.css">', () => `<style>\n${css}\n</style>`)
  .replace('<link rel="manifest" href="manifest.webmanifest">\n', '')
  .replace('<link rel="apple-touch-icon" href="icons/icon-192.png">\n', '')
  .replace('<link rel="icon" href="icons/icon.svg" type="image/svg+xml">', () => (svg ? `<link rel="icon" href="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">` : ''))
  .replace('<script src="crash.js"></script>', () => `<script>\n${readFileSync(join(root, 'crash.js'), 'utf8')}</script>`)
  .replace('<script src="saaaly.js" defer></script>', () => `<script>window.SAAALY_DEMO = true;</script>\n<script>\n${bundle}</script>`);
if (html.includes('saaaly.js"') || html.includes('css/app.css') || html.includes('src="crash.js"')) throw new Error('Esikatselun muunnos epäonnistui');
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/preview.html'), html);
copyFileSync(join(root, 'dist/preview.html'), join(root, 'esikatselu.html')); // sama sivu zipin mukana, avattavissa tuplaklikkaamalla
console.log(`dist/preview.html: ${(html.length / 1024).toFixed(1)} kt`);

// ---- Julkaistava esikatselu Claude-artefaktina (osa sivusta ilman <html>/<head>-kehystä) ----
{
  const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>')).trim();
  const art =
    '<title>SääÄly AI Weather</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n<style>\n' + css + '\n</style>\n' + body + '\n';
  writeFileSync(join(root, 'dist/artifact.html'), art);
  console.log(`dist/artifact.html: ${(art.length / 1024).toFixed(1)} kt`);
}

// ---- Julkaisukansio: kaikki julkaistavat tiedostot samassa kansiossa ----
// Puhelimen tiedostovalitsin ei osaa valita kansioita, joten julkaise/ on litteä (ei alikansioita)
// ja tiedostopolut on korjattu sen mukaisiksi (css/app.css -> app.css, icons/x.png -> x.png).
{
  const out = join(root, 'julkaise');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out);
  for (const f of ['index.html', 'manifest.webmanifest', 'sw.js']) {
    let text = readFileSync(join(root, f), 'utf8').replace(/(["'])(?:css|icons)\//g, '$1').replace("'__BUILD__'", `'${BUILD}'`);
    // Content-Security-Policy vain julkaistuun sivuun (esikatselu upottaa skriptin sivuun, joten se ei kelpaa samalla säännöllä)
    if (f === 'index.html') {
      if (!text.includes(CSP_ANCHOR)) throw new Error('index.html:stä puuttuu <meta charset>, jonka perään CSP lisätään');
      text = text.replace(CSP_ANCHOR, `${CSP_ANCHOR}\n<meta http-equiv="Content-Security-Policy" content="${CSP}">`);
    }
    if (/\b(?:css|icons)\//.test(text)) throw new Error(`julkaise/${f}: alikansiopolku jäi korjaamatta`);
    writeFileSync(join(out, f), text);
  }
  copyFileSync(join(root, 'saaaly.js'), join(out, 'saaaly.js'));
  copyFileSync(join(root, 'crash.js'), join(out, 'crash.js'));
  writeFileSync(join(out, 'version.json'), JSON.stringify({ version: pkg.version, build: BUILD }) + '\n');
  copyFileSync(join(root, 'css/app.css'), join(out, 'app.css'));
  for (const f of readdirSync(join(root, 'icons'))) copyFileSync(join(root, 'icons', f), join(out, f));
  const files = readdirSync(out).sort();
  console.log(`julkaise/: ${files.length} tiedostoa (${files.join(', ')})`);
}

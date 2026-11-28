// Suosikkipaikat: tallennus, siistiminen, enimmäismäärä, kaksoiskappaleet (~1 km = sama paikka), koti ensin ja kevyt nykysää.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FAV_MAX, FAV_WX_TTL, normalizeFav, samePlace, parseFavs, addFav, removeFav, toggleFav, toggleHome, isFav, findFav, codeToSym, currentUrl, parseCurrent, fetchCurrent, parseWxCache, staleFavs, wxKey } from '../js/favorites.js';
import { store } from '../js/util.js';
import { SYMBOLS } from '../js/blend.js';
import { makeDemoFetch } from '../js/demo.js';
import { favListHtml, favCurrentHtml, searchSheetHtml, resultsHtml } from '../js/views.js';
import { matchInflected, fold } from '../js/gazetteer.js';

const turku = { name: 'Turku', region: 'Varsinais-Suomi', country: 'Suomi', lat: 60.4518, lon: 22.2666 };
const oulu = { name: 'Oulu', region: 'Pohjois-Pohjanmaa', country: 'Suomi', lat: 65.0121, lon: 25.4651 };
const ruka = { name: 'Ruka', region: 'Pohjois-Pohjanmaa', country: 'Suomi', lat: 66.1666, lon: 29.15 };
const city = (i) => ({ name: `Paikka ${i}`, region: '', country: 'Suomi', lat: 60 + i * 0.5, lon: 24 });

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
test.beforeEach(() => mem.clear());

// ---------- Tallennus ja siistiminen ----------

test('normalizeFav: kelvollinen paikka siistitään, kelvoton hylätään', () => {
  assert.deepEqual(normalizeFav({ ...turku, mode: 'manual', gps: true, extra: 'x' }), { name: 'Turku', region: 'Varsinais-Suomi', country: 'Suomi', lat: 60.4518, lon: 22.2666 });
  assert.deepEqual(normalizeFav({ name: '  Oulu  ', lat: '65.01214', lon: 25.46511 }), { name: 'Oulu', region: '', country: '', lat: 65.0121, lon: 25.4651 });
  assert.equal(normalizeFav({ ...turku, home: true }).home, true);
  assert.equal(normalizeFav({ ...turku, home: 'kyllä' }).home, undefined);
  for (const bad of [null, 1, 'Turku', [], {}, { name: '', lat: 1, lon: 2 }, { name: 'X', lat: null, lon: 2 }, { name: 'X', lat: 91, lon: 2 }, { name: 'X', lat: 1, lon: -181 }, { name: 'X', lat: NaN, lon: 2 }, { name: 'X', lat: true, lon: 2 }, { name: { a: 1 }, lat: 1, lon: 2 }]) {
    assert.equal(normalizeFav(bad), null, JSON.stringify(bad));
  }
  assert.equal(normalizeFav({ name: 'a'.repeat(500), lat: 1, lon: 2 }).name.length, 80);
});

test('parseFavs: rikkinäinen tallennus ei kaada, kelvottomat rivit pois', () => {
  for (const raw of [null, undefined, 'x', 7, { a: 1 }, true]) assert.deepEqual(parseFavs(raw), []);
  assert.deepEqual(parseFavs([null, 'x', { a: 1 }, turku, { name: 'Huono', lat: 'x', lon: 1 }]).map((p) => p.name), ['Turku']);
  // store-apurin kautta: rikkinäinen JSON ja väärä tyyppi antavat tyhjän listan
  mem.set('saaaly.favs', '{rikki');
  assert.deepEqual(parseFavs(store.get('favs', [])), []);
  mem.set('saaaly.favs', '{"a":1}');
  assert.deepEqual(parseFavs(store.get('favs', [])), []);
  store.set('favs', [turku, oulu]);
  assert.deepEqual(parseFavs(store.get('favs', [])).map((p) => p.name), ['Turku', 'Oulu']);
});

test('parseFavs: enintään FAV_MAX, kaksoiskappaleet pois, vain yksi koti ja se ensin', () => {
  const many = Array.from({ length: 20 }, (_, i) => city(i));
  assert.equal(parseFavs(many).length, FAV_MAX);
  const near = { ...turku, name: 'Turku keskusta', lat: turku.lat + 0.004 }; // noin 450 m
  assert.deepEqual(parseFavs([turku, near, oulu]).map((p) => p.name), ['Turku', 'Oulu']);
  const two = parseFavs([turku, { ...oulu, home: true }, { ...ruka, home: true }]);
  assert.deepEqual(two.map((p) => p.name), ['Oulu', 'Turku', 'Ruka']);
  assert.deepEqual(two.map((p) => Boolean(p.home)), [true, false, false]);
});

test('samePlace: alle kilometri on sama paikka, yli kilometri eri', () => {
  assert.equal(samePlace(turku, { lat: turku.lat + 0.008, lon: turku.lon }), true); // ~0,9 km
  assert.equal(samePlace(turku, { lat: turku.lat + 0.01, lon: turku.lon }), false); // ~1,1 km
  assert.equal(samePlace(turku, { lat: turku.lat, lon: turku.lon + 0.017 }), true); // ~0,94 km leveyspiirillä 60°
  assert.equal(samePlace(turku, null), false);
  assert.equal(samePlace(turku, { lat: 'x', lon: 1 }), false);
});

// ---------- Lisäys, poisto ja koti ----------

test('addFav: ensimmäisestä tulee koti, kaksoiskappale ja täysi lista hylätään syyn kanssa', () => {
  let r = addFav([], turku);
  assert.equal(r.ok, true);
  assert.equal(r.list[0].home, true, 'ensimmäinen suosikki on koti');
  r = addFav(r.list, oulu);
  assert.deepEqual(r.list.map((p) => p.name), ['Turku', 'Oulu']);
  assert.equal(r.list[1].home, undefined);
  const dup = addFav(r.list, { ...turku, name: 'Åbo', lat: turku.lat + 0.003 });
  assert.equal(dup.ok, false);
  assert.equal(dup.reason, 'dup');
  assert.equal(dup.list, r.list, 'lista ei muutu');
  assert.equal(addFav(r.list, { name: '', lat: 1, lon: 1 }).reason, 'bad');
  let list = [];
  for (let i = 0; i < FAV_MAX; i++) list = addFav(list, city(i)).list;
  assert.equal(list.length, FAV_MAX);
  const full = addFav(list, ruka);
  assert.equal(full.ok, false);
  assert.equal(full.reason, 'full');
  assert.equal(full.list.length, FAV_MAX);
  const home = addFav(addFav([], turku).list, oulu, { home: true }).list;
  assert.deepEqual(home.map((p) => `${p.name}${p.home ? '*' : ''}`), ['Oulu*', 'Turku']);
});

test('removeFav ja toggleFav: poisto ~1 km:n tarkkuudella, kytkin kertoo tilan', () => {
  const list = addFav(addFav([], turku).list, oulu).list;
  assert.deepEqual(removeFav(list, { lat: oulu.lat + 0.002, lon: oulu.lon }).map((p) => p.name), ['Turku']);
  assert.equal(removeFav(list, ruka), list);
  let t = toggleFav(list, ruka);
  assert.equal(t.on, true);
  assert.equal(isFav(t.list, ruka), true);
  t = toggleFav(t.list, ruka);
  assert.equal(t.on, false);
  assert.equal(isFav(t.list, ruka), false);
  assert.equal(findFav(t.list, oulu), 1);
  assert.equal(findFav(t.list, null), -1);
});

test('toggleHome: koti siirtyy ensimmäiseksi; toinen painallus poistaa kotimerkinnän mutta paikka jää', () => {
  let list = [turku, oulu, ruka].reduce((l, p) => addFav(l, p).list, []);
  list = toggleHome(list, ruka);
  assert.deepEqual(list.map((p) => `${p.name}${p.home ? '*' : ''}`), ['Ruka*', 'Turku', 'Oulu']);
  list = toggleHome(list, ruka);
  assert.deepEqual(list.map((p) => `${p.name}${p.home ? '*' : ''}`), ['Ruka', 'Turku', 'Oulu']);
  assert.equal(toggleHome(list, { lat: 0, lon: 0 }), list);
  // Kodin poisto ei tee seuraavasta kotia
  list = removeFav(toggleHome(list, oulu), oulu);
  assert.ok(list.every((p) => !p.home));
});

// ---------- Nykysää ----------

test('codeToSym: WMO-tunnukset sovelluksen symboleiksi (kaikki tunnetut kuvakkeet)', () => {
  const cases = { 0: 'clear', 1: 'mostly_clear', 2: 'partly_cloudy', 3: 'overcast', 45: 'fog', 48: 'fog', 51: 'drizzle', 55: 'drizzle', 56: 'sleet', 61: 'rain_light', 63: 'rain', 65: 'rain_heavy', 67: 'sleet', 71: 'snow_light', 73: 'snow', 75: 'snow_heavy', 77: 'snow_light', 80: 'rain_light', 81: 'rain', 82: 'rain_heavy', 85: 'snow_light', 86: 'snow_heavy', 95: 'thunder', 99: 'thunder' };
  for (const [c, s] of Object.entries(cases)) assert.equal(codeToSym(+c), s, c);
  for (const c of [null, undefined, 'x', 42]) assert.ok(SYMBOLS[codeToSym(c)], String(c));
});

test('currentUrl: yksi pyyntö monelle paikalle, koordinaatit kahden desimaalin tarkkuudella', () => {
  const u = new URL(currentUrl([turku, oulu]));
  assert.equal(u.hostname, 'api.open-meteo.com');
  assert.equal(u.pathname, '/v1/forecast');
  assert.equal(u.searchParams.get('latitude'), '60.45,65.01');
  assert.equal(u.searchParams.get('longitude'), '22.27,25.47');
  assert.equal(u.searchParams.get('current'), 'temperature_2m,weather_code,is_day');
  assert.equal(u.searchParams.get('hourly'), null, 'ei tuntiennustetta: kevyt haku');
});

test('parseCurrent: yksi paikka on olio, monta taulukko; puuttuvat ja mahdottomat arvot ovat null', () => {
  assert.deepEqual(parseCurrent({ current: { temperature_2m: -3.2, weather_code: 71, is_day: 0 } }, 1), [{ temp: -3.2, sym: 'snow_light', isDay: false }]);
  const arr = parseCurrent([{ current: { temperature_2m: 5, weather_code: 3, is_day: 1 } }, { current: { temperature_2m: null } }, { current: { temperature_2m: 999 } }], 4);
  assert.deepEqual(arr, [{ temp: 5, sym: 'overcast', isDay: true }, null, null, null]);
  assert.deepEqual(parseCurrent(null, 2), [null, null]);
  assert.deepEqual(parseCurrent('roskaa', 1), [null]);
});

test('fetchCurrent: yksi haku, virhe heitetään, peruutus on AbortError', async () => {
  const urls = [];
  const fetchFn = async (u) => {
    urls.push(u);
    return new Response(JSON.stringify([{ current: { temperature_2m: 1, weather_code: 0, is_day: 1 } }, { current: { temperature_2m: 2, weather_code: 61, is_day: 1 } }]), { status: 200 });
  };
  const got = await fetchCurrent([turku, oulu], { fetchFn });
  assert.equal(urls.length, 1);
  assert.deepEqual(got.map((g) => g.sym), ['clear', 'rain_light']);
  assert.deepEqual(await fetchCurrent([], { fetchFn }), []);
  assert.equal(urls.length, 1, 'tyhjä lista ei hae');
  await assert.rejects(fetchCurrent([turku], { fetchFn: async () => new Response('{}', { status: 503 }) }), /HTTP 503/);
  const ctl = new AbortController();
  const slow = (u, { signal }) => new Promise((_, no) => signal.addEventListener('abort', () => no(Object.assign(new Error('abort'), { name: 'AbortError' }))));
  const p = fetchCurrent([turku], { fetchFn: slow, signal: ctl.signal });
  ctl.abort();
  await assert.rejects(p, (e) => e.name === 'AbortError');
});

test('nykysään välimuisti: rikkinäinen tallennus siivotaan, vanhat (15 min) haetaan uudelleen', () => {
  const now = 1_800_000_000_000;
  const raw = { [wxKey(turku)]: { temp: 4, sym: 'rain', isDay: true, at: now - 60000 }, [wxKey(oulu)]: { temp: 1, sym: 'snow', at: now - FAV_WX_TTL - 1 }, 'roska': { temp: 1, sym: 'x', at: 1 }, '1.00,2.00': { temp: 'x', sym: 'x', at: 1 } };
  const c = parseWxCache(raw);
  assert.deepEqual(Object.keys(c).sort(), [wxKey(oulu), wxKey(turku)].sort());
  for (const bad of [null, 'x', [], 3]) assert.deepEqual(parseWxCache(bad), {});
  assert.deepEqual(staleFavs([turku, oulu, ruka], c, now).map((p) => p.name), ['Oulu', 'Ruka']);
  assert.deepEqual(staleFavs([turku], { [wxKey(turku)]: { temp: 1, sym: 'clear', at: now + 3600000 } }, now).map((p) => p.name), ['Turku'], 'tulevaisuuden aikaleima (kello siirtyi) ei kelpaa');
});

test('esimerkkitila vastaa monen paikan nykysäähakuun Open-Meteon muodossa', async () => {
  const fetchFn = makeDemoFetch({ scenario: 'snow', nowMs: Date.UTC(2026, 9, 14, 17, 4) });
  const many = parseCurrent(await (await fetchFn(currentUrl([turku, oulu, ruka]))).json(), 3);
  assert.equal(many.length, 3);
  assert.ok(many.every((w) => w && Number.isFinite(w.temp) && SYMBOLS[w.sym]), JSON.stringify(many));
  const one = await (await fetchFn(currentUrl([turku]))).json();
  assert.ok(!Array.isArray(one) && one.current, 'yksi paikka palautuu oliona kuten oikeassa rajapinnassa');
});

// ---------- Näkymä ----------

test('suosikkilista: koti ensin merkinnällä, lämpötila ja kuvake, painikkeilla aria-pressed ja nimi', () => {
  const favs = parseFavs([{ ...turku, home: true }, oulu]);
  const h = favListHtml({ favs, wx: [{ temp: 4.4, sym: 'rain', isDay: true }, null], current: 1 });
  assert.match(h, /Turku<span class="fav-tag">Koti<\/span>/);
  assert.match(h, /fav-tag now">Nyt/);
  assert.match(h, /aria-current="true"/);
  assert.match(h, /<span class="fav-t">\+4°<\/span>/);
  assert.match(h, /wx-d-rain/);
  assert.match(h, /sr-only">, Vesisadetta/);
  assert.match(h, /fav-wx pending/, 'haun puuttuessa näkyy paikanvaraaja');
  assert.match(h, /data-act="fav-del" data-i="1" aria-pressed="true" aria-label="Suosikki: Oulu"/);
  assert.match(h, /data-act="fav-home" data-i="0" aria-pressed="true" aria-label="Koti: Turku"/);
  assert.match(h, /data-act="fav-home" data-i="1" aria-pressed="false"/);
  assert.match(favListHtml({ favs: [] }), /Tallenna paikka tähdellä/);
  const evil = favListHtml({ favs: [{ name: '<img src=x>', lat: 1, lon: 1 }] });
  assert.doesNotMatch(evil, /<img/);
});

test('paikkapaneeli: nykyisen paikan tähti, laskuri, suosikit ennen viimeksi katsottuja, suosikki ei toistu viimeksi katsotuissa', () => {
  const favs = parseFavs([turku]);
  const h = searchSheetHtml({ recent: [turku, oulu], favs, wx: [null], current: 0, place: turku, isFav: (p) => isFav(favs, p) });
  assert.match(favCurrentHtml({ place: turku, on: true }), /data-act="fav-cur" aria-pressed="true" aria-label="Suosikki: Turku"/);
  assert.match(favCurrentHtml({ place: oulu, on: false, full: true }), /enimmäismäärä/);
  assert.match(h, /Suosikit <span class="fav-count">1\/8<\/span>/);
  assert.ok(h.indexOf('id="favs"') < h.indexOf('Viimeksi katsotut'));
  assert.equal((h.match(/data-act="pick-recent"/g) || []).length, 1, 'suosikki ei näy toiseen kertaan');
  assert.match(h, /data-act="pick-recent" data-i="1"/, 'indeksi viittaa alkuperäiseen listaan');
  assert.match(resultsHtml([turku, oulu], '', (p) => isFav(favs, p)), /data-act="fav-found" data-i="0" aria-pressed="true"[\s\S]*data-act="fav-found" data-i="1" aria-pressed="false"/);
});

// ---------- Chat ----------

test('taivutettu suosikin nimi löytyy (chat): "Särkisalossa" -> Särkisalo', () => {
  const entries = [{ name: 'Särkisalo', key: fold('Särkisalo') }, { name: 'Nuuksio', key: fold('Nuuksio') }];
  assert.equal(matchInflected('Särkisalossa', entries)?.name, 'Särkisalo');
  assert.equal(matchInflected('Nuuksiossa', entries)?.name, 'Nuuksio');
  assert.equal(matchInflected('nuuksiossa', entries)?.name, 'Nuuksio');
  assert.equal(matchInflected('Helsingissä', entries), null);
});

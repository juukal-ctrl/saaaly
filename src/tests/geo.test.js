import test from 'node:test';
import assert from 'node:assert/strict';
import { reverseGeocode, searchPlaces, localizeRegion, nearestCity, haversineKm, placeSubtitle, placeKey } from '../js/geo.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('käänteinen geokoodaus: BigDataCloud antaa kaupungin ja maakunnan suomeksi', async () => {
  const fetchFn = async (url) => {
    assert.match(url, /bigdatacloud/);
    assert.match(url, /localityLanguage=fi/);
    return json({ city: 'Turku', locality: 'Kupittaa', principalSubdivision: 'Southwest Finland', countryName: 'Suomi' });
  };
  const r = await reverseGeocode(60.4518, 22.2666, { fetchFn });
  assert.equal(r.name, 'Turku');
  assert.equal(r.region, 'Varsinais-Suomi');
  assert.equal(r.country, 'Suomi');
  assert.equal(r.source, 'bigdatacloud');
});

test('käänteinen geokoodaus: tyhjä city -> locality', async () => {
  const fetchFn = async () => json({ city: '', locality: 'Kyrö', principalSubdivision: 'Pirkanmaa', countryName: 'Suomi' });
  const r = await reverseGeocode(61.5, 23.7, { fetchFn });
  assert.equal(r.name, 'Kyrö');
});

test('käänteinen geokoodaus: Nominatim varana, kun BigDataCloud ei vastaa', async () => {
  const seen = [];
  const fetchFn = async (url) => {
    seen.push(new URL(url).hostname);
    if (url.includes('bigdatacloud')) return new Response('virhe', { status: 500 });
    return json({ address: { town: 'Loimaa', county: 'Loimaan seutukunta', state: 'Lounais-Suomi', country: 'Suomi' } });
  };
  const r = await reverseGeocode(60.85, 23.05, { fetchFn });
  assert.deepEqual(seen, ['api.bigdatacloud.net', 'nominatim.openstreetmap.org']);
  assert.equal(r.name, 'Loimaa');
  assert.equal(r.source, 'nominatim');
  assert.equal(r.errors.length, 1);
});

test('käänteinen geokoodaus: molemmat kaatuvat -> lähin suomalainen kaupunki', async () => {
  const fetchFn = async () => {
    throw new TypeError('Failed to fetch');
  };
  const r = await reverseGeocode(60.47, 22.3, { fetchFn });
  assert.equal(r.name, 'Turku');
  assert.equal(r.region, 'Varsinais-Suomi');
  assert.equal(r.source, 'offline');
  assert.equal(r.note, 'lähin kaupunki');
  assert.equal(r.errors.length, 2);
});

test('käänteinen geokoodaus: kaukana Suomesta näytetään koordinaatit eikä "Oma sijainti"', async () => {
  const fetchFn = async () => {
    throw new Error('ei verkkoa');
  };
  const r = await reverseGeocode(28.29, -16.63, { fetchFn });
  assert.equal(r.source, 'coords');
  assert.equal(r.name, '28,29°N 16,63°W');
});

test('paikkahaku muuntaa tulokset ja suojaa tyhjältä haulta', async () => {
  let calls = 0;
  const fetchFn = async (url) => {
    calls++;
    assert.match(url, /language=fi/);
    assert.match(url, /name=Loim/);
    return json({ results: [{ name: 'Loimaa', latitude: 60.85, longitude: 23.05, country: 'Suomi', country_code: 'FI', admin1: 'Southwest Finland', timezone: 'Europe/Helsinki', population: 16000 }] });
  };
  assert.deepEqual(await searchPlaces('L', { fetchFn }), []);
  assert.equal(calls, 0);
  const res = await searchPlaces('Loim', { fetchFn });
  assert.equal(res.length, 1);
  assert.deepEqual(res[0], { name: 'Loimaa', region: 'Varsinais-Suomi', country: 'Suomi', countryCode: 'FI', lat: 60.85, lon: 23.05, tz: 'Europe/Helsinki', pop: 16000 });
  assert.deepEqual(await searchPlaces('Xyzzy', { fetchFn: async () => json({ generationtime_ms: 0.3 }) }), []);
});

test('maakuntien nimet suomennetaan', () => {
  assert.equal(localizeRegion('Southwest Finland'), 'Varsinais-Suomi');
  assert.equal(localizeRegion('SOUTHWEST FINLAND'), 'Varsinais-Suomi');
  assert.equal(localizeRegion('Lapland'), 'Lappi');
  assert.equal(localizeRegion('Uusimaa'), 'Uusimaa');
  assert.equal(localizeRegion('Stockholm County'), 'Stockholm County');
  assert.equal(localizeRegion(''), '');
});

test('etäisyys ja lähin kaupunki', () => {
  assert.ok(Math.abs(haversineKm(60.17, 24.94, 60.45, 22.27) - 150) < 10);
  assert.equal(nearestCity(66.5, 25.7).name, 'Rovaniemi');
  assert.equal(placeSubtitle({ region: 'Lappi', country: 'Suomi' }), 'Lappi, Suomi');
  assert.equal(placeSubtitle({ region: 'Suomi', country: 'Suomi' }), 'Suomi');
  assert.equal(placeKey({ lat: 60.4518, lon: 22.2666 }), '60.45,22.27');
});

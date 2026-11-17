import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, textOf, listModels, pickFlash, compactForecast, systemPrompt, explain, chat, aiSettings, AiError, DEFAULT_MODEL, friendlyError } from '../js/ai.js';
import { blendForecast } from '../js/blend.js';
import { MODELS } from '../js/models.js';
import { parseModelResponse } from '../js/weather.js';
import { syntheticResponse } from '../js/demo.js';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
test.beforeEach(() => mem.clear());

const NOW = Date.UTC(2026, 9, 14, 17, 4);
const place = { name: 'Turku', region: 'Varsinais-Suomi', lat: 60.45, lon: 22.27 };
const fc = blendForecast(
  MODELS.map((m) => {
    const id = m.ids[0];
    return { model: m, ok: true, id, data: parseModelResponse(syntheticResponse({ lat: 60.45, lon: 22.27, modelId: id, nowMs: NOW }), id), ms: 1 };
  }),
);

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const reply = (text) => ({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] });

test('compactForecast on tiivis ja kertoo paikallisen ajan', () => {
  const c = compactForecast(fc, NOW);
  assert.equal(c.paikallinen_aika_nyt, '2026-10-14 20:04');
  assert.equal(c.aikavyohyke, 'Europe/Helsinki');
  assert.equal(c.tunnit.length, 48);
  assert.equal(c.tunnit[0][0], '10-14 20:00');
  assert.equal(c.paivat.length, 7);
  assert.equal(c.paivat[0][1], 'keskiviikko');
  assert.ok(JSON.stringify(c).length < 9000, 'konteksti ei saa paisua');
});

test('systemPrompt sisältää päivämäärän, paikan ja datan (ei "lokakuuta huhtikuussa" -virhettä)', () => {
  const s = systemPrompt({ place, fc, nowMs: NOW });
  assert.match(s, /keskiviikko 2026-10-14 klo 20:04/);
  assert.match(s, /Turku, Varsinais-Suomi/);
  assert.match(s, /SÄÄDATA/);
  assert.match(s, /get_forecast/);
});

test('generate lähettää avaimen otsikossa ja oikeassa osoitteessa', async () => {
  let seen;
  const fetchFn = async (url, init) => {
    seen = { url, init };
    return json(reply('Hei'));
  };
  const res = await generate({ key: 'AVAIN', model: 'gemini-x', system: 'S', contents: [{ role: 'user', parts: [{ text: 'k' }] }], fetchFn });
  assert.equal(textOf(res), 'Hei');
  assert.equal(seen.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent');
  assert.equal(seen.init.headers['x-goog-api-key'], 'AVAIN');
  const body = JSON.parse(seen.init.body);
  assert.equal(body.systemInstruction.parts[0].text, 'S');
  assert.equal(body.contents[0].role, 'user');
  assert.ok(!seen.url.includes('AVAIN'), 'avain ei saa olla osoitteessa');
});

test('generate: virheet muutetaan selkeiksi suomenkielisiksi viesteiksi', async () => {
  await assert.rejects(generate({ key: '', model: 'm', contents: [] }), (e) => e.kind === 'nokey');
  const mk = (status, message) => async () => json({ error: { message } }, status);
  await assert.rejects(generate({ key: 'k', model: 'm', contents: [], fetchFn: mk(400, 'API key not valid. Please pass a valid API key.') }), /avain ei kelpaa/);
  await assert.rejects(generate({ key: 'k', model: 'm', contents: [], fetchFn: mk(403, 'denied') }), /hylkäsi avaimen/);
  await assert.rejects(generate({ key: 'k', model: 'm', contents: [], fetchFn: mk(404, 'not found') }), (e) => e.status === 404 && /mallia ei löytynyt/i.test(e.message));
  await assert.rejects(generate({ key: 'k', model: 'm', contents: [], fetchFn: mk(429, 'quota') }), /kiintiö/);
  await assert.rejects(
    generate({ key: 'k', model: 'm', contents: [], fetchFn: async () => { throw new TypeError('Failed to fetch'); } }),
    (e) => e.kind === 'network',
  );
  assert.match(friendlyError(503, ''), /tilapäisesti/);
});

test('textOf: tyhjä vastaus ja esto antavat selkeän virheen, ajatusosat ohitetaan', () => {
  assert.throws(() => textOf({ candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] }), /tyhjän vastauksen \(MAX_TOKENS\)/);
  assert.throws(() => textOf({ promptFeedback: { blockReason: 'SAFETY' } }), /SAFETY/);
  assert.equal(textOf({ candidates: [{ content: { parts: [{ text: 'ajattelen', thought: true }, { text: 'Vastaus' }] } }] }), 'Vastaus');
});

test('pickFlash valitsee uusimman Flash-mallin', () => {
  assert.equal(pickFlash(['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-3-flash-preview', 'gemini-2.0-flash']), 'gemini-3-flash-preview');
  assert.equal(pickFlash(['gemini-3-flash-preview', 'gemini-3-flash']), 'gemini-3-flash');
  assert.equal(pickFlash(['gemini-2.5-flash', 'gemini-2.5-flash-image', 'gemini-2.5-flash-preview-tts', 'gemini-2.5-flash-lite']), 'gemini-2.5-flash');
  assert.equal(pickFlash(['gemini-2.5-pro']), null);
});

test('listModels palauttaa vain generateContent-mallit ilman models/-etuliitettä', async () => {
  const fetchFn = async () => json({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] }] });
  assert.deepEqual(await listModels({ key: 'k', fetchFn }), ['gemini-2.5-flash']);
});

test('explain: käyttää oletusmallia ja palauttaa tekstin', async () => {
  aiSettings.setKey('AVAIN');
  let body;
  const fetchFn = async (url, init) => {
    assert.ok(url.includes(`/models/${DEFAULT_MODEL}:`));
    body = JSON.parse(init.body);
    return json(reply('Illalla sataa.'));
  };
  const text = await explain({ fc, place, nowMs: NOW, selection: { type: 'now', label: 'nyt' }, fetchFn });
  assert.equal(text, 'Illalla sataa.');
  assert.match(body.systemInstruction.parts[0].text, /Turku/);
  assert.match(body.contents[0].parts[0].text, /tämä hetki/);
});

test('explain: 404 korjautuu hakemalla saatavilla oleva malli', async () => {
  aiSettings.setKey('AVAIN');
  const urls = [];
  const fetchFn = async (url) => {
    urls.push(url);
    if (url.includes(`/models/${DEFAULT_MODEL}:`)) return json({ error: { message: 'models/gemini-flash-latest is not found' } }, 404);
    if (url.includes('/models?pageSize')) return json({ models: [{ name: 'models/gemini-3-flash', supportedGenerationMethods: ['generateContent'] }] });
    return json(reply('Korjattu.'));
  };
  const text = await explain({ fc, place, nowMs: NOW, selection: { type: 'day', label: 'to 15.10.' }, fetchFn });
  assert.equal(text, 'Korjattu.');
  assert.equal(aiSettings.model(), 'gemini-3-flash');
  assert.equal(urls.length, 3);
});

test('chat: työkalukutsu suoritetaan ja tulos palautetaan mallille', async () => {
  aiSettings.setKey('AVAIN');
  const calls = [];
  const fetchFn = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    if (calls.length === 1) {
      assert.ok(body.tools, 'työkalut mukana');
      return json({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'get_forecast', args: { place: 'Rovaniemi' } }, thoughtSignature: 'SIG' }] } }] });
    }
    return json(reply('Rovaniemellä on kylmempää.'));
  };
  const ran = [];
  const out = await chat({
    fc, place, nowMs: NOW,
    history: [{ role: 'user', text: 'Millainen sää on Rovaniemellä?' }],
    runTool: async (name, args) => { ran.push([name, args]); return { paikka: 'Rovaniemi', lampotila_C: -2 }; },
    fetchFn,
  });
  assert.equal(out, 'Rovaniemellä on kylmempää.');
  assert.deepEqual(ran, [['get_forecast', { place: 'Rovaniemi' }]]);
  const second = calls[1].contents;
  assert.equal(second.at(-2).role, 'model');
  assert.equal(second.at(-2).parts[0].thoughtSignature, 'SIG'); // allekirjoitus säilyy
  assert.deepEqual(second.at(-1).parts[0].functionResponse.response.tulos, { paikka: 'Rovaniemi', lampotila_C: -2 });
});

test('chat: työkalun virhe ei kaada keskustelua', async () => {
  aiSettings.setKey('AVAIN');
  let n = 0;
  const fetchFn = async (url, init) => {
    n++;
    if (n === 1) return json({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'get_forecast', args: { place: 'Xyz' } } }] } }] });
    const body = JSON.parse(init.body);
    assert.equal(body.contents.at(-1).parts[0].functionResponse.response.tulos.virhe, 'Paikkaa ei löytynyt');
    return json(reply('En löytänyt paikkaa.'));
  };
  const out = await chat({ fc, place, nowMs: NOW, history: [{ role: 'user', text: 'Sää Xyz:ssä?' }], runTool: async () => { throw new Error('Paikkaa ei löytynyt'); }, fetchFn });
  assert.equal(out, 'En löytänyt paikkaa.');
});

test('chat: jos malli ei tue työkaluja (400), yritetään ilman niitä', async () => {
  aiSettings.setKey('AVAIN');
  let n = 0;
  const fetchFn = async (url, init) => {
    n++;
    const body = JSON.parse(init.body);
    if (body.tools) return json({ error: { message: 'Function calling is not enabled for this model' } }, 400);
    return json(reply('Vastaus ilman työkaluja.'));
  };
  const out = await chat({ fc, place, nowMs: NOW, history: [{ role: 'user', text: 'Hei' }], runTool: async () => ({}), fetchFn });
  assert.equal(out, 'Vastaus ilman työkaluja.');
  assert.equal(n, 2);
});

test('chat: ikuinen työkaluluuppi katkaistaan', async () => {
  aiSettings.setKey('AVAIN');
  const fetchFn = async () => json({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'get_forecast', args: { place: 'A' } } }] } }] });
  await assert.rejects(chat({ fc, place, nowMs: NOW, history: [{ role: 'user', text: 'x' }], runTool: async () => ({}), fetchFn, maxSteps: 3 }), (e) => e instanceof AiError && e.kind === 'loop');
});

test('chat: historia välittyy ja assistentin rooli on "model"', async () => {
  aiSettings.setKey('AVAIN');
  let body;
  const fetchFn = async (url, init) => {
    body = JSON.parse(init.body);
    return json(reply('ok'));
  };
  await chat({ fc, place, nowMs: NOW, history: [{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }, { role: 'user', text: 'c' }], fetchFn });
  assert.deepEqual(body.contents.map((c) => c.role), ['user', 'model', 'user']);
  assert.ok(!body.tools, 'ilman runTool-funktiota ei työkaluja');
});

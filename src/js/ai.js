// ai.js: Gemini-kutsut suoraan selaimesta omalla avaimella (avain pysyy vain tämän laitteen selaimessa).
// Tekoäly saa valmiin, koodilla lasketun datan ja selittää sen. Se ei laske lämpötiloja itse.

import { store, defaultFetch, weekday, localNow } from './util.js';
import { nowPosition, snapshot, modelRows, modelDaily, SYMBOLS } from './blend.js';

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_MODEL = 'gemini-flash-latest';

export class AiError extends Error {
  constructor(message, { kind = 'http', status = 0, details = '' } = {}) {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
    this.status = status;
    this.details = details;
  }
}

/** Tekoälyn tilat: internal = ei tekoälyä (sovelluksen oma laskenta), grounded = Gemini vain sovelluksen datalla, free = data + yleistieto. */
export const AI_MODES = ['internal', 'grounded', 'free'];

export const aiSettings = {
  key: () => store.str('geminiKey'),
  setKey: (k) => store.set('geminiKey', String(k || '').trim()),
  model: () => store.str('geminiModel') || DEFAULT_MODEL,
  setModel: (m) => store.set('geminiModel', String(m || '').trim()),
  /** Valittu tila. Ilman avainta käytössä on aina internal, vaikka tässä olisi jokin muu (ks. effectiveMode). */
  mode: () => {
    const m = store.str('aiMode', 'grounded');
    return AI_MODES.includes(m) ? m : 'grounded';
  },
  setMode: (m) => store.set('aiMode', AI_MODES.includes(m) ? m : 'grounded'),
};

/** Tila, jolla vastataan oikeasti: ilman avainta aina sovelluksen oma laskenta. */
export function effectiveMode(hasKey, mode) {
  return hasKey && AI_MODES.includes(mode) ? mode : 'internal';
}

/** Lyhyt syy, jonka vuoksi Gemini ei vastannut. Näytetään vastauksen lähdemerkinnässä, kun vastaus tulee varalaskennasta. */
export function shortReason(e) {
  const s = e?.status || 0;
  if (e?.kind === 'network') return 'ei verkkoyhteyttä';
  if (e?.kind === 'nokey') return 'avainta ei ole';
  if (e?.kind === 'blocked' || e?.kind === 'empty') return 'tyhjä vastaus';
  if (e?.kind === 'loop') return 'vastaus jäi kesken';
  if (s === 429) return 'kiintiö täynnä';
  if (s === 404) return 'mallia ei löytynyt';
  if (s === 401 || s === 403 || (s === 400 && /api key/i.test(e?.details || e?.message || ''))) return 'avain ei kelvannut';
  if (s >= 500) return 'palvelu ei vastaa';
  return 'virhe';
}

export function friendlyError(status, message) {
  if (status === 400 && /api key/i.test(message)) return 'Gemini-avain ei kelpaa. Tarkista avain asetuksista.';
  if (status === 401 || status === 403) return `Gemini hylkäsi avaimen (${status}). Tarkista, että avain on voimassa ja että se saa käyttää Gemini API:a.`;
  if (status === 404) return 'Gemini-mallia ei löytynyt. Avaa asetukset ja hae saatavilla olevat mallit.';
  if (status === 429) return 'Gemini-kiintiö on hetkeksi täynnä. Yritä uudelleen hetken päästä.';
  if (status >= 500) return 'Gemini on tilapäisesti poissa käytöstä. Yritä hetken päästä uudelleen.';
  return message || `Virhe ${status}`;
}

// ---------- Matalan tason kutsut ----------

export async function generate({ key, model, system, contents, tools, temperature = 0.5, fetchFn = defaultFetch, signal }) {
  if (!key) throw new AiError('Gemini-avainta ei ole asetettu. Lisää se asetuksista.', { kind: 'nokey' });
  const body = { contents, generationConfig: { temperature } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (tools) body.tools = tools;
  let res;
  try {
    res = await fetchFn(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw new AiError('Keskeytetty', { kind: 'abort' });
    throw new AiError('Geminiin ei saatu yhteyttä. Tarkista verkkoyhteys.', { kind: 'network', details: e?.message });
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ei JSON */
  }
  if (!res.ok) {
    const raw = json?.error?.message || text.slice(0, 200);
    throw new AiError(friendlyError(res.status, raw), { status: res.status, details: raw });
  }
  return json;
}

export function textOf(res) {
  const cand = res?.candidates?.[0];
  const text = (cand?.content?.parts || [])
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('')
    .trim();
  if (text) return text;
  const block = res?.promptFeedback?.blockReason;
  if (block) throw new AiError(`Gemini ei vastannut (${block}).`, { kind: 'blocked' });
  throw new AiError(`Gemini palautti tyhjän vastauksen${cand?.finishReason ? ` (${cand.finishReason})` : ''}.`, { kind: 'empty' });
}

export async function listModels({ key, fetchFn = defaultFetch }) {
  if (!key) throw new AiError('Gemini-avainta ei ole asetettu.', { kind: 'nokey' });
  let res;
  try {
    res = await fetchFn(`${GEMINI_BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
  } catch (e) {
    throw new AiError('Geminiin ei saatu yhteyttä.', { kind: 'network', details: e?.message });
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new AiError(friendlyError(res.status, json?.error?.message || ''), { status: res.status });
  return (json?.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name).replace(/^models\//, ''));
}

/** Valitsee uusimman Flash-mallin nimilistasta (ei lite-, kuva-, ääni- tai live-versioita). */
export function pickFlash(names) {
  let best = null;
  for (const n of names) {
    const m = /^gemini-(\d+(?:\.\d+)?)-flash(?:-(preview|exp)[\w.-]*)?$/.exec(n);
    if (!m) continue;
    const ver = parseFloat(m[1]);
    const preview = !!m[2];
    if (!best || ver > best.ver || (ver === best.ver && best.preview && !preview)) best = { n, ver, preview };
  }
  return best ? best.n : null;
}

/** Jos malli puuttuu (404), haetaan saatavilla oleva Flash-malli ja yritetään kerran uudelleen. */
async function withModelHeal(fn, { key, fetchFn }) {
  try {
    return await fn(aiSettings.model());
  } catch (e) {
    if (e.status !== 404) throw e;
    const names = await listModels({ key, fetchFn });
    const alt = pickFlash(names);
    if (!alt || alt === aiSettings.model()) throw e;
    aiSettings.setModel(alt);
    return fn(alt);
  }
}

// ---------- Konteksti ----------

const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

/**
 * Tiivis, koneluettava kuvaus ennusteesta tekoälylle. Kun results annetaan, mukaan tulevat myös
 * yksittäisten mallien omat luvut (nyt ja seuraavat päivät), jotta tekoäly voi kertoa, mitä mikin malli sanoo.
 */
export function compactForecast(fc, nowMs, { hours = 48, results = null } = {}) {
  const { idx, frac, local } = nowPosition(fc, nowMs);
  const rows = fc.hours.slice(idx, idx + hours).map((h) => [h.t.slice(5, 16).replace('T', ' '), r1(h.temp), r1(h.feels), r1(h.precip), Math.round(h.pop * 100), Math.round(h.cloud), r1(h.wind), r1(h.gust), SYMBOLS[h.sym]]);
  const days = fc.days.slice(0, 7).map((d) => [d.date, weekday(d.date, true), r1(d.tmin), r1(d.tmax), r1(d.precip), r1(d.wind), SYMBOLS[d.sym]]);
  const h0 = fc.hours[idx];
  const next = fc.hours[idx + 1] || h0;
  const out = {
    aikavyohyke: fc.tz,
    paikallinen_aika_nyt: local.iso.replace('T', ' '),
    lampotila_nyt_C: r1(h0.temp + (next.temp - h0.temp) * frac),
    mallien_lampotilahajonta_C: r1(h0.spread),
    malleja_kaytossa: fc.modelsUsed,
    tunnit_sarakkeet: ['aika', 'lampotila_C', 'tuntuu_C', 'sade_mm', 'sateen_todennakoisyys_%', 'pilvisyys_%', 'tuuli_ms', 'puuskat_ms', 'saa'],
    tunnit: rows,
    paivat_sarakkeet: ['paiva', 'viikonpaiva', 'alin_C', 'ylin_C', 'sade_mm', 'tuuli_ms', 'saa'],
    paivat: days,
  };
  if (results?.length) {
    const blendNow = snapshot(fc, idx, frac).temp;
    out.mallit_nyt = modelRows(results, fc, idx, frac, blendNow).map((r) =>
      r.ok
        ? { malli: r.model.short, lampotila_nyt_C: r1(r.temp), ero_yhdistelmaan_C: r1(r.delta), sade_24h_mm: r1(r.precip24) }
        : { malli: r.model.short, tila: r.skipped ? 'ei saatavilla' : r.coverage ? 'ei kata tätä paikkaa' : 'ei vastannut' },
    );
    out.mallit_paivittain_sarakkeet = ['paiva', 'alin_C', 'ylin_C', 'sade_mm', 'tuuli_max_ms'];
    out.mallit_paivittain = Object.fromEntries(modelDaily(results, fc, { days: 4 }).map((m) => [m.short, m.days]));
  }
  return out;
}

export function placeLabel(place) {
  const lower = (x) => String(x ?? '').toLocaleLowerCase('fi-FI');
  return [place.name, place.region && lower(place.region) !== lower(place.name) ? place.region : ''].filter(Boolean).join(', ');
}

const RULES_GROUNDED = [
  'TÄRKEÄT SÄÄNNÖT:',
  '1. Vastaat vain alla olevan SÄÄDATAN perusteella. Se on sovelluksen eri säämalleista (ECMWF, ICON, MET Norway, Météo-France, UK Met Office, GFS, GEM, FMI) hakema ja koodilla yhdistämä ennuste, ja se on ainoa tietolähteesi sään nykytilasta ja ennusteesta.',
  '2. Älä käytä omaa tietoasi nykyisestä säästä, ennusteista, havainnoista tai uutisista. Älä keksi lukuja, aikoja, paikkoja tai malleja, joita datassa ei ole.',
  '3. Jokaisen mainitsemasi luvun pitää löytyä datasta tai olla siitä suoraan laskettu (summa, ero, pienin tai suurin arvo). Kun kerrot, mitä yksittäinen malli ennustaa, käytä kenttiä mallit_nyt ja mallit_paivittain ja mainitse mallin nimi.',
  '4. Jos kysymykseen ei voi vastata datalla (aihe ei ole sää, ajankohta on ennusteen ulkopuolella tai paikka puuttuu), sano se lyhyesti ja kerro, mihin datalla voi vastata. Älä arvaa.',
  '5. Käytännön vinkit (pukeutuminen, liukkaus, ulkoilu) saat antaa vain, kun ne perustuvat datan lukuihin. Kerro luvut, joihin vinkki perustuu.',
];

const RULES_FREE = [
  'SÄÄNNÖT:',
  '1. Sääluvut (lämpötila, sade, tuuli, ajat) tulevat vain alla olevasta SÄÄDATASTA. Data on usean säämallin (ECMWF, ICON, MET Norway ym.) koodilla laskettu yhdistelmä. Älä keksi lukuja, aikoja tai paikkoja, joita datassa ei ole.',
  '2. Yleistietoa saat käyttää ilmiöiden selittämiseen ja käytännön neuvoihin. Erota selvästi, mikä tulee datasta ja mikä on yleistietoa.',
  '3. Jos data ei riitä vastaukseen, sano se.',
];

export function systemPrompt({ place, fc, nowMs, results = null, mode = 'grounded' }) {
  const ln = localNow(nowMs, fc.tz);
  const rules = mode === 'free' ? RULES_FREE : RULES_GROUNDED;
  return [
    'Olet SääÄly, suomenkielinen sääasiantuntija sääsovelluksessa.',
    ...rules,
    `Paikka: ${placeLabel(place)}. Paikallinen aika nyt: ${weekday(ln.date, true)} ${ln.date} klo ${ln.iso.slice(11)} (${fc.tz}). Kaikki datan ajat ovat tämän paikan paikallista aikaa.`,
    'Kirjoita selkeää, ystävällistä suomea. Ole ytimekäs: yleensä 3–6 lausetta. Käytä lämpötiloissa etumerkkiä (+5°, −3°) ja tuulessa yksikköä m/s.',
    'Jos mallit eroavat toisistaan (hajonta suuri), mainitse epävarmuus lyhyesti.',
    'Voit käyttää **lihavointia** ja lyhyitä luettelomerkkejä. Älä käytä otsikoita.',
    'Jos käyttäjä kysyy muun paikkakunnan kuin nykyisen paikan säästä, hae data get_forecast-työkalulla.',
    '',
    'SÄÄDATA (JSON):',
    JSON.stringify(compactForecast(fc, nowMs, { results })),
  ].join('\n');
}

export const TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'get_forecast',
        description: 'Hakee yhdistetyn sääennusteen mille tahansa paikkakunnalle. Käytä, kun käyttäjä kysyy muun paikan kuin nykyisen paikan säästä.',
        parameters: {
          type: 'OBJECT',
          properties: { place: { type: 'STRING', description: 'Paikkakunnan nimi, esim. "Rovaniemi" tai "Tukholma"' } },
          required: ['place'],
        },
      },
    ],
  },
];

// ---------- Selitys ja chat ----------

/** Selittää sään valitulle ajankohdalle. selection: { type:'now'|'hour'|'day', label } */
export async function explain({ fc, place, nowMs, selection, results = null, mode = 'grounded', fetchFn = defaultFetch, signal }) {
  const key = aiSettings.key();
  const target =
    selection.type === 'now'
      ? 'tämä hetki ja seuraavat tunnit'
      : selection.type === 'hour'
        ? `tunti ${selection.label}`
        : `päivä ${selection.label}`;
  const ask = `Selitä sää ajankohdalle: ${target}. Kerro, mitä on tulossa ja mikä sen todennäköisesti aiheuttaa, jos data antaa siihen aihetta. Lopuksi yksi käytännön vinkki. Enintään 90 sanaa.`;
  const system = systemPrompt({ place, fc, nowMs, results, mode: mode === 'free' ? 'free' : 'grounded' });
  return withModelHeal(
    async (model) => textOf(await generate({ key, model, system, contents: [{ role: 'user', parts: [{ text: ask }] }], temperature: 0.4, fetchFn, signal })),
    { key, fetchFn },
  );
}

/**
 * Keskustelu. history: [{role:'user'|'assistant', text}], viimeinen on käyttäjän.
 * runTool(name, args) palauttaa tavallisen objektin (esim. paikan ennuste).
 */
export async function chat({ fc, place, nowMs, history, results = null, mode = 'grounded', runTool, fetchFn = defaultFetch, signal, maxSteps = 4 }) {
  const key = aiSettings.key();
  const system = systemPrompt({ place, fc, nowMs, results, mode: mode === 'free' ? 'free' : 'grounded' });
  const contents = history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] }));
  let tools = runTool ? TOOLS : undefined;

  return withModelHeal(
    async (model) => {
      const convo = [...contents];
      for (let step = 0; step < maxSteps; step++) {
        let res;
        try {
          res = await generate({ key, model, system, contents: convo, tools, temperature: 0.5, fetchFn, signal });
        } catch (e) {
          if (tools && e.status === 400 && /function|tool/i.test(e.details || e.message)) {
            tools = undefined; // malli ei tue työkaluja: jatketaan ilman
            res = await generate({ key, model, system, contents: convo, temperature: 0.5, fetchFn, signal });
          } else throw e;
        }
        const cand = res?.candidates?.[0];
        const parts = cand?.content?.parts || [];
        const calls = parts.filter((p) => p.functionCall);
        if (!calls.length) return textOf(res);
        convo.push(cand.content); // säilyttää mallin allekirjoitukset sellaisenaan
        const answers = [];
        for (const c of calls) {
          let out;
          try {
            out = await runTool(c.functionCall.name, c.functionCall.args || {});
          } catch (e) {
            out = { virhe: e?.message || 'Työkalu epäonnistui' };
          }
          answers.push({ functionResponse: { name: c.functionCall.name, response: { tulos: out } } });
        }
        convo.push({ role: 'user', parts: answers });
      }
      throw new AiError('Tekoäly jäi kutsumaan työkaluja eikä vastannut.', { kind: 'loop' });
    },
    { key, fetchFn },
  );
}

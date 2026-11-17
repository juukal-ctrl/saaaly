// tools/expected.mjs: laskee, mitä lämpötilaa sovelluksen pitäisi näyttää "nyt" annetulle paikalle ja hetkelle.
// Käyttö: node tools/expected.mjs <lat> <lon> <nowMs> [skenaario]
import { makeDemoFetch } from '../js/demo.js';
import { fetchAll } from '../js/weather.js';
import { blendForecast, nowPosition, snapshot } from '../js/blend.js';
import { fmtTemp } from '../js/util.js';

const [lat, lon, now, scenario = 'mixed'] = process.argv.slice(2);
const nowMs = Number(now);
const results = await fetchAll(Number(lat), Number(lon), { fetchFn: makeDemoFetch({ scenario, nowMs }), now: nowMs });
const fc = blendForecast(results, { nowMs });
const { idx, frac } = nowPosition(fc, nowMs);
process.stdout.write(JSON.stringify({ temp: fmtTemp(snapshot(fc, idx, frac).temp), used: fc.modelsUsed }));

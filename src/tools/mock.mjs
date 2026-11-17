// tools/mock.mjs: palauttaa esimerkkidatan annetulle osoitteelle (e2e-testien verkkokutsujen korvaaja).
// Käyttö: node tools/mock.mjs <osoite> [skenaario] [nowMs]
import { makeDemoFetch } from '../js/demo.js';

const [url, scenario = 'mixed', now] = process.argv.slice(2);
const res = await makeDemoFetch({ scenario, nowMs: now ? Number(now) : undefined })(url);
process.stdout.write(JSON.stringify({ status: res.status, body: await res.text() }));

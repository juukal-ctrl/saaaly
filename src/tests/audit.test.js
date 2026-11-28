// Koodikatselmoinnin löydökset: jokainen testi kaatui ennen korjausta. Ajetaan sekä TZ=UTC että TZ=Europe/Helsinki.
import test from 'node:test';
import assert from 'node:assert/strict';
import { alertsHtml } from '../js/views.js';

test('varoitusrivin tarkistusaika näytetään paikan aikavyöhykkeessä, ei laitteen', () => {
  const now = Date.UTC(2026, 10, 26, 9, 45);
  // Helsinki (oletus): 2.24 UTC = 4.24 paikallista, sama päivä
  assert.match(alertsHtml({ checkedAt: Date.UTC(2026, 10, 26, 2, 24), nowMs: now }), /Varoitustieto klo 4\.24 /);
  assert.match(alertsHtml({ checkedAt: Date.UTC(2026, 10, 26, 2, 24), nowMs: now, tz: 'Europe/Helsinki' }), /Varoitustieto klo 4\.24 /);
  // Päivä vaihtuu paikan mukaan: 21.30 UTC 25.11. on Helsingissä jo 26.11. (sama päivä kuin nyt), UTC:ssä edellinen päivä
  assert.match(alertsHtml({ checkedAt: Date.UTC(2026, 10, 25, 22, 30), nowMs: now, tz: 'Europe/Helsinki' }), /Varoitustieto klo 0\.30 /);
  assert.match(alertsHtml({ checkedAt: Date.UTC(2026, 10, 25, 22, 30), nowMs: now, tz: 'UTC' }), /Varoitustieto 25\.11\. klo 22\.30 /);
});

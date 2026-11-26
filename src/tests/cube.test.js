import test from 'node:test';
import assert from 'node:assert/strict';
import { relPos, shortestStep, settleTarget, velocity, mod } from '../js/cube.js';

test('kuutio: kyljen paikka katsojaan nähden kiertää ympäri', () => {
  assert.equal(relPos(0, 0), 0);
  assert.equal(relPos(1, 0), 1); // Tunnit oikealla
  assert.equal(relPos(3, 0), -1); // Varmuus vasemmalla (kuutio jatkaa ympäri)
  assert.equal(relPos(2, 0), 2); // Viikko takana
  assert.equal(relPos(0, 3.5), 0.5); // Varmuudesta Kotiin kääntyessä Koti tulee oikealta
  assert.equal(relPos(3, 3.5), -0.5);
  assert.equal(mod(-1, 4), 3);
});

test('kuutio: pisteistä käännetään lyhintä reittiä', () => {
  assert.equal(shortestStep(0, 1), 1);
  assert.equal(shortestStep(3, 0), 1); // Varmuus -> Koti eteenpäin, ei kolmea kylkeä taaksepäin
  assert.equal(shortestStep(0, 3), -1);
  assert.equal(shortestStep(1, 1), 0);
  assert.equal(Math.abs(shortestStep(0, 2)), 2);
});

test('kuutio: irrotus asettuu pyyhkäisyn suuntaan tai lähimmälle kyljelle', () => {
  // Liikkeessä oleva pyyhkäisy vie seuraavalle, vaikka kääntö olisi alle puolen
  assert.equal(settleTarget(0.2, 0, 0.002), 1);
  assert.equal(settleTarget(-0.2, 0, -0.002), -1);
  // Hidas veto: kolmannes riittää, vähempi palaa takaisin
  assert.equal(settleTarget(0.4, 0, 0), 1);
  assert.equal(settleTarget(0.25, 0, 0), 0);
  assert.equal(settleTarget(1.8, 2, 0), 2); // pieni veto taaksepäin ei vaihda
  // Pyyhkäisy takaisin kohti alkua palauttaa
  assert.equal(settleTarget(0.6, 0, -0.002), 0);
  // Enintään yksi kylki yhdellä vedolla
  assert.equal(settleTarget(1.4, 0, 0.003), 1);
});

test('kuutio: nopeus lasketaan viimeisen 100 ms:n liikkeestä', () => {
  assert.equal(velocity([]), 0);
  assert.equal(velocity([[0, 0], [50, 0.1], [100, 0.2]]), 0.002);
  // Vanhat näytteet eivät laimenna irrotushetken nopeutta
  assert.equal(velocity([[0, 0], [400, 0], [450, 0.05], [500, 0.1]]), 0.001);
});

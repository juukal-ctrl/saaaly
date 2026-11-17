// Sääfysiikan funktiot: tuntuu kuin -kaava on tarkistettu Ilmatieteen laitoksen omilla yksikkötestiarvoilla
// (fmidev/smartmet-library-newbase, test/NFmiMetMathTest.cpp).

import test from 'node:test';
import assert from 'node:assert/strict';
import { fmiFeelsLike, summerSimmer, windChill, wetBulb, dewPoint, vpd } from '../js/phys.js';

const close = (x, y, eps = 0.002) => assert.ok(Math.abs(x - y) < eps, `${x} ≠ ${y}`);

test('tuntuu kuin: Ilmatieteen laitoksen kymmenen testiarvoa toistuvat', () => {
  const vectors = [
    [[0, 50, 0, null], 0.0],
    [[0, 50, 10, null], 10.0],
    [[5, 50, 0, null], -4.98],
    [[5, 50, -5, null], -10.653],
    [[5, 50, 25, null], 23.385],
    [[5, 90, 25, null], 26.588],
    [[0, 50, 0, 0], -0.25],
    [[0, 50, 10, 50], 9.995],
    [[5, 50, 0, 800], -2.617],
    [[5, 50, 25, 425], 24.523],
  ];
  for (const [args, want] of vectors) close(fmiFeelsLike(...args), want);
});

test('tuntuu kuin: tuuli viilentää, aurinko lämmittää, kosteus lisää helteen tuntua', () => {
  assert.ok(fmiFeelsLike(10, 80, -5) < fmiFeelsLike(1, 80, -5) - 3);
  assert.ok(fmiFeelsLike(2, 60, -2, 600) > fmiFeelsLike(2, 60, -2, 0) + 1);
  assert.ok(fmiFeelsLike(1, 90, 28) > fmiFeelsLike(1, 30, 28) + 2);
  assert.equal(summerSimmer(90, 10), 10); // alle 14,5 °C kosteus ei vaikuta
});

test('pakkasen tuulen viilennys: tyyni ei viilennä, 10 m/s pakkasessa viilentää selvästi', () => {
  close(windChill(0, -10), -10, 0.01);
  assert.ok(windChill(10, -10) < -18 && windChill(10, -10) > -22);
});

test('märkälämpötila (Stull) ja kastepiste', () => {
  close(wetBulb(20, 50), 13.7, 0.05);
  assert.ok(wetBulb(1, 90) < 1 && wetBulb(1, 90) > -0.5);
  // Rajaus: ei hajoa ääriarvoilla
  assert.ok(Number.isFinite(wetBulb(5, 0)) && Number.isFinite(wetBulb(5, 100)));
  close(dewPoint(20, 100), 20, 0.05);
  assert.ok(dewPoint(10, 50) < 1 && dewPoint(10, 50) > -0.5);
});

test('kuivauskyky (VPD) kasvaa lämpimällä ja kuivalla ilmalla', () => {
  assert.ok(vpd(20, 40) > vpd(20, 90));
  assert.ok(vpd(25, 50) > vpd(5, 50));
  assert.equal(vpd(10, 100), 0);
});

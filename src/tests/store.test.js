// Tallennuksen kaatumissuoja: väärän muotoinen arvo ei saa kaataa sovellusta (REGRESSIO: saaaly.recent={"a":1} jätti ruudun tyhjäksi).
import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../js/util.js';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
test.beforeEach(() => mem.clear());

test('tyypitetyt lukijat palauttavat varaarvon, kun tallennettu arvo on väärän tyyppinen', () => {
  mem.set('saaaly.recent', '{"a":1}');
  mem.set('saaaly.place', '[1,2]');
  mem.set('saaaly.geminiKey', '{"x":1}');
  mem.set('saaaly.refreshMin', '"kymmenen"');
  mem.set('saaaly.anim', '"kyllä"');
  assert.deepEqual(store.array('recent'), []);
  assert.equal(store.object('place'), null);
  assert.equal(store.str('geminiKey'), '');
  assert.equal(store.num('refreshMin', 10), 10);
  assert.equal(store.bool('anim', true), true);
});

test('tyypitetyt lukijat palauttavat oikean tyyppisen arvon sellaisenaan', () => {
  store.set('recent', [{ lat: 1, lon: 2 }]);
  store.set('place', { name: 'Turku', lat: 60.45, lon: 22.27 });
  store.set('geminiKey', 'abc');
  store.set('refreshMin', 15);
  store.set('anim', false);
  assert.equal(store.array('recent').length, 1);
  assert.equal(store.object('place').name, 'Turku');
  assert.equal(store.str('geminiKey'), 'abc');
  assert.equal(store.num('refreshMin', 10), 15);
  assert.equal(store.bool('anim', true), false);
});

test('rikkinäinen JSON ja puuttuva localStorage antavat varaarvon', () => {
  mem.set('saaaly.place', '{rikki');
  assert.equal(store.object('place'), null);
  assert.deepEqual(store.array('puuttuu'), []);
  const saved = globalThis.localStorage;
  globalThis.localStorage = undefined;
  try {
    assert.equal(store.set('x', 1), false);
    assert.equal(store.num('x', 7), 7);
  } finally {
    globalThis.localStorage = saved;
  }
});

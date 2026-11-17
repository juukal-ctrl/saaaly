// Neuvomoduulin testit: käsintehty ennuste, jossa oikeat vastaukset tunnetaan täsmälleen.

import test from 'node:test';
import assert from 'node:assert/strict';
import { outfit, umbrella, slippery, slipperyHours, frostRisk, uvAdvice, ownAlerts, verdict, verdictWindow, OUTFIT, windowStats } from '../js/advice.js';

const pad = (n) => String(n).padStart(2, '0');

/** Tuntiennuste käsin. fn(i, day, hour) palauttaa ylikirjoitettavat kentät; pmFn(mallinIndeksi, i) mallikohtaisen sateen. */
function mkFc(n, fn = () => ({}), { pmFn = null, models = 7, lat = 60.45, month = 10, day0 = 14 } = {}) {
  const hours = Array.from({ length: n }, (_, i) => {
    const day = day0 + Math.floor(i / 24);
    const hr = i % 24;
    return {
      t: `2026-${pad(month)}-${pad(day)}T${pad(hr)}:00`, temp: 8, feels: 8, hum: 80, cloud: 80, wind: 3, gust: 5, gustHi: 6, dir: 225, precip: 0, pop: 0, popAgree: 0,
      popSrc: 'models', snowShare: 0, thunderShare: 0, frzShare: 0, uv: 0, sym: 'overcast', isDay: hr >= 8 && hr < 18, ...fn(i, day, hr),
    };
  });
  const pm = pmFn ? Array.from({ length: models }, (_, k) => ({ model: { weight: 1 }, p: hours.map((h, i) => pmFn(k, i, h)) })) : [];
  return { hours, pm, lead0: 0, tz: 'Europe/Helsinki', lat };
}

/** Ennusteen aikavyöhykkeen mukainen hetki: 14.10.2026 klo hh:mm Helsingin aikaa (UTC+3). */
const at = (h, m = 0, d = 14) => Date.UTC(2026, 9, d, h - 3, m);

test('pukeutuminen: tuntuu kuin -lämpötilasta oikea taso, aktiviteetti ja herkkyys siirtävät sitä', () => {
  const cold = mkFc(12, () => ({ feels: -10 }));
  assert.equal(outfit(cold, 0, 5).tier.key, 'cold');
  assert.equal(outfit(mkFc(12, () => ({ feels: -20 })), 0, 5).tier.key, 'severe');
  assert.equal(outfit(mkFc(12, () => ({ feels: -30 })), 0, 5).tier.key, 'extreme');
  assert.equal(outfit(mkFc(12, () => ({ feels: 3 })), 0, 5).tier.key, 'cool');
  assert.equal(outfit(mkFc(12, () => ({ feels: 19 })), 0, 5).tier.key, 'warm');
  assert.equal(outfit(mkFc(12, () => ({ feels: 31 })), 0, 5).tier.key, 'scorching');
  // Juoksija pukeutuu kevyemmin, pyöräilijä ja pysäkillä seisoja lämpimämmin, kylmänarka lämpimämmin
  const f2 = mkFc(12, () => ({ feels: 2 }));
  assert.equal(outfit(f2, 0, 5).tier.key, 'cool');
  assert.equal(outfit(f2, 0, 5, { activity: 'run' }).tier.key, 'mild');
  assert.equal(outfit(f2, 0, 5, { activity: 'bike' }).tier.key, 'frost');
  assert.equal(outfit(f2, 0, 5, { sensitivity: -3 }).tier.key, 'frost');
  // Taulukko on nousevassa järjestyksessä eikä jätä aukkoja
  assert.ok(OUTFIT.every((t, i) => i === 0 || t.below > OUTFIT[i - 1].below));
});

test('pukeutuminen: kerrokset ja tuulenpitävä vaaditaan vain kun on syytä', () => {
  const swing = mkFc(12, (i) => ({ feels: i < 6 ? 0 : 10 }));
  assert.equal(outfit(swing, 0, 11).layered, true);
  const windy = mkFc(12, () => ({ wind: 9 }));
  assert.equal(outfit(windy, 0, 5).windproof, true);
  assert.equal(outfit(mkFc(12), 0, 5).windproof, false);
});

test('sateenvarjo: kuiva ei tarvitse, yksittäinen malli ei riitä, usea malli tarvitsee', () => {
  const dry = mkFc(12, () => ({}), { pmFn: () => 0 });
  assert.equal(umbrella(dry, 0, 11).level, 'no');
  // yksi seitsemästä ennustaa 2 mm: ei sateenvarjoa
  const lone = mkFc(12, (i) => ({ precip: i === 5 ? 2 / 7 : 0 }), { pmFn: (k, i) => (k === 0 && i === 5 ? 2 : 0) });
  assert.equal(umbrella(lone, 0, 11).level, 'no');
  // kaikki seitsemän ennustavat 1 mm tunneille 5–6
  const wet = mkFc(12, (i) => ({ precip: i === 5 || i === 6 ? 1 : 0, popAgree: i === 5 || i === 6 ? 1 : 0 }), { pmFn: (k, i) => (i === 5 || i === 6 ? 1 : 0) });
  const u = umbrella(wet, 0, 11);
  assert.equal(u.level, 'yes');
  assert.equal(u.first.start, 5);
  assert.equal(u.first.end, 6);
  assert.equal(u.kind, 'rain');
  // kaksi seitsemästä (29 %): varmuuden vuoksi
  const two = mkFc(12, (i) => ({ precip: i === 5 ? 2 / 7 : 0 }), { pmFn: (k, i) => (k < 2 && i === 5 ? 1 : 0) });
  assert.equal(umbrella(two, 0, 11).level, 'maybe');
});

test('sateenvarjo: ensemble-todennäköisyys ratkaisee, tuuli vaihtaa sadetakkiin, lumi ei ole sadetta sateenvarjolle', () => {
  const ens = mkFc(12, (i) => ({ precip: i === 4 ? 0.4 : 0, pop: i === 4 ? 0.6 : 0, popSrc: 'ens' }), { pmFn: () => 0 });
  assert.equal(umbrella(ens, 0, 11).level, 'yes');
  const windy = mkFc(12, (i) => ({ precip: i === 5 ? 1.5 : 0, popAgree: 1, wind: i === 5 ? 11 : 3 }), { pmFn: (k, i) => (i === 5 ? 1.5 : 0) });
  const u = umbrella(windy, 0, 11);
  assert.equal(u.windy, true);
  const snow = mkFc(12, (i) => ({ precip: i === 5 ? 1.5 : 0, snowShare: 1, temp: -3 }), { pmFn: (k, i) => (i === 5 ? 1.5 : 0) });
  assert.equal(umbrella(snow, 0, 11).kind, 'snow');
});

test('liukkaus: kuiva pakkanen ei ole liukasta, jäätävä sade ja jäätyvät märät pinnat ovat', () => {
  assert.equal(slippery(mkFc(12, () => ({ temp: -8 })), 0, 11).level, 0);
  const frz = mkFc(12, (i) => ({ temp: -1, precip: i >= 4 && i <= 6 ? 0.4 : 0, frzShare: i >= 4 && i <= 6 ? 0.6 : 0 }));
  const s = slippery(frz, 0, 11);
  assert.equal(s.level, 3);
  assert.equal(s.start, 4);
  assert.equal(s.end, 6);
  // lämmin sade ja sen jälkeen pakkanen: märät pinnat jäätyvät
  const refreeze = mkFc(14, (i) => ({ temp: i < 6 ? 2 : -1, precip: i < 6 ? 0.5 : 0, hum: 80 }));
  const r = slipperyHours(refreeze, 0, 13);
  assert.ok(r.some((x) => x.level === 2 && x.why === 'märät pinnat jäätyvät'));
  // märkä lumi nollakelillä
  const wetSnow = mkFc(8, () => ({ temp: 0.5, precip: 0.6, snowShare: 0.9 }));
  assert.equal(slippery(wetSnow, 0, 7).level, 2);
  // kuura: vain yöllä
  const night = mkFc(30, () => ({ temp: -1, hum: 96 }));
  const kuura = slipperyHours(night, 0, 29);
  assert.ok(kuura.length > 0 && kuura.every((x) => x.level === 1));
  assert.ok(kuura.every((x) => !night.hours[x.i].isDay));
});

test('halla: vain touko–syyskuussa, kirkkaana tyyninä yönä lähellä nollaa', () => {
  const clear = mkFc(24, () => ({ temp: 3, cloud: 10, wind: 1 }), { month: 6 });
  const r = frostRisk(clear, 0, 23, 6);
  assert.ok(r && r.hard === false);
  assert.ok(clear.hours.slice(r.start, r.end + 1).every((h) => !h.isDay));
  assert.equal(frostRisk(clear, 0, 23, 11), null, 'talvella ei hallavaroitusta');
  assert.equal(frostRisk(mkFc(24, () => ({ temp: 9, cloud: 10, wind: 1 }), { month: 6 }), 0, 23, 6), null);
  assert.equal(frostRisk(mkFc(24, () => ({ temp: 3, cloud: 95, wind: 6 }), { month: 6 }), 0, 23, 6), null, 'pilvinen ja tuulinen yö ei huurru');
});

test('UV: näytetään vasta indeksistä 3', () => {
  assert.equal(uvAdvice(mkFc(12, () => ({ uv: 2.4 })), 0, 11), null);
  const u = uvAdvice(mkFc(12, (i) => ({ uv: i >= 4 && i <= 7 ? 4.4 : 1 })), 0, 11);
  assert.equal(u.max, 4);
  assert.equal(u.band, 'kohtalainen');
  assert.equal(u.start, 4);
  assert.equal(u.end, 7);
  assert.equal(uvAdvice(mkFc(12, () => ({ uv: 7 })), 0, 11).band, 'korkea');
  assert.equal(uvAdvice(mkFc(12, () => ({ uv: 9 })), 0, 11).band, 'erittäin korkea');
});

test('omat huomiot: puuskarajat vaihtuvat vuodenajan mukaan, pakkasraja alueen mukaan', () => {
  const g = (v) => mkFc(24, (i) => ({ gustHi: i === 10 ? v : 6 }));
  assert.equal(ownAlerts(g(16), 0, 23, { month: 6 }).find((a) => a.key === 'gust').level, 1);
  assert.equal(ownAlerts(g(16), 0, 23, { month: 12 }).find((a) => a.key === 'gust'), undefined, 'talvella raja on 20 m/s');
  assert.equal(ownAlerts(g(26), 0, 23, { month: 12 }).find((a) => a.key === 'gust').level, 2);
  assert.equal(ownAlerts(g(26), 0, 23, { month: 6 }).find((a) => a.key === 'gust').level, 3);
  const cold = (v) => mkFc(24, () => ({ temp: v, wind: 0 }));
  assert.equal(ownAlerts(cold(-22), 0, 23, { month: 1, lat: 60.4 }).find((a) => a.key === 'cold').level, 1);
  assert.equal(ownAlerts(cold(-22), 0, 23, { month: 1, lat: 64 }).find((a) => a.key === 'cold'), undefined, 'keskisessä Suomessa −22 ei vielä riitä');
  assert.equal(ownAlerts(cold(-32), 0, 23, { month: 1, lat: 60.4 }).find((a) => a.key === 'cold').level, 2);
  assert.equal(ownAlerts(g(10), 0, 23, { month: 6 }).length, 0);
});

test('omat huomiot: helle, ukkonen vain mahdollisuutena ja rankkasade usean mallin yksimielisyydellä', () => {
  const heat = ownAlerts(mkFc(24, (i) => ({ temp: i === 14 ? 28 : 20 })), 0, 23, { month: 7 });
  assert.equal(heat.find((a) => a.key === 'heat').level, 1);
  const thunder = ownAlerts(mkFc(24, (i) => ({ thunderShare: i === 15 ? 0.3 : 0 })), 0, 23, { month: 7 });
  assert.equal(thunder.find((a) => a.key === 'thunder').level, 1);
  assert.equal(ownAlerts(mkFc(24, (i) => ({ thunderShare: i === 15 ? 0.3 : 0 })), 0, 23, { month: 11 }).find((a) => a.key === 'thunder'), undefined, 'marraskuussa vaaditaan vahva yksimielisyys');
  const rain = mkFc(24, () => ({}), { pmFn: (k, i) => (i === 12 ? 25 : 0) });
  assert.equal(ownAlerts(rain, 0, 23, { month: 7 }).find((a) => a.key === 'rain').level, 1);
  const loneRain = mkFc(24, () => ({}), { pmFn: (k, i) => (k === 0 && i === 12 ? 60 : 0) });
  assert.equal(ownAlerts(loneRain, 0, 23, { month: 7 }).find((a) => a.key === 'rain'), undefined, 'yksi malli ei laukaise');
  assert.ok(ownAlerts(g24(), 0, 23, { month: 7 }).every((a) => a.word));
});

function g24() {
  return mkFc(24, (i) => ({ gustHi: i === 3 ? 21 : 6 }));
}

test('ikkuna: päivällä seuraavat 6 tuntia, aamulla koko päivä, illalla huominen', () => {
  const fc = mkFc(72);
  const soon = verdictWindow(fc, at(13, 30));
  assert.equal(soon.kind, 'soon');
  assert.equal(fc.hours[soon.from].t, '2026-10-14T13:00');
  assert.equal(fc.hours[soon.to].t, '2026-10-14T19:00');
  const morning = verdictWindow(fc, at(7, 30));
  assert.equal(morning.kind, 'day');
  assert.equal(fc.hours[morning.to].t, '2026-10-14T18:00');
  const evening = verdictWindow(fc, at(21, 30));
  assert.equal(evening.kind, 'tomorrow');
  assert.equal(fc.hours[evening.from].t, '2026-10-15T07:00');
  assert.equal(fc.hours[evening.to].t, '2026-10-15T17:00');
  const night = verdictWindow(fc, at(2, 10, 15));
  assert.equal(night.kind, 'tomorrow');
  assert.equal(fc.hours[night.from].t, '2026-10-15T07:00');
});

test('vastauskaista: takki ja sateenvarjo aina, lisäkaistoja enintään kaksi, lause tulee koodista', () => {
  const rainy = mkFc(48, (i, d, h) => ({ feels: -8, temp: -6, precip: h >= 14 && h <= 16 && d === 14 ? 1 : 0, popAgree: h >= 14 && h <= 16 ? 1 : 0, wind: 3 }), { pmFn: (k, i) => (i >= 14 && i <= 16 ? 1 : 0), month: 10 });
  const v = verdict(rainy, at(13, 30), { month: 10 });
  assert.equal(v.chips[0].key, 'coat');
  assert.equal(v.chips[1].key, 'umbrella');
  assert.ok(v.chips.length <= 4);
  assert.equal(v.chips[1].level, 'yes');
  assert.match(v.chips[1].sub, /sade alkaa klo 14/);
  assert.match(v.sentence, /^Pukeudu: talvitakki/);
  assert.match(v.sentence, /Ota sateenvarjo mukaan \(sade alkaa klo 14\)/);
  // Kuiva päivä: sateenvarjoa ei tarvita ja se sanotaan ääneen
  const dry = verdict(mkFc(48, () => ({ feels: 10 }), { pmFn: () => 0 }), at(13, 30), { month: 10 });
  assert.equal(dry.chips[1].level, 'no');
  assert.match(dry.sentence, /Sateenvarjoa ei tarvita/);
});

test('vastauskaista: tutkaennuste voi nostaa sateenvarjon tarpeelliseksi, huomisen ikkunassa sitä ei käytetä', () => {
  const dry = mkFc(48, () => ({ feels: 10 }), { pmFn: () => 0 });
  const nc = { ok: true, state: 'dry', startMin: 20, endMin: null };
  const v = verdict(dry, at(13, 30), { month: 10, nowcast: nc });
  assert.equal(v.chips[1].level, 'yes');
  assert.match(v.chips[1].sub, /sade alkaa noin 20 min kuluttua/);
  const tomorrow = verdict(dry, at(21, 30), { month: 10, nowcast: nc });
  assert.equal(tomorrow.win.kind, 'tomorrow');
  assert.equal(tomorrow.chips[1].level, 'no');
  // Toimimaton tutkaennuste ei vaikuta mihinkään
  assert.equal(verdict(dry, at(13, 30), { month: 10, nowcast: { ok: false } }).chips[1].level, 'no');
});

test('windowStats: tyhjä ikkuna ei kaada eikä tuota ääretöntä', () => {
  const st = windowStats(mkFc(4), 3, 2);
  assert.ok(Number.isFinite(st.feelMin) && Number.isFinite(st.tmax));
});

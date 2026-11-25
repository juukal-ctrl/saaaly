// sky.js: koodilla piirretty, animoitu taivas. Seuraa auringon korkeutta, pilvisyyttä, sadetta,
// lunta, ukkosta ja sumua. Ei ulkoisia kuvia tai kutsuja, joten se latautuu heti ja toimii offline.

import { clamp, lerp } from './util.js';

// Auringon korkeus (astetta) -> taivaan kolme väriä [ylä, keski, horisontti]
const STOPS = [
  [-18, ['#03060f', '#060b1c', '#0a1330']],
  [-12, ['#060b1e', '#0d1735', '#17275a']],
  [-6, ['#101b45', '#2f3573', '#b55f6b']],
  [-5, ['#2a2f66', '#6a5a9c', '#d98a9a']],
  [-2.5, ['#e8c5cf', '#d3b4e2', '#b8baf0']], // aamu/ilta: pastellinen persikka ja laventeli, vaalea jo ennen auringonnousua
  [1, ['#f6cfc6', '#eabcd8', '#c9c4f2']],
  [6, ['#ffe4cc', '#f6cae4', '#c7d3fb']],
  [14, ['#fdebd3', '#e2cbfb', '#bcdcff']],
  [35, ['#fdf0da', '#d8cdfb', '#b6ddff']],
].map(([alt, cols]) => [alt, cols.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)])]);

/** Onko taivas niin vaalea, että käyttöliittymän pitää käyttää tummaa tekstiä. */
export function isLightSky(altDeg) {
  const c = skyColors(altDeg)[1];
  const lin = (v) => ((v / 255) ** 2.2);
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]) > 0.3;
}

const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const rgba = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const greyer = (c, k) => {
  const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  return mix(c, [l * 0.92, l * 0.96, l], k);
};

export function skyColors(altDeg) {
  if (altDeg <= STOPS[0][0]) return STOPS[0][1];
  for (let i = 1; i < STOPS.length; i++) {
    const [a1, c1] = STOPS[i];
    if (altDeg <= a1) {
      const [a0, c0] = STOPS[i - 1];
      const t = (altDeg - a0) / (a1 - a0);
      return c0.map((c, k) => mix(c, c1[k], t));
    }
  }
  return STOPS.at(-1)[1];
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


// Konseptin väripaletit: [x, y, leveys, korkeus, väri, peittävyys] 412 x 915 -pohjalla. Kuudes kenttä on vain päiväpaletissa (muissa läpinäkyvä).
const hex3 = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const PAL = {
  aamu: [[190, -60, 380, 380, '#ffd58a', 0.95], [-110, 120, 340, 340, '#ffb0c4', 0.9], [110, 380, 380, 380, '#ffd9c6', 0.85], [-70, 620, 420, 360, '#b8dcff', 0.95], [250, 700, 240, 240, '#fff3c2', 0.9], [-30, -40, 220, 200, '#fff0b2', 0.6]],
  paiva: [[200, -70, 360, 360, '#ffc4a6', 0.95], [-110, 150, 320, 320, '#ffaed2', 0.9], [110, 380, 380, 380, '#cdb5ff', 0.9], [-70, 620, 400, 360, '#a6d5ff', 0.95], [250, 700, 240, 240, '#bff3de', 0.9], [-30, -40, 220, 200, '#fff0b2', 0.9]],
  ilta: [[190, -60, 380, 380, '#e6a6c8', 0.85], [-120, 140, 360, 360, '#a69be6', 0.9], [100, 400, 400, 400, '#8fa4e6', 0.9], [-70, 640, 420, 360, '#7fb0e8', 0.85], [250, 700, 240, 240, '#c9b8f2', 0.8], [-30, -40, 220, 200, '#f6c8d8', 0.5]],
  yo: [[190, -60, 380, 380, '#6a4fd6', 0.75], [-120, 140, 360, 360, '#d05fb4', 0.55], [100, 420, 400, 400, '#3b55d6', 0.7], [-70, 640, 420, 360, '#1f8fd6', 0.6], [250, 700, 240, 240, '#2fd0c0', 0.35], [-30, -40, 220, 200, '#6a4fd6', 0.3]],
};
for (const k of Object.keys(PAL)) PAL[k] = PAL[k].map(([x, y, bw, bh, c, o]) => [x, y, bw, bh, hex3(c), o]);

const blendPal = (a, b, t) => a.map((p, i) => [lerp(p[0], b[i][0], t), lerp(p[1], b[i][1], t), lerp(p[2], b[i][2], t), lerp(p[3], b[i][3], t), mix(p[4], b[i][4], t), lerp(p[5], b[i][5], t)]);

/** Taustan värikentät auringon korkeuden mukaan: yö, aamu tai ilta (hämärä), päivä. */
export function blobsFor(alt, morning) {
  const dusk = morning ? PAL.aamu : PAL.ilta;
  if (alt <= -8) return PAL.yo;
  if (alt < 2) return blendPal(PAL.yo, dusk, (alt + 8) / 10);
  if (alt < 18) return blendPal(dusk, PAL.paiva, (alt - 2) / 16);
  return PAL.paiva;
}

const DEFAULT = { alt: 25, bearing: 180, cloud: 0.3, precip: 0, snow: 0, wind: 3, windDir: 225, thunder: 0, fog: 0, moonPhase: 0.5, moonAlt: -90, moonHA: 12 };
const KEYS = Object.keys(DEFAULT);

// Akkubudjetti: animaatio pysähtyy, kun käyttäjä ei ole koskenut ruutuun IDLE_MS aikaan (silloin piirretään yksi kuva minuutissa),
// sateessa ja lumessa kuvataajuus on 20 kuvaa/s ja muuten 10. Alle 20 %:n akulla (ei latauksessa) tausta pysyy paikallaan.
const IDLE_MS = 10000;
const GAP_RAIN = 50;
const GAP_CALM = 100;
const GAP_IDLE = 60000;

export function createSky(canvas, { reduceMotion = false, animate = true } = {}) {
  const ctx = canvas.getContext('2d');
  let w = 0;
  let h = 0;
  let dpr = 1;
  let raf = 0;
  let last = 0;
  let time = 0;
  let inited = false;
  let userAnim = animate;
  let still = reduceMotion || !userAnim; // true: ei animaatiota (liikkeen vähennys tai asetuksista pois)
  let saver = false; // akku vähissä
  let idleTimer = 0;
  let activeAt = globalThis.performance?.now?.() ?? 0; // viimeisin kosketus
  const cur = { ...DEFAULT, rainN: 0, snowN: 0 };
  const tgt = { ...DEFAULT };

  const rand = mulberry(20261014);
  const rain = Array.from({ length: 280 }, () => ({ x: rand(), y: rand(), v: 0.75 + rand() * 0.5, l: 0.6 + rand() * 0.8 }));
  const snow = Array.from({ length: 200 }, () => ({ x: rand(), y: rand(), v: 0.5 + rand() * 0.8, r: 1 + rand() * 2.2, ph: rand() * 6.28 }));
  const flash = { a: 0, next: 4, bolt: null };

  function resize() {
    const ndpr = Math.min(globalThis.devicePixelRatio || 1, 1.5); // pehmeä sisältö, ei tarvitse täyttä tarkkuutta
    const nw = Math.max(1, Math.round(canvas.clientWidth || globalThis.innerWidth || 400));
    const nh = Math.max(1, Math.round(canvas.clientHeight || globalThis.innerHeight || 800));
    if (nw === w && nh === h && ndpr === dpr) return; // ei muutosta: ei varata kangasta uudelleen
    dpr = ndpr;
    w = nw;
    h = nh;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!raf) draw(0);
  }

  function set(state, { snap = false } = {}) {
    for (const k of KEYS) if (state[k] != null && Number.isFinite(state[k])) tgt[k] = state[k];
    const asleep = !raf && idleTimer !== 0; // joutilas: ei animaatiota, joten tila vaihdetaan suoraan
    if (!inited || snap || still || saver || asleep) {
      for (const k of KEYS) cur[k] = tgt[k];
      cur.rainN = rainCount();
      cur.snowN = snowCount();
      inited = true;
    }
    if (!raf) draw(0);
  }

  const rainCount = () => (tgt.precip >= 0.05 ? clamp(35 + tgt.precip * 60, 0, 280) * (1 - tgt.snow) : 0);
  const snowCount = () => (tgt.precip >= 0.05 ? clamp(50 + tgt.precip * 90, 0, 200) * tgt.snow : 0);

  function step(dt) {
    const k = 1 - Math.exp(-dt / 0.9);
    for (const key of KEYS) cur[key] += (tgt[key] - cur[key]) * k;
    cur.rainN += (rainCount() - cur.rainN) * k;
    cur.snowN += (snowCount() - cur.snowN) * k;
    time += dt;
    if (tgt.thunder > 0.3) {
      flash.next -= dt;
      if (flash.next <= 0) {
        flash.a = 1;
        flash.next = 5 + Math.random() * 6;
        const bx = 0.15 + Math.random() * 0.7;
        flash.bolt = Array.from({ length: 8 }, (_, i) => [bx + (Math.random() - 0.5) * 0.06 * i, 0.05 + i * 0.075]);
      }
    }
    flash.a = Math.max(0, flash.a - dt * 3.5);
  }

  function draw(dt) {
    const alt = cur.alt;
    const cover = clamp(cur.cloud, 0, 1);
    const gloom = clamp(cover * 0.35 + (cur.precip > 0.3 ? 0.2 : 0) + cur.thunder * 0.25 + cur.fog * 0.3, 0, 0.7);
    const night = clamp((-alt - 3) / 10, 0, 1);
    const light = clamp((alt + 8) / 10, 0, 1);

    // Pohja ja liukuvat värikentät (konseptin aamu / päivä / ilta / yö)
    ctx.fillStyle = rgba(mix([19, 15, 41], [252, 247, 255], light));
    ctx.fillRect(0, 0, w, h);
    const blobs = blobsFor(alt, cur.bearing < 180);
    const grey = mix([60, 55, 92], [206, 201, 226], light);
    const sx = w / 412;
    const sy = h / 915;
    blobs.forEach(([x, y, bw, bh, col, o], i) => {
      const dx = Math.sin(time * 0.045 * (1 + i * 0.27) + i * 2.1) * 22;
      const dy = Math.cos(time * 0.037 * (1 + i * 0.21) + i * 1.3) * 22;
      const cx = (x + bw / 2 + dx) * sx;
      const cy = (y + bh / 2 + dy) * sy;
      const r = (Math.max(bw, bh) / 2) * 1.2 * Math.max(sx, sy * 0.9);
      const c = mix(col, grey, gloom * 0.55);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, rgba(c, o));
      g.addColorStop(0.5, rgba(c, o * 0.62));
      g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    });

    // Sumu
    if (cur.fog > 0.03) {
      for (let i = 0; i < 3; i++) {
        const y = h * (0.4 + i * 0.16);
        const off = Math.sin(time * 0.05 + i * 2) * 40;
        const fg = ctx.createLinearGradient(0, y - h * 0.18, 0, y + h * 0.18);
        const fogCol = mix([205, 212, 224], hor0, 0.2);
        fg.addColorStop(0, rgba(fogCol, 0));
        fg.addColorStop(0.5, rgba(fogCol, 0.42 * cur.fog * (night > 0.5 ? 0.6 : 1)));
        fg.addColorStop(1, rgba(fogCol, 0));
        ctx.fillStyle = fg;
        ctx.fillRect(-60 + off, y - h * 0.18, w + 120, h * 0.36);
      }
    }

    // Sade
    const nr = Math.floor(cur.rainN);
    if (nr > 0) {
      const slant = clamp(cur.wind / 14, 0, 1) * 0.55 * -Math.sin((cur.windDir * Math.PI) / 180);
      ctx.strokeStyle = night > 0.5 ? 'rgba(170,195,235,0.42)' : isLightSky(alt) ? 'rgba(84,100,196,0.5)' : 'rgba(205,224,255,0.55)';
      ctx.lineWidth = 1.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < nr; i++) {
        const d = rain[i];
        const y = (((d.y * h + time * 640 * d.v) % (h + 40)) + h + 40) % (h + 40) - 20;
        const x = (((d.x * w + y * slant * 0.6) % w) + w) % w;
        ctx.moveTo(x, y);
        ctx.lineTo(x + slant * 16 * d.l, y + 16 * d.l);
      }
      ctx.stroke();
    }

    // Lumi
    const ns = Math.floor(cur.snowN);
    if (ns > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.beginPath();
      for (let i = 0; i < ns; i++) {
        const d = snow[i];
        const y = (((d.y * h + time * 48 * d.v) % (h + 20)) + h + 20) % (h + 20) - 10;
        const x = (((d.x * w + Math.sin(time * 0.9 + d.ph) * 22 + cur.wind * 4 * time * 0.2) % w) + w) % w;
        ctx.moveTo(x + d.r, y);
        ctx.arc(x, y, d.r, 0, 6.2832);
      }
      ctx.fill();
    }

    // Salama
    if (flash.a > 0.01) {
      ctx.fillStyle = `rgba(235,240,255,${(flash.a * 0.2).toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
      if (flash.bolt && flash.a > 0.5) {
        ctx.strokeStyle = `rgba(255,255,255,${flash.a.toFixed(3)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        flash.bolt.forEach(([bx, by], i) => (i ? ctx.lineTo(bx * w, by * h) : ctx.moveTo(bx * w, by * h)));
        ctx.stroke();
      }
    }
  }

  const gapNow = () => (cur.rainN >= 1 || cur.snowN >= 1 || cur.thunder > 0.3 || flash.a > 0.01 ? GAP_RAIN : GAP_CALM);

  function loop(ts) {
    raf = 0;
    if (document.hidden) {
      raf = requestAnimationFrame(loop);
      return;
    }
    const idle = still || saver || ts - activeAt > IDLE_MS;
    if (!last || ts - last >= gapNow()) {
      const dt = last ? Math.min(0.15, (ts - last) / 1000) : 0.016;
      last = ts;
      step(dt);
      draw(dt);
    }
    if (idle) {
      // Kuva on piirretty. Nukutaan ilman rAF-herätyksiä: seuraava kuva minuutin päästä tai kosketuksesta.
      idleTimer = setTimeout(() => {
        idleTimer = 0;
        if (!raf) raf = requestAnimationFrame(loop);
      }, GAP_IDLE);
      return;
    }
    raf = requestAnimationFrame(loop);
  }

  function start() {
    if (raf || idleTimer) return;
    last = 0;
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    clearTimeout(idleTimer);
    idleTimer = 0;
  }

  /** Käyttäjä koski ruutuun: jatketaan animaatiota heti. */
  function poke() {
    activeAt = globalThis.performance?.now?.() ?? 0;
    if (still || saver) return;
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = 0;
    }
    if (!raf) {
      last = 0;
      raf = requestAnimationFrame(loop);
    }
  }

  /** Animaatio päälle tai pois (asetus). Pois-tilassa piirretään yksi kuva tilan muuttuessa ja yksi minuutissa. */
  function setAnimated(on) {
    userAnim = !!on;
    still = reduceMotion || !userAnim;
    poke();
  }

  // Käyttöjärjestelmän "vähennä liikettä" -asetus voi muuttua kesken käytön.
  try {
    const mq = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (mq) {
      const onMq = () => {
        reduceMotion = mq.matches;
        still = reduceMotion || !userAnim;
        poke();
      };
      mq.addEventListener?.('change', onMq);
    }
  } catch {
    /* vanha selain */
  }

  // Akkua säästetään, kun varaus on alle 20 % eikä laite lataudu (getBatteryia ei ole kaikissa selaimissa).
  try {
    globalThis.navigator?.getBattery?.()
      .then((b) => {
        const upd = () => {
          saver = b.level <= 0.2 && !b.charging;
          if (!saver) poke();
        };
        upd();
        b.addEventListener('levelchange', upd);
        b.addEventListener('chargingchange', upd);
      })
      .catch(() => {});
  } catch {
    /* ei tukea */
  }

  resize();
  let resizeTimer = 0;
  globalThis.addEventListener?.('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });
  return { set, resize, start, stop, poke, setAnimated, draw: () => draw(0), state: () => ({ ...cur }) };
}

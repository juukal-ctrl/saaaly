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
  const stars = Array.from({ length: 140 }, () => ({ x: rand(), y: rand() * 0.66, r: 0.5 + rand() * 1.1, ph: rand() * 6.28 }));
  const clouds = Array.from({ length: 12 }, (_, i) => ({
    x: rand() * 1.4 - 0.2,
    y: 0.05 + rand() * 0.5,
    s: 0.75 + rand() * 0.9,
    v: 0.5 + rand() * 0.9,
    puffs: Array.from({ length: 6 }, (_, k) => ({ dx: (k - 2.5) * (30 + rand() * 14), dy: (rand() - 0.5) * 26 - Math.abs(k - 2.5) * 5, r: 46 + rand() * 36 })),
    order: i,
  }));
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

  function drawMoon(x, y, r, phase, a) {
    const k = Math.cos(phase * 2 * Math.PI); // 1 uusi, -1 täysi
    const lit = (1 - k) / 2;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 6);
    glow.addColorStop(0, `rgba(200,215,255,${((0.08 + 0.3 * lit) * a).toFixed(3)})`);
    glow.addColorStop(1, 'rgba(200,215,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - r * 6, y - r * 6, r * 12, r * 12);
    ctx.save();
    ctx.translate(x, y);
    if (phase >= 0.5) ctx.scale(-1, 1); // vähenevä kuu: valaistu puoli vasemmalla
    ctx.fillStyle = `rgba(120,132,170,${(0.22 * a).toFixed(3)})`; // varjopuoli
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 6.2832);
    ctx.fill();
    ctx.fillStyle = `rgba(238,242,255,${a.toFixed(3)})`; // valaistu osa
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
    ctx.ellipse(0, 0, Math.max(0.01, Math.abs(k)) * r, r, 0, Math.PI / 2, -Math.PI / 2, k > 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function draw(dt) {
    const alt = cur.alt;
    const cover = clamp(cur.cloud, 0, 1);
    const night = clamp((-alt - 3) / 10, 0, 1);
    const [top0, mid0, hor0] = skyColors(alt);
    const gloom0 = clamp(cover * 0.55 + (cur.precip > 0.3 ? 0.18 : 0) + cur.thunder * 0.2 + cur.fog * 0.3, 0, 0.88);
    const gloom = isLightSky(alt) ? gloom0 * 0.55 : gloom0; // vaalea taivas pysyy pastellina myös sateella
    const top = greyer(top0, gloom);
    const mid = greyer(mid0, gloom);
    const hor = greyer(hor0, gloom * 0.9);

    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgba(top));
    g.addColorStop(0.45, rgba(mid));
    g.addColorStop(0.72, rgba(hor));
    g.addColorStop(1, rgba(isLightSky(alt) ? mix(hor, [170, 150, 230], 0.14) : mix(hor, [0, 0, 0], 0.18)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Tähdet
    const starVis = night * (1 - cover * 0.95) * (1 - cur.fog * 0.8);
    if (starVis > 0.02) {
      for (const s of stars) {
        const tw = 0.55 + 0.45 * Math.sin(time * 1.3 + s.ph);
        ctx.fillStyle = `rgba(235,240,255,${(starVis * tw).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(s.x * w, s.y * h, s.r, 0, 6.2832);
        ctx.fill();
      }
    }

    // Kuu: oikea vaihe ja karkea asema (nousee idästä, laskee länteen)
    if (alt < -2 && cur.moonAlt > -1) {
      const mv = clamp((-alt - 2) / 6, 0, 1) * clamp((cur.moonAlt + 1) / 8, 0, 1) * (1 - cover * 0.9) * (1 - cur.fog * 0.7);
      if (mv > 0.02) {
        const mx = lerp(w * 0.16, w * 0.84, clamp((cur.moonHA + 6) / 12, 0, 1));
        const my = lerp(h * 0.64, h * 0.1, clamp(cur.moonAlt / 50, 0, 1));
        drawMoon(mx, my, 19, cur.moonPhase, mv);
      }
    }

    // Aurinko
    if (alt > -4) {
      const vis = clamp((alt + 4) / 8, 0, 1) * (1 - cover * 0.82) * (1 - cur.fog * 0.6);
      if (vis > 0.02) {
        const horizonY = h * 0.64;
        const sx = lerp(w * 0.14, w * 0.86, clamp((cur.bearing - 85) / 190, 0, 1));
        const sy = alt >= 0 ? lerp(horizonY, h * 0.1, clamp(alt / 65, 0, 1)) : horizonY - alt * h * 0.012;
        const warm = clamp(alt / 22, 0, 1);
        const col = mix([255, 150, 80], [255, 238, 196], warm);
        const R = Math.min(w, h) * (0.55 - warm * 0.15);
        const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, R);
        glow.addColorStop(0, rgba(col, 0.7 * vis));
        glow.addColorStop(0.25, rgba(col, 0.25 * vis));
        glow.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);
        const disc = ctx.createRadialGradient(sx, sy, 0, sx, sy, 30);
        disc.addColorStop(0, rgba([255, 255, 245], vis));
        disc.addColorStop(0.7, rgba(col, vis));
        disc.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = disc;
        ctx.beginPath();
        ctx.arc(sx, sy, 30, 0, 6.2832);
        ctx.fill();
      }
    }

    // Pilvet
    if (cover > 0.04) {
      const light = clamp((alt + 8) / 22, 0, 1);
      const dayCol = mix([236, 241, 249], hor0, 0.22);
      const nightCol = [62, 71, 98];
      const stormCol = [88, 98, 114];
      const base = mix(mix(nightCol, dayCol, light), stormCol, clamp(cover * 0.45 + (cur.precip > 0.3 ? 0.3 : 0) + cur.thunder * 0.35, 0, 0.85));
      const n = Math.max(1, Math.round(cover * clouds.length));
      const alpha = clamp(0.3 + cover * 0.5, 0, 0.88);
      const drift = Math.max(2, cur.wind * 1.6);
      for (let i = 0; i < n; i++) {
        const c = clouds[i];
        const x = ((((c.x * w + time * drift * c.v) % (w * 1.5)) + w * 1.5) % (w * 1.5)) - w * 0.25;
        const y = c.y * h;
        for (const p of c.puffs) {
          const px = x + p.dx * c.s;
          const py = y + p.dy * c.s;
          const pr = p.r * c.s;
          const gr = ctx.createRadialGradient(px, py, 0, px, py, pr);
          gr.addColorStop(0, rgba(base, alpha));
          gr.addColorStop(0.55, rgba(base, alpha * 0.6));
          gr.addColorStop(1, rgba(base, 0));
          ctx.fillStyle = gr;
          ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
        }
      }
      const layer = clamp((cover - 0.6) / 0.4, 0, 1);
      if (layer > 0) {
        const lg = ctx.createLinearGradient(0, 0, 0, h * 0.8);
        lg.addColorStop(0, rgba(base, 0.62 * layer));
        lg.addColorStop(1, rgba(base, 0.18 * layer));
        ctx.fillStyle = lg;
        ctx.fillRect(0, 0, w, h);
      }
    }

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

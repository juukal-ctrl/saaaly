// cube.js: neljä sivua näytön kokoisen kuution kylkinä. Sormi kääntää kuutiota, irrotus kääntää lähimmälle kyljelle
// (nopea pyyhkäisy seuraavalle), ja kuutio jatkaa ympäri: Varmuudesta eteenpäin tulee Koti.
// Levossa kuutio on litteä: vain näkyvä kylki on esillä ilman 3D-muunnoksia (terävä teksti, kevyt piirto, muut kyljet inert).
// Pystyvieritys jää selaimelle (touch-action: pan-y), joten sivujen oma vieritys ja vedä-päivittääksesi toimivat kuten ennenkin.

export const FACES = 4;
export const mod = (n, m) => ((n % m) + m) % m;

/** Kyljen i paikka katsojaan nähden, kun kuution asento on p (sivuina): 0 edessä, ±1 sivulla, ±2 takana. */
export function relPos(i, p, n = FACES) {
  let r = mod(i - p, n);
  if (r > n / 2) r -= n;
  return r;
}

/** Lyhin kääntö sivulta a sivulle b (kylkinä, -1, 0, 1 tai 2). */
export function shortestStep(a, b, n = FACES) {
  let d = mod(b - a, n);
  if (d > n / 2) d -= n;
  return d;
}

const FLICK = 0.0005; // sivua millisekunnissa (412 px:n ruudulla noin 0,2 px/ms)
const NUDGE = 0.33; // hidas veto riittää, kun kuutio on kääntynyt kolmanneksen

/** Mihin kuutio asettuu irrotettaessa: liikkeessä oleva pyyhkäisy vie sen suuntaan, hidas veto kolmanneksen jälkeen. Enintään yksi kylki aloituksesta. */
export function settleTarget(p, from, v) {
  let t;
  if (v > FLICK) t = Math.floor(p + 1e-6) + 1;
  else if (v < -FLICK) t = Math.ceil(p - 1e-6) - 1;
  else t = from + (p - from > NUDGE ? 1 : p - from < -NUDGE ? -1 : 0);
  return Math.max(from - 1, Math.min(from + 1, t));
}

/** Nopeus (sivua/ms) viimeisen 100 ms:n näytteistä [aika, asento]. */
export function velocity(samples) {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = samples[0];
  for (const s of samples) if (last[0] - s[0] <= 100) {
    first = s;
    break;
  }
  const dt = last[0] - first[0];
  return dt > 0 ? (last[1] - first[1]) / dt : 0;
}

/**
 * root: kuution ikkuna (#pages), jonka sisällä .cube ja sen sisällä kyljet (.face).
 * onSettle(i) kutsutaan, kun kuutio on levossa uudella tai samalla kyljellä; onStart, kun kääntö alkaa.
 * ignore: valitsin alueille, joiden vaakaveto kuuluu niille itselleen (tuntinauha, sääkaavio).
 */
export function createCube(root, { onSettle = () => {}, onStart = () => {}, onTurn = () => {}, reduceMotion = false, ignore = '' } = {}) {
  const cube = root.querySelector('.cube');
  const faces = [...cube.children];
  const n = faces.length;
  let p = 0; // jatkuva asento sivuina
  let page = 0; // levossa näkyvä kylki
  let half = 0;
  let anim = 0;
  let drag = null;
  let suppressClick = false;
  let near = 0; // lähin kylki käännön aikana (pisteet seuraavat sitä)
  const vis = faces.map(() => null);

  function layout() {
    half = (root.clientWidth || innerWidth) / 2;
    root.style.setProperty('--cube-w', `${half * 2}px`);
    if (!root.classList.contains('cube-rest')) {
      faces.forEach((f, i) => (f.style.transform = `rotateY(${i * 90}deg) translateZ(${half}px)`));
      render();
    }
  }

  function setVis(i, on) {
    if (vis[i] === on) return;
    vis[i] = on;
    faces[i].style.visibility = on ? 'visible' : 'hidden';
  }

  function render() {
    cube.style.transform = `translateZ(${-half}px) rotateY(${(-p * 90).toFixed(3)}deg)`;
    faces.forEach((f, i) => {
      const r = Math.abs(relPos(i, p, n));
      setVis(i, r < 0.999);
      f.style.setProperty('--turn', Math.min(1, r).toFixed(3));
    });
    const k = mod(Math.round(p), n);
    if (k !== near) onTurn((near = k));
  }

  function enter3d() {
    if (!root.classList.contains('cube-rest')) return;
    root.classList.remove('cube-rest');
    faces.forEach((f, i) => (f.style.transform = `rotateY(${i * 90}deg) translateZ(${half}px)`));
    render();
  }

  function rest() {
    root.classList.add('cube-rest');
    cube.style.transform = '';
    faces.forEach((f, i) => {
      const on = i === page;
      f.style.transform = '';
      f.style.removeProperty('--turn');
      vis[i] = null;
      f.style.visibility = on ? '' : 'hidden';
      f.inert = !on;
      if (on) f.removeAttribute('aria-hidden');
      else f.setAttribute('aria-hidden', 'true');
    });
  }

  function finish() {
    anim = 0;
    const prev = page;
    page = mod(Math.round(p), n);
    p = page;
    near = page;
    rest();
    // Ilman liikettä kylki vaihtuu häivyttäen, jotta vaihdon huomaa.
    if (reduceMotion && prev !== page) faces[page].animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
    onSettle(page);
  }

  function animateTo(target, v = 0) {
    cancelAnimationFrame(anim);
    const from = p;
    const dist = target - from;
    if (reduceMotion || Math.abs(dist) < 0.002) {
      p = target;
      finish();
      return;
    }
    enter3d();
    const dur = Math.max(240, Math.min(560, (Math.abs(dist) / Math.max(Math.abs(v), 0.0012)) * 1.6));
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      p = from + dist * (1 - Math.pow(1 - k, 3));
      render();
      if (k < 1) anim = requestAnimationFrame(step);
      else {
        p = target;
        finish();
      }
    };
    anim = requestAnimationFrame(step);
  }

  /** Kääntää kyljelle i lyhintä reittiä (animate false: heti). */
  function go(i, { animate = true } = {}) {
    if (drag) return;
    const resting = root.classList.contains('cube-rest');
    const base = resting ? page : Math.round(p);
    const d = shortestStep(mod(base, n), mod(i, n), n);
    if (resting && !d) return;
    if (!animate) {
      cancelAnimationFrame(anim);
      p = base + d;
      finish();
      return;
    }
    animateTo(base + d);
  }

  root.addEventListener('pointerdown', (e) => {
    suppressClick = false;
    if (drag || (e.pointerType === 'mouse' && e.button !== 0) || !e.isPrimary) return;
    if (ignore && e.target.closest?.(ignore)) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lock: null, base: p, from: Math.round(p), samples: [] };
  });

  root.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.lock) {
      if (Math.hypot(dx, dy) < 8) return;
      drag.lock = Math.abs(dx) > Math.abs(dy) * 1.15 ? 'x' : 'y';
      if (drag.lock === 'y') {
        drag = null;
        return;
      }
      cancelAnimationFrame(anim);
      anim = 0;
      drag.base = p;
      drag.from = Math.round(p);
      drag.x0 = e.clientX;
      try {
        root.setPointerCapture(e.pointerId);
      } catch {
        /* ei väliä */
      }
      if (!reduceMotion) enter3d();
      onStart();
    }
    const w = half * 2 || 1;
    const np = Math.max(drag.from - 1, Math.min(drag.from + 1, drag.base - (e.clientX - drag.x0) / w));
    drag.samples.push([e.timeStamp, np]);
    if (drag.samples.length > 12) drag.samples.shift();
    drag.dx = e.clientX - drag.x0;
    suppressClick = true;
    if (!reduceMotion) {
      p = np;
      render();
    }
  });

  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (d.lock !== 'x') return;
    if (reduceMotion) {
      // Ilman liikettä: riittävän pitkä veto vaihtaa kyljen heti.
      const w = half * 2 || 1;
      const t = Math.abs(d.dx || 0) > w * 0.18 ? d.from + (d.dx < 0 ? 1 : -1) : d.from;
      p = t;
      finish();
      return;
    }
    // Irrotushetki on viimeinen näyte: paikallaan pidetty sormi irrotettaessa ei ole pyyhkäisy.
    d.samples.push([e.timeStamp, p]);
    const v = e.type === 'pointercancel' ? 0 : velocity(d.samples);
    animateTo(settleTarget(p, d.from, v), v);
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  // Veto ei ole napautus: estetään vedon perään tuleva klikkaus (tunti, rivi, painike).
  root.addEventListener(
    'click',
    (e) => {
      if (suppressClick) {
        suppressClick = false;
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true,
  );

  layout();
  rest();
  return {
    go,
    layout,
    get page() {
      return page;
    },
    /** Testeille ja kuvakaappauksille: kuutio asentoon p ilman animaatiota (levossa takaisin kutsulla go). */
    peek(pos) {
      cancelAnimationFrame(anim);
      anim = 0;
      enter3d();
      p = pos;
      render();
    },
  };
}

// util.js: muotoilu, aika-apurit, tallennus ja pieni turvallinen markdown-renderöijä.

export const MINUS = '−';
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const defaultFetch = (...args) => globalThis.fetch(...args);

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---------- Numerot ja lämpötilat ----------

export function roundHalfAway(x, digits = 0) {
  const k = 10 ** digits;
  return (Math.sign(x) * Math.round(Math.abs(x) * k)) / k;
}

export function fmtNum(x, digits = 0) {
  if (x == null || !Number.isFinite(x)) return '–';
  return roundHalfAway(x, digits).toFixed(digits).replace('.', ',');
}

/** Suomalainen lämpötilamerkintä: +9°, −3°, 0° (oikea miinusmerkki). */
export function fmtTemp(t, { sign = true, digits = 0 } = {}) {
  if (t == null || !Number.isFinite(t)) return '–';
  const r = roundHalfAway(t, digits);
  if (r === 0) return '0°';
  return (r < 0 ? MINUS : sign ? '+' : '') + fmtNum(Math.abs(r), digits) + '°';
}

export function fmtMm(mm) {
  if (mm == null || !Number.isFinite(mm)) return '–';
  if (mm < 0.05) return '0 mm';
  return fmtNum(mm, mm < 10 ? 1 : 0) + ' mm';
}

const FROM = ['pohjoisesta', 'koillisesta', 'idästä', 'kaakosta', 'etelästä', 'lounaasta', 'lännestä', 'luoteesta'];
/** Tuulen tulosuunta suomeksi (elatiivi): 225° -> "lounaasta". */
export function windFrom(deg) {
  if (deg == null || !Number.isFinite(deg)) return '';
  return FROM[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

export function fmtCoord(v, pos, neg) {
  return fmtNum(Math.abs(v), 2) + '°' + (v >= 0 ? pos : neg);
}

export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// ---------- Päivämäärät ----------

const WD_SHORT = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];
const WD_LONG = ['sunnuntai', 'maanantai', 'tiistai', 'keskiviikko', 'torstai', 'perjantai', 'lauantai'];

export function weekday(dateStr, long = false) {
  const d = new Date(dateStr + 'T00:00:00Z').getUTCDay();
  return (long ? WD_LONG : WD_SHORT)[d];
}

/** "2026-10-14" -> "14.10." */
export function fmtDM(dateStr) {
  const [, m, d] = dateStr.split('-');
  return `${+d}.${+m}.`;
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const hhmm = (iso) => iso.slice(11, 16);

// ---------- Aikavyöhykkeet ----------

const dtfCache = new Map();
function dtf(tz) {
  let f = dtfCache.get(tz);
  if (!f) {
    const opts = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' };
    try {
      f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...opts });
    } catch {
      f = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...opts });
    }
    dtfCache.set(tz, f);
  }
  return f;
}

export function partsIn(ms, tz) {
  const o = {};
  for (const p of dtf(tz).formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
}

const pad2 = (n) => String(n).padStart(2, '0');

/** Paikallinen kellonaika annetussa aikavyöhykkeessä. */
export function localNow(ms, tz) {
  const p = partsIn(ms, tz);
  const date = `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
  return { date, hour: p.h, minute: p.mi, iso: `${date}T${pad2(p.h)}:${pad2(p.mi)}` };
}

export function tzOffsetMs(ms, tz) {
  const p = partsIn(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** Paikallinen ISO-aika ("2026-10-14T20:00") -> UTC-millisekunnit. */
export function zonedToUtcMs(iso, tz) {
  const [dPart, tPart = '00:00'] = iso.split('T');
  const [y, m, d] = dPart.split('-').map(Number);
  const [h, mi] = tPart.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, h, mi, 0);
  const off1 = tzOffsetMs(naive, tz);
  let guess = naive - off1;
  const off2 = tzOffsetMs(guess, tz);
  if (off2 !== off1) guess = naive - off2;
  return guess;
}

// ---------- Tallennus (kestää puuttuvan localStoragen) ----------

export const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem('saaaly.' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('saaaly.' + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  del(key) {
    try {
      localStorage.removeItem('saaaly.' + key);
    } catch {
      /* ei väliä */
    }
  },
  // Tyypitetyt lukijat: väärän muotoinen arvo (käsin muokattu, vanhasta versiosta tai rikkoutunut) palauttaa varaarvon eikä kaada sovellusta.
  array(key) {
    const v = this.get(key, []);
    return Array.isArray(v) ? v : [];
  },
  object(key) {
    const v = this.get(key, null);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  },
  str(key, fallback = '') {
    const v = this.get(key, fallback);
    return typeof v === 'string' ? v : fallback;
  },
  num(key, fallback = 0) {
    const v = this.get(key, fallback);
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  },
  bool(key, fallback = false) {
    const v = this.get(key, fallback);
    return typeof v === 'boolean' ? v : fallback;
  },
};

// ---------- Turvallinen markdown ----------

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function inline(s) {
  // s on jo HTML-escapattu
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\s][^_]*?)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
}

/** Muuntaa pienen osajoukon markdownia HTML:ksi: **lihavointi**, *kursiivi*, listat, otsikot, kappaleet. */
export function mdToHtml(md) {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let list = null;
  let para = [];
  const flushPara = () => {
    if (para.length) out.push('<p>' + para.join('<br>') + '</p>');
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.type}>` + list.items.map((i) => `<li>${i}</li>`).join('') + `</${list.type}>`);
    list = null;
  };
  for (const raw of lines) {
    const line = escapeHtml(raw.trimEnd());
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    let m = line.match(/^\s*(?:[-*•])\s+(.*)$/);
    if (m) {
      flushPara();
      if (!list || list.type !== 'ul') {
        flushList();
        list = { type: 'ul', items: [] };
      }
      list.items.push(inline(m[1]));
      continue;
    }
    m = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (m) {
      flushPara();
      if (!list || list.type !== 'ol') {
        flushList();
        list = { type: 'ol', items: [] };
      }
      list.items.push(inline(m[1]));
      continue;
    }
    m = line.match(/^#{1,6}\s+(.*)$/);
    if (m) {
      flushPara();
      flushList();
      out.push('<p><strong>' + inline(m[1]) + '</strong></p>');
      continue;
    }
    flushList();
    para.push(inline(line.trim()));
  }
  flushPara();
  flushList();
  return out.join('');
}

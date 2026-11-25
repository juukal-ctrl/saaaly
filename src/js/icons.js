// icons.js: sääsymbolit inline-SVG:nä (64x64). Ei ulkoisia kuvia, toimii offline.

const C = {
  sun: '#FFC24B',
  moon: '#E6ECFF',
  cloud: '#F4F7FC',
  cloudShade: '#C3CEE0',
  cloudDark: '#8394AD',
  storm: '#6B7A93',
  drop: '#7CC7FF',
  snow: '#FFFFFF',
  bolt: '#FFD34D',
};

function sun(cx, cy, r) {
  let rays = '';
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const x1 = cx + Math.cos(a) * (r + 4);
    const y1 = cy + Math.sin(a) * (r + 4);
    const x2 = cx + Math.cos(a) * (r + 9);
    const y2 = cy + Math.sin(a) * (r + 9);
    rays += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
  }
  return `<g stroke="${C.sun}" stroke-width="3.2" stroke-linecap="round">${rays}</g><circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.sun}"/>`;
}

function moon(cx, cy, r) {
  const x = cx + r * 0.45;
  return `<path d="M${x} ${cy - r}A${r} ${r} 0 0 0 ${x} ${cy + r}A${r * 1.25} ${r * 1.25} 0 0 1 ${x} ${cy - r}Z" transform="rotate(-18 ${cx} ${cy})" fill="${C.moon}"/>`;
}

// Pilvi piirretään 40x28-laatikkoon ja siirretään/skaalataan.
function cloud(x, y, s, fill = C.cloud) {
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="${fill}"><circle cx="11" cy="17" r="8"/><circle cx="21" cy="12" r="10.5"/><circle cx="31" cy="17.5" r="7.5"/><rect x="3" y="17" width="36" height="10" rx="5"/></g>`;
}

function drops(n, y0 = 47) {
  const xs = [22, 31, 40, 26.5, 35.5].slice(0, n);
  return xs
    .map((x, i) => {
      const y = y0 + (i > 2 ? 7 : 0);
      return `<line x1="${x}" y1="${y}" x2="${x - 3}" y2="${y + 8}" stroke="${C.drop}" stroke-width="3.4" stroke-linecap="round"/>`;
    })
    .join('');
}

function flakes(n, y0 = 50, xs) {
  const pts = (xs || [
    [23, y0],
    [32, y0 + 5],
    [41, y0],
    [27.5, y0 + 9],
    [36.5, y0 + 10],
  ]).slice(0, n);
  return pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.4" fill="${C.snow}"/>`).join('');
}

const bolt = `<polygon points="34,41 25,55 32,55 29,64 42,48 34,48 38,41" fill="${C.bolt}"/>`;

function fogLines() {
  return `<g stroke="#FFFFFF" stroke-opacity=".85" stroke-width="3.2" stroke-linecap="round"><line x1="14" y1="49" x2="46" y2="49"/><line x1="22" y1="56" x2="54" y2="56"/></g>`;
}

function glyph(sym, isDay) {
  const lum = isDay ? (x, y, r) => sun(x, y, r) : (x, y, r) => moon(x, y, r * 1.35);
  switch (sym) {
    case 'clear':
      return isDay ? sun(32, 32, 12) : moon(32, 32, 17);
    case 'mostly_clear':
      return lum(26, 26, 10) + cloud(26, 33, 0.78);
    case 'partly_cloudy':
      return lum(23, 24, 9) + cloud(11, 22, 1.25);
    case 'mostly_cloudy':
      return lum(21, 19, 7) + cloud(7, 22, 1.3, C.cloudShade) + cloud(16, 26, 1.0);
    case 'overcast':
      return cloud(17, 14, 0.95, C.cloudDark) + cloud(7, 22, 1.3, C.cloudShade);
    case 'fog':
      return cloud(10, 12, 1.2) + fogLines();
    case 'drizzle':
      return cloud(10, 14, 1.2, C.cloudShade) + drops(2);
    case 'rain_light':
      return cloud(10, 14, 1.2, C.cloudShade) + drops(2);
    case 'rain':
      return cloud(10, 14, 1.2, C.cloudShade) + drops(3);
    case 'rain_heavy':
      return cloud(10, 12, 1.2, C.cloudDark) + drops(5, 45);
    case 'sleet':
      return cloud(10, 14, 1.2, C.cloudShade) + drops(1, 47) + flakes(2, 0, [[32, 52], [41, 50]]);
    case 'snow_light':
      return cloud(10, 14, 1.2, C.cloudShade) + flakes(2);
    case 'snow':
      return cloud(10, 14, 1.2, C.cloudShade) + flakes(3);
    case 'snow_heavy':
      return cloud(10, 12, 1.2, C.cloudDark) + flakes(5, 48);
    case 'thunder':
      return cloud(10, 10, 1.2, C.storm) + bolt;
    default:
      return cloud(10, 18, 1.2);
  }
}

/** Palauttaa SVG-merkkijonon annetulle symbolille. */
export function icon(sym, isDay = true, size = 48) {
  return `<svg class="wx" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true" focusable="false">${glyph(sym, isDay)}</svg>`;
}

// Pehmeät 3D-kuvakkeet (esirenderöidyt webp-kuvat, tyylit app.css:ssä). Pienemmät ruudut käyttävät samoja kuvia.
const KEY3D = {
  clear: ['sun', 'moon'],
  mostly_clear: ['part_sun', 'moonpart'],
  partly_cloudy: ['part', 'moonpart'],
  mostly_cloudy: ['part_cloud', 'moonpart'],
  overcast: ['cloud', 'cloud'],
  fog: ['cloud', 'cloud'],
  drizzle: ['rain', 'rain'],
  rain_light: ['rain', 'rain'],
  rain: ['rain', 'rain'],
  rain_heavy: ['rain', 'rain'],
  sleet: ['rain', 'rain'],
  snow_light: ['snow', 'snow'],
  snow: ['snow', 'snow'],
  snow_heavy: ['snow', 'snow'],
  thunder: ['storm', 'storm'],
};

/** Kuvakkeen avain 3D-kuvalle, esim. "d-sun" tai "n-moonpart". */
export function icon3dKey(sym, isDay = true) {
  const k = KEY3D[sym] || KEY3D.overcast;
  return (isDay ? 'd-' : 'n-') + k[isDay ? 0 : 1];
}

/** 3D-kuvake. Koko tulee CSS-muuttujasta, jotta tyylit pysyvät tiedostossa (ei sisäisiä kokoja merkkijonoissa). */
export function icon3d(sym, isDay = true, size = 48) {
  const heavy = sym === 'rain_heavy' || sym === 'snow_heavy' ? ' wx3-heavy' : '';
  const fog = sym === 'fog' ? '<i class="wx3-fog"></i>' : '';
  return `<span class="wx3 wx-${icon3dKey(sym, isDay)}${heavy}" style="--s:${size}px" aria-hidden="true">${fog}</span>`;
}

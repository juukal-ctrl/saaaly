// sun.js: auringon asema, nousu ja lasku (SunCalc-tyylinen laskenta, ei verkkokutsuja).

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;

const toDays = (ms) => ms / DAY_MS - 0.5 + J1970 - J2000;

function sunCoords(d) {
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(L) * Math.sin(OBLIQUITY));
  const ra = Math.atan2(Math.sin(L) * Math.cos(OBLIQUITY), Math.cos(L));
  return { dec, ra };
}

/** Auringon korkeus (astetta horisontin yläpuolella) ja suunta (astetta pohjoisesta myötäpäivään). */
export function sunPosition(ms, lat, lon) {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(ms);
  const { dec, ra } = sunCoords(d);
  const H = RAD * (280.16 + 360.9856235 * d) - lw - ra;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const azSouth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { altitudeDeg: alt / RAD, bearingDeg: (((azSouth / RAD + 180) % 360) + 360) % 360 };
}

/**
 * Nousu ja lasku vuorokaudelle, joka alkaa hetkellä dayStartMs (UTC ms).
 * polar: 'day' (aurinko ei laske), 'night' (aurinko ei nouse) tai null.
 */
export function sunEvents(dayStartMs, lat, lon, stepMin = 4) {
  const h0 = -0.833;
  const step = stepMin * 60000;
  let prev = sunPosition(dayStartMs, lat, lon).altitudeDeg;
  let rise = null;
  let set = null;
  for (let t = dayStartMs + step; t <= dayStartMs + DAY_MS; t += step) {
    const a = sunPosition(t, lat, lon).altitudeDeg;
    const cross = t - step + (step * (h0 - prev)) / (a - prev);
    if (prev < h0 && a >= h0) {
      if (rise == null) rise = cross;
    } else if (prev >= h0 && a < h0) {
      set = cross;
    }
    prev = a;
  }
  let polar = null;
  if (rise == null && set == null) {
    polar = sunPosition(dayStartMs + DAY_MS / 2, lat, lon).altitudeDeg > h0 ? 'day' : 'night';
  }
  return { rise, set, polar };
}

/** Päivän pituus millisekunteina (null, jos ei määriteltävissä). */
export function dayLengthMs(ev) {
  if (ev.polar === 'day') return DAY_MS;
  if (ev.polar === 'night') return 0;
  if (ev.rise != null && ev.set != null && ev.set > ev.rise) return ev.set - ev.rise;
  return null;
}

const SYNODIC_DAYS = 29.530588853;
const NEW_MOON_JD = 2451550.26; // uusikuu 6.1.2000 klo 18.14 UTC

/**
 * Kuun vaihe (0 = uusi, 0,5 = täysi), valaistu osuus ja karkea asema taivaalla.
 * Asema on arvio keskimääräisestä kiertoradasta: kuu ylittää etelän aurinkoaikaa 12 h + vaihe × 24 h.
 * hourAngle: tunteja ylityksestä (negatiivinen = nousemassa idässä), altitudeDeg: karkea korkeus.
 */
export function moonInfo(ms, lat, lon) {
  const jd = ms / DAY_MS + 2440587.5;
  const phase = ((((jd - NEW_MOON_JD) / SYNODIC_DAYS) % 1) + 1) % 1;
  const illum = (1 - Math.cos(phase * 2 * Math.PI)) / 2;
  const solarHour = (((ms / 3600000 + lon / 15) % 24) + 24) % 24;
  const hourAngle = ((((solarHour - (12 + phase * 24)) % 24) + 36) % 24) - 12;
  const altitudeDeg = 34 * Math.cos((hourAngle / 12) * Math.PI) - 4;
  return { phase, illum, hourAngle, altitudeDeg };
}

// phys.js: sääfysiikan apufunktiot. Puhtaita funktioita, joten ne voidaan testata ja siirtää sellaisenaan Android-sovellukseen.
// Tuntuu kuin -kaava on Ilmatieteen laitoksen (smartmet-library-newbase, FmiFeelsLikeTemperature); testivektorit tests/phys.test.js.

/** Ilmatieteen laitoksen Summer Simmer -indeksi. rh prosentteina, t asteina. */
export function summerSimmer(rh, t) {
  if (t <= 14.5) return t;
  const r = rh / 100;
  return (1.8 * t - 0.55 * (1 - r) * (1.8 * t - 26) - 0.55 * 0.5 * 26) / (1.8 * (1 - 0.55 * 0.5));
}

/**
 * Ilmatieteen laitoksen "tuntuu kuin". wind = 10 m tuuli m/s, rh %, temp °C, rad = lyhytaaltosäteily W/m² tai null.
 * Yhdistää tuulen viilentävän vaikutuksen, lämpimän ilman kosteuden ja auringon säteilyn.
 */
export function fmiFeelsLike(wind, rh, temp, rad = null) {
  const a = 15;
  const t0 = 37;
  const chill = a + (1 - a / t0) * temp + (a / t0) * Math.pow(wind + 1, 0.16) * (temp - t0);
  const heat = summerSimmer(rh, temp);
  let feels = temp + (chill - temp) + (heat - temp);
  if (rad != null && Number.isFinite(rad)) feels += (0.7 * 0.07 * rad) / (wind + 10) - 0.25;
  return feels;
}

/** Pakkasen tuulen viilennysindeksi (kanadalainen kaava, sama kuin Ilmatieteen laitoksella). Vain T ≤ 10 °C. */
export function windChill(wind, temp) {
  const kmh = wind * 3.6;
  if (kmh < 5) return temp + ((-1.59 + 0.1345 * temp) / 5) * kmh;
  const w = Math.pow(kmh, 0.16);
  return 13.12 + 0.6215 * temp - 11.37 * w + 0.3965 * temp * w;
}

/** Stullin (2011) märkälämpötila. Pätee kun RH 5–99 % ja T −20…50 °C; muuten rajataan. */
export function wetBulb(T, RH) {
  const rh = Math.min(99, Math.max(5, RH));
  return T * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) + Math.atan(T + rh) - Math.atan(rh - 1.676331) + 0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) - 4.686035;
}

/** Kastepiste (Magnus) lämpötilasta ja suhteellisesta kosteudesta. */
export function dewPoint(T, RH) {
  const a = 17.62;
  const b = 243.12;
  const g = Math.log(Math.max(1, RH) / 100) + (a * T) / (b + T);
  return (b * g) / (a - g);
}

/** Ilman kuivaava voima: höyrynpaineen vaje kPa:na. Isompi kuin 0,6 tarkoittaa, että pyykki kuivuu hyvin. */
export function vpd(T, RH) {
  return 0.6108 * Math.exp((17.27 * T) / (T + 237.3)) * (1 - Math.min(100, Math.max(0, RH)) / 100);
}

// models.js: käytettävät säämallit. Jokainen malli haetaan omana kutsunaan, jotta yksi
// virheellinen tai poistunut malli ei kaada koko hakua.
//
// ids: kokeillaan järjestyksessä; seuraava kokeillaan vain, jos edellinen hylätään virheellisenä (HTTP 400).
// weight: perusarvo ennakkopainolle yhdistelmässä. Nämä ovat arvioita; tarkennetaan, kun ennusteita on verrattu havaintoihin.
// lead: painot ennusteen iän mukaan neljässä pisteessä [0–24 h, 24–60 h, 60–120 h, 120–168 h]; haarukoiden keskikohtien (12, 42, 90, 144 h)
//   välillä painot interpoloidaan lineaarisesti, jotta yhdistelmään ei tule hyppäyksiä. Pohjoismainen tarkkuusmalli painaa eniten
//   lähituntien ennusteessa, ECMWF kauempana. Puuttuessa käytetään weight-arvoa koko ajan.
// optional: puuttuva malli ohitetaan hiljaa.
// maxLat: malli ei kata tätä pohjoisempia paikkoja, joten sitä ei haeta turhaan.
//
// Ilmatieteen laitoksen oma malli (fmi_seamless) ei ole Open-Meteossa, joten se on poistettu listalta.
// MET Nordic ja DMI HARMONIE ovat samaa mallisukua, joten DMI:n paino on pienempi.

export const MODELS = [
  { key: 'ecmwf', ids: ['ecmwf_ifs', 'ecmwf_ifs025'], label: 'ECMWF IFS', short: 'ECMWF', weight: 1.4, lead: [1.2, 1.3, 1.5, 1.6] },
  { key: 'metno', ids: ['metno_nordic'], label: 'MET Norway (Pohjoismaat)', short: 'MET Nordic', weight: 1.3, lead: [1.6, 1.4, 1.0, 1.0] },
  { key: 'dmi', ids: ['dmi_harmonie_arome_europe'], label: 'DMI HARMONIE-AROME', short: 'DMI', weight: 0.8, lead: [0.9, 0.7, 0.7, 0.7], optional: true, maxLat: 65.5 },
  { key: 'icon', ids: ['icon_seamless'], label: 'DWD ICON', short: 'ICON', weight: 1.1, lead: [1.1, 1.1, 1.1, 1.0] },
  { key: 'arpege', ids: ['meteofrance_seamless'], label: 'Météo-France', short: 'Météo-France', weight: 0.9, lead: [0.9, 0.9, 0.9, 0.7] },
  { key: 'ukmo', ids: ['ukmo_seamless'], label: 'UK Met Office', short: 'UKMO', weight: 1.0, lead: [1.0, 1.0, 1.1, 1.1] },
  { key: 'gfs', ids: ['gfs_seamless'], label: 'NOAA GFS', short: 'GFS', weight: 0.6, lead: [0.5, 0.5, 0.6, 0.6] },
  { key: 'gem', ids: ['gem_seamless'], label: 'Kanadan GEM', short: 'GEM', weight: 0.5, lead: [0.4, 0.4, 0.5, 0.5] },
];

const LEAD_CENTERS = [12, 42, 90, 144];

/** Mallin paino ennusteen iän (tuntia) mukaan. Haarukoiden keskikohtien välillä interpoloidaan. */
export function weightAt(model, leadH = 0) {
  const w = model.lead;
  if (!w) return model.weight;
  if (leadH <= LEAD_CENTERS[0]) return w[0];
  for (let b = 1; b < LEAD_CENTERS.length; b++) {
    if (leadH <= LEAD_CENTERS[b]) {
      const f = (leadH - LEAD_CENTERS[b - 1]) / (LEAD_CENTERS[b] - LEAD_CENTERS[b - 1]);
      return w[b - 1] + (w[b] - w[b - 1]) * f;
    }
  }
  return w[w.length - 1];
}

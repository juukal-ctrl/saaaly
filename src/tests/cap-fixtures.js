// Yhteiset CAP-testiaineistot (warnings.test.js ja mirror.test.js): rakennetaan käsin, jotta oikeat vastaukset tiedetään tarkasti.

export const NOW = Date.parse('2026-11-17T12:00:00+02:00'); // tiistai
export const HOUR = 3600000;

// Turku (60.45, 22.27) ja Oulu (65.01, 25.47) ovat omissa monikulmioissaan; Helsinki (60.17, 24.94) kummankin ulkopuolella
export const TURKU_POLY = '60.2,21.8 60.7,21.8 60.7,22.8 60.2,22.8 60.2,21.8';
export const OULU_POLY = '64.8,25.0 65.2,25.0 65.2,26.0 64.8,26.0 64.8,25.0';
export const TURKU = [60.45, 22.27];
export const OULU = [65.01, 25.47];
export const HELSINKI = [60.17, 24.94];

export const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');

export function info(lang, { event, severity, onset, expires, area, poly, color = 'yellow' }) {
  return `<info><language>${lang}</language><category>Met</category><event>${event}</event><urgency>Future</urgency><severity>${severity}</severity><certainty>Likely</certainty>
    <onset>${iso(onset)}</onset><expires>${iso(expires)}</expires><headline>${event} ${area}</headline><description>Kuvaus: ${event} &amp; puuskia &lt;20 m/s.</description><instruction>Varaudu.</instruction>
    <parameter><valueName>color</valueName><value>${color}</value></parameter>
    <area><areaDesc>${area}</areaDesc><polygon>${poly}</polygon></area></info>`;
}

export function cap(o) {
  const { id = 'id1', status = 'Actual', msgType = 'Alert', refs = '', ns = 'xmlns' } = o;
  return `<alert ${ns}="urn:oasis:names:tc:emergency:cap:1.2"><identifier>${id}</identifier><sender>fmi</sender><sent>${iso(NOW - HOUR)}</sent><status>${status}</status><msgType>${msgType}</msgType><scope>Public</scope>${refs ? `<references>${refs}</references>` : ''}
    ${info('fi-FI', { ...o, event: o.event || 'Tuulivaroitus' })}${info('sv-FI', { ...o, event: 'Vindvarning' })}${info('en-GB', { ...o, event: 'Wind warning' })}</alert>`;
}

export const defaults = (extra) => ({ severity: 'Moderate', onset: NOW - HOUR, expires: NOW + 6 * HOUR, area: 'Varsinais-Suomi', poly: TURKU_POLY, ...extra });
export const atom = (entries) => `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Varoitukset</title>${entries.join('')}</feed>`;
export const entry = (inner, link = '') => `<entry><id>e</id><title>Varoitus</title>${link}<content type="text/xml">${inner}</content></entry>`;

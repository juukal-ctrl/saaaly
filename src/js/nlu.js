// nlu.js: suomenkielisen sääkysymyksen jäsennys: aihe, ajankohta, paikka ja mallit.
// Puhdasta koodia: ei verkkokutsuja eikä kelloa. Ajankohdat jäsennetään symbolisesti ja answer.js ratkaisee ne
// ennusteen ja kellon perusteella.
//
// Suomen taivutus muuttaa sanojen loppua mutta harvoin alkua ("sataa", "sadetta", "sateella"),
// joten avainsanat tunnistetaan sanojen alkuosista.

import { CASE_SUFFIXES, findOffline } from './gazetteer.js';

const lc = (s) => String(s ?? '').toLocaleLowerCase('fi-FI');

/** Sanat ilman välimerkkejä. Kellonajat ja päivämäärät ("15:30", "18.10") pysyvät yhtenä sanana. */
export function tokenize(text) {
  return String(text ?? '').match(/[\p{L}\p{N}]+(?:[.:]\p{N}+)*/gu) || [];
}

/**
 * Sanan alkuosa: regexp, joka täsmää sanan (tai sanayhdistelmän) alkuun normalisoidussa tekstissä.
 * Kun kysymyksessä ei ole yhtään ääkköstä (FOLD), sanastoa kokeillaan myös ilman ääkkösiä ("tanaan", "lampotila", "yolla").
 * "sää" ja "yö" käsitellään erikseen, koska "saa" ("saako", "saari") ja "yo" ("york") ovat muita sanoja.
 */
let FOLD = false;
const FOLD_SAA = 'saa(?= |$)|saan(?= |$)|saata(?= |$)|saasta|saassa|saalle|saaenn|saatiedot';
const foldSrc = (a) => a.replace(/[äå]/g, 'a').replace(/ö/g, 'o');
class LexRe extends RegExp {
  constructor(alts, extra = []) {
    super('(?:^| )(?:' + alts.join('|') + ')', 'u');
    const f = alts.filter((a) => !/^(?:sää|yö)/.test(a)).map(foldSrc).concat(extra);
    if (alts.includes('sää')) f.push(FOLD_SAA);
    this.alt = f.length ? new RegExp('(?:^| )(?:' + f.join('|') + ')', 'u') : null;
  }
  exec(s) {
    return super.exec(s) || (FOLD && this.alt ? this.alt.exec(s) : null);
  }
}
const S = (alts, extra) => new LexRe(alts, extra);

// ---------- Aiheet ----------

const SUN_PHRASES = [
  'aurinko[a-zåäö]* (?:nou|las)',
  '(?:nou|las)[a-zåäö]* aurinko',
  'auringon ?(?:nou|las)',
  'pime',
  'hämär',
  'valois',
  'päivän pituu',
  'päivän kesto',
  'päivä on pitkä',
  'pitkä päivä',
  'kuinka pitkä (?:on )?päivä',
  'päivä pitene',
  'päivä lyhene',
  'kaamos',
  'yötön',
];
const SUN_RE = S(SUN_PHRASES);
const SUN_RE_ALL = new RegExp('(?:^| )(?:' + SUN_PHRASES.join('|') + ')[a-zåäö]*', 'gu');

const INTENT_RES = [
  ['snow', S(['lum', 'lunt', 'ensilum', 'ränt', 'rännä', 'pyry', 'hanki'])],
  [
    'rain',
    S(['sade', 'sate(?!l)', 'sataa', 'satako', 'sataisi', 'satanut', 'satava', 'kuuro', 'tihku', 'ripott', 'kaatosa', 'vesisa', 'vettä', 'kastu', 'pouta', 'kuiv', 'märk']),
  ],
  ['thunder', S(['ukkos', 'ukkon', 'ukkone', 'ukkose', 'ukon', 'salam(?!i)', 'jyrin', 'jyrise', 'rake(?:i|e)'])],
  [
    'ice',
    S(['liukas', 'liukk', 'liukuest', 'nasta(?:t|n)', 'nastoj', 'jäinen', 'jäiset', 'jäis', 'jäässä', 'jäätäv', 'kelirikko', 'huurre', 'kuura', 'halla', 'hallaa']),
  ],
  [
    'temp',
    S([
      'lämp', 'lämm(?!it)', 'kylm', 'pakka(?!us)', 'aste', 'plus', 'miinus', 'miinuks', 'viile', 'kuum(?!e(?: |$|e|tt))', 'helle', 'palel', 'hiki',
      'jäätyy', 'jäätyk', 'jäätyv', 'tuntuu', 'nollakel', 'nollan', 'kasvi', 'kukka', 'taimi',
    ]),
  ],
  ['wind', S(['tuul', 'puusk', 'myrsk', 'lumimyrsk', 'navak', 'tyyn', 'rajuil'])],
  [
    'clothing',
    S([
      'pukeu', 'pukis', 'pukea', 'pukei', 'vaate', 'takki', 'takk', 'tak(?:in|is|il|it)(?= |$)', 'tak(?:iss|ist|ill)', '(?:farkku|toppa|talvi|kuori|välikausi|nahka|untuva|tuuli)tak',
      'parka', 'pipo', 'hansk', 'lapas', 'kenkä', 'kengä', 'kenki', 'talvikeng', 'tennar', 'lenkkar', 'lenkkitoss', 'saapp', 'saapa', 'kumisaap', 'kumpp', 'paita',
      'shortse', 'shortsi', 'sortsi', 'housu', 'päälle', 'kerrospuk', 'toppa', 'kuoritakki', 'villa', 'huppar', 'hupari', 'kaulur', 'kaulaliin', 'sukat', 'hattu', 'lakki',
    ]),
  ],
  [
    'outdoor',
    S([
      'lenkk(?!ar|itoss)', 'lenki', 'juoks', 'juost', 'juokse', 'pyöräil', 'pyörä', 'kävel', 'ulkoil', 'retk', 'patikoi', 'patikka', 'vaelt', 'hiihto', 'hiihtä',
      'uimaan', 'uida', 'uinti', 'uimakel', 'grill', 'piknik', 'kalast', 'kalaan', 'ulos', 'rannal', 'ranta', 'golf', 'marjaan', 'marjast', 'sienest', 'sienikel',
      'pyykk', 'pyykin', 'pyykit', 'kuivata', 'kuivaus', 'ripusta', 'nurmik', 'ruohon', 'pihaa', 'pihan', 'pihatyö', 'kastel', 'maalata', 'maalaus', 'aidan', 'haravoi',
      'pestä', 'pesu', 'ikkunanpes',
      'paras (?:hetki|aika|ajankohta|sää|päivä|keli)', 'sopiva (?:aika|hetki|päivä)', 'milloin (?:kannattaa|voi|voisi|olisi|pääsee)',
      'kannattaako (?:lähteä|mennä)',
    ]),
  ],
  ['sun', SUN_RE],
  ['sky', S(['pilv', 'aurinko', 'auringo', 'selke', 'paista', 'sumu', 'sumui', 'utu', 'harmaa', 'taivas', 'tähti', 'tähd'])],
  ['air', S(['kosteu', 'kostea', 'ilmankosteu', 'ilmanpain', 'paine', 'hpa', 'barometr'])],
  [
    'models',
    S([
      'mallit', 'mallien', 'mallia', 'malli', 'säämall', 'sääpalv', 'ecmwf', 'ifs', 'icon', 'dwd', 'gfs', 'noaa', 'gem(?!ini)', 'ukmo',
      'met office', 'met nordic', 'metno', 'nordic', 'norway', 'arpege', 'météo', 'meteo', 'fmi', 'ilmatieteen', 'lähde(?: |$)', 'lähteet', 'lähteen', 'lähteit', 'lähteestä',
      'datasta', 'datan', 'data', 'palvelu',
    ]),
  ],
  ['confidence', S(['luotettav', 'varma', 'varmu', 'epävar', 'tarkk', 'hajont', 'eri mieltä', 'samaa mieltä', 'yhtä mieltä', 'yksimiel', 'ristiriit'])],
  ['tyres', S(['rengas', 'renkaa', 'renkaid', 'talvirenk', 'kesärenk', 'nastarenk', 'kitkarenk'])],
  ['drive', S(['ajokel', 'ajaa', 'ajamaan', 'ajelu', 'autolla', 'mökkimatk'])],
  ['moon', S(['täysikuu', 'uusikuu', 'täydenkuun', 'kuun (?:vaihe|nousu|lasku)', 'kuu (?:nousee|laskee|näkyy|paistaa)', 'milloin kuu', 'kuutamo'])],
  ['aurora', S(['revontul', 'aurora', 'northern'])],
  ['uv', S(['aurinkorasv', 'aurinkovoit', 'aurinkovoid', 'uv(?: |$)', 'uvi(?: |$)', 'uv indeks', 'ultravio', 'auringonpolt', 'ruskett', 'aurinkosuoj', 'palaako', 'iho pala', 'ihon pala'])],
  ['icecover', S(['kantaa(?:ko)? jää', 'jään (?:paksuu|kanta)', 'jäällä'])],
  ['pollen', S(['siitepöl', 'allergi', 'pujo', 'tuoksukk', 'ambros', 'heinänuh', 'kukint', 'kukkii', 'kukkiiko', 'pölyää(?:kö)? koivu', 'koivu (?:pölyää|kukkii)', '(?:koivu|leppä|lepp|heinä|heinie)[a-zåäö]* (?:ilmassa|pölyä)'])],
  ['aqi', S(['ilmanlaat', 'ilman laat', 'aqi', 'pienhiukk', 'hiukkaspitoi', 'ilmansaast', 'saaste', 'otsoni', 'typpidiok', 'pm2', 'pm10', 'katupöly', 'hengitysilm'])],
  [
    'summary',
    S(['sää', 'sään', 'säätä', 'säästä', 'säässä', 'sääl', 'sääenn', 'sääti', 'ennuste', 'ennusta', 'yhteenve', 'tulossa', 'miltä näyttää', 'millai', 'minkälai', 'millane', 'minkälane', 'keli', 'ilma(?:t|a|ssa|sta|ja)?(?= |$)', 'ilmoj']),
  ],
  ['help', S(['apua', 'auta', 'apu(?= |$)', 'ohje', 'mitä osaat', 'mitä voit', 'mitä voin kysy', 'mitä voi kysy', 'osaatko', 'komento'])],
];

// Aiheet, joiden avainsanat eivät saa käynnistää paikkahakua (sanat, jotka näyttävät paikannimien taivutusmuodoilta)
// isLexical tarkistaa sanat suoraan INTENT_RES-taulukosta (myös ilman ääkkösiä, kun FOLD on päällä)

const TIME_LEX = S(
  [
    'tänään', 'tänä', 'huomen', 'huomis', 'ylihuomi', 'eilen', 'eilis', 'nyt', 'illa', 'ilta', 'aamu', 'aamup', 'yö', 'päivä', 'päivän', 'päiviä',
    'keskipäiv', 'iltapäiv', 'viikonlop', 'viikko', 'viikon', 'viikol', 'tunti', 'tunnin', 'tuntia', 'klo', 'kello', 'ensi', 'ens', 'seuraava', 'seuraavi',
    'lähitun', 'lähipäiv', 'lauantai', 'sunnuntai', 'maanantai', 'tiistai', 'keskiviikko', 'torstai', 'perjantai', 'pian', 'kohta',
    'päästä', 'kuluttua', 'jälkeen', 'asti', 'saakka', 'mennessä', 'aikana', 'viikkoa', 'kuukau', 'aamuy', 'aamul', 'yöl', 'yöst', 'vkl', 'vkonlop', 'vielä', 'edelleen', 'maissa', 'aikaan', 'puoli',
  ],
  ['yolla', 'yosta', 'yoksi', 'yona', 'yo(?= |$)'],
);

const STOP = new Set(
  (
    'mitä miten millai millainen minkälai missä milloin koska onko onkohan tuleeko tuleekohan voiko kannattaako pitääkö pitäisikö täällä tässä siellä ' +
    'sinne tänne kotona ulkona sisällä paljon paljonko kuinka vähän ja tai vai että kun jos kuin sekä mutta myös entä entäs sitten vielä jo kerro ' +
    'kertoisitko anna näytä haluan haluaisin tietää tarvitsen tarvitsenko saako saisiko hei moi moikka terve kiitos kiitti joo kyllä okei ok sitä ' +
    'tätä mikä mitkä kuka miksi mihin mistä mille kenen koko lähellä alueella seudulla kaupungissa maassa paikassa kylässä tarkoitan tarkoittaa ' +
    'gemini claude google openmeteo open meteo sääly sääälyn mieltä tulossa tulee tulevat tuleva odotettavissa luvassa ennustetaan lupaa näyttää ' +
    'ollut olla ole olisi oli ovat ovatko sanoo sanoa ennustaa kertoo kertoa pitää pitäisi kannattaa voin voiko voisi voisiko saa saisi paljon ' +
    'ihan hyvin huonosti oikein aika tosi vähän yhtään lainkaan lisää enemmän vähemmän taas vaikka koska siksi sillä siis eli tai ettei vai'
  ).split(' '),
);

for (const w of 'will would could can should does did are was were its the and for how what when where this that with you your please need needs going get gets feel feels like outside inside'.split(' ')) STOP.add(w);

const isLexical = (w) => INTENT_RES.some(([, re]) => re.test(w)) || TIME_LEX.test(w) || STOP.has(w);

// ---------- Ajankohta ----------

const WEEKDAYS = ['sunnuntai', 'maanantai', 'tiistai', 'keskiviikko', 'torstai', 'perjantai', 'lauantai'];
const MONTHS = ['tammi', 'helmi', 'maalis', 'huhti', 'touko', 'kesä', 'heinä', 'elo', 'syys', 'loka', 'marras', 'joulu'];
// Juhlapyhät: kiinteät päivämäärät tai laskettavat (juhannus, pääsiäinen ratkaistaan answer.js:ssä nykyhetken mukaan)
const HOLIDAYS = [
  [S(['jouluaatto']), { type: 'dates', list: [[24, 12]], label: 'jouluaattona' }],
  [S(['joulupäiv']), { type: 'dates', list: [[25, 12]], label: 'joulupäivänä' }],
  [S(['tapaninpäiv']), { type: 'dates', list: [[26, 12]], label: 'tapaninpäivänä' }],
  [S(['joulu(?:na|n|a|lle|sta)?(?: |$)']), { type: 'dates', list: [[24, 12], [25, 12], [26, 12]], label: 'jouluna' }],
  [S(['uudenvuodenaatto', 'uudenvuoden aatto', 'silvest']), { type: 'dates', list: [[31, 12]], label: 'uudenvuodenaattona' }],
  [S(['uudenvuodenpäiv', 'uudenvuoden päiv', 'uutena vuotena', 'uusivuosi', 'uudenvuoden']), { type: 'dates', list: [[1, 1]], label: 'uudenvuodenpäivänä' }],
  [S(['vappu', 'vapun']), { type: 'dates', list: [[30, 4], [1, 5]], label: 'vappuna' }],
  [S(['itsenäisyyspäiv']), { type: 'dates', list: [[6, 12]], label: 'itsenäisyyspäivänä' }],
  [S(['juhannu']), { type: 'juhannus', label: 'juhannuksena' }],
  [S(['pääsiäi', 'pitkäperjantai']), { type: 'easter', label: 'pääsiäisenä' }],
];

// Vuorokaudenajat tärkeysjärjestyksessä (pitempi sana ennen lyhyempää: aamuyö/aamupäivä ennen aamua)
const PART_TESTS = [
  [S(['aamuyö', 'aamuyl']), 'aamuyo'],
  [S(['aamupäiv']), 'aamupaiva'],
  [S(['aamu']), 'aamu'],
  [S(['keskipäiv']), 'keskipaiva'],
  [S(['iltapäiv']), 'iltapaiva'],
  [S(['illa', 'ilta(?!päiv)', 'illal', 'ilaal', 'ilal']), 'ilta'],
  [S(['päivällä', 'päiväsaik']), 'paiva'],
  [S(['yö(?!tön)'], ['yolla', 'yosta', 'yoksi', 'yona', 'yo(?= |$)']), 'yo'],
];

const NUMBER_WORDS = { puolen: 0, yhden: 1, parin: 2, kahden: 2, kolmen: 3, neljän: 4, viiden: 5, kuuden: 6, pari: 2, kaksi: 2, kolme: 3, neljä: 4, viisi: 5, kuusi: 6, seitsemän: 7 };

/**
 * Jäsentää ajankohdan symboliseksi kuvaukseksi:
 * { day: {type:'offset', n} | {type:'weekday', wd, next} | {type:'date', d, m, y} | {type:'weekend'} | {type:'week', which} | {type:'span', n} |
 *          {type:'month', m} | {type:'dates', list, label} | {type:'juhannus'|'easter', label} | {type:'far', label} | null,
 *   part: 'aamu'|'aamupaiva'|'keskipaiva'|'paiva'|'iltapaiva'|'ilta'|'yo'|null, parts?: [part, part, ...] (kun kysytään useampaa, "aamulla ja illalla"),
 *   hour, hourTo, ahead, now, soon, past, explicit }
 */
export function parseWhen(raw, { nowHour = null } = {}) {
  let text = lc(raw);
  const when = { day: null, part: null, hour: null, hourTo: null, ahead: null, now: false, soon: false, past: false, explicit: false };

  // kellonaika: "klo 15", "kello 8.30", "klo 14-18", "15:30"
  const km = /(?:klo|kello)\s*(\d{1,2})(?:[.:](\d{2}))?(?:\s*(?:-|–|—|…|\.\.)\s*(?:klo\s*)?(\d{1,2})(?:[.:](\d{2}))?)?/u.exec(text);
  if (km && +km[1] <= 24) {
    when.hour = +km[1] % 24;
    if (km[3] != null && +km[3] <= 24) when.hourTo = +km[3] % 24 || 24;
    text = text.replace(km[0], ' ');
  } else {
    const cm = /(?:^|\s)(\d{1,2}):(\d{2})(?!\d)/u.exec(text);
    if (cm && +cm[1] <= 23 && +cm[2] <= 59) {
      when.hour = +cm[1];
      text = text.replace(cm[0], ' ');
    }
  }

  // "2 tunnin päästä", "tunnin päästä", "puolen tunnin päästä"
  const am = /(?:^|\s)(?:(\d{1,2}|puolen|parin|kahden|kolmen|neljän|viiden|kuuden)\s+)?tunnin\s+(?:päästä|kuluttua)/u.exec(text);
  if (am) {
    when.ahead = am[1] == null ? 1 : /^\d/.test(am[1]) ? +am[1] : (NUMBER_WORDS[am[1]] ?? 1);
    text = text.replace(am[0], ' ');
  }

  // päivämäärä: "18.10.", "18.10.2026", "20. lokakuuta"
  const dm = /(?:^|\s)(\d{1,2})\.\s?(\d{1,2})\.?(?:\s?(\d{4}))?(?!\d)/u.exec(text);
  if (dm && +dm[1] >= 1 && +dm[1] <= 31 && +dm[2] >= 1 && +dm[2] <= 12) {
    when.day = { type: 'date', d: +dm[1], m: +dm[2], y: dm[3] ? +dm[3] : null };
    text = text.replace(dm[0], ' ');
  } else {
    const mm = new RegExp('(?:^|\\s)(\\d{1,2})\\.?\\s*(' + MONTHS.join('|') + ')kuu', 'u').exec(text);
    if (mm && +mm[1] >= 1 && +mm[1] <= 31) {
      when.day = { type: 'date', d: +mm[1], m: MONTHS.indexOf(mm[2]) + 1, y: null };
      text = text.replace(mm[0], ' ');
    }
  }

  // "kolme päivää", "5 päivän ennuste", "seuraavat päivät"
  const N = tokenize(text).join(' ');
  const has = (re) => re.test(N);
  const sm = /(?:^| )(\d{1,2}|pari|kolme|neljä|viisi|kuusi|seitsemän)\s+(?:päivän|päivää|vuorokauden|vuorokautta|vrk)/u.exec(N);
  // "kolmen päivän päästä", "viikon päästä", viikonpäivän lyhenne ("pe aamuna", "la-iltana")
  const dm2 = /(?:^| )(\d{1,2}|pari|parin|kaksi|kahden|kolme|kolmen|neljä|neljän|viisi|viiden|kuusi|kuuden)\s+(?:päivän|vuorokauden)\s+(?:päästä|kuluttua)/u.exec(N);
  const weekAhead = /(?:^| )viikon\s+(?:päästä|kuluttua)/u.test(N);
  const abbr = /(?:^| )(ma|ti|ke|to|pe|la|su)(?= (?:aamu|aamup|aamuy|iltap|ilta|illa|yö|päivä|päivällä|klo|kello|\d))/u.exec(N);
  // kellonaika sanoin: "kuudelta", "puoli seitsemältä", "iltakuudelta", "yhdeksän maissa" (aamu/ilta päätellään sanasta tai nykyhetkestä)
  if (when.hour == null && when.ahead == null) {
    const ab = /(?:^| )(puoli )?(ilta|aamu)?(yhdeltätoista|kahdeltatoista|yhdeltä|kahdelta|kolmelta|neljältä|viideltä|kuudelta|seitsemältä|kahdeksalta|yhdeksältä|kymmeneltä)(?= |$)/u.exec(N);
    const nm = /(?:^| )(yksitoista|kaksitoista|yksi|kaksi|kolme|neljä|viisi|kuusi|seitsemän|kahdeksan|yhdeksän|kymmenen) (?:maissa|aikaan|tienoilla)(?= |$)/u.exec(N);
    const num = ab ? CLOCK_ABL[ab[3]] : nm ? CLOCK_NOM[nm[1]] : null;
    if (num != null) {
      let h = ab?.[1] ? (num === 1 ? 12 : num - 1) : num;
      const pm = ab?.[2] === 'ilta' || /(?:^| )(?:illa|ilta|iltap)/u.test(N);
      const am = ab?.[2] === 'aamu' || /(?:^| )(?:aamu|aamup|aamuy)/u.test(N);
      if (pm) h = h < 12 ? h + 12 : h;
      else if (!am) {
        const opts = h < 12 ? [h, h + 12] : [h];
        h = nowHour == null ? (h <= 6 ? h + 12 : h) : (opts.find((x) => x >= nowHour) ?? opts[0]);
      }
      when.hour = h % 24;
    }
  }

  // kuukausi ("joulukuussa"), vuodenaika ("kesällä"), "ensi vuonna" ja juhlapyhät: ennuste kattaa vain viikon, joten nämä ratkaistaan answer.js:ssä
  if (!when.day) {
    const mi = MONTHS.findIndex((m) => has(S([`${m}kuu`])));
    const far = /(?:^| )ensi (?:vuonna|vuoden|kuussa|kuun|kesänä|talvena|syksynä|keväänä)/u.exec(N);
    const season = /(?:^| )(?:kesällä|kesänä|kesäisin|kesälle|talvella|talvena|talvisin|talvelle|syksyllä|syksynä|syksyisin|keväällä|keväänä|keväisin)(?= |$)/u.exec(N);
    const holiday = HOLIDAYS.find(([re]) => re.test(N));
    if (mi >= 0) when.day = { type: 'month', m: mi + 1 };
    else if (far) when.day = { type: 'far', label: far[0].trim() };
    else if (season) when.day = { type: 'far', label: season[0].trim() };
    else if (holiday) when.day = { ...holiday[1] };
  }
  if (!when.day) {
    const wd = WEEKDAYS.findIndex((w) => has(S([w])));
    if (dm2) when.day = { type: 'offset', n: /^\d/.test(dm2[1]) ? +dm2[1] : (NUMBER_WORDS[dm2[1]] ?? 1) };
    else if (weekAhead) when.day = { type: 'offset', n: 7 };
    else if (wd >= 0) when.day = { type: 'weekday', wd, next: has(S(['ensi', 'ens(?= |$)', 'seuraava'])) };
    else if (abbr) when.day = { type: 'weekday', wd: ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'].indexOf(abbr[1]), next: false };
    else if (has(S(['viikonlop', 'vkl', 'vkonlop']))) when.day = { type: 'weekend' };
    else if (has(S(['ensi viikko', 'ensi viikon', 'ensi viikol', 'ensiviikko', 'ens viikko', 'ens viikon', 'ens viikol', 'ensviikko', 'ensviikol', 'seuraava viikko', 'seuraavalla viikolla']))) when.day = { type: 'week', which: 'next' };
    else if (sm) when.day = { type: 'span', n: Math.min(7, /^\d/.test(sm[1]) ? +sm[1] : (NUMBER_WORDS[sm[1]] ?? 3)) };
    else if (has(S(['viikon', 'koko viikko', 'tällä viikolla', 'viikolla', 'seuraavat viikko']))) when.day = { type: 'week', which: 'this' };
    else if (has(S(['lähipäivi', 'tulevina päivinä', 'tulevat päivät', 'seuraavina päivinä', 'seuraavat päivät', 'seuraavien päivien']))) when.day = { type: 'span', n: 4 };
    else if (has(S(['ylihuom']))) when.day = { type: 'offset', n: 2 };
    else if (has(S(['huomen', 'huomis']))) when.day = { type: 'offset', n: 1 };
    else if (has(S(['tänään', 'tänä', 'tämän päivän', 'tänäpäivänä']))) when.day = { type: 'offset', n: 0 };
  }
  when.past = has(S(['eilen', 'eilis', 'toissa']));
  if (when.past && !when.day) when.day = { type: 'offset', n: has(S(['toissa'])) ? -2 : -1 };

  // vuorokaudenaika (myös yhdyssanat: huomenaamuna, huomisiltana)
  const Np = N.replace(/(?:^| )(?:kummalla|millä|mille|minä|kummalle) päiv\S*/gu, ' '); // "kummalla päivällä" = kumpana päivänä, ei vuorokaudenaika
  const tom = /(?:^| )huom(?:is|en)(?:en )?(aamupäiv|iltapäiv|aamuyö|aamu|ilta|yö)/u.exec(N);
  if (tom) {
    when.part = { aamupäiv: 'aamupaiva', iltapäiv: 'iltapaiva', aamuyö: 'aamuyo', aamu: 'aamu', ilta: 'ilta', yö: 'yo' }[tom[1]];
    if (!when.day) when.day = { type: 'offset', n: 1 };
  } else {
    const hit = PART_TESTS.find(([re]) => re.test(Np));
    if (hit) when.part = hit[1];
    // "aamulla ja illalla": jokainen mainittu vuorokaudenaika vastataan erikseen
    if (when.hour == null) {
      const keys = [];
      for (const tok of Np.split(' ')) {
        const h = PART_TESTS.find(([re]) => re.test(tok));
        if (h && !keys.includes(h[1])) keys.push(h[1]);
      }
      if (keys.length > 1) when.parts = keys.slice(0, 3);
    }
  }

  when.now = has(S(['nyt', 'juuri nyt', 'tällä hetkellä', 'hetkellä', 'vielä', 'jo(?= |$)', 'edelleen', 'yhä(?= |$)']));
  when.soon = has(S(['lähitun', 'seuraavina tunteina', 'seuraavat tunnit', 'pian', 'hetken päästä', 'kohta', 'lähiaikoina']));
  when.explicit = Boolean(when.day || when.part || when.hour != null || when.ahead != null || when.now || when.soon || when.past);
  return when;
}

// ---------- Aktiviteetit ja mallit ----------

const ACTIVITIES = [
  [S(['lenkk(?!ar|itoss)', 'lenki', 'juoks', 'juost', 'juokse']), { id: 'run', to: 'lenkille' }],
  [S(['pyöräil', 'pyörä']), { id: 'bike', to: 'pyöräilemään' }],
  [S(['kävel']), { id: 'walk', to: 'kävelylle' }],
  [S(['retk', 'patikoi', 'patikka', 'vaelt']), { id: 'hike', to: 'retkelle' }],
  [S(['hiihto', 'hiihtä']), { id: 'ski', to: 'hiihtämään' }],
  [S(['uimaan', 'uida', 'uinti', 'uimakel']), { id: 'swim', to: 'uimaan' }],
  [S(['grill']), { id: 'grill', to: 'grillaamaan' }],
  [S(['piknik']), { id: 'picnic', to: 'piknikille' }],
  [S(['kalast', 'kalaan']), { id: 'fish', to: 'kalaan' }],
  [S(['pyykk', 'pyykin', 'pyykit', 'kuivata', 'kuivaus', 'ripusta']), { id: 'laundry', to: 'pyykin kuivatukseen' }],
  [S(['nurmik', 'ruohon', 'pihaa', 'pihan', 'pihatyö', 'kastel', 'maalata', 'maalaus', 'aidan', 'haravoi']), { id: 'lawn', to: 'pihatöihin' }],
  [S(['pestä', 'pesu', 'ikkunanpes']), { id: 'carwash', to: 'pesuun' }],
  [S(['golf']), { id: 'golf', to: 'golfaamaan' }],
  [S(['rannal', 'ranta']), { id: 'beach', to: 'rannalle' }],
  [S(['marjaan', 'marjast', 'sienest', 'sienikel']), { id: 'forage', to: 'metsään' }],
  [S(['ulkoil', 'ulos']), { id: 'outside', to: 'ulkoilemaan' }],
];

const MODEL_ALIASES = [
  ['ecmwf', S(['ecmwf', 'ifs'])],
  ['metno', S(['met nordic', 'metno', 'nordic', 'met norway', 'norway'])],
  ['icon', S(['icon', 'dwd'])],
  ['arpege', S(['arpege', 'météo', 'meteo'])],
  ['ukmo', S(['ukmo', 'met office'])],
  ['gfs', S(['gfs', 'noaa'])],
  ['gem', S(['gem(?!ini)', 'kanadan', 'environment canada'])],
  ['fmi', S(['fmi', 'ilmatieteen'])],
];

// ---------- Paikat ----------

/**
 * Hakusanat, joilla taivutettu paikannimi kokeillaan paikkahaussa. Taivutus muuttaa nimen loppua
 * ("Kemijärvi" -> "Kemijärvellä", "Lahti" -> "Lahdessa"), joten pääte poistetaan ja kokeillaan tavallisimmat perusmuodot.
 */
export function placeQueries(word) {
  const w = lc(word);
  const out = [];
  const add = (q) => {
    if (q.length >= 3 && !out.includes(q)) out.push(q);
  };
  const suf = CASE_SUFFIXES.find((s) => s.length >= 2 && w.length - s.length >= 3 && w.endsWith(s));
  if (suf) {
    const stem = w.slice(0, -suf.length);
    if (/e$/u.test(stem)) {
      add(stem.slice(0, -1) + 'i'); // Kemijärve- -> Kemijärvi
      if (/de$/u.test(stem)) add(stem.slice(0, -2) + 'ti'); // Lahde- -> Lahti
    }
    add(stem);
    add(stem.replace(/([aeiouyäö])\1$/u, '$1'));
    add(stem + 'i');
  }
  add(w);
  if (!suf && w.length > 4) add(w.slice(0, -1));
  return out.slice(0, 5).map((q) => q.charAt(0).toUpperCase() + q.slice(1));
}

/**
 * Löytää kysymyksestä mahdolliset paikannimet:
 * { word, offline?: paikka, strong: boolean, queries?: [...] }. Tunnetut paikat (gazetteer) ratkeavat heti ilman verkkoa.
 */
const CLITIC = /(?:ko|kö|kaan|kään|han|hän|pa|pä)$/u;

export function placeCandidates(raw) {
  const toks = [...String(raw ?? '').matchAll(/[\p{L}\p{N}]+/gu)].map((m, i) => ({ text: m[0], lower: lc(m[0]), i }));
  const offline = [];
  const strong = [];
  const weak = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    // Kaksiosaiset nimet isolla alkukirjaimella ("New Yorkissa", "Las Palmasissa")
    const nx = toks[k + 1];
    if (nx && /^\p{Lu}/u.test(t.text) && /^\p{Lu}/u.test(nx.text)) {
      const two = findOffline(`${t.text} ${nx.text}`);
      if (two && /\s/u.test(two.name)) {
        offline.push({ word: `${t.text} ${nx.text}`, offline: two, strong: true });
        k++;
        continue;
      }
    }
    if (t.text.length < 3 || /^\p{N}+$/u.test(t.text) || isLexical(t.lower)) continue;
    const off = findOffline(t.text);
    if (off) {
      offline.push({ word: t.text, offline: off, strong: true });
      continue;
    }
    // Kysymys- ja kieltopäätteiset sanat ("Menisinkö", "Sataako") ovat verbejä, eivät paikkoja.
    if (t.lower.length >= 6 && /(?:ko|kö|kaan|kään)$/u.test(t.lower)) continue;
    const hasSuffix = CASE_SUFFIXES.some((s) => s.length >= 2 && t.lower.length - s.length >= 3 && t.lower.endsWith(s));
    const capital = /^\p{Lu}/u.test(t.text);
    if (capital && (t.i > 0 || toks.length <= 3 || hasSuffix)) strong.push({ word: t.text, strong: true, queries: placeQueries(t.text) });
    else if (!capital && hasSuffix && !CLITIC.test(t.lower) && /(?:ssa|ssä|lla|llä|lta|ltä|sta|stä|lle)$/u.test(t.lower) && t.lower.length >= 7) {
      weak.push({ word: t.text, strong: false, queries: placeQueries(t.text) });
    }
  }
  return [...offline.slice(0, 2), ...strong.slice(0, 2), ...weak.slice(0, 1)].slice(0, 3);
}

// ---------- Kokonaisjäsennys ----------

const GREETING = /^(?:hei|moi|moikka|moro|terve|hello|hi|hyvää (?:päivää|iltaa|huomenta|yötä)|päivää|huomenta|iltaa)(?: |$)/u;
const THANKS = /(?:^| )(?:kiitos|kiitti|kiitoksia|thanks|thx)(?: |$)/u;

/** Valitsee aiheet: poistaa päällekkäiset ja järjestää kysymyksen mukaiseen järjestykseen (enintään kolme). */
export function detectIntents(N) {
  const NwithoutSun = N.replace(SUN_RE_ALL, ' ');
  const found = [];
  for (const [id, re] of INTENT_RES) {
    const m = re.exec(id === 'sky' ? NwithoutSun : N);
    if (m) found.push({ id, at: m.index });
  }
  const ids = new Set(found.map((f) => f.id));
  if (ids.has('snow') && ids.has('rain') && !/(?:^| )(?:vesisa|vettä)/u.test(N)) ids.delete('rain');
  if (ids.has('models') && ids.has('confidence')) {
    // "Ovatko mallit samaa mieltä?" kysyy yksimielisyyttä; mallien taulukko vain, jos mallit nimetään tai pyydetään näyttämään
    if (/(?:^| )(?:ecmwf|ifs|icon|dwd|gfs|noaa|gem|ukmo|arpege|fmi|nordic|näytä|listaa|kerro)/u.test(N)) ids.delete('confidence');
    else ids.delete('models');
  } else if (ids.has('models')) ids.delete('confidence');
  if (ids.has('clothing')) for (const k of ['temp', 'rain', 'snow', 'wind', 'ice', 'sky']) if (!(k === 'rain' && /(?:^| )(?:sate{1,2}nvarj|sadevarj)/u.test(N))) ids.delete(k); // pukeutumisvastaus kattaa nämä; sateenvarjokysymys saa oman vastauksensa
  if (ids.has('clothing') && ids.has('outdoor') && !/(?:^| )(?:paras|milloin|kannattaa)/u.test(N)) ids.delete('outdoor');
  if (ids.has('outdoor') && /(?:^| )(?:pyykk|pyykin|pyykit|kuivat|kuivuu|kuivaus|ripust)/u.test(N)) for (const k of ['rain', 'temp', 'sky', 'wind']) ids.delete(k);
  if (ids.has('outdoor') && ids.has('rain') && /(?:^| )(?:sate{1,2}nvarj|sadevarj|sadetak|sadevaat)/u.test(N)) ids.delete('outdoor');
  if (ids.has('ice') && ids.has('rain') && /(?:^| )jäätäv/u.test(N)) ids.delete('rain');
  if (ids.has('ice') && ids.has('outdoor') && !/(?:^| )(?:paras|milloin|kannattaa|voiko|voinko|saako|sopii)/u.test(N)) ids.delete('outdoor');
  if (ids.has('tyres')) ids.delete('drive');
  const SPEC = ['tyres', 'drive', 'moon', 'aurora', 'uv', 'icecover', 'pollen', 'aqi'];
  if (SPEC.some((k) => ids.has(k))) for (const k of [...ids]) if (!SPEC.includes(k)) ids.delete(k);
  if (ids.has('outdoor') && ids.has('sky') && !/(?:^| )(?:pilv|aurinkoi|selke)/u.test(N)) ids.delete('sky');
  if (ids.size > 1) ids.delete('summary');
  if (ids.size > 1) ids.delete('help');
  return found
    .filter((f) => ids.has(f.id))
    .sort((a, b) => a.at - b.at)
    .map((f) => f.id)
    .slice(0, 3);
}

/**
 * Jäsentää kysymyksen. Palauttaa:
 * { raw, N, intents, when, models, activity, places, flags: { followUp, askWhen, local, there, compare, umbrella, frost, fog, storm, greeting, thanks } }
 */
export function parseQuestion(text, { nowHour = null } = {}) {
  const raw0 = String(text ?? '').trim();
  const raw = enToFi(raw0);
  FOLD = !/[äöåÄÖÅ]/u.test(raw);
  try {
    return { ...parseCore(raw, nowHour), raw: raw0 };
  } finally {
    FOLD = false;
  }
}

function parseCore(raw, nowHour) {
  const tokens = tokenize(lc(raw));
  const N = tokens.join(' ');
  const when = parseWhen(raw, { nowHour });
  const intents = detectIntents(N);
  const activity = ACTIVITIES.find(([re]) => re.test(N))?.[1] || null;
  const models = MODEL_ALIASES.filter(([, re]) => re.test(N)).map(([key]) => key);
  const flags = {
    followUp: /^(?:entä|entäs|ja|sitten|myös|mites|mutta|sama|samoin|ja entä)(?: |$)/u.test(N),
    quantify: /^(?:kuinka paljon|paljonko|montako|kuinka kauan|kauanko|milloin|mihin aikaan|koska)(?: |$)/u.test(N),
    askWhen: /(?:^| )(?:milloin|mihin aikaan|koska|mihin asti|kuinka kauan|kauanko)(?: |$)/u.test(N),
    local: /(?:^| )(?:täällä|tässä|tällä paikkakunnalla|nykyisessä|nykyisen|kotona)(?: |$)/u.test(N),
    there: /(?:^| )(?:siellä|sinne|sielläkin|sieltä|tuolla|tuonne|tuolta)(?: |$)/u.test(N),
    unknownPlace: /(?:^| )(?:m[öo]k(?:k|i)|kes[äa]m[öo]k)/u.test(N),
    compare: /(?:^| )(?:(?:kuin|vs)(?: |$)|verrattuna|vertaa|vertaile|kumpi|kummalla|kummassa|enemmän|vähemmän|kylmemp|lämpimämp|viileämp|sateisemp|tuulisemp|aurinkoisemp)/u.test(N),
    either: /(?:^| )vai(?: |$)/u.test(N),
    superlative: /(?:^| )(?:lämpimin|kylmin|viilein|kuumin)/u.test(N),
    route: /(?:^| )\S+(?:sta|stä) (?:\S+ )?\S+(?:lle|hin|iin|seen)(?= |$)/u.test(N),
    onRoute: /(?:^| )(?:matkalla|reitillä|matkan varrella)(?: |$)/u.test(N),
    umbrella: /(?:^| )(?:sate{1,2}nvarj|sadevarj|sadetak[ki]|sadevaat|sadehous|kumisaap)/u.test(N),
    fog: /(?:^| )(?:sumu|sumui|usva|utu(?:inen|isia|ista)?(?: |$))/u.test(N),
    storm: /(?:^| )(?:myrsk|rajuilma|ankara tuuli)/u.test(N),
    frost: /(?:^| )(?:pakka(?!us)|miinus|jäätyy|jäätä|halla|nollan|kasvi|kukka|taimi)/u.test(N),
    smalltalk: /(?:^| )(?:mitä kuuluu|miten menee|how are you)/u.test(N),
    greeting: GREETING.test(N),
    thanks: THANKS.test(N),
  };
  const places = placeCandidates(raw);
  if ((flags.route && places.length >= 2) || (flags.onRoute && places.length >= 1)) {
    if (intents.every((i) => i === 'summary' || i === 'sky')) intents.splice(0, intents.length, 'drive');
  }
  return { raw, N, tokens, intents, when, models, activity, places, flags, days2: flags.compare || flags.either ? twoDays(N) : null };
}


// ---------- Apurit: englanti, kellonajat sanoin, kaksi päivää ----------

const CLOCK_ABL = { yhdeltä: 1, kahdelta: 2, kolmelta: 3, neljältä: 4, viideltä: 5, kuudelta: 6, seitsemältä: 7, kahdeksalta: 8, yhdeksältä: 9, kymmeneltä: 10, yhdeltätoista: 11, kahdeltatoista: 12 };
const CLOCK_NOM = { yksi: 1, kaksi: 2, kolme: 3, neljä: 4, viisi: 5, kuusi: 6, seitsemän: 7, kahdeksan: 8, yhdeksän: 9, kymmenen: 10, yksitoista: 11, kaksitoista: 12 };

/** Pieni englanti-suomi-sanasto: "will it rain tomorrow" -> "will it sataa huomenna". */
const EN = {
  weather: 'sää', forecast: 'ennuste', rain: 'sataa', raining: 'sataa', rainy: 'sateista', snow: 'lunta', snowing: 'lunta', snowy: 'lunta', wind: 'tuulee', windy: 'tuulista',
  cold: 'kylmä', warm: 'lämmin', hot: 'kuuma', temperature: 'lämpötila', tomorrow: 'huomenna', today: 'tänään', tonight: 'tänä yönä', now: 'nyt', weekend: 'viikonloppuna',
  wear: 'pukisin', jacket: 'takki', coat: 'takki', umbrella: 'sateenvarjo', sunset: 'auringonlasku', sunrise: 'auringonnousu', fog: 'sumua', foggy: 'sumua', thunder: 'ukkosta',
  storm: 'myrsky', icy: 'liukasta', slippery: 'liukasta', humidity: 'kosteus', pressure: 'ilmanpaine', cloudy: 'pilvistä', sunny: 'aurinkoista', feels: 'tuntuu',
  morning: 'aamulla', evening: 'illalla', night: 'yöllä', yesterday: 'eilen',
};
function enToFi(raw) {
  return raw.replace(/\p{L}+/gu, (w) => {
    const k = lc(w);
    return Object.hasOwn(EN, k) ? EN[k] : w;
  });
}

/** Kaksi eri päivää samassa kysymyksessä ("huomenna vai lauantaina") vertailua varten. */
function twoDays(N) {
  const out = [];
  const seen = new Set();
  for (const m of N.matchAll(/(?:^| )(tänään|huomenna|ylihuomenna|maanantai\S*|tiistai\S*|keskiviikko\S*|torstai\S*|perjantai\S*|lauantai\S*|sunnuntai\S*)(?= |$)/gu)) {
    const w = m[1];
    const d = w === 'tänään' ? { type: 'offset', n: 0 } : w === 'huomenna' ? { type: 'offset', n: 1 } : w === 'ylihuomenna' ? { type: 'offset', n: 2 } : { type: 'weekday', wd: WEEKDAYS.findIndex((x) => w.startsWith(x)), next: false };
    const key = JSON.stringify(d);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(d);
    }
  }
  return out.length >= 2 ? out.slice(0, 2) : null;
}

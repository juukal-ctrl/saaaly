"""Päästä päähän -testit oikealla selaimella (Chromium). Verkkokutsut korvataan esimerkkidatalla,
mutta sovellus käyttää tavallista fetch-polkua. Käyttö: python3 tools/e2e.py"""
import datetime, functools, http.server, json, os, pathlib, re, subprocess, sys, threading
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parent.parent
NOW_ISO = '2026-10-14T20:04:00+03:00'
NOW_MS = int(datetime.datetime.fromisoformat(NOW_ISO).timestamp() * 1000)
TURKU = (60.4518, 22.2666)

# ---- staattinen palvelin ----
# Oletuksena testataan julkaise/-kansio samasta alipolusta kuin GitHub Pages palvelee sen (/saaaly/).
# E2E_TARGET=root testaa lähdekansion sellaisenaan.
TARGET = os.environ.get('E2E_TARGET', 'julkaise')
if TARGET not in ('julkaise', 'root'):
    sys.exit('E2E_TARGET on julkaise tai root')
SITE = ROOT / 'julkaise' if TARGET == 'julkaise' else ROOT
PREFIX = '/saaaly/' if TARGET == 'julkaise' else '/'
if not (SITE / 'index.html').exists():
    sys.exit('Julkaisukansiota ei ole. Aja ensin: node tools/build.mjs')
SERVER = {'down': False}  # true = palvelin ei vastaa (jäljittelee verkon katkeamista)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def translate_path(self, path):
        if PREFIX != '/':
            if not path.startswith(PREFIX):
                return str(SITE / '_ei_ole_')
            path = '/' + path[len(PREFIX):]
        return super().translate_path(path)
    def send_head(self):
        if SERVER['down']:
            self.close_connection = True
            return None  # yhteys katkeaa vastaamatta, selain näkee verkkovirheen
        return super().send_head()
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(SITE)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
ORIGIN = f'http://127.0.0.1:{srv.server_address[1]}'
BASE = ORIGIN + (PREFIX if TARGET == 'julkaise' else '/index.html')
print(f'Testataan: {TARGET} ({BASE})')

# ---- verkkokutsujen korvaajat ----
cache = {}
net_log = []
gemini_calls = []
GEMINI = {'fail': None}  # esim. 500 tai 429: Gemini-mock vastaa virheellä
CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json'}

def mock_data(url, scenario='mixed'):
    key = (url, scenario)
    if key not in cache:
        out = subprocess.run(['node', str(ROOT / 'tools/mock.mjs'), url, scenario, str(NOW_MS)], capture_output=True, text=True, check=True).stdout
        cache[key] = json.loads(out)
    return cache[key]

def data_route(route):
    req = route.request
    net_log.append(req.url)
    if req.method == 'OPTIONS':
        return route.fulfill(status=204, headers=CORS)
    m = mock_data(req.url)
    route.fulfill(status=m['status'], headers=CORS, body=m['body'])

def gemini_route(route):
    req = route.request
    if req.method == 'OPTIONS':
        return route.fulfill(status=204, headers=CORS)
    if '/models?' in req.url:
        body = {'models': [{'name': 'models/gemini-2.5-flash', 'supportedGenerationMethods': ['generateContent']}, {'name': 'models/gemini-3-flash-preview', 'supportedGenerationMethods': ['generateContent']}]}
        return route.fulfill(status=200, headers=CORS, body=json.dumps(body))
    body = json.loads(req.post_data or '{}')
    gemini_calls.append({'url': req.url, 'key': req.headers.get('x-goog-api-key'), 'body': body})
    if GEMINI['fail']:
        return route.fulfill(status=GEMINI['fail'], headers=CORS, body=json.dumps({'error': {'message': 'testivirhe'}}))
    if 'bad-model' in req.url:
        return route.fulfill(status=404, headers=CORS, body=json.dumps({'error': {'message': 'models/bad-model is not found'}}))
    last = body['contents'][-1]
    ask = ' '.join(p.get('text', '') for p in last['parts'])
    if body.get('tools') and 'Rovaniemellä' in ask and 'functionResponse' not in json.dumps(last):
        parts = [{'functionCall': {'name': 'get_forecast', 'args': {'place': 'Rovaniemi'}}}]
    elif 'functionResponse' in json.dumps(last):
        parts = [{'text': 'Rovaniemellä on **kylmempää** kuin Turussa.'}]
    else:
        parts = [{'text': '**Illalla sataa.** Ota takki mukaan.\n\n- Tuuli on heikkoa\n- Lämpötila laskee'}]
    route.fulfill(status=200, headers=CORS, body=json.dumps({'candidates': [{'content': {'role': 'model', 'parts': parts}, 'finishReason': 'STOP'}]}))

def other_route(route):
    route.fulfill(status=403, headers=CORS, body='{"error":{"message":"estetty testissä"}}')

DATA_RX = re.compile(r'https://(api\.open-meteo\.com|geocoding-api\.open-meteo\.com|api\.bigdatacloud\.net|api\.met\.no|raw\.githubusercontent\.com|opendata\.fmi\.fi|api\.rainviewer\.com)/')
TILE_RX = re.compile(r'https://tilecache\.rainviewer\.com/')
tile_log = []

def tile_png():
    """Tutkatiili testiin: läpinäkyvä 256 px kuva, jossa sininen sadealue."""
    from PIL import Image, ImageDraw
    import io
    im = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
    ImageDraw.Draw(im).ellipse([60, 70, 200, 180], fill=(60, 140, 255, 200))
    buf = io.BytesIO()
    im.save(buf, 'PNG')
    return buf.getvalue()

TILE_BYTES = tile_png()

def tile_route(route):
    tile_log.append(route.request.url)
    route.fulfill(status=200, headers={'content-type': 'image/png', 'access-control-allow-origin': '*'}, body=TILE_BYTES)

def install(ctx):
    ctx.route(DATA_RX, data_route)
    ctx.route(TILE_RX, tile_route)
    ctx.route(re.compile(r'https://generativelanguage\.googleapis\.com/'), gemini_route)
    ctx.route(re.compile(r'https://(nominatim\.openstreetmap\.org|aistudio\.google\.com)/'), other_route)

# ---- apurit ----
passed, failed = [], []
PAGES = []
def check(name, fn):
    try:
        fn()
        passed.append(name)
        print('  ok  ', name)
    except Exception as e:
        failed.append((name, e))
        print('  VIRHE', name, '\n       ', str(e).strip().splitlines()[0][:300])
        for pg in PAGES:  # suljetaan mahdollisesti auki jäänyt paneeli, ettei yksi virhe kaada seuraavia testejä
            try:
                pg.keyboard.press('Escape')
            except Exception:
                pass

def new_page(browser, geo=True, width=412, height=915):
    ctx = browser.new_context(viewport={'width': width, 'height': height}, device_scale_factor=1, is_mobile=True, has_touch=True, locale='fi-FI', timezone_id='Europe/Helsinki',
                              geolocation={'latitude': TURKU[0], 'longitude': TURKU[1]} if geo else None, permissions=['geolocation'] if geo else [])
    ctx.clock.set_fixed_time(NOW_ISO)
    install(ctx)
    page = ctx.new_page()
    PAGES.append(page)
    page.errors = []
    page.responses = []  # (osoite, tila) kaikista testipalvelimen vastauksista
    page.on('response', lambda r: page.responses.append((r.url, r.status)) if r.url.startswith(ORIGIN) else None)
    page.on('pageerror', lambda e: page.errors.append(f'pageerror: {e}'))
    page.on('console', lambda m: page.errors.append(f'console: {m.text}') if m.type == 'error' else None)
    return ctx, page

def chat_calls(question):
    """Gemini-kutsut, joissa käyttäjän kysymys on mukana (erottaa chatin selityskortin kutsuista)."""
    return [c for c in gemini_calls if question in json.dumps(c['body']['contents'], ensure_ascii=False)]

def sys_prompt(call):
    return call['body']['systemInstruction']['parts'][0]['text']

CUBE_REST = "document.querySelector('#pages').classList.contains('cube-rest')"

def goto_page(page, i):
    """Kääntää sivukuution pisteiden kautta (0 koti, 1 tunnit, 2 viikko, 3 varmuus) ja odottaa, että se on levossa sivulla."""
    page.click(f'#dots [data-page="{i}"]')
    page.wait_for_function(f"(i) => {CUBE_REST} && window.__saaaly.state.page === i", arg=i, timeout=5000)

def cube_drag(page, x0, x1, y, steps=10, hold=0):
    """Vaakaveto hiirellä (osoitintapahtumat kuten sormella). hold: ms paikallaan ennen irrotusta."""
    page.mouse.move(x0, y)
    page.mouse.down()
    for k in range(1, steps + 1):
        page.mouse.move(x0 + (x1 - x0) * k / steps, y)
        page.wait_for_timeout(16)
    if hold:
        page.wait_for_timeout(hold)
    page.mouse.up()
    page.wait_for_function(f"() => {CUBE_REST}", timeout=3000)

def open_adv(page):
    """Avaa asetukset ja niiden Lisäasetukset-osion (vastausten lähde, Gemini, diagnostiikka)."""
    page.click('[data-act=open-settings]')
    page.evaluate("document.getElementById('advSet').open = true")

def set_mode(page, mode):
    open_adv(page)
    page.click(f'#advSet .modebar .seg[data-mode={mode}]')
    page.click('.sheet-head [data-act=close]')

def ask(page, q):
    page.fill('#msg', q)
    page.click('.send')

def ready(page, name='Turku'):
    page.wait_for_function("(n) => { const s = window.__saaaly && window.__saaaly.state; return s && s.place && s.place.name === n && s.fc && Math.abs(s.fc.lat - s.place.lat) < 0.01 && !s.loading; }", arg=name, timeout=20000)

def expected_temp(lat, lon):
    out = subprocess.run(['node', str(ROOT / 'tools/expected.mjs'), str(lat), str(lon), str(NOW_MS)], capture_output=True, text=True, check=True).stdout
    return json.loads(out)

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=os.environ.get('PW_CHROMIUM') or None)
    print('Ensimmäinen käynnistys (sijainti sallittu)')
    ctx, page = new_page(browser)
    page.goto(BASE)
    ready(page)

    def t_place():
        expect(page.locator('#placeBtn .pn')).to_have_text('Turku')
        expect(page.locator('#placeBtn .place-sub')).to_contain_text('Varsinais-Suomi')
        assert 'Oma sijainti' not in page.inner_text('body')
    check('paikan nimi ja maakunta näkyvät (ei "Oma sijainti")', t_place)

    def t_temp():
        exp = expected_temp(*TURKU)
        shown = page.text_content('.temp').strip()  # visuaalinen lämpötila (merkki + luku + aste); ruudunlukijalle on erillinen .sr-only-teksti
        assert shown == exp['temp'], f'näytetty {shown}, odotettu {exp["temp"]}'
        sr = page.text_content('#hero .sr-only')
        assert exp['temp'] in sr, f'ruudunlukijateksti ei sisällä lämpötilaa: {sr}'
    check('nykyhetken lämpötila vastaa laskettua arvoa', t_temp)

    def t_hourly():
        goto_page(page, 1)
        expect(page.locator('#strip .hv')).to_have_count(13)
        expect(page.locator('#strip .hv').first).to_contain_text('nyt')
        page.click('[data-act=hours-more]')
        expect(page.locator('#strip .hv')).to_have_count(48)
        page.click('[data-act=hours-more]')
        goto_page(page, 2)
        expect(page.locator('#daily .wd')).to_have_count(7)
        goto_page(page, 0)
    check('Tunnit (13 tai 48 h) ja Viikko (7 pv) omilla sivuillaan', t_hourly)

    def t_meteo():
        goto_page(page, 1)
        page.click('[data-act=hours-view][data-view=chart]')
        expect(page.locator('#meteo svg.mg')).to_be_visible()
        expect(page.locator('#meteo .mg-ic .wx3').first).to_be_visible()
        expect(page.locator('#mgRead')).to_contain_text('Seuraavat 24 tuntia')
        page.locator('#mgWrap').scroll_into_view_if_needed()
        box = page.locator('#mgWrap').bounding_box()
        page.mouse.click(box['x'] + box['width'] * 0.5, box['y'] + box['height'] * 0.5)
        expect(page.locator('#mgRead b')).to_be_visible()
        expect(page.locator('#mgRead')).to_contain_text('klo')
        n0 = int(page.get_attribute('#mgWrap', 'aria-valuenow'))
        assert 0 < n0 < 23, f'tarkastuskohta ei osunut keskelle: {n0}'
        page.keyboard.press('ArrowRight')
        assert int(page.get_attribute('#mgWrap', 'aria-valuenow')) == n0 + 1, 'nuolinäppäin ei siirtänyt tarkastuskohtaa'
        assert page.evaluate("document.activeElement.id") == 'mgWrap', 'fokus katosi uudelleenpiirrossa'
        page.keyboard.press('Escape')
        expect(page.locator('#mgRead')).to_contain_text('Seuraavat 24 tuntia')
        page.click('[data-act=mg-range][data-range="7d"]')
        expect(page.locator('#mgRead')).to_contain_text('Seuraavat 7 päivää')
        expect(page.locator('[data-act=mg-range][data-range="7d"]')).to_have_attribute('aria-pressed', 'true')
        page.click('[data-act=mg-range][data-range="24h"]')
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), 'kaavio aiheutti vaakavierityksen'
        page.locator('#meteo details summary').click()
        assert page.locator('#meteo .tbl tbody tr').count() >= 6, 'taulukkoversio puuttuu'
        page.locator('#meteo details summary').click()
        page.click('[data-act=hours-view][data-view=list]')
        goto_page(page, 0)
    check('sääkaavio: näkyy, kosketus ja nuolinäppäimet tarkastavat kohdan, aikavälit vaihtuvat ja taulukko löytyy', t_meteo)

    def t_models():
        goto_page(page, 3)
        page.click('#models summary')
        expect(page.locator('#models .tbl tbody tr')).to_have_count(9)  # 8 mallia + yhdistelmä
        expect(page.locator('#models .tbl tr.blend')).to_contain_text('Yhdistelmä')
        expect(page.locator('#certainty .pearl')).to_have_count(16)  # 8 mallia, tänään ja huomenna
        expect(page.locator('#certainty .cert-c.obs')).to_contain_text('Esimerkkiasema')
        goto_page(page, 0)
    check('Varmuus: helmet malleittain, havainto ja mallivertailu', t_models)

    def t_cube():
        st = lambda: page.evaluate("window.__saaaly.state.page")
        goto_page(page, 0)
        cube_drag(page, 330, 110, 520)
        assert st() == 1, f'vaakaveto vasemmalle ei kääntänyt Tunteihin: {st()}'
        expect(page.locator('#dots [data-page="1"]')).to_have_attribute('aria-current', 'true')
        cube_drag(page, 110, 330, 520)
        assert st() == 0, f'veto oikealle ei palannut Kotiin: {st()}'
        cube_drag(page, 110, 330, 520)
        assert st() == 3, f'kuutio ei jatkanut ympäri Kodista Varmuuteen: {st()}'
        cube_drag(page, 330, 110, 520)
        assert st() == 0, f'Varmuudesta eteenpäin ei tullut Koti: {st()}'
        cube_drag(page, 300, 250, 520, steps=5, hold=300)
        assert st() == 0, 'lyhyt hidas veto vaihtoi sivun'
        b = page.locator('#track .th').nth(2).bounding_box()
        cube_drag(page, b['x'] + b['width'] / 2, b['x'] + b['width'] / 2 - 220, b['y'] + b['height'] / 2)
        assert page.evaluate("window.__saaaly.state.sel.type") == 'now', 'veto radan tunnin päältä valitsi tunnin'
        goto_page(page, 0)
        assert page.evaluate("[...document.querySelectorAll('.face')].map((f) => f.inert).join()") == 'false,true,true,true', 'piilossa oleva kylki on kohdistettavissa'
        goto_page(page, 2)
        page.go_back()
        page.wait_for_function(f"() => {CUBE_REST} && window.__saaaly.state.page === 0", timeout=3000)
    check('sivukuutio: vaakaveto kääntää ja jatkaa ympäri, lyhyt veto palaa, veto ei ole napautus, takaisin palaa kotiin', t_cube)

    def t_map():
        goto_page(page, 0)
        tile_log.clear()
        page.click('.map-btn')
        page.wait_for_function("() => { const d = window.__saaaly.map && window.__saaaly.map.debug(); return d && d.frames === 7 && d.tilesOk > 0 && d.base; }", timeout=10000)
        expect(page.locator('#mapView')).to_be_visible()
        assert tile_log and all(re.search(r'/v2/radar/demo\d+/256/\d/\d+/\d+/2/1_0\.png$', u) for u in tile_log), tile_log[:3]
        assert len(set(tile_log)) <= 7 * 12, f'liikaa tiilihakuja: {len(set(tile_log))}'
        assert page.evaluate("window.__saaaly.map.debug().map") == 'nordic'
        set_range = "(v) => { const r = document.querySelector('.mv-range'); r.value = String(v); r.dispatchEvent(new Event('input', { bubbles: true })); }"
        page.evaluate(set_range, 6)
        expect(page.locator('.mv-time')).to_have_text(re.compile(r'^klo \d{1,2}\.\d\d · uusin'))
        assert not page.evaluate("window.__saaaly.map.debug().playing"), 'liukusäädin ei pysäyttänyt toistoa'
        page.evaluate(set_range, 0)
        expect(page.locator('.mv-time')).to_have_text(re.compile(r'^klo \d{1,2}\.\d\d · 2 t( \d+ min)? sitten$'))
        page.click('[data-mv="tab"][data-tab="cloud"]')
        page.wait_for_function("() => { const d = window.__saaaly.map.debug(); return d.tab === 'cloud' && d.grid > 100 && d.hours === 25; }", timeout=10000)
        multi = [u for u in net_log if u.startswith('https://api.open-meteo.com/') and ',' in u.split('latitude=')[1].split('&')[0]]
        assert multi, 'pilviennusteen monen pisteen hakua ei tehty'
        expect(page.locator('.mv-time')).to_have_text('nyt')
        page.evaluate(set_range, 5)
        expect(page.locator('.mv-time')).to_have_text(re.compile(r'^(tänään|huomenna) klo \d{1,2}$'))
        km0 = page.evaluate("window.__saaaly.map.debug().km")
        page.click('[data-mv="zoom-in"]')
        assert page.evaluate("window.__saaaly.map.debug().km") < km0 * 0.8, 'lähennys ei pienentänyt aluetta'
        page.click('[data-mv="close"]')
        expect(page.locator('#mapView')).to_be_hidden()
        # Alisivulta avattu kartta (ja paneeli) sulkeutuu samalle sivulle; takaisin-ele sulkee ensin kartan, sitten palaa kotiin.
        goto_page(page, 2)
        page.click('.map-btn')
        page.wait_for_function("() => window.__saaaly.map.isOpen")
        page.click('[data-mv="close"]')
        page.wait_for_timeout(400)
        assert page.evaluate("window.__saaaly.state.page") == 2, 'kartan sulkeminen vaihtoi sivua'
        page.click('[data-act="open-settings"]')
        page.keyboard.press('Escape')
        page.wait_for_timeout(400)
        assert page.evaluate("window.__saaaly.state.page") == 2, 'asetusten sulkeminen vaihtoi sivua'
        page.click('.map-btn')
        page.wait_for_function("() => window.__saaaly.map.isOpen")
        page.go_back()
        page.wait_for_function("() => !window.__saaaly.map.isOpen")
        expect(page.locator('#mapView')).to_be_hidden()
        page.wait_for_timeout(300)
        assert page.evaluate("window.__saaaly.state.page") == 2, 'takaisin-ele vaihtoi sivua kartan sulkemisen sijaan'
        page.go_back()
        page.wait_for_function(f"() => {CUBE_REST} && window.__saaaly.state.page === 0", timeout=3000)
        bad = [e for e in page.errors if 'Content Security Policy' in e or 'Refused' in e]
        assert not bad, bad
    check('kartta: tutka ja pilvet avautuvat alapalkista, aikajana ja lähennys toimivat, sulkeutuu ×:stä ja takaisin-eleellä', t_map)

    def t_day():
        goto_page(page, 2)
        row = page.locator('#daily .wd').nth(1)
        row.click()
        expect(page.locator('#daily .day-hours')).to_be_visible()
        expect(row).to_have_attribute('aria-expanded', 'true')
        row.click()
        expect(page.locator('#daily .day-hours')).to_have_count(0)
        goto_page(page, 0)
    check('Viikko: päivän napautus avaa sen tunnit paikallaan ja sulkee ne', t_day)

    def t_hour():
        goto_page(page, 1)
        y0 = page.evaluate("document.querySelector('#pgHours').scrollTop")
        page.locator('#strip .hv').nth(5).click()
        expect(page.locator('#strip .hv-more')).to_be_visible()
        expect(page.locator('#strip .hv').nth(5)).to_have_attribute('aria-expanded', 'true')
        assert abs(page.evaluate("document.querySelector('#pgHours').scrollTop") - y0) < 60, 'tunnin avaus vieritti sivua'
        page.locator('#strip .hv').nth(5).click()
        expect(page.locator('#strip .hv-more')).to_have_count(0)
        goto_page(page, 0)
        page.locator('#track .th').nth(2).click()
        expect(page.locator('#hero .hero-chip')).to_contain_text('klo')
        expect(page.locator('#track .th').nth(2)).to_have_attribute('aria-pressed', 'true')
        page.click('#hero .hero-chip')
        expect(page.locator('#hero .hero-chip')).to_have_count(0)
    check('tunnin valinta: Tunnit-rivi avautuu paikallaan, radan tunti näkyy sankarissa', t_hour)

    def t_layout():
        for w in (360, 412):
            page.set_viewport_size({'width': w, 'height': 800})
            page.wait_for_timeout(200)
            sw = page.evaluate('document.documentElement.scrollWidth')
            assert sw <= w, f'vaakasuuntainen vieritys {w}px:llä: {sw}'
        page.set_viewport_size({'width': 412, 'height': 915})
    check('ei vaakasuuntaista vieritystä (360 ja 412 px)', t_layout)

    # Tekoäly ilman avainta: näkyy laskennallinen yhteenveto ja kehote lisätä avain
    def t_nokey():
        page.click('.ask-btn')
        expect(page.locator('#msgs .msg.intro')).to_contain_text('SääÄly kertoo · oma laskenta')
        expect(page.locator('.chat-src')).to_contain_text('Oma laskenta')
        page.click('.sheet-head [data-act=close]')
    check('ilman avainta chatin ensimmäinen viesti on laskennallinen selitys', t_nokey)

    # Chat ilman avainta: sovelluksen oma vastausmoottori vastaa sovelluksen datalla, Geminiä ei kutsuta
    def t_chat_nokey():
        page.click('.ask-btn')
        expect(page.locator('#msg')).to_be_enabled()
        expect(page.locator('.send')).to_be_enabled()
        expect(page.locator('.chat-src')).to_contain_text('Vastaa: Oma laskenta')
        expect(page.locator('#msgs')).to_contain_text('sovelluksen keräämän säädatan')
        ask(page, 'Sataako huomenna?')
        expect(page.locator('.msg.bot').first).to_contain_text('Huomenna sataa', timeout=8000)
        src = page.locator('.msg.bot .src').first
        expect(src).to_contain_text('Sovelluksen oma laskenta')
        expect(src).to_contain_text('mallia')
        assert '**' not in page.inner_text('#msgs'), 'raaka markdown näkyy'
        assert not gemini_calls, 'Geminiä kutsuttiin ilman avainta'
    check('chat toimii ilman avainta: oma vastaus, lähdemerkintä, ei Gemini-kutsuja', t_chat_nokey)

    def t_chat_followup():
        n0 = len(net_log)
        page.fill('#msg', 'Entä Rovaniemellä?')
        page.click('.send')
        second = page.locator('.msg.bot').nth(1)
        expect(second).to_contain_text('Rovaniemi, Lappi', timeout=10000)
        expect(second).to_contain_text('Huomenna')  # jatkokysymys perii ajankohdan
        assert [u for u in net_log[n0:] if 'api.open-meteo.com' in u and 'latitude=66.' in u], 'Rovaniemen säätä ei haettu'
        page.fill('#msg', 'Kerro vitsi')
        page.click('.send')
        expect(page.locator('.msg.bot').nth(2)).to_contain_text('En ymmärtänyt kysymystä', timeout=8000)
        expect(page.locator('.msg.bot').nth(2)).to_contain_text('Sataako huomenna?')  # ohje kertoo, mitä voi kysyä
        assert not gemini_calls, 'Geminiä kutsuttiin ilman avainta'
    check('chat: jatkokysymys toisesta paikasta hakee sen datan ja perii ajankohdan, outo kysymys ohjataan', t_chat_followup)

    def t_chat_nowcast():
        page.wait_for_function("() => { const s = window.__saaaly.state; return Boolean(s.nc && s.nc.raw); }", timeout=8000)
        page.fill('#msg', 'Sataako nyt?')
        page.click('.send')
        expect(page.locator('.msg.bot').nth(3)).to_contain_text('eikä tutkan mukaan sada seuraavaan 2 tuntiin', timeout=8000)  # mallit ennustavat sadetta vasta huomiselle, tutka kertoo lähitunnit
        assert not gemini_calls, 'Geminiä kutsuttiin ilman avainta'
    check('chat: "Sataako nyt?" käyttää tutkaennustetta, kun se on saatavilla', t_chat_nowcast)

    def t_chat_layout():
        for w in (360, 412):
            page.set_viewport_size({'width': w, 'height': 800})
            page.wait_for_timeout(150)
            r = page.evaluate("""() => {
                const p = document.querySelector('#sheetPanel');
                const segs = [...document.querySelectorAll('#sheetPanel .chips .pill')].slice(0, 0).map((b) => [b.textContent, b.scrollWidth, b.clientWidth]);
                return { panel: [p.scrollWidth, p.clientWidth], page: document.documentElement.scrollWidth, segs };
            }""")
            assert r['panel'][0] <= r['panel'][1] + 1, f'chat-paneeli vuotaa vaakasuunnassa {w}px:llä: {r}'
            assert r['page'] <= w, f'sivu vuotaa vaakasuunnassa {w}px:llä: {r}'
            for text, sw, cw in r['segs']:
                assert sw <= cw + 1, f'tilapainikkeen teksti leikkautuu {w}px:llä: {text} {sw}>{cw}'
        page.set_viewport_size({'width': 412, 'height': 915})
    check('chat-paneeli mahtuu 360 ja 412 px leveään näyttöön', t_chat_layout)

    def t_gemini_needs_key():
        page.click('.sheet-head [data-act=close]')
        open_adv(page)
        page.click('#advSet .modebar .seg[data-mode=free]', force=True)  # aria-disabled-painike: käyttäjä voi silti painaa sitä
        expect(page.locator('#sheetPanel')).to_have_attribute('data-kind', 'settings')
        expect(page.locator('#aiNote')).to_contain_text('Lisää ensin Gemini-avain')
        page.click('.sheet-head [data-act=close]')
    check('Gemini-tilan valinta ilman avainta neuvoo lisäämään avaimen', t_gemini_needs_key)

    # Asetukset: avain tallennetaan ja selitys haetaan
    def t_key():
        open_adv(page)
        # kenttä ei ole type=password (selain ei tarjoa avaimen tallennusta salasanana), mutta merkit piilotetaan
        assert page.get_attribute('#key', 'type') == 'text'
        assert page.evaluate("getComputedStyle(document.getElementById('key')).webkitTextSecurity") == 'disc', 'avaimen merkit eivät ole piilossa'
        # virheellinen avain (välilyönti) ei tallennu, ja käyttäjä saa selkeän ohjeen
        page.fill('#key', 'TESTI AVAIN')
        page.click('[data-act=save-key]')
        expect(page.locator('#aiNote')).to_contain_text('Avaimessa on merkkejä')
        page.fill('#key', 'TESTIAVAIN')
        page.click('[data-act=save-key]')
        expect(page.locator('#aiNote')).to_contain_text('Avain tallennettu')
        page.click('.sheet-head [data-act=close]')
        page.click('.ask-btn')
        if page.locator('#chatClear').is_visible():
            page.click('#chatClear')
        expect(page.locator('#msgs .msg.intro .md strong')).to_have_text('Illalla sataa.', timeout=8000)
        txt = page.inner_text('#msgs')
        page.click('.sheet-head [data-act=close]')
        assert '**' not in txt, 'raaka markdown näkyy'
        assert any(c['key'] == 'TESTIAVAIN' for c in gemini_calls), 'avain ei mennyt otsikossa'
        sys_prompt = gemini_calls[-1]['body']['systemInstruction']['parts'][0]['text']
        assert '2026-10-14 klo 20:04' in sys_prompt, 'tekoäly ei tiedä päivämäärää/kellonaikaa'
        assert 'Turku, Varsinais-Suomi' in sys_prompt
    check('Gemini-avain, selitys, markdown ja päivämäärä kontekstissa', t_key)

    def t_testai():
        open_adv(page)
        page.click('[data-act=test-ai]')
        expect(page.locator('#aiNote')).to_contain_text('Yhteys toimii', timeout=6000)
        page.fill('#model', 'bad-model')
        page.click('[data-act=test-ai]')
        expect(page.locator('#aiNote')).to_contain_text('Hae mallit', timeout=6000)
        page.click('[data-act=list-models]')
        expect(page.locator('#aiNote')).to_contain_text('gemini-3-flash-preview', timeout=6000)
        page.click('.sheet-head [data-act=close]')
    check('yhteyden testaus ja mallin korjaus (404 -> mallilista)', t_testai)

    def t_chat():
        n0 = len(net_log)
        page.click('.ask-btn')
        if page.locator('#chatClear').is_visible():
            page.click('#chatClear')
        expect(page.locator('.msg:not(.intro)')).to_have_count(0)
        page.click('[data-act=ask] >> text=Rovaniemellä')
        expect(page.locator('.msg.bot .md strong')).to_have_text('kylmempää', timeout=10000)
        expect(page.locator('.msg.bot .src')).to_have_text('Gemini · data: sovelluksen säämallit')
        # Rovaniemen data voi olla jo muistissa avaimettoman chatin ajalta, joten työkalun tulos tarkistetaan Geminille menneestä vastauksesta
        tulos = None
        for c in gemini_calls:
            last = c['body']['contents'][-1]['parts'][0]
            if 'functionResponse' in last:
                tulos = last['functionResponse']['response']['tulos']
        assert tulos and tulos['paikka'] == 'Rovaniemi, Lappi', f'työkalu ei palauttanut Rovaniemen sääennustetta: {tulos}'
        assert 'mallit_nyt' in tulos and len(tulos['tunnit']) == 36, 'työkalun tulos ei sisällä mallikohtaisia lukuja tai 36 tuntia'
        page.click('.sheet-head [data-act=close]')
    check('chat: get_forecast-työkalu palauttaa toisen paikan datan (mallit mukana) ja vastaus kertoo lähteensä', t_chat)

    def t_modes():
        q = 'Sataako huomenna?'
        open_adv(page)
        expect(page.locator('#advSet .modebar .seg[data-mode=grounded]')).to_have_attribute('aria-pressed', 'true')
        page.click('.sheet-head [data-act=close]')
        # oma laskenta: ei Gemini-kutsuja
        set_mode(page, 'internal')
        assert json.loads(page.evaluate("localStorage.getItem('saaaly.aiMode')")) == 'internal'
        page.click('.ask-btn')
        expect(page.locator('.chat-src')).to_contain_text('Oma laskenta')
        ask(page, q)
        expect(page.locator('.msg.bot .src').last).to_contain_text('Sovelluksen oma laskenta', timeout=8000)
        assert not chat_calls(q), 'oma laskenta kutsui Geminiä'
        page.click('.sheet-head [data-act=close]')
        # Gemini + data: vastaus Geminiltä, järjestelmäohje rajaa datan, mallikohtaiset luvut mukana
        set_mode(page, 'grounded')
        page.click('.ask-btn')
        ask(page, q)
        expect(page.locator('.msg.bot .src').last).to_have_text('Gemini · data: sovelluksen säämallit', timeout=8000)
        sp = sys_prompt(chat_calls(q)[-1])
        assert 'Vastaat vain alla olevan SÄÄDATAN perusteella' in sp, 'rajaussääntö puuttuu'
        assert 'mallit_nyt' in sp and 'mallit_paivittain' in sp, 'mallikohtaiset luvut puuttuvat Geminin kontekstista'
        page.click('.sheet-head [data-act=close]')
        # Gemini vapaa: yleistieto sallittu
        set_mode(page, 'free')
        page.click('.ask-btn')
        ask(page, q)
        expect(page.locator('.msg.bot .src').last).to_have_text('Gemini · sovelluksen data + yleistieto', timeout=8000)
        assert 'Yleistietoa saat käyttää' in sys_prompt(chat_calls(q)[-1])
        page.click('.sheet-head [data-act=close]')
    check('tilan vaihto: oma laskenta, Gemini + data ja Gemini vapaa käyttäytyvät eri tavoin ja tila tallentuu', t_modes)

    def t_card_modes():
        # chatin ensimmäinen viesti seuraa tilaa: oma laskenta -> laskennallinen selitys, Gemini -> Geminin selitys
        set_mode(page, 'internal')
        page.click('.ask-btn')
        page.click('#chatClear')
        expect(page.locator('#msgs .msg.intro')).to_contain_text('oma laskenta')
        page.click('.sheet-head [data-act=close]')
        set_mode(page, 'grounded')
        page.click('.ask-btn')
        expect(page.locator('#msgs .msg.intro .md')).to_be_visible(timeout=8000)
        expect(page.locator('#msgs .msg.intro .src')).to_contain_text('Gemini')
        page.click('.sheet-head [data-act=close]')
        assert json.loads(page.evaluate("localStorage.getItem('saaaly.aiMode')")) == 'grounded'
    check('chatin ensimmäinen viesti (SääÄly kertoo) seuraa vastausten lähdettä', t_card_modes)

    def t_fallback():
        set_mode(page, 'grounded')
        page.click('.ask-btn')
        GEMINI['fail'] = 500
        try:
            ask(page, 'Mitä pukisin tänään?')
            expect(page.locator('.msg.bot .src').last).to_contain_text('Gemini ei vastannut (palvelu ei vastaa)', timeout=10000)
            expect(page.locator('.msg.bot .src').last).to_contain_text('sovelluksen oma laskenta')
            expect(page.locator('.msg.bot').last).to_contain_text('Pukeutuminen')  # vastaus tuli silti
            GEMINI['fail'] = 429
            ask(page, 'Sataako huomenna?')
            expect(page.locator('.msg.bot .src').last).to_contain_text('kiintiö täynnä', timeout=10000)
        finally:
            GEMINI['fail'] = None
        page.click('.sheet-head [data-act=close]')
    check('Geminin virhe (500, 429): vastaus tulee oman laskennan varalta ja syy kerrotaan', t_fallback)

    def t_search():
        page.click('#placeBtn')
        page.fill('#q', 'Rovan')
        expect(page.locator('#results .row-btn').first).to_contain_text('Rovaniemi', timeout=6000)
        page.locator('#results .row-btn').first.click()
        ready(page, 'Rovaniemi')
        expect(page.locator('#placeBtn .pn')).to_have_text('Rovaniemi')
        expect(page.locator('#placeBtn .place-sub')).to_contain_text('Lappi')
        saved = json.loads(page.evaluate("localStorage.getItem('saaaly.place')"))
        assert saved['name'] == 'Rovaniemi' and saved['mode'] == 'manual'
    check('paikkahaku vaihtaa paikkakunnan ja tallentaa sen', t_search)

    def t_locate_btn():
        page.click('[data-act=open-settings]')
        page.click('.quick [data-act=locate]')
        page.keyboard.press('Escape')
        ready(page, 'Turku')
        expect(page.locator('#placeBtn .pin')).to_be_visible()
    check('"Käytä sijaintiani" -painike palaa omaan sijaintiin', t_locate_btn)

    def t_diag():
        open_adv(page)
        page.click('[data-act=diag]')
        expect(page.locator('#diag')).to_contain_text('Valmis.', timeout=20000)
        txt = page.inner_text('#diag')
        for part in ('✓ ECMWF', '✓ DMI', 'Yhdistelmä nyt:', 'Paikkahaku: ✓', 'Oma vastausmoottori: ✓', 'Gemini: ✓', '✓ Tutkaennuste (MET Norway)', '✓ Viralliset varoitukset (Ilmatieteen laitos, GitHub-peilin kautta)'):
            assert part in txt, f'puuttuu: {part}\n{txt[:600]}'
        page.click('.sheet-head [data-act=close]')
    check('diagnostiikka listaa mallit, yhdistelmän, palvelut, oman vastausmoottorin ja Geminin', t_diag)

    def t_clearkey():
        open_adv(page)
        page.click('[data-act=clear-key]')
        expect(page.locator('#aiNote')).to_contain_text('Avain poistettu')
        expect(page.locator('.modebar .seg[data-mode=internal]')).to_have_attribute('aria-pressed', 'true')
        expect(page.locator('.modebar .seg[data-mode=grounded]')).to_have_attribute('aria-disabled', 'true')
        page.click('.sheet-head [data-act=close]')
        n = len(gemini_calls)
        page.click('.ask-btn')
        ask(page, 'Mitä pukisin tänään?')
        expect(page.locator('.msg.bot .src').last).to_have_text(re.compile(r'^Sovelluksen oma laskenta · \d+/8 mallia$'), timeout=8000)
        assert len(gemini_calls) == n, 'avaimen poiston jälkeen kutsuttiin Geminiä'
        page.click('.sheet-head [data-act=close]')
    check('avaimen poisto palauttaa chatin omaan laskentaan', t_clearkey)

    def t_refresh():
        n0 = len(net_log)
        page.click('[data-act=open-settings]')
        page.click('#refreshBtn')
        page.wait_for_timeout(1500)
        assert len([u for u in net_log[n0:] if 'api.open-meteo.com' in u]) >= 7, 'päivitys ei hakenut malleja'
    check('päivityspainike hakee mallit uudelleen', t_refresh)

    def t_noerr():
        assert not page.query_selector('#crash'), 'käynnistysvirhe näkyvissä'
        real = [e for e in page.errors if 'Failed to load resource' not in e]  # selaimen oma verkkokutsuhuomautus (esim. tarkoituksella hylätty FMI-malli)
        assert not real, f'konsolivirheet: {real[:3]}'
    check('ei konsolivirheitä eikä virhepaneelia', t_noerr)

    # Julkaisun tarkistukset: tiedostot, manifest, kuvakkeet ja service worker
    def t_assets():
        bad = [(u, s) for u, s in page.responses if s >= 400]
        assert not bad, f'puuttuvia tiedostoja: {bad[:5]}'
        paths = {urlparse(u).path for u, _ in page.responses}
        for ext in ('.css', '.js'):
            assert any(p.endswith(ext) for p in paths), f'sivu ei ladannut {ext}-tiedostoa: {sorted(paths)}'
    check('kaikki sivun lataamat tiedostot löytyvät (ei 404)', t_assets)

    def t_manifest():
        r = page.evaluate("""async () => {
            const href = document.querySelector('link[rel=manifest]').href;
            const m = await (await fetch(href)).json();
            const icons = [];
            for (const ic of m.icons) {
                const res = await fetch(new URL(ic.src, href));
                const blob = await res.blob();
                let size = null;
                if (ic.type === 'image/png') { const b = await createImageBitmap(blob); size = b.width + 'x' + b.height; }
                icons.push({ src: ic.src, status: res.status, sizes: ic.sizes, size });
            }
            return { icons, start: new URL(m.start_url, href).href, scope: new URL(m.scope, href).href, dir: location.href.replace(/[^/]*$/, '') };
        }""")
        assert len(r['icons']) == 4, f"kuvakkeita {len(r['icons'])}"
        for ic in r['icons']:
            assert ic['status'] == 200, f"kuvake puuttuu: {ic['src']} ({ic['status']})"
            if ic['size']:
                assert ic['size'] == ic['sizes'], f"kuvakkeen koko {ic['size']} ei vastaa ilmoitettua {ic['sizes']}: {ic['src']}"
        assert r['start'] == r['dir'] and r['scope'] == r['dir'], f'start_url tai scope ei osoita sivun kansioon: {r}'
    check('manifest ja kuvakkeet löytyvät ja ovat ilmoitetun kokoisia', t_manifest)

    def t_sw():
        r = page.evaluate("""async () => {
            const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error('service worker ei valmistunut')), 8000))]);
            const names = await caches.keys();
            const urls = names.length ? (await (await caches.open(names[0])).keys()).map((q) => new URL(q.url).pathname) : [];
            return { scope: reg.scope, active: !!reg.active, urls, dir: location.href.replace(/[^/]*$/, '') };
        }""")
        assert r['active'], 'service worker ei aktivoitunut'
        assert r['scope'] == r['dir'], f"service workerin laajuus {r['scope']} ei vastaa sivun kansiota {r['dir']}"
        cached = {u.rsplit('/', 1)[-1] for u in r['urls']}
        for need in ('index.html', 'saaaly.js', 'app.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'):
            assert need in cached, f'kuoresta puuttuu {need}: {sorted(cached)}'
    check('service worker aktivoituu ja kuori tallentuu välimuistiin', t_sw)

    # Uudelleenlataus: tallennettu paikka ja välimuisti näkyvät heti, vaikka verkko ei vastaa
    print('Uudelleenlataus ilman säärajapintaa')
    def t_cache():
        ctx.unroute(DATA_RX)
        ctx.route(re.compile(r'https://api\.open-meteo\.com/'), lambda r: r.abort('failed'))
        page.reload()
        expect(page.locator('.temp')).to_be_visible(timeout=5000)
        expect(page.locator('#placeBtn .pn')).to_have_text('Turku')
        expect(page.locator('#banner')).to_contain_text('Päivitys ei onnistunut', timeout=15000)
    check('välimuistista näytetään ennuste ja ilmoitetaan päivityksen epäonnistumisesta', t_cache)

    def t_offline():
        SERVER['down'] = True  # sivusto ei vastaa lainkaan: kuoren pitää tulla service workerin välimuistista
        try:
            page.reload()
            expect(page.locator('.temp')).to_be_visible(timeout=8000)
            expect(page.locator('#placeBtn .pn')).to_have_text('Turku')
        finally:
            SERVER['down'] = False
    check('ilman verkkoa sovelluksen kuori aukeaa service workerin välimuistista', t_offline)

    def t_offline_notice():
        ctx.set_offline(True)  # laite ilman verkkoa: navigator.onLine on false
        try:
            page.reload()
            expect(page.locator('.temp')).to_be_visible(timeout=8000)
            banner = page.locator('#banner')
            expect(banner).to_contain_text('Ei verkkoyhteyttä', timeout=15000)
            expect(banner).to_contain_text(re.compile(r'Näytetään ennuste klo \d{1,2}\.\d\d'))
            assert banner.get_attribute('role') == 'status', 'ilmoitus ei ole ruudunlukijan tilaviesti'
        finally:
            ctx.set_offline(False)
    check('ilman verkkoa ilmoitus kertoo, minkä kellonajan ennuste näkyy', t_offline_notice)

    def t_shortcut():
        page.goto(BASE + '?avaa=kysy')
        expect(page.locator('#sheetPanel[data-kind=chat]')).to_be_visible(timeout=8000)
        assert 'avaa=' not in page.url, f'pikakuvakkeen kyselyosa jäi osoitteeseen: {page.url}'
        page.keyboard.press('Escape')
        page.goto(BASE + '?avaa=viikko')
        page.wait_for_function("() => window.__saaaly.state.page === 2", timeout=8000)
    check('aloitusnäytön pikakuvake avaa chatin tai Viikko-sivun', t_shortcut)
    ctx.close()

    print('Ensimmäinen käynnistys ilman sijaintilupaa')
    ctx2, page2 = new_page(browser, geo=False)
    def t_denied():
        page2.goto(BASE)
        expect(page2.locator('#banner')).to_contain_text('Sijaintilupa', timeout=8000)
        expect(page2.locator('#placeBtn .pn')).to_have_text('Helsinki')
        expect(page2.locator('.temp')).to_be_visible(timeout=15000)
    check('sijaintiluvan puuttuessa näytetään Helsinki ja ohje', t_denied)
    ctx2.close()

    print('Kaikki mallit kaatuvat')
    ctx3, page3 = new_page(browser, geo=False)
    def t_alldown():
        ctx3.unroute(re.compile(r'https://(api\.open-meteo\.com|geocoding-api\.open-meteo\.com|api\.bigdatacloud\.net)/'))
        ctx3.route(re.compile(r'https://api\.open-meteo\.com/'), lambda r: r.fulfill(status=503, headers=CORS, body='{"error":true,"reason":"Palvelu poissa"}'))
        page3.goto(BASE)
        expect(page3.locator('.problem')).to_contain_text('Yksikään säämalli ei vastannut', timeout=15000)
        expect(page3.locator('.problem')).to_contain_text('Palvelu poissa')
        page3.click('.problem [data-act=open-diag]')
        expect(page3.locator('#diag')).to_contain_text('✗ ECMWF', timeout=15000)
    check('virhetila kertoo syyn ja avaa diagnostiikan', t_alldown)
    ctx3.close()

    print('Kestävyys')
    GARBAGE = {'recent': '{"a":1}', 'place': '[1,2]', 'cache': '"x"', 'sens': '"x"', 'refreshMin': '{}', 'geminiKey': '{"a":1}', 'geminiModel': '[]', 'aiMode': '[]', 'anim': '"x"', 'resolved': '1', 'dead': '[]', 'schema': '"x"'}
    ctx4, page4 = new_page(browser)
    def t_garbage():
        ctx4.add_init_script('(() => { const g = %s; for (const k in g) localStorage.setItem("saaaly." + k, g[k]); })()' % json.dumps(GARBAGE))
        page4.goto(BASE)
        ready(page4)
        assert not page4.query_selector('#crash'), 'rikkinäinen tallennus kaatoi käynnistyksen: ' + (page4.text_content('#crash') or '')
        expect(page4.locator('.temp')).to_be_visible()
        assert not [e for e in page4.errors if 'Failed to load resource' not in e], page4.errors[:3]
    check('rikkinäinen tallennettu tieto ei kaada sovellusta', t_garbage)
    ctx4.close()

    ctx5, page5 = new_page(browser)
    page5.goto(BASE)
    ready(page5)
    def t_update():
        page5.route('**/version.json', lambda r: r.fulfill(status=200, headers={**CORS, 'cache-control': 'no-store'}, body='{"version":"9.9.9","build":"ffffffffff"}'))
        assert page5.evaluate('window.__saaaly.BUILD') != 'ffffffffff'
        page5.evaluate('window.__saaaly.checkForUpdate({ force: true })')
        expect(page5.locator('#update')).to_contain_text('Uusi versio', timeout=5000)
        expect(page5.locator('#update button')).to_have_text('Päivitä')
        # sama tunnus ei näytä ilmoitusta
        page5.unroute('**/version.json')
        build = page5.evaluate('window.__saaaly.BUILD')
        page5.route('**/version.json', lambda r: r.fulfill(status=200, headers=CORS, body=json.dumps({'version': '0.3.1', 'build': build})))
        page5.evaluate("document.querySelector('#update').hidden = true")
        page5.evaluate('window.__saaaly.checkForUpdate({ force: true })')
        page5.wait_for_timeout(400)
        assert page5.locator('#update').is_hidden(), 'ilmoitus näkyy, vaikka versio on sama'
    check('uusi versio -ilmoitus näkyy vain, kun version.json poikkeaa omasta tunnuksesta', t_update)

    def t_anim():
        page5.click('[data-act=open-settings]')
        expect(page5.locator('#anim')).to_have_value('on')
        page5.select_option('#anim', 'off')
        assert page5.evaluate("localStorage.getItem('saaaly.anim')") == 'false'
        page5.click('.sheet-head [data-act=close]')
        page5.reload()
        ready(page5)
        page5.click('[data-act=open-settings]')
        expect(page5.locator('#anim')).to_have_value('off')
        page5.select_option('#anim', 'on')
        page5.click('.sheet-head [data-act=close]')
    check('animaatiokytkin tallentuu ja säilyy uudelleenlatauksessa', t_anim)

    def t_crash_reset():
        page5.evaluate("localStorage.setItem('saaaly.recent', '[]'); localStorage.setItem('saaaly.geminiKey', 'avain-123')")
        page5.evaluate("void Promise.reject(new Error('testivirhe'))")  # käsittelemätön lupaus -> crash.js näyttää virheen (Playwrightin kello nielisi setTimeout-poikkeuksen)
        expect(page5.locator('#crash')).to_be_visible(timeout=3000)
        expect(page5.locator('#crash')).to_contain_text('testivirhe')
        page5.click('#crash button:has-text("Tyhjennä")')
        page5.wait_for_load_state('load')
        ready(page5)
        assert page5.evaluate("localStorage.getItem('saaaly.recent')") is None, 'tallennus ei tyhjentynyt'
        assert page5.evaluate("localStorage.getItem('saaaly.geminiKey')") == 'avain-123', 'Gemini-avain ei saa kadota'
        page5.evaluate("localStorage.removeItem('saaaly.geminiKey')")
    check('virhenäytön "Tyhjennä tallennetut tiedot" korjaa tilan ja säilyttää Gemini-avaimen', t_crash_reset)
    ctx5.close()

    print('Valinnaiset lähteet')
    ctx6, page6 = new_page(browser)
    met_calls = []
    ctx6.route(re.compile(r'https://api\.met\.no/'), lambda r: (met_calls.append(r.request.url), r.abort('failed')))  # myöhemmin lisätty reitti ohittaa install()-reitin
    def t_src_blocked():
        page6.goto(BASE)
        ready(page6)
        expect(page6.locator('.temp')).to_be_visible()
        page6.wait_for_timeout(1500)  # tutkahaku ehtii epäonnistua
        assert len(met_calls) == 1, f'tutkaennustetta haettiin {len(met_calls)} kertaa'
        assert page6.evaluate('window.__saaaly.state.nowcast') is None
        assert page6.locator('#banner').is_hidden(), 'lähteen epäonnistuminen ei saa näkyä ilmoituksena'
        assert page6.locator('#hourly .radar').count() == 0
        src = json.loads(page6.evaluate("localStorage.getItem('saaaly.src')"))
        assert src['nowcast']['fails'] == 1 and src['nowcast']['until'] > NOW_MS, src
        page6.reload()
        ready(page6)
        page6.wait_for_timeout(1500)
        assert len(met_calls) == 1, 'epäonnistunutta lähdettä kokeiltiin heti uudelleen (odotusaika ei toimi)'
        assert not [e for e in page6.errors if 'Failed to load resource' not in e and 'met.no' not in e], page6.errors[:3]
    check('estetty tutkalähde ei näy käyttäjälle eikä sitä kokeilla heti uudelleen', t_src_blocked)

    def t_src_diag():
        open_adv(page6)
        page6.click('[data-act=diag]')
        expect(page6.locator('#diag')).to_contain_text('Valmis.', timeout=20000)
        expect(page6.locator('#diag')).to_contain_text('Valinnaiset lähteet')
        expect(page6.locator('#diag')).to_contain_text('✗ Tutkaennuste', timeout=20000)
        expect(page6.locator('#diag')).to_contain_text('palveluun ei saatu yhteyttä')  # sekä CORS- että no-cors-haku hylättiin: ei palvelua
    check('diagnostiikka kertoo estetyn lähteen syyn', t_src_diag)
    ctx6.close()

    # Virheellinen peili: lähde vastaa, mutta sisältö ei kelpaa. Käyttäjälle ei näy mitään, diagnostiikka kertoo syyn.
    ctx8, page8 = new_page(browser)
    ctx8.route(re.compile(r'https://raw\.githubusercontent\.com/'), lambda r: r.fulfill(status=200, headers=CORS, body='{"v":1}'))
    def t_bad_mirror():
        page8.goto(BASE)
        ready(page8)
        expect(page8.locator('.temp')).to_be_visible()
        assert page8.locator('#banner').is_hidden(), 'virheellinen peili ei saa näkyä käyttäjälle ilmoituksena'
        assert page8.locator('#alerts .alert.off').count() == 0
        open_adv(page8)
        page8.click('[data-act=diag]')
        expect(page8.locator('#diag')).to_contain_text('Valmis.', timeout=20000)
        expect(page8.locator('#diag')).to_contain_text('✗ Viralliset varoitukset: Varoitukset: peilin muoto ei täsmää')
    check('virheellinen varoituspeili ei näy käyttäjälle, diagnostiikka kertoo syyn', t_bad_mirror)

    def t_explain_csp():
        # osoite, jota tietoturvapolitiikka (CSP) ei salli: selain esti haun ennen verkkoa
        msg = page8.evaluate("window.__saaaly.explainFetchError(new TypeError('Failed to fetch'), 'https://example.org/ei-sallittu')")
        assert 'tietoturvapolitiikka' in msg and 'connect-src' in msg, msg
        assert page8.evaluate("window.__saaaly.explainFetchError(new Error('oma virhe'), 'https://x.example/')") == 'oma virhe'
    check('virheen selitys tunnistaa tietoturvapolitiikan (CSP) eston', t_explain_csp)
    ctx8.close()

    # CORS-esto oikealla toisella alkuperällä: palvelin vastaa mutta ei lähetä Access-Control-Allow-Origin-otsikkoa (kuten Ilmatieteen laitoksen syöte).
    # Playwrightin route.fulfill ei valvo CORSia, joten tarvitaan oikea toinen palvelin; CSP ohitetaan, ettei se peitä CORS-tilannetta.
    class NoCors(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def do_GET(self):
            self.send_response(200); self.send_header('content-type', 'text/plain'); self.end_headers(); self.wfile.write(b'ok')
    other = http.server.ThreadingHTTPServer(('127.0.0.1', 0), NoCors)
    threading.Thread(target=other.serve_forever, daemon=True).start()
    import socket
    sock = socket.socket(); sock.bind(('127.0.0.1', 0)); dead_port = sock.getsockname()[1]; sock.close()  # portti, jossa ei kuuntele kukaan
    ctx9 = browser.new_context(bypass_csp=True, viewport={'width': 412, 'height': 915}, locale='fi-FI', timezone_id='Europe/Helsinki')
    install(ctx9)
    page9 = ctx9.new_page()
    def t_explain_cors():
        page9.goto(BASE)
        page9.wait_for_function("() => window.__saaaly && window.__saaaly.explainFetchError")
        cors = page9.evaluate(f"window.__saaaly.explainFetchError(new TypeError('Failed to fetch'), 'http://127.0.0.1:{other.server_address[1]}/x')")
        assert 'CORS' in cors and 'palvelu vastaa' in cors, cors
        down = page9.evaluate(f"window.__saaaly.explainFetchError(new TypeError('Failed to fetch'), 'http://127.0.0.1:{dead_port}/x')")
        assert 'palveluun ei saatu yhteyttä' in down, down
    check('virheen selitys erottaa CORS-eston (palvelin vastaa) ja puuttuvan yhteyden', t_explain_cors)
    ctx9.close()
    other.shutdown()

    ctx7, page7 = new_page(browser)
    ctx7.route(re.compile(r'https://raw\.githubusercontent\.com/'), lambda r: r.fulfill(status=200, headers=CORS, body=mock_data(r.request.url, 'thunder')['body']))
    def t_official():
        page7.goto(BASE)
        ready(page7)
        row = page7.locator('#alerts .alert.off')
        expect(row).to_have_count(1, timeout=8000)
        expect(row).to_contain_text('Ukkosvaroitus')
        expect(row).to_contain_text('Oranssi varoitus')
        expect(row).to_contain_text('Ilmatieteen laitos')
        row.locator('summary').click()
        expect(row).to_contain_text('Voimakkaita ukkoskuuroja')
        assert page7.locator('#alerts .alert').count() <= 3, 'huomiokaistalla on liikaa rivejä'
    check('virallinen varoitus näkyy yläkaistalla Ilmatieteen laitoksen merkinnällä', t_official)
    ctx7.close()
    browser.close()

print(f'\n{len(passed)} läpi, {len(failed)} epäonnistui')
for n, e in failed:
    print(' -', n)
sys.exit(1 if failed else 0)

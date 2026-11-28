"""Ottaa kuvakaappauksen sovelluksesta (esimerkkitilassa) ja listaa konsolivirheet.
Käyttö: python3 tools/shot.py ulos.png "?demo=rain&at=2026-10-14T20:04:00%2B03:00" [--w 412] [--h 915] [--scroll 760] [--wait 1800] [--click SELECTOR]"""
import argparse, json, os
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('out')
ap.add_argument('query')
ap.add_argument('--w', type=int, default=412)
ap.add_argument('--h', type=int, default=915)
ap.add_argument('--scroll', type=int, default=0)
ap.add_argument('--wait', type=int, default=1800)
ap.add_argument('--click', action='append', default=[])
a = ap.parse_args()

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('PW_CHROMIUM') or None)  # PW_CHROMIUM: valmiiksi asennettu selain
    ctx = b.new_context(viewport={'width': a.w, 'height': a.h}, device_scale_factor=1.5, is_mobile=True, has_touch=True, locale='fi-FI', timezone_id='Europe/Helsinki')
    page = ctx.new_page()
    logs = []
    page.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    page.goto('http://127.0.0.1:8765/index.html' + a.query)
    page.wait_for_timeout(a.wait)
    for sel in a.click:
        page.click(sel)
        page.wait_for_timeout(700)
    if a.scroll:
        page.evaluate('y => window.scrollTo(0, y)', a.scroll)
        page.wait_for_timeout(600)
    page.screenshot(path=a.out)
    info = page.evaluate("({sw: document.documentElement.scrollWidth, iw: innerWidth, crash: !!document.querySelector('#crash')})")
    print(json.dumps(info), *logs, sep='\n')
    b.close()

"""Ottaa useita tiloja yhteen kuvaan (tarkistukseen). Käyttö: python3 tools/contact.py ulos.png nimi=kysely ..."""
import sys, io
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw

out = sys.argv[1]
states = [a.split('=', 1) for a in sys.argv[2:]]
shots = []
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 412, 'height': 760}, device_scale_factor=1, is_mobile=True, has_touch=True, locale='fi-FI', timezone_id='Europe/Helsinki')
    for name, q in states:
        page = ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        q, _, clicks = q.partition('|')
        page.goto('http://127.0.0.1:8765/index.html' + q)
        page.wait_for_timeout(2600)
        for sel in [c for c in clicks.split(',') if c]:
            page.click(sel)
            page.wait_for_timeout(800)
        img = Image.open(io.BytesIO(page.screenshot())).convert('RGB')
        d = ImageDraw.Draw(img)
        d.rectangle([0, img.height - 24, img.width, img.height], fill=(0, 0, 0))
        d.text((6, img.height - 18), name + (' ERR ' + errs[0][:40] if errs else ''), fill=(255, 255, 255))
        shots.append(img)
        page.close()
    b.close()
W = sum(i.width for i in shots) + 6 * (len(shots) - 1)
sheet = Image.new('RGB', (W, shots[0].height), (30, 30, 30))
x = 0
for i in shots:
    sheet.paste(i, (x, 0))
    x += i.width + 6
sheet.save(out)
print('ok', sheet.size)

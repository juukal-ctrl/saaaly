"""Piirtää sovelluskuvakkeet (PNG) icons/icon.svg-tiedostosta Chromiumilla.
Käyttö: python3 tools/make-icons.py"""
import pathlib, re
from playwright.sync_api import sync_playwright

root = pathlib.Path(__file__).resolve().parent.parent
svg = (root / 'icons' / 'icon.svg').read_text()

# Maskable-versio: täysi tausta ilman pyöristystä, sisältö pienennetty turva-alueelle (noin 78 %).
inner = re.search(r'<rect width="512" height="512" rx="112" fill="url\(#sky\)"/>(.*)</svg>', svg, re.S).group(1)
defs = re.search(r'(<defs>.*?</defs>)', svg, re.S).group(1)
mask = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">{defs}
<rect width="512" height="512" fill="url(#sky)"/><g transform="translate(256 256) scale(0.78) translate(-256 -256)">{inner}</g></svg>'''

def render(p, markup, size):
    html = f'<html><body style="margin:0;background:transparent"><div style="width:{size}px;height:{size}px">{markup}</div></body></html>'
    html = html.replace('<svg ', f'<svg width="{size}" height="{size}" ', 1)
    p.set_viewport_size({'width': size, 'height': size})
    p.set_content(html)
    return p.screenshot(omit_background=True, clip={'x': 0, 'y': 0, 'width': size, 'height': size})

with sync_playwright() as pw:
    b = pw.chromium.launch()
    page = b.new_page()
    for name, markup, size in [('icon-192.png', svg, 192), ('icon-512.png', svg, 512), ('icon-maskable-512.png', mask, 512)]:
        (root / 'icons' / name).write_bytes(render(page, markup, size))
        print('kirjoitettu', name)
    b.close()

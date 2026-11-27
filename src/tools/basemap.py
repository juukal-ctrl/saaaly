"""Natural Earth -> SääÄlyn pohjakartta (maps/map-nordic.json ja maps/map-europe.json). Natural Earth on julkista aineistoa (public domain).

Käyttö: hae Natural Earthin geojson-tiedostot (git clone --depth 1 --filter=blob:none --sparse https://github.com/nvkelso/natural-earth-vector
ja git sparse-checkout set --no-cone /geojson/ne_10m_land.geojson ...), aseta NE-polku alla ja aja python3 tools/basemap.py.
Pohjoismaat (10m, tarkka) ja muu Eurooppa (50m, karkea) leikataan laatikoihin, yksinkertaistetaan ja pakataan kokonaisluvuiksi (delta).
"""
import json, math, os
NE = os.environ.get('NE_DIR', '/home/claude/nvkelso/natural-earth-vector/geojson/')

def rings_of(geom):
    t = geom['type']; c = geom['coordinates']
    if t == 'Polygon': return [c[0]] + c[1:]
    if t == 'MultiPolygon': return [r for poly in c for r in poly]
    return []

def lines_of(geom):
    t = geom['type']; c = geom['coordinates']
    if t == 'LineString': return [c]
    if t == 'MultiLineString': return c
    return []

def clip_ring(ring, box):
    w, s, e, n = box
    def clip(pts, inside, inter):
        out = []
        if not pts: return out
        prev = pts[-1]
        for cur in pts:
            if inside(cur):
                if not inside(prev): out.append(inter(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(inter(prev, cur))
            prev = cur
        return out
    def ix(x0):
        return lambda a, b: [x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0])]
    def iy(y0):
        return lambda a, b: [a[0] + (b[0] - a[0]) * (y0 - a[1]) / (b[1] - a[1]), y0]
    pts = ring[:-1] if ring and ring[0] == ring[-1] else ring
    pts = clip(pts, lambda p: p[0] >= w, ix(w))
    pts = clip(pts, lambda p: p[0] <= e, ix(e))
    pts = clip(pts, lambda p: p[1] >= s, iy(s))
    pts = clip(pts, lambda p: p[1] <= n, iy(n))
    return pts

def clip_line(line, box):
    w, s, e, n = box
    inside = lambda p: w <= p[0] <= e and s <= p[1] <= n
    out, cur = [], []
    for p in line:
        if inside(p): cur.append(p)
        else:
            if len(cur) > 1: out.append(cur)
            cur = []
    if len(cur) > 1: out.append(cur)
    return out

def dp(pts, tol):
    """Douglas-Peucker; etäisyys km-tasossa (lon * cos(lat))."""
    if len(pts) < 3: return pts
    k = math.cos(math.radians(sum(p[1] for p in pts) / len(pts)))
    P = [(p[0] * k, p[1]) for p in pts]
    keep = [False] * len(P); keep[0] = keep[-1] = True
    stack = [(0, len(P) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = P[a]; bx, by = P[b]
        dx, dy = bx - ax, by - ay; L = math.hypot(dx, dy) or 1e-12
        best, bi = -1, -1
        for i in range(a + 1, b):
            x, y = P[i]
            d = abs(dy * (x - ax) - dx * (y - ay)) / L if L > 1e-12 else math.hypot(x - ax, y - ay)
            if d > best: best, bi = d, i
        if best > tol:
            keep[bi] = True; stack += [(a, bi), (bi, b)]
    return [p for p, kf in zip(pts, keep) if kf]

def area_km2(r):
    k = math.cos(math.radians(sum(p[1] for p in r) / len(r)))
    a = 0
    for i in range(len(r)):
        x0, y0 = r[i - 1]; x1, y1 = r[i]
        a += (x0 * k * 111.32) * (y1 * 110.57) - (x1 * k * 111.32) * (y0 * 110.57)
    return abs(a) / 2

def enc(pts, q):
    out, px, py = [], 0, 0
    for x, y in pts:
        ix, iy = round(x * q), round(y * q)
        out += [ix - px, iy - py]; px, py = ix, iy
    return out

def build(src, box, tol, minA, q, layers):
    res = {'v': 1, 'box': box, 'q': q}
    stats = {}
    for name, fn, kind in layers:
        gj = json.load(open(NE + fn))
        items = []
        for f in gj['features']:
            g = f['geometry']
            if not g: continue
            if kind == 'poly':
                for r in rings_of(g):
                    xs = [p[0] for p in r]; ys = [p[1] for p in r]
                    if max(xs) < box[0] or min(xs) > box[2] or max(ys) < box[1] or min(ys) > box[3]: continue
                    c = clip_ring(r, box)
                    if len(c) < 3: continue
                    c = dp(c + [c[0]], tol)[:-1] if len(c) > 3 else c
                    if len(c) < 3 or area_km2(c) < minA: continue
                    e = enc(c, q)
                    if len(e) >= 6: items.append(e)
            else:
                for ln in lines_of(g):
                    for part in clip_line(ln, box):
                        part = dp(part, tol)
                        if len(part) > 1: items.append(enc(part, q))
        res[name] = items
        stats[name] = (len(items), sum(len(i) for i in items) // 2)
    return res, stats

if __name__ == '__main__':
    nordic, st1 = build('10m', [4.0, 53.0, 45.0, 72.5], 0.0025, 0.6, 1000, [
        ('land', 'ne_10m_land.geojson', 'poly'),
        ('isle', 'ne_10m_minor_islands.geojson', 'poly'),
        ('lake', 'ne_10m_lakes.geojson', 'poly'),
        ('border', 'ne_10m_admin_0_boundary_lines_land.geojson', 'line'),
    ])
    europe, st2 = build('50m', [-32.0, 26.0, 50.0, 72.5], 0.02, 15, 100, [
        ('land', 'ne_50m_land.geojson', 'poly'),
        ('lake', 'ne_50m_lakes.geojson', 'poly'),
        ('border', 'ne_50m_admin_0_boundary_lines_land.geojson', 'line'),
    ])
    for nm, data, st in (('map-nordic', nordic, st1), ('map-europe', europe, st2)):
        s = json.dumps(data, separators=(',', ':'))
        open(f'maps/{nm}.json', 'w').write(s)
        print(nm, len(s) // 1024, 'kt', st)

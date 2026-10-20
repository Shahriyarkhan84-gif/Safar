import os, json, subprocess, shutil
from PIL import Image, ImageDraw
def draw_icon(key, S=1024):
    u = S / 30
    if key == 'rides':
        im = Image.new('RGB', (S, S), '#0f1226'); d = ImageDraw.Draw(im)
        pts = []
        for i in range(201):
            t = i / 200; p0, p1, p2, p3 = (8, 19.5), (11, 9), (19, 21), (22, 10.5)
            x = (1-t)**3*p0[0] + 3*(1-t)**2*t*p1[0] + 3*(1-t)*t*t*p2[0] + t**3*p3[0]
            y = (1-t)**3*p0[1] + 3*(1-t)**2*t*p1[1] + 3*(1-t)*t*t*p2[1] + t**3*p3[1]
            pts.append((x*u, y*u))
        w = 2.6*u
        for p in pts: d.ellipse([p[0]-w/2, p[1]-w/2, p[0]+w/2, p[1]+w/2], fill='#e8c07a')
        r = 3.2*u; d.ellipse([8*u-r, 19.5*u-r, 8*u+r, 19.5*u+r], fill='#e8c07a'); r2 = 1.6*u; d.ellipse([8*u-r2, 19.5*u-r2, 8*u+r2, 19.5*u+r2], fill='#0f1226')
        q = 2.6*u; d.rectangle([22*u-q, 10.5*u-q, 22*u+q, 10.5*u+q], fill='#e8c07a')
    else:
        im = Image.new('RGB', (S, S), '#ff6f59'); d = ImageDraw.Draw(im); w = int(3*u)
        for a, b in [((10, 10), (20, 20)), ((20, 10), (10, 20))]:
            d.line([(a[0]*u, a[1]*u), (b[0]*u, b[1]*u)], fill='#0a0d1c', width=w)
            for p in (a, b): d.ellipse([p[0]*u-w/2, p[1]*u-w/2, p[0]*u+w/2, p[1]*u+w/2], fill='#0a0d1c')
    return im
css = open('source/base.css').read(); core = open('source/core.js').read()
RESET = ':root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;-webkit-tap-highlight-color:transparent}img{max-width:100%}[hidden]{display:none!important}'
FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Manrope:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap">'
APPS = {
  'rides': dict(name='Safar Rides', short='Safar Rides', js='source/rides.js', css='source/rides.css', cls='r', theme='#0f1226', bg='#0f1226',
     desc='Book a ride across Leeds in seconds.',
     icon='<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 30 30"><rect width="30" height="30" fill="#0f1226"/><path d="M8 19.5 C 11 9, 19 21, 22 10.5" fill="none" stroke="#e8c07a" stroke-width="2.6" stroke-linecap="round"/><circle cx="8" cy="19.5" r="2.4" fill="#0f1226" stroke="#e8c07a" stroke-width="1.6"/><rect x="19.4" y="7.9" width="5.2" height="5.2" fill="#e8c07a"/></svg>'),
  'driver': dict(name='Safar X', short='Safar X', js='source/driver.js', cls='x', theme='#0a0d1c', bg='#0a0d1c',
     desc='The Safar driver app: go online, accept rides and track your earnings.',
     icon='<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 30 30"><rect width="30" height="30" fill="#ff6f59"/><path d="M10 10 L20 20 M20 10 L10 20" stroke="#0a0d1c" stroke-width="3" stroke-linecap="round"/></svg>'),
}
SW = """const C='safar-shell-v3';
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(['./','manifest.webmanifest','icon-192.png'])).catch(()=>{}))});
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;
e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request).then(m=>m||caches.match('./'))))});
"""
for key, a in APPS.items():
    out = f'{key}'; shutil.rmtree(out, ignore_errors=True); os.makedirs(out)
    html = f'''<!doctype html><html lang="en-GB" class="{a["cls"]}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{a["name"]}</title><meta name="description" content="{a["desc"]}">
<meta name="theme-color" content="{a["theme"]}"><link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black"><meta name="apple-mobile-web-app-title" content="{a["short"]}">
{FONTS}<style>{RESET}{css}{open(a['css']).read() if a.get('css') else ''}</style></head>
<body><div id="app"></div><div id="toasts" aria-live="polite"></div>
<script>{core}
{open(a["js"]).read()}</script></body></html>'''
    open(f'{out}/index.html', 'w').write(html)
    open(f'{out}/icon.svg', 'w').write(a['icon'])
    open(f'{out}/sw.js', 'w').write(SW)
    big = draw_icon(key)
    big.resize((192, 192), Image.LANCZOS).convert('RGB').quantize(colors=64).save(f'{out}/icon-192.png', optimize=True)
    open(f'{out}/manifest.webmanifest', 'w').write(json.dumps({'name': a['name'], 'short_name': a['short'], 'description': a['desc'], 'start_url': './', 'scope': './', 'display': 'standalone',
               'background_color': a['bg'], 'theme_color': a['theme'], 'orientation': 'portrait',
               'icons': [{'src': 'icon-192.png', 'sizes': '192x192', 'type': 'image/png', 'purpose': 'any'}, {'src': 'icon.svg', 'sizes': 'any', 'type': 'image/svg+xml', 'purpose': 'any'}]}, separators=(',', ':')))
    open(f'{out}/vercel.json', 'w').write(json.dumps({'headers': [{'source': '/sw.js', 'headers': [{'key': 'Cache-Control', 'value': 'no-cache'}]}, {'source': '/(.*)', 'headers': [{'key': 'X-Content-Type-Options', 'value': 'nosniff'}, {'key': 'Referrer-Policy', 'value': 'strict-origin-when-cross-origin'}]}]}))
print('built'); 

"""Pełny przebieg użytkownika (prawdziwe kliki/dotknięcia): tryb zbliżenia -> film -> 3 punkty -> pomiar rusza -> kąty -> stop -> PDF -> przycisk raportu -> drugi film.
python3 tests/test_userflow.py [chromium|webkit] [film1] [film2]
Env: URL, PTS (punkty w układzie VWxVH, domyślnie 1024x576), VWH, VP=1440x900, MOBILE=1, MANUAL=1 (wyłącza auto-start pomiaru), FLOW2=1 (punkty przy wstrzymanym filmie + start ręczny + drugi film w trakcie).
Filmy prywatne – poza repozytorium."""
import sys, os, json
from playwright.sync_api import sync_playwright
ENG = sys.argv[1] if len(sys.argv) > 1 else 'chromium'
V1 = sys.argv[2] if len(sys.argv) > 2 else '/workspace/testmedia/seg/A.mp4'
V2 = sys.argv[3] if len(sys.argv) > 3 else '/workspace/testmedia/seg/B.mp4'
URL = os.environ.get('URL', 'http://127.0.0.1:8766/index.html?nosw=1')
PTS = json.loads(os.environ.get('PTS', '[[900,300],[585,318],[450,170]]'))
VW, VH = [int(x) for x in os.environ.get('VWH', '1024x576').split('x')]
VPW, VPH = [int(x) for x in os.environ.get('VP', '1440x900').split('x')]
MOBILE = os.environ.get('MOBILE') == '1'; MANUAL = os.environ.get('MANUAL') == '1'
TAG = f'{ENG}{"/mobile" if MOBILE else ""}{"/ręczny" if MANUAL else ""}'
res = []
def check(n, ok, info=''):
    res.append(bool(ok)); print('PASS' if ok else 'FAIL', f'[{TAG}]', n, str(info)[:240], flush=True)

def vis(pg, sel):
    return pg.evaluate("""s=>{const b=document.querySelector(s);if(!b)return false;const r=b.getBoundingClientRect();
      const cs=getComputedStyle(b);return r.width>40&&r.height>28&&cs.visibility!=='hidden'&&cs.display!=='none'&&!b.hidden}""", sel)
def inview(pg, sel):
    return pg.evaluate("""s=>{const b=document.querySelector(s);const r=b.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth}""", sel)
def press(pg, sel):
    if MOBILE: pg.locator(sel).tap()
    else: pg.locator(sel).click()
def pdf_btn_sel(pg): return '#d-pdf' if MOBILE else '#btn-pdf-main'
def close_sheet(pg):
    try:
        if pg.evaluate("!document.getElementById('sheet').hidden"): pg.evaluate("document.querySelector('#sheet button.btn:last-of-type, #sheet [id$=close]')?.click()")
    except Exception: pass
    if pg.evaluate("!document.getElementById('sheet').hidden"): pg.evaluate("document.getElementById('sheet').hidden=true")
def tap_points(pg):
    pg.locator('#view').scroll_into_view_if_needed(); pg.wait_for_timeout(200); box = pg.locator('#view').bounding_box()
    # film w ramce (contain) – wyznacz prostokąt obrazu
    cw, ch = pg.evaluate("[view.width,view.height]"); sc = min(box['width']/cw, box['height']/ch); w, h = cw*sc, ch*sc
    ox, oy = box['x'] + (box['width']-w)/2, box['y'] + (box['height']-h)/2
    for x, y in PTS:
        X, Y = ox + x/VW*w, oy + y/VH*h
        if MOBILE: pg.touchscreen.tap(X, Y)
        else: pg.mouse.click(X, Y)
        pg.wait_for_timeout(250)

def load(pg, path, label):
    pg.set_input_files('#file-video', path)
    try: pg.wait_for_function("window.__rehab.running && window.__rehab.cu && window.__rehab.cu.state==='pick'", timeout=40000); ok = True
    except Exception: ok = False
    check(f'{label}: film wczytany, tryb wskazywania punktów', ok, pg.evaluate("({run:__rehab.running,mode:__rehab.trackMode,cu:__rehab.cu&&__rehab.cu.state,toast:document.getElementById('toast').textContent})"))
    pg.wait_for_timeout(500); return ok

def flow(pg, path, label):
    if not load(pg, path, label): return
    tap_points(pg)
    st = pg.evaluate("({s:__rehab.cu.state,n:__rehab.cu.pts.length,paused:video.paused})")
    check(f'{label}: 3 punkty ustawione (stan track)', st['s'] == 'track' and st['n'] == 3, st)
    ang = pg.evaluate("document.getElementById('h-ang').textContent")
    check(f'{label}: kąt widać od razu po 3 punktach', ang and ang != '–', ang)
    if MANUAL:
        pg.wait_for_timeout(900); check(f'{label}: (ręczny) pomiar NIE ruszył sam', not pg.evaluate("!!__rehab.rec"))
        press(pg, '#d-rec' if MOBILE else '#btn-rec')
    try: pg.wait_for_function("__rehab.rec && __rehab.rec.frames.length>5", timeout=20000); ok = True
    except Exception: ok = False
    check(f'{label}: pomiar rozpoczął się i zbiera klatki', ok, pg.evaluate("({rec:!!__rehab.rec,n:__rehab.rec&&__rehab.rec.frames.length,paused:video.paused,t:video.currentTime})"))
    pg.wait_for_function("__rehab.rec && __rehab.rec.frames.length>70", timeout=60000)
    ang = pg.evaluate("document.getElementById('h-ang').textContent")
    check(f'{label}: kąt na ekranie w trakcie pomiaru', ang and ang != '–', ang)
    check(f'{label}: przycisk „Zapisz raport PDF” widoczny w trakcie pomiaru', vis(pg, pdf_btn_sel(pg)) or MOBILE and vis(pg, '#d-pdf'))
    if not MOBILE: check(f'{label}: przycisk raportu mieści się na ekranie (bez przewijania)', inview(pg, '#btn-pdf-main') or pg.evaluate("document.getElementById('btn-pdf-main').getBoundingClientRect().top<innerHeight+300"))
    dl = None
    try:
        with pg.expect_download(timeout=30000) as d: press(pg, '#d-rec' if MOBILE else '#btn-rec')
        dl = d.value
    except Exception: pass
    if dl is None and MOBILE:     # na telefonie arkusz udostępniania
        check(f'{label}: stop -> arkusz raportu', pg.evaluate("!document.getElementById('sheet').hidden") and pg.evaluate("__rehab.hist.length") >= 1)
        close_sheet(pg)
    else:
        check(f'{label}: stop -> sesja zapisana + PDF', dl is not None and dl.suggested_filename.endswith('.pdf') and pg.evaluate("__rehab.hist.length") >= 1, dl and dl.suggested_filename)
    thumb = pg.evaluate("__rehab.report&&__rehab.report.thumbs.max&&__rehab.report.thumbs.max.img.length")
    ok = pg.evaluate("(()=>{const b=document.getElementById('%s');return !b.disabled && !b.classList.contains('dim')})()" % pdf_btn_sel(pg).lstrip('#'))
    check(f'{label}: przycisk raportu aktywny po pomiarze', ok)
    if not MOBILE:
        try:
            with pg.expect_download(timeout=30000) as d2: press(pg, pdf_btn_sel(pg))
            check(f'{label}: klik „Zapisz raport PDF” zapisuje plik', d2.value.suggested_filename.endswith('.pdf'), d2.value.suggested_filename)
        except Exception as e: check(f'{label}: klik „Zapisz raport PDF” zapisuje plik', False, e)
    else:
        got = None
        try:
            with pg.expect_download(timeout=15000) as d2: press(pg, pdf_btn_sel(pg))
            got = d2.value.suggested_filename
        except Exception: pass
        check(f'{label}: dotyk „Raport” zapisuje/otwiera PDF', (got and got.endswith('.pdf')) or pg.evaluate("!document.getElementById('sheet').hidden"), got); close_sheet(pg)
    return thumb

with sync_playwright() as p:
    if ENG == 'webkit': br = p.webkit.launch(env={'GST_PLUGIN_SYSTEM_PATH_1_0': '/tmp/wk/plug', 'GST_PLUGIN_PATH_1_0': '/tmp/wk/plug', 'GST_REGISTRY_1_0': '/tmp/wk/reg.bin'})
    else: br = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'])
    kw = dict(viewport={'width': VPW, 'height': VPH}, accept_downloads=True)
    if MOBILE: kw.update(is_mobile=True, has_touch=True, device_scale_factor=2)
    ctx = br.new_context(**kw); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' and 'Failed to load' not in m.text else None)
    pg.goto(URL); pg.wait_for_timeout(1000)
    if MANUAL: pg.evaluate("__rehab.autoStart=false")
    pg.evaluate("localStorage.setItem('x','1')")
    pg.click('#seg-mode button[data-m="closeup"]') if not MOBILE else pg.locator('#seg-mode button[data-m="closeup"]').tap(); pg.wait_for_timeout(300)
    a = flow(pg, V1, 'film 1')
    b = flow(pg, V2, 'film 2')
    check('miniatury filmu 2 różne od filmu 1', a and b and a != b, (a, b))
    check('brak błędów JS', not errs, errs)
    print('WYNIK:', sum(res), '/', len(res)); br.close()
    sys.exit(0 if all(res) else 1)

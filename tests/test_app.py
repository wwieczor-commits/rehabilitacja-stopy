"""Testy „Rehabilitacja stopy” (Playwright + Chrome). Uruchom: python3 tests/test_app.py [URL]
Zmienne: ONLY=desktop,mobile,video,pwa ; FAKE_VIDEO (y4m do atrapy kamery) ; CU_VIDEO (film do zbliżenia) ; BROKEN_VIDEO ; HEVC_VIDEO.
Filmy testowe nie są częścią repozytorium (prywatne)."""
import sys, os, json, time
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8766/index.html?nosw=1'
HERE = os.path.dirname(os.path.abspath(__file__)); SHOTS = os.path.join(HERE, '..', 'screenshots'); PRIV = os.path.join(SHOTS, 'private')
os.makedirs(PRIV, exist_ok=True)
FAKE = os.environ.get('FAKE_VIDEO', '/workspace/testmedia/squat.y4m')
CU_VIDEO = os.environ.get('CU_VIDEO', '/workspace/testmedia/stopa.mp4')
SQUAT = os.environ.get('SQUAT_VIDEO', '/workspace/testmedia/squat.mp4')
BROKEN = os.environ.get('BROKEN_VIDEO', '/workspace/testmedia/broken.mov')
HEVC = os.environ.get('HEVC_VIDEO', '/workspace/testmedia/stopa-uzytkownika.mov')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', f'--use-file-for-fake-video-capture={FAKE}', '--no-sandbox',
        '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader']
ONLY = [x for x in os.environ.get('ONLY', 'desktop,mobile,video,pwa').split(',') if x]
results = []
def check(name, ok, info=''):
    results.append((name, bool(ok), info)); print(('PASS' if ok else 'FAIL'), name, str(info)[:260], flush=True)

def new(p, dev=None, vp=None, **kw):
    br = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=ARGS)
    if dev:
        d = dict(p.devices[dev]); d.pop('default_browser_type', None)
        if vp: d['viewport'] = vp; d['screen'] = vp
    else: d = {'viewport': vp or {'width': 1440, 'height': 900}}
    ctx = br.new_context(**d, accept_downloads=True, **kw); page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    page.on('console', lambda m: errs.append('console.error: ' + m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    return br, ctx, page, errs

def overflow(page, tag, when=''):
    ov = page.evaluate("({sw:document.documentElement.scrollWidth,iw:innerWidth,bw:document.body.scrollWidth})")
    check(f'[{tag}] brak poziomego przewijania {when}', ov['sw'] <= ov['iw'] + 1 and ov['bw'] <= ov['iw'] + 1, ov)

def tap_pts(page, pts, touch):
    box = page.locator('#view').bounding_box()
    for x, y in pts:
        X, Y = box['x'] + x / 1024 * box['width'], box['y'] + y / 576 * box['height']
        (page.touchscreen.tap(X, Y) if touch else page.mouse.click(X, Y)); page.wait_for_timeout(250)

def wait_cu_pick(page):
    page.wait_for_function("__rehab.running && __rehab.cu && __rehab.cu.state==='pick'", timeout=40000); page.wait_for_timeout(400)

CU_PTS = [[900, 300], [585, 318], [450, 170]]

def closeup_run(page, tag, touch, max_s=None, full=False):
    wait_cu_pick(page)
    tap_pts(page, CU_PTS, touch)
    check(f'[{tag}] 3 stuknięcia → stan „track”', page.evaluate("__rehab.cu.state") == 'track')
    page.locator('#stage').screenshot(path=f'{PRIV}/{tag}-punkty.png')
    page.wait_for_timeout(1200)      # v5: po 3 punktach pomiar filmu rusza sam
    auto = page.evaluate("!!__rehab.rec"); check(f'[{tag}] po 3 punktach pomiar rusza sam (film)', auto)
    if not auto: page.evaluate("document.getElementById('btn-rec').click()")
    t0 = time.time(); shot = False
    while time.time() - t0 < 400:
        st = page.evaluate("[!!__rehab.rec, __rehab.mt]")
        if not st[0]: break
        if not shot and st[1] > 3: page.locator('#stage').screenshot(path=f'{PRIV}/{tag}-pomiar.png'); shot = True
        if max_s and st[1] > max_s: page.evaluate("document.getElementById('btn-rec').click()"); break
        page.wait_for_timeout(200)
    page.wait_for_timeout(500)
    return page.evaluate("(()=>{const r=__rehab.last;if(!r)return null;const s=__rehab.hist.at(-1);return {n:r.frames.length,dur:r.dur,reps:r.reps,ankle:s&&s.ankle,hist:__rehab.hist.length}})()")

def desktop(p):
    tag = 'desktop'
    br, ctx, page, errs = new(p)
    page.goto(URL, wait_until='load'); page.wait_for_timeout(1200)
    check(f'[{tag}] tytuł „Rehabilitacja stopy”', 'Rehabilitacja stopy' in page.title(), page.title())
    html = page.content()
    check(f'[{tag}] brak linku „System pomiarów”', 'System pomiarów' not in html and 'bikerc-5a1dd' not in html)
    check(f'[{tag}] stopka: © Wojciech Wieczorek', '© Wojciech Wieczorek' in page.inner_text('footer') if page.query_selector('footer') else '© Wojciech Wieczorek' in page.inner_text('body'), page.inner_text('body')[-200:].replace('\n', ' '))
    check(f'[{tag}] meta author', page.evaluate("document.querySelector('meta[name=author]').content") == 'Wojciech Wieczorek')
    check(f'[{tag}] brak „BIKERC Prosta Spółka”', 'BIKERC Prosta' not in html)
    overflow(page, tag)
    page.screenshot(path=f'{SHOTS}/desktop-1-start.png')
    # import historii demonstracyjnej
    page.set_input_files('#file-import', os.path.join(HERE, 'sample-history.json')); page.wait_for_timeout(800)
    n = page.evaluate("__rehab.hist.length"); check(f'[{tag}] import JSON: {n} sesji', n == 22, n)
    page.evaluate("document.getElementById('c-hist').open=true; document.getElementById('c-compare').open=true; document.getElementById('c-hist').scrollIntoView()"); page.wait_for_timeout(600)
    rows = page.evaluate("document.querySelectorAll('#hist-table tbody tr').length"); check(f'[{tag}] tabela historii ma wiersze', rows >= 10, rows)
    px = page.evaluate("""()=>{const c=document.querySelector('#prog-chart');const g=c.getContext('2d');const d=g.getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4*53){if(d[i+3]>0&&(d[i]>60||d[i+1]>60))n++}return n}""")
    check(f'[{tag}] wykres postępów narysowany', px > 150, px)
    page.locator('#c-hist').screenshot(path=f'{SHOTS}/desktop-2-historia.png')
    page.select_option('#cmp-inj', 'R'); page.wait_for_timeout(300)
    cmp_txt = page.inner_text('#cmp-box'); check(f'[{tag}] porównanie L/P: różnica/asymetria', ('%' in cmp_txt) and ('Lewa' in cmp_txt or 'Zdrowa' in cmp_txt or 'zdrow' in cmp_txt.lower()), cmp_txt[:200].replace('\n', ' | '))
    page.locator('#c-compare').screenshot(path=f'{SHOTS}/desktop-3-porownanie.png')
    # eksporty
    with page.expect_download(timeout=15000) as dl: page.click('#btn-h-json')
    path = '/tmp/rs-hist.json'; dl.value.save_as(path); doc = json.load(open(path))
    check(f'[{tag}] eksport JSON', len(doc['sessions']) == 22, dl.value.suggested_filename)
    with page.expect_download(timeout=15000) as dl: page.click('#btn-h-csv')
    path = '/tmp/rs-hist.csv'; dl.value.save_as(path); txt = open(path, encoding='utf-8-sig').read()
    check(f'[{tag}] eksport CSV', txt.count('\n') >= 22 and ';' in txt or ',' in txt, dl.value.suggested_filename)
    page.set_input_files('#file-import', '/tmp/rs-hist.json'); page.wait_for_timeout(500)
    check(f'[{tag}] ponowny import: brak duplikatów', page.evaluate("__rehab.hist.length") == 22)
    page.fill('#in-client', 'Jan Kowalski (przykład)'); page.evaluate("document.getElementById('in-client').dispatchEvent(new Event('change'))")
    page.locator('#btn-pdf').scroll_into_view_if_needed()
    with page.expect_download(timeout=90000) as dl: page.click('#btn-pdf')
    out = os.path.join(SHOTS, 'raport-przyklad.pdf'); dl.value.save_as(out)
    check(f'[{tag}] PDF pobrany (%PDF-, >20 kB)', open(out, 'rb').read(5) == b'%PDF-' and os.path.getsize(out) > 20000, f'{dl.value.suggested_filename} {os.path.getsize(out)}B')
    # wysokość/ćwiczenia
    for ex in ['heel', 'wall', 'pump']:
        page.click(f'#exlist .exb[data-e="{ex}"]'); page.wait_for_timeout(150)
        check(f'[{tag}] ćwiczenie {ex}: instrukcje i diagram', page.inner_text('#ex-steps').strip() != '' and page.evaluate("document.querySelector('#ex-svg').innerHTML.length")>50)
    page.evaluate("window.scrollTo(0,0)"); page.screenshot(path=f'{SHOTS}/desktop-4-cwiczenia.png')
    check(f'[{tag}] brak błędów JS', not errs, '; '.join(errs)[:400]); ctx.close(); br.close()

def mobile(p, dev, orient, flow):
    tag = f"{dev.replace(' ', '').lower()}-{orient}"
    d = dict(p.devices[dev]); vp = d['viewport']
    if orient == 'landscape': vp = {'width': vp['height'], 'height': vp['width']}
    br, ctx, page, errs = new(p, dev, vp, permissions=['camera'])
    page.goto(URL, wait_until='load'); page.wait_for_timeout(1200)
    overflow(page, tag); check(f'[{tag}] dolny pasek widoczny', page.is_visible('#dock'))
    labels = page.evaluate("[...document.querySelectorAll('#dock .btn')].map(b=>b.innerText.replace(/\\s+/g,' ').trim())")
    check(f'[{tag}] pasek: Kamera / Film / Pomiar / Pełny', all(any(k in l for l in labels) for k in ['Kamera', 'Film', 'Pomiar', 'Pełny']), labels)
    boxes = page.evaluate("[...document.querySelectorAll('#dock .btn')].map(b=>{const r=b.getBoundingClientRect();return [r.left,r.right,b.scrollWidth>b.clientWidth+1]})")
    check(f'[{tag}] pasek mieści się w ekranie', all(b[0] >= 0 and b[1] <= vp['width'] + .5 and not b[2] for b in boxes), boxes)
    page.screenshot(path=f'{SHOTS}/mobile-{tag}-1-start.png')
    if flow:
        page.tap('#d-cam')
        try: page.wait_for_function('__rehab.nPose>10', timeout=90000); ok = True
        except Exception: ok = False
        st = page.evaluate("({run:__rehab.running,src:__rehab.source,np:__rehab.nPose,model:document.getElementById('pill-model-t').textContent})")
        check(f'[{tag}] kamera + MediaPipe: sylwetka wykrywana', ok and st['run'], st)
        page.wait_for_timeout(1500); page.screenshot(path=f'{PRIV}/mobile-{tag}-2-kamera.png')
        la = page.evaluate("__rehab.lastRaw&&__rehab.lastRaw.ankle"); check(f'[{tag}] kąt kostki wyliczany (kamera testowa)', la is not None, la)
        page.tap('#d-fs'); page.wait_for_timeout(600)
        check(f'[{tag}] pełny ekran', page.evaluate("!!(document.fullscreenElement||document.getElementById('stage').classList.contains('fake-fs'))"))
        page.tap('#s-fs'); page.wait_for_timeout(400)
        page.tap('#btn-cal') if page.is_visible('#btn-cal') else page.evaluate("document.getElementById('btn-cal').click()")
        page.wait_for_timeout(300); page.tap('#d-rec'); page.wait_for_function('!!__rehab.rec', timeout=30000); page.wait_for_timeout(7000)  # kamera: wprowadzenie + odliczanie 3-2-1 trenera
        fr = page.evaluate("__rehab.rec?__rehab.rec.frames.length:0"); check(f'[{tag}] pomiar zbiera próbki', fr > 15, fr)
        page.tap('#d-rec'); page.wait_for_timeout(1200)
        check(f'[{tag}] sesja zapisana w historii', page.evaluate("__rehab.hist.length") == 1)
        # po zatrzymaniu raport generuje się sam i otwiera arkusz (auto-PDF)
        try: page.wait_for_selector('#sheet:not([hidden])', timeout=60000); shown = True
        except Exception: shown = False
        check(f'[{tag}] PDF: arkusz Otwórz/Pobierz', shown)
        if shown:
            with page.expect_download(timeout=20000) as dl: page.tap('#sh-dl')
            pth = f'/tmp/rs-{tag}.pdf'; dl.value.save_as(pth)
            check(f'[{tag}] PDF poprawny', open(pth, 'rb').read(5) == b'%PDF-' and os.path.getsize(pth) > 20000, os.path.getsize(pth))
        page.locator('#btn-csv').scroll_into_view_if_needed()
        if 'iphone' not in dev.lower():
            with page.expect_download(timeout=15000) as dl2: page.tap('#btn-csv')
            check(f'[{tag}] CSV pomiaru', dl2.value.suggested_filename.endswith('.csv'), dl2.value.suggested_filename)
        overflow(page, tag, '(po pomiarze)')
        page.evaluate("window.scrollTo(0,0)"); page.screenshot(path=f'{PRIV}/mobile-{tag}-3-po.png', full_page=True)
    check(f'[{tag}] brak błędów JS', not errs, '; '.join(errs)[:400]); ctx.close(); br.close()

def video(p, dev, vp=None, full_cu=False):
    tag = f"video-{dev.replace(' ', '').lower()}" + (f"-{vp['width']}" if vp else '')
    br = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=ARGS)
    d = dict(p.devices[dev]); d.pop('default_browser_type', None)
    if vp: d['viewport'] = vp; d['screen'] = vp
    ctx = br.new_context(**d, accept_downloads=True); page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    page.on('console', lambda m: errs.append('console.error: ' + m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    page.goto(URL, wait_until='load'); page.wait_for_timeout(1000)
    inp = page.evaluate("({acc:document.getElementById('file-video').accept,cap:document.getElementById('file-video').hasAttribute('capture'),capRec:document.getElementById('file-rec').getAttribute('capture')})")
    check(f'[{tag}] input video/* bez capture; drugi z capture', inp['acc'].startswith('video/*') and not inp['cap'] and inp['capRec'] == 'environment', inp)
    with page.expect_file_chooser(timeout=5000) as fc: page.tap('#d-film')
    check(f'[{tag}] tap „Film” otwiera wybór pliku', fc.value is not None)
    # --- film z bliska w trybie „cała noga” -> brak pozy -> podpowiedź trybu zbliżenia
    with page.expect_file_chooser(timeout=5000) as fc2: page.tap('#btn-empty-film')
    fc2.value.set_files(CU_VIDEO)
    page.wait_for_function('__rehab.running && __rehab.source==="file"', timeout=60000)
    try: page.wait_for_function("!document.getElementById('suggest').hidden", timeout=60000); sug = True
    except Exception: sug = False
    check(f'[{tag}] brak pozy → podpowiedź „Zbliżenie stopy”', sug, page.inner_text('#suggest')[:120] if sug else '')
    page.screenshot(path=f'{PRIV}/{tag}-1-sugestia.png')
    overflow(page, tag, '(film wczytany)')
    page.tap('#btn-suggest'); page.wait_for_timeout(1200)
    check(f'[{tag}] przełączenie na tryb zbliżenia', page.evaluate("__rehab.trackMode") == 'closeup' and page.evaluate("__rehab.cu&&__rehab.cu.state") == 'pick')
    page.screenshot(path=f'{PRIV}/{tag}-2-wskazywanie.png')
    # kontrolki odtwarzacza w trakcie wskazywania
    page.locator('#vctl').scroll_into_view_if_needed()
    t0 = page.evaluate('video.currentTime'); page.tap('#v-fwd'); page.wait_for_timeout(500); t1 = page.evaluate('video.currentTime')
    check(f'[{tag}] krok o klatkę do przodu', 0.02 < t1 - t0 < 0.06, f'{t0:.3f}->{t1:.3f}')
    page.tap('#v-back'); page.wait_for_timeout(500); check(f'[{tag}] krok wstecz', abs(page.evaluate('video.currentTime') - t0) < 0.01)
    page.tap('#seg-speed button[data-r="0.5"]'); check(f'[{tag}] prędkość 0,5×', page.evaluate('video.playbackRate') == 0.5)
    page.tap('#seg-speed button[data-r="0.25"]'); check(f'[{tag}] prędkość 0,25×', page.evaluate('video.playbackRate') == 0.25)
    page.tap('#seg-speed button[data-r="1"]')
    page.evaluate("(()=>{const r=document.getElementById('v-seek');r.value=0;r.dispatchEvent(new Event('input',{bubbles:true}));r.dispatchEvent(new Event('change',{bubbles:true}))})()"); page.wait_for_timeout(600)
    page.locator('#stage').scroll_into_view_if_needed()
    res = closeup_run(page, tag, True, None if full_cu else 7)
    if full_cu:
        check(f'[{tag}] zbliżenie: pełny film, 11 powtórzeń (ruch ~2×/3 s)', res and 9 <= res['reps'] <= 13 and res['ankle'], res)
    else:
        check(f'[{tag}] zbliżenie: pomiar zapisany', res and res['n'] > 10 and res['hist'] == 1, res)
    print('   wynik zbliżenia:', res)
    overflow(page, tag, '(po pomiarze)')
    # --- zły format (po zakończeniu filmu raport PDF otworzył się sam – zamykamy arkusz)
    if page.evaluate("!document.getElementById('sheet').hidden"): page.tap('#sh-close')
    page.tap('#d-cam'); page.wait_for_timeout(500)
    with page.expect_file_chooser(timeout=5000) as fc3: page.tap('#d-film')
    fc3.value.set_files(BROKEN); page.wait_for_timeout(2500)
    tt = page.inner_text('#toast'); check(f'[{tag}] nieobsługiwany format: polski komunikat (MP4/H.264)', 'MP4' in tt and not page.evaluate('__rehab.running'), tt[:100])
    page.screenshot(path=f'{SHOTS}/mobile-{tag}-format-error.png')
    # --- HEVC z iPhone’a
    if os.path.exists(HEVC):
        with page.expect_file_chooser(timeout=5000) as fc4: page.tap('#d-film')
        fc4.value.set_files(HEVC); page.wait_for_timeout(6000)
        run = page.evaluate('__rehab.running'); tt = page.inner_text('#toast')
        check(f'[{tag}] HEVC .mov: albo się wczytuje, albo polski komunikat', run or 'MP4' in tt, f'running={run} toast={tt[:80]}')
        print('   HEVC w tym Chrome:', 'DEKODUJE' if run else 'komunikat o formacie')
    check(f'[{tag}] brak błędów JS', not errs, '; '.join(errs)[:400]); ctx.close(); br.close()

def squat_pose(p):
    tag = 'pose-film'
    br, ctx, page, errs = new(p, 'Pixel 7')
    page.goto(URL, wait_until='load'); page.wait_for_timeout(800)
    page.set_input_files('#file-video', SQUAT)
    try: page.wait_for_function('__rehab.nPose>10', timeout=90000); ok = True
    except Exception: ok = False
    check(f'[{tag}] film w trybie pozy: MediaPipe wykrywa sylwetkę', ok, page.evaluate("({np:__rehab.nPose,side:__rehab.autoSide})"))
    for ex in ['heel', 'wall', 'pump']:
        page.evaluate(f"document.querySelector('#exlist .exb[data-e=\"{ex}\"]').click()"); page.wait_for_timeout(700)
        v = page.evaluate("__rehab.lastVals"); check(f'[{tag}] ćwiczenie {ex}: liczy metrykę', v is not None, json.dumps(v)[:120] if v else '')
    page.evaluate("document.querySelector('#chk-front').click()"); page.wait_for_timeout(500)
    page.evaluate("document.querySelector('#chk-front').click()")
    check(f'[{tag}] brak błędów JS', not errs, '; '.join(errs)[:400]); ctx.close(); br.close()

def pwa(p):
    br, ctx, page, errs = new(p, 'Pixel 7', permissions=['camera'])
    page.goto(URL.replace('?nosw=1', ''), wait_until='load')
    ok = page.evaluate("navigator.serviceWorker.ready.then(r=>!!r.active)"); page.wait_for_timeout(3500)
    keys = page.evaluate("caches.keys().then(async ks=>{let o={};for(const k of ks){o[k]=(await (await caches.open(k)).keys()).length}return o})")
    check('[PWA] service worker aktywny', ok); check('[PWA] cache powłoki wypełniony', any(v >= 8 for v in keys.values()), keys)
    man = page.evaluate("fetch(document.querySelector('link[rel=manifest]').href).then(r=>r.json())")
    check('[PWA] manifest: nazwa „Rehabilitacja stopy”, autor', man['name'] == 'Rehabilitacja stopy' and man.get('author') == 'Wojciech Wieczorek' and man['theme_color'] == '#232222', man['name'])
    sw = page.evaluate("fetch('./sw.js').then(r=>r.text())"); check('[PWA] sw.js: network-first dla index.html', 'network-first' in sw.lower() or 'NETWORK-FIRST' in sw)
    ctx.set_offline(True)
    try: page.reload(wait_until='domcontentloaded'); off = 'Rehabilitacja stopy' in page.title()
    except Exception as e: off = False
    check('[PWA] otwiera się offline', off); ctx.close(); br.close()

if __name__ == '__main__':
    with sync_playwright() as p:
        if 'desktop' in ONLY: desktop(p)
        if 'mobile' in ONLY:
            mobile(p, 'Pixel 7', 'portrait', True); mobile(p, 'Pixel 7', 'landscape', False)
            mobile(p, 'iPhone 13', 'portrait', True); mobile(p, 'iPhone 13', 'landscape', False)
        if 'pose' in ONLY or 'video' in ONLY: squat_pose(p)
        if 'video' in ONLY:
            video(p, 'Pixel 7', None, full_cu=True); video(p, 'iPhone 13'); video(p, 'Pixel 7', {'width': 360, 'height': 740})
        if 'pwa' in ONLY: pwa(p)
    bad = [r for r in results if not r[1]]
    print(f'\n{len(results)-len(bad)}/{len(results)} OK'); [print('FAIL:', b[0], b[2]) for b in bad]; sys.exit(1 if bad else 0)

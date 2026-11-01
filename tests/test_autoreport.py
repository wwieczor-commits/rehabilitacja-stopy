"""Auto-raport po zatrzymaniu + miniatury z bieżącego filmu (Playwright). python3 tests/test_autoreport.py A.mp4 B.mp4
Filmy testowe są prywatne i nie należą do repozytorium."""
import sys, os, json, time, hashlib, base64, subprocess, glob, tempfile
from playwright.sync_api import sync_playwright
URL = os.environ.get('URL', 'http://127.0.0.1:8766/index.html?mode=closeup&nosw=1')
A = sys.argv[1] if len(sys.argv) > 1 else '/workspace/testmedia/seg/A.mp4'
B = sys.argv[2] if len(sys.argv) > 2 else '/workspace/testmedia/seg/B.mp4'
PTS = json.loads(os.environ.get('PTS', '[[900,300],[585,318],[450,170]]'))
res = []
def check(n, ok, info=''):
    res.append(bool(ok)); print('PASS' if ok else 'FAIL', n, str(info)[:240], flush=True)
h = lambda d: hashlib.md5(d.encode()).hexdigest()[:8]

def measure(pg, path, stop_mode='click'):
    pg.set_input_files('#file-video', path)
    pg.wait_for_function("window.__rehab.running && window.__rehab.cu && window.__rehab.cu.state==='pick'", timeout=30000)
    pg.wait_for_timeout(400)
    pg.locator('#view').scroll_into_view_if_needed(); box = pg.locator('#view').bounding_box()
    for x, y in PTS:
        pg.mouse.click(box['x'] + x / 1024 * box['width'], box['y'] + y / 576 * box['height']); pg.wait_for_timeout(200)
    pg.click('#btn-rec')
    if stop_mode == 'click':
        pg.wait_for_function("__rehab.rec && __rehab.rec.frames.length>110", timeout=60000)
        with pg.expect_download(timeout=60000) as dl: pg.click('#btn-rec')
        return dl.value
    else:  # koniec filmu
        with pg.expect_download(timeout=120000) as dl: pass
        return dl.value

with sync_playwright() as p:
    br = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'])
    ctx = br.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_timeout(800)
    check('przełącznik auto-PDF domyślnie włączony', pg.evaluate("document.getElementById('chk-autopdf').checked && __rehab.autoPdf===true"))
    # 1) film A, zatrzymanie kliknięciem -> auto PDF
    d1 = measure(pg, A); pdf1 = tempfile.mktemp(suffix='.pdf'); d1.save_as(pdf1)
    check('film A: raport PDF pobrany automatycznie', d1.suggested_filename.endswith('.pdf') and os.path.getsize(pdf1) > 20000, d1.suggested_filename)
    sA = pg.evaluate("({id:__rehab.report.id,file:__rehab.report.file,max:__rehab.report.thumbs.max&&__rehab.report.thumbs.max.img,min:__rehab.report.thumbs.min&&__rehab.report.thumbs.min.img,hist:__rehab.hist.length})")
    check('film A: sesja zapisana w historii', sA['hist'] == 1, sA['hist'])
    # 2) film B -> stan zresetowany, nowy raport ma inne miniatury
    pg.set_input_files('#file-video', B)
    pg.wait_for_function("window.__rehab.running && window.__rehab.source==='file' && window.__rehab.fileName==='B.mp4'", timeout=30000)
    check('nowy film: stan pomiaru wyzerowany', pg.evaluate("__rehab.report===null && __rehab.last===null && __rehab.rec===null"))
    d2 = measure(pg, B); pdf2 = tempfile.mktemp(suffix='.pdf'); d2.save_as(pdf2)
    sB = pg.evaluate("({id:__rehab.report.id,file:__rehab.report.file,max:__rehab.report.thumbs.max&&__rehab.report.thumbs.max.img,min:__rehab.report.thumbs.min&&__rehab.report.thumbs.min.img,hist:__rehab.hist.length})")
    check('film B: sesja zapisana', sB['hist'] == 2 and sB['file'] == 'B.mp4', sB['file'])
    check('miniatury B różnią się od miniatur A', sB['max'] != sA['max'] and sB['min'] != sA['min'], (h(sA['max']), h(sB['max'])))
    # obrazy w PDF == miniatury ze świeżego filmu
    def pdf_imgs(path):
        d = tempfile.mkdtemp(); subprocess.run(['pdfimages', '-j', path, d + '/i'], check=True)
        return [hashlib.md5(open(f, 'rb').read()).hexdigest()[:8] for f in sorted(glob.glob(d + '/i-*.jpg'))]
    raw = lambda u: hashlib.md5(base64.b64decode(u.split(',', 1)[1])).hexdigest()[:8]
    i1, i2 = pdf_imgs(pdf1), pdf_imgs(pdf2)
    check('PDF #1 zawiera miniatury filmu A', raw(sA['max']) in i1 and raw(sA['min']) in i1, i1)
    check('PDF #2 zawiera miniatury filmu B (nie A)', raw(sB['max']) in i2 and raw(sB['min']) in i2 and raw(sA['max']) not in i2, i2)
    # 3) wyłączony przełącznik -> brak auto-PDF, ale zapis
    pg.check('#chk-autopdf', force=True) ; pg.uncheck('#chk-autopdf'); 
    check('przełącznik zapisany w ustawieniach', pg.evaluate("JSON.parse(localStorage.getItem('rehab.settings.v1')).autoPdf===false"))
    pg.set_input_files('#file-video', A)
    pg.wait_for_function("window.__rehab.running && window.__rehab.cu && window.__rehab.cu.state==='pick'", timeout=30000); pg.wait_for_timeout(400)
    pg.locator('#view').scroll_into_view_if_needed(); box = pg.locator('#view').bounding_box()
    for x, y in PTS: pg.mouse.click(box['x'] + x / 1024 * box['width'], box['y'] + y / 576 * box['height']); pg.wait_for_timeout(200)
    pg.click('#btn-rec'); pg.wait_for_function("__rehab.rec && __rehab.rec.frames.length>110", timeout=60000)
    got = []; pg.on('download', lambda d: got.append(d)); pg.click('#btn-rec'); pg.wait_for_timeout(4000)
    check('auto-PDF wyłączony: brak pobrania', not got and pg.evaluate("__rehab.hist.length") == 3)
    pg.reload(); pg.wait_for_timeout(800)
    check('po przeładowaniu przełącznik nadal wyłączony', pg.evaluate("!document.getElementById('chk-autopdf').checked"))
    # 4) za krótki pomiar
    pg.check('#chk-autopdf'); got.clear()
    pg.set_input_files('#file-video', A)
    pg.wait_for_function("window.__rehab.running && window.__rehab.cu && window.__rehab.cu.state==='pick'", timeout=30000); pg.wait_for_timeout(400)
    pg.locator('#view').scroll_into_view_if_needed(); box = pg.locator('#view').bounding_box()
    for x, y in PTS: pg.mouse.click(box['x'] + x / 1024 * box['width'], box['y'] + y / 576 * box['height']); pg.wait_for_timeout(200)
    pg.click('#btn-rec'); pg.wait_for_function("__rehab.rec && __rehab.rec.frames.length>=9", timeout=60000)
    pg.evaluate("document.getElementById('btn-rec').click()"); pg.wait_for_timeout(1500)
    tt = pg.evaluate("document.getElementById('toast').textContent")
    check('za krótki pomiar: komunikat po polsku, bez PDF', not got and ('zbyt krótki' in tt or 'Za mało' in tt), tt)
    # 5) koniec filmu -> auto-raport
    pg.set_input_files('#file-video', A)
    pg.wait_for_function("window.__rehab.running && window.__rehab.cu && window.__rehab.cu.state==='pick'", timeout=30000); pg.wait_for_timeout(400)
    pg.locator('#view').scroll_into_view_if_needed(); box = pg.locator('#view').bounding_box()
    for x, y in PTS: pg.mouse.click(box['x'] + x / 1024 * box['width'], box['y'] + y / 576 * box['height']); pg.wait_for_timeout(200)
    got.clear(); pg.click('#btn-rec')
    t0 = time.time()
    while time.time() - t0 < 150 and not got: pg.wait_for_timeout(300)
    check('koniec filmu: raport wygenerowany automatycznie', len(got) == 1 and got[0].suggested_filename.endswith('.pdf'), [g.suggested_filename for g in got])
    # 6) nowy film bez pomiaru -> ostrzeżenie przy ręcznym raporcie
    pg.set_input_files('#file-video', B)
    pg.wait_for_function("window.__rehab.running && window.__rehab.fileName==='B.mp4'", timeout=30000); pg.wait_for_timeout(500)
    got.clear(); pg.click('#btn-pdf'); pg.wait_for_timeout(300)
    tt = pg.evaluate("document.getElementById('toast').textContent")
    check('ręczny raport bez pomiaru z nowego filmu: ostrzeżenie', 'Uwaga' in tt and 'B.mp4' in tt, tt)
    pg.wait_for_timeout(3000)
    check('brak błędów JS', not errs, errs)
    br.close()
print('WYNIK:', sum(res), '/', len(res)); sys.exit(0 if all(res) else 1)

"""Testy e2e (Playwright, prawdziwe kliknięcia). Używają WYŁĄCZNIE syntetycznego filmu generowanego przez make_synth.py.
Uruchom:  python3 tests/test_e2e.py [chromium|webkit|all]
Wymaga: pip install playwright && playwright install chromium (oraz webkit). Bez przeglądarki testy są pomijane (kod 0)."""
import os, re, sys, subprocess, threading, http.server, socketserver, functools, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
try:
    from playwright.sync_api import sync_playwright
except Exception:
    print('SKIP: brak playwright'); sys.exit(0)
tmp = tempfile.mkdtemp()
clips = {}
for mode in ('landscape', 'portrait'):
    f = os.path.join(tmp, mode + '.mp4'); subprocess.run([sys.executable, os.path.join(ROOT, 'tests', 'make_synth.py'), f, mode], check=True); clips[mode] = f
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
httpd = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Q, directory=ROOT)); PORT = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{PORT}/index.html'
fails = []
def check(c, msg):
    print(('OK   ' if c else 'FAIL ') + msg)
    if not c: fails.append(msg)
def run(pw, engine, device):
    if engine == 'chromium':
        exe = '/usr/bin/google-chrome'; br = pw.chromium.launch(**({'executable_path': exe} if os.path.exists(exe) else {}), args=['--no-sandbox'])
    else:
        WK = {'GST_PLUGIN_SYSTEM_PATH_1_0': '/tmp/wk/plug', 'GST_PLUGIN_PATH_1_0': '/tmp/wk/plug', 'GST_REGISTRY_1_0': '/tmp/wk/reg.bin'}  # tylko środowisko CI tego pudełka
        br = pw.webkit.launch(**({'env': WK} if os.path.isdir('/tmp/wk/plug') else {}))
    mobile = device == 'mobile'; errs = []; tag = f'[{engine}/{device}] '
    for mode in ('landscape', 'portrait'):
        ctx = br.new_context(accept_downloads=True, **({'viewport': {'width': 390, 'height': 780}, 'device_scale_factor': 2, 'has_touch': True, 'is_mobile': True} if mobile else {'viewport': {'width': 1366, 'height': 768}}))
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(URL); pg.wait_for_timeout(800)
        if mode == 'landscape':
            check(re.search(r'v6\.0', pg.inner_text('#ver')) is not None, tag + 'wersja v6.0 w stopce')
            check('Wojciech Wieczorek' in pg.inner_text('footer'), tag + 'stopka © Wojciech Wieczorek')
            check(pg.evaluate('document.documentElement.scrollWidth - innerWidth') <= 1, tag + 'brak przewijania poziomego (start)')
        pg.evaluate("__app.S.settings.autoPdf = true")
        dl = []; pg.on('download', lambda d: dl.append(d.suggested_filename))
        clip = clips[mode]
        if engine == 'webkit':   # WebKit z paczki Playwright nie ma H.264 – używamy VP8/WebM
            wf = clip.replace('.mp4', '.webm'); subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', clip, '-c:v', 'libvpx', '-b:v', '1M', wf], check=True); clip = wf
        pg.set_input_files('#file-video', clip)
        pg.wait_for_function("() => ['ready','pick'].includes(__app.S.phase)", timeout=420000)
        ph = pg.evaluate('__app.S.phase'); rng = pg.inner_text('#k-range')
        check(ph == 'ready', tag + f'{mode}: analiza zakończona ({ph}), zakres {rng}')
        check(pg.evaluate('document.documentElement.scrollWidth - innerWidth') <= 1, tag + f'{mode}: brak przewijania poziomego po analizie')
        pg.wait_for_timeout(2500)
        if mobile:   # na telefonie raport trafia do arkusza „Udostępnij / Otwórz / Pobierz”
            check(pg.is_visible('#sheet'), tag + f'{mode}: raport PDF gotowy automatycznie (arkusz zapisu)'); pg.click('#sh-close')
        else:
            check(any(n.endswith('.pdf') for n in dl), tag + f'{mode}: raport PDF zapisał się automatycznie {dl}')
        # przycisk raportu zawsze widoczny
        btn = '#d-pdf' if mobile else '#btn-pdf'
        check(pg.is_visible(btn), tag + f'{mode}: przycisk „Zapisz raport PDF” widoczny')
        n0 = len(dl); pg.click(btn); pg.wait_for_timeout(4000 if engine == 'chromium' else 20000)
        if mobile and pg.is_visible('#sheet'): pg.click('#sh-close')
        check(len(dl) > n0 or mobile, tag + f'{mode}: klik w „Raport” daje plik/arkusz')
        # kluczowe przyciski w oknie
        vis = pg.evaluate("[...document.querySelectorAll('#btn-film,#btn-cam,#v-play,#chart')].every(e=>e.offsetParent)")
        check(vis, tag + f'{mode}: Wczytaj film / Kamera / Odtwarzaj / wykres istnieją')
        hist = pg.evaluate("JSON.parse(localStorage.getItem('rehab.sessions.v1')||'[]').length")
        check(hist >= 1, tag + f'{mode}: sesja zapisana w historii ({hist})')
        pg.click('#v-play'); pg.wait_for_timeout(1200); t1 = pg.evaluate('__app.S.curT'); pg.click('#v-play')
        check(t1 > 0.3, tag + f'{mode}: odtwarzanie płynie (t={t1:.2f}s)')
        ctx.close()
    check(not errs, tag + f'brak błędów JS {errs[:2]}')
    br.close()
engines = ['chromium', 'webkit'] if (len(sys.argv) < 2 or sys.argv[1] == 'all') else [sys.argv[1]]
with sync_playwright() as pw:
    for e in engines:
        for d in ('desktop', 'mobile'):
            try: run(pw, e, d)
            except Exception as ex: check(False, f'[{e}/{d}] wyjątek: {str(ex)[:200]}')
print('\nWYNIK:', 'WSZYSTKO OK' if not fails else f'{len(fails)} błędów'); sys.exit(1 if fails else 0)

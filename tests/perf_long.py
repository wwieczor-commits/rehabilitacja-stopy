"""Test długotrwały: kilka pomiarów pod rząd – płynność odtwarzania (rAF) i czas analizy nie mogą się pogarszać.
Używa syntetycznego filmu. python3 tests/perf_long.py [liczba_przebiegów]"""
import os, sys, time, subprocess, tempfile, threading, http.server, socketserver, functools, statistics
from playwright.sync_api import sync_playwright
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); N = int(sys.argv[1]) if len(sys.argv) > 1 else 3
clip = os.path.join(tempfile.mkdtemp(), 'l.mp4'); subprocess.run([sys.executable, R + '/tests/make_synth.py', clip, 'landscape'], check=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
h = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Q, directory=R)); threading.Thread(target=h.serve_forever, daemon=True).start()
exe = '/usr/bin/google-chrome'
with sync_playwright() as p:
    br = p.chromium.launch(**({'executable_path': exe} if os.path.exists(exe) else {}), args=['--no-sandbox']); pg = br.new_page(viewport={'width': 1366, 'height': 768})
    pg.goto(f'http://127.0.0.1:{h.server_address[1]}/index.html'); pg.evaluate('__app.S.settings.autoPdf=false')
    times, fps = [], []
    for i in range(N):
        t0 = time.time(); pg.set_input_files('#file-video', clip); pg.wait_for_function("()=>__app.S.phase==='ready'", timeout=420000); times.append(time.time() - t0)
        pg.evaluate("window.__d=[];let l=performance.now();(function f(n){window.__d.push(n-l);l=n;if(window.__d.length<400)requestAnimationFrame(f)})(l)")
        pg.click('#v-play'); pg.wait_for_timeout(6000); pg.click('#v-play')
        d = pg.evaluate('__d.slice(10)'); f = 1000 / statistics.median(d); fps.append(f)
        print(f'przebieg {i+1}: analiza {times[-1]:.1f}s, odtwarzanie ~{f:.0f} fps (p95 klatki {sorted(d)[int(len(d)*.95)]:.0f} ms)')
    ok = min(fps) >= 24 and times[-1] < times[0] * 1.6 + 5
    print('WYNIK:', 'OK' if ok else 'PROBLEM'); br.close(); sys.exit(0 if ok else 1)

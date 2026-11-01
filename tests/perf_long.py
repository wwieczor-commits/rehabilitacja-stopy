"""Długi bieg (pętla filmu): fps / rozdzielczość / tempo odtwarzania / pamięć nie mogą się pogarszać. python3 tests/perf_long.py film.mp4 [sekundy] [tryb: closeup|pose]"""
import sys, json, os, time
from playwright.sync_api import sync_playwright
V = sys.argv[1] if len(sys.argv) > 1 else '/workspace/testmedia/stopa.mp4'
DUR = float(sys.argv[2]) if len(sys.argv) > 2 else 90
MODE = sys.argv[3] if len(sys.argv) > 3 else 'closeup'
PTS = json.loads(os.environ.get('PTS', '[[900,300],[585,318],[450,170]]'))
URL = f'http://127.0.0.1:8766/index.html?mode={MODE}&nosw=1'
JS = """()=>{const v=document.querySelector('video'),c=document.getElementById('canvas')||document.querySelector('canvas');const q=window.__rehab;
 return {t:+(performance.now()/1000).toFixed(1),fps:+q.fps.toFixed(1),rate:+v.playbackRate.toFixed(2),want:q.rate,adapt:q.adaptRate||null,gapEma:q.gapEma,vt:+v.currentTime.toFixed(2),cw:c.width,ch:c.height,
  series:q.series.length,prof:{tr:+(q.prof.track/q.prof.n).toFixed(1),rd:+(q.prof.render/q.prof.n).toFixed(1)},heapMB:performance.memory?+(performance.memory.usedJSHeapSize/1048576).toFixed(1):null,frames:q.rec?q.rec.frames.length:0,decoded:v.getVideoPlaybackQuality?v.getVideoPlaybackQuality().totalVideoFrames:null,dropped:v.getVideoPlaybackQuality?v.getVideoPlaybackQuality().droppedVideoFrames:null}}"""
with sync_playwright() as p:
    br = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'])
    pg = br.new_context(viewport={'width': 1440, 'height': 900}).new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_timeout(800)
    pg.set_input_files('#file-video', V)
    if MODE == 'closeup':
        pg.wait_for_function("window.__rehab.running && window.__rehab.cu && window.__rehab.cu.state==='pick'", timeout=30000); pg.wait_for_timeout(400)
        pg.locator('#view').scroll_into_view_if_needed(); box = pg.locator('#view').bounding_box()
        for x, y in PTS: pg.mouse.click(box['x'] + x / 1024 * box['width'], box['y'] + y / 576 * box['height']); pg.wait_for_timeout(200)
        pg.evaluate("document.querySelector('#v-play').click()")
    else:
        pg.wait_for_function("window.__rehab.running", timeout=60000)
    pg.evaluate("document.getElementById('v-name') && 0")
    t0 = time.time(); rows = []; cdp = pg.context.new_cdp_session(pg); TH = float(os.environ.get('THROTTLE', 0)); on = False
    while time.time() - t0 < DUR:
        if TH:  # chwilowe spowolnienie CPU w środku biegu (10–25 s) – tempo ma spaść, a potem WRÓCIĆ do ×1
            el = time.time() - t0
            if 10 <= el < 25 and not on: cdp.send('Emulation.setCPUThrottlingRate', {'rate': TH}); on = True; print('--- CPU throttle ON')
            if el >= 25 and on: cdp.send('Emulation.setCPUThrottlingRate', {'rate': 1}); on = False; print('--- CPU throttle OFF')
        pg.wait_for_timeout(5000); r = pg.evaluate(JS); rows.append(r); print(json.dumps(r), flush=True)
    print('errs', errs)
    br.close()

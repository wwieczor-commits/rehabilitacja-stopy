"""Tryb „Zbliżenie stopy” na prywatnym filmie: python3 tests/run_cu.py [plik.mp4] [rate]"""
import sys, json, os
from playwright.sync_api import sync_playwright
URL=os.environ.get('URL','http://127.0.0.1:8766/index.html?mode=closeup&nosw=1')
VID=sys.argv[1] if len(sys.argv)>1 else '/workspace/testmedia/stopa.mp4'
RATE=float(sys.argv[2]) if len(sys.argv)>2 else 1
PTS=json.loads(os.environ.get('PTS','[[900,300],[585,318],[450,170]]'))  # w pikselach klatki 1024x576
OUT=os.environ.get('OUT','/workspace/cu_out.json')
SH=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','screenshots')
with sync_playwright() as p:
    br=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox','--autoplay-policy=no-user-gesture-required','--enable-unsafe-swiftshader'])
    pg=br.new_page(viewport={'width':1440,'height':900}); errs=[]
    pg.on('pageerror',lambda e:errs.append('pageerror: '+str(e)))
    pg.on('console',lambda m:errs.append('console.error: '+m.text) if m.type=='error' else None)
    pg.goto(URL); pg.wait_for_timeout(800)
    pg.evaluate(f"document.querySelector('#seg-speed [data-r=\"{RATE}\"]') && 0")
    pg.set_input_files('#file-video',VID)
    pg.wait_for_function("window.__rehab.running && window.__rehab.cu && window.__rehab.cu.state==='pick'",timeout=30000)
    pg.wait_for_timeout(500)
    pg.evaluate(f"document.querySelector('#seg-speed button[data-r=\"{RATE}\"]')?.click()")
    box=pg.locator('#view').bounding_box()
    for (x,y) in PTS:
        pg.mouse.click(box['x']+x/1024*box['width'],box['y']+y/576*box['height']); pg.wait_for_timeout(200)
    pg.locator('#stage').screenshot(path=f'{SH}/cu-1-punkty.png')
    print('state',pg.evaluate("__rehab.cu.state"))
    pg.click('#btn-rec')
    shots=[3,8,12,16]
    import time
    t0=time.time()
    while time.time()-t0<300:
        st=pg.evaluate("[!!__rehab.rec,__rehab.mt]")
        if not st[0]: break
        if shots and st[1]>=shots[0]:
            pg.locator('#stage').screenshot(path=f'{SH}/cu-t{shots[0]:02d}s.png'); shots.pop(0)
        pg.wait_for_timeout(150)
    res=pg.evaluate("""()=>{const r=__rehab.last,s=__rehab.lastSession;return {dur:r.dur,n:r.frames.length,reps:r.reps,sets:r.sets,ankle:s&&s.ankle,m:s&&s.m,frames:r.frames.map(f=>[f.t,f.a])}}""")
    json.dump(res,open(OUT,'w'))
    print('dur',res['dur'],'n',res['n'],'reps',res['reps'],'ankle',res['ankle']); print('errs',errs)
    pg.evaluate('window.scrollTo(0,0)'); pg.wait_for_timeout(500); pg.screenshot(path=f'{SH}/cu-3-koniec.png')
    br.close()

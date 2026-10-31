import sys, os, json
from playwright.sync_api import sync_playwright
URL='http://127.0.0.1:8766/index.html'
with sync_playwright() as p:
    br=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox','--autoplay-policy=no-user-gesture-required','--enable-unsafe-swiftshader'])
    pg=br.new_page(viewport={'width':1440,'height':900}); errs=[]
    pg.on('pageerror',lambda e:errs.append('pageerror: '+str(e)))
    pg.on('console',lambda m:errs.append('console.error: '+m.text) if m.type=='error' else None)
    pg.goto(URL); pg.wait_for_timeout(1500)
    print(errs)
    pg.screenshot(path='/workspace/shot_smoke.png')
    br.close()

"""Test trenera głosowego „Rehabilitacja stopy” (Playwright, emulacja telefonu, speechSynthesis podmieniony na szpiega).
Uruchom:  python3 tests/test_coach.py http://127.0.0.1:8766/index.html?nosw=1
Wymaga: Chrome (/usr/bin/google-chrome); filmy testowe (prywatne, poza repo): FAKE_VIDEO (y4m), LONG_VIDEO (mp4)."""
import sys, os, json
from playwright.sync_api import sync_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8766/index.html?nosw=1'
FAKE = os.environ.get('FAKE_VIDEO', '/workspace/testmedia/squat.y4m')
LONG = os.environ.get('LONG_VIDEO', '/workspace/testmedia/squat_long.mp4')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', f'--use-file-for-fake-video-capture={FAKE}', '--no-sandbox',
        '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader']
MOCK = """
(()=>{ window.__spoken=[]; window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.volume=1;this.rate=1;this.pitch=1;this.lang='';this.voice=null;this.onend=null;this.onerror=null}};
  const fake={speaking:false,pending:false,paused:false,_u:null,
    getVoices(){return [{name:'Zosia (pl-PL)',lang:'pl-PL',voiceURI:'pl-zosia',default:false,localService:true},{name:'Samantha',lang:'en-US',voiceURI:'en-sam',default:true,localService:true}]},
    speak(u){ window.__spoken.push({t:u.text,vol:u.volume,rate:u.rate,lang:u.lang,voice:u.voice&&u.voice.name,at:Date.now()}); this.speaking=true; this._u=u;
      setTimeout(()=>{this.speaking=false; u.onend&&u.onend({})}, Math.min(500, 40+u.text.length*5)) },
    cancel(){ this.speaking=false; this._u=null }, pause(){}, resume(){}, addEventListener(){}, removeEventListener(){}, onvoiceschanged:null};
  Object.defineProperty(window,'speechSynthesis',{value:fake,configurable:true});
  // sterownik syntetycznych powtórzeń (czas rzeczywisty, 10 próbek/s)
  window.__drive = async (steps, key) => { const S=__rehab, api=__rehabApi; for (const [v,sec] of steps){ const n=Math.round(sec*10); for(let i=0;i<n;i++){ S.nPose++; S.synT=(S.synT||0)+0.1; api.updateReps(S.synT,{[key||'heel']:v}); await new Promise(r=>setTimeout(r,100)); } } };
})();
"""
res = []
def check(n, ok, info=''):
    res.append(bool(ok)); print(('PASS' if ok else 'FAIL'), n, str(info)[:300], flush=True)
def spoken(pg): return [s['t'] for s in pg.evaluate('window.__spoken') if s['t'].strip()]
def subseq(seq, want):
    i = 0
    for s in seq:
        if i < len(want) and want[i] in s: i += 1
    return i == len(want)
def setin(pg, id, v): pg.evaluate("([id,v])=>{const e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event('change'))}", [id, str(v)])

with sync_playwright() as p:
    d = dict(p.devices['Pixel 7']); d.pop('default_browser_type', None)
    br = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=ARGS)
    ctx = br.new_context(**d, permissions=['camera'], accept_downloads=True); pg = ctx.new_page()
    pg.add_init_script(MOCK)
    errs = []
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    pg.goto(URL, wait_until='load'); pg.wait_for_timeout(1000)
    check('Coach załadowany', pg.evaluate('typeof Coach==="object"&&Coach.supported'))
    check('przyciski głosu: wyciszenie + ustawienia na podglądzie i w pasku dolnym', all(pg.is_visible(s) for s in ['#d-voice', '#s-voice', '#s-voicecfg']))
    iw = pg.evaluate('innerWidth')
    boxes = pg.evaluate("[...document.querySelectorAll('#dock .btn')].filter(b=>b.offsetParent).map(b=>{const r=b.getBoundingClientRect();return [r.left,r.right]})")
    check('dolny pasek mieści się w ekranie', all(b[0] >= 0 and b[1] <= iw for b in boxes) and all(boxes[i][1] <= boxes[i+1][0]+0.5 for i in range(len(boxes)-1)), str(boxes))
    pg.tap('#s-voicecfg'); pg.wait_for_selector('#coach-panel', state='visible')
    check('panel ustawień: lista głosów z polskim', 'pl-PL' in pg.inner_text('#coach-voice'))
    pg.fill('#coach-vol', '0.7'); pg.dispatch_event('#coach-vol', 'input'); pg.fill('#coach-rate', '1.1'); pg.dispatch_event('#coach-rate', 'input')
    pg.tap('#coach-level button[data-l="chatty"]'); pg.tap('#coach-test'); pg.wait_for_timeout(800)
    tst = [s for s in pg.evaluate('window.__spoken') if 'trener' in s['t']]
    check('Test głosu: pl-PL, głośność i tempo z ustawień', tst and tst[-1]['lang'].startswith('pl') and abs(tst[-1]['vol']-.7)<.01 and abs(tst[-1]['rate']-1.1)<.01, json.dumps(tst[-1:]))
    pg.tap('#coach-close'); pg.reload(wait_until='load'); pg.wait_for_timeout(800)
    check('ustawienia zapamiętane po przeładowaniu', pg.evaluate('Coach.cfg.vol')==.7 and pg.evaluate('Coach.cfg.level')=='chatty', pg.evaluate('JSON.stringify(Coach.cfg)'))
    pg.evaluate('Coach.set({level:"normal",vol:1,rate:1})')
    pg.tap('#d-voice'); pg.wait_for_timeout(150); n0 = len(spoken(pg)); pg.evaluate('Coach.say("nie",{p:2})'); pg.wait_for_timeout(400)
    check('wyciszenie działa', pg.evaluate('Coach.cfg.on')==False and len(spoken(pg))==n0)
    pg.tap('#d-voice'); pg.wait_for_timeout(600); check('włączenie głosu potwierdzone głosem', any('włączony' in s for s in spoken(pg)))

    # ---- kamera: start, wprowadzenie, odliczanie, anulowanie
    pg.evaluate('window.__spoken.length=0')
    pg.tap('#d-cam'); pg.wait_for_function('__rehab.running', timeout=30000); pg.wait_for_timeout(1200)
    check('kamera: komunikat startowy', any('Kamera uruchomiona' in s for s in spoken(pg)), str(spoken(pg)))
    pg.evaluate("__rehabApi.setExercise('heel')"); pg.wait_for_timeout(3500)
    check('wybór ćwiczenia: nazwa ćwiczenia', any('Ćwiczenie:' in s for s in spoken(pg)), str(spoken(pg)[-2:]))
    for k, v in [('in-sets', 2), ('in-reps', 4), ('in-hold', 5), ('in-rest', 12)]: setin(pg, k, v)
    pg.evaluate('window.__spoken.length=0')
    pg.tap('#d-rec'); pg.wait_for_timeout(300)
    check('start: przycisk zmienia się na „Anuluj”', 'Anuluj' in pg.inner_text('#d-rec'), pg.inner_text('#d-rec'))
    pg.tap('#d-rec'); pg.wait_for_timeout(600)
    check('anulowanie przed startem: brak pomiaru', pg.evaluate('!__rehab.rec') and 'Pomiar' in pg.inner_text('#d-rec'), pg.inner_text('#d-rec'))
    pg.evaluate('window.__spoken.length=0'); pg.tap('#d-rec')
    pg.wait_for_function('!!__rehab.rec', timeout=30000)
    s = spoken(pg); print('   start:', s)
    check('start: wprowadzenie (ćwiczenie, cel, bezpieczeństwo)', any('Ćwiczenie:' in x and 'Cel: 2 serie po 4 powtórzenia' in x and 'Przy bólu przerwij' in x and 'Utrzymaj 5 sekund' in x for x in s), str(s[:1]))
    check('start: odliczanie 3, 2, 1, Start', subseq(s, ['3', '2', '1', 'Start']), str(s))
    # ---- syntetyczne powtórzenia (pętla wideo zatrzymana, wartości wstrzykiwane)
    pg.evaluate('cancelAnimationFrame(__rehab.raf)'); setin(pg, 'in-hold', 5); pg.evaluate('__rehabApi.resetReps()'); pg.wait_for_timeout(300); pg.evaluate('window.__spoken.length=0')
    pg.evaluate("__drive([[0,0.5],[20,5.8],[0,1.0]])")
    s = spoken(pg); print('   hold:', s)
    check('trzymanie: Trzymaj, 3, 2, 1, Rozluźnij', subseq(s, ['Trzymaj', '3', '2', '1', 'Rozluźnij']), str(s))
    setin(pg, 'in-hold', 0); pg.evaluate('__rehabApi.resetReps()'); pg.wait_for_timeout(300); pg.evaluate('window.__spoken.length=0')
    pg.evaluate("__drive([[0,0.3],[20,1.2],[0,1.2],[20,1.2],[0,1.2],[20,1.2],[0,1.2],[20,1.2],[0,1.2]])")
    s = spoken(pg); print('   serie:', s)
    check('powtórzenia liczone na głos', subseq(s, ['1', '2', '3. Ostatnie powtórzenie']), str(s))
    check('koniec serii + przerwa', any('Seria 1 z 2 ukończona. Odpocznij 12 sekund' in x for x in s), str(s[-3:]))
    pg.wait_for_timeout(12500)
    s = spoken(pg); print('   przerwa:', s[-8:])
    check('odliczanie przerwy: 5, 3, 2, 1, zaczynamy serię 2', subseq(s[s.index(next(x for x in s if 'Odpocznij' in x)):], ['Pięć sekund', '3', '2', '1', 'Zaczynamy serię 2']), str(s[-8:]))
    # ostrzeżenia: za szybko + spadek zakresu, cel sesji
    pg.evaluate('window.__spoken.length=0'); pg.evaluate("S=__rehab; Coach.resetCooldowns()")
    setin(pg, 'in-sets', 1); setin(pg, 'in-reps', 8); pg.evaluate('__rehabApi.resetReps()'); pg.wait_for_timeout(300)
    steps = [[0,0.5]] + [[30,0.5],[0,0.5]]*3 + [[17,0.5],[0,0.5]]*5
    pg.evaluate("(s)=>__drive(s)", steps)
    s = spoken(pg); print('   tempo/zakres:', s)
    check('ostrzeżenie o zbyt szybkim tempie', any('Zwolnij' in x for x in s))
    check('ostrzeżenie o spadku zakresu', any('Zakres ruchu spada' in x for x in s))
    check('cel sesji osiągnięty', any('Cel sesji osiągnięty' in x for x in s), str(s[-2:]))
    # utrata śledzenia (nPose nie rośnie)
    pg.evaluate('window.__spoken.length=0'); pg.wait_for_timeout(3500)
    s = spoken(pg); check('utrata śledzenia: „popraw ustawienie kamery”', any('Nie widzę stopy' in x and 'Popraw' in x for x in s), str(s))
    pg.evaluate('window.__spoken.length=0'); pg.evaluate("__drive([[0,1.5]])")
    check('powrót śledzenia', any('Znów widzę stopę' in x for x in spoken(pg)), str(spoken(pg)))
    pg.evaluate('window.__spoken.length=0'); pg.tap('#d-rec'); pg.wait_for_timeout(1500)
    s = spoken(pg); check('koniec pomiaru bez danych: komunikat', any('Koniec pomiaru' in x for x in s), str(s))
    # poziom minimalny: bez numerów powtórzeń
    pg.evaluate('Coach.set({level:"minimal"})'); pass
    pg.evaluate('window.__spoken.length=0')
    setin(pg, 'in-sets', 2); setin(pg, 'in-reps', 2); setin(pg, 'in-rest', 0)
    pg.evaluate("document.getElementById('btn-rec').click()"); pg.wait_for_timeout(500)
    s = spoken(pg); check('poziom minimalny: bez wprowadzenia', not any('Cel:' in x for x in s), str(s))
    pg.wait_for_function('!!__rehab.rec', timeout=15000); pg.evaluate('cancelAnimationFrame(__rehab.raf)'); setin(pg, 'in-reps', 2); pg.evaluate('__rehabApi.resetReps()'); pg.wait_for_timeout(300); pg.evaluate('window.__spoken.length=0')
    pg.evaluate("__drive([[0,0.3],[20,1.2],[0,1.2],[20,1.2],[0,1.5]])")
    s = spoken(pg); print('   minimal:', s)
    check('poziom minimalny: tylko koniec serii (bez numerów)', any('Seria 1 z 2 ukończona' in x for x in s) and not any(x.strip() in ('1', '2') or 'Ostatnie' in x for x in s), str(s))
    pg.evaluate("document.getElementById('btn-rec').click()"); pg.wait_for_timeout(800)
    pg.evaluate('Coach.set({level:"normal"})')

    # ---- film: podsumowanie z porównaniem do poprzedniej sesji + PDF
    pg.reload(wait_until='load'); pg.wait_for_timeout(800); pg.evaluate('window.__spoken.length=0')
    pg.set_input_files('#file-video', LONG); pg.wait_for_function('__rehab.nPose>10', timeout=90000); pg.wait_for_timeout(800)
    check('film: komunikat startowy', any('Film wczytany' in s for s in spoken(pg)), str(spoken(pg)))
    pg.evaluate('window.__spoken.length=0'); pg.tap('#d-rec'); pg.wait_for_timeout(700)
    check('film: start bez odliczania', pg.evaluate('!!__rehab.rec') and not pg.query_selector('.coach-cd.on'))
    pg.wait_for_timeout(6000)
    pg.evaluate("""()=>{const S=__rehab,r=S.rec;for(const side of ['L','R'])S.hist.push({id:'prev'+side,ts:'2026-01-01T10:00:00Z',side,ex:r.ex,m:{key:({pump:'ankle',heel:'heel',wall:'tibia'})[r.ex],unit:'%',range:999,min:0,max:999,mean:0},reps:1,sets:0})}""")
    pg.tap('#d-rec'); pg.wait_for_timeout(1500)
    s = spoken(pg); print('   podsumowanie:', s)
    summ = [x for x in s if 'Koniec pomiaru' in x]
    check('podsumowanie: zakres + porównanie z poprzednią sesją', summ and 'Zakres ruchu' in summ[0] and 'mniejszy niż poprzednio' in summ[0], str(summ)[:300])
    check('przypomnienie o bezpieczeństwie po sesji', any('przy bólu' in x.lower() for x in s))
    pg.evaluate('window.__spoken.length=0'); pg.evaluate('__rehabApi.makeReport()'); pg.wait_for_timeout(6000)
    check('raport PDF gotowy (głos)', any('Raport PDF gotowy' in x for x in spoken(pg)), str(spoken(pg)))
    check('brak błędów JS', not errs, '; '.join(errs)[:500])
    ctx.close(); br.close()
print(f'\n{sum(res)}/{len(res)} PASS'); sys.exit(0 if all(res) else 1)

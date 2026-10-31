/* Coach – głosowy trener w tle (Web Speech API / speechSynthesis).
   © Wojciech Wieczorek. Jeden plik, używany w aplikacjach BikeRc Motion i Rehabilitacja stopy.
   Funkcje: kolejka z priorytetami, ograniczanie częstotliwości (nie mówi „sam na siebie”), odblokowanie audio na iOS
   przy pierwszym dotknięciu, ustawienia (wł./wył., głośność, tempo, głos, szczegółowość) w localStorage,
   przycisk „Test głosu”, przycisk wyciszenia, odliczanie 3-2-1 z nakładką na obrazie.
   Użycie:  Coach.say('Tekst', {p:1, v:'normal', key:'klucz', cd:10000, ttl:6000});
            Coach.bindMute(przycisk); Coach.bindSettings(przycisk); Coach.countdown({from:3, parent:element, onDone(){}}); */
(function () {
  'use strict';
  if (window.Coach) return;
  const LSK = 'bikerc.coach.v1';
  const LV = { minimal: 0, normal: 1, chatty: 2 };
  const LV_PL = { minimal: 'Minimalny', normal: 'Normalny', chatty: 'Rozmowny' };
  const LV_DESC = {
    minimal: 'Tylko ostrzeżenia, start, koniec i podsumowanie.',
    normal: 'Ostrzeżenia, odczyty, liczenie powtórzeń i podsumowanie.',
    chatty: 'Wszystko z „Normalnego” plus wskazówki tempa, zachęty i dokładniejsze odczyty.'
  };
  const DEF = { on: true, vol: 1, rate: 1, voice: '', level: 'normal' };
  const GAP = 260;                    // minimalna przerwa między wypowiedziami (ms)
  const MAXQ = 4;
  const supported = typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined';
  const synth = supported ? window.speechSynthesis : null;

  let cfg = Object.assign({}, DEF);
  try { const o = JSON.parse(localStorage.getItem(LSK) || '{}'); if (o && typeof o === 'object') { if (typeof o.on === 'boolean') cfg.on = o.on; if (isFinite(o.vol)) cfg.vol = Math.min(1, Math.max(0, +o.vol)); if (isFinite(o.rate)) cfg.rate = Math.min(1.6, Math.max(.6, +o.rate)); if (typeof o.voice === 'string') cfg.voice = o.voice; if (LV[o.level] != null) cfg.level = o.level } } catch (e) { }
  const save = () => { try { localStorage.setItem(LSK, JSON.stringify(cfg)) } catch (e) { } };

  let voices = [], unlocked = false, queue = [], cur = null, gapTimer = null, wd = null, lastEnd = 0, uid = 0;
  const keyLast = {}, listeners = [], log = [];
  const emit = () => { for (const f of listeners) try { f(cfg) } catch (e) { } };

  /* ---------- polskie liczebniki i odmiana ---------- */
  const plural = (n, f) => { n = Math.abs(Math.round(n)); const a = n % 10, b = n % 100; return n === 1 ? f[0] : (a >= 2 && a <= 4 && !(b >= 12 && b <= 14)) ? f[1] : f[2] };
  const pl = {
    plural,
    num: (n, f) => `${Math.round(n)} ${plural(n, f)}`,
    deg: n => `${Math.round(n)} ${plural(n, ['stopień', 'stopnie', 'stopni'])}`,
    sec: n => `${Math.round(n)} ${plural(n, ['sekunda', 'sekundy', 'sekund'])}`,
    secAcc: n => `${Math.round(n)} ${plural(n, ['sekundę', 'sekundy', 'sekund'])}`,
    rpm: n => `${Math.round(n)} ${plural(n, ['obrót', 'obroty', 'obrotów'])} na minutę`,
    reps: n => `${Math.round(n)} ${plural(n, ['powtórzenie', 'powtórzenia', 'powtórzeń'])}`,
    sets: n => `${Math.round(n)} ${plural(n, ['serię', 'serie', 'serii'])}`
  };

  /* ---------- głosy ---------- */
  let panel = null, selVoice = null;
  function loadVoices() {
    try { voices = (synth && synth.getVoices()) || [] } catch (e) { voices = [] }
    renderVoiceOptions();
  }
  function pickVoice() {
    if (!voices.length) return null;
    if (cfg.voice) { const v = voices.find(x => x.voiceURI === cfg.voice); if (v) return v }
    return voices.find(v => /^pl[-_]PL$/i.test(v.lang)) || voices.find(v => /^pl/i.test(v.lang)) ||
      voices.find(v => /polish|polski/i.test(v.name)) || null;     // brak polskiego: przeglądarka użyje domyślnego dla lang=pl-PL
  }
  if (synth) { loadVoices(); try { synth.addEventListener ? synth.addEventListener('voiceschanged', loadVoices) : (synth.onvoiceschanged = loadVoices) } catch (e) { } let n = 0; const iv = setInterval(() => { if (voices.length || ++n > 10) clearInterval(iv); else loadVoices() }, 500) }

  /* ---------- kolejka ---------- */
  function drop(q) { if (q && q.onend) { const f = q.onend; q.onend = null; try { f(false) } catch (e) { } } }
  const est = (t, r) => Math.min(30000, 2500 + t.length * 85 / Math.max(.5, r));
  function pump() {
    if (cur || gapTimer) return;
    const now = performance.now();
    const keep = []; for (const q of queue) { if (now - q.t > q.ttl) drop(q); else keep.push(q) } queue = keep;
    if (!queue.length) return;
    const wait = GAP - (now - lastEnd);
    if (wait > 0) { gapTimer = setTimeout(() => { gapTimer = null; pump() }, wait); return }
    speak(queue.shift());
  }
  function speak(it) {
    cur = it; it.id = ++uid;
    log.push({ t: Date.now(), text: it.text, p: it.p, key: it.key }); if (log.length > 300) log.shift();
    clearTimeout(wd); wd = setTimeout(() => finish(it, true), est(it.text, cfg.rate));
    if (!synth) { setTimeout(() => finish(it), 30); return }
    try {
      if (synth.paused) synth.resume();
      const u = new SpeechSynthesisUtterance(it.text); u.lang = 'pl-PL';
      const v = pickVoice(); if (v) { u.voice = v; u.lang = v.lang || 'pl-PL' }
      u.volume = cfg.vol; u.rate = cfg.rate; u.pitch = 1;
      u.onend = u.onerror = () => finish(it); it.u = u;      // referencja zapobiega zbieraniu przez GC (Chrome)
      synth.speak(u);
    } catch (e) { finish(it) }
  }
  function finish(it, byWatchdog) {
    if (cur !== it) return;
    clearTimeout(wd); cur = null; lastEnd = performance.now();
    if (byWatchdog && synth) try { synth.cancel() } catch (e) { }
    const f = it.onend; it.onend = null; if (f) try { f(true) } catch (e) { }
    pump();
  }
  function cancelCur() { if (!cur) return; const it = cur; cur = null; clearTimeout(wd); lastEnd = performance.now() + 120; try { synth && synth.cancel() } catch (e) { } drop(it) }

  /** Dodaje wypowiedź do kolejki.
   *  p: priorytet 0 (tylko gdy nic nie mówi) | 1 zwykły | 2 ważny | 3 krytyczny (przerywa). v: minimalna szczegółowość: minimal|normal|chatty.
   *  key+cd: limit częstotliwości dla klucza (ms); ttl: po tylu ms nieodtworzona wypowiedź wygasa; force: ignoruje wyłączenie głosu. */
  function say(text, o) {
    o = Object.assign({ p: 1, v: 'normal', ttl: 8000, key: '', cd: 0, force: false, interrupt: false, onend: null }, o);
    const fail = () => { drop({ onend: o.onend }); return false };
    if (!text) return fail();
    if (!o.force && (!cfg.on || LV[cfg.level] < LV[o.v])) return fail();
    const now = performance.now();
    if (o.key && o.cd && keyLast[o.key] && now - keyLast[o.key] < o.cd) return fail();
    if (o.p === 0 && (cur || queue.length)) return fail();
    if (o.key) { keyLast[o.key] = now; queue = queue.filter(q => { if (q.key === o.key) { drop(q); return false } return true }) }
    const it = { text: String(text), p: o.p, key: o.key, t: now, ttl: o.ttl, onend: o.onend };
    if (o.p >= 3 || o.interrupt) { queue = queue.filter(q => { if (q.p < o.p) { drop(q); return false } return true }); if (cur && cur.p < o.p) cancelCur() }
    else if (queue.length >= MAXQ) { let i = 0; for (let k = 1; k < queue.length; k++) if (queue[k].p < queue[i].p) i = k; if (queue[i].p <= o.p) drop(queue.splice(i, 1)[0]); else return fail() }
    let at = queue.length; while (at > 0 && queue[at - 1].p < it.p) at--; queue.splice(at, 0, it);
    pump(); return true;
  }
  /** Zwraca obietnicę rozwiązaną po wypowiedzeniu (lub od razu, gdy głos wyłączony / wypowiedź odrzucona). */
  const sayThen = (text, o) => new Promise(res => { say(text, Object.assign({}, o, { onend: () => res() })) });
  function stop() { queue.forEach(drop); queue = []; cancelCur() }
  const resetCooldowns = () => { for (const k in keyLast) delete keyLast[k] };

  /* ---------- odblokowanie audio (iOS wymaga gestu użytkownika) ---------- */
  function unlock() {
    if (unlocked) return; unlocked = true;
    for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) document.removeEventListener(ev, unlock, true);
    if (!synth) return;
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; u.lang = 'pl-PL'; synth.speak(u); synth.resume && synth.resume() } catch (e) { }
  }
  for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) document.addEventListener(ev, unlock, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop() });

  /* ---------- odliczanie z nakładką ---------- */
  let cdEl = null;
  function countdown(o) {
    o = Object.assign({ from: 3, parent: null, go: 'Start', speak: true, onTick: null, onDone: null }, o);
    if (!cdEl) { cdEl = document.createElement('div'); cdEl.className = 'coach-cd'; cdEl.setAttribute('aria-live', 'assertive') }
    (o.parent || document.body).appendChild(cdEl);
    let n = o.from, tm = 0, dead = false;
    const show = (t, go) => { cdEl.textContent = t; cdEl.classList.toggle('go', !!go); cdEl.classList.add('on') };
    const hide = () => { cdEl && cdEl.classList.remove('on') };
    const step = () => {
      if (dead) return;
      if (n <= 0) {
        show(o.go, true); if (o.speak && o.go) say(o.go, { p: 3, v: 'minimal', ttl: 1200 });
        dead = true; setTimeout(hide, 800); if (o.onDone) o.onDone(); return;
      }
      show(String(n)); if (o.speak) say(String(n), { p: 3, v: 'minimal', ttl: 1100 });
      if (o.onTick) o.onTick(n); n--; tm = setTimeout(step, 1000);
    };
    step();
    return { cancel() { if (dead) return; dead = true; clearTimeout(tm); hide() }, get active() { return !dead } };
  }

  /* ---------- UI: przycisk wyciszenia, panel ustawień ---------- */
  const css = document.createElement('style');
  css.textContent = `
.coach-cd{position:absolute;left:50%;top:42%;transform:translate(-50%,-50%) scale(.8);z-index:6;pointer-events:none;opacity:0;font:900 italic clamp(84px,24vw,170px)/1 var(--head,Archivo,Arial,sans-serif);color:var(--teal,#2EC4B6);text-shadow:0 4px 28px rgba(0,0,0,.8),0 0 6px rgba(0,0,0,.9);transition:opacity .15s,transform .15s}
.coach-cd.on{opacity:1;transform:translate(-50%,-50%) scale(1)}.coach-cd.go{font-size:clamp(54px,15vw,110px);color:var(--text,#F2F4F3)}
#coach-panel{position:fixed;inset:0;z-index:120;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center}
#coach-panel[hidden]{display:none}
#coach-panel .cp{width:min(520px,100%);max-height:92dvh;overflow:auto;background:var(--panel,#2B2A2A);border:1px solid var(--line,#4A4848);border-radius:18px 18px 0 0;padding:18px 18px calc(16px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:12px;color:var(--text,#F2F4F3);font-family:var(--body,Inter,system-ui,sans-serif)}
@media(min-width:700px){#coach-panel{align-items:center}#coach-panel .cp{border-radius:14px}}
#coach-panel h3{margin:0;font:900 italic 20px var(--head,Archivo,Arial,sans-serif)}
#coach-panel .cr{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--muted,#A9AFAE)}
#coach-panel .cr b{color:var(--text,#F2F4F3);font-weight:700;font-size:14px;display:flex;justify-content:space-between;gap:8px}
#coach-panel .cr b em{font-style:normal;color:var(--teal,#2EC4B6);font-variant-numeric:tabular-nums}
#coach-panel select,#coach-panel input[type=range]{width:100%;min-height:40px;accent-color:var(--teal,#2EC4B6)}
#coach-panel select{background:var(--bg-deep,#1F1E1E);color:var(--text,#F2F4F3);border:1px solid var(--line,#4A4848);border-radius:6px;padding:0 10px;font:inherit}
#coach-panel .csw{display:flex;align-items:center;justify-content:space-between;gap:12px;font-weight:700;font-size:15px}
#coach-panel .csw input{width:22px;height:22px;accent-color:var(--teal,#2EC4B6)}
#coach-panel .cseg{display:flex;gap:6px}
#coach-panel .cseg button,#coach-panel .cbtn{appearance:none;min-height:44px;border-radius:6px;border:1px solid var(--line,#4A4848);background:var(--bg-deep,#1F1E1E);color:var(--text,#F2F4F3);font:700 14px var(--body,Inter,system-ui,sans-serif);cursor:pointer;padding:0 12px}
#coach-panel .cseg button{flex:1}
#coach-panel .cseg button[aria-pressed=true]{background:var(--teal,#2EC4B6);border-color:var(--teal,#2EC4B6);color:var(--bg-deep,#1F1E1E)}
#coach-panel .cbtn.primary{background:var(--teal,#2EC4B6);border-color:var(--teal,#2EC4B6);color:var(--bg-deep,#1F1E1E)}
#coach-panel .cnote{font-size:12px;color:var(--dim,#7C8584);margin:0;line-height:1.45}
#coach-panel .crow{display:flex;gap:8px}#coach-panel .crow .cbtn{flex:1}`;
  document.head.appendChild(css);

  function renderVoiceOptions() {
    if (!selVoice) return;
    const pls = voices.filter(v => /^pl/i.test(v.lang)), rest = voices.filter(v => !/^pl/i.test(v.lang));
    const opt = v => `<option value="${v.voiceURI.replace(/"/g, '&quot;')}">${v.name.replace(/</g, '')} (${v.lang})</option>`;
    selVoice.innerHTML = '<option value="">Automatyczny (polski, jeśli dostępny)</option>' + (pls.length ? `<optgroup label="Polskie">${pls.map(opt).join('')}</optgroup>` : '') + (rest.length ? `<optgroup label="Inne języki">${rest.map(opt).join('')}</optgroup>` : '');
    selVoice.value = voices.some(v => v.voiceURI === cfg.voice) ? cfg.voice : '';
    const n = panel && panel.querySelector('#coach-vnote'); if (n) n.textContent = !supported ? 'Ta przeglądarka nie obsługuje syntezy mowy – trener będzie niemy.' : pls.length ? `Dostępne polskie głosy: ${pls.length}.` : 'Nie znaleziono polskiego głosu – zostanie użyty domyślny głos przeglądarki (może czytać po angielsku). Polski głos można doinstalować w ustawieniach systemu.';
  }
  function buildPanel() {
    panel = document.createElement('div'); panel.id = 'coach-panel'; panel.hidden = true;
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', 'coach-title');
    panel.innerHTML = `<div class="cp">
  <h3 id="coach-title">🎙 Trener głosowy</h3>
  <label class="csw"><span>Głos trenera włączony</span><input type="checkbox" id="coach-on"></label>
  <label class="cr"><b>Głośność <em id="coach-vol-v"></em></b><input type="range" id="coach-vol" min="0" max="1" step="0.05"></label>
  <label class="cr"><b>Tempo mowy <em id="coach-rate-v"></em></b><input type="range" id="coach-rate" min="0.6" max="1.6" step="0.05"></label>
  <label class="cr"><b>Głos</b><select id="coach-voice" aria-label="Wybór głosu"></select></label>
  <p class="cnote" id="coach-vnote"></p>
  <div class="cr"><b>Szczegółowość</b><div class="cseg" id="coach-level" role="group" aria-label="Szczegółowość komunikatów">${Object.keys(LV).map(k => `<button type="button" data-l="${k}" aria-pressed="false">${LV_PL[k]}</button>`).join('')}</div><span id="coach-level-d"></span></div>
  <div class="crow"><button type="button" class="cbtn primary" id="coach-test">🔊 Test głosu</button><button type="button" class="cbtn" id="coach-close">Zamknij</button></div>
  <p class="cnote">Na iPhonie głos włącza się po pierwszym dotknięciu ekranu. Jeśli nic nie słychać, sprawdź głośność i przełącznik wyciszenia. Komunikaty mają charakter pomocniczy i orientacyjny.</p>
</div>`;
    document.body.appendChild(panel);
    selVoice = panel.querySelector('#coach-voice');
    const $ = s => panel.querySelector(s);
    const sync = () => {
      $('#coach-on').checked = cfg.on; $('#coach-vol').value = cfg.vol; $('#coach-vol-v').textContent = Math.round(cfg.vol * 100) + '%';
      $('#coach-rate').value = cfg.rate; $('#coach-rate-v').textContent = cfg.rate.toFixed(2).replace('.', ',') + '×';
      panel.querySelectorAll('#coach-level button').forEach(b => b.setAttribute('aria-pressed', b.dataset.l === cfg.level)); $('#coach-level-d').textContent = LV_DESC[cfg.level];
      if (selVoice && voices.some(v => v.voiceURI === cfg.voice)) selVoice.value = cfg.voice;
    };
    $('#coach-on').onchange = e => api.set({ on: e.target.checked });
    $('#coach-vol').oninput = e => api.set({ vol: +e.target.value });
    $('#coach-rate').oninput = e => api.set({ rate: +e.target.value });
    selVoice.onchange = e => api.set({ voice: e.target.value });
    $('#coach-level').onclick = e => { const b = e.target.closest('button'); if (b) api.set({ level: b.dataset.l }) };
    $('#coach-test').onclick = () => { stop(); say(`Cześć, tu Twój trener. Głośność ${Math.round(cfg.vol * 100)} procent. Tak będę do Ciebie mówić.`, { p: 3, force: true, v: 'minimal', ttl: 20000 }) };
    $('#coach-close').onclick = () => api.close();
    panel.addEventListener('click', e => { if (e.target === panel) api.close() });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) api.close() });
    listeners.push(sync); sync(); renderVoiceOptions();
  }

  const muteBtns = new Set();
  function paintMute() {
    for (const b of muteBtns) {
      const ico = cfg.on ? '🔊' : '🔇', lab = cfg.on ? 'Wycisz głos trenera' : 'Włącz głos trenera';
      const i = b.querySelector('i'); const sp = b.querySelector('span');
      if (i) { i.textContent = ico; if (sp) sp.textContent = cfg.on ? 'Głos' : 'Cisza' } else b.textContent = ico;
      b.setAttribute('aria-label', lab); b.title = lab; b.setAttribute('aria-pressed', String(!cfg.on)); b.classList.toggle('coach-off', !cfg.on);
    }
  }
  listeners.push(paintMute);

  const api = {
    supported, say, sayThen, stop, countdown, pl, resetCooldowns,
    get cfg() { return Object.assign({}, cfg) },
    get enabled() { return cfg.on },
    get level() { return cfg.level },
    get log() { return log },
    get unlocked() { return unlocked },
    get voice() { const v = pickVoice(); return v ? v.name : null },
    unlock,
    /** zmiana ustawień (zapis w localStorage) */
    set(o) {
      if ('on' in o) cfg.on = !!o.on; if ('vol' in o) cfg.vol = Math.min(1, Math.max(0, +o.vol)); if ('rate' in o) cfg.rate = Math.min(1.6, Math.max(.6, +o.rate));
      if ('voice' in o) cfg.voice = String(o.voice || ''); if ('level' in o && LV[o.level] != null) cfg.level = o.level;
      if (!cfg.on) stop(); save(); emit();
    },
    /** Przycisk wyciszenia: klik przełącza głos wł./wył.; ikona i etykieta aktualizują się same. */
    bindMute(btn) { if (!btn) return; muteBtns.add(btn); btn.addEventListener('click', () => { unlock(); api.set({ on: !cfg.on }); if (cfg.on) say('Głos włączony.', { p: 2, v: 'minimal', ttl: 3000 }) }); paintMute() },
    /** Przycisk otwierający panel ustawień. */
    bindSettings(btn) { if (btn) btn.addEventListener('click', () => api.open()) },
    open() { if (!panel) buildPanel(); emit(); panel.hidden = false; renderVoiceOptions(); panel.querySelector('#coach-test').focus() },
    close() { if (panel) panel.hidden = true; if (cur && cur.force) stop() },
    onChange(f) { listeners.push(f) }
  };
  window.Coach = api;
})();

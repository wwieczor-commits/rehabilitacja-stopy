/* Rehabilitacja stopy – © Wojciech Wieczorek. Pomiar zakresu ruchu kostki z kamery / filmu.
   Tryb „Cała noga”: MediaPipe PoseLandmarker (kolano, kostka, pięta, palce).
   Tryb „Zbliżenie stopy”: 3 punkty wskazane palcem + śledzenie (tracker.js), kąt goleń–stopa. */
import { PatchTracker, toGray, angleBetween, ZigZag } from './tracker.js';

const MP_VER = '0.10.21', JSPDF_VER = '2.5.2';
const CDN = {
  lib: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/vision_bundle.mjs`,
  wasm: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/wasm`,
  model: m => `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${m}/float16/latest/pose_landmarker_${m}.task`
};
const LOCAL = { lib: './assets/mediapipe/vision_bundle.mjs', wasm: './assets/mediapipe/wasm', model: m => `./assets/mediapipe/pose_landmarker_${m}.task` };
const $ = id => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const UA = navigator.userAgent;
const IS_IOS = /iPad|iPhone|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_MOBILE = IS_IOS || /Android|Mobi/i.test(UA) || qs.get('mobile') === '1';
const MOBILE_MQ = '(max-width:900px), (max-height:520px) and (orientation:landscape)';
const MAXSIDE = IS_MOBILE ? 960 : 1920, DPR_CAP = IS_MOBILE ? 1.5 : 2;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const SIDE_COL = { L: '#2EC4B6', R: '#FEDA75' };
const SIDE_PL = { L: 'Lewa', R: 'Prawa', auto: 'Auto' };
const VIS_MIN = 0.4;
const IDX = { L: { hip: 23, kn: 25, an: 27, hl: 29, ft: 31 }, R: { hip: 24, kn: 26, an: 28, hl: 30, ft: 32 } };
const BONES = [[23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32], [23, 24]];
const sideOfIdx = i => (i % 2 === 1 ? 'L' : 'R');
const FILE_ERR = 'Ta przeglądarka nie potrafi odczytać tego filmu (częsty problem: format .mov/HEVC z iPhone’a lub kodek spoza H.264). Wybierz film w formacie MP4 (H.264) albo nagraj nowy aparatem. iPhone: Ustawienia → Aparat → Formaty → „Najbardziej zgodne”. Możesz też skonwertować plik np. w HandBrake lub ffmpeg.';

/* ---------- definicje metryk i ćwiczeń ---------- */
const METRICS = {
  ankle: { id: 'ankle', pl: 'Kostka', hint: '+ grzbietowe / − podeszwowe', unit: '°', def: [-40, 20], dec: 0 },
  knee: { id: 'knee', pl: 'Kolano', hint: 'kąt zgięcia', unit: '°', def: [60, 180], dec: 0 },
  tibia: { id: 'tibia', pl: 'Goleń', hint: 'nachylenie od pionu', unit: '°', def: [-10, 40], dec: 0 },
  heel: { id: 'heel', pl: 'Pięta', hint: 'wysokość, % długości stopy', unit: '%', def: [0, 40], dec: 0 },
  front: { id: 'front', pl: 'Pięta od przodu', hint: '+ ewersja / − inwersja · eksperym.', unit: '°', def: [-20, 20], dec: 0 }
};
const EX = {
  pump: {
    id: 'pump', pl: 'Pompowanie stopą', ico: '🦶', long: 'Zgięcie grzbietowe i podeszwowe (pompowanie stopą)', metric: 'ankle',
    thrLab: 'Min. amplituda powtórzenia (°)', tgtLab: 'Cel do utrzymania: zgięcie grzbietowe (°)', thr: 8, tgt: 10, mode: 'zigzag',
    steps: ['Usiądź lub połóż się, noga wyprostowana, stopa swobodnie w powietrzu lub na podparciu pięty.', 'Kamera z boku, na wysokości kostki, prostopadle do stopy.', 'Pociągnij palce ku sobie (zgięcie grzbietowe +), potem wyprostuj stopę (podeszwowe −).', 'Ruch powolny, ok. 2–3 s na cykl, tylko w zakresie bez bólu.']
  },
  heel: {
    id: 'heel', pl: 'Wspięcie na palce', ico: '⬆️', long: 'Wspięcie na palce', metric: 'heel',
    thrLab: 'Próg uniesienia pięty (% długości stopy)', tgtLab: 'Cel do utrzymania: pięta (% długości stopy)', thr: 15, tgt: 15, mode: 'thr',
    steps: ['Stań bokiem do kamery, przytrzymaj się oparcia lub ściany.', 'Wznieś się powoli na palce, tak wysoko, jak to możliwe bez bólu.', 'Opuść pięty kontrolowanie – to jedno powtórzenie.', 'Mierzymy wysokość pięty względem długości stopy (kalibracja = stopa płasko na podłodze).']
  },
  wall: {
    id: 'wall', pl: 'Kolano do ściany', ico: '🧱', long: 'Przysiad przy ścianie / kolano do ściany', metric: 'tibia',
    thrLab: 'Próg nachylenia goleni (° od pionu)', tgtLab: 'Cel do utrzymania: nachylenie goleni (°)', thr: 20, tgt: 25, mode: 'thr',
    steps: ['Stań twarzą do ściany, stopa na podłodze, kamera z boku (widać stopę, kostkę i kolano).', 'Zginaj kolano ku ścianie, nie odrywając pięty od podłogi.', 'Zmierz największe nachylenie goleni, przy którym pięta pozostaje na ziemi, i przytrzymaj.', 'Wersja przysiadu: plecy przy ścianie, powoli zsuwaj się w dół, pięty na podłodze.']
  }
};
const EX_SVG = {
  pump: `<svg viewBox="0 0 150 120" aria-label="Schemat zgięcia grzbietowego i podeszwowego"><g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M95 8 L95 72" stroke="#F2F4F3" stroke-width="7"/><path d="M95 72 L38 80" stroke="#6FDCD1" stroke-width="6" stroke-dasharray="1 8"/><path d="M95 72 L40 52" stroke="#2EC4B6" stroke-width="6"/><path d="M95 72 L44 104" stroke="#FEDA75" stroke-width="6"/><path d="M62 72 A33 33 0 0 0 64 56" stroke="#2EC4B6" stroke-width="2"/><path d="M62 78 A33 33 0 0 0 66 96" stroke="#FEDA75" stroke-width="2"/></g><circle cx="95" cy="72" r="6" fill="#232222" stroke="#F2F4F3" stroke-width="3"/><g font-family="Inter,Arial" font-size="10" font-weight="700"><text x="6" y="46" fill="#2EC4B6">+ grzbietowe</text><text x="6" y="116" fill="#FEDA75">− podeszwowe</text><text x="102" y="30" fill="#7C8584">goleń</text></g></svg>`,
  heel: `<svg viewBox="0 0 150 120" aria-label="Schemat wspięcia na palce"><g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M80 8 L80 70" stroke="#F2F4F3" stroke-width="7"/><path d="M80 70 L112 100" stroke="#2EC4B6" stroke-width="6"/><path d="M20 106 L130 106" stroke="#7C8584" stroke-width="3"/><path d="M80 70 L50 100" stroke="#FEDA75" stroke-width="3" stroke-dasharray="2 6"/><path d="M80 74 L80 98" stroke="#2EC4B6" stroke-width="2" marker-end="url(#a)"/></g><circle cx="80" cy="70" r="6" fill="#232222" stroke="#F2F4F3" stroke-width="3"/><g font-family="Inter,Arial" font-size="10" font-weight="700"><text x="8" y="30" fill="#2EC4B6">pięta w górę</text><text x="8" y="44" fill="#7C8584">% długości stopy</text></g></svg>`,
  wall: `<svg viewBox="0 0 150 120" aria-label="Schemat kolano do ściany"><g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M132 8 L132 112" stroke="#7C8584" stroke-width="5"/><path d="M20 106 L132 106" stroke="#7C8584" stroke-width="3"/><path d="M60 104 L100 104" stroke="#2EC4B6" stroke-width="6"/><path d="M60 104 L88 44" stroke="#F2F4F3" stroke-width="7"/><path d="M60 104 L60 44" stroke="#7C8584" stroke-width="2" stroke-dasharray="3 5"/><path d="M60 80 A24 24 0 0 1 72 83" stroke="#FEDA75" stroke-width="2"/></g><circle cx="88" cy="44" r="6" fill="#232222" stroke="#FEDA75" stroke-width="3"/><g font-family="Inter,Arial" font-size="10" font-weight="700"><text x="8" y="26" fill="#FEDA75">nachylenie</text><text x="8" y="40" fill="#FEDA75">goleni</text><text x="100" y="20" fill="#7C8584">ściana</text></g></svg>`
};
const REF = { dorsi: 20, plantar: [-50, -40] };       // orientacyjnie
const CU_HELP = ['Stuknij punkt 1/3: oś goleni – punkt na łydce, wyżej od kostki', 'Stuknij punkt 2/3: kostka – wyniosłość kostki bocznej (blizna/guzek)', 'Stuknij punkt 3/3: przód stopy – staw palca V / bok stopy przy palcach'];

/* ---------- stan ---------- */
const S = {
  lib: null, landmarker: null, modelName: 'full', delegate: 'GPU', running: false, source: null, stream: null, fileUrl: null, fileName: null,
  side: 'auto', autoSide: 'R', visEma: { L: .5, R: .5 }, mirror: true, skel: true, labels: true, sel: 'ankle', win: 10,
  trackMode: 'pose', ex: 'pump', cfg: {}, injured: 'R', client: '',
  series: [], stats: {}, ema: {}, lastSeen: {}, cal: { ankle: 0, heel: 0 }, hbase: null, t0: 0, lastVT: -1, fpsN: 0, fpsT: 0, fps: 0, inferMs: 0, nPose: 0, lastPoseT: 0, noPoseSince: 0,
  mt: 0, userPaused: false, rate: 1, rec: null, last: null, raf: 0, errCount: 0, facing: IS_MOBILE ? 'environment' : 'user', camFacing: null, permitted: false, wake: null, vw: 0, vh: 0,
  lastLm: null, lastVals: null, reps: null, front: false, cu: null, hist: [], lastTs: 0
};
const video = $('video'), canvas = $('view'), ctx = canvas.getContext('2d', { willReadFrequently: false });
const fmt = (v, d = 0) => v == null || !isFinite(v) ? '–' : v.toFixed(d);
const sgn = (v, d = 0) => v == null || !isFinite(v) ? '–' : (v > 0.0001 ? '+' : v < -0.0001 ? '−' : '') + Math.abs(v).toFixed(d);
const mmss = s => { s = Math.max(0, Math.floor(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') };
const fmtT = t => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + String(s).padStart(2, '0') };
let toastT;
function toast(msg, err = false, ms = 4500) { const t = $('toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : ''); clearTimeout(toastT); toastT = setTimeout(() => t.className = '', ms) }
function pill(txt, cls) { const p = $('pill-model'); p.className = 'pill ' + (cls || ''); $('pill-model-t').textContent = txt }
const curSide = () => S.side === 'auto' ? (S.trackMode === 'closeup' ? S.injured : S.autoSide) : S.side;
const cfg = () => S.cfg[S.ex];
const clk = () => S.source === 'file' ? S.mt : performance.now() / 1000;
const effMirror = () => $('chk-mirror').checked && S.source === 'camera' && S.camFacing !== 'environment' && S.trackMode === 'pose';

/* ---------- ustawienia (localStorage) ---------- */
const LS = { set: 'rehab.settings.v1', hist: 'rehab.sessions.v1' };
function loadSettings() {
  let o = {}; try { o = JSON.parse(localStorage.getItem(LS.set) || '{}') } catch (e) { }
  S.ex = EX[o.ex] ? o.ex : 'pump'; S.injured = o.injured === 'L' ? 'L' : 'R'; S.client = o.client || '';
  S.trackMode = o.trackMode === 'closeup' ? 'closeup' : 'pose';
  S.modelName = o.model === 'heavy' ? 'heavy' : 'full'; S.side = ['L', 'R', 'auto'].includes(o.side) ? o.side : 'auto';
  for (const k in EX) S.cfg[k] = { thr: EX[k].thr, tgt: EX[k].tgt, sets: 3, reps: 15, hold: 0, rest: 20, ...(o.cfg && o.cfg[k] || {}) };
}
function saveSettings() { try { localStorage.setItem(LS.set, JSON.stringify({ ex: S.ex, injured: S.injured, client: S.client, trackMode: S.trackMode, model: S.modelName, side: S.side, cfg: S.cfg })) } catch (e) { } }
loadSettings();

/* ---------- MediaPipe ---------- */
async function loadLib() {
  if (S.lib) return S.lib;
  const order = qs.get('mp') === 'local' ? [LOCAL, CDN] : [CDN, LOCAL]; let lastErr;
  for (const src of order) { try { const mod = await import(src.lib); S.libSrc = src; S.lib = mod; return mod } catch (e) { lastErr = e; console.warn('Biblioteka niedostępna:', src.lib, e) } }
  throw lastErr;
}
async function initModel(name = S.modelName, delegate = S.delegate) {
  pill('Model: ładowanie…', 'warn');
  try {
    const lib = await loadLib(); const order = S.libSrc === LOCAL ? [LOCAL, CDN] : [CDN, LOCAL];
    const { PoseLandmarker, FilesetResolver } = lib; let lmk = null, lastErr;
    for (const src of order) {
      try {
        const fileset = await FilesetResolver.forVisionTasks(src.wasm);
        lmk = await PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: src.model(name), delegate }, runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: .5, minPosePresenceConfidence: .5, minTrackingConfidence: .5 });
        S.modelSrc = src === CDN ? 'CDN' : 'lokalnie'; break;
      } catch (e) { lastErr = e; console.warn('Model/wasm niedostępny:', src.wasm, e) }
    }
    if (!lmk) throw lastErr;
    S.landmarker?.close?.(); S.landmarker = lmk; S.modelName = name; S.delegate = delegate;
    pill(`Model: ${name === 'heavy' ? 'Heavy' : 'Full'} · ${delegate}`, 'ok'); return true;
  } catch (e) {
    console.error(e);
    if (delegate === 'GPU') { console.warn('Przełączam na CPU'); return initModel(name, 'CPU') }
    pill('Model: błąd ładowania', 'err'); toast('Nie udało się załadować modelu pozy. Tryb „Zbliżenie stopy” działa bez modelu.', true, 9000); return false;
  }
}
let modelPromise = null;
const ensureModel = () => modelPromise || (modelPromise = initModel());

/* ---------- kamera ---------- */
const secureOk = () => window.isSecureContext || location.protocol === 'file:';
function showHttpsWarn() {
  const w = $('https-warn'); if (secureOk()) { w.hidden = true; return }
  w.hidden = false; w.innerHTML = '<b>Kamera wymaga połączenia HTTPS.</b> Ta strona jest otwarta przez niezabezpieczone połączenie (' + location.protocol + '//' + location.host + '), więc przeglądarka zablokuje kamerę. Możesz wczytać film z telefonu albo otworzyć aplikację przez https://.';
}
showHttpsWarn();
async function listCams() {
  try {
    const sel = $('sel-cam'); if (!navigator.mediaDevices?.enumerateDevices) return;
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); const cur = sel.value;
    sel.innerHTML = '<option value="">Automatycznie (' + (S.facing === 'environment' ? 'tylna' : 'przednia') + ')</option>' + devs.map((d, i) => `<option value="${d.deviceId}">${(d.label || ('Kamera ' + (i + 1))).replace(/</g, '&lt;')}</option>`).join('');
    if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
    $('fld-cam').hidden = !(S.permitted && devs.length > 1);
  } catch (e) { console.warn(e) }
}
navigator.mediaDevices?.addEventListener?.('devicechange', listCams);
function camError(e) {
  const n = e && e.name;
  if (!navigator.mediaDevices?.getUserMedia) return secureOk() ? 'Ta przeglądarka nie obsługuje dostępu do kamery. Spróbuj Chrome (Android) lub Safari (iOS 14.3+).' : 'Kamera działa tylko przez HTTPS (lub localhost).';
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Brak zgody na użycie kamery. Zezwól na dostęp w ustawieniach przeglądarki (ikona kłódki) i spróbuj ponownie.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Nie znaleziono kamery spełniającej wymagania. Wybierz inną kamerę lub niższą rozdzielczość.';
  if (n === 'NotReadableError' || n === 'AbortError') return 'Kamera jest zajęta przez inną aplikację albo nie odpowiada. Zamknij inne programy korzystające z kamery.';
  return 'Nie można uzyskać dostępu do kamery: ' + (e && e.message || n || 'nieznany błąd');
}
function constraintSets() {
  const [w, h] = $('sel-res').value.split('x').map(Number); const id = $('sel-cam').value, fr = { frameRate: { ideal: 30, max: 30 } }; const sets = [];
  if (id) sets.push({ deviceId: { exact: id }, width: { ideal: w }, height: { ideal: h }, ...fr }); else sets.push({ facingMode: { ideal: S.facing }, width: { ideal: w }, height: { ideal: h }, ...fr });
  if (IS_MOBILE && w > 1280) sets.push({ facingMode: { ideal: S.facing }, width: { ideal: 1280 }, height: { ideal: 720 }, ...fr });
  sets.push({ facingMode: { ideal: S.facing }, width: { ideal: 640 }, height: { ideal: 480 } }, { facingMode: { ideal: S.facing } }, true); return sets;
}
async function getStream() {
  let last;
  for (const v of constraintSets()) {
    try { return await navigator.mediaDevices.getUserMedia({ video: v, audio: false }) }
    catch (e) { last = e; if (e.name === 'NotAllowedError' || e.name === 'SecurityError' || (e.name === 'NotFoundError' && v === true)) throw e; if (e.name === 'NotFoundError') continue }
  }
  throw last;
}
const syncFacingUI = () => document.querySelectorAll('#seg-facing button').forEach(x => x.setAttribute('aria-pressed', x.dataset.f === S.facing));
async function startCamera() {
  stopAll(true); showHttpsWarn();
  if (!navigator.mediaDevices?.getUserMedia) { toast(camError(), true, 9000); return }
  setBusy(true);
  try {
    const stream = await getStream(); S.stream = stream; S.source = 'camera'; S.permitted = true;
    const tr = stream.getVideoTracks()[0], st = tr?.getSettings?.() || {}; S.camFacing = st.facingMode || ($('sel-cam').value ? 'user' : S.facing);
    tr?.addEventListener('ended', () => { if (S.stream === stream && !document.hidden) { toast('Kamera została odłączona lub zatrzymana.', true, 6000); stopAll(true) } });
    video.muted = true; video.playsInline = true; video.srcObject = stream; video.loop = false; await video.play(); await listCams();
    await beginTracking();
  } catch (e) { console.error(e); toast(camError(e), true, 10000); stopAll(true) }
  setBusy(false);
}
async function setFacing(f, fromFlip) {
  if (S.rec) { toast('Zakończ pomiar przed zmianą kamery.'); return }
  S.facing = f; $('sel-cam').value = ''; syncFacingUI();
  if (S.running && S.source === 'camera') { await startCamera(); if (S.running && S.camFacing && S.camFacing !== f && fromFlip) { S.facing = S.camFacing; syncFacingUI(); toast('To urządzenie ma tylko jedną kamerę.') } } else listCams();
}
const flipCamera = () => setFacing(S.facing === 'environment' ? 'user' : 'environment', true);

/* ---------- film z pliku ---------- */
let fileTok = 0;
async function startFile(file) {
  if (!file) return;
  if (file.type && !/^video\//.test(file.type) && !/\.(mp4|m4v|mov|webm|mkv|3gp|avi)$/i.test(file.name || '')) { toast('To nie jest plik wideo.', true); return }
  stopAll(true); const tok = ++fileTok;
  S.fileUrl = URL.createObjectURL(file); S.source = 'file'; S.fileName = file.name || 'film'; S.mt = 0; S.userPaused = false;
  setBusy(true); toast('Wczytuję film…', false, 2500);
  video.srcObject = null; video.muted = true; video.defaultMuted = true; video.playsInline = true; video.loop = true; video.preload = 'auto'; video.src = S.fileUrl;
  const loaded = await new Promise(res => {
    let done = false; const fin = v => { if (done) return; done = true; clearTimeout(to); video.onloadeddata = video.onerror = null; res(v) };
    const to = setTimeout(() => fin(video.readyState >= 2), 25000);
    video.onloadeddata = () => fin(true); video.onerror = () => fin(false);
    if (video.readyState >= 2) fin(true); try { video.load() } catch (e) { }
  });
  if (tok !== fileTok) return;
  if (!loaded || !video.videoWidth) { toast(FILE_ERR, true, 14000); stopAll(true); setBusy(false); return }
  video.playbackRate = S.rate;
  try { await video.play() } catch (e) { if (e && e.name === 'NotAllowedError') { S.userPaused = true; toast('Naciśnij ▶, aby odtworzyć film.') } else { toast(FILE_ERR, true, 14000); stopAll(true); setBusy(false); return } }
  if (tok !== fileTok) return;
  video.onerror = () => { if (S.source === 'file' && S.running) { toast(FILE_ERR, true, 12000); stopAll(true) } };
  await beginTracking(); setBusy(false); syncVctl();
}
let seeking = false;
function syncVctl() {
  const on = S.running && S.source === 'file'; $('vctl').hidden = !on; if (!on) return;
  const d = video.duration || 0, t = video.currentTime || 0;
  $('v-play').textContent = video.paused ? '▶' : '⏸'; $('v-play').setAttribute('aria-label', video.paused ? 'Odtwarzaj' : 'Pauza');
  $('v-time').textContent = `${fmtT(t)} / ${fmtT(d)}`;
  if (!seeking && isFinite(d) && d > 0) $('v-seek').value = Math.round(t / d * 1000);
  $('v-name').textContent = '🎬 ' + (S.fileName || 'film');
  document.querySelectorAll('#seg-speed button').forEach(b => b.setAttribute('aria-pressed', +b.dataset.r === S.rate));
}
function vPlayPause() {
  if (S.source !== 'file' || !S.running) return;
  if (video.paused) {
    if (S.trackMode === 'closeup' && S.cu) { if (S.cu.state === 'pick') { toast('Najpierw wskaż 3 punkty na obrazie.', true); return } if (S.cu.state === 'stale') { cuRestore(true); return } }
    S.userPaused = false; if (video.ended) video.currentTime = 0; video.play().catch(() => toast('Nie można odtworzyć filmu.', true)) } else { S.userPaused = true; video.pause() }
  syncVctl();
}
function vStep(dir) {
  if (S.source !== 'file' || !S.running) return;
  S.userPaused = true; video.pause(); const d = video.duration || 0, fps = S.fps30 || 30;
  video.currentTime = Math.min(Math.max(0, d - 0.001), Math.max(0, video.currentTime + dir / fps)); syncVctl();
}
function vSeekTo(frac) { const d = video.duration; if (isFinite(d) && d > 0) video.currentTime = Math.min(d - 0.001, Math.max(0, frac * d)) }

async function beginTracking() {
  if (S.trackMode === 'pose') { const ok = await ensureModel(); if (!ok && !S.landmarker) { toast('Model pozy niedostępny – użyj trybu „Zbliżenie stopy”.', true) } }
  S.running = true; S.lastVT = -1; S.lastTs = 0; S.errCount = 0; S.t0 = clk(); S.series = []; resetStats(); resetReps();
  S.mirror = effMirror(); S.lastLm = null; S.lastVals = null; S.noPoseSince = 0; S.ema = {}; S.lastSeen = {}; S.hbase = null;
  fitCanvas(); $('empty').hidden = true; ['b-fps', 'b-res'].forEach(i => $(i).hidden = false);
  $('btn-cam').textContent = S.source === 'file' ? 'Zatrzymaj film' : 'Zatrzymaj kamerę'; $('btn-cam').classList.remove('primary'); $('btn-cam').classList.add('danger');
  $('btn-snap').disabled = false; $('btn-rec').disabled = false; $('hudbig').hidden = false;
  if (S.trackMode === 'closeup') cuStartPicking(true);
  cancelAnimationFrame(S.raf); S.raf = requestAnimationFrame(loop); requestWake(); syncDock(); syncModeUI(); coachTracking();
}
function stopAll(silent) {
  if (S.rec) stopRecording(); coachStopAll();
  S.running = false; cancelAnimationFrame(S.raf); fileTok++;
  S.stream?.getTracks().forEach(t => t.stop()); S.stream = null;
  if (S.fileUrl) { URL.revokeObjectURL(S.fileUrl); S.fileUrl = null }
  video.onerror = null; video.pause(); video.srcObject = null; video.removeAttribute('src'); video.load(); S.source = null; S.fileName = null; $('vctl').hidden = true;
  $('empty').hidden = false; ['b-fps', 'b-res'].forEach(i => $(i).hidden = true); $('nopose').style.display = 'none'; $('hudbig').hidden = true; $('suggest').hidden = true; $('guide').hidden = true;
  $('btn-cam').textContent = 'Uruchom kamerę'; $('btn-cam').classList.add('primary'); $('btn-cam').classList.remove('danger');
  $('btn-snap').disabled = true; $('btn-rec').disabled = true; S.cu = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height); releaseWake(); if (isFs()) toggleFs(); syncDock(); syncModeUI();
}
function fitCanvas() {
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720; S.vw = vw; S.vh = vh;
  const sc = Math.min(1, MAXSIDE / Math.max(vw, vh)), cw = Math.round(vw * sc), ch = Math.round(vh * sc);
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch }
  $('stage').style.aspectRatio = `${cw}/${ch}`; $('b-res').textContent = `${vw}×${vh}`;
}
async function requestWake() { try { if ('wakeLock' in navigator && !S.wake && !document.hidden) { const wl = await navigator.wakeLock.request('screen'); S.wake = wl; wl.addEventListener('release', () => { if (S.wake === wl) S.wake = null }) } } catch (e) { console.warn('wakeLock', e.name) } }
function releaseWake() { try { S.wake?.release?.() } catch (e) { } S.wake = null }
function setBusy(b) { $('btn-cam').disabled = b; $('btn-empty-start').disabled = b; $('btn-empty-film').disabled = b; $('btn-film').disabled = b; $('d-film').disabled = b; if (b) $('btn-cam').textContent = 'Uruchamianie…' }

/* ---------- geometria: tryb „Cała noga” ---------- */
function computePose(lm, w, h, side) {
  const P = i => ({ x: lm[i].x * w, y: lm[i].y * h, v: lm[i].visibility ?? 1 });
  const vis = {}; for (const s of ['L', 'R']) { const k = IDX[s]; vis[s] = (lm[k.kn].visibility + lm[k.an].visibility + lm[k.hl].visibility + lm[k.ft].visibility) / 4 }
  const k = IDX[side], p = {}; for (const n in k) p[n] = P(k[n]);
  const ok = (...n) => n.every(x => p[x].v >= VIS_MIN); const out = { ankle: null, knee: null, tibia: null, heel: null, front: null };
  if (ok('kn', 'an', 'hl', 'ft')) {
    const th = angleBetween(p.kn, p.an, { x: p.an.x + (p.ft.x - p.hl.x), y: p.an.y + (p.ft.y - p.hl.y) });   // goleń (kostka→kolano) vs stopa (pięta→palce)
    out.ankle = 90 - th;
    const dir = Math.sign(p.ft.x - p.hl.x) || 1;
    out.tibia = Math.atan2((p.kn.x - p.an.x) * dir, -(p.kn.y - p.an.y)) * 180 / Math.PI;
    const fl = Math.hypot(p.ft.x - p.hl.x, p.ft.y - p.hl.y); if (fl > 5) out.heel = (p.ft.y - p.hl.y) / fl * 100;
    // widok od przodu (eksperymentalnie): odchylenie linii kostka→pięta od osi goleni, + = ewersja (pięta na zewnątrz)
    const sx = p.an.x - p.kn.x, sy = p.an.y - p.kn.y, hx = p.hl.x - p.an.x, hy = p.hl.y - p.an.y;
    if (Math.hypot(hx, hy) > 4) { const ang = Math.atan2(sx * hy - sy * hx, sx * hx + sy * hy) * 180 / Math.PI; out.front = (side === 'R' ? 1 : -1) * ang }
  }
  if (ok('hip', 'kn', 'an')) out.knee = angleBetween(p.hip, p.kn, p.an);
  return { raw: out, vis, p };
}

/* ---------- statystyki / serie ---------- */
function resetStats() { S.stats = {} }
function addStatsTo(st, vals) { for (const k in vals) { const v = vals[k]; if (v == null) continue; const s = st[k] || (st[k] = { n: 0, sum: 0, min: Infinity, max: -Infinity }); s.n++; s.sum += v; if (v < s.min) s.min = v; if (v > s.max) s.max = v } }
const statOf = (k, st = S.stats) => { const s = st[k]; return s && s.n ? { min: s.min, max: s.max, range: s.max - s.min, mean: s.sum / s.n, n: s.n } : null };
function smoothVals(raw, t) {
  const out = {};
  for (const k in raw) {
    const v = raw[k];
    if (v == null) { if (S.lastSeen[k] != null && t - S.lastSeen[k] > .6) S.ema[k] = null; out[k] = S.ema[k] != null && t - S.lastSeen[k] <= .6 ? S.ema[k] : null; continue }
    S.lastSeen[k] = t; const p = S.ema[k]; S.ema[k] = p == null ? v : p + .45 * (v - p); out[k] = S.ema[k];
  }
  return out;
}
function applyCal(vals) {   // przesunięcie o kalibrację + baza pięty
  const o = { ...vals };
  if (o.ankle != null) o.ankle -= S.cal.ankle;
  if (o.heel != null) { if (S.cal.heelSet) o.heel -= S.cal.heel; else { S.hbase = S.hbase == null ? o.heel : Math.min(S.hbase, o.heel); o.heel -= S.hbase } }
  return o;
}

/* ---------- powtórzenia, utrzymanie, cel sesji ---------- */
function resetReps() {
  const c = cfg(); S.reps = { total: 0, setReps: 0, sets: 0, done: false, zz: new ZigZag(c.thr), state: 'low', holdStart: null, holdCur: 0, best: 0, holdFired: false, tPrev: null, cs: { peaks: [], curMax: -Infinity, lastT: null, fast: 0, hold: {}, n: 0 } };
  coachRestCancel(); updateGoalUI();
}
function metricVal(vals) { return vals[EX[S.ex].metric] }
function updateReps(t, vals) {
  const R = S.reps, c = cfg(), ex = EX[S.ex]; const v = metricVal(vals);
  if (v == null) { if (R.holdStart != null) endHold(t); return }
  let rep = false; if (R.cs.curMax < v) R.cs.curMax = v;
  if (ex.mode === 'zigzag') { R.zz.swing = c.thr; const zr = R.zz.push(t, v); if (zr) coachTempo(zr); rep = zr === 'peak' && R.zz.seenValley && R.zz.reps > R.total }
  else { const up = c.thr, down = c.thr * .6; if (R.state === 'low' && v >= up) { R.state = 'high'; coachTempo('peak') } else if (R.state === 'high' && v <= down) { R.state = 'low'; rep = true } }
  if (rep) {
    R.total = ex.mode === 'zigzag' ? R.zz.reps : R.total + 1; if (ex.mode !== 'zigzag') R.setReps++; else R.setReps = R.total - R.sets * c.reps;
    const nInSet = R.setReps;
    if (R.setReps >= c.reps) { R.sets++; R.setReps = 0; toast(R.sets >= c.sets ? 'Cel sesji osiągnięty – dobra robota! 🎉' : `Seria ${R.sets} z ${c.sets} ukończona – odpocznij.`, false, 5000); try { navigator.vibrate?.(R.sets >= c.sets ? [120, 60, 120] : 80) } catch (e) { } }
    coachRep(nInSet, t, nInSet >= c.reps);
    updateGoalUI();
  }
  // utrzymanie: czas nieprzerwanie powyżej celu
  if (v >= c.tgt) { if (R.holdStart == null) { R.holdStart = t; R.holdFired = false; coachHold(0) } R.holdCur = t - R.holdStart; if (c.hold > 0) coachHold(R.holdCur); if (c.hold > 0 && R.holdCur >= c.hold && !R.holdFired) { R.holdFired = true; coachHold(Infinity); try { navigator.vibrate?.(60) } catch (e) { } } }
  else if (R.holdStart != null) endHold(t);
}
function endHold(t) { const R = S.reps; R.best = Math.max(R.best, t - R.holdStart); R.holdStart = null; R.holdCur = 0 }
function updateGoalUI() {
  const R = S.reps, c = cfg(); if (!R) return;
  $('g-main').textContent = `${R.setReps} / ${c.reps}`; $('g-sub').textContent = R.sets >= c.sets ? `cel osiągnięty: ${c.sets}×${c.reps}` : `seria ${Math.min(R.sets + 1, c.sets)} z ${c.sets} (cel ${c.sets}×${c.reps})`;
  $('g-bar').style.width = Math.min(100, ((R.sets * c.reps + R.setReps) / (c.sets * c.reps)) * 100) + '%';
  $('kv-reps').textContent = R.total; const bh = Math.max(R.best, R.holdCur); $('kv-hold').textContent = bh > 0 ? bh.toFixed(1) + ' s' : '–';
}

/* ---------- tryb „Zbliżenie stopy”: wskazywanie i śledzenie punktów ---------- */
const TRK = new PatchTracker({ half: 22, radius: 48, update: .06, minScore: .45 });
const gcv = document.createElement('canvas'), gctx = gcv.getContext('2d', { willReadFrequently: true });
let grayBuf = null;
function grabGray() {
  const vw = video.videoWidth, vh = video.videoHeight; if (!vw) return null;
  const W = Math.min(640, vw), H = Math.round(vh * W / vw);
  if (gcv.width !== W || gcv.height !== H) { gcv.width = W; gcv.height = H; grayBuf = null }
  gctx.drawImage(video, 0, 0, W, H); const id = gctx.getImageData(0, 0, W, H); grayBuf = toGray(id, grayBuf);
  return { g: grayBuf, W, H };
}
const cloneTr = t => ({ ...t, raw: Float32Array.from(t.raw) });
function cuStartPicking(reset) {
  if (S.rec) { toast('Zakończ pomiar, aby ustawić punkty od nowa.'); return }
  const keepPick = S.cu && S.cu.pick && !reset;
  S.cu = { pts: [], tr: [], state: 'pick', pick: keepPick ? S.cu.pick : null, vals: null };
  if (S.running) { if (S.source === 'file') S.userPaused = true; video.pause() }
  $('stage').classList.add('cu-pick'); S.ema = {}; S.series = []; resetStats(); resetReps(); syncCuUI(); syncVctl(); render();
}
function cuStopPicking() { return S.cu && S.cu.state !== 'pick' }
function cuTap(nx, ny, grab) {
  const cu = S.cu; if (!cu || !S.running) return false;
  const g = grabGray(); if (!g) return false;
  if (cu.state === 'pick') {
    if (cu.pts.length >= 3) return false;
    cu.pts.push({ x: nx, y: ny }); cu.tr.push(TRK.init(g.g, g.W, g.H, nx * g.W, ny * g.H));
    if (cu.pts.length === 3) {
      cu.state = 'track'; cu.pick = { t: video.currentTime || 0, pts: cu.tr.map(t => ({ x: t.x / g.W, y: t.y / g.H })), tr: cu.tr.map(cloneTr) };
      $('stage').classList.remove('cu-pick'); S.lastVT = video.currentTime || 0; cu.vals = null; COACH.st = 'ok'; Coach.say('Punkty ustawione. Śledzę stopę.', { p: 1, v: 'normal', key: 'pts', ttl: 4000 });
      if (S.source === 'camera') { video.play().catch(() => { }) }
      toast(S.source === 'file' ? 'Punkty ustawione. Naciśnij ▶ lub „Rozpocznij pomiar”.' : 'Punkty ustawione – śledzę.', false, 3500);
    }
    syncCuUI(); render(); return true;
  }
  return false;
}
function cuNearest(nx, ny) {
  const cu = S.cu; if (!cu || cu.state === 'pick') return -1; let bi = -1, bd = 1e9;
  cu.pts.forEach((p, i) => { const d = Math.hypot((p.x - nx) * canvas.width, (p.y - ny) * canvas.height); if (d < bd) { bd = d; bi = i } });
  return bd < Math.max(40, canvas.width * .06) ? bi : -1;
}
function cuMove(i, nx, ny) {
  const cu = S.cu, g = grabGray(); if (!g) return;
  cu.pts[i] = { x: nx, y: ny }; cu.tr[i] = TRK.init(g.g, g.W, g.H, nx * g.W, ny * g.H); cu.stale = false; if (cu.state === 'stale') cu.state = 'track'; syncCuUI(); render();
}
function cuRestore(play) {
  const cu = S.cu; if (!cu || !cu.pick) return;
  cu.pts = cu.pick.pts.map(p => ({ ...p })); cu.tr = cu.pick.tr.map(cloneTr); cu.state = 'track'; cu.vals = null; S.ema = {}; S.lastVT = cu.pick.t;
  if (Math.abs((video.currentTime || 0) - cu.pick.t) > 0.01) video.currentTime = cu.pick.t;
  if (play) { S.userPaused = false; video.play().catch(() => { }) } else { S.userPaused = true; video.pause() }
  syncCuUI(); syncVctl(); render();
}
function cuTrack(vt) {
  const cu = S.cu; if (!cu || cu.state !== 'track' || cu.tr.length < 3) return null;
  const dt = vt - S.lastVT;
  if (S.source === 'file' && (dt < -0.5 || dt > 0.5)) {                   // przewinięcie / zapętlenie
    if (cu.pick && (Math.abs(vt - cu.pick.t) < 0.12 || dt < -0.5 && !S.rec)) { cuRestore(!S.userPaused); return null }
    cu.state = 'stale'; syncCuUI(); return null;
  }
  const g = grabGray(); if (!g) return null;
  for (const t of cu.tr) TRK.track(t, g.g, g.W, g.H);
  cu.pts = cu.tr.map(t => ({ x: t.x / g.W, y: t.y / g.H })); cu.W = g.W; cu.H = g.H;
  const [A, B, C] = cu.tr; const th = angleBetween(A, B, C); cu.lost = Math.max(...cu.tr.map(t => t.lost)); cu.score = Math.min(...cu.tr.map(t => t.score));
  return th == null ? null : { theta: th };
}
function syncCuUI() {
  const cu = S.cu, on = S.trackMode === 'closeup', g = $('guide');
  $('cu-box').hidden = !on; $('cu-undo').disabled = !(cu && cu.state === 'pick' && cu.pts.length); $('cu-home').hidden = !(cu && cu.pick && on);
  let msg = '', sub = '';
  if (on && S.running && cu) {
    if (cu.state === 'pick') { msg = CU_HELP[Math.min(cu.pts.length, 2)]; sub = S.source === 'file' ? 'Możesz przewinąć film do dobrej klatki (suwak, ⏮ ⏭). Palcem stuknij na obrazie.' : 'Obraz jest zatrzymany na czas wskazywania punktów.'; sub += ' Wskazuj punkty na skórze, nie na samej krawędzi na tle.' }
    else if (cu.state === 'stale') { msg = 'Film został przewinięty – śledzenie utracone'; sub = 'Naciśnij „↺ Do klatki startowej” albo wskaż punkty od nowa.' }
    else if (cu.lost >= 8) { msg = 'Utracono punkt – przeciągnij go na właściwe miejsce'; sub = 'Pauza ⏸, potem dotknij i przeciągnij punkt (korekta śledzenia).' }
  }
  g.hidden = !msg; g.innerHTML = msg ? `${msg}<small>${sub}</small>` : '';
}
/* ---------- tryb śledzenia (UI) ---------- */
function setTrackMode(m, silent) {
  if (S.rec) { toast('Zakończ pomiar przed zmianą trybu.'); return }
  S.trackMode = m; saveSettings(); S.cal.ankle = 0; S.cal.heelSet = false; S.hbase = null;
  if (m === 'closeup' && S.ex !== 'pump') setExercise('pump');
  S.mirror = effMirror(); $('suggest').hidden = true; S.noPoseSince = 0; S.ema = {}; S.series = []; resetStats(); resetReps();
  document.querySelectorAll('#seg-mode button').forEach(b => b.setAttribute('aria-pressed', b.dataset.m === m));
  $('stage').style.touchAction = m === 'closeup' ? 'none' : '';
  if (m === 'closeup') { S.cu = null; if (S.running) cuStartPicking(true) } else { S.cu = null; $('stage').classList.remove('cu-pick'); if (S.running) { ensureModel(); S.userPaused = false; video.play().catch(() => { }) } }
  syncModeUI(); syncCuUI(); renderExerciseUI(); if (!silent) toast(m === 'closeup' ? 'Tryb: Zbliżenie stopy – wskaż 3 punkty na obrazie.' : 'Tryb: Cała noga (MediaPipe).', false, 3000);
}
function syncModeUI() {
  const cu = S.trackMode === 'closeup';
  if (cu && !S.landmarker) pill('Zbliżenie stopy · bez modelu', 'ok'); else if (!cu && !S.landmarker && !modelPromise) pill('Model: wczytam przy starcie', '');
  $('mode-note').textContent = cu ? 'Do zbliżenia samej stopy (bez kolana w kadrze): wskazujesz 3 punkty palcem, a aplikacja śledzi je na filmie. Kąt między goleń a stopą jest niewrażliwy na drżenie kamery.' : 'Do nagrania z kolanem w kadrze, z boku. Model MediaPipe sam znajduje kolano, kostkę, piętę i palce.';
  $('kv-mode').textContent = cu ? 'Zbliżenie' : 'Cała noga';
  document.querySelectorAll('#exlist .exb').forEach(b => { const dis = cu && b.dataset.e !== 'pump'; b.disabled = dis; b.title = dis ? 'To ćwiczenie wymaga trybu „Cała noga” (kolano w kadrze)' : '' });
  $('sel-model').disabled = cu;
}

/* ---------- pętla główna ---------- */
let lastDraw = 0;
function loop() {
  if (!S.running) return; S.raf = requestAnimationFrame(loop);
  if (document.hidden || video.readyState < 2 || !video.videoWidth) return;
  const vt = video.currentTime; if (vt === S.lastVT) return; const prevVT = S.lastVT;
  if (video.videoWidth !== S.vw || video.videoHeight !== S.vh) fitCanvas();
  const now = performance.now(), w = canvas.width, h = canvas.height;
  if (S.source === 'file') { if (vt < S.lastVT - 0.5 && S.trackMode === 'pose') S.t0 -= (video.duration || 0); S.mt = vt }
  let raw = null, lm = null, cuRes = null;
  if (S.trackMode === 'pose') {
    if (!S.landmarker) { S.lastVT = vt; render(); return }
    const ts = Math.max(now, S.lastTs + 1); S.lastTs = ts; let res = null; const t1 = performance.now();
    try { res = S.landmarker.detectForVideo(video, ts); S.errCount = 0 } catch (e) { if (++S.errCount > 30) { toast('Błąd analizy obrazu.', true); stopAll(true); return } }
    S.inferMs = S.inferMs * .8 + (performance.now() - t1) * .2; lm = res && res.landmarks && res.landmarks[0];
    if (lm) {
      const c = computePose(lm, w, h, curSide()); for (const s of ['L', 'R']) S.visEma[s] += .1 * (c.vis[s] - S.visEma[s]);
      if (S.side === 'auto') S.autoSide = S.visEma.L > S.visEma.R + .04 ? 'L' : S.visEma.R > S.visEma.L + .04 ? 'R' : S.autoSide;
      if (c.raw.ankle != null) raw = c.raw;
    }
    if (raw) { S.noPoseSince = 0; $('nopose').style.display = 'none'; S.lastPoseT = now; S.nPose++ }
    else { if (!S.noPoseSince) S.noPoseSince = now; if (now - S.noPoseSince > 700) $('nopose').style.display = 'block' }
    if (!raw && S.noPoseSince && now - S.noPoseSince > 3500) $('suggest').hidden = false; else if (raw) $('suggest').hidden = true;
  } else {
    cuRes = cuTrack(vt); if (cuRes) raw = { ankle: 90 - cuRes.theta, knee: null, tibia: null, heel: null, front: null };
    $('nopose').style.display = 'none';
  }
  S.lastVT = vt;
  if (S.source === 'file') S.mt = vt;
  if (S.source === 'file' && S.trackMode === 'closeup' && !video.paused && cuRes) adaptRate(vt - prevVT);
  const t = clk() - S.t0;
  if (raw) {
    const sm = smoothVals(raw, t); S.lastRaw = sm; const vals = applyCal(sm); S.lastVals = vals; S.lastLm = lm; if (S.cu) S.cu.vals = vals;
    addStatsTo(S.stats, vals); S.series.push({ t, v: vals }); while (S.series.length && t - S.series[0].t > 65) S.series.shift();
    updateReps(t, vals);
    if (S.rec) recFrame(vals, t);
  } else if (S.trackMode === 'pose') { S.lastLm = lm || null }
  fps(now); render();
  if (S.rec && raw) captureKey();
}
/* Film w trybie zbliżenia: śledzenie punktów nie może „gubić” klatek – gdy urządzenie nie nadąża,
   odtwarzanie jest automatycznie zwalniane (dokładność ważniejsza niż czas rzeczywisty). */
function adaptRate(gap) {
  if (!(gap > 0 && gap < 0.5)) return;
  S.gapEma = S.gapEma ? S.gapEma * .6 + gap * .4 : gap; let r = video.playbackRate;
  if (S.gapEma > 0.075 && r > 0.1) { r = Math.max(0.1, r * .6); S.gapEma = 0 } else if (S.gapEma && S.gapEma < 0.03 && r < S.rate) { r = Math.min(S.rate, r * 1.3); S.gapEma = 0 } else return;
  video.playbackRate = r; S.adaptRate = r; $('v-time').title = 'Tempo analizy dostosowane: ×' + r.toFixed(2);
}
function fps(now) {
  S.fpsN++; if (now - S.fpsT >= 1000) { S.fps = S.fpsN * 1000 / (now - S.fpsT); S.fpsN = 0; S.fpsT = now; $('b-fps').textContent = `${S.fps.toFixed(0)} FPS` + (S.trackMode === 'pose' ? ` · ${S.inferMs.toFixed(0)} ms` : '') }
}

/* ---------- rysowanie ---------- */
const SC = () => Math.max(.7, canvas.width / 1000);
function render() {
  const w = canvas.width, h = canvas.height; if (!w || !video.videoWidth) return;
  ctx.save(); if (S.mirror) { ctx.translate(w, 0); ctx.scale(-1, 1) } ctx.drawImage(video, 0, 0, w, h); ctx.restore();
  if (S.skel) { if (S.trackMode === 'pose' && S.lastLm) drawPose(S.lastLm, S.lastVals, w, h); else if (S.trackMode === 'closeup' && S.cu) drawCu(w, h) }
}
function drawPose(lm, vals, w, h) {
  const sc = SC(), side = curSide(), X = p => (S.mirror ? 1 - p.x : p.x) * w, Y = p => p.y * h; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const [a, b] of BONES) {
    const A = lm[a], B = lm[b]; if ((A.visibility ?? 1) < .3 || (B.visibility ?? 1) < .3) continue;
    const s = a === 23 && b === 24 ? null : sideOfIdx(a), on = !s || s === side; ctx.strokeStyle = s ? SIDE_COL[s] : '#F2F4F3'; ctx.globalAlpha = on ? .95 : .25; ctx.lineWidth = (on ? 5 : 3) * sc;
    ctx.beginPath(); ctx.moveTo(X(A), Y(A)); ctx.lineTo(X(B), Y(B)); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (const i of [23, 24, 25, 26, 27, 28, 29, 30, 31, 32]) { const p = lm[i]; if ((p.visibility ?? 1) < .3) continue; const s = sideOfIdx(i), on = s === side; ctx.fillStyle = '#1F1E1E'; ctx.strokeStyle = SIDE_COL[s]; ctx.globalAlpha = on ? 1 : .35; ctx.lineWidth = 3 * sc; ctx.beginPath(); ctx.arc(X(p), Y(p), (on ? 6.5 : 4) * sc, 0, 7); ctx.fill(); ctx.stroke() }
  ctx.globalAlpha = 1;
  const v = vals && vals.ankle; if (!S.labels || v == null) return;
  const k = IDX[side], an = lm[k.an], kn = lm[k.kn], hl = lm[k.hl], ft = lm[k.ft];
  const bx = X(an), by = Y(an), a1 = Math.atan2(Y(kn) - by, X(kn) - bx), a2 = Math.atan2(Y(an) + (Y(ft) - Y(hl)) - by, X(an) + (X(ft) - X(hl)) - bx);
  arcLabel(bx, by, a1, a2, SIDE_COL[side], angLabel(v), sc);
}
function angLabel(v) { return `${sgn(v)}° ${v >= 0 ? 'grzb.' : 'podesz.'}` }
function arcLabel(bx, by, a1, a2, col, text, sc) {
  let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  const r = 34 * sc; ctx.beginPath(); ctx.moveTo(bx, by); ctx.arc(bx, by, r, a1, a1 + d, d < 0); ctx.closePath(); ctx.fillStyle = col + '55'; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 2 * sc; ctx.stroke();
  const mid = a1 + d / 2; label(text, bx + Math.cos(mid) * (r + 40 * sc), by + Math.sin(mid) * (r + 40 * sc), col, sc);
}
function label(txt, x, y, col, sc) {
  ctx.font = `800 ${Math.round(20 * sc)}px Archivo,Arial,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tw = ctx.measureText(txt).width + 14 * sc, th = 28 * sc; x = Math.min(canvas.width - tw / 2 - 4, Math.max(tw / 2 + 4, x)); y = Math.min(canvas.height - th / 2 - 4, Math.max(th / 2 + 4, y));
  ctx.fillStyle = 'rgba(31,30,30,.85)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - tw / 2, y - th / 2, tw, th, 6 * sc) : ctx.rect(x - tw / 2, y - th / 2, tw, th); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 1.5 * sc; ctx.stroke(); ctx.fillStyle = '#F2F4F3'; ctx.fillText(txt, x, y + 1);
}
function drawCu(w, h) {
  const cu = S.cu, sc = SC(), col = SIDE_COL[curSide()], P = cu.pts.map(p => ({ x: p.x * w, y: p.y * h }));
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (P.length >= 2) { ctx.strokeStyle = '#F2F4F3'; ctx.lineWidth = 5 * sc; ctx.beginPath(); ctx.moveTo(P[0].x, P[0].y); ctx.lineTo(P[1].x, P[1].y); ctx.stroke() }
  if (P.length >= 3) { ctx.strokeStyle = col; ctx.lineWidth = 5 * sc; ctx.beginPath(); ctx.moveTo(P[1].x, P[1].y); ctx.lineTo(P[2].x, P[2].y); ctx.stroke() }
  P.forEach((p, i) => {
    const bad = cu.tr[i] && cu.tr[i].lost >= 8; ctx.fillStyle = '#1F1E1E'; ctx.strokeStyle = bad ? '#FE2C55' : (i === 1 ? '#FFFFFF' : col); ctx.lineWidth = 3 * sc;
    ctx.beginPath(); ctx.arc(p.x, p.y, 9 * sc, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#F2F4F3'; ctx.font = `800 ${Math.round(13 * sc)}px Archivo,Arial,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(i + 1, p.x, p.y + 1);
  });
  if (P.length === 3 && cu.state !== 'pick' && S.labels && cu.vals && cu.vals.ankle != null) {
    const a1 = Math.atan2(P[0].y - P[1].y, P[0].x - P[1].x), a2 = Math.atan2(P[2].y - P[1].y, P[2].x - P[1].x); arcLabel(P[1].x, P[1].y, a1, a2, col, angLabel(cu.vals.ankle), sc);
  }
}

/* ---------- wykresy ---------- */
function setupCanvas(c) { const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP), r = c.getBoundingClientRect(); const W = Math.max(10, Math.round(r.width * dpr)), H = Math.max(10, Math.round(r.height * dpr)); if (c.width !== W || c.height !== H) { c.width = W; c.height = H } const g = c.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); return { g, w: W, h: H, dpr } }
function drawChart(c, metric, win, opt = {}) {
  const { g, w, h, dpr } = setupCanvas(c); g.clearRect(0, 0, w, h); const M = METRICS[metric];
  const now = S.series.length ? S.series[S.series.length - 1].t : 0, t0 = now - win; const pts = S.series.filter(p => p.t >= t0);
  let lo = Infinity, hi = -Infinity; for (const p of pts) { const v = p.v[metric]; if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v) } }
  if (!isFinite(lo)) { lo = M.def[0]; hi = M.def[1] }
  const pad = opt.small ? 3 : 8; lo = Math.floor((lo - pad) / 5) * 5; hi = Math.ceil((hi + pad) / 5) * 5;
  if (!opt.small && metric === 'ankle') { lo = Math.min(lo, -50); hi = Math.max(hi, 25) }
  if (hi - lo < (opt.small ? 20 : 30)) { const m = (hi + lo) / 2; lo = m - (opt.small ? 10 : 15); hi = m + (opt.small ? 10 : 15) }
  const sf = opt.small ? dpr : dpr, L = opt.small ? 0 : 44 * sf, R = opt.small ? 0 : 10 * sf, T = (opt.small ? 2 : 10) * sf, B = (opt.small ? 2 : 24) * sf;
  const X = t => L + (t - t0) / win * (w - L - R), Y = v => T + (1 - (v - lo) / (hi - lo)) * (h - T - B);
  if (!opt.small) {
    g.font = `${11 * sf}px Inter,sans-serif`; g.fillStyle = '#7C8584'; g.strokeStyle = '#363434'; g.lineWidth = 1; g.textBaseline = 'middle'; g.textAlign = 'right';
    const step = (hi - lo) > 100 ? 30 : (hi - lo) > 50 ? 10 : 5;
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) { const y = Y(v); g.strokeStyle = v === 0 ? '#5a5858' : '#363434'; g.beginPath(); g.moveTo(L, y); g.lineTo(w - R, y); g.stroke(); g.fillText((metric === 'ankle' || metric === 'front' ? sgn(v) : v) + M.unit, L - 6 * sf, y) }
    g.textAlign = 'center'; g.textBaseline = 'top'; for (let s = 0; s <= win; s += win > 10 ? 5 : 1) g.fillText(s === win ? 'teraz' : `−${win - s} s`, X(t0 + s), h - B + 6 * sf);
    if (metric === 'ankle') {
      g.fillStyle = 'rgba(46,196,182,.10)'; const y1 = Y(Math.min(REF.dorsi, hi)), y2 = Y(Math.max(0, lo)); if (y2 > y1) g.fillRect(L, y1, w - L - R, y2 - y1);
      g.fillStyle = 'rgba(254,218,117,.10)'; const y3 = Y(REF.plantar[1]), y4 = Y(REF.plantar[0]); g.fillRect(L, y3, w - L - R, y4 - y3);
      g.font = `${10 * sf}px Inter,sans-serif`; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillStyle = 'rgba(46,196,182,.7)'; g.fillText('orientacyjnie ~20° zgięcia grzbietowego', L + 6 * sf, Math.min(Y(REF.dorsi), h - B - 14 * sf) + 3 * sf);
      g.fillStyle = 'rgba(254,218,117,.7)'; g.fillText('orientacyjnie 40–50° podeszwowego', L + 6 * sf, Y(REF.plantar[1]) + 3 * sf);
    }
  }
  const col = SIDE_COL[curSide()], st = statOf(metric);
  if (!opt.small && st) { [st.min, st.max].forEach(v => { if (v < lo || v > hi) return; g.setLineDash([4 * sf, 5 * sf]); g.strokeStyle = col + '88'; g.lineWidth = 1; g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(w - R, Y(v)); g.stroke() }); g.setLineDash([]) }
  g.strokeStyle = col; g.lineWidth = (opt.small ? 1.6 : 2.4) * sf; g.lineJoin = 'round'; g.beginPath(); let pen = false, prevT = 0;
  for (const p of pts) { const v = p.v[metric]; if (v == null) { pen = false; continue } const x = X(p.t), y = Y(v); if (!pen || p.t - prevT > .5) { g.moveTo(x, y); pen = true } else g.lineTo(x, y); prevT = p.t }
  g.stroke();
}

/* ---------- panele: karty, HUD, cel ---------- */
const CARD_KEYS = () => ['ankle', 'knee', 'tibia', 'heel'].concat(S.front ? ['front'] : []);
function buildCards() {
  $('angles').innerHTML = CARD_KEYS().map(k => { const m = METRICS[k]; return `<button class="ang" data-m="${k}" aria-label="${m.pl}"><h3>${m.pl} <span style="font-weight:500;text-transform:none;letter-spacing:0;color:var(--dim)">· ${m.hint}</span></h3><div class="vals"></div><canvas></canvas></button>` }).join('');
  $('tabs').innerHTML = CARD_KEYS().map(k => `<button class="tab" data-m="${k}" aria-pressed="${k === S.sel}">${METRICS[k].pl}</button>`).join('');
}
const fmtMetric = (k, v, d) => v == null ? '–' : (k === 'ankle' || k === 'front' ? sgn(v, d ?? 0) : v.toFixed(d ?? 0));
function updatePanels() {
  syncDock(); const last = S.series.length ? S.series[S.series.length - 1].v : {}; const sd = curSide();
  if ($('c-live').open) document.querySelectorAll('.ang').forEach(el => {
    const k = el.dataset.m, v = S.lastVals ? S.lastVals[k] : last[k], st = statOf(k); el.classList.toggle('sel', k === S.sel);
    const u = METRICS[k].unit; el.querySelector('.vals').innerHTML = `<div class="row"><span class="s ${sd}">${sd === 'L' ? 'L' : 'P'}</span><span class="val ${v == null ? 'na' : ''}">${fmtMetric(k, v)}<small>${v == null ? '' : u}</small></span><span class="mm">${st ? `${fmtMetric(k, st.min)}…${fmtMetric(k, st.max)}${u} · zakres ${st.range.toFixed(0)}${u}` : 'brak danych'}</span></div>`;
    drawChart(el.querySelector('canvas'), k, 10, { small: true });
  });
  const ex = EX[S.ex], mk = ex.metric, v = S.lastVals ? S.lastVals[mk] : null, M = METRICS[mk];
  $('h-ang').textContent = v == null ? '–' : fmtMetric(mk, v) + M.unit;
  $('h-lab').textContent = v == null ? M.pl : mk === 'ankle' ? (v >= 0 ? 'zgięcie grzbietowe' : 'zgięcie podeszwowe') : mk === 'heel' ? 'wysokość pięty' : 'nachylenie goleni';
  const R = S.reps, c = cfg();
  if (R) {
    const hb = $('h-reps'); hb.hidden = !S.running; hb.innerHTML = `Powt. <b>${R.setReps}/${c.reps}</b> · seria <b>${Math.min(R.sets + 1, c.sets)}/${c.sets}</b> · łącznie <b>${R.total}</b>`;
    const hh = $('h-hold'); hh.hidden = !(S.running && (R.holdCur > 0.3 || R.best > 0)); hh.innerHTML = `Utrzymanie <b>${R.holdCur.toFixed(1)} s</b>${R.best ? ` · rekord <b>${R.best.toFixed(1)} s</b>` : ''}`; updateGoalUI();
  }
  const n = Math.max(0, ...Object.values(S.stats).map(s => s.n)); $('kv-n').textContent = S.rec ? S.rec.frames.length : n;
  $('kv-side').textContent = S.side === 'auto' ? `Auto (${curSide() === 'L' ? 'lewa' : 'prawa'})` : SIDE_PL[S.side];
  const a = statOf('ankle'); $('kv-rom').textContent = a ? `${a.range.toFixed(0)}° (${sgn(a.min)}…${sgn(a.max)})` : '–';
  $('legend').innerHTML = `<span><b style="background:${SIDE_COL[sd]}"></b>${SIDE_PL[sd]} – ${METRICS[S.sel].pl.toLowerCase()}</span><span style="color:var(--dim)">linie przerywane: min / max</span>`;
  $('live-sub').textContent = S.running ? '' : 'uruchom kamerę albo wczytaj film';
}
const renderMain = () => drawChart($('main-chart'), S.sel, S.win);
setInterval(() => { if (!document.hidden) updatePanels() }, IS_MOBILE ? 250 : 150);
let lastR = 0;
(function anim(t) { requestAnimationFrame(anim); if (document.hidden || !$('c-chart').open) return; if (IS_MOBILE && t - lastR < 66) return; lastR = t; renderMain() })(0);
if (window.ResizeObserver) new ResizeObserver(() => { if ($('c-chart').open) renderMain() }).observe($('main-chart'));

function setExercise(id) {
  if (!EX[id]) return; if (S.rec) { toast('Zakończ pomiar przed zmianą ćwiczenia.'); return }
  if (S.trackMode === 'closeup' && id !== 'pump') { toast('To ćwiczenie wymaga trybu „Cała noga” (kolano w kadrze).'); return }
  S.ex = id; saveSettings(); S.sel = EX[id].metric; S.series = []; resetStats(); resetReps(); renderExerciseUI(); buildCards(); updatePanels();
  if (S.running) Coach.say(`Ćwiczenie: ${EX[id].pl}.` + (Coach.level === 'chatty' ? ' ' + EX[id].steps[0] : ''), { p: 1, v: 'normal', key: 'ex', ttl: 6000 });
}
function renderExerciseUI() {
  const ex = EX[S.ex], c = cfg();
  $('exlist').innerHTML = Object.values(EX).map(e => `<button class="exb" data-e="${e.id}" aria-pressed="${e.id === S.ex}"${S.trackMode === 'closeup' && e.id !== 'pump' ? ' disabled' : ''}><i>${e.ico}</i>${e.pl}</button>`).join('');
  $('ex-svg').innerHTML = EX_SVG[S.ex]; $('ex-steps').innerHTML = ex.steps.map(s => `<li>${s}</li>`).join('');
  $('lab-thr').textContent = ex.thrLab; $('lab-tgt').textContent = ex.tgtLab;
  $('in-thr').value = c.thr; $('in-tgt').value = c.tgt; $('in-sets').value = c.sets; $('in-reps').value = c.reps; $('in-hold').value = c.hold; $('in-rest').value = c.rest ?? 20;
  $('hf-ex').value = S.ex; $('cmp-ex').value = S.ex;
}
function bindExerciseInputs() {
  const m = { 'in-thr': 'thr', 'in-tgt': 'tgt', 'in-sets': 'sets', 'in-reps': 'reps', 'in-hold': 'hold', 'in-rest': 'rest' };
  for (const id in m) $(id).addEventListener('change', () => { const v = parseFloat($(id).value); const c = cfg(); if (isFinite(v) && v >= 0) c[m[id]] = (m[id] === 'sets' || m[id] === 'reps') ? Math.max(1, Math.round(v)) : m[id] === 'rest' ? Math.min(300, Math.round(v)) : v; $(id).value = c[m[id]]; saveSettings(); if (S.reps) { S.reps.zz.swing = c.thr; updateGoalUI() } });
}
bindExerciseInputs();

/* ---------- kalibracja ---------- */
function calibrate() {
  const r = S.lastRaw; if (!S.running || !r || r.ankle == null) { toast('Najpierw uruchom pomiar i ustaw stopę w widocznym miejscu.', true); return }
  S.cal.ankle = r.ankle; if (r.heel != null) { S.cal.heel = r.heel; S.cal.heelSet = true }
  S.series = []; resetStats(); resetReps(); S.ema = {}; S.lastSeen = {};
  $('cal-note').textContent = `Pozycja neutralna ustawiona: bieżący kąt (${(90 - r.ankle).toFixed(0)}° od prostopadłej) = 0°.`; toast('Pozycja neutralna ustawiona – bieżący kąt = 0°.');
}
function calReset() { S.cal.ankle = 0; S.cal.heel = 0; S.cal.heelSet = false; S.hbase = null; S.series = []; resetStats(); resetReps(); $('cal-note').textContent = 'Kalibracja wyzerowana: 0° = stopa dokładnie prostopadle do goleni.' }

/* ---------- nagrywanie / sesje ---------- */
let recTick;
const slugify = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[łŁ]/g, 'l').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
function startRecording() {
  if (!S.running) return;
  let start = 0;
  if (S.trackMode === 'closeup') {
    if (!S.cu || S.cu.state === 'pick' || S.cu.pts.length < 3) { toast('Najpierw wskaż 3 punkty na obrazie (Zbliżenie stopy).', true); return }
    if (S.source === 'file') { video.loop = false; start = S.cu.pick ? S.cu.pick.t : 0; S.mt = start; cuRestore(true) } else video.play().catch(() => { })
  } else if (S.source === 'file') {
    video.loop = false; start = (video.ended || video.currentTime >= (video.duration || 0) - 0.05) ? 0 : video.currentTime; if (start === 0) video.currentTime = 0; S.mt = start; S.userPaused = false; video.play().catch(() => { });
  }
  resetStats(); S.series = []; S.ema = {}; S.lastSeen = {}; S.t0 = S.source === 'file' ? start : clk(); resetReps();
  S.rec = { source: S.source, fileName: S.fileName, t0: S.source === 'file' ? start : clk(), startedAt: new Date(), frames: [], stats: {}, mode: S.trackMode, ex: S.ex, caps: {}, sideN: { L: 0, R: 0 } };
  $('btn-rec').textContent = '⏹ Zakończ pomiar'; $('btn-rec').classList.remove('primary'); $('btn-rec').classList.add('danger'); $('b-rec').hidden = false; $('timer').classList.add('on'); $('btn-pdf').disabled = true;
  recTick = setInterval(() => { if (!S.rec) return; const d = clk() - S.rec.t0; $('timer').textContent = mmss(d); $('b-rec').textContent = 'REC ' + mmss(d); syncDock() }, 200);
  syncDock(); toast('Pomiar rozpoczęty – statystyki zostały zresetowane.'); coachRecStart();
}
function recFrame(vals, t) {
  const r = S.rec; r.frames.push({ t: +(clk() - r.t0).toFixed(3), a: vals.ankle, k: vals.knee, ti: vals.tibia, h: vals.heel }); addStatsTo(r.stats, vals); r.sideN[curSide()]++;
}
const thumbC = document.createElement('canvas');
function thumb() { const sc = Math.min(1, 480 / canvas.width); thumbC.width = Math.round(canvas.width * sc); thumbC.height = Math.round(canvas.height * sc); const g = thumbC.getContext('2d'); g.drawImage(canvas, 0, 0, thumbC.width, thumbC.height); return thumbC.toDataURL('image/jpeg', .72) }
function captureKey() {
  const r = S.rec, v = S.lastVals && S.lastVals.ankle; if (v == null) return; const t = clk() - r.t0, c = r.caps;
  if (!c.max || v > c.max.v + .4) c.max = { v, t, img: thumb() };
  if (!c.min || v < c.min.v - .4) c.min = { v, t, img: thumb() };
}
function stopRecording() {
  if (!S.rec) return; clearInterval(recTick);
  const r = S.rec; r.dur = clk() - r.t0; if (S.source === 'file') video.loop = true; r.endedAt = new Date(); S.rec = null; S.last = r; if (S.reps) endHoldIfAny();
  $('btn-rec').textContent = '▶ Rozpocznij pomiar'; $('btn-rec').classList.add('primary'); $('btn-rec').classList.remove('danger'); $('b-rec').hidden = true; $('timer').classList.remove('on'); $('timer').textContent = mmss(r.dur);
  r.reps = S.reps ? S.reps.total : 0; r.sets = S.reps ? S.reps.sets : 0; r.best = S.reps ? S.reps.best : 0; r.cfg = { ...cfg() }; r.side = r.sideN.L > r.sideN.R ? 'L' : r.sideN.R > r.sideN.L ? 'R' : curSide(); if (r.mode === 'closeup') r.side = S.side === 'auto' ? S.injured : S.side;
  r.calAnkle = S.cal.ankle;
  $('btn-csv').disabled = r.frames.length === 0;
  const sess = r.frames.length >= 8 && statOf('ankle', r.stats) ? buildSession(r) : null;
  const prevSess = sess ? S.hist.filter(h => h.ex === sess.ex && h.side === sess.side && h.m && h.m.key === sess.m.key && h.ts < sess.ts).pop() : null;
  if (sess && $('chk-save').checked) { addSession(sess); toast(`Zapisano w historii: zakres ${sess.m.range.toFixed(0)}°, powtórzeń: ${sess.reps}.`, false, 6000) }
  else if (!sess) toast('Za mało danych w tym pomiarze (nie wykryto stopy) – nic nie zapisano.', true, 7000);
  else toast('Pomiar zakończony (nie zapisano w historii).');
  S.lastSession = sess; syncDock(); refreshHistoryUI(); coachRecEnd(r, sess, prevSess);
}
function endHoldIfAny() { const R = S.reps; if (R && R.holdStart != null) endHold(clk() - S.t0) }
function buildSession(r) {
  const st = k => { const s = statOf(k, r.stats); return s ? { min: +s.min.toFixed(1), max: +s.max.toFixed(1), range: +s.range.toFixed(1), mean: +s.mean.toFixed(1) } : null };
  const ex = EX[r.ex], mk = ex.metric, m = st(mk) || st('ankle'); m.unit = METRICS[mk].unit; m.key = mk;
  const dec = Math.max(1, Math.ceil(r.frames.length / 160)), series = []; for (let i = 0; i < r.frames.length; i += dec) { const f = r.frames[i]; const v = f[{ ankle: 'a', knee: 'k', tibia: 'ti', heel: 'h' }[mk]]; if (v != null) series.push([+f.t.toFixed(2), +v.toFixed(1)]) }
  return {
    id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ts: r.startedAt.toISOString(), side: r.side, ex: r.ex, mode: r.mode, src: r.source, file: r.fileName || null, dur: +r.dur.toFixed(1), n: r.frames.length,
    m, ankle: st('ankle'), knee: st('knee'), tibia: st('tibia'), heel: st('heel'), reps: r.reps, sets: r.sets, setsGoal: r.cfg.sets, repsGoal: r.cfg.reps, bestHold: +r.best.toFixed(1), calib: +(r.calAnkle || 0).toFixed(1),
    ar: +(canvas.width / canvas.height).toFixed(3), series, thumbs: { max: r.caps.max ? { v: +r.caps.max.v.toFixed(1), t: +r.caps.max.t.toFixed(1), img: r.caps.max.img } : null, min: r.caps.min ? { v: +r.caps.min.v.toFixed(1), t: +r.caps.min.t.toFixed(1), img: r.caps.min.img } : null }, client: S.client || ''
  };
}

/* ---------- historia ---------- */
function loadHist() { try { const a = JSON.parse(localStorage.getItem(LS.hist) || '[]'); S.hist = Array.isArray(a) ? a : [] } catch (e) { S.hist = [] } }
function saveHist() {
  for (let i = 0; i < 12; i++) {
    try { localStorage.setItem(LS.hist, JSON.stringify(S.hist)); return true } catch (e) {
      const k = S.hist.find(s => s.thumbs && (s.thumbs.max || s.thumbs.min)); if (!k) { toast('Brak miejsca w pamięci przeglądarki – wyeksportuj historię (JSON) i wyczyść ją.', true, 9000); return false }
      k.thumbs = { max: null, min: null };   // zwalniamy miejsce: usuwamy miniatury najstarszych sesji
    }
  }
  return false;
}
loadHist();
function addSession(s) { S.hist.push(s); S.hist.sort((a, b) => a.ts < b.ts ? -1 : 1); saveHist(); refreshHistoryUI() }
const exName = id => (EX[id] ? EX[id].pl : id);
const dstr = (iso, long) => { const d = new Date(iso); const p = n => String(n).padStart(2, '0'); return long ? `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}` : `${p(d.getDate())}.${p(d.getMonth() + 1)}` };
const dayKey = iso => { const d = new Date(iso); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate() };
function fillExSelects() { const o = Object.values(EX).map(e => `<option value="${e.id}">${e.pl}</option>`).join(''); $('hf-ex').innerHTML = o; $('cmp-ex').innerHTML = o }
function refreshHistoryUI() {
  const ex = $('hf-ex').value || S.ex, list = S.hist.filter(s => s.ex === ex);
  $('hist-sub').textContent = `${S.hist.length} pomiarów łącznie`;
  const rows = [...list].reverse().map(s => `<tr><td>${dstr(s.ts, 1)}</td><td><span class="chip ${s.side}">${s.side === 'L' ? 'L' : 'P'}</span></td><td>${fmtMetric(s.m.key, s.m.min)}…${fmtMetric(s.m.key, s.m.max)}${s.m.unit}</td><td class="big">${s.m.range.toFixed(0)}${s.m.unit}</td><td>${s.reps}</td><td>${s.mode === 'closeup' ? 'zbliż.' : 'noga'}</td><td><button data-del="${s.id}" aria-label="Usuń pomiar" title="Usuń">✕</button></td></tr>`).join('');
  $('hist-table').innerHTML = `<thead><tr><th>Data</th><th>Str.</th><th>Min…max</th><th>Zakres</th><th>Powt.</th><th>Tryb</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="7" style="color:var(--dim)">Brak pomiarów dla tego ćwiczenia.</td></tr>'}</tbody>`;
  drawProgress(); renderCompare();
  const has = S.hist.length > 0; $('btn-pdf').disabled = !has && !(S.last && S.last.frames.length); $('btn-csv').disabled = !(S.last && S.last.frames.length);
  $('export-note').textContent = has ? `Raport obejmie ${S.hist.length} zapisanych pomiarów${S.client ? ' (' + S.client + ')' : ''}.` : 'Raport i eksport aktywują się po zapisaniu pierwszego pomiaru.';
}
const metricOf = (s, kind) => kind === 'range' ? s.m.range : kind === 'max' ? s.m.max : kind === 'min' ? Math.abs(s.m.min) : s.reps;
function dailyBest(list, side, kind) {
  const by = new Map(); for (const s of list.filter(x => x.side === side)) { const k = dayKey(s.ts), v = metricOf(s, kind), p = by.get(k); if (!p || v > p.v) by.set(k, { k, ts: s.ts, v }) } return [...by.values()].sort((a, b) => a.k - b.k);
}
function drawProgress() {
  const c = $('prog-chart'); if (!c.offsetParent && !c.getClientRects().length) return;
  const { g, w, h, dpr } = setupCanvas(c); g.clearRect(0, 0, w, h); const ex = $('hf-ex').value || S.ex, kind = $('hf-metric').value, list = S.hist.filter(s => s.ex === ex);
  const L = 44 * dpr, R = 14 * dpr, T = 14 * dpr, B = 28 * dpr; const sets = ['L', 'R'].map(s => ({ s, d: dailyBest(list, s, kind) })).filter(x => x.d.length);
  g.font = `${11 * dpr}px Inter,sans-serif`; g.textBaseline = 'middle';
  if (!sets.length) { g.fillStyle = '#7C8584'; g.textAlign = 'center'; g.fillText('Brak danych – wykonaj pierwszy pomiar.', w / 2, h / 2); $('prog-legend').innerHTML = ''; return }
  const all = sets.flatMap(x => x.d); let lo = 0, hi = Math.max(...all.map(p => p.v)); const refv = ex === 'pump' ? (kind === 'max' ? REF.dorsi : kind === 'min' ? 45 : kind === 'range' ? 65 : null) : null;
  if (refv) hi = Math.max(hi, refv); hi = Math.ceil((hi * 1.15 + 1) / 5) * 5; const step = hi > 60 ? 20 : hi > 25 ? 10 : 5;
  const keys = all.map(p => p.k), dayN = k => { const y = Math.floor(k / 10000), m = Math.floor(k / 100) % 100, d = k % 100; return Date.UTC(y, m - 1, d) / 864e5 };
  const d0 = Math.min(...keys.map(dayN)), d1 = Math.max(...keys.map(dayN)), span = Math.max(1, d1 - d0);
  const X = k => L + (span === 0 ? .5 : (dayN(k) - d0) / span) * (w - L - R) * (d1 === d0 ? 0 : 1) + (d1 === d0 ? (w - L - R) / 2 : 0), Y = v => T + (1 - (v - lo) / (hi - lo)) * (h - T - B);
  g.strokeStyle = '#363434'; g.fillStyle = '#7C8584'; g.lineWidth = 1; g.textAlign = 'right';
  for (let v = 0; v <= hi; v += step) { g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(w - R, Y(v)); g.stroke(); g.fillText(v + (kind === 'reps' ? '' : '°'), L - 6 * dpr, Y(v)) }
  if (refv) { g.setLineDash([5 * dpr, 5 * dpr]); g.strokeStyle = 'rgba(111,220,209,.7)'; g.beginPath(); g.moveTo(L, Y(refv)); g.lineTo(w - R, Y(refv)); g.stroke(); g.setLineDash([]); g.fillStyle = 'rgba(111,220,209,.85)'; g.textAlign = 'left'; g.fillText('orientacyjnie ' + (kind === 'max' ? '~20°' : kind === 'min' ? '40–50°' : '60–70°'), L + 6 * dpr, Y(refv) - 8 * dpr) }
  g.textAlign = 'center'; g.fillStyle = '#7C8584'; g.textBaseline = 'top'; const ticks = [...new Set(keys)].sort((a, b) => a - b); const maxT = Math.max(2, Math.floor((w - L - R) / (56 * dpr)));
  ticks.filter((_, i) => i % Math.ceil(ticks.length / maxT) === 0).forEach(k => { const d = new Date(Date.UTC(Math.floor(k / 10000), Math.floor(k / 100) % 100 - 1, k % 100)); g.fillText(`${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`, X(k), h - B + 8 * dpr) });
  for (const { s, d } of sets) {
    g.strokeStyle = SIDE_COL[s]; g.fillStyle = SIDE_COL[s]; g.lineWidth = 2.5 * dpr; g.lineJoin = 'round'; g.beginPath(); d.forEach((p, i) => i ? g.lineTo(X(p.k), Y(p.v)) : g.moveTo(X(p.k), Y(p.v))); g.stroke();
    d.forEach(p => { g.beginPath(); g.arc(X(p.k), Y(p.v), 4.5 * dpr, 0, 7); g.fill() });
    const lp = d[d.length - 1]; g.textAlign = 'center'; g.textBaseline = 'bottom'; g.font = `700 ${12 * dpr}px Inter,sans-serif`; g.fillText(Math.round(lp.v) + (kind === 'reps' ? '' : '°'), Math.min(w - R - 10 * dpr, X(lp.k)), Y(lp.v) - 8 * dpr); g.font = `${11 * dpr}px Inter,sans-serif`;
  }
  $('prog-legend').innerHTML = sets.map(x => `<span><b style="background:${SIDE_COL[x.s]}"></b>${SIDE_PL[x.s]} (najlepszy wynik dnia)</span>`).join('');
}
function lastBySide(ex) { const o = {}; for (const s of S.hist) if (s.ex === ex) o[s.side] = s; return o }
function compareRows(ex) {
  const ls = lastBySide(ex); if (!ls.L || !ls.R) return null; const inj = S.injured, hl = inj === 'L' ? 'R' : 'L', A = ls[inj], H = ls[hl]; const pump = ex === 'pump';
  const rows = [[pump ? 'Zakres ruchu kostki' : 'Zakres', 'range', ls.L.m.range, ls.R.m.range, '°'], [pump ? 'Maks. zgięcie grzbietowe' : 'Maksimum', 'max', ls.L.m.max, ls.R.m.max, ls.L.m.unit], [pump ? 'Maks. zgięcie podeszwowe' : 'Minimum', 'min', pump ? Math.abs(ls.L.m.min) : ls.L.m.min, pump ? Math.abs(ls.R.m.min) : ls.R.m.min, ls.L.m.unit], ['Powtórzenia', 'reps', ls.L.reps, ls.R.reps, '']];
  return rows.map(([n, k, l, r, u]) => { const hv = inj === 'L' ? r : l, iv = inj === 'L' ? l : r; const diff = iv - hv; const pct = hv >= 3 ? (hv - iv) / hv * 100 : null; return { n, k, l, r, u, hv, iv, diff, pct } });
}
function compareSummary(ex) { const rows = compareRows(ex); if (!rows) return null; const r = rows[0]; return { rows, ratio: r.hv >= 3 ? r.iv / r.hv * 100 : null, deficit: r.pct, inj: S.injured } }
function renderCompare() {
  const ex = $('cmp-ex').value || S.ex, box = $('cmp-box'), ls = lastBySide(ex), sm = compareSummary(ex);
  if (!sm) { box.innerHTML = `<p class="note" style="margin:0">Potrzebny jest zapisany pomiar <b>obu</b> stron (${ls.L ? 'lewa ✔' : 'lewa –'}, ${ls.R ? 'prawa ✔' : 'prawa –'}) dla ćwiczenia „${exName(ex)}”.</p>`; return }
  const inj = sm.inj, ij = inj === 'L' ? 'lewa' : 'prawa', hs = inj === 'L' ? 'prawa' : 'lewa';
  const f = (v, u) => v == null ? '–' : (Math.abs(v) < 1e6 ? v.toFixed(0) : '–') + u;
  box.innerHTML = `<table class="cmp"><thead><tr><th>Wskaźnik</th><th class="L">Lewa${inj === 'L' ? ' (po urazie)' : ''}</th><th class="R">Prawa${inj === 'R' ? ' (po urazie)' : ''}</th><th>Różnica</th><th>Deficyt</th></tr></thead><tbody>${sm.rows.map(r => `<tr><td>${r.n}</td><td class="big">${f(r.l, r.u)}</td><td class="big">${f(r.r, r.u)}</td><td>${r.diff > 0 ? '+' : r.diff < 0 ? '−' : ''}${Math.abs(r.diff).toFixed(0)}${r.u}</td><td class="${r.pct != null && r.pct > 10 ? 'neg' : 'pos'}">${r.pct == null ? '–' : (r.pct < -0.5 ? '+' + Math.abs(r.pct).toFixed(0) : Math.max(0, r.pct).toFixed(0)) + '%'}</td></tr>`).join('')}</tbody></table>
  <p class="note" style="margin-top:10px">${sm.ratio == null ? 'Zakres nogi zdrowej jest zbyt mały do wyliczenia asymetrii.' : `Zakres ruchu nogi po urazie (${ij}) to <b>${sm.ratio.toFixed(0)}%</b> zakresu nogi zdrowej (${hs}); deficyt ${sm.deficit.toFixed(0)}%.`} Deficyt = (zdrowa − kontuzjowana) / zdrowa.</p>`;
}
/* eksport / import historii */
function stampStr(d) { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}` }
function triggerDownload(b, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 4000) }
let sheetUrl = null;
function closeSheet() { $('sheet').hidden = true; if (sheetUrl) { const u = sheetUrl; sheetUrl = null; setTimeout(() => URL.revokeObjectURL(u), 60000) } }
function deliver(blob, name, mime, opt = {}) {
  const useSheet = opt.sheet ?? IS_MOBILE; if (!useSheet) { triggerDownload(blob, name); return }
  const file = new File([blob], name, { type: mime }); if (sheetUrl) URL.revokeObjectURL(sheetUrl); sheetUrl = URL.createObjectURL(blob);
  $('sheet-name').textContent = name; $('sh-open').href = sheetUrl; $('sh-dl').href = sheetUrl; $('sh-dl').download = name;
  let canShare = false; try { canShare = !!(navigator.canShare && navigator.canShare({ files: [file] })) } catch (e) { } $('sh-share').hidden = !canShare;
  $('sh-share').onclick = async () => { try { await navigator.share({ files: [file], title: name }) } catch (e) { if (e.name !== 'AbortError') toast('Udostępnianie nie powiodło się – użyj „Pobierz” lub „Otwórz”.', true, 6000) } };
  $('sheet').hidden = false; $('sheet').querySelector('.btn:not([hidden])').focus?.();
}
function download(name, mime, data) { const b = new Blob([data], { type: mime }); if (IS_IOS) deliver(b, name, mime, { sheet: true }); else triggerDownload(b, name) }
function exportHistJSON() {
  const doc = { app: 'Rehabilitacja stopy', author: 'Wojciech Wieczorek', version: 1, exportedAt: new Date().toISOString(), injuredSide: S.injured, client: S.client, sessions: S.hist };
  download(`rehabilitacja-stopy-historia-${stampStr(new Date())}.json`, 'application/json', JSON.stringify(doc));
}
const csvq = v => { v = v == null ? '' : String(v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v };
function exportHistCSV() {
  const head = ['data', 'strona', 'cwiczenie', 'tryb', 'zrodlo', 'czas_s', 'wskaznik', 'min', 'max', 'zakres', 'kostka_min', 'kostka_max', 'kostka_zakres', 'kolano_min', 'kolano_max', 'powtorzenia', 'serie', 'cel_serie', 'cel_powt', 'utrzymanie_s'];
  const rows = [head.join(',')]; const n = v => v == null ? '' : v;
  for (const s of S.hist) rows.push([s.ts, s.side === 'L' ? 'lewa' : 'prawa', s.ex, s.mode, s.src, s.dur, s.m.key, s.m.min, s.m.max, s.m.range, n(s.ankle?.min), n(s.ankle?.max), n(s.ankle?.range), n(s.knee?.min), n(s.knee?.max), s.reps, s.sets, s.setsGoal, s.repsGoal, s.bestHold].map(csvq).join(','));
  download(`rehabilitacja-stopy-historia-${stampStr(new Date())}.csv`, 'text/csv;charset=utf-8', '\ufeff' + rows.join('\n') + '\n');
}
function exportMeasureCSV() {
  const r = S.last; if (!r) return; const q = v => v == null ? '' : (+v).toFixed(2);
  const rows = ['time_s,ankle_deg_dorsi_plus,knee_deg,tibia_incl_deg,heel_pct_foot_length']; for (const f of r.frames) rows.push([f.t.toFixed(3), q(f.a), q(f.k), q(f.ti), q(f.h)].join(','));
  download(`rehabilitacja-stopy-pomiar-${stampStr(r.startedAt)}.csv`, 'text/csv;charset=utf-8', '\ufeff' + rows.join('\n') + '\n');
}
async function importHist(file) {
  try {
    const doc = JSON.parse(await file.text()); const arr = Array.isArray(doc) ? doc : doc.sessions; if (!Array.isArray(arr)) throw new Error('format');
    const ok = arr.filter(s => s && s.id && s.ts && (s.side === 'L' || s.side === 'R') && EX[s.ex] && s.m && isFinite(s.m.range)); const ids = new Set(S.hist.map(s => s.id)); let add = 0;
    for (const s of ok) if (!ids.has(s.id)) { S.hist.push(s); add++ }
    S.hist.sort((a, b) => a.ts < b.ts ? -1 : 1); saveHist(); refreshHistoryUI(); toast(`Zaimportowano ${add} pomiarów (pominięto ${arr.length - add} duplikatów lub błędnych).`, false, 6000);
  } catch (e) { toast('Nie udało się zaimportować pliku – wybierz plik JSON wyeksportowany z tej aplikacji.', true, 7000) }
}

/* ---------- PDF: „Raport rehabilitacji stopy” ---------- */
const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => { s.remove(); rej(new Error('script ' + src)) }; document.head.appendChild(s) });
let pdfLibPromise;
function loadPdfLib() {
  if (window.jspdf?.jsPDF && window.BRC_FONTS) return Promise.resolve();
  return pdfLibPromise || (pdfLibPromise = (async () => {
    if (!window.jspdf?.jsPDF) { try { await loadScript(`https://cdn.jsdelivr.net/npm/jspdf@${JSPDF_VER}/dist/jspdf.umd.min.js`) } catch (e) { console.warn('jsPDF z CDN niedostępny – wersja lokalna', e); await loadScript('./assets/vendor/jspdf.umd.min.js') } }
    if (!window.BRC_FONTS) await loadScript('./assets/vendor/report-fonts.js');
  })().catch(e => { pdfLibPromise = null; throw e }));
}
const logoPng = () => new Promise(res => { const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); c.width = 1818; c.height = 468; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/png')) }; img.onerror = () => res(null); img.src = './assets/logo-bikerc.svg' });
const PDFC = { dark: '#232222', teal: '#2EC4B6', tealD: '#12958A', tealL: '#E6F7F5', grey: '#6B7170', line: '#D5DCDA', bg: '#F2F4F3', L: '#12A89B', R: '#E39A0B', warn: '#C27A00', red: '#C0392B' };
function makeObservations(hist, focus) {
  const obs = []; const f0 = x => x.toFixed(0), sg = v => (v > 0.4 ? '+' : v < -0.4 ? '−' : '') + Math.abs(v).toFixed(0);
  const a = focus.ankle;
  if (a && focus.ex === 'pump') {
    obs.push({ k: a.max >= 15 ? 'ok' : 'info', t: `Maksymalne zgięcie grzbietowe w ostatnim pomiarze: ${sg(a.max)}° (orientacyjnie dla zdrowej kostki ok. 20°).` });
    obs.push({ k: -a.min >= 35 ? 'ok' : 'info', t: `Maksymalne zgięcie podeszwowe: ${sg(a.min)}° (orientacyjnie 40–50°). Całkowity zakres: ${f0(a.range)}° (orientacyjnie 60–70°).` });
  } else obs.push({ k: 'info', t: `Ostatni pomiar: ${exName(focus.ex)} – zakres wskaźnika ${f0(focus.m.range)}${focus.m.unit}, powtórzeń: ${focus.reps}.` });
  if (!focus.calib) obs.push({ k: 'warn', t: 'Ostatni pomiar wykonano bez ustawienia pozycji neutralnej – kąty są liczone względem stopy prostopadłej do goleni (0° = 90° w stawie skokowym). Dla dokładniejszych wyników użyj przycisku „Ustaw pozycję neutralną”.' });
  if (focus.mode === 'closeup') obs.push({ k: 'info', t: 'Pomiar w trybie „Zbliżenie stopy”: kąt wyznaczono między osią goleni a linią kostka–palce na podstawie 3 punktów wskazanych ręcznie i śledzonych w filmie.' });
  const sideArr = s => hist.filter(h => h.ex === focus.ex && h.side === s);
  for (const sd of ['L', 'R']) { const arr = sideArr(sd); if (arr.length >= 2) { const d = arr[arr.length - 1].m.range - arr[0].m.range; obs.push({ k: d >= 0 ? 'ok' : 'warn', t: `Strona ${sd === 'L' ? 'lewa' : 'prawa'}: zmiana zakresu od pierwszego pomiaru (${dstr(arr[0].ts)}) do ostatniego (${dstr(arr[arr.length - 1].ts)}): ${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(0)}${focus.m.unit}.` }) } }
  const cs = compareSummary(focus.ex); if (cs && cs.ratio != null) obs.push({ k: cs.deficit > 10 ? 'warn' : 'ok', t: `Zakres nogi po urazie to ${cs.ratio.toFixed(0)}% zakresu nogi zdrowej (deficyt ${Math.max(0, cs.deficit).toFixed(0)}%).` });
  if (focus.n < 60) obs.push({ k: 'warn', t: `Pomiar był krótki (${focus.n} próbek) – wyniki mogą nie być reprezentatywne.` });
  return obs;
}
function pdfLine(doc, pts, col, w) { // polilinia z przerwami
  doc.setDrawColor(col); doc.setLineWidth(w); let seg = []; const flush = () => { if (seg.length > 1) { const l = []; for (let q = 1; q < seg.length; q++) l.push([seg[q][0] - seg[q - 1][0], seg[q][1] - seg[q - 1][1]]); doc.lines(l, seg[0][0], seg[0][1], [1, 1], 'S', false) } seg = [] };
  for (const p of pts) { if (p == null) flush(); else seg.push(p) } flush();
}
async function makeReport() {
  let hist = S.hist.slice(); if (!hist.length && S.last && S.last.frames.length >= 8) { const t = buildSession(S.last); if (t) hist = [t] }
  if (!hist.length) { toast('Brak zapisanych pomiarów – wykonaj pomiar, aby wygenerować raport.', true); return }
  const btn = $('btn-pdf'); btn.disabled = true; const old = btn.textContent; btn.textContent = 'Generuję PDF…';
  try {
    await loadPdfLib(); const logo = await logoPng(); const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true }); const F = window.BRC_FONTS, C = PDFC;
    doc.addFileToVFS('Inter-Regular.ttf', F.inter); doc.addFont('Inter-Regular.ttf', 'Inter', 'normal'); doc.addFileToVFS('Inter-Bold.ttf', F.interBold); doc.addFont('Inter-Bold.ttf', 'Inter', 'bold');
    doc.addFileToVFS('Archivo-BlackItalic.ttf', F.archivoBlackItalic); doc.addFont('Archivo-BlackItalic.ttf', 'Archivo', 'italic'); doc.addFileToVFS('Archivo-Bold.ttf', F.archivoBold); doc.addFont('Archivo-Bold.ttf', 'Archivo', 'bold');
    const PW = 210, PH = 297, M = 15, CW = PW - 2 * M; hist.sort((a, b) => a.ts < b.ts ? -1 : 1);
    const focus = hist[hist.length - 1], ex0 = focus.ex, injured = S.injured, healthy = injured === 'L' ? 'R' : 'L';
    const txt = (s, x, y, o) => doc.text(Array.isArray(s) ? s : String(s), x, y, o);
    const font = (f, st, sz, col) => { doc.setFont(f, st); doc.setFontSize(sz); doc.setTextColor(col || C.dark) };
    const section = (title, y) => { if (y > PH - 40) { doc.addPage(); y = 20 } font('Archivo', 'bold', 10.5, C.dark); txt(title.toUpperCase(), M, y); doc.setDrawColor(C.teal); doc.setLineWidth(.7); doc.line(M, y + 1.8, M + 10, y + 1.8); doc.setDrawColor(C.line); doc.setLineWidth(.2); doc.line(M + 10, y + 1.8, PW - M, y + 1.8); return y + 7 };
    const U = s => s.m.unit, sg = (v, d = 0) => (v > 0.0001 ? '+' : v < -0.0001 ? '−' : '') + Math.abs(v).toFixed(d);
    /* nagłówek */
    if (logo) doc.addImage(logo, 'PNG', M, 12, 48, 48 * 468 / 1818); else { font('Archivo', 'italic', 22, C.teal); txt('BikeRc', M, 20) }
    font('Archivo', 'italic', 20, C.dark); txt('Raport rehabilitacji stopy', PW - M, 19, { align: 'right' });
    font('Inter', 'normal', 9, C.grey); txt('Pomiar zakresu ruchu stawu skokowego (kostki) z kamery lub filmu', PW - M, 25.5, { align: 'right' });
    doc.setFillColor(C.teal); doc.rect(M, 32, CW, 1.2, 'F'); let y = 41;
    const first = hist[0], nS = hist.length, days = new Set(hist.map(h => dayKey(h.ts))).size;
    const info = [['Pacjent', S.client || '—'], ['Data raportu', new Date().toLocaleString('pl-PL', { dateStyle: 'long', timeStyle: 'short' })], ['Strona po urazie', injured === 'L' ? 'lewa' : 'prawa'], ['Liczba pomiarów', `${nS} (${days} dni)`], ['Okres', dstr(first.ts) + ' – ' + dstr(focus.ts, 1)], ['Ostatnie ćwiczenie', exName(focus.ex)]];
    const cw = CW / 3; doc.setFillColor(C.bg); doc.roundedRect(M, y, CW, 33, 2, 2, 'F');
    info.forEach((it, i) => { const cx = M + 5 + (i % 3) * cw, cy = y + 8 + Math.floor(i / 3) * 15.5; font('Inter', 'bold', 7, C.grey); txt(it[0].toUpperCase(), cx, cy); font('Inter', 'bold', 9.6, C.dark); let l = doc.splitTextToSize(it[1], cw - 7); if (l.length > 1) { font('Inter', 'bold', 8.2, C.dark); l = doc.splitTextToSize(it[1], cw - 7) } txt(l.slice(0, 2), cx, cy + 5.5) });
    y += 33 + 7;
    /* klatki */
    y = section('Klatki z ostatniego pomiaru', y);
    const th = [['max', 'Maks. zgięcie grzbietowe'], ['min', 'Maks. zgięcie podeszwowe']].filter(([k]) => focus.thumbs && focus.thumbs[k]);
    if (th.length) {
      const gap = 6, iw = (CW - gap) / 2, ar = focus.ar || 16 / 9, maxH = 60; let w = iw, h = iw / ar; if (h > maxH) { h = maxH; w = h * ar }
      th.forEach(([k, title], i) => { const c = focus.thumbs[k], x0 = M + i * (iw + gap) + (iw - w) / 2; doc.setDrawColor(C.line); doc.setLineWidth(.3); doc.addImage(c.img, 'JPEG', x0, y, w, h, undefined, 'FAST'); doc.rect(x0, y, w, h, 'S'); font('Inter', 'bold', 8.5, C.dark); txt(`${title}: ${sg(c.v)}°`, M + i * (iw + gap), y + h + 5); font('Inter', 'normal', 7.5, C.grey); txt(`klatka z ${c.t.toFixed(1)} s ${focus.src === 'file' ? 'filmu' : 'pomiaru'} · strona ${focus.side === 'L' ? 'lewa' : 'prawa'}`, M + i * (iw + gap), y + h + 9.2) });
      y += h + 15;
    } else { font('Inter', 'normal', 9, C.grey); txt('Brak zapisanych klatek (miniatury mogły zostać usunięte, aby zwolnić miejsce w pamięci przeglądarki).', M, y + 4); y += 12 }
    /* KPI */
    y = section(`Kluczowe wyniki – ostatni pomiar (${dstr(focus.ts, 1)}, strona ${focus.side === 'L' ? 'lewa' : 'prawa'})`, y);
    const a = focus.ankle, kp = focus.ex === 'pump' && a ? [['Zakres ruchu kostki', f0p(a.range) + '°', `${sg(a.min)}° … ${sg(a.max)}°`], ['Maks. zgięcie grzbietowe', sg(a.max) + '°', 'orient. ok. +20°'], ['Maks. zgięcie podeszwowe', sg(a.min) + '°', 'orient. −40…−50°'], ['Powtórzenia', String(focus.reps), `cel ${focus.setsGoal}×${focus.repsGoal}`]] : [['Zakres', f0p(focus.m.range) + U(focus), exName(focus.ex)], ['Maksimum', sg(focus.m.max) + U(focus), ''], ['Minimum', sg(focus.m.min) + U(focus), ''], ['Powtórzenia', String(focus.reps), `cel ${focus.setsGoal}×${focus.repsGoal}`]];
    function f0p(v) { return v.toFixed(0) }
    const kw = (CW - 3 * 4) / 4; kp.forEach((k, i) => { const x0 = M + i * (kw + 4); doc.setFillColor('#FFFFFF'); doc.setDrawColor(C.line); doc.setLineWidth(.3); doc.roundedRect(x0, y, kw, 24, 2, 2, 'FD'); doc.setFillColor(C.teal); doc.rect(x0, y + 3, 1.2, 18, 'F'); font('Inter', 'bold', 6.6, C.grey); txt(doc.splitTextToSize(k[0].toUpperCase(), kw - 6)[0], x0 + 4, y + 6.5); font('Archivo', 'italic', k[1].length > 6 ? 15 : 20, C.dark); txt(k[1], x0 + 4, y + 15.5); font('Inter', 'normal', 7.3, C.grey); txt(k[2], x0 + 4, y + 20.5) });
    y += 24 + 9;
    /* porównanie */
    y = section(`Porównanie lewa / prawa – ${exName(ex0)}`, y);
    const cmp = compareRows(ex0);
    if (cmp) {
      const cs = [['Wskaźnik', 60, 'l'], ['Lewa' + (injured === 'L' ? ' (po urazie)' : ''), 38, 'r'], ['Prawa' + (injured === 'R' ? ' (po urazie)' : ''), 38, 'r'], ['Różnica', 22, 'r'], ['Deficyt', 22, 'r']], sw = cs.reduce((s, c) => s + c[1], 0), sc = CW / sw; const xs = []; let ax = M; cs.forEach(c => { xs.push(ax); ax += c[1] * sc }); const cr = i => xs[i] + cs[i][1] * sc - 2;
      doc.setFillColor(C.dark); doc.rect(M, y, CW, 6, 'F'); font('Inter', 'bold', 7.5, '#FFFFFF'); cs.forEach((c, i) => c[2] === 'l' ? txt(c[0].toUpperCase(), xs[i] + 2, y + 4.2) : txt(c[0].toUpperCase(), cr(i), y + 4.2, { align: 'right' })); y += 6;
      cmp.forEach((r, ri) => { if (ri % 2) { doc.setFillColor('#FAFBFA'); doc.rect(M, y, CW, 7, 'F') } font('Inter', 'bold', 9, C.dark); txt(r.n, xs[0] + 2, y + 4.8); font('Inter', 'bold', 9.5, C.dark); txt(r.l.toFixed(0) + r.u, cr(1), y + 4.8, { align: 'right' }); txt(r.r.toFixed(0) + r.u, cr(2), y + 4.8, { align: 'right' }); font('Inter', 'normal', 9, C.dark); txt((r.diff > 0.5 ? '+' : r.diff < -0.5 ? '−' : '') + Math.abs(r.diff).toFixed(0) + r.u, cr(3), y + 4.8, { align: 'right' }); const bad = r.pct != null && r.pct > 10; doc.setTextColor(bad ? C.warn : C.dark); txt(r.pct == null ? '–' : (r.pct < -0.5 ? '+' + Math.abs(r.pct).toFixed(0) : Math.max(0, r.pct).toFixed(0)) + '%', cr(4), y + 4.8, { align: 'right' }); doc.setDrawColor(C.line); doc.setLineWidth(.15); doc.line(M, y + 7, M + CW, y + 7); y += 7 });
      const sm = compareSummary(ex0); font('Inter', 'normal', 7.8, C.grey); const tl = doc.splitTextToSize((sm.ratio == null ? '' : `Zakres nogi po urazie to ${sm.ratio.toFixed(0)}% zakresu nogi zdrowej. `) + 'Deficyt = (strona zdrowa − kontuzjowana) / zdrowa, z ostatnich pomiarów każdej strony. Wartości w tabeli pochodzą z ostatniego zapisanego pomiaru dla każdej strony.', CW); txt(tl, M, y + 4.5); y += 4.5 + tl.length * 3.5 + 6;
    } else { font('Inter', 'normal', 9, C.grey); txt(doc.splitTextToSize(`Brak pomiarów obu stron dla ćwiczenia „${exName(ex0)}” – wykonaj pomiar zdrowej i kontuzjowanej nogi, aby zobaczyć porównanie.`, CW), M, y + 3); y += 14 }
    /* wartości orientacyjne */
    y = section('Zakresy orientacyjne dla zdrowego stawu skokowego', y);
    doc.setFillColor(C.tealL); doc.roundedRect(M, y, CW, 20, 2, 2, 'F'); font('Inter', 'bold', 9, C.dark);
    txt('Zgięcie grzbietowe (palce do goleni): orientacyjnie ok. 20°', M + 5, y + 7); txt('Zgięcie podeszwowe (palce w dół): orientacyjnie ok. 40–50°', M + 5, y + 13); font('Inter', 'normal', 7.6, C.grey); txt('Wartości różnią się osobniczo i zależą od metody pomiaru – to tylko punkt odniesienia, a nie cel do osiągnięcia na siłę.', M + 5, y + 18);
    y += 28;
    /* obserwacje */
    y = section('Obserwacje automatyczne (orientacyjne)', y); const colOf = { ok: C.tealD, warn: C.warn, info: C.grey };
    for (const o of makeObservations(hist, focus)) { const lines = doc.splitTextToSize(o.t, CW - 8), h = lines.length * 4.2; if (y + h > PH - 24) { doc.addPage(); y = 20 } doc.setFillColor(colOf[o.k]); doc.circle(M + 1.5, y - 1.1, 1.1, 'F'); font('Inter', 'normal', 9, C.dark); txt(lines, M + 6, y); y += h + 2.6 }
    /* strona: sesje + wykresy */
    y += 4; if (y > PH - 70) { doc.addPage(); y = 20 } y = section('Pomiary (sesje)', y);
    const sc = [['Data', 30, 'l'], ['Str.', 12, 'l'], ['Ćwiczenie', 44, 'l'], ['Min…max', 30, 'r'], ['Zakres', 18, 'r'], ['Powt.', 14, 'r'], ['Tryb', 22, 'r']], sw2 = sc.reduce((s, c) => s + c[1], 0), k2 = CW / sw2, xs2 = []; let ax2 = M; sc.forEach(c => { xs2.push(ax2); ax2 += c[1] * k2 }); const cr2 = i => xs2[i] + sc[i][1] * k2 - 2;
    const head = yy => { doc.setFillColor(C.dark); doc.rect(M, yy, CW, 6, 'F'); font('Inter', 'bold', 7.2, '#FFFFFF'); sc.forEach((c, i) => c[2] === 'l' ? txt(c[0].toUpperCase(), xs2[i] + 2, yy + 4.2) : txt(c[0].toUpperCase(), cr2(i), yy + 4.2, { align: 'right' })); return yy + 6 };
    y = head(y); const rows = [...hist].reverse().slice(0, 60);
    rows.forEach((s, ri) => { if (y > PH - 24) { doc.addPage(); y = head(20) } if (ri % 2) { doc.setFillColor('#FAFBFA'); doc.rect(M, y, CW, 6.2, 'F') } font('Inter', 'normal', 8.4, C.dark); txt(dstr(s.ts, 1), xs2[0] + 2, y + 4.4); doc.setFillColor(s.side === 'L' ? C.L : C.R); doc.rect(xs2[1] + 2, y + 1.3, 3.2, 3.2, 'F'); txt(s.side === 'L' ? 'L' : 'P', xs2[1] + 6.4, y + 4.4); txt(exName(s.ex), xs2[2] + 2, y + 4.4); txt(`${sg(s.m.min)}…${sg(s.m.max)}${U(s)}`, cr2(3), y + 4.4, { align: 'right' }); font('Inter', 'bold', 8.6, C.dark); txt(s.m.range.toFixed(0) + U(s), cr2(4), y + 4.4, { align: 'right' }); font('Inter', 'normal', 8.4, C.dark); txt(String(s.reps), cr2(5), y + 4.4, { align: 'right' }); txt(s.mode === 'closeup' ? 'zbliżenie' : 'cała noga', cr2(6), y + 4.4, { align: 'right' }); doc.setDrawColor(C.line); doc.setLineWidth(.12); doc.line(M, y + 6.2, M + CW, y + 6.2); y += 6.2 });
    if (hist.length > 60) { font('Inter', 'normal', 7.5, C.grey); txt(`Pokazano 60 najnowszych z ${hist.length} pomiarów (pełna lista w eksporcie JSON/CSV).`, M, y + 4.5); y += 6 }
    y += 8;
    /* wykres postępu */
    if (y > PH - 105) { doc.addPage(); y = 20 }
    y = section(`Postęp w czasie – zakres ruchu (${exName(ex0)})`, y);
    { const px = M + 10, py = y + 2, pw = CW - 12, ph = 52; const lst = hist.filter(h => h.ex === ex0); const sets = ['L', 'R'].map(s => ({ s, d: dailyBest(lst, s, 'range') })).filter(x => x.d.length); const all = sets.flatMap(x => x.d);
      doc.setFillColor('#FFFFFF'); doc.setDrawColor(C.line); doc.setLineWidth(.25); doc.rect(px, py, pw, ph, 'FD');
      let hi = Math.max(10, ...all.map(p => p.v)); if (ex0 === 'pump') hi = Math.max(hi, 65); hi = Math.ceil(hi * 1.1 / 10) * 10; const dayN = k => Date.UTC(Math.floor(k / 10000), Math.floor(k / 100) % 100 - 1, k % 100) / 864e5; const dn = all.map(p => dayN(p.k)), d0 = Math.min(...dn), d1 = Math.max(...dn);
      const X = k => px + (d1 === d0 ? pw / 2 : 8 + (dayN(k) - d0) / (d1 - d0) * (pw - 16)), Y = v => py + ph - 4 - v / hi * (ph - 10);
      font('Inter', 'normal', 6.8, C.grey); doc.setDrawColor('#E6EAE9'); doc.setLineWidth(.12); const stp = hi > 60 ? 20 : 10; for (let v = 0; v <= hi; v += stp) { doc.line(px, Y(v), px + pw, Y(v)); txt(v + '°', px - 1.5, Y(v) + 1.2, { align: 'right' }) }
      if (ex0 === 'pump') { doc.setDrawColor(C.tealD); doc.setLineWidth(.25); doc.setLineDashPattern?.([1.5, 1.5], 0); doc.line(px, Y(65), px + pw, Y(65)); doc.setLineDashPattern?.([], 0); font('Inter', 'normal', 6.8, C.tealD); txt('orientacyjnie 60–70° (zdrowy staw)', px + 2, Y(65) - 1.2) }
      const ticks = [...new Set(all.map(p => p.k))].sort((a, b) => a - b); const mx = Math.max(2, Math.floor(pw / 22)); font('Inter', 'normal', 6.8, C.grey); ticks.filter((_, i) => i % Math.ceil(ticks.length / mx) === 0).forEach(k => { const d = new Date(dayN(k) * 864e5); txt(`${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`, X(k), py + ph + 3.8, { align: 'center' }) });
      for (const { s, d } of sets) { pdfLine(doc, d.map(p => [X(p.k), Y(p.v)]), s === 'L' ? C.L : C.R, .6); doc.setFillColor(s === 'L' ? C.L : C.R); d.forEach(p => doc.circle(X(p.k), Y(p.v), .9, 'F')); const lp = d[d.length - 1]; font('Inter', 'bold', 7.4, C.dark); txt(lp.v.toFixed(0) + '°', X(lp.k), Y(lp.v) - 2, { align: 'center' }) }
      if (!sets.length) { font('Inter', 'normal', 8.5, C.grey); txt('Brak danych.', px + pw / 2, py + ph / 2, { align: 'center' }) }
      sets.forEach((x, i) => { doc.setFillColor(x.s === 'L' ? C.L : C.R); doc.rect(px + 2 + i * 58, py + ph + 6.8, 5, 1.2, 'F'); font('Inter', 'normal', 7, C.grey); txt(x.s === 'L' ? 'lewa (najlepszy wynik dnia)' : 'prawa (najlepszy wynik dnia)', px + 8.5 + i * 58, py + ph + 7.9) });
      y += ph + 17; }
    /* przebieg ostatniego pomiaru */
    if (y > PH - 80) { doc.addPage(); y = 20 }
    y = section(`Przebieg ostatniego pomiaru – ${METRICS[focus.m.key].pl.toLowerCase()}`, y);
    { const px = M + 10, py = y + 2, pw = CW - 12, ph = 46, pts = focus.series || []; doc.setFillColor('#FFFFFF'); doc.setDrawColor(C.line); doc.setLineWidth(.25); doc.rect(px, py, pw, ph, 'FD');
      if (pts.length > 1) { const dur = Math.max(1, pts[pts.length - 1][0]); let lo = Math.min(...pts.map(p => p[1])), hi = Math.max(...pts.map(p => p[1])); if (focus.m.key === 'ankle') { lo = Math.min(lo, -45); hi = Math.max(hi, 22) } lo = Math.floor((lo - 4) / 10) * 10; hi = Math.ceil((hi + 4) / 10) * 10; const X = t => px + t / dur * pw, Y = v => py + ph - (v - lo) / (hi - lo) * ph;
        if (focus.m.key === 'ankle') { doc.saveGraphicsState(); doc.setGState(new doc.GState({ opacity: .16 })); doc.setFillColor(C.teal); doc.rect(px, Y(Math.min(20, hi)), pw, Y(0) - Y(Math.min(20, hi)), 'F'); doc.setFillColor('#FEDA75'); doc.rect(px, Y(-40), pw, Y(-50) - Y(-40), 'F'); doc.restoreGraphicsState() }
        font('Inter', 'normal', 6.6, C.grey); doc.setDrawColor('#E6EAE9'); doc.setLineWidth(.12); const st = (hi - lo) > 60 ? 20 : 10; for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) { doc.line(px, Y(v), px + pw, Y(v)); txt((v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + '°', px - 1.5, Y(v) + 1.2, { align: 'right' }) }
        const nt = Math.min(6, Math.max(2, Math.round(dur / 4) + 1)); for (let k = 0; k < nt; k++) { const t = dur * k / (nt - 1); txt(t.toFixed(dur < 20 ? 1 : 0) + ' s', X(t), py + ph + 3.6, { align: 'center' }) }
        pdfLine(doc, pts.map(p => [X(p[0]), Y(p[1])]), focus.side === 'L' ? C.L : C.R, .5); if (focus.m.key === 'ankle') { font('Inter', 'normal', 6.6, C.tealD); txt('pasmo zielone: 0…+20° (orient.); żółte: −40…−50° (orient.)', px + 2, py + 3.6) } }
      y += ph + 12; }
    /* metodyka */
    if (y > PH - 55) { doc.addPage(); y = 20 }
    y = section('Metodyka i zastrzeżenie', y); font('Inter', 'normal', 8, C.grey);
    const meth = 'Kąt kostki to kąt między osią goleni a linią stopy (pięta–palce) w płaszczyźnie obrazu (2D), przedstawiony względem pozycji neutralnej: wartości dodatnie oznaczają zgięcie grzbietowe, ujemne – podeszwowe. W trybie „Cała noga” punkty (kolano, kostka, pięta, palce) wyznacza model MediaPipe PoseLandmarker uruchamiany lokalnie w przeglądarce. W trybie „Zbliżenie stopy” trzy punkty wskazuje użytkownik, a aplikacja śledzi je w filmie; kąt między dwoma odcinkami nie zależy od drżenia kamery. Obraz nie jest nigdzie wysyłany; dane trwają tylko w przeglądarce użytkownika. Dokładność zależy od ustawienia kamery (prostopadle do płaszczyzny ruchu, na wysokości kostki), oświetlenia i kontrastu tła – pomiar nie zastępuje goniometru.';
    const ml = doc.splitTextToSize(meth, CW); txt(ml, M, y); y += ml.length * 3.6 + 3;
    doc.setFillColor('#FFF6DD'); font('Inter', 'bold', 8.4, '#7A5A00'); const dl = doc.splitTextToSize('To narzędzie orientacyjne – wynik nie jest diagnozą medyczną ani oceną stanu zdrowia. Zakres i rodzaj ćwiczeń oraz wszelkie decyzje dotyczące rehabilitacji należy skonsultować z fizjoterapeutą lub lekarzem prowadzącym.', CW - 12); doc.roundedRect(M, y, CW, dl.length * 4 + 7, 2, 2, 'F'); font('Inter', 'bold', 8.4, '#7A5A00'); txt(dl, M + 5, y + 6);
    /* stopki */
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setDrawColor(C.line); doc.setLineWidth(.2); doc.line(M, PH - 17, PW - M, PH - 17); font('Inter', 'normal', 6.8, C.grey); txt('Wartości orientacyjne, generowane automatycznie – nie stanowią diagnozy medycznej. Skonsultuj ćwiczenia z fizjoterapeutą.', M, PH - 12.5); font('Inter', 'bold', 8, C.tealD); txt('© Wojciech Wieczorek', M, PH - 7); const cw = doc.getTextWidth('© Wojciech Wieczorek'); font('Inter', 'normal', 8, C.grey); txt('· Rehabilitacja stopy – prototyp', M + cw + 2.2, PH - 7); txt(`Strona ${i} z ${n}`, PW - M, PH - 7, { align: 'right' }) }
    doc.setProperties({ title: 'Raport rehabilitacji stopy' + (S.client ? ' – ' + S.client : ''), author: 'Wojciech Wieczorek', subject: 'Zakres ruchu stawu skokowego', creator: 'Rehabilitacja stopy – Wojciech Wieczorek' });
    S.lastPdfBlob = doc.output('blob'); deliver(S.lastPdfBlob, `rehabilitacja-stopy-raport-${stampStr(new Date())}.pdf`, 'application/pdf'); toast(IS_MOBILE ? 'Raport PDF gotowy.' : 'Raport PDF zapisany.'); Coach.say('Raport PDF gotowy.', { p: 2, v: 'minimal', key: 'pdf', ttl: 8000 });
  } catch (e) { console.error(e); toast('Nie udało się wygenerować raportu PDF: ' + (e && e.message || e), true, 9000) }
  btn.disabled = false; btn.textContent = old;
}

/* ---------- zdarzenia ---------- */
const toggleCam = () => S.running ? stopAll() : startCamera();
const MQL = matchMedia(MOBILE_MQ);
function applyLayoutDefaults() {
  const mob = MQL.matches; for (const id of ['c-chart', 'c-hist', 'c-compare', 'c-tips', 'c-set']) $(id).open = !mob;
  for (const id of ['c-live', 'c-ex', 'c-mode', 'c-measure', 'c-export']) $(id).open = true;
}
applyLayoutDefaults(); MQL.addEventListener?.('change', applyLayoutDefaults);
document.querySelectorAll('.fold>summary').forEach(s => s.addEventListener('click', e => { if (!MQL.matches && !e.target.closest('button')) e.preventDefault() }));
['c-live', 'c-chart'].forEach(id => $(id).addEventListener('toggle', () => { if ($(id).open) { updatePanels(); renderMain() } }));
['c-hist', 'c-compare'].forEach(id => $(id).addEventListener('toggle', () => { if ($(id).open) refreshHistoryUI() }));
function isFs() { const st = $('stage'); return document.fullscreenElement === st || document.webkitFullscreenElement === st || st.classList.contains('fake-fs') }
function updateFs() { const f = isFs(); $('s-fs').textContent = f ? '✕' : '⛶'; $('s-fs').setAttribute('aria-label', f ? 'Zamknij pełny ekran' : 'Pełny ekran'); document.body.style.overflow = $('stage').classList.contains('fake-fs') ? 'hidden' : ''; syncDock(); setTimeout(() => { if (S.running && video.videoWidth) render() }, 120) }
async function toggleFs() {
  const st = $('stage');
  if (isFs()) { st.classList.remove('fake-fs'); if (document.fullscreenElement || document.webkitFullscreenElement) { try { await (document.exitFullscreen || document.webkitExitFullscreen).call(document) } catch (e) { } } }
  else { const rq = st.requestFullscreen || st.webkitRequestFullscreen; if (rq) { try { await rq.call(st) } catch (e) { st.classList.add('fake-fs') } } else st.classList.add('fake-fs') }
  updateFs();
}
document.addEventListener('fullscreenchange', updateFs); document.addEventListener('webkitfullscreenchange', updateFs);
const dkSet = (el, ico, txt) => { el.querySelector('i').textContent = ico; el.querySelector('span').textContent = txt };
function syncDock() {
  const rec = !!S.rec, run = S.running, file = S.source === 'file';
  const dc = $('d-cam'); dkSet(dc, run ? '⏻' : '📷', run ? 'Stop' : 'Kamera'); dc.classList.toggle('danger', run);
  const dr = $('d-rec'); dr.disabled = $('btn-rec').disabled; const cdn = !!COACH.pend; dkSet(dr, rec ? '⏹' : cdn ? '✕' : '●', rec ? 'Koniec ' + $('timer').textContent : cdn ? 'Anuluj' : 'Pomiar'); dr.classList.toggle('danger', rec || cdn); dr.classList.toggle('primary', !rec && !cdn);
  $('d-fs').disabled = !run; $('s-flip').hidden = !(run && !file); $('s-fs').hidden = !run; $('bar-facing').hidden = run && file;
  const sr = $('s-rec'); sr.hidden = !(run && isFs()); sr.textContent = rec ? '⏹ Zakończ · ' + $('timer').textContent : COACH.pend ? '✕ Anuluj odliczanie' : '● Start pomiaru'; sr.classList.toggle('danger', rec);
  syncVctl();
}
const pickFile = () => { if (S.rec) { toast('Zakończ pomiar przed wczytaniem innego filmu.'); return } $('file-video').click() };
const pickRec = () => { if (S.rec) { toast('Zakończ pomiar przed nagraniem filmu.'); return } $('file-rec').click() };
$('d-cam').onclick = toggleCam; $('d-rec').onclick = () => $('btn-rec').click(); $('s-rec').onclick = () => $('btn-rec').click();
$('d-film').onclick = pickFile; $('btn-film').onclick = pickFile; $('btn-empty-film').onclick = pickFile; $('btn-empty-rec').onclick = pickRec;
$('s-flip').onclick = flipCamera; $('btn-flip2').onclick = flipCamera; $('d-fs').onclick = toggleFs; $('s-fs').onclick = toggleFs;
$('seg-facing').onclick = e => { const b = e.target.closest('button'); if (b && b.dataset.f !== S.facing) setFacing(b.dataset.f) };
syncFacingUI();
$('sh-close').onclick = closeSheet; $('sheet').addEventListener('click', e => { if (e.target === $('sheet')) closeSheet() });
['sh-open', 'sh-dl', 'sh-share'].forEach(i => $(i).addEventListener('click', () => setTimeout(closeSheet, 400)));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('sheet').hidden) closeSheet() });
/* PWA */
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; $('btn-install').hidden = false });
window.addEventListener('appinstalled', () => { deferredInstall = null; $('btn-install').hidden = true; toast('Zainstalowano aplikację.') });
$('btn-install').onclick = async () => { if (!deferredInstall) return; deferredInstall.prompt(); try { await deferredInstall.userChoice } catch (e) { } deferredInstall = null; $('btn-install').hidden = true };
if (IS_IOS && !isStandalone()) $('tip-ios').hidden = false;
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1') && qs.get('nosw') !== '1')
  window.addEventListener('load', () => {
    const hadCtl = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('./sw.js').then(reg => { document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => { }) }) }).catch(e => console.warn('SW', e));
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!hadCtl) return; if (S.running || S.rec) toast('Dostępna nowa wersja aplikacji – odśwież stronę po zakończeniu pomiaru.', false, 8000); else location.reload() });
  });
$('btn-cam').onclick = toggleCam; $('btn-empty-start').onclick = startCamera;
/* ---------- trener głosowy w tle (assets/coach.js) ---------- */
const COACH = { st: 'off', n: 0, seenAt: 0, startedAt: 0, lostN: 0, lostAt: 0, searchN: 0, searchAt: 0, pend: null, restTimer: 0 };
const f0 = x => Math.round(x);
const pick = a => a[Math.floor(Math.random() * a.length)];
Coach.bindMute($('s-voice')); Coach.bindMute($('d-voice')); Coach.bindSettings($('s-voicecfg')); Coach.bindSettings($('btn-voice-cfg'));
const unitTxt = (m, v) => m.unit === '%' ? `${f0(v)} procent` : Coach.pl.deg(v);
function coachRecBtn(txt, primary) { const b = $('btn-rec'); b.textContent = txt; b.classList.toggle('primary', primary); b.classList.toggle('danger', !primary) }
function coachCancelStart() {
  const p = COACH.pend; if (!p) return; p.dead = true; if (p.cd) p.cd.cancel(); COACH.pend = null; Coach.stop();
  coachRecBtn('▶ Rozpocznij pomiar', true); syncDock();
}
function coachStartMeasure() {
  if (!S.running || COACH.pend || S.rec) return;
  if (S.source !== 'camera' || (S.trackMode === 'closeup' && (!S.cu || S.cu.state === 'pick' || S.cu.pts.length < 3))) { startRecording(); return }
  // kamera na żywo: krótkie wprowadzenie głosowe, potem odliczanie 3-2-1 (czas na ułożenie nogi)
  const ex = EX[S.ex], c = cfg(), me = COACH.pend = { dead: false, cd: null };
  coachRecBtn('✕ Anuluj odliczanie', false); syncDock();
  const intro = `Ćwiczenie: ${ex.pl}. Cel: ${Coach.pl.sets(c.sets)} po ${Coach.pl.reps(c.reps)}.` + (c.hold > 0 ? ` Utrzymaj ${Coach.pl.secAcc(c.hold)}.` : '') + ' Przy bólu przerwij.';
  Coach.stop();
  Promise.race([Coach.sayThen(intro, { p: 3, v: 'normal', ttl: 30000, key: 'intro' }), new Promise(r => setTimeout(r, 10000))]).then(() => {
    if (me.dead || COACH.pend !== me) return;
    me.cd = Coach.countdown({ from: 3, parent: $('stage'), go: 'Start', onDone: () => { COACH.pend = null; if (S.running && !S.rec) startRecording(); else { coachRecBtn('▶ Rozpocznij pomiar', true); syncDock() } } });
  });
}
function coachTracking() {
  Coach.resetCooldowns(); COACH.st = S.trackMode === 'pose' ? 'search' : 'ok'; COACH.n = S.nPose; COACH.seenAt = 0; COACH.startedAt = performance.now(); COACH.lostN = 0; COACH.searchN = 0; COACH.searchAt = 0;
  Coach.say(S.source === 'file' ? 'Film wczytany.' : S.trackMode === 'pose' ? 'Kamera uruchomiona. Ustaw ją z boku, tak aby widać było całą nogę ze stopą.' : 'Kamera uruchomiona. Wskaż trzy punkty na obrazie.', { p: 1, v: 'normal', key: 'start', ttl: 5000 });
}
function coachStopAll() { coachCancelStart(); coachRestCancel(); COACH.st = 'off' }
function coachRecStart() {
  Coach.resetCooldowns(); coachRestCancel();
  if (S.source === 'file') Coach.say(`Pomiar rozpoczęty. ${EX[S.ex].pl}.`, { p: 2, v: 'normal', key: 'recstart', ttl: 3000 });
}
/* ostrzeżenia o utracie śledzenia (co 250 ms) */
function coachTick(now) {
  if (!S.running || document.hidden) return; if (S.source === 'file' && (video.paused || S.userPaused)) return;
  const cu = S.trackMode === 'closeup'; let present;
  if (cu) { if (!S.cu || S.cu.state === 'pick') return; present = !(S.cu.lost >= 8) && S.cu.state !== 'stale'; if (S.cu.state === 'stale') return }
  else { if (S.nPose !== COACH.n) { COACH.n = S.nPose; COACH.seenAt = now } present = COACH.seenAt > 0 && now - COACH.seenAt < 1800 }
  const lostMsg = cu ? 'Straciłem punkt. Popraw punkty na obrazie.' : 'Nie widzę stopy. Popraw ustawienie kamery.';
  if (COACH.st === 'search') {
    if (present) { COACH.st = 'ok'; Coach.say('Widzę stopę. Możesz zaczynać pomiar.', { p: 1, v: 'normal', key: 'seen', ttl: 4000 }) }
    else if (now - COACH.startedAt > 6000 && COACH.searchN < 2 && (!COACH.searchAt || now - COACH.searchAt > 14000)) { COACH.searchN++; COACH.searchAt = now; Coach.say('Nie widzę stopy. Ustaw kamerę z boku, na wysokości kostki.', { p: 2, v: 'minimal', key: 'lost', ttl: 5000 }) }
  } else if (COACH.st === 'ok') {
    if (!present) { COACH.st = 'lost'; COACH.lostAt = now; COACH.lostN = 1; Coach.say(lostMsg, { p: 2, v: 'minimal', key: 'lost', ttl: 5000 }) }
  } else if (COACH.st === 'lost') {
    if (present) { COACH.st = 'ok'; Coach.say(cu ? 'Punkty znowu działają.' : 'Znów widzę stopę.', { p: 1, v: 'normal', key: 'seen', ttl: 4000 }) }
    else if (COACH.lostN < 3 && now - COACH.lostAt > 15000 * COACH.lostN) { COACH.lostN++; Coach.say(lostMsg, { p: 2, v: 'minimal', key: 'lost', ttl: 5000 }) }
  }
}
setInterval(() => coachTick(performance.now()), 250);
/* tempo: „w górę / w dół” (tylko tryb rozmowny, tylko gdy nic nie mówi) */
function coachTempo(ev) {
  if (!S.rec) return; const dir = ev === 'peak' ? 'Teraz powoli w dół.' : 'Teraz w górę.';
  Coach.say(dir, { p: 0, v: 'chatty', key: 'tempo', cd: 2500, ttl: 900 });
}
/* trzymanie: „trzymaj… 3, 2, 1, rozluźnij” */
function coachHold(cur) {
  if (!S.rec || !S.reps) return; const c = cfg(), H = S.reps.cs.hold;
  if (c.hold <= 0) return;
  if (cur === 0) { S.reps.cs.hold = {}; Coach.say('Trzymaj.', { p: 2, v: 'normal', key: 'hold', ttl: 1500 }); return }
  if (cur === Infinity) { Coach.say('Rozluźnij.', { p: 2, v: 'normal', key: 'relax', ttl: 2000 }); return }
  const n = Math.ceil(c.hold - cur);
  if (c.hold > 3 && n >= 1 && n <= 3 && !H[n]) { H[n] = 1; Coach.say(String(n), { p: 2, v: 'normal', key: 'h' + n, ttl: 1100 }) }
}
/* licznik powtórzeń, koniec serii, spadek zakresu, tempo */
function coachRep(n, t, setDone) {
  if (!S.rec) return; const R = S.reps, c = cfg(), cs = R.cs, ex = EX[S.ex];
  if (R.setReps > 0 || !setDone) coachRestCancel(true);
  const peak = cs.curMax; cs.curMax = -Infinity; if (isFinite(peak)) cs.peaks.push(peak);
  if (cs.lastT != null) { cs.fast = (t - cs.lastT) < 1.1 ? cs.fast + 1 : 0 } cs.lastT = t;
  if (setDone) {
    cs.peaks = []; cs.fast = 0; cs.lastT = null;
    if (R.sets >= c.sets) { Coach.say('Cel sesji osiągnięty. Dobra robota!', { p: 3, v: 'minimal', key: 'goal', ttl: 8000 }); return }
    const useRest = S.source === 'camera' && c.rest > 0;
    Coach.say(`Seria ${R.sets} z ${c.sets} ukończona.` + (useRest ? ` Odpocznij ${Coach.pl.secAcc(c.rest)}.` : ' Odpocznij.'), { p: 3, v: 'minimal', key: 'setdone', ttl: 8000 });
    if (Coach.level === 'chatty') Coach.say('Jeśli coś boli, nie forsuj.', { p: 1, v: 'chatty', key: 'pain', ttl: 8000 });
    if (useRest) coachRestStart(c.rest);
    return;
  }
  let txt = String(n);
  if (c.reps - n === 1 && c.reps > 2) txt += '. Ostatnie powtórzenie.';
  else if (c.reps >= 6 && n === Math.floor(c.reps / 2)) txt += '. Połowa serii.';
  else if (Coach.level === 'chatty' && n % 5 === 0) txt += '. ' + pick(['Dobrze ci idzie.', 'Tak trzymaj.', 'Równo i spokojnie.', 'Świetnie.']);
  Coach.say(txt, { p: 1, v: 'normal', key: 'rep', ttl: 2500 });
  if (cs.fast >= 3) Coach.say('Zwolnij, ruch powinien być spokojny.', { p: 1, v: 'normal', key: 'pace', cd: 25000, ttl: 3000 });
  if (cs.peaks.length >= 5) {
    const base = (cs.peaks[0] + cs.peaks[1] + cs.peaks[2]) / 3, last = cs.peaks[cs.peaks.length - 1];
    if (base - last > Math.max(0.15 * Math.abs(base), c.thr * 0.25)) Coach.say('Zakres ruchu spada. Spróbuj ruszać się pełniej, ale tylko w granicach komfortu.', { p: 2, v: 'normal', key: 'range', cd: 25000, ttl: 4000 });
  }
}
/* przerwa między seriami: odliczanie (tylko kamera na żywo) */
function coachRestStart(sec) {
  coachRestCancel(); const end = performance.now() + sec * 1000, said = {}; let lastLeft = -1;
  COACH.restTimer = setInterval(() => {
    if (!S.rec || !S.reps) { coachRestCancel(); return }
    const left = Math.max(0, Math.ceil((end - performance.now()) / 1000));
    if (left !== lastLeft) {
      lastLeft = left; $('g-sub').textContent = left > 0 ? `przerwa: ${left} s · następna seria ${Math.min(S.reps.sets + 1, cfg().sets)} z ${cfg().sets}` : '';
      const sayOnce = (k, txt, o) => { if (!said[k]) { said[k] = 1; Coach.say(txt, o) } };
      if (left === 10 && sec > 14) sayOnce('10', 'Dziesięć sekund do końca przerwy.', { p: 1, v: 'normal', key: 'r10', ttl: 3000 });
      if (left === Math.floor(sec / 2) && sec >= 20 && Coach.level === 'chatty') sayOnce('mid', 'Oddychaj spokojnie.', { p: 0, v: 'chatty', key: 'rmid', ttl: 3000 });
      if (left === 5 && sec > 8) sayOnce('5', 'Pięć sekund.', { p: 1, v: 'normal', key: 'r5', ttl: 2000 });
      if (left >= 1 && left <= 3 && sec > 5) sayOnce('c' + left, String(left), { p: 2, v: 'normal', key: 'rc' + left, ttl: 1100 });
      if (left === 0) { sayOnce('go', `Zaczynamy serię ${Math.min(S.reps.sets + 1, cfg().sets)}.`, { p: 2, v: 'minimal', key: 'rgo', ttl: 4000 }); coachRestCancel(true) }
    }
  }, 200);
}
function coachRestCancel(silent) {
  if (!COACH.restTimer) return; clearInterval(COACH.restTimer); COACH.restTimer = 0;
  if (S.reps && S.running) updateGoalUI();
}
/* podsumowanie sesji + postęp względem poprzedniej */
function coachRecEnd(r, sess, prev) {
  coachRestCancel();
  if (!sess) { Coach.say('Koniec pomiaru. Za mało danych, nie wykryłem stopy.', { p: 3, v: 'minimal', key: 'recend', ttl: 8000 }); return }
  const m = sess.m, parts = ['Koniec pomiaru.'];
  parts.push(`Wykonano ${Coach.pl.reps(sess.reps)}.` + (sess.setsGoal > 0 ? ` Ukończone serie: ${sess.sets} z ${sess.setsGoal}.` : ''));
  parts.push(`Zakres ruchu: ${unitTxt(m, m.range)}.`);
  if (sess.bestHold >= 1 && cfg().hold > 0) parts.push(`Najdłuższe utrzymanie: ${Coach.pl.sec(sess.bestHold)}.`);
  if (prev) {
    const d = m.range - prev.m.range;
    if (Math.abs(d) < 1) parts.push('Zakres taki sam jak ostatnio.');
    else if (d > 0) parts.push(`Zakres większy niż poprzednio o ${unitTxt(m, d)}. Świetna robota!`);
    else parts.push(`Zakres mniejszy niż poprzednio o ${unitTxt(m, -d)}. To się zdarza, nie forsuj.`);
  } else parts.push('To pierwszy pomiar tego ćwiczenia, będzie punkt odniesienia na przyszłość.');
  Coach.say(parts.join(' '), { p: 3, v: 'minimal', key: 'recend', ttl: 25000 });
  Coach.say('Pamiętaj: przy bólu przerwij ćwiczenia. Cele ustala fizjoterapeuta.', { p: 1, v: 'normal', key: 'safety', ttl: 25000 });
}

$('btn-rec').onclick = () => S.rec ? stopRecording() : COACH.pend ? coachCancelStart() : coachStartMeasure();
async function snapshot() {
  if (!S.running) return; render(); canvas.toBlob(b => { if (b) deliver(b, `rehabilitacja-stopy-klatka-${stampStr(new Date())}.png`, 'image/png') }, 'image/png');
}
$('btn-snap').onclick = snapshot; $('btn-pdf').onclick = makeReport; $('btn-csv').onclick = exportMeasureCSV;
$('btn-h-json').onclick = exportHistJSON; $('btn-h-csv').onclick = exportHistCSV; $('btn-h-import').onclick = () => $('file-import').click();
$('file-import').onchange = e => { const f = e.target.files && e.target.files[0]; if (f) importHist(f); e.target.value = '' };
$('btn-h-clear').onclick = () => { if (!S.hist.length) return; if (confirm('Usunąć całą historię pomiarów z tego urządzenia? Tej operacji nie można cofnąć (najpierw możesz wyeksportować JSON).')) { S.hist = []; saveHist(); refreshHistoryUI(); toast('Historia wyczyszczona.') } };
$('hist-table').addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (!b) return; if (confirm('Usunąć ten pomiar z historii?')) { S.hist = S.hist.filter(s => s.id !== b.dataset.del); saveHist(); refreshHistoryUI() } });
['file-video', 'file-rec'].forEach(id => $(id).onchange = e => { const f = e.target.files && e.target.files[0]; if (f) startFile(f); e.target.value = '' });
$('v-play').onclick = vPlayPause; $('v-back').onclick = () => vStep(-1); $('v-fwd').onclick = () => vStep(1);
$('seg-speed').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.rate = +b.dataset.r; video.playbackRate = S.rate; syncVctl() };
$('v-seek').addEventListener('input', e => { seeking = true; vSeekTo(e.target.value / 1000); syncVctl() });
['change', 'pointerup', 'touchend'].forEach(ev => $('v-seek').addEventListener(ev, () => { seeking = false; syncVctl() }));
['timeupdate', 'play', 'pause', 'seeked', 'ratechange', 'ended'].forEach(ev => video.addEventListener(ev, () => { if (S.source === 'file') syncVctl() }));
video.addEventListener('seeked', () => { if (S.running && video.paused) render() });
video.addEventListener('ended', () => { if (S.source === 'file' && S.rec) { stopRecording(); toast('Film się skończył – pomiar zakończony automatycznie.') } });
$('chk-mirror').onchange = () => { S.mirror = effMirror() };
$('chk-skel').onchange = e => { S.skel = e.target.checked; if (S.running) render() }; $('chk-labels').onchange = e => { S.labels = e.target.checked; if (S.running) render() };
$('sel-cam').onchange = () => { if (S.running && S.source === 'camera') startCamera() }; $('sel-res').onchange = () => { if (S.running && S.source === 'camera') startCamera() };
$('sel-model').value = S.modelName; $('sel-model').onchange = e => { S.modelName = e.target.value; saveSettings(); S.landmarker = null; modelPromise = null; if (S.running && S.trackMode === 'pose') ensureModel() };
const syncSideUI = () => document.querySelectorAll('#seg-side button').forEach(x => x.setAttribute('aria-pressed', x.dataset.s === S.side));
$('seg-side').onclick = e => { const b = e.target.closest('button'); if (!b) return; if (S.rec) { toast('Zakończ pomiar przed zmianą strony.'); return } S.side = b.dataset.s; saveSettings(); syncSideUI(); S.series = []; resetStats(); resetReps(); S.ema = {}; updatePanels() };
$('seg-win').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.win = +b.dataset.w; document.querySelectorAll('#seg-win button').forEach(x => x.setAttribute('aria-pressed', x === b)) };
const selMetric = m => { S.sel = m; document.querySelectorAll('#tabs .tab').forEach(x => x.setAttribute('aria-pressed', x.dataset.m === m)); updatePanels() };
$('tabs').onclick = e => { const b = e.target.closest('button'); if (b) selMetric(b.dataset.m) }; $('angles').onclick = e => { const b = e.target.closest('.ang'); if (b) selMetric(b.dataset.m) };
$('exlist').onclick = e => { const b = e.target.closest('.exb'); if (b && !b.disabled) setExercise(b.dataset.e) };
$('seg-mode').onclick = e => { const b = e.target.closest('button'); if (b && b.dataset.m !== S.trackMode) setTrackMode(b.dataset.m) };
$('btn-suggest').onclick = () => setTrackMode('closeup');
$('btn-cal').onclick = calibrate; $('btn-cal-reset').onclick = calReset;
$('chk-front').onchange = e => { S.front = e.target.checked; if (!S.front && S.sel === 'front') S.sel = 'ankle'; buildCards(); updatePanels() };
$('in-client').value = S.client; $('in-client').onchange = e => { S.client = e.target.value.trim(); saveSettings(); refreshHistoryUI() };
$('cmp-inj').value = S.injured; $('cmp-inj').onchange = e => { S.injured = e.target.value; saveSettings(); renderCompare() };
$('cmp-ex').onchange = renderCompare; $('hf-ex').onchange = refreshHistoryUI; $('hf-metric').onchange = drawProgress;
$('cu-undo').onclick = () => { const cu = S.cu; if (cu && cu.state === 'pick' && cu.pts.length) { cu.pts.pop(); cu.tr.pop(); syncCuUI(); render() } };
$('cu-set').onclick = () => { if (!S.running) { toast('Najpierw uruchom kamerę lub wczytaj film.', true); return } cuStartPicking(true) };
$('cu-home').onclick = () => { if (S.cu && S.cu.pick) { if (S.rec) { toast('Pomiar trwa – zakończ go, aby wrócić do klatki startowej.'); return } cuRestore(false) } };
/* wskazywanie punktów palcem / myszą */
let drag = null;
const toNorm = e => { const r = canvas.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))] };
canvas.addEventListener('pointerdown', e => {
  if (S.trackMode !== 'closeup' || !S.running || !S.cu) return; const [nx, ny] = toNorm(e);
  if (S.cu.state === 'pick') { e.preventDefault(); cuTap(nx, ny); return }
  const i = cuNearest(nx, ny); if (i < 0) return; e.preventDefault(); drag = { i, wasPlaying: !video.paused, id: e.pointerId }; try { canvas.setPointerCapture(e.pointerId) } catch (_) { } video.pause(); S.cu.holding = true;
});
canvas.addEventListener('pointermove', e => { if (!drag) return; e.preventDefault(); const [nx, ny] = toNorm(e); S.cu.pts[drag.i] = { x: nx, y: ny }; render() });
const endDrag = e => { if (!drag) return; const [nx, ny] = toNorm(e); const d = drag; drag = null; S.cu.holding = false; cuMove(d.i, nx, ny); if (d.wasPlaying) { video.play().catch(() => { }) } toast('Punkt skorygowany – śledzenie kontynuowane od tego miejsca.', false, 2500) };
canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) { if (S.running) video.pause(); return } if (!S.running) return; requestWake();
  if (S.source === 'camera' && S.stream && S.stream.getVideoTracks().every(t => t.readyState === 'ended')) { toast('Kamera została zatrzymana w tle – uruchamiam ponownie…'); if (S.rec) toast('Pomiar został przerwany.', true); await startCamera(); return }
  const picking = S.trackMode === 'closeup' && S.cu && S.cu.state === 'pick'; if (!(S.source === 'file' && S.userPaused) && !picking) video.play().catch(() => { });
  if (S.cu && S.cu.state === 'track' && S.source === 'camera') S.lastVT = -1; if (S.rec) toast('Aplikacja była w tle – w pomiarze może być przerwa w danych.', false, 4000);
});
let rzT; const onResize = () => { clearTimeout(rzT); rzT = setTimeout(() => { if (S.running && video.videoWidth) { fitCanvas(); render() } renderMain(); updatePanels(); drawProgress() }, 250) };
window.addEventListener('resize', onResize); screen.orientation?.addEventListener?.('change', onResize); window.addEventListener('orientationchange', onResize);
window.addEventListener('pagehide', releaseWake); window.addEventListener('beforeunload', () => S.stream?.getTracks().forEach(t => t.stop()));

/* ---------- start ---------- */
fillExSelects(); renderExerciseUI(); buildCards(); syncSideUI(); syncModeUI(); syncCuUI(); resetReps();
document.querySelectorAll('#seg-mode button').forEach(b => b.setAttribute('aria-pressed', b.dataset.m === S.trackMode)); $('stage').style.touchAction = S.trackMode === 'closeup' ? 'none' : '';
$('chk-front').checked = S.front; S.sel = EX[S.ex].metric; buildCards(); refreshHistoryUI(); updatePanels(); syncDock();
if (qs.get('mode') === 'closeup' && S.trackMode !== 'closeup') setTrackMode('closeup', true);
window.__rehab = S; window.__rehabApi = { updateReps, resetReps, setTrackMode, cuStartPicking, cuRestore, startRecording, stopRecording, makeReport, buildSession, compareSummary, setExercise, calibrate };

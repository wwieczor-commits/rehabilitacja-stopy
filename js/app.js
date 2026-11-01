/* Rehabilitacja stopy – aplikacja (© Wojciech Wieczorek).
   Przebieg: 1) film/kamera → 2) automatyczne wykrywanie stopy (RTMW-m) → 3) wynik → 4) raport PDF. */
import { $, sleep, clamp, deg, rad, wrap, median, f0, sg, stamp, dstr, mmss, IS_IOS, IS_MOBILE, abs, triggerDownload, canvasToBlob } from './util.js';
import { VERSION } from './version.js';
import { VideoSource, VideoError } from './video.js';
import { FootModel, FootTracker, sideConf } from './pose.js';
import { MIN_CONF, defaultAlpha, computeSeries, footPhi, nearest } from './metrics.js';
import { PatchTracker, toGray } from '../tracker.js';
import * as Store from './store.js';
import { buildReport, loadPdfLib } from './report.js';

const MAX_ANALYZE_S = 120, MAXSIDE = 1280;
const COL = { L: '#2EC4B6', R: '#FEDA75', shin: '#FEDA75', foot: '#2EC4B6' };

/* ---------- stan ---------- */
const S = {
  phase: 'idle',            // idle | loading | detecting | ready | pick | tracking | live
  src: null,                // 'file' | 'cam'
  job: 0,                   // numer bieżącego zadania (do anulowania)
  samples: [], res: null, alpha: { alpha: 90, guess: true }, mode: 'auto',
  side: 'R', cal: 0, id: null, ts: null, thumbs: null, valid: 1, fileName: '',
  pick: [], playing: false, curT: 0, diag: [], lastPdf: null, rec: false, live: null, saveTimer: 0, drag: null,
  settings: Store.loadSettings(), hist: Store.loadHistory(),
};
const video = $('video'), cv = $('view'), ctx = cv.getContext('2d');
const fr = document.createElement('canvas');                // czysta klatka (bez nakładek) – ona idzie do modelu
const vs = new VideoSource(video), model = new FootModel();
S.side = S.settings.injured;
const log = (...a) => { const s = a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); S.diag.push(new Date().toISOString().slice(11, 19) + ' ' + s); if (S.diag.length > 60) S.diag.shift() };

/* ---------- drobne UI ---------- */
let toastT = 0;
function toast(msg, err) { const t = $('toast'); t.textContent = msg; t.classList.toggle('err', !!err); t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), err ? 7000 : 4200) }
function setStatus(txt, kind = '') { const s = $('status'); s.textContent = txt; s.className = 'status ' + kind }
function setPill(txt, kind = '') { $('pill-t').textContent = txt; $('pill').className = 'pill ' + kind }
function busy(title, detail = '', p = null, opt = {}) {
  const b = $('busy'); b.hidden = false; b.classList.toggle('strip', !!opt.strip); $('busy-t').textContent = title; $('busy-d').textContent = detail;
  const bar = $('busy-bar'); bar.parentElement.classList.toggle('ind', p == null); bar.style.width = p == null ? '' : Math.round(clamp(p, 0, 1) * 100) + '%';
  $('busy-cancel').hidden = opt.cancel === false;
}
const unbusy = () => { $('busy').hidden = true };
const say = (txt, o = {}) => { try { window.Coach && Coach.say(txt, Object.assign({ p: 1, v: 'normal', ttl: 6000 }, o)) } catch (_) { } };
function showError(title, msg, detail) {
  $('err-t').textContent = title; $('err-m').textContent = msg;
  $('err-d').textContent = `Rehabilitacja stopy ${VERSION}\n${navigator.userAgent}\n` + (detail ? detail + '\n' : '') + '\n' + S.diag.join('\n');
  $('errsheet').hidden = false; unbusy();
}
$('err-close').onclick = () => { $('errsheet').hidden = true };
$('err-copy').onclick = async () => { try { await navigator.clipboard.writeText($('err-d').textContent); toast('Skopiowano diagnostykę.') } catch (_) { toast('Nie udało się skopiować – zaznacz tekst ręcznie.', true) } };
let errN = 0;
addEventListener('error', e => { log('error', e.message); if (++errN <= 2 && !/ResizeObserver/.test(e.message || '')) showError('Nieoczekiwany błąd', String(e.message || e.error), e.filename + ':' + e.lineno) });
addEventListener('unhandledrejection', e => { const m = String(e.reason && e.reason.message || e.reason); log('rejection', m); if (++errN <= 2) showError('Nieoczekiwany błąd', m) });

/* ---------- ekran: etapy i dostępność przycisków ---------- */
function syncUI() {
  const has = S.src === 'file' && vs.dur > 0, ready = S.phase === 'ready', cam = S.phase === 'live', busyNow = ['loading', 'detecting', 'tracking'].includes(S.phase);
  $('empty').hidden = S.src != null; $('vctl').hidden = !(has && !busyNow) ; $('chartbox').hidden = !(S.res);
  $('btn-flip').disabled = !(ready && S.res); $('btn-rot').disabled = !has || busyNow; $('btn-redo').disabled = !has || busyNow; $('btn-manual').disabled = !has || busyNow;
  $('btn-manual').textContent = S.phase === 'pick' ? '✕ Anuluj zaznaczanie' : '✋ Zaznacz ręcznie';
  $('edit-note').hidden = !(ready && S.mode !== 'cam');
  $('st1').classList.toggle('done', S.src != null); $('st2').classList.toggle('done', !!S.res); $('st3').classList.toggle('done', !!S.res); $('st4').classList.toggle('done', !!S.lastPdf);
  $('fld-facing').hidden = !cam && S.phase !== 'live';
  $('s-rec').hidden = !cam; $('s-rec').textContent = S.rec ? '■ Zakończ pomiar' : '● Start pomiaru'; $('s-rec').classList.toggle('danger', S.rec);
  $('hudbig').hidden = !(cam || (ready && S.res));
  cv.classList.toggle('pick', S.phase === 'pick');
  $('stage').classList.toggle('live', cam);
  syncSides();
}
function setSegPressed(seg, attr, val) { for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset[attr] === val)) }
function syncSides() { setSegPressed($('seg-side'), 's', S.side); setSegPressed($('seg-inj'), 's', S.settings.injured); setSegPressed($('seg-facing'), 'f', S.settings.facing) }

/* ---------- rysowanie podglądu ---------- */
const kScale = () => { const r = cv.getBoundingClientRect(); return r.width ? cv.width / r.width : 1 };
const pt = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angDeg = (a, b) => deg(Math.atan2(b.y - a.y, b.x - a.x));
function sampleAt(t, exact) {
  const sm = S.samples; if (!sm.length) return null;
  const i = nearest(S._tt || (S._tt = sm.map(s => s.t)), t);
  if (exact) return { ...sm[i], i };
  const a = sm[i], b = t >= a.t ? sm[Math.min(sm.length - 1, i + 1)] : sm[Math.max(0, i - 1)];
  if (!b || b === a || Math.abs(b.t - a.t) < 1e-6) return { ...a, i };
  const w = clamp((t - a.t) / (b.t - a.t), 0, 1), L = (p, q) => p && q ? { x: p.x + (q.x - p.x) * w, y: p.y + (q.y - p.y) * w } : p;
  return { ...a, ank: L(a.ank, b.ank), big: L(a.big, b.big), heel: L(a.heel, b.heel), sm: L(a.sm, b.sm), i };
}
function currentSample() { return S.phase === 'ready' && S.samples.length ? sampleAt(S.curT, !S.playing) : null }
const shinLen = () => 0.2 * Math.max(cv.width, cv.height);
function shinEnd(s) { const a = rad(s.alpha ?? S.alpha.alpha), L = shinLen(); return { x: s.ank.x + Math.cos(a) * L, y: s.ank.y + Math.sin(a) * L } }

function dot(c, p, r, fill, stroke = '#111', lw = 2) { c.beginPath(); c.arc(p.x, p.y, r, 0, 7); c.fillStyle = fill; c.fill(); c.lineWidth = lw; c.strokeStyle = stroke; c.stroke() }
function line(c, a, b, col, w, dash) { c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.strokeStyle = col; c.lineWidth = w; c.setLineDash(dash || []); c.stroke(); c.setLineDash([]) }
/** nakładka: oś goleni (żółta), oś stopy (turkus), punkty. Rysowana na dowolnym kontekście o skali k. */
function drawOverlay(c, s, k, opt = {}) {
  if (!s || !s.ank || !s.big) return;
  const r = (opt.big ? 9 : 6) * k, w = 3 * k, se = shinEnd(s);
  line(c, s.ank, se, COL.shin, w, [10 * k, 6 * k]);
  const base = s.heel || s.ank; line(c, base, s.big, COL.foot, w);
  if (s.heel) line(c, s.heel, s.ank, 'rgba(46,196,182,.45)', 2 * k);
  if (s.sm) dot(c, s.sm, r * .6, '#fff', '#111', k);
  if (s.heel) dot(c, s.heel, r, '#fff');
  dot(c, s.ank, r * 1.2, COL.foot); dot(c, s.big, r, '#fff');
  if (opt.handles) dot(c, se, r * 1.5, COL.shin, '#111', 2 * k);
  if (opt.label) { c.font = `700 ${16 * k}px Inter,sans-serif`; c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 3 * k; c.strokeText(opt.label, s.ank.x + 12 * k, s.ank.y - 12 * k); c.fillText(opt.label, s.ank.x + 12 * k, s.ank.y - 12 * k) }
}
function drawPick(c, k) {
  const names = ['goleń', 'kostka', 'palce']; const P = S.pick;
  if (P.length >= 2) line(c, P[0], P[1], COL.shin, 3 * k, [10 * k, 6 * k]);
  if (P.length >= 3) line(c, P[1], P[2], COL.foot, 3 * k);
  P.forEach((p, i) => { dot(c, p, 10 * k, [COL.shin, COL.foot, '#fff'][i], '#111', 2 * k); c.font = `700 ${14 * k}px Inter,sans-serif`; c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 3 * k; c.strokeText(names[i], p.x + 14 * k, p.y - 12 * k); c.fillText(names[i], p.x + 14 * k, p.y - 12 * k) });
}
let overlayExtra = null;       // np. punkt z wykrywania w toku
function draw() {
  if (S.src === 'file' && fr.width) { if (cv.width !== fr.width || cv.height !== fr.height) { cv.width = fr.width; cv.height = fr.height } ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(fr, 0, 0) }
  else if (S.src === 'cam') { if (video.videoWidth && (cv.width !== video.videoWidth || cv.height !== video.videoHeight)) { cv.width = video.videoWidth; cv.height = video.videoHeight } ctx.clearRect(0, 0, cv.width, cv.height) }
  const k = kScale();
  if (S.phase === 'pick') drawPick(ctx, k);
  else if (S.phase === 'ready' && S.res) {
    const s = currentSample(); if (s) { const v = S.res.v[nearest(S.res.t, S.curT)]; drawOverlay(ctx, s, k, { handles: !S.playing, big: true }); $('h-ang').textContent = sg(v) + '°'; $('h-lab').textContent = 'kąt kostki' }
  } else if (overlayExtra) drawOverlay(ctx, overlayExtra, k, { big: true });
  if (S.phase === 'live' && S.live && S.live.cur) { drawOverlay(ctx, S.live.cur, k, { big: true }) }
}
let rafOn = false;
function loop() {
  if (!rafOn) return; requestAnimationFrame(loop);
  if (S.src === 'file' && vs.dur > 0) {
    if (S.playing && !video.paused && !['detecting', 'tracking', 'loading'].includes(S.phase)) { vs.grab(fr, MAXSIDE); S.curT = video.currentTime; updateTransport(); if (video.ended) setPlaying(false) }
  }
  if (S.src) { draw(); drawChartCursor() }
}
function startLoop() { if (!rafOn) { rafOn = true; requestAnimationFrame(loop) } }

/* ---------- sterowanie filmem ---------- */
function updateTransport() {
  const d = vs.dur || 0; $('v-time').textContent = `${mmss(S.curT)} / ${mmss(d)}`;
  if (document.activeElement !== $('v-seek')) $('v-seek').value = d ? Math.round(S.curT / d * 1000) : 0;
}
function setPlaying(on) {
  S.playing = on && S.src === 'file';
  $('v-play').textContent = S.playing ? '⏸' : '▶';
  if (S.playing) { video.playbackRate = S.rate || 1; video.play().catch(e => { log('play', e.message); S.playing = false; $('v-play').textContent = '▶' }) } else { video.pause(); }
}
let seekBusy = false, seekWant = null;
async function seekTo(t) {
  if (S.src !== 'file') return; seekWant = t; if (seekBusy) return; seekBusy = true;
  try { while (seekWant != null) { const w = seekWant; seekWant = null; await vs.seek(w); vs.grab(fr, MAXSIDE); S.curT = video.currentTime; updateTransport(); draw() } } finally { seekBusy = false }
}
$('v-play').onclick = () => { if (S.phase === 'pick') return; if (!S.playing && video.ended || S.curT >= vs.dur - 0.05) S.curT = 0, video.currentTime = 0; setPlaying(!S.playing) };
$('v-back').onclick = () => { setPlaying(false); seekTo(S.curT - 1 / 30) };
$('v-fwd').onclick = () => { setPlaying(false); seekTo(S.curT + 1 / 30) };
$('v-seek').addEventListener('input', e => { setPlaying(false); seekTo(+e.target.value / 1000 * vs.dur) });
$('seg-speed').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.rate = +b.dataset.r; for (const x of $('seg-speed').children) x.setAttribute('aria-pressed', String(x === b)); if (S.playing) video.playbackRate = S.rate };
addEventListener('keydown', e => { if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && e.target.type !== 'range') return; if (e.code === 'Space' && S.src === 'file') { e.preventDefault(); $('v-play').click() } else if (e.key === 'ArrowLeft') $('v-back').click(); else if (e.key === 'ArrowRight') $('v-fwd').click() });

/* ---------- wykres kąta ---------- */
function fitCanvas(c) { const r = c.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1), w = Math.max(10, Math.round(r.width * d)), h = Math.max(10, Math.round(r.height * d)); if (c.width !== w || c.height !== h) { c.width = w; c.height = h } return d }
let chartGeo = null, chartCache = null;
function drawChart() {
  const c = $('chart'), R = S.res; if (!R) return; $('chartbox').hidden = false; const d = fitCanvas(c), g = c.getContext('2d', { willReadFrequently: true }), W = c.width, H = c.height;
  const pl = 40 * d, pr = 10 * d, pt_ = 10 * d, pb = 22 * d, pw = W - pl - pr, ph = H - pt_ - pb;
  const dur = Math.max(.5, R.t[R.t.length - 1]); let lo = Math.min(-45, ...R.v) - 4, hi = Math.max(22, ...R.v) + 4; lo = Math.floor(lo / 10) * 10; hi = Math.ceil(hi / 10) * 10;
  const X = t => pl + t / dur * pw, Y = v => pt_ + ph - (v - lo) / (hi - lo) * ph;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(46,196,182,.12)'; g.fillRect(pl, Y(Math.min(20, hi)), pw, Y(0) - Y(Math.min(20, hi)));
  g.fillStyle = 'rgba(254,218,117,.10)'; g.fillRect(pl, Y(-40), pw, Y(-50) - Y(-40));
  g.font = `${11 * d}px Inter,sans-serif`; g.textAlign = 'right'; g.textBaseline = 'middle'; const st = (hi - lo) > 60 ? 20 : 10;
  for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) { g.strokeStyle = v === 0 ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.08)'; g.lineWidth = d; g.beginPath(); g.moveTo(pl, Y(v)); g.lineTo(pl + pw, Y(v)); g.stroke(); g.fillStyle = '#8a9291'; g.fillText((v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + '°', pl - 6 * d, Y(v)) }
  g.textAlign = 'center'; g.textBaseline = 'top'; const nt = Math.min(8, Math.max(2, Math.round(dur / 2.5))); for (let i = 0; i <= nt; i++) { const t = dur * i / nt; g.fillStyle = '#8a9291'; g.fillText(t.toFixed(dur < 20 ? 1 : 0) + ' s', X(t), H - pb + 5 * d) }
  const col = S.side === 'L' ? COL.L : COL.R;
  g.beginPath(); R.v.forEach((v, i) => { const x = X(R.t[i]), y = Y(v); i ? g.lineTo(x, y) : g.moveTo(x, y) }); g.strokeStyle = col; g.lineWidth = 2.2 * d; g.lineJoin = 'round'; g.stroke();
  // niepewne fragmenty (interpolowane) – kropki
  g.fillStyle = 'rgba(255,255,255,.35)'; R.ok.forEach((ok, i) => { if (!ok) g.fillRect(X(R.t[i]) - d, Y(R.v[i]) - d, 2 * d, 2 * d) });
  for (const p of R.peaks) dot(g, { x: X(p.t), y: Y(p.v) }, 3.5 * d, col, '#111', d);
  for (const p of R.valleys) dot(g, { x: X(p.t), y: Y(p.v) }, 3.5 * d, '#fff', '#111', d);
  chartGeo = { pl, pw, dur, d, W, H }; chartCache = g.getImageData(0, 0, W, H);
}
function drawChartCursor() {
  const R = S.res, c = $('chart'); if (!R || !chartCache || !chartGeo || S.src !== 'file') return;
  const g = c.getContext('2d', { willReadFrequently: true }); if (c.width !== chartGeo.W || c.height !== chartGeo.H) { drawChart(); return }
  if (S._cursorT === S.curT && !S._chartDirty) return; S._cursorT = S.curT; S._chartDirty = false;
  g.putImageData(chartCache, 0, 0); const x = chartGeo.pl + clamp(S.curT / chartGeo.dur, 0, 1) * chartGeo.pw;
  g.strokeStyle = '#fff'; g.lineWidth = 1.5 * chartGeo.d; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, chartGeo.H - 22 * chartGeo.d); g.stroke();
}
function chartSeek(e) { if (!chartGeo || S.src !== 'file') return; const r = $('chart').getBoundingClientRect(), x = (e.clientX - r.left) * chartGeo.W / r.width; setPlaying(false); seekTo(clamp((x - chartGeo.pl) / chartGeo.pw, 0, 1) * chartGeo.dur) }
let chartDown = false; $('chart').addEventListener('pointerdown', e => { chartDown = true; $('chart').setPointerCapture(e.pointerId); chartSeek(e) }); $('chart').addEventListener('pointermove', e => { if (chartDown) chartSeek(e) }); $('chart').addEventListener('pointerup', () => chartDown = false);
addEventListener('resize', () => { if (S.res) { drawChart(); S._chartDirty = true } drawProg() });

/* ---------- wyniki ---------- */
function showKpis() {
  const R = S.res; const set = (id, v) => { $(id).textContent = v };
  if (!R || !Number.isFinite(R.range)) { ['k-max', 'k-min', 'k-range', 'k-reps'].forEach(i => set(i, '–')); set('res-sub', ''); return }
  set('k-max', sg(R.max) + '°'); set('k-min', sg(R.min) + '°'); set('k-range', f0(R.range) + '°'); set('k-reps', String(R.reps));
  set('k-range-s', `${sg(R.min)}° … ${sg(R.max)}°`); set('k-reps-s', `w ${R.dur.toFixed(0)} s`);
  set('res-sub', S.mode === 'cam' ? 'kamera na żywo' : S.mode === 'manual' ? 'punkty ręczne' : 'wykrywanie automatyczne');
}
function recompute(save = true) {
  if (!S.samples.length) return;
  S.res = computeSeries(S.samples, { alpha: S.alpha.alpha, cal: S.cal });
  S._tt = null; showKpis(); drawChart(); S._chartDirty = true; syncUI();
  if (save) scheduleSave();
}
function seriesPts(R) { const n = R.t.length, step = Math.max(1, Math.ceil(n / 180)), o = []; for (let i = 0; i < n; i += step) o.push([+R.t[i].toFixed(2), +R.v[i].toFixed(1)]); return o }
function session() {
  const R = S.res; if (!R) return null; const m = { max: +R.max.toFixed(1), min: +R.min.toFixed(1), range: +R.range.toFixed(1) };
  return { id: S.id, ts: S.ts, side: S.side, src: S.src === 'cam' ? 'cam' : 'file', file: S.fileName, dur: +R.dur.toFixed(1), n: R.t.length, m, ankle: { ...m }, reps: R.reps, valid: +R.validPct.toFixed(2), mode: S.mode, axisGuess: !!S.alpha.guess, ar: +(cv.width / cv.height).toFixed(3), thumbs: S.thumbs || { max: null, min: null }, series: seriesPts(R), client: S.settings.client, ex: 'pump' };
}
function scheduleSave() { clearTimeout(S.saveTimer); S.saveTimer = setTimeout(saveNow, 700) }
function saveNow() {
  clearTimeout(S.saveTimer); const s = session(); if (!s) return null;
  const i = S.hist.findIndex(h => h.id === s.id); if (i >= 0) S.hist[i] = s; else S.hist.push(s);
  S.hist.sort((a, b) => a.ts < b.ts ? -1 : 1);
  if (!Store.saveHistory(S.hist)) toast('Pamięć przeglądarki jest pełna – pomiar nie został zapisany w historii (raport PDF nadal zadziała).', true);
  renderHist(); return s;
}

/* miniatury ekstremów z bieżącego filmu (z nakładką) */
async function makeThumbs() {
  const R = S.res; if (!R || S.src !== 'file') return;
  const keep = S.curT, out = {};
  for (const [k, i] of [['max', R.iMax], ['min', R.iMin]]) {
    if (i == null || i < 0) continue; const s = S.samples[i]; if (!s) continue;
    await vs.seek(s.t); vs.grab(fr, MAXSIDE);
    const sc = Math.min(1, 720 / fr.width), c = document.createElement('canvas'); c.width = Math.round(fr.width * sc); c.height = Math.round(fr.height * sc);
    const g = c.getContext('2d'); g.drawImage(fr, 0, 0, c.width, c.height); g.save(); g.scale(sc, sc);
    drawOverlay(g, s, 1 / sc * 1.0, { big: true, label: sg(R.v[i]) + '°' }); g.restore();
    out[k] = { img: c.toDataURL('image/jpeg', .8), t: +s.t.toFixed(2), v: +R.v[i].toFixed(1) };
  }
  S.thumbs = out; await vs.seek(keep); vs.grab(fr, MAXSIDE); S.curT = video.currentTime;
}

/* ---------- raport PDF ---------- */
let pdfBusy = false;
async function makeReport(auto) {
  if (pdfBusy) return;
  if (!S.res && !S.hist.length) { toast('Najpierw wczytaj film albo włącz kamerę – raport powstaje z pomiaru.', true); $('btn-film').focus(); return }
  pdfBusy = true; const btns = [$('btn-pdf'), $('d-pdf')], old = btns.map(b => b.innerHTML);
  btns.forEach(b => { b.disabled = true; b.innerHTML = '⏳ <span>Tworzę raport…</span>' });
  try {
    let cur;
    if (S.res) { if (S.phase === 'ready' || S.mode === 'cam') { if (S.src === 'file') await makeThumbs(); } cur = saveNow() } else cur = S.hist[S.hist.length - 1];
    await loadPdfLib();
    const blob = await buildReport({ cur, hist: S.hist, injured: S.settings.injured, client: S.settings.client, version: VERSION });
    const name = `raport-stopy-${stamp(new Date())}.pdf`; S.lastPdf = { blob, name, url: URL.createObjectURL(blob) };
    deliver(S.lastPdf); $('pdf-info').innerHTML = `Ostatni raport: <b>${name}</b> (${Math.round(blob.size / 1024)} KB) · <a href="${S.lastPdf.url}" target="_blank" rel="noopener">otwórz</a>`;
    say('Raport zapisany.', { p: 1, ttl: 3000 });
  } catch (e) { log('pdf', e.message); showError('Nie udało się utworzyć raportu', String(e.message || e), e.stack) }
  finally { pdfBusy = false; btns.forEach((b, i) => { b.disabled = false; b.innerHTML = old[i] }); syncUI() }
}
function deliver(p) {
  if (!IS_MOBILE) { triggerDownload(p.blob, p.name); toast('Raport PDF zapisany: ' + p.name); return }
  $('sheet-n').textContent = p.name; $('sh-open').href = p.url; $('sh-dl').href = p.url; $('sh-dl').download = p.name;
  const f = new File([p.blob], p.name, { type: 'application/pdf' }), can = navigator.canShare && navigator.canShare({ files: [f] });
  $('sh-share').hidden = !can; $('sh-share').onclick = async () => { try { await navigator.share({ files: [f], title: 'Raport rehabilitacji stopy' }) } catch (_) { } };
  $('sheet').hidden = false;
}
$('sh-close').onclick = () => { $('sheet').hidden = true };
$('btn-pdf').onclick = () => makeReport(false); $('d-pdf').onclick = () => makeReport(false);

/* ---------- ładowanie filmu ---------- */
const pickFile = () => $('file-video').click();
$('btn-film').onclick = $('btn-film-empty').onclick = $('d-film').onclick = pickFile;
$('file-video').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) openFile(f) });
function resetMeasurement() {
  S.samples = []; S.res = null; S.thumbs = null; S._tt = null; S.pick = []; S.id = null; S.curT = 0; S.alpha = { alpha: 90, guess: true }; S.lastPdf = null; overlayExtra = null; S.mode = 'auto';
  $('pdf-info').textContent = 'Raport powstanie po pierwszym pomiarze (klatki z Twojego filmu, wykresy, porównanie nóg).'; $('hint').hidden = true; showKpis();
}
function cancelJobs() { S.job++; S.rec = false; stopCam(); setPlaying(false) }
async function openFile(file) {
  cancelJobs(); resetMeasurement(); S.src = null; S.phase = 'loading'; S.fileName = file.name || 'film'; syncUI(); log('open', file.name, file.type, file.size);
  const token = S.job; busy('Wczytuję film…', file.name, null, { cancel: false });
  model.load(modelStatus).catch(e => { log('model', e.message) });
  try {
    const info = await vs.open(file, (t, p) => { if (token === S.job) busy(p != null && p > 0 && p < 1 ? 'Konwertuję film do H.264…' : 'Wczytuję film…', t, p, { cancel: false }) });
    if (token !== S.job) return;
    log('video', info); S.src = 'file'; vs.grab(fr, MAXSIDE); cv.width = fr.width; cv.height = fr.height; $('stage').style.setProperty('--ar', fr.width / fr.height);
    S.curT = 0; $('src-info').textContent = `${S.fileName} · ${vs.w}×${vs.h} · ${vs.dur.toFixed(1)} s` + (info.converted ? ' · przekonwertowano do H.264 (przeglądarka nie odtwarzała oryginału)' : '');
    startLoop(); draw(); updateTransport(); say('Film wczytany. Szukam stopy.', { p: 1 });
    await analyzeAuto();
  } catch (e) {
    if (token !== S.job) return; S.phase = 'idle'; S.src = null; syncUI(); log('openfail', e.code, e.message);
    const hevc = /\.(mov|hevc|h265)$/i.test(S.fileName);
    const msgs = {
      'convert-failed': 'Przeglądarka nie odtworzyła tego pliku, a automatyczna konwersja też się nie udała. Spróbuj zapisać film na telefonie w formacie „Najbardziej zgodne” (H.264) albo nagraj go ponownie i wczytaj tu.',
      timeout: 'Wczytywanie trwało zbyt długo. Plik może być bardzo duży lub uszkodzony. Spróbuj krótszego fragmentu (do ok. 1 minuty).',
      unsupported: 'Ta przeglądarka nie potrafi odczytać tego pliku' + (hevc ? ' (prawdopodobnie HEVC/H.265)' : '') + '.', empty: 'Film wydaje się pusty albo nie da się odczytać klatek.',
    };
    showError('Nie udało się wczytać filmu', msgs[e.code] || ('Błąd: ' + (e.message || e)), `${S.fileName} (${file.type || 'brak typu'}, ${(file.size / 1048576).toFixed(1)} MB)\n` + (vs.log || []).join('\n'));
    setStatus('Film nie został wczytany – zobacz komunikat.', 'err');
  }
}
function modelStatus(t, p) { setPill(p != null && p < 1 ? `Model: ${Math.round(p * 100)}%` : t, p === 1 && /gotowy/.test(t) ? 'ok' : 'warn'); if (S.phase === 'detecting' && !/gotowy/.test(t)) busy('Przygotowuję rozpoznawanie stopy…', t, p) }

/* ---------- automatyczne wykrywanie i śledzenie ---------- */
const mkCanvas = () => document.createElement('canvas');
async function grabAt(vsrc, t) { await vsrc.seek(t); const c = mkCanvas(); vsrc.grab(c, MAXSIDE); return c }
function packFoot(t, f) { const q = p => p && { x: p.x, y: p.y }; return { t, ank: q(f.ank), big: q(f.big), sm: q(f.sm), heel: q(f.heel), knee: f.knee && { x: f.knee.x, y: f.knee.y, c: f.knee.c }, conf: f.conf } }
class Cancelled extends Error { }
async function analyzeAuto() {
  const token = ++S.job, chk = () => { if (token !== S.job) throw new Cancelled() };
  S.phase = 'detecting'; S.mode = 'auto'; S.samples = []; S.res = null; S.pick = []; $('hint').hidden = true; setPlaying(false); syncUI(); showKpis();
  setStatus('Wykrywam stopę i kostkę…'); const tAll = performance.now();
  try {
    busy('Przygotowuję rozpoznawanie stopy…', '', null);
    await model.load(modelStatus); chk(); setPill('Model gotowy (RTMW-m)', 'ok');
    const D = Math.min(vs.dur, MAX_ANALYZE_S), tr = new FootTracker(model);
    // 1) szukanie ustawienia wycinka na kilku klatkach z różnych momentów
    const search = async fr_ => {
      const srcs = []; for (const f of fr_) { srcs.push(await grabAt(vs, D * f)); chk() }
      busy('Szukam stopy na filmie…', 'Sprawdzam różne powiększenia i obroty obrazu', 0, { strip: true });
      let n = 0; const best = await tr.search(srcs, (i, tot) => { chk(); if (++n % 3 === 0) busy('Szukam stopy na filmie…', `Krok ${i} z ${tot}`, i / tot, { strip: true }) });
      return { best, srcs };
    };
    let { best, srcs } = await search([.3, .65]); log('search1', best.s.toFixed(3), best.fs, best.rot);
    if (best.s < .3) { const r2 = await search([.1, .5, .9]); log('search2', r2.best.s.toFixed(3)); if (r2.best.s > best.s) { best = r2.best; srcs = r2.srcs } }
    if (best.s < .18) throw Object.assign(new Error('not-found'), { code: 'not-found' });
    // 2) śledzenie: klatka po klatce (seek następnej klatki równolegle z obliczeniami modelu)
    const f0_ = await tr.lock(srcs[0], best); chk();
    S.kpSide = tr.side; const fps = clamp(150 / D, 5, 12), n = Math.max(3, Math.floor(D * fps)), samples = []; let rescues = 0, lastUi = 0;
    await vs.seek(0); vs.grab(fr, MAXSIDE); S.src = 'file';
    for (let i = 0; i < n; i++) {
      chk(); const sk = i + 1 < n ? vs.seek((i + 1) / fps) : null;
      const f = await tr.step(fr); chk();
      const s = packFoot(i / fps, f); samples.push(s); overlayExtra = s;
      if (tr.lost >= 8 && rescues < 3) {                                     // zgubiona stopa → szukamy na bieżącej klatce
        rescues++; if (sk) await sk; const cur = mkCanvas(); vs.grab(cur, MAXSIDE); busy('Szukam stopy ponownie…', 'Stopa zniknęła z kadru lub jest zasłonięta', i / n, { strip: true });
        const fs0 = tr.cfg.fs, b2 = await tr.search([cur], () => chk(), { sizes: [fs0 * .75, fs0, fs0 * 1.33], rots: [-60, -30, 0, 30, 60].map(d => tr.cfg.rot + d), cx: tr.cfg.cx, cy: tr.cfg.cy, top: 1 });
        if (b2.s > .3) { tr.cfg = { ...b2 }; log('rescue ok', b2.s.toFixed(2)) } tr.lost = 0;
        if (i + 1 < n) { await vs.seek((i + 1) / fps); vs.grab(fr, MAXSIDE) } continue;
      }
      if (sk) { await sk; vs.grab(fr, MAXSIDE) }
      const now = performance.now(); if (now - lastUi > 120 || i === n - 1) {
        lastUi = now; const el = (now - tAll) / 1000, eta = el / (i + 1) * (n - i - 1); S.curT = i / fps; updateTransport(); draw();
        busy('Mierzę kąt kostki…', `Klatka ${i + 1} z ${n} · jeszcze ok. ${Math.max(1, Math.round(eta))} s`, (i + 1) / n, { strip: true });
        const ok = samples.filter(x => x.conf >= MIN_CONF).length; $('hud').innerHTML = `<span class="badge">Wykryto: ${Math.round(ok / samples.length * 100)}%</span>`;
      }
    }
    overlayExtra = null; $('hud').innerHTML = '';
    await finishMeasurement(samples, 'auto', tr.side);
    log('auto done', ((performance.now() - tAll) / 1000).toFixed(1) + ' s', n + ' próbek');
  } catch (e) {
    if (e instanceof Cancelled) return; overlayExtra = null; unbusy(); S.phase = 'idle'; syncUI(); log('auto fail', e.message);
    if (e.code === 'not-found') {
      setStatus('Nie udało się automatycznie wykryć stopy. Zaznacz ją ręcznie – to zajmie kilka sekund.', 'warn'); say('Nie widzę stopy. Zaznacz ją ręcznie.', { p: 2 }); startPick();
    } else { setStatus('Wykrywanie nie powiodło się.', 'err'); showError('Wykrywanie stopy nie powiodło się', String(e.message || e), e.stack) }
  }
}

async function finishMeasurement(samples, mode, kpSide) {
  S.samples = samples; S._tt = null; S.mode = mode; S.kpSide = kpSide; S.id = Store.newId(); S.ts = new Date().toISOString(); S.thumbs = null;
  S.alpha = mode === 'manual' && S.manualAlpha != null ? { alpha: S.manualAlpha, guess: false } : defaultAlpha(samples);
  S.phase = 'ready'; recompute(false); const R = S.res; unbusy();
  if (!R || !Number.isFinite(R.range)) { setStatus('Nie udało się zmierzyć kąta – spróbuj zaznaczyć punkty ręcznie.', 'err'); syncUI(); return }
  S.valid = R.validPct; $('hud').innerHTML = `<span class="badge${R.validPct < .6 ? ' warn' : ''}">Stopa widoczna: ${Math.round(R.validPct * 100)}%</span>`;
  S.curT = 0; await vs.seek(0); vs.grab(fr, MAXSIDE); updateTransport(); draw();
  await makeThumbs(); saveNow(); syncUI();
  const bad = R.validPct < .6;
  setStatus(`Gotowe: zakres ${f0(R.range)}°, ${R.reps} powtórzeń.` + (bad ? ' Stopa była widoczna tylko w ' + Math.round(R.validPct * 100) + '% klatek – sprawdź wynik albo zaznacz punkty ręcznie.' : '') + (S.alpha.guess ? ' Przeciągnij żółty punkt wzdłuż goleni, by kąty były bezwzględne (zakres ruchu się nie zmieni).' : ''), bad || S.alpha.guess ? 'warn' : 'ok');
  if (S.alpha.guess || bad) { const h = $('hint'); h.className = 'hint warn'; h.innerHTML = S.alpha.guess ? 'Ustaw żółtą linię wzdłuż goleni (przeciągnij żółty punkt w stronę kolana) – wtedy 0° = stopa prostopadła do goleni. ' : 'Mało pewnych klatek – popraw punkty lub zaznacz ręcznie. '; if (S.alpha.guess) { const b = document.createElement('button'); b.className = 'btn small'; b.textContent = '⇄ Zamień'; b.onclick = flipAlpha; h.append(b) } const x = document.createElement('button'); x.className = 'btn small'; x.textContent = 'OK'; x.onclick = () => { h.hidden = true }; h.append(x); h.hidden = false }
  say(`Pomiar gotowy. Zakres ruchu ${f0(R.range)} stopni, ${R.reps} powtórzeń.`, { p: 2, ttl: 9000 });
  if (S.settings.autoPdf) await makeReport(true);
}
function flipAlpha() { S.alpha = { alpha: wrap(S.alpha.alpha + 180), guess: false }; S.samples.forEach(s => delete s.alpha); $('hint').hidden = true; recompute() }
$('btn-flip').onclick = flipAlpha;
$('btn-redo').onclick = () => { if (S.src === 'file') analyzeAuto() };
$('btn-rot').onclick = () => { if (S.src !== 'file') return; vs.rotQ = (vs.rotQ + 1) % 4; vs.grab(fr, MAXSIDE); cv.width = fr.width; cv.height = fr.height; $('stage').style.setProperty('--ar', fr.width / fr.height); S.thumbs = null; draw(); analyzeAuto() };
$('btn-manual').onclick = () => { if (S.phase === 'pick') { S.phase = S.res ? 'ready' : 'idle'; S.pick = []; $('hint').hidden = true; syncUI(); draw() } else startPick() };

/* ---------- ręczne zaznaczanie 3 punktów + śledzenie ---------- */
function startPick() {
  if (S.src !== 'file') return; S.job++; setPlaying(false); unbusy(); S.phase = 'pick'; S.pick = []; syncUI(); pickHint(); draw();
  say('Dotknij trzy punkty: najpierw goleń, potem kostkę, na końcu palce.', { p: 2, ttl: 8000 });
}
function pickHint() {
  const h = $('hint'), P = S.pick; h.className = 'hint'; h.hidden = false; h.innerHTML = '';
  const t = ['1/3 – dotknij punkt na GOLENI (nad kostką)', '2/3 – dotknij KOSTKĘ (wyrostek kostki bocznej)', '3/3 – dotknij czubek PALCÓW (palec I)', 'Gotowe – przeciągnij punkty, by poprawić.'][Math.min(3, P.length)];
  const sp = document.createElement('span'); sp.textContent = t; h.append(sp);
  if (P.length === 3) { const b = document.createElement('button'); b.className = 'btn primary'; b.textContent = '▶ Śledź punkty w filmie'; b.onclick = trackManual; h.append(b) }
  if (P.length) { const u = document.createElement('button'); u.className = 'btn small'; u.textContent = '↶ Cofnij'; u.onclick = () => { S.pick.pop(); pickHint(); draw() }; h.append(u) }
}
async function trackManual() {
  if (S.pick.length < 3) return; const token = ++S.job, chk = () => { if (token !== S.job) throw new Cancelled() };
  S.phase = 'tracking'; $('hint').hidden = true; syncUI(); setStatus('Śledzę zaznaczone punkty…');
  try {
    const [pShin, pAnk, pToe] = S.pick, t0 = S.curT, D = Math.min(vs.dur, MAX_ANALYZE_S), fps = clamp(150 / D, 5, 12), dt = 1 / fps;
    S.manualAlpha = angDeg(pAnk, pShin);
    const sc = 640 / Math.max(fr.width, fr.height), gw = Math.round(fr.width * sc), gh = Math.round(fr.height * sc), gc = mkCanvas(); gc.width = gw; gc.height = gh; const gx = gc.getContext('2d', { willReadFrequently: true }); let gbuf;
    const gray = () => { gx.drawImage(fr, 0, 0, gw, gh); gbuf = toGray(gx.getImageData(0, 0, gw, gh), gbuf); return gbuf };
    const P = new PatchTracker({ half: 18, radius: 40, update: .06, minScore: .4 });
    const times = []; for (let t = 0; t <= D - 1e-6; t += dt) times.push(+t.toFixed(4));
    let i0 = 0; for (let i = 0; i < times.length; i++) if (Math.abs(times[i] - t0) < Math.abs(times[i0] - t0)) i0 = i;
    const out = new Array(times.length); let done = 0; const t00 = performance.now();
    const pass = async (idxs) => {
      await vs.seek(times[i0]); vs.grab(fr, MAXSIDE); const g0 = gray();
      let an = P.init(g0, gw, gh, pAnk.x * sc, pAnk.y * sc), to = P.init(g0, gw, gh, pToe.x * sc, pToe.y * sc), va = { x: 0, y: 0 }, vt = { x: 0, y: 0 };
      for (const i of idxs) {
        chk(); if (i === i0) { out[i] = { t: times[i], ank: { ...pAnk }, big: { ...pToe }, conf: 1 }; continue }
        await vs.seek(times[i]); vs.grab(fr, MAXSIDE); const g = gray();
        const ax = an.x, ay = an.y, tx = to.x, ty = to.y;
        P.track(an, g, gw, gh, ax + va.x, ay + va.y); P.track(to, g, gw, gh, tx + vt.x, ty + vt.y);
        if (!an.lost) va = { x: .5 * va.x + .5 * (an.x - ax), y: .5 * va.y + .5 * (an.y - ay) }; if (!to.lost) vt = { x: .5 * vt.x + .5 * (to.x - tx), y: .5 * vt.y + .5 * (to.y - ty) };
        out[i] = { t: times[i], ank: { x: an.x / sc, y: an.y / sc }, big: { x: to.x / sc, y: to.y / sc }, conf: an.lost || to.lost ? 0 : Math.min(an.score, to.score) };
        overlayExtra = { ...out[i], alpha: S.manualAlpha }; done++;
        if (done % 3 === 0) { S.curT = times[i]; updateTransport(); draw(); busy('Śledzę punkty…', `Klatka ${done} z ${times.length}`, done / times.length, { strip: true }) }
      }
    };
    busy('Śledzę punkty…', '', 0, { strip: true });
    await pass(Array.from({ length: times.length - i0 }, (_, k) => i0 + k)); await pass(Array.from({ length: i0 }, (_, k) => i0 - 1 - k));
    overlayExtra = null; log('manual done', ((performance.now() - t00) / 1000).toFixed(1) + ' s');
    await finishMeasurement(out.filter(Boolean), 'manual', null);
  } catch (e) { if (e instanceof Cancelled) return; overlayExtra = null; unbusy(); S.phase = 'idle'; syncUI(); showError('Śledzenie punktów nie powiodło się', String(e.message || e), e.stack) }
}

/* ---------- przeciąganie punktów na obrazie ---------- */
const cpos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height } };
function handlesNow() {
  if (S.phase === 'pick') return S.pick.map((p, i) => ({ key: 'pick' + i, p }));
  if (S.phase !== 'ready' || S.playing) return [];
  const s = currentSample(); if (!s) return []; const H = [{ key: 'shin', p: shinEnd(s) }, { key: 'ank', p: s.ank }, { key: 'big', p: s.big }]; if (s.heel) H.push({ key: 'heel', p: s.heel }); return H;
}
cv.addEventListener('pointerdown', e => {
  if (S.src !== 'file') return; const p = cpos(e), k = kScale(), R = 26 * k;
  if (S.phase === 'pick' && S.pick.length < 3) { const near = handlesNow().find(h => pt(h.p, p) < R); if (!near) { S.pick.push(p); pickHint(); draw(); return } }
  let best = null, bd = R; for (const h of handlesNow()) { const d = pt(h.p, p); if (d < bd) { bd = d; best = h } }
  if (best) { S.drag = { key: best.key, i: S.phase === 'ready' ? currentSample().i : -1 }; cv.setPointerCapture(e.pointerId); e.preventDefault() }
});
let dragRaf = 0;
cv.addEventListener('pointermove', e => {
  const d = S.drag; if (!d) return; const p = cpos(e);
  p.x = clamp(p.x, 0, cv.width); p.y = clamp(p.y, 0, cv.height);
  if (d.key.startsWith('pick')) S.pick[+d.key.slice(4)] = p;
  else if (d.key === 'shin') { const s = S.samples[d.i]; S.alpha = { alpha: angDeg(s.ank, p), guess: false }; S.samples.forEach(x => delete x.alpha) }
  else { const s = S.samples[d.i]; s[d.key] = { x: p.x, y: p.y }; s.conf = 1; s.edited = true }
  if (!dragRaf) dragRaf = requestAnimationFrame(() => { dragRaf = 0; if (S.phase === 'ready') { S.res = computeSeries(S.samples, { alpha: S.alpha.alpha, cal: S.cal }); showKpis(); drawChart(); S._chartDirty = true } draw() });
});
const endDrag = () => { if (!S.drag) return; const k = S.drag.key; S.drag = null; if (S.phase === 'ready') { S.thumbs = null; recompute(); makeThumbs().then(saveNow) } else if (k.startsWith('pick')) pickHint() };
cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);
cv.addEventListener('pointermove', e => { if (S.drag || S.src !== 'file') return; const p = cpos(e); cv.classList.toggle('drag', handlesNow().some(h => pt(h.p, p) < 26 * kScale())) });

/* ---------- kamera na żywo ---------- */
function stopCam() { S.liveToken = (S.liveToken || 0) + 1; const st = video.srcObject; if (st) { st.getTracks().forEach(t => t.stop()); video.srcObject = null } S.live = null; if (S.phase === 'live') S.phase = 'idle' }
$('btn-cam').onclick = $('btn-cam-empty').onclick = $('d-cam').onclick = () => { if (S.phase === 'live') { stopCam(); S.src = null; resetMeasurement(); syncUI(); setStatus('Kamera wyłączona.') } else startCamera() };
$('seg-facing').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.settings.facing = b.dataset.f; Store.saveSettings(S.settings); if (S.phase === 'live') startCamera() };
async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { showError('Kamera niedostępna', 'Ta przeglądarka nie udostępnia kamery (wymagane https). Wczytaj film z telefonu.'); return }
  cancelJobs(); resetMeasurement(); vs.close(); vs.rotQ = 0; S.src = null; S.phase = 'loading'; syncUI(); busy('Włączam kamerę…', 'Zezwól na dostęp do kamery', null, { cancel: false });
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: S.settings.facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    video.srcObject = stream; await video.play().catch(() => { }); await new Promise(r => { if (video.videoWidth) r(); else video.addEventListener('loadedmetadata', r, { once: true }) });
  } catch (e) { S.phase = 'idle'; syncUI(); showError('Nie można włączyć kamery', e.name === 'NotAllowedError' ? 'Odmówiono dostępu do kamery. Zezwól na kamerę w ustawieniach przeglądarki albo wczytaj film.' : String(e.message || e), e.name); return }
  unbusy(); S.src = 'cam'; S.fileName = 'kamera'; S.phase = 'live'; S.mode = 'cam'; const token = S.liveToken = (S.liveToken || 0) + 1;
  $('stage').style.setProperty('--ar', video.videoWidth / video.videoHeight); cv.width = video.videoWidth; cv.height = video.videoHeight;
  $('src-info').textContent = `Kamera na żywo · ${video.videoWidth}×${video.videoHeight}`; setStatus('Ustaw kamerę z boku, na wysokości kostki, tak by stopa była w kadrze.'); startLoop(); syncUI();
  await model.load(modelStatus).catch(e => { showError('Model nie został wczytany', String(e.message || e)); throw e }); setPill('Model gotowy (RTMW-m)', 'ok');
  liveLoop(token);
}
async function liveLoop(token) {
  const live = S.live = { tr: new FootTracker(model), locked: false, buf: [], cur: null, max: -1e9, min: 1e9, snap: {}, t0: 0, ang: NaN, alpha: null, lastA: 0 };
  const c = mkCanvas(); let lastSearch = 0;
  while (token === S.liveToken) {
    vs.rotQ = 0; vs.grab(c, 960); const tNow = performance.now();
    try {
      if (!live.locked) {
        if (tNow - lastSearch > 1500) {
          lastSearch = tNow; setStatus('Szukam stopy w kadrze…'); const b = await live.tr.search([c], () => { }, { sizes: [1.6, 2.4], top: 1 }); if (token !== S.liveToken) return;
          if (b.s > .33) { await live.tr.lock(c, b); live.locked = true; live.alpha = null; setStatus('Stopa wykryta. Naciśnij „Start pomiaru”.', 'ok'); say('Widzę stopę. Możesz zaczynać pomiar.', { p: 1, ttl: 4000 }) }
        } else await sleep(100)
      } else {
        const f = await live.tr.step(c); if (token !== S.liveToken) return; const s = packFoot((tNow - live.t0) / 1000, f); live.cur = f.conf >= MIN_CONF ? s : null;
        // skala: kamera → współrzędne canvas (cv ma rozmiar wideo)
        const sx = cv.width / c.width; for (const k of ['ank', 'big', 'sm', 'heel', 'knee']) if (s[k]) { s[k].x *= sx; s[k].y *= sx } if (live.cur) live.cur = s;
        if (live.tr.lost >= 12) { live.locked = false; setStatus('Straciłem stopę – szukam ponownie…', 'warn'); continue }
        if (S.rec) live.buf.push(s);
        const pool = (S.rec ? live.buf : []).slice(-40); if (!live.alpha || tNow - live.lastA > 1500) { const tmp = [...pool, s].filter(x => x.conf >= MIN_CONF); if (tmp.length >= 6 || !live.alpha) { live.alpha = defaultAlpha(tmp.length ? tmp : [s]); live.lastA = tNow } }
        if (live.cur) {
          const a = live.alpha.alpha, th = Math.abs(wrap(footPhi(s) - a)), v = 90 - th; live.ang = Number.isFinite(live.ang) ? .6 * live.ang + .4 * v : v; s.alpha = a; live.cur.alpha = a;
          $('h-ang').textContent = sg(live.ang) + '°'; $('h-lab').textContent = S.rec ? 'REC ' + mmss((tNow - live.t0) / 1000) : 'kąt kostki';
          if (S.rec) { if (v > live.max + 1) { live.max = v; snapLive('max', s, v) } if (v < live.min - 1) { live.min = v; snapLive('min', s, v) } }
        }
      }
    } catch (e) { log('live', e.message); await sleep(300) }
    await sleep(0);
  }
}
function snapLive(k, s, v) {
  const sc = Math.min(1, 720 / cv.width), c = mkCanvas(); c.width = Math.round(cv.width * sc); c.height = Math.round(cv.height * sc); const g = c.getContext('2d'); g.drawImage(video, 0, 0, c.width, c.height);
  g.save(); g.scale(sc, sc); drawOverlay(g, s, 1 / sc, { big: true, label: sg(v) + '°' }); g.restore(); S.live.snap[k] = { img: c.toDataURL('image/jpeg', .8), t: s.t, v };
}
$('s-rec').onclick = async () => {
  const L = S.live; if (!L) return;
  if (!S.rec) { if (!L.locked) { toast('Najpierw ustaw stopę w kadrze – czekam na wykrycie.', true); return } L.buf = []; L.max = -1e9; L.min = 1e9; L.snap = {}; L.t0 = performance.now(); S.rec = true; syncUI(); say('Pomiar rozpoczęty.', { p: 2, ttl: 3000 }); return }
  S.rec = false; const samples = L.buf.filter(s => s.ank && s.big); const snap = L.snap; S.liveToken++; syncUI();
  if (samples.length < 8) { setStatus('Pomiar był zbyt krótki.', 'warn'); startCamera(); return }
  const stream = video.srcObject; S.phase = 'idle'; S.src = 'cam';
  S.samples = samples; S.mode = 'cam'; S.id = Store.newId(); S.ts = new Date().toISOString(); S.alpha = L.alpha || defaultAlpha(samples); S.alpha.guess = !(S.alpha && !S.alpha.guess);
  samples.forEach(s => { s.alpha = L.alpha ? L.alpha.alpha : undefined });
  S.res = computeSeries(samples, { alpha: S.alpha.alpha }); S.thumbs = { max: snap.max || null, min: snap.min || null }; S.phase = 'ready'; showKpis(); drawChart(); saveNow(); syncUI();
  setStatus(`Pomiar zakończony: zakres ${f0(S.res.range)}°, ${S.res.reps} powtórzeń.`, 'ok'); say(`Pomiar zakończony. ${S.res.reps} powtórzeń.`, { p: 2, ttl: 6000 });
  if (S.settings.autoPdf) await makeReport(true);
  if (stream) { /* kamera zostaje włączona – przycisk „Kamera” ją wyłącza */ S.phase = 'live'; S.rec = false; liveLoop(S.liveToken); syncUI() }
};

/* ---------- ustawienia, historia ---------- */
$('in-client').value = S.settings.client; $('chk-auto').checked = S.settings.autoPdf;
$('in-client').addEventListener('input', e => { S.settings.client = e.target.value.trim(); Store.saveSettings(S.settings) });
$('chk-auto').onchange = e => { S.settings.autoPdf = e.target.checked; Store.saveSettings(S.settings) };
$('seg-side').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.side = b.dataset.s; syncSides(); if (S.res) { drawChart(); scheduleSave() } };
$('seg-inj').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.settings.injured = b.dataset.s; Store.saveSettings(S.settings); syncSides() };

function renderHist() {
  const H = S.hist; $('hist-sub').textContent = H.length ? `${H.length} pomiarów` : 'brak zapisanych pomiarów';
  const rows = [...H].reverse().slice(0, 60).map(h => { const g = h.ankle || h.m; return `<tr><td>${dstr(h.ts, 1)}</td><td style="color:${h.side === 'L' ? COL.L : COL.R};font-weight:800">${h.side === 'L' ? 'L' : 'P'}</td><td>${sg(g.min)}…${sg(g.max)}°</td><td><b>${f0(g.range)}°</b></td><td>${h.reps ?? '–'}</td><td><button class="del" data-id="${h.id}" aria-label="Usuń pomiar">🗑</button></td></tr>` }).join('');
  $('hist-table').innerHTML = `<tr><th>Data</th><th>Str.</th><th>Min…max</th><th>Zakres</th><th>Powt.</th><th></th></tr>` + (rows || '<tr><td colspan="6" style="text-align:left;color:var(--dim)">Tu pojawią się Twoje pomiary – zapisują się automatycznie.</td></tr>');
  drawProg();
}
function drawProg() {
  const c = $('prog'); if (!c.offsetParent) return; const d = fitCanvas(c), g = c.getContext('2d'), W = c.width, H = c.height, A = S.hist; g.clearRect(0, 0, W, H);
  const pl = 36 * d, pr = 12 * d, pt_ = 12 * d, pb = 18 * d, pw = W - pl - pr, ph = H - pt_ - pb;
  const rng = h => (h.ankle || h.m).range, hi = Math.max(70, ...A.map(rng)), n = A.length;
  const X = i => pl + (n < 2 ? .5 : i / (n - 1)) * pw, Y = v => pt_ + ph - v / hi * ph;
  g.font = `${11 * d}px Inter,sans-serif`; g.textAlign = 'right'; g.textBaseline = 'middle';
  for (let v = 0; v <= hi; v += 20) { g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = d; g.beginPath(); g.moveTo(pl, Y(v)); g.lineTo(pl + pw, Y(v)); g.stroke(); g.fillStyle = '#8a9291'; g.fillText(v + '°', pl - 6 * d, Y(v)) }
  if (!n) { g.textAlign = 'center'; g.fillStyle = '#7C8584'; g.fillText('Wykres postępów pojawi się po pierwszym pomiarze', W / 2, H / 2); return }
  for (const sd of ['L', 'R']) { const pts = A.map((h, i) => h.side === sd ? { x: X(i), y: Y(rng(h)) } : null).filter(Boolean); if (!pts.length) continue; g.strokeStyle = sd === 'L' ? COL.L : COL.R; g.fillStyle = g.strokeStyle; g.lineWidth = 2.2 * d; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.stroke(); pts.forEach(p => { g.beginPath(); g.arc(p.x, p.y, 3.5 * d, 0, 7); g.fill() }) }
}
$('hist').addEventListener('toggle', drawProg);
$('hist-table').addEventListener('click', e => { const b = e.target.closest('.del'); if (!b) return; if (!confirm('Usunąć ten pomiar z historii?')) return; S.hist = S.hist.filter(h => h.id !== b.dataset.id); if (S.id === b.dataset.id) S.id = Store.newId(); Store.saveHistory(S.hist); renderHist() });
$('btn-h-json').onclick = () => triggerDownload(new Blob([JSON.stringify({ app: 'rehabilitacja-stopy', version: VERSION, sessions: S.hist }, null, 1)], { type: 'application/json' }), `rehabilitacja-stopy-historia-${stamp(new Date())}.json`);
$('btn-h-csv').onclick = () => triggerDownload(new Blob(['\ufeff' + Store.toCSV(S.hist)], { type: 'text/csv' }), `rehabilitacja-stopy-historia-${stamp(new Date())}.csv`);
$('btn-h-imp').onclick = () => $('file-imp').click();
$('file-imp').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { const n = Store.mergeImported(S.hist, await f.text()); Store.saveHistory(S.hist); renderHist(); toast(`Zaimportowano ${n} pomiarów.`) } catch (err) { toast('Nie udało się zaimportować pliku: ' + err.message, true) } };
$('btn-h-clear').onclick = () => { if (confirm('Usunąć CAŁĄ historię pomiarów? Tej operacji nie można cofnąć.')) { S.hist = []; Store.saveHistory(S.hist); renderHist() } };

/* ---------- start ---------- */
$('ver').textContent = VERSION;
try { window.Coach && Coach.bindSettings($('btn-coach')) } catch (_) { }
syncUI(); renderHist(); showKpis();
if (location.protocol === 'http:' && !/^(localhost|127\.|\[::1\])/.test(location.hostname)) toast('Kamera działa tylko przez https – wczytywanie filmów działa zawsze.', true);
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').then(reg => { reg.update().catch(() => { }) }).catch(e => log('sw', e.message));
  let had = !!navigator.serviceWorker.controller; navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && S.phase === 'idle' && !S.src) location.reload(); else if (had) toast('Dostępna nowa wersja aplikacji – odśwież stronę po zakończeniu pomiaru.'); had = true });
}
window.__app = { S, vs, model, VERSION };

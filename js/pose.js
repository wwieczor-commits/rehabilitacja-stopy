/* Rehabilitacja stopy – wykrywanie stopy i kostki (RTMW-m, 133 punkty ciała/stóp, onnxruntime-web, lokalnie w przeglądarce).
   Model działa „od góry do dołu”: dostaje wycinek obrazu 192×256 z jedną osobą. Do zbliżenia stopy używamy WIĘKSZEGO,
   obróconego wycinka (stopa zajmuje ~10% jego wysokości) – dzięki temu model rozpoznaje stopę bez widocznej całej sylwetki.
   © Wojciech Wieczorek */
import { abs, loadScript, rad, deg, circMean } from './util.js';

export const MW = 192, MH = 256;
const MEAN = [123.675, 116.28, 103.53], STD = [58.395, 57.12, 57.375];
/** indeksy punktów COCO-WholeBody: kostka, kciuk stopy (palec I), mały palec, pięta, kolano */
export const KP = { L: { ank: 15, big: 17, sm: 18, heel: 19, knee: 13 }, R: { ank: 16, big: 20, sm: 21, heel: 22, knee: 14 } };
const IDX = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
export const MODEL_URL = 'assets/models/rtmw-m.onnx';

export class FootModel {
  constructor() {
    this.sess = null; this.loading = null;
    this.cv = document.createElement('canvas'); this.cv.width = MW; this.cv.height = MH;
    this.ctx = this.cv.getContext('2d', { willReadFrequently: true });
    this.inp = new Float32Array(3 * MW * MH);
    this.lastMs = 0; this.runs = 0;
  }
  get ready() { return !!this.sess }

  load(onStatus = () => { }) {
    if (this.sess) return Promise.resolve();
    return this.loading || (this.loading = (async () => {
      onStatus('Wczytuję silnik (WebAssembly)…', 0);
      await loadScript(abs('assets/ort/ort.wasm.min.js'));
      const ort = window.ort;
      ort.env.wasm.numThreads = 1;                       // GitHub Pages nie daje nagłówków COOP/COEP → bez wątków
      ort.env.wasm.wasmPaths = abs('assets/ort/');       // musi być adres bezwzględny
      ort.env.logLevel = 'error';
      const res = await fetch(abs(MODEL_URL));
      if (!res.ok) throw new Error('Model nie został pobrany (' + res.status + ')');
      const total = +res.headers.get('content-length') || 62376212;
      let buf;
      if (res.body && res.body.getReader) {
        const rd = res.body.getReader(); const parts = []; let got = 0;
        for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; onStatus(`Pobieram model rozpoznawania stopy… ${Math.round(got / 1048576)} / ${Math.round(total / 1048576)} MB`, Math.min(1, got / total)) }
        buf = new Uint8Array(got); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length }
      } else buf = new Uint8Array(await res.arrayBuffer());
      onStatus('Uruchamiam model…', 1);
      this.sess = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 3 });
      this.inName = this.sess.inputNames[0];
      // rozpoznanie wyjść po wymiarach (simcc_x ma 384 = 2·192, simcc_y 512 = 2·256)
      this.outX = null; this.outY = null;
      const x = new ort.Tensor('float32', this.inp, [1, 3, MH, MW]);
      const o = await this.sess.run({ [this.inName]: x });
      for (const [k, v] of Object.entries(o)) { if (v.dims[2] === MW * 2) this.outX = k; if (v.dims[2] === MH * 2) this.outY = k }
      if (!this.outX || !this.outY) throw new Error('Nieoczekiwany format wyjścia modelu');
      onStatus('Model gotowy', 1);
    })().catch(e => { this.loading = null; throw e }));
  }

  /** Jedno uruchomienie na wycinku wyśrodkowanym w (cx,cy), wysokość = fs·max(W,H), obrót rot (°). Zwraca punkty w pikselach `src`. */
  async run(src, cx, cy, fs, rot) {
    const ort = window.ort, L = Math.max(src.width, src.height);
    const h = fs * L, w = h * MW / MH, th = rad(rot), c = Math.cos(th), s = Math.sin(th);
    // wyjście (u,v) → źródło: p = C + R·[(u−W/2)·w/W, (v−H/2)·h/H]; canvas potrzebuje odwrotności (źródło → wyjście)
    const sx = w / MW, sy = h / MH;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, MW, MH);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    // u = ( c·(x−cx) + s·(y−cy) )/sx + W/2 ;  v = ( −s·(x−cx) + c·(y−cy) )/sy + H/2
    const A = c / sx, B = -s / sy, C = s / sx, D = c / sy;
    const E = MW / 2 - (c * cx + s * cy) / sx, F = MH / 2 - (-s * cx + c * cy) / sy;
    ctx.setTransform(A, B, C, D, E, F);
    ctx.drawImage(src, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const px = ctx.getImageData(0, 0, MW, MH).data, n = MW * MH, inp = this.inp;
    for (let i = 0, j = 0; i < n; i++, j += 4) { inp[i] = (px[j] - MEAN[0]) / STD[0]; inp[n + i] = (px[j + 1] - MEAN[1]) / STD[1]; inp[2 * n + i] = (px[j + 2] - MEAN[2]) / STD[2] }
    const t0 = performance.now();
    const out = await this.sess.run({ [this.inName]: new ort.Tensor('float32', inp, [1, 3, MH, MW]) });
    this.lastMs = performance.now() - t0; this.runs++;
    const X = out[this.outX].data, Y = out[this.outY].data, nx = MW * 2, ny = MH * 2;
    const kp = {};
    for (const k of IDX) {
      let bx = 0, mx = -1e9, by = 0, my = -1e9;
      for (let i = 0, o = k * nx; i < nx; i++) { const v = X[o + i]; if (v > mx) { mx = v; bx = i } }
      for (let i = 0, o = k * ny; i < ny; i++) { const v = Y[o + i]; if (v > my) { my = v; by = i } }
      const u = bx / 2, v = by / 2;
      kp[k] = { x: cx + c * (u - MW / 2) * sx - s * (v - MH / 2) * sy, y: cy + s * (u - MW / 2) * sx + c * (v - MH / 2) * sy, c: Math.min(mx, my) };
    }
    return kp;
  }
}

export const sideConf = (kp, side) => { const m = KP[side]; return (kp[m.ank].c + kp[m.big].c + kp[m.sm].c + kp[m.heel].c) / 4 };
/** wybrane punkty jednej strony w wygodnej postaci */
export function footPts(kp, side) { const m = KP[side]; return { ank: kp[m.ank], big: kp[m.big], sm: kp[m.sm], heel: kp[m.heel], knee: kp[m.knee], conf: sideConf(kp, side) } }

/** Kąt osi stopy (° w obrazie): średnia kołowa kierunków pięta→palec I oraz kostka→palec I */
export function footAngle(f) {
  const a1 = deg(Math.atan2(f.big.y - f.heel.y, f.big.x - f.heel.x)), a2 = deg(Math.atan2(f.big.y - f.ank.y, f.big.x - f.ank.x));
  return circMean([a1, a2]);
}

/** Śledzenie stopy w kolejnych klatkach: wycinek jest na bieżąco wyśrodkowywany na stopie. */
export class FootTracker {
  constructor(model) { this.m = model; this.cfg = null; this.side = null; this.lost = 0 }
  /** Szukanie ustawienia wycinka (rozmiar, obrót, środek), przy którym model „widzi” stopę.
      srcs – kilka klatek (canvas) z różnych momentów filmu; wynik uśredniamy, żeby nie trafić na przypadkową klatkę. */
  async search(srcs, progress = () => { }, opt = {}) {
    if (!Array.isArray(srcs)) srcs = [srcs];
    const W = srcs[0].width, H = srcs[0].height, L = Math.max(W, H), M = this.m, N = srcs.length;
    const sizes = opt.sizes || [1.4, 2.0, 2.8], rots = opt.rots || [0, 45, 90, 135, 180, 225, 270, 315];
    const TOP = opt.top ?? 2, REFINE = 14, total = (sizes.length * rots.length + TOP * REFINE) * N; let i = 0;
    const score = kp => Math.max(sideConf(kp, 'L'), sideConf(kp, 'R'));
    const evalCfg = async (cx, cy, fs, rot) => { let s = 0; for (const src of srcs) { s += score(await M.run(src, cx, cy, fs, rot)); progress(++i, total); await new Promise(r => setTimeout(r, 0)) } return s / N };
    const cx0 = opt.cx ?? W / 2, cy0 = opt.cy ?? H / 2, cands = [];
    for (const fs of sizes) for (const rot of rots) cands.push({ s: await evalCfg(cx0, cy0, fs, rot), fs, rot, cx: cx0, cy: cy0 });
    cands.sort((a, b) => b.s - a.s);
    // dopracowanie wokół najlepszych: przesunięcie środka ±0.15·rozmiar (krzyż) i obrót ±22°
    const offs = [[0, 0], [-.15, 0], [.15, 0], [0, -.15], [0, .15]];
    let best = cands[0];
    for (const c0 of cands.slice(0, TOP)) {
      for (const dr of [-22, 0, 22]) for (const [dx, dy] of offs) {
        if (dr === 0 && dx === 0 && dy === 0) continue;
        const cx = c0.cx + dx * c0.fs * L, cy = c0.cy + dy * c0.fs * L, rot = c0.rot + dr;
        const s = await evalCfg(cx, cy, c0.fs, rot);
        if (s > best.s) best = { s, fs: c0.fs, rot, cx, cy }
      }
    }
    return best;
  }
  /** Ustawia wycinek i stronę (L/P) na podstawie wyniku search() i pierwszej klatki. */
  async lock(src, cfg) {
    this.cfg = { ...cfg }; this.lost = 0;
    const kp = await this.m.run(src, cfg.cx, cfg.cy, cfg.fs, cfg.rot);
    this.side = sideConf(kp, 'L') >= sideConf(kp, 'R') ? 'L' : 'R';
    const f = footPts(kp, this.side); this.recenter(f); return f;
  }
  recenter(f) {
    if (f.conf < .25) return;
    const cx = (f.ank.x + f.big.x + f.heel.x) / 3, cy = (f.ank.y + f.big.y + f.heel.y) / 3;
    this.cfg.cx = .6 * this.cfg.cx + .4 * cx; this.cfg.cy = .6 * this.cfg.cy + .4 * cy;
  }
  async step(src) {
    const c = this.cfg, kp = await this.m.run(src, c.cx, c.cy, c.fs, c.rot);
    const f = footPts(kp, this.side);
    if (f.conf < .25) this.lost++; else this.lost = 0;
    this.recenter(f); return f;
  }
}

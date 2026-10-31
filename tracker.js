/* Rehabilitacja stopy – lekki tracker punktów (dopasowanie wzorca ZNCC, bez OpenCV).
   Działa na obrazie w skali szarości; punkty są śledzone niezależnie, a kąt między odcinkami
   (goleń – stopa) jest niewrażliwy na drżenie i przesunięcia kamery.
   Wyszukiwanie: gruboziarniste (co 2 px, próbkowanie co 2 px) + dokładne ±2 px + parabola dla subpikseli.
   Wzorzec jest powoli aktualizowany, aby nadążał za obrotem stopy. */

export function toGray(imageData, out) {
  const d = imageData.data, n = imageData.width * imageData.height;
  const g = out && out.length === n ? out : new Uint8ClampedArray(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
  return g;
}

function sample(gray, W, cx, cy, h, stride) {
  const out = [];
  for (let dy = -h; dy <= h; dy += stride) for (let dx = -h; dx <= h; dx += stride) out.push(gray[(cy + dy) * W + cx + dx]);
  return Float32Array.from(out);
}
function zeroMean(a) {
  let m = 0; for (let i = 0; i < a.length; i++) m += a[i]; m /= a.length;
  let s = 0; const o = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) { o[i] = a[i] - m; s += o[i] * o[i]; }
  return { v: o, norm: Math.sqrt(s) };
}

export class PatchTracker {
  constructor(opt = {}) { this.tol = opt.tol; this.k = opt.k; this.R2 = opt.R2; this.h = opt.half || 14; this.R = opt.radius || 26; this.update = opt.update ?? 0.08; this.minScore = opt.minScore ?? 0.45; }
  /** x,y w pikselach obrazu szarości. Zwraca stan punktu. */
  init(gray, W, H, x, y) {
    const h = this.h;
    const cx = Math.round(Math.min(W - h - 1, Math.max(h, x))), cy = Math.round(Math.min(H - h - 1, Math.max(h, y)));
    const st = { x: cx, y: cy, score: 1, lost: 0, raw: sample(gray, W, cx, cy, h, 1) };
    this._prep(st); return st;
  }
  _prep(st) {
    const h = this.h;
    st.t1 = zeroMean(st.raw);
    const c = []; const n = 2 * h + 1;
    for (let iy = 0; iy < n; iy += 2) for (let ix = 0; ix < n; ix += 2) c.push(st.raw[iy * n + ix]);
    st.t2 = zeroMean(Float32Array.from(c));
  }
  _zncc(gray, W, cx, cy, t, stride) {
    const h = this.h; let s = 0, ss = 0, sc = 0, k = 0; const tv = t.v;
    for (let dy = -h; dy <= h; dy += stride) {
      const row = (cy + dy) * W + cx;
      for (let dx = -h; dx <= h; dx += stride) { const p = gray[row + dx]; s += p; ss += p * p; sc += p * tv[k++]; }
    }
    const n = k, varr = ss - s * s / n; if (varr < 1e-3 || t.norm < 1e-3) return -1;
    return sc / (Math.sqrt(varr) * t.norm);
  }
  /** Śledzi punkt w nowej klatce. Zwraca stan (zmodyfikowany w miejscu). */
  track(st, gray, W, H, ox, oy, rad, pen) {
    const h = this.h, R = rad || this.R, lo = h + 1;
    const clampX = v => Math.min(W - h - 2, Math.max(lo, v)), clampY = v => Math.min(H - h - 2, Math.max(lo, v));
    const x0 = Math.round(ox ?? st.x), y0 = Math.round(oy ?? st.y);
    let best = -2, bx = x0, by = y0;
    for (let dy = -R; dy <= R; dy += 2) for (let dx = -R; dx <= R; dx += 2) {
      const cx = clampX(x0 + dx), cy = clampY(y0 + dy);
      const sc = this._zncc(gray, W, cx, cy, st.t2, 2) - (pen ? pen(cx, cy) : 0); if (sc > best) { best = sc; bx = cx; by = cy }
    }
    const cx0 = bx, cy0 = by; best = -2;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const cx = clampX(cx0 + dx), cy = clampY(cy0 + dy);
      const sc = this._zncc(gray, W, cx, cy, st.t1, 1) - (pen ? pen(cx, cy) : 0); if (sc > best) { best = sc; bx = cx; by = cy }
    }
    if (pen) best += pen(bx, by);                            // surowy wynik ZNCC (bez kary)
    st.score = best;
    if (best < this.minScore) { st.lost++; return st }       // zostajemy w miejscu
    st.lost = 0; st.prevX = st.x; st.prevY = st.y;
    // subpiksel
    let fx = bx, fy = by;
    const sl = this._zncc(gray, W, clampX(bx - 1), by, st.t1, 1), sr = this._zncc(gray, W, clampX(bx + 1), by, st.t1, 1);
    const su = this._zncc(gray, W, bx, clampY(by - 1), st.t1, 1), sd = this._zncc(gray, W, bx, clampY(by + 1), st.t1, 1);
    const ax = sl - 2 * best + sr, ay = su - 2 * best + sd;
    if (ax < -1e-6) fx += Math.max(-.5, Math.min(.5, .5 * (sl - sr) / ax));
    if (ay < -1e-6) fy += Math.max(-.5, Math.min(.5, .5 * (su - sd) / ay));
    st.x = fx; st.y = fy;
    if (best > 0.8 && this.update > 0) {                   // powolna adaptacja wzorca
      const cur = sample(gray, W, bx, by, h, 1), a = this.update;
      for (let i = 0; i < cur.length; i++) st.raw[i] = st.raw[i] * (1 - a) + cur[i] * a;
      this._prep(st);
    }
    return st;
  }
}

/** Kąt (0–180°) między wektorami B→A i B→C */
export function angleBetween(A, B, C) {
  const v1x = A.x - B.x, v1y = A.y - B.y, v2x = C.x - B.x, v2y = C.y - B.y;
  const d = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y); if (d < 1e-6) return null;
  return Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / d))) * 180 / Math.PI;
}

/** Licznik powtórzeń z histerezą „zygzak” (amplituda minimalna) */
export class ZigZag {
  constructor(swing = 8) { this.swing = swing; this.reset() }
  reset() { this.dir = 0; this.hi = -Infinity; this.lo = Infinity; this.hiT = 0; this.loT = 0; this.valleys = 0; this.peaks = 0; this.reps = 0; this.seenValley = false; this.events = [] }
  /** Zwraca 'peak' | 'valley' | null przy potwierdzeniu ekstremum. */
  push(t, v) {
    if (v > this.hi) { this.hi = v; this.hiT = t }
    if (v < this.lo) { this.lo = v; this.loT = t }
    if (this.dir >= 0 && this.hi - v >= this.swing && this.hi - this.lo >= this.swing) {      // szczyt potwierdzony
      this.dir = -1; this.peaks++; const ev = { k: 'peak', t: this.hiT, v: this.hi }; this.events.push(ev);
      if (this.seenValley) this.reps++;
      this.lo = v; this.loT = t; return 'peak';
    }
    if (this.dir <= 0 && v - this.lo >= this.swing && this.hi - this.lo >= this.swing) {      // dolina potwierdzona
      this.dir = 1; this.valleys++; this.seenValley = true; this.events.push({ k: 'valley', t: this.loT, v: this.lo });
      this.hi = v; this.hiT = t; return 'valley';
    }
    return null;
  }
}

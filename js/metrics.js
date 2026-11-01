/* Rehabilitacja stopy – z punktów na klatkach do kąta, zakresu ruchu i powtórzeń (© Wojciech Wieczorek).
   Kąt kostki (v): 0° = stopa prostopadła do goleni, „+” = zgięcie grzbietowe (palce do goleni), „−” = podeszwowe.
   v = 90° − kąt między osią stopy a osią goleni. Oś stopy = średnia kołowa kierunków pięta→palec I i kostka→palec I. */
import { ZigZag } from '../tracker.js';
import { wrap, circMean, median, pct, clamp, deg } from './util.js';

export const MIN_CONF = 0.22;     // poniżej – klatkę uznajemy za niepewną i uzupełniamy z sąsiednich

const ang = (a, b) => deg(Math.atan2(b.y - a.y, b.x - a.x));
/** kąt osi stopy z punktów klatki (ank, big, opcjonalnie heel) */
export function footPhi(s) {
  const a2 = ang(s.ank, s.big);
  return s.heel ? circMean([ang(s.heel, s.big), a2]) : a2;
}

function interp(arr, ok) {
  const n = arr.length, out = arr.slice(), idx = []; for (let i = 0; i < n; i++) if (ok[i] && Number.isFinite(arr[i])) idx.push(i);
  if (!idx.length) return out.map(() => NaN);
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (ok[i] && Number.isFinite(arr[i])) { out[i] = arr[i]; continue }
    while (k < idx.length - 1 && idx[k + 1] < i) k++;
    const a = idx[k], b = idx[k + 1];
    if (i < idx[0]) out[i] = arr[idx[0]]; else if (b === undefined || i > idx[idx.length - 1]) out[i] = arr[idx[idx.length - 1]];
    else out[i] = arr[a] + (arr[b] - arr[a]) * (i - a) / (b - a);
  }
  return out;
}
const med3 = a => a.map((_, i) => median([a[Math.max(0, i - 1)], a[i], a[Math.min(a.length - 1, i + 1)]]));
const ma3 = a => a.map((_, i) => (a[Math.max(0, i - 1)] + a[i] + a[Math.min(a.length - 1, i + 1)]) / 3);
export const smooth = a => ma3(med3(a));

/** Domyślna oś goleni (kierunek kostka→kolano w obrazie, °): prostopadła do średniej osi stopy;
    znak wybieramy tak, by wskazywała stronę kolana wykrytego przez model (jeśli jest wiarygodne). */
export function defaultAlpha(samples) {
  const ok = samples.filter(s => s.conf >= MIN_CONF);
  if (!ok.length) return { alpha: 90, guess: true, phiMean: 0 };
  const phiMean = circMean(ok.map(footPhi));
  const cands = [phiMean + 90, phiMean - 90];
  const kn = ok.filter(s => s.knee && s.knee.c > 0.15);
  if (kn.length >= Math.max(5, ok.length * .2)) {
    const kd = circMean(kn.map(s => ang(s.ank, s.knee)));
    const best = Math.abs(wrap(cands[0] - kd)) <= Math.abs(wrap(cands[1] - kd)) ? cands[0] : cands[1];
    return { alpha: wrap(best), guess: false, phiMean, kneeDir: kd };
  }
  return { alpha: wrap(cands[1]), guess: true, phiMean };
}

/** Główna funkcja: samples [{t, ank, big, heel?, conf, alpha?}] → seria kątów i statystyki.
    opt: {alpha (° – oś goleni, gdy brak alpha w próbce), cal (° odjęte od kąta)} */
export function computeSeries(samples, opt = {}) {
  const n = samples.length;
  if (n < 3) return null;
  const ok = samples.map(s => (s.conf ?? 1) >= MIN_CONF && s.ank && s.big);
  const phi = samples.map(s => s.ank && s.big ? footPhi(s) : NaN);
  const A0 = opt.alpha ?? 90, cal = opt.cal || 0;
  const theta = phi.map((p, i) => Number.isFinite(p) ? Math.abs(wrap(p - (samples[i].alpha ?? A0))) : NaN);
  // próbki niepewne uzupełniamy liniowo, potem mediana(3) + średnia(3)
  const raw = theta.map(th => 90 - th - cal);
  const v = smooth(interp(raw, ok));
  const t = samples.map(s => s.t);
  const good = v.filter((_, i) => ok[i]);
  const validPct = ok.filter(Boolean).length / n;
  if (!good.length) return { t, v, ok, validPct: 0, max: NaN, min: NaN, range: NaN, reps: 0, tMax: 0, tMin: 0, peaks: [], valleys: [] };
  const max = pct(v, .98), min = pct(v, .02), range = max - min;
  // czasy ekstremów (na wygładzonej serii, tylko w pewnych klatkach)
  let iMax = -1, iMin = -1; for (let i = 0; i < n; i++) { if (!ok[i]) continue; if (iMax < 0 || v[i] > v[iMax]) iMax = i; if (iMin < 0 || v[i] < v[iMin]) iMin = i }
  // powtórzenia: zygzak z progiem proporcjonalnym do zakresu
  const swing = clamp(.2 * range, 4, 10), zz = new ZigZag(swing), peaks = [], valleys = [];
  for (let i = 0; i < n; i++) { const r = zz.push(t[i], v[i]); if (r === 'peak') peaks.push(zz.events[zz.events.length - 1]); else if (r === 'valley') valleys.push(zz.events[zz.events.length - 1]) }
  const dur = t[n - 1] - t[0];
  const mean = v.reduce((a, b) => a + b, 0) / n;
  return { t, v, ok, validPct, max, min, range, mean, reps: zz.reps, swing, tMax: t[iMax], tMin: t[iMin], iMax, iMin, peaks, valleys, dur, cal, alpha: A0 };
}

/** wartość serii dla czasu tt (interpolacja) */
export function valueAt(res, tt) {
  const { t, v } = res; if (!t.length) return NaN;
  if (tt <= t[0]) return v[0]; if (tt >= t[t.length - 1]) return v[v.length - 1];
  let lo = 0, hi = t.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= tt) lo = m; else hi = m }
  return v[lo] + (v[hi] - v[lo]) * (tt - t[lo]) / (t[hi] - t[lo] || 1);
}
/** indeks próbki najbliższej czasowi tt */
export function nearest(t, tt) {
  let lo = 0, hi = t.length - 1; if (!hi) return 0;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= tt) lo = m; else hi = m }
  return Math.abs(t[hi] - tt) < Math.abs(t[lo] - tt) ? hi : lo;
}

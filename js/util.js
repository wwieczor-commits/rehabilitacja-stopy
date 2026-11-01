/* Rehabilitacja stopy – drobne narzędzia (© Wojciech Wieczorek) */
export const $ = id => document.getElementById(id);
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const deg = r => r * 180 / Math.PI;
export const rad = d => d * Math.PI / 180;
/** różnica kątów do zakresu (-180, 180] */
export const wrap = a => { a = (a + 180) % 360; if (a < 0) a += 360; return a - 180 };
/** średnia kołowa kątów (stopnie) */
export function circMean(angles, weights) {
  let sx = 0, sy = 0;
  angles.forEach((a, i) => { const w = weights ? weights[i] : 1; sx += w * Math.cos(rad(a)); sy += w * Math.sin(rad(a)) });
  return deg(Math.atan2(sy, sx));
}
export const median = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN };
export const pct = (a, p) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); if (!s.length) return NaN; const i = clamp(p * (s.length - 1), 0, s.length - 1), lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo) };
export const f0 = v => Number.isFinite(v) ? Math.round(v).toString() : '–';
export const f1 = v => Number.isFinite(v) ? v.toFixed(1) : '–';
/** ze znakiem i prawdziwym minusem: +12 / −34 */
export const sg = v => !Number.isFinite(v) ? '–' : (v > 0.49 ? '+' : v < -0.49 ? '−' : '') + Math.abs(v).toFixed(0);
export const p2 = n => String(n).padStart(2, '0');
export const stamp = d => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
export const dstr = (iso, withTime) => { const d = new Date(iso); return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}` + (withTime ? ` ${p2(d.getHours())}:${p2(d.getMinutes())}` : '') };
export const mmss = s => `${p2(Math.floor(s / 60))}:${p2(Math.floor(s % 60))}`;
export const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const IS_MOBILE = IS_IOS || /Android/i.test(navigator.userAgent) || (matchMedia && matchMedia('(pointer:coarse)').matches && innerWidth < 900);
export const abs = p => new URL(p, location.href).href;
export function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.onload = () => res(); s.onerror = () => { s.remove(); rej(new Error('Nie można wczytać ' + src)) }; document.head.appendChild(s);
  });
}
export function triggerDownload(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 4000);
}
export function canvasToBlob(c, type = 'image/jpeg', q = .85) { return new Promise(r => c.toBlob(r, type, q)) }

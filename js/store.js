/* Rehabilitacja stopy – ustawienia i historia pomiarów w localStorage (© Wojciech Wieczorek).
   Format historii jest zgodny z wcześniejszymi wersjami aplikacji (klucz rehab.sessions.v1) – stare pomiary zostają. */
const K_HIST = 'rehab.sessions.v1', K_SET = 'rehab.settings.v2', K_SET_OLD = 'rehab.settings.v1';
const DEFAULTS = { client: '', injured: 'R', autoPdf: true, facing: 'environment', side: 'auto' };

export function loadSettings() {
  let o = {};
  try { o = JSON.parse(localStorage.getItem(K_SET) || 'null') || JSON.parse(localStorage.getItem(K_SET_OLD) || '{}') || {} } catch (_) { }
  return { ...DEFAULTS, client: String(o.client || ''), injured: o.injured === 'L' ? 'L' : 'R', autoPdf: o.autoPdf !== false, facing: o.facing === 'user' ? 'user' : 'environment', side: ['L', 'R'].includes(o.side) ? o.side : 'auto' };
}
export function saveSettings(s) { try { localStorage.setItem(K_SET, JSON.stringify(s)) } catch (_) { } }

export function loadHistory() {
  try { const a = JSON.parse(localStorage.getItem(K_HIST) || '[]'); return Array.isArray(a) ? a.filter(x => x && x.ts && x.m).sort((p, q) => p.ts < q.ts ? -1 : 1) : [] } catch (_) { return [] }
}
/** zapis z awaryjnym zwalnianiem miejsca (usuwamy miniatury najstarszych pomiarów). Zwraca true/false. */
export function saveHistory(hist) {
  for (let i = 0; i < 40; i++) {
    try { localStorage.setItem(K_HIST, JSON.stringify(hist)); return true } catch (_) {
      const k = hist.find(s => s.thumbs && (s.thumbs.max || s.thumbs.min));
      if (!k) return false; k.thumbs = { max: null, min: null };
    }
  }
  return false;
}
export const newId = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

export function toCSV(hist) {
  const rows = [['data', 'strona', 'zrodlo', 'plik', 'czas_s', 'maks_grzbietowe', 'maks_podeszwowe', 'zakres', 'powtorzenia', 'pacjent']];
  for (const h of hist) rows.push([h.ts, h.side, h.src, h.file || '', h.dur, h.ankle ? h.ankle.max : h.m.max, h.ankle ? h.ankle.min : h.m.min, h.ankle ? h.ankle.range : h.m.range, h.reps, h.client || '']);
  return rows.map(r => r.map(c => { const s = String(c ?? ''); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }).join(';')).join('\n');
}
/** import: akceptuje tablicę pomiarów albo { sessions: [...] }; łączy po id */
export function mergeImported(hist, text) {
  const j = JSON.parse(text); const arr = Array.isArray(j) ? j : j.sessions || j.hist || [];
  const ids = new Set(hist.map(h => h.id)); let n = 0;
  for (const s of arr) if (s && s.ts && s.m && !ids.has(s.id)) { hist.push(s); ids.add(s.id); n++ }
  hist.sort((a, b) => a.ts < b.ts ? -1 : 1); return n;
}

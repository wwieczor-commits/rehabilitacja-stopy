/* Rehabilitacja stopy – raport PDF (jsPDF, osadzone fonty Inter/Archivo), © Wojciech Wieczorek.
   Strona 1: pacjent, kluczowe wyniki, klatki z BIEŻĄCEGO filmu, wykres kąta w czasie, obserwacje.
   Strona 2: porównanie nogi zdrowej i kontuzjowanej, postępy, lista pomiarów, metodyka. */
import { abs, loadScript, dstr, sg, f0 } from './util.js';

const C = { dark: '#232222', teal: '#2EC4B6', tealD: '#12958A', tealL: '#E6F7F5', grey: '#6B7170', line: '#D5DCDA', bg: '#F2F4F3', L: '#12A89B', R: '#E39A0B', warn: '#C27A00' };
let libP;
export function loadPdfLib() {
  if (window.jspdf?.jsPDF && window.BRC_FONTS) return Promise.resolve();
  return libP || (libP = (async () => {
    if (!window.jspdf?.jsPDF) await loadScript(abs('assets/vendor/jspdf.umd.min.js'));
    if (!window.BRC_FONTS) await loadScript(abs('assets/vendor/report-fonts.js'));
  })().catch(e => { libP = null; throw e }));
}
const logoPng = () => new Promise(res => { const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); c.width = 1818; c.height = 468; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/png')) }; img.onerror = () => res(null); img.src = abs('assets/logo-bikerc.svg') });
const dayKey = iso => iso.slice(0, 10);
const sideName = s => s === 'L' ? 'lewa' : 'prawa';

function pline(doc, pts, col, w) {            // polilinia
  doc.setDrawColor(col); doc.setLineWidth(w);
  if (pts.length < 2) return; const l = []; for (let q = 1; q < pts.length; q++) l.push([pts[q][0] - pts[q - 1][0], pts[q][1] - pts[q - 1][1]]);
  doc.lines(l, pts[0][0], pts[0][1], [1, 1], 'S', false);
}

export function observations(hist, cur, injured) {
  const o = [], a = cur.ankle || cur.m;
  o.push({ k: a.max >= 15 ? 'ok' : 'info', t: `Maksymalne zgięcie grzbietowe w tym pomiarze: ${sg(a.max)}° (orientacyjnie dla zdrowej kostki ok. 20°).` });
  o.push({ k: -a.min >= 35 ? 'ok' : 'info', t: `Maksymalne zgięcie podeszwowe: ${sg(a.min)}° (orientacyjnie 40–50°). Całkowity zakres ruchu: ${f0(a.range)}° (orientacyjnie 60–70°). Wykonano powtórzeń: ${cur.reps}.` });
  if (cur.axisGuess) o.push({ k: 'warn', t: 'Oś goleni została oszacowana automatycznie (prostopadle do stopy). Wartości „+” i „−” oraz maksymalne zgięcia mogą być przesunięte – zakres ruchu i liczba powtórzeń nie zależą od tego ustawienia.' });
  if (cur.mode === 'manual') o.push({ k: 'info', t: 'Pomiar w trybie ręcznym: trzy punkty (goleń, kostka, palce) wskazano ręcznie i śledzono w filmie.' });
  if (cur.valid != null && cur.valid < .8) o.push({ k: 'warn', t: `Stopa była wyraźnie widoczna w ${Math.round(cur.valid * 100)}% klatek – pozostałe uzupełniono interpolacją. Dla dokładniejszych wyników ustaw kamerę prostopadle do stopy i zadbaj o światło.` });
  const same = hist.filter(h => h.side === cur.side && h.id !== cur.id);
  if (same.length) { const f = same[0], d = cur.m.range - f.m.range; o.push({ k: d >= 0 ? 'ok' : 'warn', t: `Strona ${sideName(cur.side)}: zmiana zakresu od pierwszego pomiaru (${dstr(f.ts)}) do tego (${dstr(cur.ts)}): ${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(0)}°.` }) }
  const cmp = compare(hist, injured); if (cmp && cmp.ratio != null) o.push({ k: cmp.deficit > 10 ? 'warn' : 'ok', t: `Zakres nogi po urazie to ${cmp.ratio.toFixed(0)}% zakresu nogi zdrowej (deficyt ${Math.max(0, cmp.deficit).toFixed(0)}%).` });
  if (cur.dur < 6) o.push({ k: 'warn', t: `Pomiar był krótki (${cur.dur.toFixed(0)} s) – wyniki mogą nie być reprezentatywne.` });
  return o;
}
/** ostatni pomiar każdej strony (ćwiczenie „pump” albo dowolne zgodne) */
export function compare(hist, injured) {
  const last = s => hist.filter(h => h.side === s && (h.ankle || h.m)).pop();
  const L = last('L'), R = last('R'); if (!L || !R) return null;
  const inj = injured === 'L' ? L : R, hea = injured === 'L' ? R : L;
  const g = h => h.ankle || h.m;
  const rows = [['Zakres ruchu', g(L).range, g(R).range], ['Maks. grzbietowe', g(L).max, g(R).max], ['Maks. podeszwowe', -g(L).min, -g(R).min]].map(([n, l, r]) => {
    const hl = injured === 'L' ? r : l, il = injured === 'L' ? l : r; return { n, l, r, diff: r - l, pct: hl > 1 ? (hl - il) / hl * 100 : null };
  });
  const rh = g(hea).range, ri = g(inj).range;
  return { rows, L, R, ratio: rh > 1 ? ri / rh * 100 : null, deficit: rh > 1 ? (rh - ri) / rh * 100 : 0 };
}

export async function buildReport({ cur, hist, injured, client, version }) {
  await loadPdfLib(); const logo = await logoPng();
  const { jsPDF } = window.jspdf, doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true }), F = window.BRC_FONTS;
  doc.addFileToVFS('Inter-Regular.ttf', F.inter); doc.addFont('Inter-Regular.ttf', 'Inter', 'normal'); doc.addFileToVFS('Inter-Bold.ttf', F.interBold); doc.addFont('Inter-Bold.ttf', 'Inter', 'bold');
  doc.addFileToVFS('Archivo-BlackItalic.ttf', F.archivoBlackItalic); doc.addFont('Archivo-BlackItalic.ttf', 'Archivo', 'italic'); doc.addFileToVFS('Archivo-Bold.ttf', F.archivoBold); doc.addFont('Archivo-Bold.ttf', 'Archivo', 'bold');
  const PW = 210, PH = 297, M = 15, CW = PW - 2 * M;
  const all = hist.slice(); if (!all.some(h => h.id === cur.id)) all.push(cur); all.sort((a, b) => a.ts < b.ts ? -1 : 1);
  const txt = (s, x, y, o) => doc.text(Array.isArray(s) ? s : String(s), x, y, o);
  const font = (f, st, sz, col) => { doc.setFont(f, st); doc.setFontSize(sz); doc.setTextColor(col || C.dark) };
  const section = (title, y) => { if (y > PH - 40) { doc.addPage(); y = 20 } font('Archivo', 'bold', 10.5); txt(title.toUpperCase(), M, y); doc.setDrawColor(C.teal); doc.setLineWidth(.7); doc.line(M, y + 1.8, M + 10, y + 1.8); doc.setDrawColor(C.line); doc.setLineWidth(.2); doc.line(M + 10, y + 1.8, PW - M, y + 1.8); return y + 7 };
  const a = cur.ankle || cur.m;

  /* nagłówek */
  if (logo) doc.addImage(logo, 'PNG', M, 11, 46, 46 * 468 / 1818); else { font('Archivo', 'italic', 22, C.teal); txt('BikeRc', M, 20) }
  font('Archivo', 'italic', 20); txt('Raport rehabilitacji stopy', PW - M, 18, { align: 'right' });
  font('Inter', 'normal', 9, C.grey); txt('Pomiar zakresu ruchu stawu skokowego (kostki) z filmu lub kamery', PW - M, 24.5, { align: 'right' });
  doc.setFillColor(C.teal); doc.rect(M, 30, CW, 1.2, 'F'); let y = 37;
  const days = new Set(all.map(h => dayKey(h.ts))).size;
  const info = [['Pacjent', client || '—'], ['Data pomiaru', dstr(cur.ts, 1)], ['Strona', sideName(cur.side) + (cur.side === injured ? ' (po urazie)' : ' (zdrowa)')], ['Źródło', cur.src === 'cam' ? 'kamera na żywo' : 'film: ' + (cur.file || '—')], ['Czas / klatki', `${cur.dur.toFixed(1)} s · ${cur.n} próbek`], ['Historia', `${all.length} pomiarów (${days} dni)`]];
  const cw = CW / 3; doc.setFillColor(C.bg); doc.roundedRect(M, y, CW, 30, 2, 2, 'F');
  info.forEach((it, i) => { const cx = M + 5 + (i % 3) * cw, cy = y + 7 + Math.floor(i / 3) * 14; font('Inter', 'bold', 7, C.grey); txt(it[0].toUpperCase(), cx, cy); font('Inter', 'bold', 9.2); let l = doc.splitTextToSize(it[1], cw - 7); if (l.length > 1) { font('Inter', 'bold', 7.6); l = doc.splitTextToSize(it[1], cw - 7) } txt(l.slice(0, 2), cx, cy + 5) });
  y += 30 + 7;

  /* kluczowe wyniki */
  y = section('Kluczowe wyniki tego pomiaru', y);
  const kp = [['Maks. zgięcie grzbietowe', sg(a.max) + '°', 'orient. ok. +20°'], ['Maks. zgięcie podeszwowe', sg(a.min) + '°', 'orient. −40…−50°'], ['Zakres ruchu', f0(a.range) + '°', `${sg(a.min)}° … ${sg(a.max)}°`], ['Powtórzenia', String(cur.reps), `w ${cur.dur.toFixed(0)} s`]];
  const kw = (CW - 12) / 4; kp.forEach((k, i) => { const x0 = M + i * (kw + 4); doc.setFillColor('#FFFFFF'); doc.setDrawColor(C.line); doc.setLineWidth(.3); doc.roundedRect(x0, y, kw, 24, 2, 2, 'FD'); doc.setFillColor(C.teal); doc.rect(x0, y + 3, 1.2, 18, 'F'); font('Inter', 'bold', 6.4, C.grey); txt(doc.splitTextToSize(k[0].toUpperCase(), kw - 6)[0], x0 + 4, y + 6.5); font('Archivo', 'italic', 20); txt(k[1], x0 + 4, y + 15.5); font('Inter', 'normal', 7.3, C.grey); txt(k[2], x0 + 4, y + 20.5) });
  y += 24 + 8;

  /* klatki */
  y = section('Klatki z tego filmu – skrajne położenia stopy', y);
  const th = [['max', 'Maks. zgięcie grzbietowe'], ['min', 'Maks. zgięcie podeszwowe']].filter(([k]) => cur.thumbs && cur.thumbs[k]);
  if (th.length) {
    const gap = 6, iw = (CW - gap) / 2, ar = cur.ar || 16 / 9, maxH = 56; let w = iw, h = iw / ar; if (h > maxH) { h = maxH; w = h * ar }
    th.forEach(([k, title], i) => { const c = cur.thumbs[k], x0 = M + i * (iw + gap) + (iw - w) / 2; doc.setDrawColor(C.line); doc.setLineWidth(.3); doc.addImage(c.img, 'JPEG', x0, y, w, h, undefined, 'FAST'); doc.rect(x0, y, w, h, 'S'); font('Inter', 'bold', 8.5); txt(`${title}: ${sg(c.v)}°`, M + i * (iw + gap), y + h + 5); font('Inter', 'normal', 7.5, C.grey); txt(`klatka z ${c.t.toFixed(1)} s ${cur.src === 'file' ? 'filmu' : 'pomiaru'}`, M + i * (iw + gap), y + h + 9.2) });
    y += h + 14;
  } else { font('Inter', 'normal', 9, C.grey); txt('Brak klatek (nie udało się ich zapisać).', M, y + 4); y += 10 }

  /* wykres kąta w czasie */
  y = section('Kąt kostki w czasie (+ grzbietowe, − podeszwowe)', y);
  { const px = M + 10, py = y + 2, pw = CW - 12, ph = 44, pts = cur.series || [];
    doc.setFillColor('#FFFFFF'); doc.setDrawColor(C.line); doc.setLineWidth(.25); doc.rect(px, py, pw, ph, 'FD');
    if (pts.length > 1) {
      const dur = Math.max(1, pts[pts.length - 1][0]); let lo = Math.min(-45, ...pts.map(p => p[1])), hi = Math.max(22, ...pts.map(p => p[1])); lo = Math.floor((lo - 4) / 10) * 10; hi = Math.ceil((hi + 4) / 10) * 10;
      const X = t => px + t / dur * pw, Y = v => py + ph - (v - lo) / (hi - lo) * ph;
      doc.saveGraphicsState(); doc.setGState(new doc.GState({ opacity: .16 })); doc.setFillColor(C.teal); doc.rect(px, Y(Math.min(20, hi)), pw, Y(0) - Y(Math.min(20, hi)), 'F'); doc.setFillColor('#FEDA75'); doc.rect(px, Y(-40), pw, Y(-50) - Y(-40), 'F'); doc.restoreGraphicsState();
      font('Inter', 'normal', 6.6, C.grey); doc.setDrawColor('#E6EAE9'); doc.setLineWidth(.12); const st = (hi - lo) > 60 ? 20 : 10;
      for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) { doc.line(px, Y(v), px + pw, Y(v)); txt((v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + '°', px - 1.5, Y(v) + 1.2, { align: 'right' }) }
      const nt = Math.min(7, Math.max(2, Math.round(dur / 3) + 1)); for (let k = 0; k < nt; k++) { const t = dur * k / (nt - 1); txt(t.toFixed(dur < 20 ? 1 : 0) + ' s', X(t), py + ph + 3.6, { align: 'center' }) }
      pline(doc, pts.map(p => [X(p[0]), Y(p[1])]), cur.side === 'L' ? C.L : C.R, .5);
      for (const k of ['max', 'min']) { const c = cur.thumbs && cur.thumbs[k]; if (c) { doc.setFillColor(C.dark); doc.circle(X(c.t), Y(c.v), 1, 'F') } }
      font('Inter', 'normal', 6.4, C.tealD); txt('pasmo zielone: 0…+20° (orient.); żółte: −40…−50° (orient.); kropki: klatki powyżej', px + 2, py + 3.6);
    }
    y += ph + 11; }

  /* obserwacje */
  y = section('Obserwacje automatyczne (orientacyjne)', y); const colOf = { ok: C.tealD, warn: C.warn, info: C.grey };
  for (const o of observations(all, cur, injured)) { const lines = doc.splitTextToSize(o.t, CW - 8), h = lines.length * 4.1; if (y + h > PH - 24) { doc.addPage(); y = 20 } doc.setFillColor(colOf[o.k]); doc.circle(M + 1.5, y - 1.1, 1.1, 'F'); font('Inter', 'normal', 8.8); txt(lines, M + 6, y); y += h + 2.4 }

  /* porównanie */
  doc.addPage(); y = 20;
  y = section('Porównanie: noga zdrowa i po urazie', y);
  const cmp = compare(all, injured);
  if (cmp) {
    const cs = [['Wskaźnik', 56, 'l'], ['Lewa' + (injured === 'L' ? ' (uraz)' : ''), 36, 'r'], ['Prawa' + (injured === 'R' ? ' (uraz)' : ''), 36, 'r'], ['Różnica P−L', 26, 'r'], ['Deficyt', 26, 'r']], sw = cs.reduce((s, c) => s + c[1], 0), k = CW / sw, xs = []; let ax = M; cs.forEach(c => { xs.push(ax); ax += c[1] * k }); const cr = i => xs[i] + cs[i][1] * k - 2;
    doc.setFillColor(C.dark); doc.rect(M, y, CW, 6, 'F'); font('Inter', 'bold', 7.2, '#FFFFFF'); cs.forEach((c, i) => c[2] === 'l' ? txt(c[0].toUpperCase(), xs[i] + 2, y + 4.2) : txt(c[0].toUpperCase(), cr(i), y + 4.2, { align: 'right' })); y += 6;
    cmp.rows.forEach((r, ri) => { if (ri % 2) { doc.setFillColor('#FAFBFA'); doc.rect(M, y, CW, 7, 'F') } font('Inter', 'bold', 9); txt(r.n, xs[0] + 2, y + 4.8); txt(r.l.toFixed(0) + '°', cr(1), y + 4.8, { align: 'right' }); txt(r.r.toFixed(0) + '°', cr(2), y + 4.8, { align: 'right' }); font('Inter', 'normal', 9); txt((r.diff > .5 ? '+' : r.diff < -.5 ? '−' : '') + Math.abs(r.diff).toFixed(0) + '°', cr(3), y + 4.8, { align: 'right' }); doc.setTextColor(r.pct != null && r.pct > 10 ? C.warn : C.dark); txt(r.pct == null ? '–' : (r.pct < -.5 ? '+' + Math.abs(r.pct).toFixed(0) : Math.max(0, r.pct).toFixed(0)) + '%', cr(4), y + 4.8, { align: 'right' }); doc.setDrawColor(C.line); doc.setLineWidth(.15); doc.line(M, y + 7, M + CW, y + 7); y += 7 });
    font('Inter', 'normal', 7.6, C.grey); const tl = doc.splitTextToSize((cmp.ratio == null ? '' : `Zakres nogi po urazie to ${cmp.ratio.toFixed(0)}% zakresu nogi zdrowej. `) + 'Deficyt = (zdrowa − po urazie) / zdrowa; wartości z ostatniego zapisanego pomiaru każdej strony (' + dstr(cmp.L.ts) + ' / ' + dstr(cmp.R.ts) + ').', CW); txt(tl, M, y + 4.5); y += 4.5 + tl.length * 3.5 + 6;
  } else { font('Inter', 'normal', 9, C.grey); txt(doc.splitTextToSize('Brak pomiarów obu stron – nagraj zdrową i kontuzjowaną nogę w takim samym ustawieniu kamery, aby zobaczyć porównanie.', CW), M, y + 3); y += 13 }

  /* postępy */
  y = section('Postępy – zakres ruchu w kolejnych pomiarach', y);
  { const px = M + 10, py = y + 2, pw = CW - 12, ph = 44; doc.setFillColor('#FFFFFF'); doc.setDrawColor(C.line); doc.setLineWidth(.25); doc.rect(px, py, pw, ph, 'FD');
    const bySide = { L: all.filter(h => h.side === 'L'), R: all.filter(h => h.side === 'R') }, n = all.length;
    if (n >= 2) {
      const rng = h => (h.ankle || h.m).range, hiV = Math.max(70, ...all.map(rng)), X = i => px + 4 + (n === 1 ? .5 : i / (n - 1)) * (pw - 8), Y = v => py + ph - 4 - v / hiV * (ph - 10);
      font('Inter', 'normal', 6.6, C.grey); doc.setDrawColor('#E6EAE9'); doc.setLineWidth(.12); for (let v = 0; v <= hiV; v += 20) { doc.line(px, Y(v), px + pw, Y(v)); txt(v + '°', px - 1.5, Y(v) + 1.2, { align: 'right' }) }
      doc.setDrawColor(C.tealD); doc.setLineWidth(.25); doc.setLineDashPattern?.([1.5, 1.5], 0); doc.line(px, Y(65), px + pw, Y(65)); doc.setLineDashPattern?.([], 0); font('Inter', 'normal', 6.6, C.tealD); txt('orientacyjnie 60–70° (zdrowy staw)', px + 2, Y(65) - 1.2);
      for (const sd of ['L', 'R']) { const pts = all.map((h, i) => h.side === sd ? [X(i), Y(rng(h)), rng(h)] : null).filter(Boolean); if (!pts.length) continue; pline(doc, pts, sd === 'L' ? C.L : C.R, .6); doc.setFillColor(sd === 'L' ? C.L : C.R); pts.forEach(p => doc.circle(p[0], p[1], .9, 'F')); const lp = pts[pts.length - 1]; font('Inter', 'bold', 7.2); txt(lp[2].toFixed(0) + '°', lp[0], lp[1] - 2, { align: 'center' }) }
      font('Inter', 'normal', 7, C.grey); [['L', 'lewa'], ['R', 'prawa']].forEach(([sd, nm], i) => { if (!bySide[sd].length) return; doc.setFillColor(sd === 'L' ? C.L : C.R); doc.rect(px + 2 + i * 30, py + ph + 3, 5, 1.2, 'F'); txt(nm, px + 8.5 + i * 30, py + ph + 4.2) });
    } else { font('Inter', 'normal', 8.5, C.grey); txt('Wykres postępów pojawi się po zapisaniu co najmniej dwóch pomiarów.', px + pw / 2, py + ph / 2, { align: 'center' }) }
    y += ph + 12; }

  /* lista pomiarów */
  y = section('Pomiary (od najnowszego)', y);
  const sc = [['Data', 32, 'l'], ['Str.', 12, 'l'], ['Min…max', 38, 'r'], ['Zakres', 22, 'r'], ['Powt.', 16, 'r'], ['Źródło', 40, 'r']], sw2 = sc.reduce((s, c) => s + c[1], 0), k2 = CW / sw2, xs2 = []; let ax2 = M; sc.forEach(c => { xs2.push(ax2); ax2 += c[1] * k2 }); const cr2 = i => xs2[i] + sc[i][1] * k2 - 2;
  const head = yy => { doc.setFillColor(C.dark); doc.rect(M, yy, CW, 6, 'F'); font('Inter', 'bold', 7.2, '#FFFFFF'); sc.forEach((c, i) => c[2] === 'l' ? txt(c[0].toUpperCase(), xs2[i] + 2, yy + 4.2) : txt(c[0].toUpperCase(), cr2(i), yy + 4.2, { align: 'right' })); return yy + 6 };
  y = head(y);
  [...all].reverse().slice(0, 40).forEach((s, ri) => { if (y > PH - 40) { doc.addPage(); y = head(20) } const g = s.ankle || s.m; if (ri % 2) { doc.setFillColor('#FAFBFA'); doc.rect(M, y, CW, 6.2, 'F') } font('Inter', 'normal', 8.4); txt(dstr(s.ts, 1), xs2[0] + 2, y + 4.4); doc.setFillColor(s.side === 'L' ? C.L : C.R); doc.rect(xs2[1] + 2, y + 1.3, 3.2, 3.2, 'F'); txt(s.side === 'L' ? 'L' : 'P', xs2[1] + 6.4, y + 4.4); txt(`${sg(g.min)}…${sg(g.max)}°`, cr2(2), y + 4.4, { align: 'right' }); font('Inter', 'bold', 8.6); txt(g.range.toFixed(0) + '°', cr2(3), y + 4.4, { align: 'right' }); font('Inter', 'normal', 8.4); txt(String(s.reps ?? '–'), cr2(4), y + 4.4, { align: 'right' }); txt(s.src === 'cam' ? 'kamera' : 'film', cr2(5), y + 4.4, { align: 'right' }); doc.setDrawColor(C.line); doc.setLineWidth(.12); doc.line(M, y + 6.2, M + CW, y + 6.2); y += 6.2 });
  y += 9;

  /* metodyka */
  if (y > PH - 70) { doc.addPage(); y = 20 }
  y = section('Metodyka i zastrzeżenie', y); font('Inter', 'normal', 8, C.grey);
  const meth = 'Stopę i kostkę wykrywa lokalnie w przeglądarce model RTMW-m (133 punkty ciała, w tym pięta i palce stopy), uruchamiany na kolejnych klatkach filmu; obraz nie jest nigdzie wysyłany. Kąt kostki to kąt między osią stopy (pięta–palec I) a osią goleni w płaszczyźnie obrazu (2D), względem pozycji neutralnej (stopa prostopadła do goleni = 0°): „+” oznacza zgięcie grzbietowe, „−” podeszwowe. Zakres i powtórzenia liczone są z wygładzonego przebiegu kąta. Dokładność zależy od ustawienia kamery (prostopadle do płaszczyzny ruchu), światła i widoczności stopy – pomiar nie zastępuje goniometru.';
  const ml = doc.splitTextToSize(meth, CW); txt(ml, M, y); y += ml.length * 3.6 + 3;
  const dl = doc.splitTextToSize('To narzędzie orientacyjne – wynik nie jest diagnozą medyczną ani oceną stanu zdrowia. Zakres i rodzaj ćwiczeń oraz decyzje dotyczące rehabilitacji należy skonsultować z fizjoterapeutą lub lekarzem prowadzącym.', CW - 12);
  doc.setFillColor('#FFF6DD'); doc.roundedRect(M, y, CW, dl.length * 4 + 7, 2, 2, 'F'); font('Inter', 'bold', 8.4, '#7A5A00'); txt(dl, M + 5, y + 6);

  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setDrawColor(C.line); doc.setLineWidth(.2); doc.line(M, PH - 17, PW - M, PH - 17); font('Inter', 'normal', 6.8, C.grey); txt('Wartości orientacyjne, generowane automatycznie – nie stanowią diagnozy medycznej. Skonsultuj ćwiczenia z fizjoterapeutą.', M, PH - 12.5); font('Inter', 'bold', 8, C.tealD); txt('© Wojciech Wieczorek', M, PH - 7); const w = doc.getTextWidth('© Wojciech Wieczorek'); font('Inter', 'normal', 8, C.grey); txt('· Rehabilitacja stopy ' + (version || ''), M + w + 2.2, PH - 7); txt(`Strona ${i} z ${n}`, PW - M, PH - 7, { align: 'right' }) }
  doc.setProperties({ title: 'Raport rehabilitacji stopy' + (client ? ' – ' + client : ''), author: 'Wojciech Wieczorek', subject: 'Zakres ruchu stawu skokowego', creator: 'Rehabilitacja stopy – Wojciech Wieczorek' });
  return doc.output('blob');
}

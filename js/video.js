/* Rehabilitacja stopy – wczytywanie filmów (© Wojciech Wieczorek).
   Zasady: (1) film jest zawsze w DOM i wyciszony (wymóg iOS), (2) klatki pobieramy DETERMINISTYCZNIE:
   seek → „seeked” → klatka gotowa → drawImage (a nie z odtwarzania w czasie rzeczywistym),
   (3) gdy przeglądarka nie potrafi zdekodować pliku (np. HEVC w Chrome bez sprzętowego dekodera),
   film jest automatycznie konwertowany do H.264 w przeglądarce (ffmpeg.wasm, ładowany dopiero wtedy). */
import { clamp, sleep, abs } from './util.js';

export class VideoError extends Error { constructor(code, msg) { super(msg); this.code = code } }

const withTimeout = (p, ms, code, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new VideoError(code, msg)), ms))]);

export class VideoSource {
  constructor(el) {
    this.el = el; this.url = null; this.rotQ = 0; this.converted = false; this.name = ''; this.file = null;
    this.work = document.createElement('canvas'); this.wctx = this.work.getContext('2d', { willReadFrequently: true });
    el.muted = true; el.defaultMuted = true; el.playsInline = true; el.setAttribute('playsinline', ''); el.setAttribute('webkit-playsinline', ''); el.preload = 'auto'; el.controls = false;
  }
  get dur() { return this.el.duration }
  get w() { return this.rotQ % 2 ? this.el.videoHeight : this.el.videoWidth }
  get h() { return this.rotQ % 2 ? this.el.videoWidth : this.el.videoHeight }
  close() { try { this.el.pause() } catch (_) { } this.el.removeAttribute('src'); this.el.load(); if (this.url) { URL.revokeObjectURL(this.url); this.url = null } }

  /** Otwiera plik. onStatus(tekst, postęp 0..1|null). Zwraca info. */
  async open(file, onStatus = () => { }) {
    this.close(); this.file = file; this.name = file.name || 'film'; this.converted = false; this.rotQ = 0; this.log = [];
    try {
      await this._load(file); await this._probe();
    } catch (e) {
      if (!(e instanceof VideoError) || !['unsupported', 'empty'].includes(e.code)) throw e;
      this.log.push('Natywne odtwarzanie nie powiodło się: ' + e.message);
      onStatus('Ta przeglądarka nie odtwarza tego formatu (np. HEVC/H.265). Konwertuję film do H.264 – to zajmie chwilę…', 0);
      const { convertToMp4 } = await import('./convert.js');
      let out;
      try { out = await convertToMp4(file, onStatus, this.log) }
      catch (ce) { throw new VideoError('convert-failed', 'Nie udało się przekonwertować filmu: ' + (ce && ce.message || ce)) }
      await this._load(out); await this._probe(); this.converted = true;
    }
    return { w: this.w, h: this.h, dur: this.dur, converted: this.converted };
  }

  async _load(file) {
    const v = this.el;
    if (this.url) URL.revokeObjectURL(this.url);
    v.removeAttribute('src'); v.load();
    this.url = URL.createObjectURL(file);
    const meta = new Promise((res, rej) => {
      const ok = () => { v.removeEventListener('error', bad); res() };
      const bad = () => { v.removeEventListener('loadedmetadata', ok); const c = v.error ? v.error.code : 0; rej(new VideoError('unsupported', 'Błąd odtwarzacza (kod ' + c + ')')) };
      v.addEventListener('loadedmetadata', ok, { once: true }); v.addEventListener('error', bad, { once: true });
    });
    v.src = this.url; v.load();
    await withTimeout(meta, 25000, 'timeout', 'Przeglądarka nie wczytała filmu w 25 s');
    if (!v.videoWidth || !v.videoHeight) throw new VideoError('unsupported', 'Brak dekodowalnej ścieżki wideo');
    if (!isFinite(v.duration)) {                                   // np. WebM z MediaRecorder bez czasu trwania
      await new Promise(r => { const f = () => { v.removeEventListener('timeupdate', f); v.currentTime = 0; r() }; v.addEventListener('timeupdate', f); v.currentTime = 1e6; setTimeout(f, 3000) });
    }
    // iOS (tryb oszczędzania energii) nie ładuje klatek bez próby odtworzenia – krótka próba wyciszonego play/pause
    try { await withTimeout(v.play(), 1500, 'timeout', 'play'); v.pause() } catch (_) { try { v.pause() } catch (__) { } }
    if (v.readyState < 2) await withTimeout(new Promise(r => { const f = () => { if (v.readyState >= 2) { v.removeEventListener('loadeddata', f); v.removeEventListener('canplay', f); r() } }; v.addEventListener('loadeddata', f); v.addEventListener('canplay', f) }), 8000, 'unsupported', 'Brak danych klatek');
  }

  /** Czy klatki naprawdę się dekodują (nie same czarne/identyczne)? */
  async _probe() {
    const v = this.el, d = v.duration;
    if (!(d > 0.2)) throw new VideoError('empty', 'Film ma zerową długość');
    const sig = [];
    for (const t of [0.05, d * .5, Math.max(0.05, d - 0.3)]) {
      await this.seek(t); this.wctx.canvas.width = 32; this.wctx.canvas.height = 32; this.wctx.drawImage(v, 0, 0, 32, 32);
      const px = this.wctx.getImageData(0, 0, 32, 32).data; let s = 0, s2 = 0; for (let i = 0; i < px.length; i += 4) { const y = px[i] * .3 + px[i + 1] * .59 + px[i + 2] * .11; s += y; s2 += y * y }
      const n = px.length / 4, m = s / n; sig.push({ m, sd: Math.sqrt(Math.max(0, s2 / n - m * m)) });
    }
    if (sig.every(x => x.sd < 1.5 && x.m < 6)) throw new VideoError('empty', 'Klatki są puste (dekoder nie zwrócił obrazu)');
    await this.seek(0.05);
  }

  /** Deterministyczne przewinięcie: czeka na „seeked” i na prezentację klatki. */
  async seek(t) {
    const v = this.el, d = v.duration || 0; t = clamp(t, 0, Math.max(0, d - 0.02));
    let frame = Promise.resolve();
    if (v.requestVideoFrameCallback) frame = new Promise(r => v.requestVideoFrameCallback(() => r()));
    if (Math.abs(v.currentTime - t) > 0.0005 || v.seeking) {
      await new Promise(res => {
        let done = false; const fin = () => { if (done) return; done = true; v.removeEventListener('seeked', fin); clearTimeout(to); res() };
        const to = setTimeout(fin, 6000); v.addEventListener('seeked', fin); v.currentTime = t;
      });
      await Promise.race([frame, sleep(70)]);
    }
    if (v.readyState < 2) await Promise.race([new Promise(r => v.addEventListener('loadeddata', r, { once: true })), sleep(1500)]);
  }

  /** Rysuje bieżącą klatkę (z obrotem rotQ·90°) do canvas, długi bok ≤ maxSide. Zwraca canvas. */
  grab(canvas, maxSide = 1280) {
    const v = this.el, q = this.rotQ, vw = v.videoWidth, vh = v.videoHeight, ow = this.w, oh = this.h, sc = Math.min(1, maxSide / Math.max(ow, oh));
    const W = Math.max(2, Math.round(ow * sc)), H = Math.max(2, Math.round(oh * sc));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H }
    const c = canvas.getContext('2d', { willReadFrequently: true });
    c.setTransform(1, 0, 0, 1, 0, 0); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.translate(W / 2, H / 2); c.rotate(q * Math.PI / 2); c.scale(sc, sc); c.drawImage(v, -vw / 2, -vh / 2, vw, vh);
    c.setTransform(1, 0, 0, 1, 0, 0);
    return canvas;
  }
}

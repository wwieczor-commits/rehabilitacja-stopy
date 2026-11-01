/* Rehabilitacja stopy – awaryjna konwersja filmu do H.264 w przeglądarce (ffmpeg.wasm, jednowątkowy rdzeń).
   Ładowana dopiero wtedy, gdy przeglądarka nie potrafi odtworzyć pliku (np. HEVC/H.265 w Chrome/Windows). © Wojciech Wieczorek */
import { abs, clamp } from './util.js';

export async function convertToMp4(file, onStatus = () => { }, log = []) {
  onStatus('Wczytuję konwerter wideo (jednorazowo, ok. 31 MB)…', 0);
  const { FFmpeg } = await import(abs('assets/ffmpeg/index.js'));
  const ff = new FFmpeg(); const tail = [];
  ff.on('log', ({ message }) => { tail.push(message); if (tail.length > 40) tail.shift() });
  ff.on('progress', ({ progress }) => { if (isFinite(progress)) onStatus('Konwertuję film do H.264…', clamp(progress, 0, 1)) });
  await ff.load({ coreURL: abs('assets/ffmpeg/ffmpeg-core.js'), wasmURL: abs('assets/ffmpeg/ffmpeg-core.wasm') });
  onStatus('Konwertuję film do H.264…', 0);
  const ext = (file.name.match(/\.[a-z0-9]+$/i) || ['.mov'])[0].toLowerCase();
  const inName = 'in' + ext, outName = 'out.mp4';
  let mounted = false;
  try {
    await ff.createDir('/in'); await ff.mount('WORKERFS', { files: [new File([file], inName)] }, '/in'); mounted = true;
  } catch (e) {
    log.push('WORKERFS niedostępny, kopiuję plik do pamięci: ' + e);
    await ff.writeFile(inName, new Uint8Array(await file.arrayBuffer()));
  }
  // dłuższy bok ≤ 960 px, ≤ 30 kl./s, bez dźwięku; ffmpeg sam uwzględnia obrót z metadanych (autorotate)
  const vf = "scale='if(gt(iw,ih),min(960,iw),-2)':'if(gt(iw,ih),-2,min(960,ih))',fps=30,format=yuv420p";
  const code = await ff.exec(['-i', mounted ? '/in/' + inName : inName, '-an', '-vf', vf, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '27', '-movflags', '+faststart', outName]);
  log.push('ffmpeg: ' + tail.slice(-6).join(' | '));
  if (code !== 0) throw new Error('ffmpeg zakończył się kodem ' + code + ' (' + tail.slice(-3).join(' ') + ')');
  const data = await ff.readFile(outName);
  try { ff.terminate() } catch (_) { }
  if (!data || data.length < 1000) throw new Error('pusty plik wynikowy');
  return new File([data.buffer ? data : new Uint8Array(data)], (file.name || 'film').replace(/\.[^.]+$/, '') + '-h264.mp4', { type: 'video/mp4' });
}

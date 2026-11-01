"""Generuje syntetyczny film testowy (rysowana goleń i stopa, ruch ±20° wokół kostki, 4 powtórzenia w 7 s).
Prawdziwy zakres ruchu = 40°. Nie zawiera żadnych prywatnych nagrań.
Użycie: python3 make_synth.py wyjście.mp4 [landscape|portrait] [rot90]"""
import sys, math, subprocess, numpy as np
from PIL import Image, ImageDraw, ImageFilter
out = sys.argv[1]; mode = sys.argv[2] if len(sys.argv) > 2 else 'landscape'
W, H = (960, 540) if mode == 'landscape' else (540, 960); FPS, DUR = 20, 7
rng = np.random.default_rng(3); tex = rng.normal(0, 9, (H, W, 1)); skin = np.array([226, 178, 144])
bg = np.zeros((H, W, 3)); yy = np.linspace(0, 1, H)[:, None, None]; bg = bg + (60 + 50 * yy) + rng.normal(0, 6, (H, W, 3)); bg[..., 2] += 10
bg_big = np.kron(bg, np.ones((2, 2, 1)))
TEX = rng.normal(0, 14, (H * 2, W * 2, 1))
def layer(mask):
    m = np.array(mask)[..., None] / 255.0
    rgb = np.clip(skin * (1 - 0.18 * np.linspace(0, 1, W * 2)[None, :, None]) + TEX, 0, 255)
    return Image.fromarray(np.concatenate([rgb, m * 255], 2).astype('uint8'), 'RGBA')
def frame(t):
    a = 20 * math.sin(2 * math.pi * t / 1.75)
    w, h = W * 2, H * 2; ank = (w * .5, h * .62)
    m = Image.new('L', (w, h), 0); d = ImageDraw.Draw(m)
    d.rounded_rectangle([ank[0] - 70, h * .02, ank[0] + 40, ank[1] + 10], 40, fill=255)
    f = Image.new('L', (w, h), 0); e = ImageDraw.Draw(f)
    e.polygon([(ank[0] - 40, ank[1] - 60), (ank[0] + 20, ank[1] - 70), (ank[0] + 150, ank[1] + 5), (ank[0] + 330, ank[1] + 40),
               (ank[0] + 350, ank[1] + 80), (ank[0] + 300, ank[1] + 100), (ank[0] - 50, ank[1] + 105), (ank[0] - 100, ank[1] + 40)], fill=255)
    for k in range(5): e.ellipse([ank[0] + 290 + k * 6, ank[1] + 40 + k * 10, ank[0] + 360 + k * 2, ank[1] + 80 + k * 10], fill=255)
    base = Image.fromarray((np.clip(bg_big, 0, 255)).astype('uint8')).convert('RGBA')
    base.alpha_composite(layer(m))
    fl = layer(f).rotate(-a, center=ank, resample=Image.BICUBIC)
    base.alpha_composite(fl)
    return base.convert('RGB').resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(.6))
p = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', out] , stdin=subprocess.PIPE)
for i in range(FPS * DUR): p.stdin.write(np.array(frame(i / FPS)).tobytes())
p.stdin.close(); p.wait()

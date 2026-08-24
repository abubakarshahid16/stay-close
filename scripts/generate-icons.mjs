/**
 * Generates every app icon from the one real piece of artwork in the repo.
 *
 * WHY this exists: assets/icon.png was a 48x48 image containing a single
 * colour — a flat blue square. It was the source for the Android launcher
 * icon AND for both PWA icons, so the installed app and the home-screen
 * shortcut both showed a blank square. assets/favicon.png (192x192, 299
 * distinct colours) was the only genuine logo in the tree.
 *
 * Icons are generated rather than committed as opaque binaries so the
 * relationship between them stays visible and re-derivable.
 *
 * pngjs is used because it is already present; no new dependency is added.
 * Resampling is bilinear, which is adequate here: the source is 192px and
 * every consumer scales back DOWN to a launcher size (48-192px), so the
 * intermediate upscale is not what the user ends up looking at.
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';

const SOURCE = 'assets/favicon.png';
const source = PNG.sync.read(readFileSync(SOURCE));

/** Bilinear sample of `src` at normalised position, returned as RGBA. */
function sample(src, fx, fy) {
  const x = Math.min(src.width - 1, Math.max(0, fx));
  const y = Math.min(src.height - 1, Math.max(0, fy));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(src.width - 1, x0 + 1), y1 = Math.min(src.height - 1, y0 + 1);
  const dx = x - x0, dy = y - y0;

  const out = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const p00 = src.data[(y0 * src.width + x0) * 4 + c];
    const p10 = src.data[(y0 * src.width + x1) * 4 + c];
    const p01 = src.data[(y1 * src.width + x0) * 4 + c];
    const p11 = src.data[(y1 * src.width + x1) * 4 + c];
    out[c] = p00 * (1 - dx) * (1 - dy) + p10 * dx * (1 - dy) + p01 * (1 - dx) * dy + p11 * dx * dy;
  }
  return out;
}

/**
 * Draw the logo onto a square canvas.
 *
 * @param size   canvas edge length
 * @param scale  fraction of the canvas the logo occupies (Android adaptive
 *               icons crop to a circle, so the logo must sit inside a safe
 *               zone rather than run edge to edge)
 * @param bg     [r,g,b,a] background; iOS forbids alpha in app icons, so
 *               those variants are flattened onto white
 */
function render(size, scale, bg) {
  const png = new PNG({ width: size, height: size });
  const box = Math.round(size * scale);
  const offset = Math.round((size - box) / 2);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let [r, g, b, a] = bg;

      const lx = x - offset, ly = y - offset;
      if (lx >= 0 && ly >= 0 && lx < box && ly < box) {
        const [sr, sg, sb, sa] = sample(source, (lx * source.width) / box, (ly * source.height) / box);
        const alpha = sa / 255;
        // Source-over composite of the logo onto the background.
        r = sr * alpha + r * (1 - alpha);
        g = sg * alpha + g * (1 - alpha);
        b = sb * alpha + b * (1 - alpha);
        a = Math.max(a, sa);
      }

      png.data[i] = Math.round(r);
      png.data[i + 1] = Math.round(g);
      png.data[i + 2] = Math.round(b);
      png.data[i + 3] = Math.round(a);
    }
  }
  return PNG.sync.write(png);
}

const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

const OUTPUTS = [
  // Native app icon. Flattened onto white because iOS rejects alpha.
  ['assets/icon.png', 1024, 1.0, WHITE],
  // Android adaptive foreground: inset so the circular mask cannot clip it.
  ['assets/adaptive-icon.png', 1024, 0.62, CLEAR],
  // Splash art sits on its own background colour, so keep it transparent.
  ['assets/splash-icon.png', 512, 0.7, CLEAR],
  // PWA install icon. Chrome wants a 512 to offer installation.
  ['assets/icon-512.png', 512, 1.0, WHITE],
  // iOS home screen. Safari does not composite alpha, hence white.
  ['assets/apple-touch-icon.png', 180, 1.0, WHITE],
];

for (const [path, size, scale, bg] of OUTPUTS) {
  writeFileSync(path, render(size, scale, bg));
  console.log(`[icons] ${path}  ${size}x${size}`);
}

console.log(`[icons] generated from ${SOURCE} (${source.width}x${source.height})`);

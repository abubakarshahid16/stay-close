/**
 * Generates the PWA icons at build time — zero dependencies (Node's zlib only),
 * so no binary blobs need to live in git.
 *
 * Output: public/icons/{icon-192,icon-512,maskable-512,apple-touch-icon,favicon-32}.png
 * Run: node scripts/gen-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = 'public/icons';
const PURPLE = [124, 58, 237]; // #7C3AED
const PINK = [236, 72, 153]; // #EC4899

/* ---------- minimal PNG encoder (RGBA, 8-bit) ---------- */
function crc32(buf) {
  let c,
    t = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = t[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- shapes ---------- */
// Classic heart implicit curve: (x^2 + y^2 - 1)^3 - x^2 * y^3 <= 0
const inHeart = (x, y) => {
  const a = x * x + y * y - 1;
  return a * a * a - x * x * y * y * y <= 0;
};

const inRoundRect = (x, y, size, r) => {
  const near = (v) => (v < r ? r - v : v > size - r ? v - (size - r) : 0);
  const dx = near(x),
    dy = near(y);
  return dx * dx + dy * dy <= r * r;
};

function render(size, { bg = true, heartScale = 0.78 } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const r = size * 0.22;
  const SS = 3; // 3x3 supersampling for smooth edges
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgHits = 0,
        heartHits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          if (!bg || inRoundRect(px, py, size, r)) bgHits++;
          // map to heart space, y flipped, slight vertical offset
          const hx = ((px - size / 2) / (size * heartScale)) * 2.4;
          const hy = ((size / 2 - py) / (size * heartScale)) * 2.4 + 0.25;
          if (inHeart(hx, hy)) heartHits++;
        }
      }
      const n = SS * SS;
      const bgA = bgHits / n;
      const hA = heartHits / n;
      const t = y / Math.max(1, size - 1);
      const base = bg
        ? [
            Math.round(PURPLE[0] + (PINK[0] - PURPLE[0]) * t),
            Math.round(PURPLE[1] + (PINK[1] - PURPLE[1]) * t),
            Math.round(PURPLE[2] + (PINK[2] - PURPLE[2]) * t),
          ]
        : [0, 0, 0];
      const heart = bg ? [255, 255, 255] : PURPLE;

      let R, G, B, A;
      if (bg) {
        // composite white heart over the gradient tile
        R = base[0] + (heart[0] - base[0]) * hA;
        G = base[1] + (heart[1] - base[1]) * hA;
        B = base[2] + (heart[2] - base[2]) * hA;
        A = bgA * 255;
      } else {
        R = heart[0];
        G = heart[1];
        B = heart[2];
        A = hA * 255;
      }
      const i = (y * size + x) * 4;
      buf[i] = Math.round(R);
      buf[i + 1] = Math.round(G);
      buf[i + 2] = Math.round(B);
      buf[i + 3] = Math.round(A);
    }
  }
  return encodePNG(size, size, buf);
}

mkdirSync(OUT, { recursive: true });
const jobs = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  // maskable needs the art inside a ~80% safe zone
  ['maskable-512.png', 512, { heartScale: 0.58 }],
  ['apple-touch-icon.png', 180, {}],
  ['favicon-32.png', 32, {}],
];
for (const [name, size, opts] of jobs) {
  writeFileSync(`${OUT}/${name}`, render(size, opts));
  console.log(`[gen-icons] ${name} (${size}x${size})`);
}

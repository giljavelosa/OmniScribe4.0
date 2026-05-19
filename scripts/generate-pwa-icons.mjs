/**
 * Generates OmniScribe's PWA + favicon assets from scratch — no image
 * dependency, just Node's `zlib`. Run: `node scripts/generate-pwa-icons.mjs`.
 *
 * Outputs:
 *   public/icons/icon-192.png   192x192  (manifest "any")
 *   public/icons/icon-512.png   512x512  (manifest "any maskable")
 *   src/app/icon.png            256x256  (Next App Router favicon)
 *   public/favicon.ico          48x48 PNG embedded in an ICO container
 *
 * The mark: a white leaf on the brand teal (#3d8b8b), drawn as the lens
 * intersection of two circles with a teal center vein — the same motif as
 * the BrandWordmark quill. Kept inside the central ~60% so it survives the
 * maskable safe-area crop.
 *
 * Re-run this whenever the brand mark changes; commit the binary output.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Brand teal + white. Matches manifest theme_color.
const TEAL = [0x3d, 0x8b, 0x8b];
const WHITE = [0xff, 0xff, 0xff];

/** Render the icon as an RGBA pixel buffer of `size`x`size`. */
function renderIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;

  // Two circles whose overlap is a vertical leaf-lens. Radius + offset are
  // tuned so the lens spans ~58% of the canvas, comfortably inside the
  // maskable safe zone.
  const r = size * 0.42;
  const off = size * 0.3; // horizontal offset of each circle's center
  const veinHalf = size * 0.018; // half-thickness of the center vein

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dxL = x - (cx - off);
      const dxR = x - (cx + off);
      const dy = y - cy;
      const inLeft = dxL * dxL + dy * dy <= r * r;
      const inRight = dxR * dxR + dy * dy <= r * r;
      const inLeaf = inLeft && inRight;
      // Center vein: a thin teal stripe down the leaf's vertical axis.
      const onVein = inLeaf && Math.abs(x - cx) <= veinHalf;

      const [cr, cg, cb] = inLeaf && !onVein ? WHITE : TEAL;
      px[i] = cr;
      px[i + 1] = cg;
      px[i + 2] = cb;
      px[i + 3] = 0xff; // fully opaque — manifest background sits underneath anyway
    }
  }
  return px;
}

/** Encode an RGBA buffer as a PNG (color type 6, 8-bit). */
function encodePng(rgba, size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // [10..12] compression / filter / interlace all 0

  // Raw scanlines: one filter byte (0 = none) per row.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Wrap a PNG in a single-image ICO container (ICO accepts embedded PNG). */
function pngToIco(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(1, 4); // image count

  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size; // width  (0 means 256)
  entry[1] = size >= 256 ? 0 : size; // height
  entry[2] = 0; // palette
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8); // image data size
  entry.writeUInt32LE(6 + 16, 12); // offset to image data

  return Buffer.concat([header, entry, png]);
}

function emit(relPath, buf) {
  const abs = join(ROOT, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, buf);
  console.log(`  ${relPath}  (${buf.length} bytes)`);
}

console.log('Generating OmniScribe PWA icons:');
const png192 = encodePng(renderIcon(192), 192);
const png512 = encodePng(renderIcon(512), 512);
const png256 = encodePng(renderIcon(256), 256);
const png48 = encodePng(renderIcon(48), 48);
emit('public/icons/icon-192.png', png192);
emit('public/icons/icon-512.png', png512);
emit('src/app/icon.png', png256);
emit('public/favicon.ico', pngToIco(png48, 48));
console.log('Done.');

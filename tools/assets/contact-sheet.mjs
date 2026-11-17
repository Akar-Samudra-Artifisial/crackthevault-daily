#!/usr/bin/env node
// Compose images onto a light checkerboard grid for visual review (transparency shows as checkers).
// Usage: node tools/assets/contact-sheet.mjs <out.png> <img...>
import sharp from 'sharp';
import { basename } from 'node:path';

const CELL = 384;
const [out, ...files] = process.argv.slice(2);
if (!out || files.length === 0) throw new Error('Usage: contact-sheet.mjs <out.png> <img...>');
const COLS = Math.min(4, files.length);

const rows = Math.ceil(files.length / COLS);
const width = COLS * CELL;
const height = rows * CELL;
const checker = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><pattern id="c" width="32" height="32" patternUnits="userSpaceOnUse"><rect width="32" height="32" fill="#f4efe4"/><rect width="16" height="16" fill="#cfe6f5"/><rect x="16" y="16" width="16" height="16" fill="#cfe6f5"/></pattern></defs><rect width="100%" height="100%" fill="url(#c)"/></svg>`,
);

const layers = await Promise.all(
  files.map(async (f, i) => {
    const img = await sharp(f).resize(CELL - 24, CELL - 40, { fit: 'inside' }).png().toBuffer();
    const label = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="20"><text x="4" y="15" font-family="sans-serif" font-size="14" fill="#c00">${basename(f)}</text></svg>`,
    );
    const left = (i % COLS) * CELL;
    const top = Math.floor(i / COLS) * CELL;
    return [
      { input: img, left: left + 12, top: top + 24 },
      { input: label, left, top },
    ];
  }),
);
await sharp(checker).composite(layers.flat()).png().toFile(out);
console.log(`wrote ${out} (${files.length} images)`);

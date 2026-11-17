#!/usr/bin/env node
// Post-process brand images from assets-src/brand (generated via generate.mjs --config tools/assets/brand.json):
//   icon.png   -> assets/icon.png              (1024x1024, devvit.json marketingAssets.icon)
//   icon.png   -> assets/subreddit/avatar.png  (256x256, subreddit avatar)
//   banner.png -> assets/subreddit/banner.jpg  (1920x384, subreddit banner, <= 500 KB)
//   logo.png   -> public/brand/logo.webp       (trimmed, 640px wide, <= 60 KB; in-game, load lazily)
// Run from tools/assets (sharp lives in tools/assets/node_modules): npm run process
import sharp from 'sharp';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (name) => resolve(root, 'assets-src/brand', name);
const out = (rel) => resolve(root, rel);
const KB = 1024;

async function report(rel) {
  const { size } = await stat(out(rel));
  const meta = await sharp(out(rel)).metadata();
  console.log(`ok ${rel} ${meta.width}x${meta.height} ${(size / KB).toFixed(1)}KB alpha=${meta.hasAlpha}`);
}

async function writeUnder(rel, maxBytes, encode) {
  for (const quality of [88, 82, 76, 70, 62, 55]) {
    const bytes = await encode(quality);
    if (bytes.length <= maxBytes) {
      await writeFile(out(rel), bytes);
      return report(rel);
    }
  }
  throw new Error(`${rel} still exceeds ${maxBytes} bytes`);
}

async function main() {
  await mkdir(out('assets/subreddit'), { recursive: true });
  await mkdir(out('public/brand'), { recursive: true });

  await sharp(src('icon.png')).resize(1024, 1024, { fit: 'cover' }).png({ compressionLevel: 9, palette: true, quality: 95 }).toFile(out('assets/icon.png'));
  await report('assets/icon.png');

  await sharp(src('icon.png')).resize(256, 256, { fit: 'cover', kernel: 'lanczos3' }).flatten({ background: '#2b1a12' }).png({ compressionLevel: 9, palette: true, quality: 95 }).toFile(out('assets/subreddit/avatar.png'));
  await report('assets/subreddit/avatar.png');

  await writeUnder('assets/subreddit/banner.jpg', 500 * KB, (quality) =>
    sharp(src('banner.png')).resize(1920, 384, { fit: 'cover' }).flatten({ background: '#2b1a12' }).jpeg({ quality, mozjpeg: true }).toBuffer(),
  );

  const logo = await sharp(src('logo.png')).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 10 }).png().toBuffer();
  await writeUnder('public/brand/logo.webp', 60 * KB, (quality) =>
    sharp(logo).resize({ width: 640, withoutEnlargement: true }).webp({ quality, alphaQuality: 90, effort: 6 }).toBuffer(),
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});

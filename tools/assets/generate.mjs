#!/usr/bin/env node
// Generate Crack the Vault brand art via Runware API (default: Seedream 5.5).
// Adapted from the-stack/tools/assets/generate.mjs.
// Usage:
//   RUNWARE_API_KEY=... node tools/assets/generate.mjs [--config <json>] [--only id1,id2]
//     [--ref <path|url>] [--concurrency N] [--dry-run]
// Config (default tools/assets/brand.json):
//   { "style": "...", "outDir": "assets-src/brand", "items": [{ "id", "prompt", ...overrides }] }
// Per-item overrides: model, width, height, transparent (default true), useStyle (default true),
//   useRef (default true), removeBackground (default false), settings (merged into task.settings).
// Output: <outDir>/<id>.png + <outDir>/manifest.json
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_URL = 'https://api.runware.ai/v1';
const DEFAULT_MODEL = 'bytedance:seedream@5.5';
const SEEDREAM_PREFIX = 'bytedance:seedream';
const RMBG_MODEL = 'runware:112@5';
const SIZE = 1024;
const REF_SUFFIX = 'Match the art style of the reference image.';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function parseArgs(argv) {
  const args = { config: 'tools/assets/brand.json', only: null, ref: null, concurrency: 1, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only') args.only = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (a === '--ref') args.ref = argv[++i] ?? '';
    else if (a === '--config') args.config = argv[++i] ?? '';
    else if (a === '--concurrency') args.concurrency = Number(argv[++i]);
    else if (a === '--dry-run') args.dryRun = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (args.ref === '') throw new Error('--ref requires a path or URL');
  if (!args.config) throw new Error('--config requires a path');
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1 || args.concurrency > 8) {
    throw new Error('--concurrency must be an integer 1..8');
  }
  return args;
}

async function toImageInput(ref) {
  if (/^https?:\/\//.test(ref)) return ref;
  const buf = await readFile(resolve(process.cwd(), ref));
  const ext = extname(ref).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw new Error(`Failed to read ${path}: ${err.message}`);
  }
}

async function runTask(apiKey, task, label) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([task]),
  });
  const body = await res.json().catch(() => null);
  const errors = body?.errors ?? (body?.error ? [body.error] : null);
  if (!res.ok || errors) throw new Error(`Runware ${res.status} for "${label}": ${JSON.stringify(errors ?? body)}`);
  const result = body?.data?.find((d) => d.taskUUID === task.taskUUID) ?? body?.data?.[0];
  if (!result?.imageURL) throw new Error(`No imageURL for "${label}": ${JSON.stringify(body)}`);
  return result;
}

async function download(url, label) {
  const img = await fetch(url);
  if (!img.ok) throw new Error(`Download failed for "${label}": HTTP ${img.status}`);
  return Buffer.from(await img.arrayBuffer());
}

async function removeBackground(apiKey, image, label) {
  const task = {
    taskType: 'removeBackground',
    taskUUID: randomUUID(),
    model: RMBG_MODEL,
    inputs: { image },
    outputFormat: 'PNG',
    outputType: 'URL',
    includeCost: true,
  };
  const rm = await runTask(apiKey, task, `${label}:removeBackground`);
  return {
    bytes: await download(rm.imageURL, label),
    meta: { model: RMBG_MODEL, taskUUID: task.taskUUID, cost: rm.cost ?? null },
  };
}

async function generate(apiKey, item, config, refInput, outDir) {
  const model = item.model ?? DEFAULT_MODEL;
  const isSeedream = model.startsWith(SEEDREAM_PREFIX);
  const transparent = item.transparent ?? true;
  const ref = item.useRef === false ? null : refInput;
  const style = item.useStyle === false ? '' : config.style;
  const prompt = [item.prompt, style, ref ? REF_SUFFIX : ''].filter(Boolean).join(', ');
  const settings = {
    ...(isSeedream ? { background: transparent ? 'transparent' : 'opaque' } : {}),
    ...(item.settings ?? {}),
  };
  const task = {
    taskType: 'imageInference',
    taskUUID: randomUUID(),
    model,
    positivePrompt: prompt,
    width: item.width ?? SIZE,
    height: item.height ?? SIZE,
    outputFormat: 'PNG',
    outputType: 'URL',
    includeCost: true,
    numberResults: 1,
    ...(Object.keys(settings).length ? { settings } : {}),
    ...(ref ? { inputs: { referenceImages: [ref] } } : {}),
  };
  const result = await runTask(apiKey, task, item.id);
  let cost = result.cost ?? 0;
  let rmbg = null;
  let bytes = await download(result.imageURL, item.id);
  const file = resolve(outDir, `${item.id}.png`);

  if (item.removeBackground) {
    // Keep the raw image so a failed background removal does not waste the generation.
    await writeFile(resolve(outDir, `${item.id}.raw.png`), bytes);
    const out = await removeBackground(apiKey, `data:image/png;base64,${bytes.toString('base64')}`, item.id);
    bytes = out.bytes;
    cost += out.meta.cost ?? 0;
    rmbg = out.meta;
  }
  await writeFile(file, bytes);

  // A fresh object drops stale post-process data; process.mjs must be re-run.
  return {
    model,
    prompt,
    size: { width: task.width, height: task.height },
    transparent,
    reference: ref ? (ref.startsWith('data:') ? 'local-file' : ref) : null,
    seed: result.seed ?? null,
    cost: Number(cost.toFixed(4)),
    taskUUID: task.taskUUID,
    imageUUID: result.imageUUID ?? null,
    removeBackground: rmbg,
    file: relative(root, file),
    generatedAt: new Date().toISOString(),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await readJson(resolve(root, args.config));
  const outDir = resolve(root, config.outDir ?? 'assets-src/brand');
  const manifestPath = resolve(outDir, 'manifest.json');
  const items = (config.items ?? []).filter((it) => !args.only || args.only.includes(it.id));
  if (items.length === 0) throw new Error(`No matching items in ${args.config}`);

  const apiKey = process.env.RUNWARE_API_KEY;
  if (!apiKey && !args.dryRun) throw new Error('RUNWARE_API_KEY is not set');

  const refInput = args.ref ? await toImageInput(args.ref) : null;
  if (args.dryRun) {
    for (const item of items) {
      console.log(`[dry-run] ${item.id} model=${item.model ?? DEFAULT_MODEL}${refInput && item.useRef !== false ? ' (with ref)' : ''}`);
    }
    return;
  }
  await mkdir(outDir, { recursive: true });
  const manifest = await readJson(manifestPath, {});

  let total = 0;
  let failed = 0;
  let saving = Promise.resolve();
  const queue = [...items];
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      try {
        const meta = await generate(apiKey, item, config, refInput, outDir);
        manifest[item.id] = meta;
        total += meta.cost;
        saving = saving.then(() => writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`));
        await saving;
        console.log(`ok ${item.id} cost=${meta.cost} seed=${meta.seed}`);
      } catch (err) {
        failed++;
        console.error(`fail ${item.id}: ${err.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(args.concurrency, items.length) }, worker));
  console.log(`total cost: $${total.toFixed(4)}; failed: ${failed}`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});

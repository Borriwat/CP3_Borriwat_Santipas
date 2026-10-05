#!/usr/bin/env node
// Regenerates the PNG icons from icons/icon.svg using Playwright's Chromium.
// Needs `playwright` to be resolvable (npm i -D playwright, or link a global one).
//   node tools/make-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm i --no-save playwright');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'icons/icon.svg'), 'utf8');
const inner = svg.replace(/<svg[^>]*>/, '').replace('</svg>', '');

// full-bleed square (iOS rounds the corners itself) and a maskable variant with a safe zone
const full = (size, scale = 1) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512"><defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#17372d"/><stop offset="1" stop-color="#0b1511"/></linearGradient></defs>
  <rect width="512" height="512" fill="url(#bg)"/><g transform="translate(${256 * (1 - scale)} ${256 * (1 - scale)}) scale(${scale})">${inner.replace(/<defs>[\s\S]*?<\/defs>/, '').replace(/<rect width="512"[^>]*\/>/, '')}</g></svg>`;

const jobs = [
  ['icons/icon-192.png', full(192)],
  ['icons/icon-512.png', full(512)],
  ['icons/apple-touch-icon.png', full(180)],
  ['icons/icon-maskable-512.png', full(512, 0.78)],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, markup] of jobs) {
  const size = Number(/width="(\d+)"/.exec(markup)[1]);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0">${markup}</body>`);
  writeFileSync(join(root, file), await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } }));
  console.log('wrote', file);
}
await browser.close();

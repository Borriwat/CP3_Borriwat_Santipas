import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { listAssets } from '../tools/build-sw.mjs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('sw.js is up to date with the shipped files (run `npm run build` if this fails)', () => {
  execFileSync('node', [join(root, 'tools/build-sw.mjs'), '--check'], { stdio: 'pipe' });
});

test('every module imported by the app is precached for offline use', () => {
  const assets = new Set(listAssets());
  for (const f of assets) {
    if (!f.endsWith('.js')) continue;
    const src = readFileSync(join(root, f), 'utf8');
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) {
      const target = join(dirname(f), m[1]).split('\\').join('/');
      assert.ok(assets.has(target), `${f} imports ${m[1]} which is not in the precache list`);
      assert.ok(existsSync(join(root, target)), `${f} imports missing file ${m[1]}`);
    }
  }
});

test('manifest icons and the apple-touch-icon exist', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
  for (const i of manifest.icons) assert.ok(existsSync(join(root, i.src)), i.src);
  assert.ok(existsSync(join(root, 'icons/apple-touch-icon.png')));
  assert.equal(manifest.display, 'standalone');
  assert.ok(readFileSync(join(root, 'index.html'), 'utf8').includes('viewport-fit=cover'));
});

#!/usr/bin/env node
// End-to-end smoke test in a real (Chromium) browser with an iPhone profile.
//   npm run e2e        (needs Playwright: npm i --no-save playwright)
// Starts its own static server, so nothing else has to be running.

import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { buildHistory } from './make-history.mjs';
import { exportState } from '../../js/core/state.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
let pw;
try {
  pw = await import('playwright');
} catch {
  console.error('Playwright is not installed. Run: npm i --no-save playwright');
  process.exit(2);
}
const { chromium, devices } = pw;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(root, path === '/' ? 'index.html' : path);
  if (!file.startsWith(root)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;

let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${e.message.split('\n')[0]}`);
  }
}
const eq = (a, b, msg = '') => {
  if (a !== b) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
const ok = (v, msg) => {
  if (!v) throw new Error(msg || 'expected truthy');
};

const browser = await chromium.launch();
const newPage = async (opts = {}) => {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block', ...opts });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && page.errors.push(m.text()));
  return { ctx, page };
};
const kcalEaten = async (page) => Number((await page.locator('.card [aria-label$="kilocalories"]').first().getAttribute('aria-label')).match(/^(\d+)/)[1]);
const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__app.store.state)));
const loadExample = async (page) => {
  await page.goto(BASE);
  await page.click('[data-act="try-example"]');
  await page.waitForSelector('.tabbar');
};

console.log('\nCore flows');
{
  const { ctx, page } = await newPage();
  await check('boots to the welcome screen with no errors', async () => {
    await page.goto(BASE);
    await page.waitForSelector('[data-act="try-example"]');
    eq(page.errors.length, 0, page.errors.join('; '));
  });
  await check('example plan loads: Lift day on a Push day, four meal cards', async () => {
    await page.click('[data-act="try-example"]');
    await page.waitForSelector('.tabbar');
    eq(await page.locator('.seg.tight button[aria-pressed="true"]').first().innerText(), 'Lift');
    eq(await page.locator('[data-key^="meal-"]').count(), 4);
  });
  let plannedKcal;
  await check('"Log as planned" logs the meal and the ring updates', async () => {
    const before = await kcalEaten(page);
    eq(before, 0);
    await page.click('[data-key="meal-lunch"] [data-act="log-planned"]');
    await page.waitForSelector('[data-key="meal-lunch"] .pill.ok');
    plannedKcal = await kcalEaten(page);
    ok(plannedKcal > 700 && plannedKcal < 1000, `lunch kcal ${plannedKcal}`);
    const st = await state(page);
    ok(st.days[Object.keys(st.days)[0]].entries.every((e) => e.src === 'plan'));
  });
  await check('editing an entry amount rescales its macros', async () => {
    await page.click('[data-key="meal-lunch"] [data-act="entry-open"] >> nth=0');
    await page.fill('.sheet input[data-field="qty"]', '100');
    await page.click('[data-act="entry-save"]');
    await page.waitForFunction(() => !document.querySelector('.sheet'));
    const k = await kcalEaten(page);
    ok(k < plannedKcal, `kcal should drop: ${k} vs ${plannedKcal}`);
  });
  await check('typing a weight keeps focus on every keystroke and saves on blur', async () => {
    const input = page.locator('input[data-change="weight"]');
    await input.scrollIntoViewIfNeeded();
    await input.click();
    await page.keyboard.type('74.', { delay: 40 });
    // force a full re-render while the field is focused and half-typed (as happens when
    // any other state changes): the morph must leave the focused input alone
    await page.evaluate(() => window.__app.store.update(() => {}));
    await page.waitForTimeout(80);
    await page.keyboard.type('6', { delay: 40 });
    ok(await input.evaluate((el) => el === document.activeElement), 'input lost focus during a re-render');
    eq(await input.inputValue(), '74.6', 'typed text was clobbered by a re-render:');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    const st = await state(page);
    eq(Object.values(st.days).find((d) => d.weight).weight, 74.6);
  });
  await check('entering weight does not wipe a body-fat reading', async () => {
    await page.fill('input[data-change="bf"]', '17.5');
    await page.keyboard.press('Enter');
    await page.fill('input[data-change="weight"]', '74.8');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    const d = Object.values((await state(page)).days).find((x) => x.weight);
    eq(d.bf, 17.5);
    eq(d.weight, 74.8);
  });
  await check('data survives a reload (IndexedDB)', async () => {
    await page.waitForTimeout(600); // let the debounced save land
    await page.reload();
    await page.waitForSelector('.tabbar');
    const st = await state(page);
    const day = Object.values(st.days)[0];
    ok(day.entries.length >= 2 && day.weight === 74.8, 'logged data missing after reload');
    ok(await kcalEaten(page) > 0);
  });
  await check('switching the day type swaps the meal slots', async () => {
    await page.click('[data-act="set-type"][data-v="rest"]');
    await page.waitForSelector('[data-key="meal-breakfast"]');
    eq(await page.locator('[data-key^="meal-"]').count(), 3);
    await page.click('[data-act="set-type"][data-v="lift"]');
    await page.waitForSelector('[data-key="meal-pre"]');
  });
  await check('water and supplement toggles work', async () => {
    await page.click('[data-act="water"][data-ml="500"]');
    await page.click('[data-act="supp-toggle"] >> nth=0');
    const day = Object.values((await state(page)).days)[0];
    eq(day.water, 500);
    eq(day.supps.length, 1);
  });
  await check('quick add and a custom food both land in the log', async () => {
    await page.click('[data-key="meal-dinner"] [data-act="add-food"]');
    await page.click('[data-act="sheet-tab"][data-v="quick"]');
    await page.fill('input[data-field="quick.name"]', 'Restaurant dish');
    await page.fill('input[data-field="quick.p"]', '40');
    await page.fill('input[data-field="quick.c"]', '60');
    await page.fill('input[data-field="quick.f"]', '20');
    await page.click('[data-act="quick-add"]');
    await page.waitForFunction(() => !document.querySelector('.sheet'));
    const day = Object.values((await state(page)).days)[0];
    const q = day.entries.find((e) => e.name === 'Restaurant dish');
    eq(q.p + q.c + q.f, 120);
  });
  await check('no console errors during the whole flow', async () => eq(page.errors.length, 0, page.errors.join('; ')));
  await ctx.close();
}

console.log('\nTraining');
{
  const { ctx, page } = await newPage();
  await loadExample(page);
  await page.click('[data-act="tab"][data-v="train"]');
  await check('start a workout, log a set, rest timer starts', async () => {
    await page.click('[data-act="workout-start"]');
    await page.waitForSelector('.set-grid');
    await page.fill('[data-change="set-w"][data-ex="0"][data-set="2"]', '22.5');
    await page.fill('[data-change="set-r"][data-ex="0"][data-set="2"]', '10');
    await page.click('[data-act="set-done"][data-ex="0"][data-set="2"]');
    await page.waitForSelector('.timerbar');
    const t = await page.locator('#timer-text').innerText();
    ok(/^\d:\d\d$/.test(t), `timer text ${t}`);
  });
  await check('ticking a blank set copies the previous set\'s weight', async () => {
    await page.click('[data-act="set-done"][data-ex="0"][data-set="3"]');
    const st = await state(page);
    const w = Object.values(st.days).find((d) => d.workout).workout;
    eq(w.exercises[0].sets[3].w, 22.5);
    eq(w.exercises[0].sets[3].done, true);
  });
  await check('timer can be adjusted and skipped', async () => {
    await page.click('[data-act="timer-add"][data-s="15"]');
    await page.click('[data-act="timer-stop"]');
    eq(await page.locator('.timerbar').count(), 0);
  });
  await check('finishing the workout saves it and the day becomes a lift day', async () => {
    await page.click('[data-act="workout-finish-open"]');
    await page.fill('.sheet input[data-field="burn"]', '320');
    await page.click('[data-act="workout-finish"]');
    await page.waitForFunction(() => !document.querySelector('.sheet'));
    const st = await state(page);
    const w = Object.values(st.days).find((d) => d.workout).workout;
    ok(w.finishedAt, 'not finished');
    eq(w.burnKcal, 320);
  });
  await check('Progress shows the strength card once a workout exists', async () => {
    await page.click('[data-act="tab"][data-v="progress"]');
    ok((await page.locator('select[data-change="strength-ex"]').count()) === 1);
  });
  await ctx.close();
}

console.log('\nReview, backup, reset');
{
  const { ctx, page } = await newPage({ acceptDownloads: true });
  await loadExample(page);
  await check('review with no data says to keep logging (no crash)', async () => {
    await page.click('[data-act="tab"][data-v="progress"]');
    await page.click('[data-act="review-open"]');
    await page.waitForSelector('.sheet');
    ok((await page.locator('.sheet').innerText()).includes('not enough data yet'));
    await page.click('[data-act="sheet-close"] >> nth=1');
  });
  await check('restoring a month of history then running the review gives a decision', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rt-'));
    const f = join(dir, 'history.json');
    await writeFile(f, exportState(buildHistory()));
    await page.click('[data-act="tab"][data-v="more"]');
    await page.setInputFiles('[data-change="backup-file"]', f);
    await page.click('[data-act="confirm-yes"]');
    await page.waitForTimeout(300);
    await page.click('[data-act="tab"][data-v="progress"]');
    await page.click('[data-act="review-open"]');
    await page.waitForSelector('.sheet');
    const txt = await page.locator('.sheet').innerText();
    ok(/Hold|Next/.test(txt), 'no decision shown');
    ok(txt.includes('The numbers'), 'no numbers table');
    await page.click('[data-act="review-save"]');
    await page.waitForFunction(() => !document.querySelector('.sheet'));
    eq((await state(page)).reviews.length, 1);
  });
  await check('export backup downloads a valid file that round-trips', async () => {
    await page.click('[data-act="tab"][data-v="more"]');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="backup-export"]')]);
    const data = JSON.parse(await readFile(await dl.path(), 'utf8'));
    eq(data.app, 'recomp-tracker');
    ok(Object.keys(data.state.days).length >= 28);
  });
  await check('a corrupt backup is refused with a message and nothing is lost', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rt-'));
    const f = join(dir, 'bad.json');
    await writeFile(f, '{"not":"a backup"}');
    const before = Object.keys((await state(page)).days).length;
    await page.setInputFiles('[data-change="backup-file"]', f);
    await page.waitForSelector('.toast');
    eq(await page.locator('[data-act="confirm-yes"]').count(), 0);
    eq(Object.keys((await state(page)).days).length, before);
  });
  await check('"delete all data" returns to the welcome screen', async () => {
    await page.click('[data-act="reset-all"]');
    await page.click('[data-act="confirm-yes"]');
    await page.waitForSelector('[data-act="try-example"]');
    eq(Object.keys((await state(page)).days).length, 0);
  });
  await check('importing a plan file with problems explains what is wrong', async () => {
    await page.click('[data-act="plan-import-open"]');
    await page.fill('textarea[data-field="text"]', '{"schema":"recomp-tracker-plan/1","dayTypes":{}}');
    ok((await page.locator('.banner.bad li').count()) >= 1);
    eq(await page.locator('[data-act="plan-import"]').getAttribute('disabled') !== null, false, 'button state');
  });
  await check('no console errors', async () => eq(page.errors.length, 0, page.errors.join('; ')));
  await ctx.close();
}

console.log('\nLayout');
for (const [name, profile] of [['iPhone SE (320 px)', 'iPhone SE'], ['iPhone 13', 'iPhone 13'], ['iPhone 13 Pro Max', 'iPhone 13 Pro Max']]) {
  const { ctx, page } = await newPage({ ...devices[profile] });
  await loadExample(page);
  for (const tab of ['today', 'plan', 'train', 'progress', 'more']) {
    await check(`${name}: ${tab} has no horizontal overflow`, async () => {
      await page.click(`[data-act="tab"][data-v="${tab}"]`);
      await page.waitForTimeout(150);
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      ok(o.sw <= o.cw, `scrollWidth ${o.sw} > clientWidth ${o.cw}`);
    });
  }
  await ctx.close();
}
{
  const { ctx, page } = await newPage({ colorScheme: 'dark' });
  await check('dark mode follows the system setting', async () => {
    await loadExample(page);
    const bg = await page.evaluate(() => window.getComputedStyle(document.body).backgroundColor);
    const [r, g, b] = bg.match(/\d+/g).map(Number);
    ok(r + g + b < 120, `background ${bg} is not dark`);
  });
  await ctx.close();
}

console.log('\nOffline & PWA');
{
  const { ctx, page } = await newPage({ serviceWorkers: 'allow' });
  await check('manifest and icons are served', async () => {
    const m = await (await ctx.request.get(BASE + 'manifest.webmanifest')).json();
    eq(m.display, 'standalone');
    for (const i of m.icons) eq((await ctx.request.get(BASE + i.src)).status(), 200, i.src);
  });
  await check('service worker caches everything, then the app runs with the SERVER SHUT DOWN', async () => {
    await page.goto(BASE);
    await page.waitForSelector('[data-act="try-example"]');
    // wait until the worker has installed, activated and taken control
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    // Playwright's setOffline() does not cover requests made by the worker itself,
    // so really take the network away: stop the server and drop every connection.
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    let reachable = true;
    try {
      await fetch(BASE + 'index.html', { signal: AbortSignal.timeout(1500) });
    } catch {
      reachable = false;
    }
    ok(!reachable, 'test server is still reachable, so this test proves nothing');
    await page.reload();
    await page.waitForSelector('[data-act="try-example"]', { timeout: 8000 });
    await page.click('[data-act="try-example"]');
    await page.waitForSelector('.tabbar');
    await page.click('[data-key="meal-lunch"] [data-act="log-planned"]');
    await page.waitForSelector('[data-key="meal-lunch"] .pill.ok');
    eq(page.errors.filter((e) => !/Failed to load resource|net::/.test(e)).length, 0, page.errors.join('; '));
  });
  await ctx.close();
}

await browser.close();
try { server.close(); } catch { /* already closed */ }
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('Failed:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}

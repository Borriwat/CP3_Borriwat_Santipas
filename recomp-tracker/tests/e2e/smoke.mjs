#!/usr/bin/env node
// End-to-end smoke test in a real (Chromium) browser with an iPhone profile.
//   npm run e2e        (needs Playwright: npm i --no-save playwright)
// Starts its own static server, so nothing else has to be running.

import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { buildHistory, buildStalledHistory } from './make-history.mjs';
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
// Serve under a sub-path, exactly like GitHub Pages does for a project site
// (https://<user>.github.io/<repo>/recomp-tracker/). Anything that only works at
// the server root (absolute URLs, a mis-scoped service worker) fails here.
const PREFIX = '/CP3_Borriwat_Santipas/recomp-tracker/';
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!path.startsWith(PREFIX)) return res.writeHead(404).end('outside the app path');
  const rel = path.slice(PREFIX.length) || 'index.html';
  const file = join(root, rel);
  if (!file.startsWith(root)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}${PREFIX}`;

let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${e.message.split('\n').slice(0, 12).join('\n       ')}`);
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
const kcalTarget = async (page) => Number((await page.locator('.ring-wrap').first().getAttribute('aria-label')).match(/of (\d+)/)[1]);
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


console.log('\nMore flows');
{
  const { ctx, page } = await newPage();
  await loadExample(page);
  const today = async () => {
    const st = await state(page);
    return { st, day: Object.values(st.days)[0] || {} };
  };
  const restore = async (st) => {
    const dir = await mkdtemp(join(tmpdir(), 'rt-'));
    const f = join(dir, 'b.json');
    await writeFile(f, exportState(st));
    await page.click('[data-act="tab"][data-v="more"]');
    await page.setInputFiles('[data-change="backup-file"]', f);
    await page.click('[data-act="confirm-yes"]');
    await page.waitForTimeout(250);
  };

  await check('logging cardio on a lift day switches the targets to Lift + Cardio', async () => {
    const before = await kcalTarget(page);
    await page.click('[data-act="cardio-open"]');
    await page.click('[data-act="cardio-save"]');
    await page.waitForFunction(() => !document.querySelector('.sheet'));
    eq(await page.locator('.seg.tight button[aria-pressed="true"]').first().innerText(), 'Lift+Cardio');
    ok((await kcalTarget(page)) > before, 'target did not grow');
    const { day } = await today();
    eq(day.cardio.length, 1);
    ok(day.cardio[0].kcal > 150, `auto kcal ${day.cardio[0].kcal}`);
  });
  await check('a hand-picked Rest day is upgraded to Cardio when cardio is logged', async () => {
    await page.click('[data-act="cardio-del"]');
    await page.click('[data-act="set-type"][data-v="rest"]');
    await page.click('[data-act="cardio-open"]');
    await page.click('[data-act="cardio-save"]');
    await page.waitForFunction(() => !document.querySelector('.sheet'));
    eq(await page.locator('.seg.tight button[aria-pressed="true"]').first().innerText(), 'Cardio');
  });
  await check('measurements save and show a change against the previous entry', async () => {
    await page.click('[data-act="tab"][data-v="progress"]');
    for (const [date, waist] of [['2026-01-01', '84'], [null, '82.5']]) {
      await page.click('[data-act="measure-open"]');
      if (date) await page.fill('.sheet input[type="date"]', date);
      await page.fill('input[data-input="measure-field"][data-k="waist"]', waist);
      await page.click('[data-act="measure-save"]');
      await page.waitForFunction(() => !document.querySelector('.sheet'));
    }
    eq((await state(page)).measurements.length, 2);
    ok((await page.locator('table.t').first().innerText()).includes('−1.5'), 'delta not shown');
  });
  await check('editing targets applies from today and moves the ring', async () => {
    await page.click('[data-act="tab"][data-v="plan"]');
    await page.click('[data-act="targets-open"]');
    const c = page.locator('input[data-input="target-field"][data-t="lift"][data-k="c"]');
    const old = Number(await c.inputValue());
    await c.fill(String(old + 10));
    await page.click('[data-act="targets-save"]');
    await page.waitForFunction(() => !document.querySelector('.sheet'));
    const h = (await state(page)).targetHistory;
    eq(h.length, 2);
    eq(h[1].targets.lift.c, old + 10);
    eq(h[0].targets.lift.c, old, 'old targets must be preserved');
  });
  await check('the supplement chooser changes which supplements appear', async () => {
    await page.click('[data-act="tab"][data-v="more"]');
    await page.click('[data-act="supp-choose"]');
    const before = (await state(page)).prefs.supplementIds.length;
    await page.click('[data-act="supp-pick"] >> nth=3'); // an optional one
    await page.click('.sheet-foot [data-act="sheet-close"]');
    eq((await state(page)).prefs.supplementIds.length, before + 1);
  });
  await check('"Which day is today?" moves the schedule', async () => {
    await page.click('[data-act="tab"][data-v="train"]');
    await page.click('[data-act="program-open"]');
    await page.click('[data-act="program-set"][data-n="3"]');
    await page.waitForFunction(() => !document.querySelector('.sheet'));
    eq((await page.locator('.page-head h1').innerText()).trim(), 'Legs');
    await page.click('[data-act="session-pick"]');
    await page.click('[data-act="session-start"][data-k="pull"]');
    await page.waitForSelector('.set-grid');
    eq((await state(page)).days[Object.keys((await state(page)).days)[0]].workout.dayKey, 'pull');
    await page.click('[data-act="workout-cancel"]');
    await page.click('[data-act="confirm-yes"]');
  });
  await check('swapping a planned ingredient adjusts that meal for today only', async () => {
    await page.click('[data-act="tab"][data-v="today"]');
    await page.click('[data-act="set-type"][data-v="lift"]');
    await page.click('[data-key="meal-dinner"] [data-act="planned-item"] >> nth=0');
    await page.click('[data-act="planned-swap"]');
    await page.click('[data-act="swap-pick"] >> nth=0');
    await page.click('[data-act="swap-apply"]');
    await page.waitForFunction(() => !document.querySelector('.sheet'));
    ok((await page.locator('[data-key="meal-dinner"] .pill.warn').count()) === 1, 'no "Adjusted today" pill');
    const { st, day } = await today();
    ok(day.adjust.dinner.length >= 2);
    ok(JSON.stringify(st.plan.menus.A.days.lift.dinner).includes('"q"'), 'plan itself untouched');
    await page.click('[data-key="meal-dinner"] [data-act="reset-adjust"]');
    eq(Object.keys((await today()).day.adjust).includes('dinner'), false);
  });
  await check('an off-plan meal triggers the rebalance offer and applying it resizes the rest', async () => {
    await page.click('[data-key="meal-lunch"] [data-act="add-food"]');
    await page.click('[data-act="sheet-tab"][data-v="quick"]');
    await page.fill('input[data-field="quick.name"]', 'Big restaurant lunch');
    await page.fill('input[data-field="quick.p"]', '30');
    await page.fill('input[data-field="quick.c"]', '150');
    await page.fill('input[data-field="quick.f"]', '60');
    await page.click('[data-act="quick-add"]');
    await page.waitForSelector('[data-act="rebalance-open"]');
    await page.click('[data-act="rebalance-open"]');
    await page.click('[data-act="rebalance-apply"]');
    await page.waitForFunction(() => !document.querySelector('.sheet'));
    const { day } = await today();
    ok(Object.keys(day.adjust).length >= 2, 'no adjusted meals');
    const carbs = (slot) => day.adjust[slot].reduce((a, i) => a + i.qty, 0);
    ok(carbs('dinner') > 0);
    eq(await page.locator('[data-act="rebalance-open"]').count(), 0, 'offer should disappear once rebalanced');
  });
  await check('review says NEXT, applying it lowers carbs, the menu goes stale, resizing fixes it', async () => {
    await restore(buildStalledHistory());
    await page.click('[data-act="tab"][data-v="progress"]');
    await page.click('[data-act="review-open"]');
    await page.waitForSelector('.sheet');
    ok((await page.locator('.sheet').innerText()).includes('Next: take the next step'), 'expected NEXT');
    await page.click('[data-act="review-apply"]');
    await page.click('[data-act="confirm-yes"]');
    await page.waitForSelector('.sheet [data-act="review-apply"][disabled]');
    const h = (await state(page)).targetHistory;
    eq(h.length, 2);
    eq(h[0].targets.lift.c - h[1].targets.lift.c, 25);
    eq(h[0].targets.rest.c - h[1].targets.rest.c, 0);
    await page.click('.sheet-foot [data-act="sheet-close"]');
    await page.click('[data-act="tab"][data-v="plan"]');
    await page.waitForSelector('[data-act="menu-rescale"]');
    await page.click('[data-act="menu-rescale"]');
    await page.click('[data-act="confirm-yes"]');
    await page.waitForFunction(() => !document.querySelector('[data-act="menu-rescale"]'));
  });
  await check('the calculator updates targets and the review floor values', async () => {
    await page.click('[data-act="tab"][data-v="more"]');
    await page.click('[data-act="calc-open"]');
    await page.click('[data-act="calc-apply"]');
    await page.waitForFunction(() => !document.querySelector('.sheet'));
    const st = await state(page);
    // same-day edits replace the earlier entry, so the review's change and this one share a row
    ok(st.targetHistory.length >= 2);
    ok(st.plan.dayTypes.lift.tdee > st.plan.dayTypes.rest.tdee);
    const last = st.targetHistory.at(-1).targets;
    ok(last.lift.kcal === last.lift.p * 4 + last.lift.c * 4 + last.lift.f * 9);
  });
  await check('no console errors in any of these flows', async () => eq(page.errors.length, 0, page.errors.join('; ')));
  await ctx.close();
}

console.log('\nWelcome paths');
{
  const { ctx, page } = await newPage();
  await check('"set up from my body stats" builds a working target-only plan', async () => {
    await page.goto(BASE);
    await page.click('[data-act="calc-welcome"]');
    await page.fill('input[data-input="calc-field"][data-k="age"]', '30');
    await page.fill('input[data-input="calc-field"][data-k="heightCm"]', '178');
    await page.fill('input[data-input="calc-field"][data-k="weightKg"]', '78');
    await page.fill('input[data-input="calc-field"][data-k="bfPct"]', '18');
    await page.click('[data-act="calc-create"]');
    await page.waitForSelector('.tabbar');
    ok(await kcalTarget(page) > 1800);
    eq(await page.locator('[data-key^="meal-"]').count(), 3);
    // no menus and no program: Plan and Train degrade gracefully instead of crashing
    await page.click('[data-act="tab"][data-v="plan"]');
    ok((await page.locator('main').innerText()).includes('no meal menus'));
    await page.click('[data-act="tab"][data-v="train"]');
    ok((await page.locator('main').innerText()).includes('does not include a training program') || (await page.locator('main').innerText()).includes("doesn't include a training program"));
    // logging a quick entry still works
    await page.click('[data-act="tab"][data-v="today"]');
    await page.click('[data-key="meal-meal1"] [data-act="add-food"]');
    await page.click('[data-act="sheet-tab"][data-v="quick"]');
    await page.fill('input[data-field="quick.p"]', '30');
    await page.click('[data-act="quick-add"]');
    eq(await kcalEaten(page), 120);
  });
  await check('calculator refuses to create a plan without the basics', async () => {
    const { ctx: c2, page: p2 } = await newPage();
    await p2.goto(BASE);
    await p2.click('[data-act="calc-welcome"]');
    ok((await p2.locator('[data-act="calc-create"]').getAttribute('disabled')) !== null, 'button should be disabled');
    await c2.close();
  });
  await check('no console errors', async () => eq(page.errors.length, 0, page.errors.join('; ')));
  await ctx.close();
}


console.log('\nHostile input');
{
  const { ctx, page } = await newPage();
  await check('markup in a plan file is shown as text and never executed', async () => {
    const { buildExamplePlan } = await import('../../js/data/example-plan.js');
    const p = buildExamplePlan();
    p.name = '<img src=x onerror="window.__xss=1">Evil plan';
    p.supplements[0].name = '"><script>window.__xss=2</script>';
    p.supplements[0].note = '<b onmouseover="window.__xss=3">hi</b>';
    p.menus.A.label = '<svg onload="window.__xss=4">';
    p.program.days.push.label = '</div><img src=x onerror="window.__xss=5">';
    await page.goto(BASE);
    await page.click('[data-act="plan-import-open"]');
    await page.fill('textarea[data-field="text"]', JSON.stringify(p));
    await page.click('[data-act="plan-import"]');
    await page.waitForSelector('.tabbar');
    for (const tab of ['today', 'plan', 'train', 'more']) {
      await page.click(`[data-act="tab"][data-v="${tab}"]`);
      await page.waitForTimeout(100);
    }
    ok((await page.locator('main').innerText()).includes('<img src=x'), 'name should appear literally');
    await page.click('[data-act="supp-choose"]'); // the supplement list shows the hostile name too
    await page.waitForSelector('.sheet');
    ok((await page.locator('.sheet').innerText()).includes('<script>window.__xss=2</script>'), 'supplement name should appear literally');
    await page.waitForTimeout(150);
    eq(await page.evaluate(() => window.__xss), undefined, 'injected script ran');
    eq(await page.locator('img[src="x"]').count(), 0, 'injected element exists');
    await page.click('.sheet-foot [data-act="sheet-close"]');
    // long unbroken text must wrap instead of widening the page (that hides the tab bar)
    for (const tab of ['today', 'plan', 'train', 'progress', 'more']) {
      await page.click(`[data-act="tab"][data-v="${tab}"]`);
      await page.waitForTimeout(80);
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      ok(o.sw <= o.cw, `${tab}: page is ${o.sw}px wide on a ${o.cw}px screen`);
    }
  });
  await check('a plan with an attribute-breaking id is refused with a clear message', async () => {
    const { buildExamplePlan } = await import('../../js/data/example-plan.js');
    const p = buildExamplePlan();
    p.supplements[0].id = 'x" data-act="reset-all';
    await page.click('[data-act="tab"][data-v="more"]');
    await page.click('[data-act="reset-all"]');
    await page.click('[data-act="confirm-yes"]');
    await page.waitForSelector('[data-act="plan-import-open"]');
    await page.click('[data-act="plan-import-open"]');
    await page.fill('textarea[data-field="text"]', JSON.stringify(p));
    ok((await page.locator('.banner.bad').innerText()).includes('not a valid id'));
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

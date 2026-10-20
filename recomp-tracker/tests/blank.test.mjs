import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/core/state.js';
import { bindStore, dayModel } from '../js/ui/ctx.js';
import { rebalanceNeeded } from '../js/ui/today.js';
import { computeRebalance } from '../js/ui/sheets-food.js';
import { createStore } from '../js/core/store.js';
import { memoryStorage } from '../js/core/storage.js';
import { offPlanPrompt } from '../js/core/prompts.js';
import { menuSlotItems, slotsFor } from '../js/core/plan.js';
import { dayTotals, dayStatus } from '../js/core/stats.js';
import { evaluateReview } from '../js/core/review.js';
import { freshState, logPerfectDay, TODAY } from './helpers.mjs';

// A live store on the example plan, so dayModel() computes exactly what Today shows.
async function liveStore(mode) {
  const store = createStore(memoryStorage(freshState()), { saveDelay: 1, today: () => TODAY });
  await store.init();
  bindStore(store);
  if (mode) store.update((s) => S.setMealMode(s, mode));
  return store;
}
const stripAdjust = (m) => ({ type: m.type, target: m.target, slots: m.slots });

test('mode: the default shows the plan, and "blank" is only chosen on purpose', async () => {
  const store = await liveStore();
  assert.equal(store.state.prefs.mealMode, 'planned');
  assert.equal(S.usesPlannedMeals(store.state), true);
  S.setMealMode(store.state, 'blank');
  assert.equal(S.usesPlannedMeals(store.state), false);
  S.setMealMode(store.state, 'nonsense');
  assert.equal(store.state.prefs.mealMode, 'planned', 'an unknown value means planned');
});

test('blank: every meal is empty (no planned foods, no planned macros) but still there, still named', async () => {
  const store = await liveStore();
  const planned = dayModel(TODAY);
  assert.ok(planned.meals.length >= 3);
  assert.ok(planned.meals.every((m) => m.items.length > 0 && m.planned.kcal > 0), 'precondition: the plan has foods');

  store.update((s) => S.setMealMode(s, 'blank'));
  const blank = dayModel(TODAY);
  assert.deepEqual(blank.meals.map((m) => m.slot), planned.meals.map((m) => m.slot), 'same meals');
  assert.deepEqual(blank.meals.map((m) => m.label), planned.meals.map((m) => m.label), 'same names');
  for (const m of blank.meals) {
    assert.deepEqual(m.items, []);
    assert.deepEqual(m.template, []);
    assert.equal(m.planned.kcal, 0);
    assert.equal(m.adjusted, false);
    assert.equal(m.status, 'open');
  }
});

test('blank: the daily targets, day type and everything else on Today are exactly the same', async () => {
  const store = await liveStore();
  const before = dayModel(TODAY);
  store.update((s) => S.setMealMode(s, 'blank'));
  const after = dayModel(TODAY);
  assert.deepEqual(stripAdjust(after), stripAdjust(before));
  assert.deepEqual(after.target, before.target, 'targets unchanged');
  assert.deepEqual(after.remaining, before.remaining, 'left-to-eat unchanged');
  // the stored targets themselves are not touched by the mode
  assert.equal(JSON.stringify(store.state.targetHistory), JSON.stringify(freshState().targetHistory));
});

test('blank: food logged by hand counts toward the targets exactly as before', async () => {
  const store = await liveStore('blank');
  const before = dayModel(TODAY);
  store.update((s) => S.addQuickEntry(s, TODAY, { name: 'My lunch', p: 50, c: 80, f: 20 }, 'lunch'));
  store.update((s) => S.addEstimateEntry(s, TODAY, { name: 'Photo snack', p: 5, c: 30, f: 2 }, 'extra'));
  const m = dayModel(TODAY);
  const lunch = m.meals.find((x) => x.slot === 'lunch');
  assert.equal(lunch.status, 'logged');
  assert.equal(lunch.entries.length, 1);
  assert.equal(lunch.logged.p, 50);
  assert.equal(m.totals.p, 55);
  assert.deepEqual(m.target, before.target);
  assert.equal(Math.round(m.remaining.p), Math.round(before.target.p - 55), 'protein left is target minus what was logged');
  assert.equal(m.extraEntries.length, 1);
  assert.equal(lunch.items.length, 0, 'and the meal still has no planned foods');
});

test('blank: no rebalance offer, because there is no plan to resize', async () => {
  const store = await liveStore('blank');
  store.update((s) => S.addQuickEntry(s, TODAY, { name: 'Big meal', p: 120, c: 300, f: 90 }, 'lunch'));
  assert.equal(rebalanceNeeded(dayModel(TODAY)), null);
  assert.equal(computeRebalance(TODAY), null);
  // the same situation in planned mode does offer it, so the test above is meaningful
  store.update((s) => S.setMealMode(s, 'planned'));
  assert.ok(rebalanceNeeded(dayModel(TODAY)), 'planned mode should offer to rebalance after a big meal');
});

test('switching back restores the plan, and nothing logged or adjusted was lost', async () => {
  const store = await liveStore();
  store.update((s) => S.setAdjust(s, TODAY, 'lunch', [{ foodId: store.state.plan.menus[store.state.prefs.menu].days.lift.lunch[0].food, qty: 123 }]));
  store.update((s) => S.addQuickEntry(s, TODAY, { name: 'Dinner out', p: 40, c: 60, f: 30 }, 'dinner'));
  const itemsBefore = dayModel(TODAY).meals.map((m) => m.items.length);
  assert.equal(itemsBefore[2], 1, 'precondition: lunch was adjusted down to one item');
  const logged = JSON.stringify(store.state.days[TODAY].entries);
  const adjusted = JSON.stringify(store.state.days[TODAY].adjust);
  store.update((s) => S.setMealMode(s, 'blank'));
  assert.equal(JSON.stringify(store.state.days[TODAY].entries), logged, 'entries untouched by switching');
  assert.equal(JSON.stringify(store.state.days[TODAY].adjust), adjusted, 'adjusted amounts kept, just hidden');
  assert.equal(dayModel(TODAY).meals.find((m) => m.slot === 'lunch').adjusted, false);
  store.update((s) => S.setMealMode(s, 'planned'));
  assert.deepEqual(dayModel(TODAY).meals.map((m) => m.items.length), itemsBefore);
  assert.equal(dayModel(TODAY).meals.find((m) => m.slot === 'lunch').adjusted, true, 'the adjusted lunch is back');
});

test('blank: plan menus themselves are untouched (Plan tab, shopping list and "planned" mode still have them)', async () => {
  const store = await liveStore('blank');
  const menu = store.state.prefs.menu;
  assert.ok(menuSlotItems(store.state.plan, menu, 'lift', 'lunch').length > 0);
  assert.ok(slotsFor(store.state.plan, 'lift').length >= 3);
});

test('blank: the review and day statistics only look at what was logged', () => {
  const s = freshState();
  S.setMealMode(s, 'blank');
  logPerfectDay(s, '2026-06-10', TODAY);
  const day = s.days['2026-06-10'];
  assert.ok(dayTotals(day).kcal > 0);
  const st = dayStatus(s, '2026-06-10', TODAY);
  assert.ok(st, 'a day status is still computed');
  assert.doesNotThrow(() => evaluateReview(s, { end: '2026-06-14', today: TODAY }));
});

test('meal mode survives a backup; old or damaged backups fall back to the plan', () => {
  const s = freshState();
  S.setMealMode(s, 'blank');
  assert.equal(S.parseBackup(S.exportState(s), TODAY).state.prefs.mealMode, 'blank');

  const old = JSON.parse(S.exportState(freshState()));
  delete old.state.prefs.mealMode;
  assert.equal(S.parseBackup(JSON.stringify(old), TODAY).state.prefs.mealMode, 'planned');

  for (const bad of ['BLANK', 7, null, { a: 1 }, '']) {
    const raw = JSON.parse(S.exportState(freshState()));
    raw.state.prefs.mealMode = bad;
    assert.equal(S.parseBackup(JSON.stringify(raw), TODAY).state.prefs.mealMode, 'planned', JSON.stringify(bad));
  }
});

test('AI helper text: no talk of a plan in blank mode; the planned wording is unchanged', () => {
  const args = {
    slotLabel: 'Lunch',
    plannedItems: ['Rice 200 g'],
    planned: { p: 20, c: 60, f: 5 },
    target: { p: 160, c: 300, f: 50, kcal: 2250 },
    eaten: { p: 40, c: 90, f: 10, kcal: 650 },
    remaining: { p: 120, c: 210, f: 40, kcal: 1600 },
    upcoming: ['Dinner'],
  };
  const blank = offPlanPrompt({ ...args, blank: true });
  assert.match(blank, /what I ate for Lunch\./);
  assert.match(blank, /My targets for today:/);
  assert.match(blank, /Left for the day/);
  assert.match(blank, /Meals still to eat: Dinner/);
  assert.doesNotMatch(blank, /instead of the plan|supposed to give me|planned as|My plan for today/);

  const planned = offPlanPrompt(args);
  assert.match(planned, /instead of the plan/);
  assert.match(planned, /planned as: Rice 200 g/);
  assert.match(planned, /supposed to give me/);
  assert.equal(offPlanPrompt({ ...args, blank: false }), planned);
});

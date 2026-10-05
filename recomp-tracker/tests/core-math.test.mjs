import test from 'node:test';
import assert from 'node:assert/strict';
import { kcalOf, macros, sumMacros, foodMacros, makeEntry, normalizeTarget, round } from '../js/core/macros.js';
import { buildFoodIndex, searchFoods, matchMacroFor } from '../js/core/foods.js';
import { swapFood, suggestSwaps, roundQty } from '../js/core/swap.js';
import { scaleItems, rebalanceMeals, rescaleMenu } from '../js/core/scale.js';
import { shoppingList } from '../js/core/grocery.js';
import { menuDayTotals } from '../js/core/plan.js';
import { freshState, indexOf, TODAY } from './helpers.mjs';
import { calculate, weightAt10Pct, bmr, deriveTarget, metKcal } from '../js/core/tdee.js';
import { addDays, diffDays, dateRange, isISO } from '../js/core/dates.js';

const idx = buildFoodIndex();

test('kcal is derived from macros (4/4/9, alcohol 7)', () => {
  assert.equal(kcalOf({ p: 10, c: 10, f: 10 }), 170);
  assert.equal(kcalOf({ a: 10 }), 70);
  assert.equal(macros({ p: 25, c: 0, f: 5 }).kcal, 145);
  assert.equal(normalizeTarget({ p: 160, c: 231, f: 44 }).kcal, 1960);
});

test('foodMacros scales per basis (100 g and per serving)', () => {
  const rice = idx.get('rice-white-cooked');
  const m = foodMacros(rice, 200);
  assert.equal(round(m.c, 1), 56.4);
  const dish = idx.get('dish-fried-rice');
  assert.equal(foodMacros(dish, 2).p, 40);
});

test('makeEntry snapshots macros', () => {
  const e = makeEntry(idx.get('egg-whole'), 100, { slot: 'breakfast' });
  assert.equal(e.slot, 'breakfast');
  assert.equal(e.p, 12.6);
  assert.equal(e.foodId, 'egg-whole');
});

test('sumMacros adds everything including alcohol', () => {
  const t = sumMacros([{ p: 1, c: 2, f: 3 }, { p: 4, c: 5, f: 6, a: 10 }]);
  assert.deepEqual([t.p, t.c, t.f, t.a], [5, 7, 9, 10]);
  assert.equal(t.kcal, 20 + 28 + 81 + 70);
});

test('plan foods override built-in; custom foods override plan', () => {
  const planFood = { id: 'banana', name: 'Banana (plan)', cat: 'fruit', p: 1, c: 21, f: 0.3 };
  const custom = { id: 'banana', name: 'Banana (mine)', cat: 'fruit', p: 1, c: 20, f: 0.3 };
  assert.equal(buildFoodIndex([planFood]).get('banana').name, 'Banana (plan)');
  assert.equal(buildFoodIndex([planFood], [custom]).get('banana').name, 'Banana (mine)');
});

test('searchFoods finds English and Thai names, prefix first', () => {
  const r = searchFoods(idx, 'chicken');
  assert.ok(r.length >= 4);
  assert.ok(r[0].name.toLowerCase().startsWith('chicken'));
  assert.ok(searchFoods(idx, 'กุ้ง').some((f) => f.id === 'shrimp-raw'));
  assert.equal(searchFoods(idx, 'zzzz-no-match').length, 0);
});

test('swap: protein source is matched on protein', () => {
  const chicken = idx.get('chicken-breast-raw');
  const shrimp = idx.get('shrimp-raw');
  const r = swapFood({ from: chicken, fromQty: 150, to: shrimp });
  const want = (150 * 22.5) / 100;
  assert.ok(Math.abs(r.macros.p - want) < 1.2, `protein ${r.macros.p} vs ${want}`);
  assert.equal(r.match, 'p');
  assert.ok(r.delta.f < 0, 'shrimp is leaner than chicken breast');
});

test('swap: carb source matched on carbs, fat source on fat', () => {
  const rice = idx.get('rice-white-raw');
  const pasta = idx.get('pasta-dry');
  const r = swapFood({ from: rice, fromQty: 100, to: pasta });
  assert.equal(r.match, 'c');
  assert.ok(Math.abs(r.macros.c - 80) < 3);
  const oil = idx.get('olive-oil');
  const av = swapFood({ from: oil, fromQty: 15, to: idx.get('avocado') });
  assert.equal(av.match, 'f');
  assert.ok(Math.abs(av.macros.f - 15) < 1);
});

test('swap refuses impossible matches with a clear message', () => {
  const r = swapFood({ from: idx.get('olive-oil'), fromQty: 10, to: idx.get('rice-white-raw'), match: 'f' });
  assert.match(r.error, /almost no fat/);
  assert.match(swapFood({ from: idx.get('rice-white-raw'), fromQty: 100, to: idx.get('banana'), match: 'f' }).error || '', /fat/);
});

test('suggestSwaps ranks same-category foods and skips estimates', () => {
  const list = suggestSwaps(idx, idx.get('chicken-breast-raw'), 150, { limit: 5 });
  assert.equal(list.length, 5);
  assert.ok(list.every((s) => s.food.cat === 'protein' && !s.food.est));
  assert.ok(list[0].drift <= list[4].drift);
});

test('roundQty uses sensible steps', () => {
  assert.equal(roundQty(143.2, { unit: 'g' }), 145);
  assert.equal(roundQty(14.4, { unit: 'g' }), 14);
  assert.equal(roundQty(1.1, { unit: 'serving' }), 1);
  assert.equal(roundQty(0.01, { unit: 'serving' }), 0.25);
});

test('scaleItems is idempotent when already on target', () => {
  const items = [
    { foodId: 'chicken-breast-raw', qty: 200 },
    { foodId: 'rice-white-raw', qty: 90 },
    { foodId: 'olive-oil', qty: 10 },
  ];
  const now = sumMacros(items.map((i) => foodMacros(idx.get(i.foodId), i.qty)));
  const r = scaleItems(items, now, idx);
  for (let i = 0; i < items.length; i++) {
    assert.ok(Math.abs(r.items[i].qty - items[i].qty) <= items[i].qty * 0.06, `${items[i].foodId}: ${r.items[i].qty}`);
  }
});

test('scaleItems hits a new target within a few grams', () => {
  const items = [
    { foodId: 'chicken-breast-raw', qty: 200 },
    { foodId: 'rice-white-raw', qty: 90 },
    { foodId: 'avocado', qty: 60 },
  ];
  const target = { p: 40, c: 45, f: 8 };
  const r = scaleItems(items, target, idx);
  assert.ok(Math.abs(r.totals.p - target.p) < 4, `p ${r.totals.p}`);
  assert.ok(Math.abs(r.totals.c - target.c) < 5, `c ${r.totals.c}`);
  assert.ok(Math.abs(r.totals.f - target.f) < 3, `f ${r.totals.f}`);
});

test('scaleItems never returns negative amounts and notes removed foods', () => {
  const items = [{ foodId: 'chicken-breast-raw', qty: 200 }, { foodId: 'olive-oil', qty: 15 }];
  const r = scaleItems(items, { p: 40, c: 0, f: 0 }, idx);
  assert.ok(r.items.every((i) => i.qty > 0));
  assert.ok(r.notes.some((n) => /olive oil/i.test(n)));
});

test('rebalanceMeals shrinks the rest of the day after an off-plan meal', () => {
  const dinner = [{ foodId: 'chicken-breast-raw', qty: 200 }, { foodId: 'rice-white-raw', qty: 90 }];
  const plannedDay = sumMacros(dinner.map((i) => foodMacros(idx.get(i.foodId), i.qty)));
  const remaining = { p: plannedDay.p * 0.5, c: plannedDay.c * 0.5, f: plannedDay.f * 0.5 };
  const r = rebalanceMeals(remaining, [{ slot: 'dinner', items: dinner }], idx);
  const only = r.meals[0].scaled;
  assert.ok(only.items[0].qty < 200 * 0.6 && only.items[0].qty > 200 * 0.4);
  assert.ok(only.items[1].qty < 90 * 0.6);
  assert.deepEqual(r.overshoot, { p: 0, c: 0, f: 0 });
});

test('rebalanceMeals reports overshoot when you are already over', () => {
  const meal = [{ foodId: 'rice-white-raw', qty: 100 }];
  const r = rebalanceMeals({ p: 20, c: -30, f: 5 }, [{ slot: 'dinner', items: meal }], idx);
  assert.equal(r.overshoot.c, 30);
  assert.equal(r.meals[0].scaled.items.length, 0, 'carb food removed because carbs are already over');
});

test('matchMacroFor maps categories', () => {
  assert.equal(matchMacroFor({ cat: 'protein' }), 'p');
  assert.equal(matchMacroFor({ cat: 'fruit' }), 'c');
  assert.equal(matchMacroFor({ cat: 'fat' }), 'f');
  assert.equal(matchMacroFor({ cat: 'dish' }), 'kcal');
});

test('TDEE calculator follows the lean-mass method', () => {
  // Fictitious profile, hand-checked.
  assert.equal(weightAt10Pct({ weightKg: 80, bfPct: 25 }), 67); // 60 / 0.9 = 66.7
  assert.equal(weightAt10Pct({ weightKg: 80, heightCm: 180, sex: 'M' }), 70);
  assert.equal(bmr({ sex: 'M', age: 30, heightCm: 180, weightKg: 67 }), 670 + 1125 - 150 + 5);
  assert.equal(bmr({ sex: 'F', age: 30, heightCm: 165, weightKg: 55 }), 1270); // 550 + 1031.25 - 150 - 161 = 1270.25
  assert.equal(metKcal({ met: 10, weightKg: 80, minutes: 30 }), 400);
  const r = calculate({ sex: 'M', age: 30, heightCm: 180, weightKg: 80, bfPct: 25, activityKcal: 400, liftKcal: 300, cardio: { met: 10, minutes: 30 } });
  assert.equal(r.tdee.lift - r.tdee.rest, 300);
  assert.equal(r.tdee.lift_cardio - r.tdee.rest, 300 + 400);
  for (const t of Object.values(r.targets)) {
    assert.equal(t.kcal, t.p * 4 + t.c * 4 + t.f * 9);
  }
});

test('deriveTarget: fat is a share of energy, carbs fill the rest', () => {
  const t = deriveTarget({ tdee: 2000, protein: 150 });
  assert.equal(t.f, Math.round((2000 * 0.2) / 9));
  assert.ok(Math.abs(t.kcal - 2000) <= 20, 'rounded macros stay close to the TDEE');
});

test('date helpers are DST-safe and inclusive', () => {
  assert.equal(addDays('2026-03-01', 1), '2026-03-02');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(diffDays('2026-03-07', '2026-03-09'), 2);
  assert.equal(diffDays('2026-10-24', '2026-11-02'), 9);
  assert.equal(dateRange('2026-02-27', '2026-03-02').length, 4);
  assert.ok(isISO('2026-02-28'));
  assert.ok(!isISO('2026-02-30x'));
  assert.ok(!isISO('26-1-1'));
});

test('rescaleMenu re-sizes every day to new targets and does not touch the input', () => {
  const s = freshState();
  const index = indexOf(s);
  const menu = s.plan.menus.A;
  const before = JSON.stringify(menu);
  const targets = {};
  for (const [dt, d] of Object.entries(s.plan.dayTypes)) targets[dt] = { p: d.target.p, c: d.target.c - 30, f: d.target.f };
  const next = rescaleMenu(menu, targets, index);
  assert.equal(JSON.stringify(menu), before, 'input untouched');
  for (const dt of Object.keys(targets)) {
    const t = menuDayTotals({ menus: { X: next } }, index, 'X', dt);
    const old = menuDayTotals({ menus: { X: menu } }, index, 'X', dt);
    assert.ok(Math.abs(t.c - targets[dt].c) < 8, `${dt}: carbs ${t.c} vs ${targets[dt].c}`);
    assert.ok(Math.abs(t.p - targets[dt].p) < 8, `${dt}: protein ${t.p} vs ${targets[dt].p}`);
    assert.ok(t.c < old.c - 15, 'carbs went down');
  }
});

test('shoppingList totals weighed amounts across the days, using each day type', () => {
  const s = freshState();
  const index = indexOf(s);
  const list = shoppingList(s, index, TODAY, 7, TODAY);
  assert.ok(list.length >= 8);
  const sum = (id) => list.find((r) => r.food.id === id)?.qty || 0;
  // 5 lift days use the 4-meal template with chicken at lunch; compute the expected total by hand
  let want = 0;
  for (let i = 0; i < 7; i++) {
    const type = i === 3 || i === 6 ? 'rest' : 'lift';
    for (const items of Object.values(s.plan.menus.A.days[type])) for (const it of items) if (it.food === 'chicken-breast-raw') want += it.q;
  }
  assert.equal(sum('chicken-breast-raw'), want);
  assert.ok(list.every((r) => r.qty > 0 && r.days >= 1));
  s.prefs.menu = null;
  assert.deepEqual(shoppingList(s, index, TODAY, 7, TODAY), []);
});

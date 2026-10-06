import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/core/state.js';
import { mealModel, plannedItems } from '../js/ui/ctx.js';
import { slotsFor } from '../js/core/plan.js';
import { entryMacros, kcalOf } from '../js/core/macros.js';
import { freshState, indexOf, logPerfectDay, TODAY } from './helpers.mjs';

const TOMORROW = '2026-06-16';
const model = (s, date, slot, type = 'lift') => mealModel(s, date, type, slot, indexOf(s));

test('names: the plan decides until you change it', () => {
  const s = freshState();
  assert.equal(S.mealLabel(s, TODAY, 'pre'), 'Pre-workout');
  assert.equal(S.mealLabel(s, TODAY, 'breakfast'), 'Breakfast');
  assert.equal(S.mealLabel(s, TODAY, 'extra'), 'Snacks / other');
  assert.equal(S.mealLabel(s, TODAY, 'unknown-slot'), 'unknown-slot', 'an unknown slot falls back to its id, as before');
});

test('names: "just this day" changes one day and nothing else', () => {
  const s = freshState();
  S.setMealName(s, TODAY, 'pre', 'Breakfast', 'day');
  assert.equal(S.mealLabel(s, TODAY, 'pre'), 'Breakfast');
  assert.equal(S.mealLabel(s, TOMORROW, 'pre'), 'Pre-workout', 'other days are untouched');
  assert.equal(S.mealLabel(s, TODAY, 'post'), 'Post-workout', 'other meals are untouched');
  assert.equal(S.everydayMealLabel(s, 'pre'), 'Pre-workout');
  assert.equal(S.planMealLabel(s, 'pre'), 'Pre-workout');
  assert.deepEqual(s.prefs.mealNames, {}, 'nothing stored for every day');
});

test('names: "every day" changes all days, including ones with no record yet', () => {
  const s = freshState();
  S.setMealName(s, TODAY, 'pre', 'First meal', 'always');
  for (const d of [TODAY, TOMORROW, '2025-01-01', '2027-12-31']) assert.equal(S.mealLabel(s, d, 'pre'), 'First meal');
  assert.equal(S.planMealLabel(s, 'pre'), 'Pre-workout', 'the plan itself is not edited');
  assert.equal(S.everydayMealLabel(s, 'pre'), 'First meal');
  assert.equal(s.plan.slots.pre.label, 'Pre-workout');
  assert.equal(TODAY in s.days, false, 'renaming for every day creates no day record');
});

test('names: a one-day name wins over an every-day name, and removing it brings the every-day name back', () => {
  const s = freshState();
  S.setMealName(s, TODAY, 'pre', 'First meal', 'always');
  S.setMealName(s, TODAY, 'pre', 'Breakfast', 'day');
  assert.equal(S.mealLabel(s, TODAY, 'pre'), 'Breakfast');
  assert.equal(S.mealLabel(s, TOMORROW, 'pre'), 'First meal');
  S.setMealName(s, TODAY, 'pre', '', 'day');
  assert.equal(S.mealLabel(s, TODAY, 'pre'), 'First meal');
  S.setMealName(s, TODAY, 'pre', '', 'always');
  assert.equal(S.mealLabel(s, TODAY, 'pre'), 'Pre-workout', 'and removing that restores the plan name');
});

test('names: naming something what it would be called anyway stores nothing', () => {
  const s = freshState();
  S.setMealName(s, TODAY, 'pre', 'Pre-workout', 'always');
  assert.deepEqual(s.prefs.mealNames, {});
  S.setMealName(s, TODAY, 'pre', 'Breakfast', 'always');
  S.setMealName(s, TODAY, 'pre', 'Breakfast', 'day'); // same as the every-day name
  assert.deepEqual(s.days[TODAY].mealNames, {});
  S.setMealName(s, TODAY, 'pre', 'Pre-workout', 'always'); // back to the plan name clears it
  assert.deepEqual(s.prefs.mealNames, {});
});

test('names: tidied up on the way in (spaces, control characters, length), Thai and emoji kept', () => {
  assert.equal(S.cleanMealName('  Early   \n\t breakfast  '), 'Early breakfast');
  assert.equal(S.cleanMealName('Break\u0000fast\u007f'), 'Break fast');
  assert.equal(S.cleanMealName(null), '');
  assert.equal(S.cleanMealName(undefined), '');
  assert.equal(S.cleanMealName(42), '42');
  assert.equal(S.cleanMealName('x'.repeat(200)).length, S.MEAL_NAME_MAX);
  assert.equal(S.cleanMealName('อาหารเช้า'), 'อาหารเช้า');
  assert.equal(S.cleanMealName('Snack 🍌'), 'Snack 🍌');
  const s = freshState();
  S.setMealName(s, TODAY, 'pre', '   ', 'day');
  assert.deepEqual(s.days[TODAY].mealNames, {}, 'a blank name removes the rename');
  S.setMealName(s, TODAY, 'pre', 'y'.repeat(100), 'day');
  assert.equal(s.days[TODAY].mealNames.pre.length, S.MEAL_NAME_MAX);
});

test('names: renaming changes only the label, never what is planned or logged', () => {
  const s = freshState();
  logPerfectDay(s, TODAY);
  const before = JSON.stringify(s.days[TODAY].entries);
  const planned = plannedItems(s, TODAY, 'lift', 'pre');
  const eaten = model(s, TODAY, 'pre').logged;
  S.setMealName(s, TODAY, 'pre', 'Breakfast', 'day');
  const m = model(s, TODAY, 'pre');
  assert.equal(m.label, 'Breakfast');
  assert.equal(m.slot, 'pre', 'the slot id is unchanged');
  assert.deepEqual(plannedItems(s, TODAY, 'lift', 'pre'), planned);
  assert.deepEqual(m.logged, eaten);
  assert.equal(JSON.stringify(s.days[TODAY].entries), before, 'logged entries are untouched');
  assert.equal(m.status, 'logged');
  assert.deepEqual(slotsFor(s.plan, 'lift'), ['pre', 'post', 'lunch', 'dinner'], 'the day type still has the same slots');
  // totals are unaffected
  const total = s.days[TODAY].entries.reduce((a, e) => a + kcalOf(entryMacros(e)), 0);
  assert.ok(total > 1500);
});

test('names: a meal named like another meal is allowed and stays distinct by slot', () => {
  const s = freshState();
  S.setMealName(s, TODAY, 'pre', 'Meal', 'day');
  S.setMealName(s, TODAY, 'post', 'Meal', 'day');
  assert.equal(model(s, TODAY, 'pre').label, 'Meal');
  assert.equal(model(s, TODAY, 'post').label, 'Meal');
  assert.notEqual(model(s, TODAY, 'pre').slot, model(s, TODAY, 'post').slot);
});

test('names: survive a backup and restore; old data without them still loads', () => {
  const s = freshState();
  S.setMealName(s, TODAY, 'pre', 'Breakfast', 'day');
  S.setMealName(s, TODAY, 'lunch', 'Big meal', 'always');
  const back = S.parseBackup(S.exportState(s), TODAY);
  assert.ok(back.ok);
  assert.equal(S.mealLabel(back.state, TODAY, 'pre'), 'Breakfast');
  assert.equal(S.mealLabel(back.state, TOMORROW, 'lunch'), 'Big meal');

  // a backup from before this feature existed
  const old = JSON.parse(S.exportState(freshState()));
  delete old.state.prefs.mealNames;
  old.state.days = { [TODAY]: { entries: [], water: 250 } };
  const r = S.parseBackup(JSON.stringify(old), TODAY);
  assert.ok(r.ok);
  assert.deepEqual(r.state.prefs.mealNames, {});
  assert.deepEqual(r.state.days[TODAY].mealNames, {});
  assert.equal(S.mealLabel(r.state, TODAY, 'pre'), 'Pre-workout');
  assert.doesNotThrow(() => S.setMealName(r.state, TODAY, 'pre', 'X', 'day'));
});

test('names: a hostile or damaged backup cannot break the labels', () => {
  const s = freshState();
  const raw = JSON.parse(S.exportState(s));
  raw.state.prefs.mealNames = { pre: '<img src=x onerror=alert(1)>', post: 12, 'bad key!': 'nope', lunch: 'Z'.repeat(5000), dinner: ['x'] };
  raw.state.days = { [TODAY]: { mealNames: 'not an object' }, [TOMORROW]: { mealNames: ['a'] }, '2026-06-17': { mealNames: JSON.parse('{"__proto__": "x", "pre": "ok"}') } };
  const r = S.parseBackup(JSON.stringify(raw), TODAY);
  assert.ok(r.ok);
  assert.deepEqual(Object.keys(r.state.prefs.mealNames).sort(), ['lunch', 'pre']);
  assert.equal(r.state.prefs.mealNames.lunch.length, S.MEAL_NAME_MAX);
  assert.equal(r.state.prefs.mealNames.pre, '<img src=x onerror=alert(1)>', 'kept as plain text (the screen escapes it)');
  assert.deepEqual(r.state.days[TODAY].mealNames, {});
  assert.deepEqual(r.state.days[TOMORROW].mealNames, {});
  assert.deepEqual(r.state.days['2026-06-17'].mealNames, { pre: 'ok' });
  assert.equal(({}).polluted, undefined);
  // and the label helpers are safe even if bad data got in some other way
  r.state.prefs.mealNames = 'oops';
  r.state.days[TODAY].mealNames = null;
  assert.equal(S.mealLabel(r.state, TODAY, 'pre'), 'Pre-workout');
  assert.doesNotThrow(() => S.setMealName(r.state, TODAY, 'pre', 'Fine', 'always'));
  assert.equal(S.mealLabel(r.state, TOMORROW, 'pre'), 'Fine');
});

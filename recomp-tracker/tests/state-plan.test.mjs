import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExamplePlan } from '../js/data/example-plan.js';
import { validatePlan, PLAN_SCHEMA, targetsOn, menuDayTotals, basicPlan } from '../js/core/plan.js';
import { calculate } from '../js/core/tdee.js';
import { buildFoodIndex } from '../js/core/foods.js';
import { cycleIndex, programDayKey, anchorForDay, resolveDayType, withCardio, withLift, freezeDayTypes } from '../js/core/schedule.js';
import * as S from '../js/core/state.js';
import { dayTotals, dayStatus } from '../js/core/stats.js';
import { freshState, indexOf, logPerfectDay, logLift, TODAY } from './helpers.mjs';

test('example plan validates with no errors or warnings', () => {
  const v = validatePlan(buildExamplePlan());
  assert.equal(v.ok, true, v.errors.join('\n'));
  assert.deepEqual(v.warnings, []);
});

test('validatePlan rejects bad input with readable messages', () => {
  assert.equal(validatePlan(null).ok, false);
  assert.match(validatePlan({ schema: 'nope' }).errors[0], /Unsupported schema/);
  const p = buildExamplePlan();
  delete p.dayTypes.lift;
  assert.match(validatePlan(p).errors.join(), /dayTypes\.lift is missing/);
  const q = buildExamplePlan();
  q.menus.A.days.rest.breakfast.push({ food: 'unobtainium', q: 10 });
  assert.match(validatePlan(q).errors.join(), /unknown food "unobtainium"/);
  const r = buildExamplePlan();
  r.program.editions.gym.days.push.push({ id: 'x', name: 'X', sets: [['bogus', 10]] });
  assert.match(validatePlan(r).errors.join(), /unknown set type "bogus"/);
  const s = buildExamplePlan();
  s.supplements.push({ ...s.supplements[0] });
  assert.match(validatePlan(s).errors.join(), /Duplicate supplement id/);
});

test('validatePlan warns when a menu is far from its target', () => {
  const p = buildExamplePlan();
  p.menus.A.days.rest.lunch = [{ food: 'rice-white-raw', q: 400 }];
  const v = validatePlan(p);
  assert.equal(v.ok, true);
  assert.ok(v.warnings.some((w) => /Menu A\/rest/.test(w)));
});

test('plan food definitions override the built-in ones', () => {
  const p = buildExamplePlan();
  p.foods.push({ id: 'banana', name: 'Banana (coach)', cat: 'fruit', p: 1, c: 21, f: 0.3 });
  const v = validatePlan(p);
  assert.equal(buildFoodIndex(v.plan.foods).get('banana').c, 21);
});

test('targets are derived from macros and every day type has slots', () => {
  const { plan } = validatePlan(buildExamplePlan());
  for (const t of Object.values(plan.dayTypes)) {
    assert.equal(t.target.kcal, t.target.p * 4 + t.target.c * 4 + t.target.f * 9);
    assert.ok(t.slots.length >= 3);
  }
});

test('program day follows the anchor and wraps in both directions', () => {
  assert.equal(cycleIndex('2026-06-15', '2026-06-15', 7), 0);
  assert.equal(cycleIndex('2026-06-21', '2026-06-15', 7), 6);
  assert.equal(cycleIndex('2026-06-22', '2026-06-15', 7), 0);
  assert.equal(cycleIndex('2026-06-14', '2026-06-15', 7), 6, 'before the anchor wraps backwards');
  const s = freshState();
  assert.equal(programDayKey(s.plan, '2026-06-15', '2026-06-15'), 'push');
  assert.equal(programDayKey(s.plan, '2026-06-18', '2026-06-15'), 'rest1');
});

test('anchorForDay makes today the chosen cycle day', () => {
  const a = anchorForDay('2026-06-18', 3, 7);
  assert.equal(cycleIndex('2026-06-18', a, 7), 2);
  assert.equal(anchorForDay('2026-03-02', 4, 7), '2026-02-27', 'crosses a month boundary');
});

test('resolveDayType: explicit > what you did > program > rest', () => {
  const s = freshState();
  assert.equal(resolveDayType(s, TODAY, TODAY), 'lift', 'push day is a lift day');
  assert.equal(resolveDayType(s, '2026-06-18', TODAY), 'rest', 'rest1 in the cycle');
  S.addCardio(s, '2026-06-10', { kind: 'Run', min: 30, kcal: 300 });
  assert.equal(resolveDayType(s, '2026-06-10', TODAY), 'cardio');
  logLift(s, '2026-06-10', 'incline-db-press', [[20, 10]]);
  assert.equal(resolveDayType(s, '2026-06-10', TODAY), 'lift_cardio');
  S.setDayType(s, '2026-06-10', 'rest');
  assert.equal(resolveDayType(s, '2026-06-10', TODAY), 'rest', 'explicit choice wins');
  assert.equal(resolveDayType(s, '2026-05-01', TODAY), 'rest', 'past days are not guessed from the program');
});

test('logging planned meals hits the day target closely', () => {
  const s = freshState();
  logPerfectDay(s, TODAY);
  const t = dayTotals(s.days[TODAY]);
  const tg = targetsOn(s.targetHistory, TODAY, 'lift');
  assert.ok(Math.abs(t.p - tg.p) < 6, `protein ${t.p} vs ${tg.p}`);
  assert.ok(Math.abs(t.kcal - tg.kcal) < 150);
  assert.ok(s.days[TODAY].entries.every((e) => e.src === 'plan'));
});

test('dayStatus: unlogged / on / off', () => {
  const s = freshState();
  const tol = s.prefs.tolerance;
  const tg = targetsOn(s.targetHistory, TODAY, 'lift');
  assert.equal(dayStatus(undefined, tg, tol).status, 'unlogged');
  logPerfectDay(s, TODAY);
  assert.equal(dayStatus(s.days[TODAY], tg, tol).status, 'on');
  S.addQuickEntry(s, TODAY, { name: 'Pizza', p: 30, c: 120, f: 50 }, 'extra');
  assert.equal(dayStatus(s.days[TODAY], tg, tol).status, 'off');
  const half = freshState();
  S.addQuickEntry(half, TODAY, { name: 'Snack', p: 10, c: 20, f: 5 }, 'extra');
  assert.equal(dayStatus(half.days[TODAY], tg, tol).status, 'unlogged', 'a single snack is not a logged day');
});

test('entries: edit quantity rescales macros; delete; quick add', () => {
  const s = freshState();
  const idx = indexOf(s);
  const e = S.addFoodEntry(s, TODAY, idx.get('chicken-breast-raw'), 100, 'lunch');
  assert.equal(e.p, 22.5);
  S.updateEntryQty(s, TODAY, e.id, 200, idx);
  assert.equal(s.days[TODAY].entries[0].p, 45);
  const q = S.addQuickEntry(s, TODAY, { name: 'Protein bar', p: 20, c: 22, f: 8 }, 'extra');
  S.updateEntryQty(s, TODAY, q.id, 2, idx);
  assert.equal(s.days[TODAY].entries[1].p, 40, 'quick entries scale their snapshot');
  S.removeEntry(s, TODAY, e.id);
  assert.equal(s.days[TODAY].entries.length, 1);
});

test('entries keep their numbers if the food database changes later', () => {
  const s = freshState();
  const idx = indexOf(s);
  const e = S.addFoodEntry(s, TODAY, idx.get('banana'), 100, 'extra');
  const before = e.c;
  s.customFoods.push({ id: 'banana', name: 'Banana', cat: 'fruit', p: 0, c: 99, f: 0 });
  assert.equal(s.days[TODAY].entries[0].c, before);
});

test('daily basics: water, weight, sleep, supplements, q-low', () => {
  const s = freshState();
  S.addWater(s, TODAY, 500);
  S.addWater(s, TODAY, -9999);
  assert.equal(s.days[TODAY].water, 0, 'water never goes negative');
  S.setWeight(s, TODAY, 74.84, 17.26);
  assert.deepEqual([s.days[TODAY].weight, s.days[TODAY].bf], [74.84, 17.3]);
  S.setWeight(s, TODAY, NaN, null);
  assert.equal(s.days[TODAY].weight, null);
  S.setSleep(s, TODAY, 7.5, 4);
  assert.deepEqual(s.days[TODAY].sleep, { h: 7.5, q: 4 });
  S.toggleSupp(s, TODAY, 'creatine');
  S.toggleSupp(s, TODAY, 'omega-3');
  S.toggleSupp(s, TODAY, 'creatine');
  assert.deepEqual(s.days[TODAY].supps, ['omega-3']);
  S.toggleQlowReason(s, TODAY, 'alcohol');
  assert.equal(s.days[TODAY].qlow.on, true);
  S.toggleQlowReason(s, TODAY, 'alcohol');
  assert.deepEqual(s.days[TODAY].qlow.reasons, []);
});

test('workout lifecycle: start, log sets, finish, cancel', () => {
  const s = freshState();
  const w = S.startWorkout(s, TODAY, 'push', 'gym', 100);
  assert.equal(w.exercises.length, 4);
  assert.equal(w.exercises[0].sets[0].type, 'feel');
  S.setWorkoutSet(s, TODAY, 0, 1, { w: '30', r: '12', done: true });
  assert.deepEqual([w.exercises[0].sets[1].w, w.exercises[0].sets[1].r, w.exercises[0].sets[1].done], [30, 12, true]);
  S.setWorkoutSet(s, TODAY, 0, 1, { w: '' });
  assert.equal(w.exercises[0].sets[1].w, null);
  S.finishWorkout(s, TODAY, 200);
  assert.equal(w.finishedAt, 200);
  S.cancelWorkout(s, TODAY);
  assert.equal(s.days[TODAY].workout, null);
  assert.equal(S.startWorkout(s, TODAY, 'push', 'nonexistent'), null);
});

test('measurements replace per date and stay sorted', () => {
  const s = freshState();
  S.saveMeasurement(s, { date: '2026-06-10', waist: '82.5', hip: 95 });
  S.saveMeasurement(s, { date: '2026-06-03', waist: 83 });
  S.saveMeasurement(s, { date: '2026-06-10', waist: 82, chest: '' });
  assert.deepEqual(s.measurements.map((m) => m.date), ['2026-06-03', '2026-06-10']);
  assert.equal(s.measurements[1].waist, 82);
  assert.equal('chest' in s.measurements[1], false, 'blank fields are dropped');
});

test('target history: old days keep the targets that applied then', () => {
  const s = freshState();
  const old = structuredClone(s.targetHistory[0].targets);
  const next = structuredClone(old);
  next.lift.c -= 25;
  next.lift.kcal = next.lift.p * 4 + next.lift.c * 4 + next.lift.f * 9;
  S.setTargets(s, '2026-06-10', next);
  assert.equal(targetsOn(s.targetHistory, '2026-06-09', 'lift').c, old.lift.c);
  assert.equal(targetsOn(s.targetHistory, '2026-06-10', 'lift').c, old.lift.c - 25);
  assert.equal(targetsOn(s.targetHistory, '2026-07-01', 'lift').c, old.lift.c - 25);
  S.setTargets(s, '2026-06-10', old);
  assert.equal(s.targetHistory.length, 2, 'same-day edit replaces rather than appends');
});

test('backup round-trips and rejects junk', () => {
  const s = freshState();
  logPerfectDay(s, TODAY);
  S.saveMeasurement(s, { date: TODAY, waist: 80 });
  const text = S.exportState(s);
  const r = S.parseBackup(text, TODAY);
  assert.equal(r.ok, true);
  assert.deepEqual(r.state.days[TODAY].entries, s.days[TODAY].entries);
  assert.equal(r.state.measurements.length, 1);
  assert.equal(S.parseBackup('not json', TODAY).ok, false);
  assert.equal(S.parseBackup('{"app":"other"}', TODAY).ok, false);
  assert.match(S.parseBackup(JSON.stringify({ app: 'recomp-tracker', state: { v: 999 } }), TODAY).error, /newer version/);
  const sparse = S.parseBackup(JSON.stringify({ app: 'recomp-tracker', state: { v: 1, days: { '2026-01-01': { water: 500 } } } }), TODAY);
  assert.equal(sparse.ok, true);
  assert.deepEqual(sparse.state.days['2026-01-01'].entries, [], 'missing fields are filled in');
  assert.equal(sparse.state.prefs.tolerance.kcal, 150);
});

test('menuDayTotals sums a whole menu day', () => {
  const s = freshState();
  const t = menuDayTotals(s.plan, indexOf(s), 'A', 'lift');
  assert.ok(t.p > 150 && t.kcal > 2000);
});

test('plan schema constant is stable', () => assert.equal(PLAN_SCHEMA, 'recomp-tracker-plan/1'));

test('re-importing a plan keeps past targets and applies new ones from today', () => {
  const s = freshState();
  const old = s.targetHistory[0].targets.lift.c;
  const next = buildExamplePlan();
  next.dayTypes.lift.target.c = old + 40;
  S.applyPlan(s, validatePlan(next).plan, TODAY);
  assert.equal(targetsOn(s.targetHistory, '2026-06-01', 'lift').c, old, 'earlier days keep the old targets');
  assert.equal(targetsOn(s.targetHistory, TODAY, 'lift').c, old + 40);
});

test('basicPlan builds a valid target-only plan from the calculator', () => {
  const calc = calculate({ sex: 'F', age: 28, heightCm: 165, weightKg: 60, bfPct: 24, activityKcal: 350, liftKcal: 250, cardio: { met: 7, minutes: 40 } });
  const raw = basicPlan({ profile: { name: 'Sam', sex: 'F', age: 28, heightCm: 165, weightKg: 60, bfPct: 24 }, targets: calc.targets, tdee: calc.tdee });
  const v = validatePlan(raw);
  assert.equal(v.ok, true, v.errors.join());
  assert.equal(v.plan.menus && Object.keys(v.plan.menus).length, 0);
  assert.equal(v.plan.program, null);
  assert.equal(v.plan.dayTypes.lift.slots.length, 4);
  const s = S.defaultState(TODAY);
  S.applyPlan(s, v.plan, TODAY);
  assert.equal(s.prefs.menu, null);
  assert.equal(s.prefs.edition, null);
  assert.deepEqual(s.prefs.supplementIds, []);
});

test('regression: editing the weight alone keeps the body-fat reading', () => {
  const s = freshState();
  S.setWeight(s, TODAY, 75, 17.5);
  S.setWeight(s, TODAY, 74.6); // bf omitted
  assert.deepEqual([s.days[TODAY].weight, s.days[TODAY].bf], [74.6, 17.5]);
  S.setWeight(s, TODAY, 74.6, null); // explicit null clears it
  assert.equal(s.days[TODAY].bf, null);
});

test('withCardio / withLift upgrade a hand-picked day type', () => {
  assert.deepEqual(['rest', 'lift', 'cardio', 'lift_cardio'].map(withCardio), ['cardio', 'lift_cardio', 'cardio', 'lift_cardio']);
  assert.deepEqual(['rest', 'lift', 'cardio', 'lift_cardio'].map(withLift), ['lift', 'lift', 'lift_cardio', 'lift_cardio']);
});

test('cardio on a scheduled lifting day is Lift + Cardio, even before you have lifted', () => {
  const s = freshState();
  assert.equal(resolveDayType(s, TODAY, TODAY), 'lift');
  S.addCardio(s, TODAY, { kind: 'Run', min: 30, kcal: 300 });
  assert.equal(resolveDayType(s, TODAY, TODAY), 'lift_cardio');
  const rest = '2026-06-18'; // a rest day in the cycle
  S.addCardio(s, rest, { kind: 'Walk', min: 30, kcal: 120 });
  assert.equal(resolveDayType(s, rest, TODAY), 'cardio', 'rest day + cardio is a cardio day');
});

test('past days never read the schedule, so shifting the schedule cannot rewrite them', () => {
  const s = freshState();
  const past = '2026-06-12'; // before TODAY; the cycle says lift (day index 4 = upper)
  logPerfectDay(s, past, past); // food only, no workout, no explicit type yet
  delete s.days[past].type;
  assert.equal(resolveDayType(s, past, TODAY), 'rest', 'unfrozen past day falls back to what was logged');
  assert.equal(freezeDayTypes(s, TODAY), 1);
  const frozen = s.days[past].type;
  assert.equal(frozen, 'lift', 'frozen using the schedule that was in force when the day ended');
  S.setProgramDay(s, TODAY, 4); // shift the schedule
  assert.equal(resolveDayType(s, past, TODAY), frozen, 'frozen day is unchanged by the shift');
  assert.equal(freezeDayTypes(s, TODAY), 0, 'idempotent');
});

test('freezeDayTypes skips today, empty days and days with an explicit type', () => {
  const s = freshState();
  logPerfectDay(s, TODAY);
  delete s.days[TODAY].type;
  S.addWater(s, '2026-06-10', 500); // water only: not a tracked day
  S.setDayType(s, '2026-06-11', 'cardio');
  S.addQuickEntry(s, '2026-06-11', { name: 'x', p: 1 }, 'extra');
  assert.equal(freezeDayTypes(s, TODAY), 0);
  assert.equal(s.days[TODAY].type, undefined);
  assert.equal(s.days['2026-06-11'].type, 'cardio');
});

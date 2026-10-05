import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExamplePlan } from '../js/data/example-plan.js';
import { validatePlan } from '../js/core/plan.js';
import { evaluateReview, applySuggestion, THRESHOLDS } from '../js/core/review.js';
import { weekWeightStats, movingAverage, strengthCompare, lastPerformance, nextHint, exerciseVolume, cardioKcalBetween } from '../js/core/stats.js';
import * as S from '../js/core/state.js';
import { addDays } from '../js/core/dates.js';
import { freshState, fill, logLift, TODAY } from './helpers.mjs';

// The review covers the 14 days ending on END; START is its first day.
const END = '2026-06-14'; // day before TODAY
const START = addDays(END, -13);
const review = (s, extra = {}) => evaluateReview(s, { end: END, today: TODAY, ...extra });

// Weights: flat 75.0 with tiny noise that doesn't move weekly average/min.
const flat = (i) => 75 + (i % 2 ? 0.05 : -0.05);

test('regression: plans are never shared between callers', () => {
  const a = buildExamplePlan();
  a.supplements.push({ id: 'x', name: 'X' });
  a.slots.breakfast.label = 'HACKED';
  const b = buildExamplePlan();
  assert.equal(b.supplements.some((x) => x.id === 'x'), false);
  assert.equal(b.slots.breakfast.label, 'Breakfast');
  const input = buildExamplePlan();
  const snapshot = JSON.stringify(input);
  const out = validatePlan(input);
  out.plan.supplements.length = 0;
  out.plan.slots.breakfast.label = 'CHANGED';
  assert.equal(JSON.stringify(input), snapshot, 'validatePlan must not touch its input or alias it');
});

test('no data at all: HOLD, not enough history', () => {
  const r = review(freshState());
  assert.equal(r.decision, 'hold');
  assert.equal(r.why, 'not-enough-history');
});

test('stalled + good data + plan followed -> NEXT with a carbs suggestion', () => {
  const s = freshState();
  fill(s, START, 14, { weights: flat });
  const r = review(s);
  assert.equal(r.improving, false);
  assert.equal(r.steps.data.pass, true);
  assert.equal(r.steps.discipline.pass, true);
  assert.equal(r.decision, 'next');
  assert.equal(r.why, 'stalled');
  assert.equal(r.suggestion.kind, 'adjust-carbs');
  assert.equal(r.suggestion.carbs, -25);
  assert.deepEqual(r.suggestion.dayTypes, ['lift', 'lift_cardio']);
});

test('stalled but weighed on too few days -> HOLD (insufficient data)', () => {
  const s = freshState();
  fill(s, START, 14, { weights: (i) => (i % 7 < 3 ? flat(i) : null) }); // 3 of 7 each week
  const r = review(s);
  assert.equal(r.decision, 'hold');
  assert.equal(r.why, 'insufficient-data');
  assert.match(r.steps.data.reasons[0], /weighed on only 3 of 7/);
});

test('stalled but 3+ Q-low days in a week -> HOLD (insufficient data)', () => {
  const s = freshState();
  fill(s, START, 14, { weights: flat, qlow: (i) => i === 8 || i === 9 || i === 10 });
  const r = review(s);
  assert.equal(r.why, 'insufficient-data');
  assert.match(r.steps.data.reasons.join(), /3 Q-low days/);
});

test('2 Q-low days are tolerated', () => {
  const s = freshState();
  fill(s, START, 14, { weights: flat, qlow: (i) => i === 8 || i === 9 });
  assert.equal(review(s).decision, 'next');
});

test('stalled but 3+ missed days in a week -> HOLD (low discipline)', () => {
  const s = freshState();
  fill(s, START, 14, { weights: flat, perfect: (i) => !(i >= 7 && i <= 9) }); // 3 unlogged in week 2
  const r = review(s);
  assert.equal(r.decision, 'hold');
  assert.equal(r.why, 'low-discipline');
  assert.match(r.steps.discipline.reasons[0], /Week 2: 3 days unlogged or off target/);
});

test('days that have not happened yet are not counted as missed', () => {
  const s = freshState();
  const midweek = '2026-06-10';
  // review window ends in the future relative to "today"
  fill(s, addDays(midweek, -13), 14, { weights: flat, perfect: (i) => i < 10 }, midweek);
  const r = evaluateReview(s, { end: midweek, today: addDays(midweek, -4) });
  assert.ok(r.weeks[1].misses <= 2, `misses ${r.weeks[1].misses}`);
});

test('a steady bias over target is low discipline even if no single day is off', () => {
  const s = freshState();
  fill(s, START, 14, { weights: flat });
  // add ~120 kcal every day: within the +/-150 daily tolerance but over the 100 average
  for (let i = 0; i < 14; i++) S.addQuickEntry(s, addDays(START, i), { name: 'Extra', c: 30 }, 'extra');
  const r = review(s);
  assert.equal(r.why, 'low-discipline');
  assert.match(r.steps.discipline.reasons.join(), /over target/);
});

test('waist down -> HOLD (improving) even though weight is flat', () => {
  const s = freshState();
  fill(s, START, 14, { weights: flat });
  S.saveMeasurement(s, { date: addDays(START, -1), waist: 82.0 });
  S.saveMeasurement(s, { date: END, waist: 81.0 });
  const r = review(s);
  assert.equal(r.decision, 'hold');
  assert.equal(r.why, 'improving');
  assert.match(r.steps.results.good[0], /Waist down 1\.0 cm/);
});

test('waist change under the threshold does not count', () => {
  const s = freshState();
  fill(s, START, 14, { weights: flat });
  S.saveMeasurement(s, { date: addDays(START, -1), waist: 82.0 });
  S.saveMeasurement(s, { date: END, waist: 81.8 });
  assert.equal(review(s).decision, 'next');
});

test('body-fat reading down (average) -> HOLD', () => {
  const s = freshState();
  fill(s, START, 14, { weights: flat, bf: (i) => (i < 7 ? 18.0 : 17.4) });
  const r = review(s);
  assert.equal(r.why, 'improving');
  assert.match(r.steps.results.good.join(), /Body-fat reading down/);
});

test('cut: only the weekly MAX dropping does not count as progress', () => {
  const s = freshState();
  s.plan.phase = 'cut';
  // Week 1 has one high reading (max 76.0, avg 75.14); week 2 is flat 75.0.
  // The max fell by a full kg, but the average only fell 0.14 and the min did not move.
  fill(s, START, 14, { weights: (i) => (i === 3 ? 76.0 : 75.0) });
  const w1 = weekWeightStats(s.days, START);
  const w2 = weekWeightStats(s.days, addDays(START, 7));
  assert.equal(w1.max - w2.max, 1.0);
  assert.ok(w1.avg - w2.avg < THRESHOLDS.weightKg, 'average moved less than the threshold');
  assert.equal(w1.min, w2.min);
  assert.equal(review(s).improving, false, 'a falling max alone is not progress');
  // ...whereas the same shape with the AVERAGE falling enough is progress
  const t = freshState();
  t.plan.phase = 'cut';
  fill(t, START, 14, { weights: (i) => (i < 7 ? 75.4 : 75.0) });
  assert.equal(review(t).improving, true);
});

test('recomp: weight alone is not a recomp signal', () => {
  const s = freshState();
  fill(s, START, 14, { weights: (i) => (i < 7 ? 75.6 : 75.0) });
  assert.equal(review(s).improving, false);
});

test('strength up on most lifts -> HOLD', () => {
  const s = freshState();
  fill(s, START, 14, { weights: flat });
  logLift(s, addDays(START, -10), 'incline-db-press', [[20, 10]]); // previous period
  logLift(s, addDays(START, -9), 'machine-chest-press', [[30, 10]]);
  logLift(s, addDays(START, 3), 'incline-db-press', [[22.5, 10]]); // current period
  logLift(s, addDays(START, 4), 'machine-chest-press', [[32.5, 10]]);
  const r = review(s);
  assert.equal(r.strength.compared, 2);
  assert.equal(r.strength.direction, 'better');
  assert.equal(r.why, 'improving');
});

test('strength dropping adds a warning rather than a decision', () => {
  const s = freshState();
  fill(s, START, 14, { weights: flat });
  logLift(s, addDays(START, -10), 'incline-db-press', [[25, 10]]);
  logLift(s, addDays(START, -9), 'machine-chest-press', [[35, 10]]);
  logLift(s, addDays(START, 3), 'incline-db-press', [[20, 10]]);
  logLift(s, addDays(START, 4), 'machine-chest-press', [[30, 10]]);
  const r = review(s);
  assert.equal(r.strength.direction, 'worse');
  assert.ok(r.warnings.some((w) => /Strength is slipping/.test(w)));
});

test('applying a NEXT suggestion lowers carbs from that date only', () => {
  const s = freshState();
  fill(s, START, 14, { weights: flat });
  const r = review(s);
  const before = structuredClone(s.targetHistory[0].targets);
  assert.equal(applySuggestion(s, r.suggestion, TODAY, S.setTargets), true);
  const now = s.targetHistory[s.targetHistory.length - 1].targets;
  assert.equal(now.lift.c, before.lift.c - 25);
  assert.equal(now.lift.kcal, before.lift.kcal - 100, 'carbs -25 g is exactly -100 kcal');
  assert.equal(now.rest.c, before.rest.c, 'rest day untouched');
  assert.equal(s.targetHistory[0].targets.lift.c, before.lift.c, 'history before the change is intact');
});

test('cut step stops at the floor and switches to cardio', () => {
  const s = freshState();
  s.plan.phase = 'cut';
  // Take training-day energy down to just above the rest-day energy (the floor):
  // another -100 kcal would cut deeper than those sessions burn.
  const t = structuredClone(s.targetHistory[0].targets);
  const restTdee = s.plan.dayTypes.rest.tdee;
  t.lift.c = Math.floor((restTdee + 90 - t.lift.p * 4 - t.lift.f * 9) / 4);
  t.lift.kcal = t.lift.p * 4 + t.lift.c * 4 + t.lift.f * 9;
  t.lift_cardio.c = 0;
  t.lift_cardio.kcal = t.lift_cardio.p * 4 + t.lift_cardio.f * 9;
  S.setTargets(s, '2026-01-01', t);
  // Every day is a rest day eaten exactly on target, so the plan was followed.
  fill(s, START, 14, { weights: flat, perfect: () => false });
  for (let i = 0; i < 14; i++) {
    const d = addDays(START, i);
    S.setDayType(s, d, 'rest');
    S.addQuickEntry(s, d, { name: 'All day', p: t.rest.p, c: t.rest.c, f: t.rest.f }, 'extra');
  }
  const r = review(s);
  assert.equal(r.decision, 'next');
  assert.equal(r.suggestion.kind, 'add-cardio');
  assert.equal(applySuggestion(s, r.suggestion, TODAY, S.setTargets), false, 'cardio advice has nothing to apply');
  // and with plenty of room above the floor it still suggests cutting carbs
  const roomy = freshState();
  roomy.plan.phase = 'cut';
  fill(roomy, START, 14, { weights: flat });
  assert.equal(review(roomy).suggestion.kind, 'adjust-carbs');
});

test('bulk: stalled adds carbs, too-fast removes them', () => {
  const stalled = freshState();
  stalled.plan.phase = 'bulk';
  fill(stalled, START, 14, { weights: flat });
  const a = review(stalled);
  assert.equal(a.decision, 'next');
  assert.equal(a.suggestion.carbs, 12.5);
  assert.equal(a.suggestion.dayTypes.length, 4);

  const fast = freshState();
  fast.plan.phase = 'bulk';
  fill(fast, START, 14, { weights: (i) => (i < 7 ? 75 : 76) });
  const b = review(fast);
  assert.equal(b.decision, 'next');
  assert.equal(b.why, 'too-fast');
  assert.equal(b.suggestion.carbs, -12.5);
});

test('bulk: weight rising slowly as planned -> HOLD', () => {
  const s = freshState();
  s.plan.phase = 'bulk';
  fill(s, START, 14, { weights: (i) => (i < 7 ? 75 : 75.25) });
  const r = review(s);
  assert.equal(r.decision, 'hold');
  assert.equal(r.why, 'improving');
});

test('cut: weekly average down -> HOLD', () => {
  const s = freshState();
  s.plan.phase = 'cut';
  fill(s, START, 14, { weights: (i) => (i < 7 ? 75 : 74.6) });
  assert.equal(review(s).why, 'improving');
});

test('sleep under 7 h is flagged as context', () => {
  const s = freshState();
  fill(s, START, 14, { weights: flat });
  for (let i = 0; i < 14; i++) S.setSleep(s, addDays(START, i), 6);
  assert.ok(review(s).warnings.some((w) => /Average sleep was 6\.0 h/.test(w)));
});

test('thresholds are overridable', () => {
  const s = freshState();
  fill(s, START, 14, { weights: flat });
  S.saveMeasurement(s, { date: addDays(START, -1), waist: 82.0 });
  S.saveMeasurement(s, { date: END, waist: 81.8 });
  assert.equal(review(s, { thresholds: { girthCm: 0.1 } }).why, 'improving');
  assert.equal(THRESHOLDS.girthCm, 0.5);
});

// ---- stats ----

test('weekWeightStats: average, min, max, missing and q-low counts', () => {
  const s = freshState();
  [80.4, 80.1, 80.6, 79.9, 80.0, 80.8, 79.8].forEach((kg, i) => S.setWeight(s, addDays('2026-06-01', i), kg));
  S.setQlow(s, '2026-06-02', true, ['salty meal']);
  const w = weekWeightStats(s.days, '2026-06-01');
  assert.equal(w.n, 7);
  assert.equal(Math.round(w.avg * 100) / 100, 80.23);
  assert.deepEqual([w.min, w.max, w.missing, w.qlowDays], [79.8, 80.8, 0, 1]);
  assert.equal(weekWeightStats(s.days, '2026-07-01').avg, null);
});

test('movingAverage needs 3 readings and uses calendar windows', () => {
  const pts = ['01', '02', '03', '04'].map((d, i) => ({ date: `2026-06-${d}`, v: 70 + i }));
  const ma = movingAverage(pts, 7);
  assert.equal(ma.length, 2);
  assert.equal(ma[0].v, 71);
  assert.equal(ma[1].v, 71.5);
});

test('strength helpers', () => {
  const s = freshState();
  logLift(s, '2026-06-01', 'incline-db-press', [[20, 10]]);
  const ex = s.days['2026-06-01'].workout.exercises[0];
  assert.equal(exerciseVolume(ex), 20 * 10 * 3 + 0, 'only working sets count: feel/warm excluded');
  const last = lastPerformance(s.days, 'incline-db-press', '2026-06-05');
  assert.equal(last.date, '2026-06-01');
  assert.equal(lastPerformance(s.days, 'incline-db-press', '2026-06-01'), null, 'strictly before');
  assert.equal(lastPerformance(s.days, 'nope', '2026-06-05'), null);
  assert.deepEqual(nextHint({ w: 20, r: 12 }, 12).w, 21, 'hit the target: add a little weight');
  assert.equal(nextHint({ w: 20, r: 9 }, 12).r, 10, 'missed the target: add a rep');
  assert.equal(nextHint({ w: 60, r: 10 }, 10).w, 62.5);
  assert.equal(nextHint(null, 10), null);
  const cmp = strengthCompare(s.days, { start: '2026-06-01', end: '2026-06-07' }, { start: '2026-05-01', end: '2026-05-07' });
  assert.equal(cmp.compared, 0);
});

test('cardioKcalBetween sums a range', () => {
  const s = freshState();
  S.addCardio(s, '2026-06-01', { kind: 'Run', min: 30, kcal: 300 });
  S.addCardio(s, '2026-06-03', { kind: 'Bike', min: 45, kcal: 400 });
  S.addCardio(s, '2026-06-09', { kind: 'Run', min: 30, kcal: 999 });
  assert.equal(cardioKcalBetween(s.days, '2026-06-01', '2026-06-07'), 700);
});

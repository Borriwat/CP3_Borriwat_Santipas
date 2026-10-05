// Test helpers: build a state on the example plan and fill days with data.
import { buildExamplePlan } from '../js/data/example-plan.js';
import { validatePlan, menuSlotItems, slotsFor } from '../js/core/plan.js';
import { buildFoodIndex } from '../js/core/foods.js';
import { defaultState, applyPlan, logPlannedItems, setWeight, ensureDay, startWorkout, setWorkoutSet, finishWorkout } from '../js/core/state.js';
import { resolveDayType } from '../js/core/schedule.js';
import { addDays, dateRange } from '../js/core/dates.js';

export const TODAY = '2026-06-15';

export function freshState(today = TODAY) {
  const v = validatePlan(buildExamplePlan());
  if (!v.ok) throw new Error(v.errors.join('; '));
  const s = defaultState(today);
  applyPlan(s, v.plan, today);
  return s;
}

export const indexOf = (s) => buildFoodIndex(s.plan.foods, s.customFoods);

// Log every meal of `date` exactly as planned.
export function logPerfectDay(s, date, today = TODAY) {
  const idx = indexOf(s);
  const type = resolveDayType(s, date, today);
  ensureDay(s, date).type = type;
  for (const slot of slotsFor(s.plan, type)) {
    logPlannedItems(s, date, slot, menuSlotItems(s.plan, s.prefs.menu, type, slot), idx);
  }
}

// opts: weights(dayIndex)->kg|null, bf(dayIndex)->pct|null, perfect(dayIndex)->bool, qlow(dayIndex)->bool
export function fill(s, start, days, opts = {}, today = TODAY) {
  const { weights = () => 75, bf = () => null, perfect = () => true, qlow = () => false } = opts;
  dateRange(start, addDays(start, days - 1)).forEach((date, i) => {
    if (perfect(i)) logPerfectDay(s, date, today);
    else ensureDay(s, date);
    const w = weights(i);
    if (w != null) setWeight(s, date, w, bf(i));
    if (qlow(i)) ensureDay(s, date).qlow = { on: true, reasons: ['alcohol'] };
  });
}

// Log a finished workout for an exercise with given sets [[w, r], ...].
export function logLift(s, date, exId, sets, dayKey = 'push') {
  const w = startWorkout(s, date, dayKey, 'gym', 1);
  const ex = w.exercises.find((e) => e.id === exId) || w.exercises[0];
  const exIdx = w.exercises.indexOf(ex);
  ex.sets.forEach((st, i) => {
    const [wt, r] = sets[Math.min(i, sets.length - 1)];
    setWorkoutSet(s, date, exIdx, i, { w: wt, r, done: true });
  });
  finishWorkout(s, date, 2);
}

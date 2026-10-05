import { diffDays } from './dates.js';
import { DAY_TYPES } from './tdee.js';

// The training program is a repeating cycle (e.g. Pull, Push, Leg, Rest, Upper,
// Shoulder, Rest). `anchor` is the calendar date of cycle day 1; the day for
// any date is its distance from the anchor modulo the cycle length. Moving the
// anchor is how you "shift" the schedule when life gets in the way.

export function cycleIndex(date, anchor, length) {
  if (!anchor || !length) return 0;
  const d = diffDays(anchor, date);
  return ((d % length) + length) % length;
}

export function programDayKey(plan, date, anchor) {
  const cycle = plan?.program?.cycle;
  if (!cycle?.length) return null;
  return cycle[cycleIndex(date, anchor, cycle.length)];
}

// Make `date` be cycle day number `n` (1-based). Returns the new anchor.
export function anchorForDay(date, n, length) {
  const back = ((n - 1) % length + length) % length;
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d - back);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// Which of the four day types applies to a date?
//   1. what you explicitly chose, else
//   2. what you actually did (workout / cardio logged), else
//   3. what the program says for that date (today and future only), else rest.
export function resolveDayType(state, date, today) {
  const day = state.days[date];
  if (day?.type && DAY_TYPES.includes(day.type)) return day.type;
  const lifted = !!(day?.workout && (day.workout.finishedAt || day.workout.exercises?.some((e) => e.sets.some((s) => s.done))));
  const cardio = !!day?.cardio?.length;
  if (lifted || cardio) return lifted && cardio ? 'lift_cardio' : lifted ? 'lift' : 'cardio';
  if (date >= today && state.plan?.program) {
    const key = programDayKey(state.plan, date, state.prefs.programAnchor);
    if (key && state.plan.program.days[key].dayType === 'lift') return 'lift';
  }
  return 'rest';
}

// If the day type was chosen by hand, doing extra training should upgrade it
// (rest + cardio = cardio day, lift + cardio = lift + cardio day) so the targets match.
export const withCardio = (t) => (t === 'lift' ? 'lift_cardio' : t === 'rest' ? 'cardio' : t);
export const withLift = (t) => (t === 'cardio' ? 'lift_cardio' : t === 'rest' ? 'lift' : t);

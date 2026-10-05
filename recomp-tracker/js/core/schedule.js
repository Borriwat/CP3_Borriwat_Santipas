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

const hasLift = (day) => !!(day?.workout && (day.workout.finishedAt || day.workout.exercises?.some((e) => e.sets.some((s) => s.done))));

export function scheduledLift(state, date) {
  const key = state.plan?.program ? programDayKey(state.plan, date, state.prefs.programAnchor) : null;
  return !!key && state.plan.program.days[key].dayType === 'lift';
}

function resolve(state, date, useSchedule) {
  const day = state.days[date];
  if (day?.type && DAY_TYPES.includes(day.type)) return day.type;
  const lift = hasLift(day) || (useSchedule && scheduledLift(state, date));
  const cardio = !!day?.cardio?.length;
  return lift && cardio ? 'lift_cardio' : lift ? 'lift' : cardio ? 'cardio' : 'rest';
}

// Which of the four day types applies to a date?
//   1. what you explicitly chose, else
//   2. what you did (workout / cardio logged) combined with, for today and
//      the future, what your program schedules (so morning cardio on a lifting
//      day is Lift + Cardio, not Cardio), else rest.
// Past days never read the schedule: moving the schedule later must not
// rewrite old days. See freezeDayTypes.
export function resolveDayType(state, date, today) {
  return resolve(state, date, date >= today);
}

// Once a day is over, pin its type so later schedule changes can't alter it.
// Run on startup and when the date rolls over. Returns how many days it pinned.
export function freezeDayTypes(state, today) {
  let n = 0;
  for (const [date, day] of Object.entries(state.days)) {
    if (date >= today || day.type) continue;
    if (!(day.entries?.length || day.workout || day.cardio?.length)) continue;
    day.type = resolve(state, date, true);
    n++;
  }
  return n;
}

// If the day type was chosen by hand, doing extra training should upgrade it
// (rest + cardio = cardio day, lift + cardio = lift + cardio day) so the targets match.
export const withCardio = (t) => (t === 'lift' ? 'lift_cardio' : t === 'rest' ? 'cardio' : t);
export const withLift = (t) => (t === 'cardio' ? 'lift_cardio' : t === 'rest' ? 'lift' : t);

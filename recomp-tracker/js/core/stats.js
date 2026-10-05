import { addDays, dateRange } from './dates.js';
import { sumMacros, entryMacros, round } from './macros.js';
import { SET_TYPES } from './plan.js';

// A day counts as "logged" once it holds at least this share of the energy
// target. A day with a forgotten dinner is not a tracked day.
export const MIN_LOGGED_FRACTION = 0.4;

export const dayTotals = (day) => sumMacros((day?.entries || []).map(entryMacros));

// 'unlogged' | 'on' | 'off', plus the deltas that decided it.
export function dayStatus(day, target, tol) {
  const t = dayTotals(day);
  if (!target || t.kcal < target.kcal * MIN_LOGGED_FRACTION) return { status: 'unlogged', totals: t };
  const dk = t.kcal - target.kcal;
  const dp = t.p - target.p;
  const on = Math.abs(dk) <= tol.kcal && Math.abs(dp) <= tol.p;
  return { status: on ? 'on' : 'off', totals: t, dk, dp };
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// Seven days starting at `start`.
export function weekWeightStats(days, start) {
  const dates = dateRange(start, addDays(start, 6));
  const w = [];
  const bf = [];
  let qlowDays = 0;
  for (const d of dates) {
    const day = days[d];
    if (!day) continue;
    if (day.weight) w.push(day.weight);
    if (day.bf) bf.push(day.bf);
    if (day.qlow?.on) qlowDays++;
  }
  return {
    start,
    end: addDays(start, 6),
    n: w.length,
    missing: 7 - w.length,
    avg: avg(w),
    min: w.length ? Math.min(...w) : null,
    max: w.length ? Math.max(...w) : null,
    bfN: bf.length,
    bfAvg: avg(bf),
    bfMin: bf.length ? Math.min(...bf) : null,
    qlowDays,
  };
}

// Trailing moving average over `window` calendar days for the chart.
export function movingAverage(points, window = 7) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const from = addDays(points[i].date, -(window - 1));
    const vals = points.filter((p) => p.date >= from && p.date <= points[i].date).map((p) => p.v);
    if (vals.length >= 3) out.push({ date: points[i].date, v: round(avg(vals), 2) });
  }
  return out;
}

export function weightSeries(days, start, end) {
  return dateRange(start, end)
    .filter((d) => days[d]?.weight)
    .map((d) => ({ date: d, v: days[d].weight, qlow: !!days[d].qlow?.on }));
}

export function cardioKcalBetween(days, start, end) {
  let t = 0;
  for (const d of dateRange(start, end)) for (const c of days[d]?.cardio || []) t += c.kcal || 0;
  return t;
}

// ---- Strength -----------------------------------------------------------------

export const isWorkingSet = (s) => !!SET_TYPES[s.type]?.working;

// Volume (weight x reps) of the sets that count: working sets that were done.
export function exerciseVolume(ex) {
  let v = 0;
  for (const s of ex.sets) if (s.done && isWorkingSet(s) && s.w > 0 && s.r > 0) v += s.w * s.r;
  return v;
}

export const sessionHasData = (w) => !!w && w.exercises.some((e) => exerciseVolume(e) > 0);

// For each exercise, the mean volume per session inside a window.
function volumeByExercise(days, start, end) {
  const by = new Map();
  for (const d of dateRange(start, end)) {
    const w = days[d]?.workout;
    if (!sessionHasData(w)) continue;
    for (const ex of w.exercises) {
      const v = exerciseVolume(ex);
      if (v <= 0) continue;
      const rec = by.get(ex.id) || { id: ex.id, name: ex.name, vols: [] };
      rec.vols.push(v);
      by.set(ex.id, rec);
    }
  }
  return by;
}

/**
 * Compare how much work you did per session on each exercise in two windows.
 * "Improved" needs at least +1%; "worse" at least -3%, so noise is ignored.
 */
export function strengthCompare(days, cur, prev) {
  const a = volumeByExercise(days, cur.start, cur.end);
  const b = volumeByExercise(days, prev.start, prev.end);
  const details = [];
  for (const [id, now] of a) {
    const before = b.get(id);
    if (!before) continue;
    const nowV = avg(now.vols);
    const prevV = avg(before.vols);
    const change = (nowV - prevV) / prevV;
    details.push({ id, name: now.name, prev: prevV, cur: nowV, change, verdict: change >= 0.01 ? 'up' : change <= -0.03 ? 'down' : 'flat' });
  }
  const improved = details.filter((d) => d.verdict === 'up').length;
  const worse = details.filter((d) => d.verdict === 'down').length;
  return { compared: details.length, improved, worse, details };
}

// Most recent earlier session containing this exercise.
export function lastPerformance(days, exerciseId, beforeDate) {
  const dates = Object.keys(days).filter((d) => d < beforeDate && days[d].workout).sort().reverse();
  for (const d of dates) {
    const ex = days[d].workout.exercises.find((e) => e.id === exerciseId);
    if (ex && ex.sets.some((s) => s.done && s.w > 0)) return { date: d, sets: ex.sets };
  }
  return null;
}

// A gentle nudge: hit the rep target -> add a little weight; otherwise add a rep.
export function nextHint(last, target) {
  if (!last || !(last.w > 0) || !(last.r > 0)) return null;
  if (target && last.r >= target) {
    const inc = last.w >= 40 ? 2.5 : last.w >= 10 ? 1 : 0.5;
    return { w: round(last.w + inc, 1), r: target, text: `Hit ${last.r} reps last time: try ${round(last.w + inc, 1)} kg x ${target}` };
  }
  return { w: last.w, r: last.r + 1, text: `Try ${last.w} kg x ${last.r + 1}` };
}

export const sessionVolume = (workout) => (workout?.exercises || []).reduce((s, e) => s + exerciseVolume(e), 0);

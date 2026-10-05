// Bi-weekly review: decide HOLD (keep the plan) or NEXT (take the next step).
//
// The logic follows a simple, conservative flow you can audit:
//
//   1. Are the results moving the right way?  -> if yes: HOLD.
//   2. If they are stalled, is the *data* good enough to trust?
//        (weighed on most days, few distorted "Q-low" days)    -> if not: HOLD, fix data.
//   3. Was the plan actually *followed*?
//        (food logged and on target on most days)              -> if not: HOLD, fix consistency.
//   4. Stalled, trustworthy data, plan followed -> NEXT.
//
// "Q-low" marks a day whose scale reading is probably distorted (a huge or very
// salty meal, alcohol, bad sleep, period, travel). Those days are never deleted
// from the average; they are only counted so you can see when data is shaky.
//
// This is guidance for adjusting a diet. It is not medical advice.

import { addDays } from './dates.js';
import { weekWeightStats, dayStatus, strengthCompare } from './stats.js';
import { resolveDayType } from './schedule.js';
import { targetsOn } from './plan.js';
import { dateRange } from './dates.js';
import { DAY_TYPES } from './tdee.js';

export const THRESHOLDS = {
  weightKg: 0.2, // weekly average / minimum must move at least this much
  bfPct: 0.3, // body-fat % reading (same scale, same conditions)
  girthCm: 0.5, // waist / hip
  girthUpFast: 1.0, // bulk: waist growing this much with no growth elsewhere
  bulkWeightPerWeek: 0.5, // bulk: faster than this is probably too fast
  minWeighIns: 5, // of 7 days
  maxQlow: 2, // of 7 days
  maxMisses: 2, // unlogged or off-target days, of 7
  minMeasureGapDays: 7,
};

export const REVIEW_DAYS = 14;

const DIR = { better: 'better', flat: 'flat', worse: 'worse', unknown: 'unknown' };

export function evaluateReview(state, { end, today, thresholds = {} }) {
  const T = { ...THRESHOLDS, ...thresholds };
  const phase = state.plan?.phase || 'recomp';
  const tol = state.prefs.tolerance;
  const w1s = addDays(end, -13);
  const w2s = addDays(end, -6);
  const cur = { start: w1s, end };
  const prev = { start: addDays(w1s, -14), end: addDays(w1s, -1) };

  const weeks = [w1s, w2s].map((start) => buildWeek(state, start, today, tol));
  const [w1, w2] = weeks;

  // ---- Step 1: results ------------------------------------------------------
  const body = bodySignals(state, end, w1.weight, w2.weight, phase, T);
  const str = strengthCompare(state.days, cur, prev);
  const strengthDir =
    str.compared >= 2 ? (str.improved / str.compared >= 0.5 ? DIR.better : str.worse / str.compared >= 0.5 ? DIR.worse : DIR.flat) : DIR.unknown;

  const goodSignals = [...body.good];
  if (strengthDir === DIR.better) goodSignals.push(`Strength up on ${str.improved} of ${str.compared} lifts`);
  const tooFast = body.tooFast;
  const improving = goodSignals.length > 0;

  // ---- Step 2 & 3: causes ---------------------------------------------------
  const data = { reasons: [], pass: true };
  const disc = { reasons: [], pass: true };
  weeks.forEach((w, i) => {
    const name = `Week ${i + 1}`;
    if (w.weight.n < T.minWeighIns) data.reasons.push(`${name}: weighed on only ${w.weight.n} of 7 days (need ${T.minWeighIns}+)`);
    if (w.weight.qlowDays > T.maxQlow) data.reasons.push(`${name}: ${w.weight.qlowDays} Q-low days (max ${T.maxQlow})`);
    if (w.misses > T.maxMisses) disc.reasons.push(`${name}: ${w.misses} days unlogged or off target (max ${T.maxMisses})`);
    if (w.avgBias != null && Math.abs(w.avgBias) > tol.avgBias) {
      disc.reasons.push(`${name}: average intake ${Math.abs(Math.round(w.avgBias))} kcal/day ${w.avgBias > 0 ? 'over' : 'under'} target`);
    }
  });
  data.pass = data.reasons.length === 0;
  disc.pass = disc.reasons.length === 0;

  const anyData = weeks.some((w) => w.weight.n > 0 || w.logged > 0);

  // ---- Decision -------------------------------------------------------------
  let decision;
  let why;
  if (!anyData) {
    decision = 'hold';
    why = 'not-enough-history';
  } else if (improving && !tooFast) {
    decision = 'hold';
    why = 'improving';
  } else if (!data.pass) {
    decision = 'hold';
    why = 'insufficient-data';
  } else if (!disc.pass) {
    decision = 'hold';
    why = 'low-discipline';
  } else {
    decision = 'next';
    why = tooFast ? 'too-fast' : 'stalled';
  }

  const warnings = [];
  if (strengthDir === DIR.unknown) warnings.push('Not enough logged workouts to judge strength (need the same lifts in both periods).');
  if (body.waist.state === DIR.unknown) warnings.push('Add body measurements at least a week apart to track waist and hips.');
  if (strengthDir === DIR.worse && phase !== 'bulk') warnings.push('Strength is slipping. Check sleep, stress and whether you are eating enough before cutting further.');

  const sleep = weeks.map((w) => w.sleepAvg).filter((x) => x != null);
  const sleepAvg = sleep.length ? sleep.reduce((a, b) => a + b, 0) / sleep.length : null;
  if (sleepAvg != null && sleepAvg < 7) warnings.push(`Average sleep was ${sleepAvg.toFixed(1)} h. Aim for 7-8 h; poor sleep hides progress and hurts recovery.`);

  const suggestion = decision === 'next' ? suggest(state, phase, why) : null;

  return {
    phase, end, windows: { cur, prev, w1: w1.range, w2: w2.range },
    weeks, body, strength: { ...str, direction: strengthDir },
    steps: {
      results: { good: goodSignals, direction: improving ? DIR.better : DIR.flat, tooFast },
      data, discipline: disc,
    },
    improving, decision, why, suggestion, warnings, sleepAvg,
  };
}

function buildWeek(state, start, today, tol) {
  const weight = weekWeightStats(state.days, start);
  const dates = dateRange(start, addDays(start, 6));
  let logged = 0;
  let misses = 0;
  let kcalBias = 0;
  let biasDays = 0;
  let sleepSum = 0;
  let sleepN = 0;
  for (const d of dates) {
    const type = resolveDayType(state, d, today);
    const target = targetsOn(state.targetHistory, d, type);
    const st = dayStatus(state.days[d], target, tol);
    if (st.status === 'unlogged') {
      if (d <= today) misses++; // days that haven't happened yet are not "missed"
    } else {
      logged++;
      if (st.status === 'off') misses++;
      kcalBias += st.dk;
      biasDays++;
    }
    const s = state.days[d]?.sleep;
    if (s?.h) {
      sleepSum += s.h;
      sleepN++;
    }
  }
  return {
    range: { start, end: addDays(start, 6) },
    weight, logged, misses,
    avgBias: biasDays ? kcalBias / biasDays : null,
    sleepAvg: sleepN ? sleepSum / sleepN : null,
  };
}

// Latest measurement vs. the one at least a week before it.
function girth(measurements, end, key, gap) {
  const list = measurements.filter((m) => m.date <= end && m[key] > 0);
  if (list.length < 2) return { state: DIR.unknown };
  const latest = list[list.length - 1];
  const cutoff = addDays(latest.date, -gap);
  const base = [...list].reverse().find((m) => m.date <= cutoff);
  if (!base) return { state: DIR.unknown };
  return { state: 'ok', latest: latest[key], base: base[key], delta: latest[key] - base[key] };
}

function bodySignals(state, end, w1, w2, phase, T) {
  const m = state.measurements;
  const waist = girth(m, end, 'waist', T.minMeasureGapDays);
  const hip = girth(m, end, 'hip', T.minMeasureGapDays);
  const chest = girth(m, end, 'chest', T.minMeasureGapDays);
  const arm = girth(m, end, 'arm', T.minMeasureGapDays);
  const thigh = girth(m, end, 'thigh', T.minMeasureGapDays);

  const down = (g) => g.state === 'ok' && g.delta <= -T.girthCm;
  const up = (g) => g.state === 'ok' && g.delta >= T.girthCm;

  const wAvg = w1.avg != null && w2.avg != null ? w2.avg - w1.avg : null;
  const wMin = w1.min != null && w2.min != null ? w2.min - w1.min : null;
  const bfAvg = w1.bfAvg != null && w2.bfAvg != null && w1.bfN >= 3 && w2.bfN >= 3 ? w2.bfAvg - w1.bfAvg : null;
  const bfMin = w1.bfMin != null && w2.bfMin != null && w1.bfN >= 3 && w2.bfN >= 3 ? w2.bfMin - w1.bfMin : null;
  const wDelta = { avg: wAvg, min: wMin, bfAvg, bfMin };

  const good = [];
  let tooFast = false;

  if (phase === 'bulk') {
    if ((wAvg != null && wAvg >= 0.1) || (wMin != null && wMin >= 0.1)) good.push('Weight trending up as planned');
    if (up(chest) || up(arm) || up(thigh)) good.push('Chest / arm / thigh measurements growing');
    const gaining = wAvg != null && wAvg > T.bulkWeightPerWeek;
    const waistFast = up(waist) && waist.delta >= T.girthUpFast && !(up(chest) || up(arm) || up(thigh));
    tooFast = gaining || waistFast;
  } else if (phase === 'maintain') {
    const steady = wAvg != null && Math.abs(wAvg) < 0.5;
    if (steady) good.push('Weight steady');
  } else {
    // recomp / cut: waist or hips down, or body fat / (cut) weight down
    if (down(waist)) good.push(`Waist down ${Math.abs(waist.delta).toFixed(1)} cm`);
    if (down(hip)) good.push(`Hips down ${Math.abs(hip.delta).toFixed(1)} cm`);
    if ((bfAvg != null && bfAvg <= -T.bfPct) || (bfMin != null && bfMin <= -T.bfPct)) good.push('Body-fat reading down (weekly average or minimum)');
    if (phase === 'cut' && ((wAvg != null && wAvg <= -T.weightKg) || (wMin != null && wMin <= -T.weightKg))) {
      good.push('Weight down (weekly average or minimum)');
    }
  }
  return { good, tooFast, waist, hip, chest, arm, thigh, weight: wDelta };
}

// What to do next, using conservative fixed steps.
function suggest(state, phase, why) {
  const plan = state.plan;
  const tdee = Object.fromEntries(DAY_TYPES.map((t) => [t, plan?.dayTypes?.[t]?.tdee ?? null]));
  const last = state.targetHistory[state.targetHistory.length - 1]?.targets;

  if (phase === 'bulk') {
    if (why === 'too-fast') {
      return { kind: 'adjust-carbs', carbs: -12.5, dayTypes: [...DAY_TYPES], text: 'Gaining faster than planned (or waist growing without the rest). Take 50 kcal/day out of carbs: carbs -12.5 g on every day type. Hold two weeks, then review again.' };
    }
    return { kind: 'adjust-carbs', carbs: +12.5, dayTypes: [...DAY_TYPES], text: 'Progress has stalled with good data and consistency. Add 50 kcal/day through carbs: carbs +12.5 g on every day type. Keep protein and fat. Hold two weeks before the next change.' };
  }

  if (phase === 'maintain') {
    return { kind: 'info', text: 'Weight has drifted while you intended to maintain. Adjust intake by about 100 kcal/day (via carbs) in the opposite direction and re-check in two weeks.' };
  }

  // recomp / cut: take carbs off training days first, but never past the floor
  // (the energy those sessions burn). Beyond that, add cardio instead.
  const floorOk = (t) => tdee.rest == null || !last || last[t].kcal - 100 >= (t === 'lift' ? tdee.rest : tdee.cardio ?? tdee.rest);
  const targets = ['lift', 'lift_cardio'].filter(floorOk);
  if (targets.length) {
    return {
      kind: 'adjust-carbs', carbs: -25, dayTypes: targets,
      text: 'Stalled with trustworthy data and a followed plan. Next step: take about 100 kcal off training days, from carbs (carbs -25 g on lift and lift + cardio days). Protein and fat stay the same. Hold two weeks, then review. Before starting a full cut, recalculate your TDEE from current weight and activity.',
    };
  }
  return {
    kind: 'add-cardio',
    text: 'Training-day carbs are already near their floor (the energy those sessions burn). Next step is cardio instead of less food: start at about 750 kcal/week, then add 500 kcal/week per step, and keep sessions under about 90 minutes.',
  };
}

// Apply an `adjust-carbs` suggestion to the targets from `date` onwards.
export function applySuggestion(state, suggestion, date, setTargets) {
  if (suggestion?.kind !== 'adjust-carbs') return false;
  const last = state.targetHistory[state.targetHistory.length - 1].targets;
  const next = structuredClone(last);
  for (const t of suggestion.dayTypes) {
    next[t].c = Math.max(0, next[t].c + suggestion.carbs);
    next[t].kcal = next[t].p * 4 + next[t].c * 4 + next[t].f * 9;
  }
  setTargets(state, date, next);
  return true;
}

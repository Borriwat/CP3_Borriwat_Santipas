// Energy and macro targets from body stats, using a lean-mass based method:
//
//  1. Work out the weight you'd be at 10% body fat (fat doesn't burn energy
//     the way muscle does, so BMR is calculated on lean tissue).
//  2. BMR with Mifflin-St Jeor on that weight.
//  3. TDEE per day type = BMR + daily-activity energy
//        + weight training energy (lift days) + cardio energy (cardio days).
//  4. Protein from lean mass, fat as a share of energy, carbs fill the rest.
//
// These are starting points. Weigh yourself, track results and adjust.

import { kcalOf } from './macros.js';

export const DAY_TYPES = ['rest', 'lift', 'cardio', 'lift_cardio'];

export const DAY_TYPE_SHORT = {
  rest: 'Rest',
  lift: 'Lift',
  cardio: 'Cardio',
  lift_cardio: 'Lift+Cardio',
};

export const DAY_TYPE_LABEL = {
  rest: 'Rest',
  lift: 'Lift',
  cardio: 'Cardio',
  lift_cardio: 'Lift + Cardio',
};

export const leanMass = (weightKg, bfPct) => weightKg * (1 - bfPct / 100);

// Body weight at 10% fat, rounded to a whole kg. Falls back to a height-based
// estimate (men only) when body-fat % is unknown.
export function weightAt10Pct({ weightKg, bfPct, heightCm, sex = 'M' }) {
  if (Number.isFinite(bfPct) && bfPct > 0) return Math.round(leanMass(weightKg, bfPct) / 0.9);
  if (sex === 'M' && Number.isFinite(heightCm)) return heightCm - 110;
  return null;
}

export function bmr({ sex = 'M', age, heightCm, weightKg }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return Math.round(base + (sex === 'M' ? 5 : -161));
}

// MET-based energy: MET x body weight (kg) x hours.
export const metKcal = ({ met, weightKg, minutes }) => Math.round((met * weightKg * minutes) / 60);

export function tdeeByDayType({ bmr: b, activityKcal = 0, liftKcal = 0, cardioKcal = 0 }) {
  return {
    rest: b + activityKcal,
    lift: b + activityKcal + liftKcal,
    cardio: b + activityKcal + cardioKcal,
    lift_cardio: b + activityKcal + liftKcal + cardioKcal,
  };
}

// Protein target: grams per kg of lean-weight reference, with an optional
// bonus for fat-loss / recomp phases (muscle is easier to lose in a deficit).
export function proteinTarget({ weightAt10, perKg = 2.3, bonus = 0.1 }) {
  return Math.round(weightAt10 * perKg * (1 + bonus));
}

// From a day's energy and a protein amount: fat is a share of energy, carbs
// take what's left. Energy is then re-derived from the rounded macros.
export function deriveTarget({ tdee, protein, fatShare = 0.2 }) {
  const f = Math.round((tdee * fatShare) / 9);
  const c = Math.round((tdee - protein * 4 - f * 9) / 4);
  return { p: protein, c, f, kcal: kcalOf({ p: protein, c, f }) };
}

export function deriveAllTargets(tdees, protein, fatShare = 0.2) {
  const out = {};
  for (const k of DAY_TYPES) out[k] = deriveTarget({ tdee: tdees[k], protein, fatShare });
  return out;
}

// One call for the calculator screen.
export function calculate(input) {
  const {
    sex = 'M', age, heightCm, weightKg, bfPct,
    activityKcal = 0, liftKcal = 0, cardio = { met: 9.8, minutes: 30 },
    proteinPerKg = 2.3, proteinBonus = 0.1, proteinOverride = null, fatShare = 0.2,
  } = input;
  const w10 = weightAt10Pct({ weightKg, bfPct, heightCm, sex });
  if (!w10) throw new Error('Need body-fat % (or height for men) to estimate lean weight.');
  const b = bmr({ sex, age, heightCm, weightKg: w10 });
  const cardioKcal = metKcal({ met: cardio.met, weightKg, minutes: cardio.minutes });
  const tdee = tdeeByDayType({ bmr: b, activityKcal, liftKcal, cardioKcal });
  const protein = proteinOverride ?? proteinTarget({ weightAt10: w10, perKg: proteinPerKg, bonus: proteinBonus });
  return { weightAt10: w10, bmr: b, cardioKcal, tdee, protein, targets: deriveAllTargets(tdee, protein, fatShare) };
}

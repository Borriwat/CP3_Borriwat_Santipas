// A self-contained EXAMPLE plan for a fictitious person, used for the demo
// button, the tests and docs/PLAN_FORMAT.md. It is not anybody's real plan:
// the numbers come from the calculator and the meals are sized by the same
// scaling engine the app uses. Import your own plan file to replace it.

import { calculate } from '../core/tdee.js';
import { buildFoodIndex } from '../core/foods.js';
import { scaleItems } from '../core/scale.js';
import { PLAN_SCHEMA } from '../core/plan.js';

const PROFILE = { name: 'Alex (example)', sex: 'M', age: 30, heightCm: 178, weightKg: 78, bfPct: 18 };

const SLOTS = {
  breakfast: { label: 'Breakfast' },
  lunch: { label: 'Lunch' },
  dinner: { label: 'Dinner' },
  pre: { label: 'Pre-workout' },
  post: { label: 'Post-workout' },
};

const DAY_SLOTS = {
  rest: ['breakfast', 'lunch', 'dinner'],
  lift: ['pre', 'post', 'lunch', 'dinner'],
  cardio: ['breakfast', 'lunch', 'dinner'],
  lift_cardio: ['pre', 'post', 'lunch', 'dinner'],
};

// Share of the day's protein / carbs / fat that each meal carries.
const SHARES = {
  3: { breakfast: [0.33, 0.33, 0.33], lunch: [0.34, 0.34, 0.34], dinner: [0.33, 0.33, 0.33] },
  4: { pre: [0.16, 0.17, 0], post: [0.16, 0.17, 0], lunch: [0.34, 0.33, 0.5], dinner: [0.34, 0.33, 0.5] },
};

// Starting templates (foods and rough amounts). The scaler fixes the amounts.
const TEMPLATES = {
  A: {
    breakfast: [['egg-white', 200], ['oats-raw', 60], ['banana', 100], ['almonds', 15]],
    lunch: [['chicken-breast-raw', 180], ['rice-white-raw', 80], ['olive-oil', 8], ['broccoli', 100]],
    dinner: [['sea-bass-raw', 200], ['sweet-potato-baked', 250], ['avocado', 50]],
    pre: [['whey-concentrate', 25], ['bread-white', 80]],
    post: [['chicken-tenderloin-raw', 100], ['banana', 200]],
  },
  B: {
    breakfast: [['whey-isolate', 35], ['oats-raw', 60], ['banana', 100], ['peanut-butter', 12]],
    lunch: [['shrimp-raw', 200], ['rice-brown-raw', 80], ['olive-oil', 8], ['cabbage', 100]],
    dinner: [['chicken-breast-raw', 200], ['potato-boiled', 300], ['olive-oil', 8]],
    pre: [['whey-isolate', 25], ['bread-wholewheat', 80]],
    post: [['tuna-canned-water', 120], ['rice-white-cooked', 250]],
  },
};

// Sets are [type, reps]. Types: feel, warm, w2, w15, w1, w05, work, fail, drop.
const compound = (n = 3) => [['feel', 15], ['warm', 12], ...Array.from({ length: n }, (_, i) => [['w15', 'w1', 'w05'][i] || 'w05', 10])];
const iso = () => [['warm', 15], ['w15', 15], ['w1', 15], ['fail', 15], ['drop', 15]];

const gym = {
  push: [
    { id: 'incline-db-press', name: 'Incline dumbbell press', note: 'Bench at 30 degrees. Lower under control, press to the upper chest.', rest: 90, restAfter: 180, sets: compound(3) },
    { id: 'machine-chest-press', name: 'Machine chest press', rest: 90, restAfter: 180, sets: [['warm', 12], ['w15', 12], ['w1', 12], ['fail', 12], ['drop', 12]] },
    { id: 'lateral-raise', name: 'Dumbbell lateral raise', note: 'Light weight, lead with the elbows.', rest: 60, restAfter: 120, sets: [['fail', 20], ['drop', 10], ['fail', 20], ['drop', 10]] },
    { id: 'triceps-pushdown', name: 'Cable triceps pushdown', rest: 60, restAfter: 0, sets: iso() },
  ],
  pull: [
    { id: 'lat-pulldown', name: 'Lat pulldown', note: 'Lean back slightly, pull the elbows down to your ribs.', rest: 90, restAfter: 180, sets: compound(3) },
    { id: 'seated-row', name: 'Seated cable row', rest: 90, restAfter: 180, sets: [['warm', 12], ['w15', 12], ['w1', 12], ['fail', 12], ['drop', 12]] },
    { id: 'face-pull', name: 'Face pull', rest: 60, restAfter: 120, sets: [['warm', 15], ['w1', 15], ['fail', 15]] },
    { id: 'db-curl', name: 'Dumbbell curl', rest: 60, restAfter: 0, sets: iso() },
  ],
  legs: [
    { id: 'goblet-squat', name: 'Goblet squat', rest: 90, restAfter: 180, sets: compound(3) },
    { id: 'leg-press', name: 'Leg press', rest: 90, restAfter: 180, sets: [['warm', 12], ['w15', 12], ['w1', 12], ['w05', 12]] },
    { id: 'leg-curl', name: 'Lying leg curl', rest: 90, restAfter: 180, sets: [['warm', 12], ['w1', 12], ['fail', 12], ['drop', 12]] },
    { id: 'calf-raise', name: 'Standing calf raise', rest: 60, restAfter: 0, sets: [['warm', 15], ['w1', 15], ['fail', 15]] },
  ],
  upper: [
    { id: 'flat-db-press', name: 'Flat dumbbell press', rest: 90, restAfter: 180, sets: compound(3) },
    { id: 'chest-supported-row', name: 'Chest-supported row', rest: 90, restAfter: 180, sets: [['warm', 12], ['w15', 12], ['w1', 12], ['fail', 12]] },
    { id: 'shoulder-press', name: 'Dumbbell shoulder press', rest: 90, restAfter: 180, sets: [['warm', 12], ['w15', 12], ['w1', 12], ['fail', 12], ['drop', 12]] },
    { id: 'hammer-curl', name: 'Hammer curl', rest: 60, restAfter: 0, sets: iso() },
  ],
  lower: [
    { id: 'hip-thrust', name: 'Barbell hip thrust', rest: 90, restAfter: 180, sets: compound(3) },
    { id: 'rdl', name: 'Romanian deadlift', rest: 90, restAfter: 180, sets: [['warm', 12], ['w15', 12], ['w1', 12], ['w05', 12]] },
    { id: 'leg-extension', name: 'Leg extension', rest: 60, restAfter: 120, sets: [['warm', 12], ['w1', 12], ['fail', 12], ['drop', 12]] },
    { id: 'seated-calf', name: 'Seated calf raise', rest: 60, restAfter: 0, sets: [['warm', 15], ['w1', 15], ['fail', 15]] },
  ],
};

const SUPPLEMENTS = [
  { id: 'creatine', name: 'Creatine monohydrate', dose: '5 g', timing: 'morning', base: true, note: 'Every day, no cycling needed. Example entry.' },
  { id: 'vitamin-d3', name: 'Vitamin D3', dose: '1 capsule', timing: 'morning', base: true, note: 'With a meal that has some fat. Example entry.' },
  { id: 'omega-3', name: 'Fish oil (EPA + DHA)', dose: '2 softgels', timing: 'midday', base: true, note: 'Example entry.' },
  { id: 'whey', name: 'Whey protein', dose: '1 scoop', timing: 'post', note: 'Counts toward your protein: log it as food too.' },
  { id: 'magnesium', name: 'Magnesium glycinate', dose: '2 capsules', timing: 'sleep', base: true, note: 'Example entry.' },
];

export function buildExamplePlan() {
  const calc = calculate({
    ...PROFILE,
    activityKcal: 400,
    liftKcal: 300,
    cardio: { met: 8, minutes: 30 },
  });
  const index = buildFoodIndex();

  const dayTypes = {};
  for (const [dt, slots] of Object.entries(DAY_SLOTS)) {
    dayTypes[dt] = { target: { p: calc.targets[dt].p, c: calc.targets[dt].c, f: calc.targets[dt].f }, tdee: calc.tdee[dt], slots };
  }

  const menus = {};
  for (const [menuId, tpl] of Object.entries(TEMPLATES)) {
    const days = {};
    for (const [dt, slots] of Object.entries(DAY_SLOTS)) {
      const tg = calc.targets[dt];
      const shares = SHARES[slots.length];
      days[dt] = {};
      for (const slot of slots) {
        const [sp, sc, sf] = shares[slot];
        const items = tpl[slot].map(([foodId, qty]) => ({ foodId, qty }));
        const scaled = scaleItems(items, { p: tg.p * sp, c: tg.c * sc, f: tg.f * sf }, index);
        days[dt][slot] = scaled.items.map((i) => ({ food: i.foodId, q: i.qty }));
      }
    }
    menus[menuId] = { label: menuId === 'A' ? 'Menu A' : 'Menu B', days };
  }

  const dayDefs = {
    push: { label: 'Push', dayType: 'lift' },
    pull: { label: 'Pull', dayType: 'lift' },
    legs: { label: 'Legs', dayType: 'lift' },
    rest1: { label: 'Rest', dayType: 'rest' },
    upper: { label: 'Upper', dayType: 'lift' },
    lower: { label: 'Lower', dayType: 'lift' },
    rest2: { label: 'Rest', dayType: 'rest' },
  };

  // Fresh copy every time: callers are free to modify what they get back.
  return structuredClone({
    schema: PLAN_SCHEMA,
    name: 'Example plan (fictitious)',
    source: 'Generated by the app for demonstration. Not real advice for anyone.',
    profile: PROFILE,
    phase: 'recomp',
    slots: SLOTS,
    dayTypes,
    foods: [],
    menus,
    program: {
      name: 'Push / Pull / Legs / Rest / Upper / Lower / Rest',
      cycle: Object.keys(dayDefs),
      days: dayDefs,
      editions: { gym: { label: 'Gym', days: gym } },
    },
    supplements: SUPPLEMENTS,
    cardio: { weeklyKcalGoal: 0, met: 8 },
    hydration: { goalMl: 3000 },
  });
}

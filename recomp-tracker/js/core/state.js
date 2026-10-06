// App state and the functions that change it. Everything here is plain data
// plus plain functions (no DOM, no storage) so it can be tested in Node.

import { makeEntry, newId, round } from './macros.js';
import { anchorForDay } from './schedule.js';
import { DAY_TYPES } from './tdee.js';
import { normalizeFood } from './foods.js';
import { slotLabel } from './plan.js';

export const STATE_VERSION = 1;

export function defaultState(today) {
  return {
    v: STATE_VERSION,
    createdAt: today,
    plan: null,
    targetHistory: [],
    prefs: {
      theme: 'auto',
      menu: null,
      edition: null,
      waterGoalMl: 3000,
      supplementIds: null,
      programAnchor: today,
      tolerance: { kcal: 150, p: 10, avgBias: 100 },
      weighTime: '07:00',
      sex: 'M',
      mealNames: {}, // slot -> name, for every day
    },
    days: {},
    measurements: [],
    customFoods: [],
    reviews: [],
  };
}

export const blankDay = () => ({
  type: null,
  entries: [],
  adjust: {},
  water: 0,
  sleep: null,
  weight: null,
  bf: null,
  qlow: { on: false, reasons: [] },
  notes: '',
  supps: [],
  workout: null,
  cardio: [],
  mealNames: {}, // slot -> name, for this day only
});

export const getDay = (state, date) => state.days[date] || blankDay();

export function ensureDay(state, date) {
  if (!state.days[date]) state.days[date] = blankDay();
  return state.days[date];
}

// ---- Plan -------------------------------------------------------------------

export function applyPlan(state, plan, today) {
  state.plan = plan;
  // First plan: targets apply to all time. Replacing a plan later must not
  // rewrite past days, so the new targets only take effect from today.
  if (state.targetHistory.length) setTargets(state, today, targetsFromPlan(plan));
  else state.targetHistory = [{ from: '1970-01-01', targets: targetsFromPlan(plan) }];
  const menuIds = Object.keys(plan.menus || {});
  state.prefs.menu = menuIds.includes(state.prefs.menu) ? state.prefs.menu : menuIds[0] || null;
  const editions = Object.keys(plan.program?.editions || {});
  state.prefs.edition = editions.includes(state.prefs.edition) ? state.prefs.edition : editions[0] || null;
  state.prefs.supplementIds = plan.supplements.filter((s) => s.base).map((s) => s.id);
  state.prefs.waterGoalMl = plan.hydration?.goalMl || 3000;
  state.prefs.programAnchor = state.prefs.programAnchor || today;
  if (plan.profile?.sex) state.prefs.sex = plan.profile.sex;
}

export const targetsFromPlan = (plan) =>
  Object.fromEntries(DAY_TYPES.map((t) => [t, { ...plan.dayTypes[t].target }]));

// Targets apply from `from` onwards; earlier days keep the targets that were in
// force at the time, which keeps old adherence honest.
export function setTargets(state, from, targets) {
  const last = state.targetHistory[state.targetHistory.length - 1];
  const entry = { from, targets: structuredClone(targets) };
  if (last && last.from === from) state.targetHistory[state.targetHistory.length - 1] = entry;
  else state.targetHistory.push(entry);
  state.targetHistory.sort((a, b) => (a.from < b.from ? -1 : 1));
}

export function setProgramDay(state, today, n) {
  const len = state.plan?.program?.cycle?.length;
  if (len) state.prefs.programAnchor = anchorForDay(today, n, len);
}

// ---- Meal names ------------------------------------------------------------
// A meal is a slot (breakfast, pre, lunch...). Its name can be changed for one day
// or for every day. Only the name changes: the slot, its planned foods and
// anything already logged stay exactly as they were.

export const MEAL_NAME_MAX = 40;

export const cleanMealName = (text) =>
  String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MEAL_NAME_MAX).trim();

// Keep only well-formed { slot: 'Name' } pairs (a backup file is untrusted input).
export function cleanMealNames(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([k, v]) => /^[A-Za-z0-9_.-]{1,64}$/.test(k) && k !== '__proto__' && typeof v === 'string' && cleanMealName(v))
      .map(([k, v]) => [k, cleanMealName(v)])
  );
}

// The name the plan itself gives the meal.
export const planMealLabel = (state, slot) => slotLabel(state.plan, slot);
// The name used on every day without a one-day rename (the plan's, unless changed for every day).
export const everydayMealLabel = (state, slot) => cleanMealName(state.prefs.mealNames?.[slot]) || planMealLabel(state, slot);
// The name shown for a meal on a given day.
export const mealLabel = (state, date, slot) => cleanMealName(state.days[date]?.mealNames?.[slot]) || everydayMealLabel(state, slot);

// scope 'day' renames it on `date` only; 'always' renames it on every day. An empty
// name, or one that matches what it would be anyway, removes the rename.
export function setMealName(state, date, slot, name, scope = 'day') {
  const clean = cleanMealName(name);
  if (scope === 'always') {
    state.prefs.mealNames = cleanMealNames(state.prefs.mealNames);
    if (!clean || clean === planMealLabel(state, slot)) delete state.prefs.mealNames[slot];
    else state.prefs.mealNames[slot] = clean;
    return;
  }
  const d = ensureDay(state, date);
  d.mealNames = cleanMealNames(d.mealNames);
  if (!clean || clean === everydayMealLabel(state, slot)) delete d.mealNames[slot];
  else d.mealNames[slot] = clean;
}

// ---- Food log ---------------------------------------------------------------

export function addEntry(state, date, entry) {
  ensureDay(state, date).entries.push(entry);
  return entry;
}

export function addFoodEntry(state, date, food, qty, slot, src = 'food') {
  return addEntry(state, date, makeEntry(food, qty, { slot, src }));
}

export function updateEntryQty(state, date, id, qty, index) {
  const e = state.days[date]?.entries.find((x) => x.id === id);
  const food = e && index?.get(e.foodId);
  if (!e || qty <= 0) return;
  if (food) {
    const n = makeEntry(food, qty, { slot: e.slot, src: e.src, id: e.id });
    Object.assign(e, { qty: n.qty, p: n.p, c: n.c, f: n.f, a: n.a });
  } else {
    // quick-add / deleted food: scale the snapshot proportionally
    const k = qty / (e.qty || 1);
    Object.assign(e, { qty: round(qty, 2), p: round(e.p * k, 2), c: round(e.c * k, 2), f: round(e.f * k, 2), a: round(e.a * k, 2) });
  }
}

export function removeEntry(state, date, id) {
  const d = state.days[date];
  if (d) d.entries = d.entries.filter((e) => e.id !== id);
}

export function addQuickEntry(state, date, { name, p = 0, c = 0, f = 0, a = 0 }, slot) {
  return addEntry(state, date, {
    id: newId(), slot, foodId: null, name: name || 'Quick add', unit: 'serving', qty: 1,
    p: round(p, 2), c: round(c, 2), f: round(f, 2), a: round(a, 2), src: 'quick', est: false,
  });
}

// A food entered from an AI photo estimate: macros only, flagged as an estimate.
export function addEstimateEntry(state, date, { name, p = 0, c = 0, f = 0, a = 0 }, slot) {
  return addEntry(state, date, {
    id: newId(), slot, foodId: null, name: name || 'Photo estimate', unit: 'serving', qty: 1,
    p: round(p, 2), c: round(c, 2), f: round(f, 2), a: round(a, 2), src: 'ai', est: true,
  });
}

// Log a meal exactly as planned (or as adjusted for today).
export function logPlannedItems(state, date, slot, items, index, src = 'plan') {
  const out = [];
  for (const it of items) {
    const food = index.get(it.foodId);
    if (food) out.push(addFoodEntry(state, date, food, it.qty, slot, src));
  }
  return out;
}

export function setAdjust(state, date, slot, items) {
  const d = ensureDay(state, date);
  if (items) d.adjust[slot] = items;
  else delete d.adjust[slot];
}

export function addCustomFood(state, food) {
  const f = normalizeFood({ ...food, id: food.id || `custom-${newId()}`, custom: true });
  const i = state.customFoods.findIndex((x) => x.id === f.id);
  if (i >= 0) state.customFoods[i] = f;
  else state.customFoods.push(f);
  return f;
}

export const removeCustomFood = (state, id) => {
  state.customFoods = state.customFoods.filter((f) => f.id !== id);
};

// ---- Daily basics -----------------------------------------------------------

export function setDayType(state, date, type) {
  ensureDay(state, date).type = DAY_TYPES.includes(type) ? type : null;
}

export function addWater(state, date, ml) {
  const d = ensureDay(state, date);
  d.water = Math.max(0, (d.water || 0) + ml);
}

// `bf` undefined leaves the body-fat reading alone; null (or invalid) clears it.
export function setWeight(state, date, kg, bf) {
  const d = ensureDay(state, date);
  d.weight = Number.isFinite(kg) && kg > 0 ? round(kg, 2) : null;
  if (bf !== undefined) d.bf = Number.isFinite(bf) && bf > 0 ? round(bf, 1) : null;
}

export function setSleep(state, date, hours, quality = null) {
  const d = ensureDay(state, date);
  d.sleep = Number.isFinite(hours) && hours > 0 ? { h: round(hours, 2), q: quality } : null;
}

export function toggleSupp(state, date, id) {
  const d = ensureDay(state, date);
  d.supps = d.supps.includes(id) ? d.supps.filter((x) => x !== id) : [...d.supps, id];
}

export function setQlow(state, date, on, reasons) {
  const d = ensureDay(state, date);
  d.qlow = { on: !!on, reasons: reasons ?? d.qlow.reasons };
}

export function toggleQlowReason(state, date, reason) {
  const d = ensureDay(state, date);
  const has = d.qlow.reasons.includes(reason);
  d.qlow.reasons = has ? d.qlow.reasons.filter((r) => r !== reason) : [...d.qlow.reasons, reason];
  d.qlow.on = d.qlow.reasons.length > 0 || d.qlow.on;
}

export const setNotes = (state, date, text) => {
  ensureDay(state, date).notes = String(text || '').slice(0, 2000);
};

// ---- Workouts ---------------------------------------------------------------

export function startWorkout(state, date, dayKey, edition, now = Date.now()) {
  const exercises = state.plan?.program?.editions?.[edition]?.days?.[dayKey];
  if (!exercises) return null;
  const d = ensureDay(state, date);
  d.workout = {
    dayKey,
    edition,
    startedAt: now,
    finishedAt: null,
    burnKcal: null,
    note: '',
    exercises: exercises.map((ex) => ({
      id: ex.id,
      name: ex.name,
      sets: ex.sets.map(([type, target]) => ({ type, target: target ?? null, w: null, r: null, done: false })),
    })),
  };
  return d.workout;
}

export function setWorkoutSet(state, date, exIdx, setIdx, patch) {
  const s = state.days[date]?.workout?.exercises[exIdx]?.sets[setIdx];
  if (!s) return null;
  for (const k of ['w', 'r']) {
    if (k in patch) s[k] = patch[k] === '' || patch[k] == null || Number.isNaN(Number(patch[k])) ? null : Number(patch[k]);
  }
  if ('done' in patch) s.done = !!patch.done;
  return s;
}

export function finishWorkout(state, date, now = Date.now()) {
  const w = state.days[date]?.workout;
  if (w) w.finishedAt = now;
}

export function cancelWorkout(state, date) {
  const d = state.days[date];
  if (d) d.workout = null;
}

export function addCardio(state, date, { kind, min, kcal, note = '' }) {
  const d = ensureDay(state, date);
  const c = { id: newId(), kind: kind || 'Cardio', min: Number(min) || 0, kcal: Number(kcal) || 0, note };
  d.cardio.push(c);
  return c;
}

export const removeCardio = (state, date, id) => {
  const d = state.days[date];
  if (d) d.cardio = d.cardio.filter((c) => c.id !== id);
};

// ---- Body measurements & reviews -------------------------------------------

export function saveMeasurement(state, m) {
  const clean = { id: newId(), date: m.date };
  for (const k of ['chest', 'waist', 'hip', 'thigh', 'arm', 'bf']) {
    const v = Number(m[k]);
    if (m[k] !== '' && m[k] != null && Number.isFinite(v) && v > 0) clean[k] = round(v, 1);
  }
  state.measurements = state.measurements.filter((x) => x.date !== m.date);
  state.measurements.push(clean);
  state.measurements.sort((a, b) => (a.date < b.date ? -1 : 1));
  return clean;
}

export const removeMeasurement = (state, id) => {
  state.measurements = state.measurements.filter((m) => m.id !== id);
};

export function addReview(state, review) {
  state.reviews = state.reviews.filter((r) => r.date !== review.date);
  state.reviews.push({ id: newId(), ...review });
  state.reviews.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ---- Backup -----------------------------------------------------------------

export function exportState(state, now = new Date()) {
  return JSON.stringify({ app: 'recomp-tracker', exportedAt: now.toISOString(), state }, null, 1);
}

// Returns { ok, state } or { ok:false, error }. Never throws on bad input.
export function parseBackup(text, today) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That is not a valid backup file (could not read JSON).' };
  }
  const s = data?.app === 'recomp-tracker' ? data.state : null;
  if (!s || typeof s !== 'object') return { ok: false, error: 'This file is not a Recomp Tracker backup.' };
  if (typeof s.v !== 'number' || s.v > STATE_VERSION) {
    return { ok: false, error: 'This backup comes from a newer version of the app. Update the app first.' };
  }
  const base = defaultState(today);
  const merged = { ...base, ...s, prefs: { ...base.prefs, ...(s.prefs || {}), tolerance: { ...base.prefs.tolerance, ...(s.prefs?.tolerance || {}) } } };
  merged.days = s.days && typeof s.days === 'object' ? s.days : {};
  for (const k of Object.keys(merged.days)) merged.days[k] = { ...blankDay(), ...merged.days[k], mealNames: cleanMealNames(merged.days[k]?.mealNames) };
  merged.prefs.mealNames = cleanMealNames(merged.prefs.mealNames);
  for (const k of ['measurements', 'customFoods', 'reviews', 'targetHistory']) if (!Array.isArray(merged[k])) merged[k] = [];
  merged.v = STATE_VERSION;
  return { ok: true, state: merged };
}

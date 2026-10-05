// Plan file: validation, normalisation and lookups.
// Format is documented in docs/PLAN_FORMAT.md.

import { DAY_TYPES } from './tdee.js';
import { normalizeTarget, foodMacros, sumMacros } from './macros.js';
import { buildFoodIndex } from './foods.js';

export const PLAN_SCHEMA = 'recomp-tracker-plan/1';

export const SET_TYPES = {
  feel: { label: 'Feel', long: 'Feel set: light, to wake the muscle up', working: false },
  warm: { label: 'Warm-up', long: 'Warm-up: ramp up to your working weight', working: false },
  w2: { label: '2 RIR', long: 'Working set, 2 reps in reserve', working: true },
  w15: { label: '1.5 RIR', long: 'Working set, 1-2 reps in reserve', working: true },
  w1: { label: '1 RIR', long: 'Working set, 1 rep in reserve', working: true },
  w05: { label: '0.5 RIR', long: 'Working set, a rep or less left', working: true },
  work: { label: 'Work', long: 'Working set', working: true },
  fail: { label: 'Failure', long: 'Go to failure', working: true },
  drop: { label: 'Drop', long: 'Drop set: cut the weight about 30-50% and go to failure', working: true },
};

export const TIMINGS = {
  morning: 'Morning, with food',
  midday: 'Midday, with food',
  pre: 'Pre-workout',
  intra: 'During workout',
  post: 'After workout',
  sleep: 'Before bed',
};

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

// Identifiers end up in attributes, keys and lookups, so keep them boring.
export const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
export const isSafeId = (s) => typeof s === 'string' && SAFE_ID.test(s) && !FORBIDDEN_KEYS.has(s);

export function validatePlan(input) {
  // Work on a private copy: the result never aliases (or modifies) the caller's object.
  const raw = input && typeof input === 'object' ? structuredClone(input) : input;
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['Not a plan file.'], warnings, plan: null };
  if (raw.schema !== PLAN_SCHEMA) err(`Unsupported schema "${raw.schema}". Expected "${PLAN_SCHEMA}".`);

  const plan = {
    schema: PLAN_SCHEMA,
    name: String(raw.name || 'My plan'),
    source: raw.source ? String(raw.source) : '',
    profile: raw.profile || {},
    phase: ['recomp', 'cut', 'bulk', 'maintain'].includes(raw.phase) ? raw.phase : 'recomp',
    dayTypes: {},
    slots: raw.slots || {},
    foods: Array.isArray(raw.foods) ? raw.foods : [],
    menus: raw.menus || {},
    program: raw.program || null,
    supplements: Array.isArray(raw.supplements) ? raw.supplements : [],
    cardio: { weeklyKcalGoal: 0, met: 9.8, ...(raw.cardio || {}) },
    hydration: { goalMl: 3000, ...(raw.hydration || {}) },
  };

  // Day types and targets
  for (const t of DAY_TYPES) {
    const d = raw.dayTypes?.[t];
    if (!d) {
      err(`dayTypes.${t} is missing.`);
      continue;
    }
    const tg = d.target || {};
    if (![tg.p, tg.c, tg.f].every((n) => isNum(n) && n >= 0)) {
      err(`dayTypes.${t}.target needs numeric p, c and f.`);
      continue;
    }
    if (!Array.isArray(d.slots) || !d.slots.length) err(`dayTypes.${t}.slots must list at least one meal slot.`);
    plan.dayTypes[t] = { target: normalizeTarget(tg), tdee: isNum(d.tdee) ? d.tdee : null, slots: d.slots || [] };
    for (const s of d.slots || []) if (!plan.slots[s]) plan.slots[s] = { label: s };
  }

  // Foods referenced by menus must exist
  const index = buildFoodIndex(plan.foods);
  for (const f of plan.foods) {
    if (!f.id || !f.name) err('Every food needs an id and a name.');
    else if (![f.p, f.c, f.f].every((n) => isNum(n) && n >= 0)) err(`Food "${f.id}" needs numeric p, c and f.`);
  }

  for (const [mid, menu] of Object.entries(plan.menus)) {
    if (!menu.label) menu.label = mid;
    for (const [dt, slots] of Object.entries(menu.days || {})) {
      if (!DAY_TYPES.includes(dt)) {
        err(`Menu ${mid}: unknown day type "${dt}".`);
        continue;
      }
      for (const [slot, items] of Object.entries(slots)) {
        if (!plan.dayTypes[dt]?.slots.includes(slot)) warn(`Menu ${mid}/${dt}: slot "${slot}" is not used by that day type.`);
        for (const it of items) {
          if (!index.has(it.food)) err(`Menu ${mid}/${dt}/${slot}: unknown food "${it.food}".`);
          else if (!(isNum(it.q) && it.q > 0)) err(`Menu ${mid}/${dt}/${slot}: "${it.food}" needs a quantity q > 0.`);
        }
      }
      // Does the menu actually deliver the day's targets?
      const total = menuDayTotals(plan, index, mid, dt);
      const tg = plan.dayTypes[dt]?.target;
      if (tg && total.kcal > 0) {
        const off = Math.abs(total.kcal - tg.kcal) / tg.kcal;
        if (off > 0.05) warn(`Menu ${mid}/${dt}: ${Math.round(total.kcal)} kcal vs target ${tg.kcal} (${Math.round(off * 100)}% off).`);
      }
    }
  }

  // identifiers
  const badId = (what, id) => err(`${what} "${String(id).slice(0, 30)}" is not a valid id (use letters, numbers, - _ . and at most 64 characters).`);
  for (const f of plan.foods) if (f.id && !isSafeId(f.id)) badId('Food id', f.id);
  for (const id of Object.keys(plan.menus)) if (!isSafeId(id)) badId('Menu id', id);
  for (const id of Object.keys(plan.slots)) if (!isSafeId(id)) badId('Meal slot', id);
  for (const t of Object.values(plan.dayTypes)) for (const sl of t.slots) if (!isSafeId(sl)) badId('Meal slot', sl);
  for (const s of plan.supplements) if (s.id && !isSafeId(s.id)) badId('Supplement id', s.id);
  if (plan.program) {
    for (const k of plan.program.cycle || []) if (!isSafeId(k)) badId('Program day', k);
    for (const [eid, ed] of Object.entries(plan.program.editions || {})) {
      if (!isSafeId(eid)) badId('Edition id', eid);
      for (const exs of Object.values(ed.days || {})) for (const ex of exs) if (ex.id && !isSafeId(ex.id)) badId('Exercise id', ex.id);
    }
  }

  if (plan.program) validateProgram(plan.program, err, warn);
  const supIds = new Set();
  for (const s of plan.supplements) {
    if (!s.id || !s.name) err('Every supplement needs an id and a name.');
    if (supIds.has(s.id)) err(`Duplicate supplement id "${s.id}".`);
    supIds.add(s.id);
    if (s.timing && !TIMINGS[s.timing]) warn(`Supplement "${s.id}": unknown timing "${s.timing}".`);
  }

  return { ok: errors.length === 0, errors, warnings, plan: errors.length ? null : plan };
}

function validateProgram(program, err, warn) {
  const cycle = program.cycle;
  if (!Array.isArray(cycle) || !cycle.length) return err('program.cycle must list the day keys in order.');
  for (const k of cycle) {
    const d = program.days?.[k];
    if (!d) err(`program.days.${k} is missing.`);
    else if (!['rest', 'lift'].includes(d.dayType)) err(`program.days.${k}.dayType must be "rest" or "lift".`);
  }
  for (const [eid, ed] of Object.entries(program.editions || {})) {
    for (const k of cycle) {
      const day = program.days?.[k];
      if (day?.dayType === 'rest') continue;
      const exs = ed.days?.[k];
      if (!exs) {
        warn(`Edition ${eid}: no exercises for "${k}".`);
        continue;
      }
      const ids = new Set();
      for (const ex of exs) {
        if (!ex.id || !ex.name) err(`Edition ${eid}/${k}: every exercise needs an id and a name.`);
        if (ids.has(ex.id)) err(`Edition ${eid}/${k}: duplicate exercise id "${ex.id}".`);
        ids.add(ex.id);
        if (!Array.isArray(ex.sets) || !ex.sets.length) err(`Exercise ${ex.id}: needs sets.`);
        for (const s of ex.sets || []) {
          if (!SET_TYPES[s[0]]) err(`Exercise ${ex.id}: unknown set type "${s[0]}".`);
          if (s[1] != null && !(isNum(s[1]) && s[1] > 0)) err(`Exercise ${ex.id}: bad rep target.`);
        }
      }
    }
  }
}

// ---- Lookups ----------------------------------------------------------------

export function menuDayTotals(plan, index, menuId, dayType) {
  const slots = plan.menus?.[menuId]?.days?.[dayType] || {};
  const list = [];
  for (const items of Object.values(slots)) {
    for (const it of items) {
      const f = index.get(it.food);
      if (f) list.push(foodMacros(f, it.q));
    }
  }
  return sumMacros(list);
}

export function menuSlotItems(plan, menuId, dayType, slot) {
  const items = plan?.menus?.[menuId]?.days?.[dayType]?.[slot] || [];
  return items.map((i) => ({ foodId: i.food, qty: i.q }));
}

export function slotLabel(plan, slot) {
  if (slot === 'extra') return 'Snacks / other';
  return plan?.slots?.[slot]?.label || slot;
}

export function slotsFor(plan, dayType) {
  return plan?.dayTypes?.[dayType]?.slots || [];
}

// Targets in force on a date. `history` is [{from, targets}] sorted ascending.
export function targetsOn(history, date, dayType) {
  let hit = history[0];
  for (const h of history) if (h.from <= date) hit = h;
  return hit?.targets?.[dayType] || null;
}

export function programDays(plan) {
  return plan?.program?.cycle || [];
}

export function exercisesFor(plan, edition, dayKey) {
  return plan?.program?.editions?.[edition]?.days?.[dayKey] || [];
}

// A minimal plan (targets only, no menus or program) for people who start
// from their body stats instead of importing a plan file.
export function basicPlan({ profile, targets, tdee = {}, phase = 'recomp' }) {
  const three = ['meal1', 'meal2', 'meal3'];
  const four = ['meal1', 'meal2', 'meal3', 'meal4'];
  const slots = {};
  for (const s of four) slots[s] = { label: `Meal ${s.slice(4)}` };
  const slotsByType = { rest: three, lift: four, cardio: three, lift_cardio: four };
  const dayTypes = {};
  for (const t of DAY_TYPES) {
    dayTypes[t] = { target: { p: targets[t].p, c: targets[t].c, f: targets[t].f }, tdee: tdee[t] ?? null, slots: slotsByType[t] };
  }
  return {
    schema: PLAN_SCHEMA,
    name: 'My plan',
    source: 'Created in the app from body stats.',
    profile,
    phase,
    slots,
    dayTypes,
    foods: [],
    menus: {},
    program: null,
    supplements: [],
  };
}

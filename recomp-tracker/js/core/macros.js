// Macro arithmetic. Energy is always derived from the macros (4/4/9, alcohol 7)
// so that kcal and macros can never disagree with each other.

export const KCAL_PER_G = { p: 4, c: 4, f: 9, a: 7 };

export const ZERO = Object.freeze({ p: 0, c: 0, f: 0, a: 0, kcal: 0 });

export const kcalOf = (m) =>
  (m.p || 0) * KCAL_PER_G.p + (m.c || 0) * KCAL_PER_G.c + (m.f || 0) * KCAL_PER_G.f + (m.a || 0) * KCAL_PER_G.a;

export function macros({ p = 0, c = 0, f = 0, a = 0 } = {}) {
  return { p, c, f, a, kcal: kcalOf({ p, c, f, a }) };
}

export function sumMacros(list) {
  const t = { p: 0, c: 0, f: 0, a: 0 };
  for (const m of list) {
    t.p += m.p || 0;
    t.c += m.c || 0;
    t.f += m.f || 0;
    t.a += m.a || 0;
  }
  return macros(t);
}

export function scaleMacros(m, k) {
  return macros({ p: (m.p || 0) * k, c: (m.c || 0) * k, f: (m.f || 0) * k, a: (m.a || 0) * k });
}

// Macros for `qty` of a food. A food stores its macros per `basis` of its unit
// (100 g, 100 ml, or 1 serving).
export function foodMacros(food, qty) {
  const k = qty / (food.basis || 100);
  return scaleMacros(food, k);
}

// A log entry keeps a snapshot of its macros, so editing the food database
// later never rewrites history.
export function makeEntry(food, qty, extra = {}) {
  const m = foodMacros(food, qty);
  return {
    id: extra.id || newId(),
    slot: extra.slot || 'extra',
    foodId: food.id,
    name: food.name,
    unit: food.unit || 'g',
    qty: round(qty, 2),
    p: round(m.p, 2),
    c: round(m.c, 2),
    f: round(m.f, 2),
    a: round(m.a, 2),
    src: extra.src || 'food',
    est: !!food.est,
  };
}

export function entryMacros(e) {
  return macros({ p: e.p, c: e.c, f: e.f, a: e.a });
}

export const diff = (a, b) => macros({ p: a.p - b.p, c: a.c - b.c, f: a.f - b.f, a: (a.a || 0) - (b.a || 0) });

export function round(n, dp = 0) {
  const k = 10 ** dp;
  return Math.round((n + Number.EPSILON) * k) / k;
}

let counter = 0;
export function newId() {
  counter = (counter + 1) % 1e6;
  return Date.now().toString(36) + counter.toString(36) + Math.random().toString(36).slice(2, 5);
}

// kcal target is derived from macro targets so the numbers always agree.
export function normalizeTarget(t) {
  const p = Number(t.p) || 0;
  const c = Number(t.c) || 0;
  const f = Number(t.f) || 0;
  return { p, c, f, kcal: kcalOf({ p, c, f }) };
}

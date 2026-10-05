import { foodMacros, diff, kcalOf, round } from './macros.js';
import { matchMacroFor } from './foods.js';

// "Level 1" swap: replace one ingredient with another and work out how much of
// the new one gives the same amount of the macro that ingredient is there for
// (protein for a protein source, carbs for a carb source, fat for a fat source).
//
// Returns { qty, qtyExact, macros, delta, match } or { error }.
export function swapFood({ from, fromQty, to, match = 'auto' }) {
  const target = foodMacros(from, fromQty);
  const key = match === 'auto' ? matchMacroFor(from) : match;
  const want = key === 'kcal' ? target.kcal : target[key];
  const perUnit = key === 'kcal' ? kcalOf(to) / (to.basis || 100) : to[key] / (to.basis || 100);

  if (!(want > 0)) return { error: `${from.name} has no ${labelOf(key)} to match.` };
  // Under 3 g of the matched macro per 100 g means the swap is meaningless
  // (e.g. replacing oil with rice "for the fat" would need over a kilo of rice).
  const minDensity = key === 'kcal' ? 0.3 : 0.03;
  if (!(perUnit >= minDensity * (to.unit === 'serving' ? 100 : 1))) {
    return { error: `${to.name} has almost no ${labelOf(key)}, so it cannot replace ${from.name}.` };
  }

  const qtyExact = want / perUnit;
  const cap = to.unit === 'serving' ? 6 : 800;
  if (qtyExact > cap) {
    return { error: `You would need about ${Math.round(qtyExact)} ${to.unit === 'serving' ? 'servings' : to.unit} of ${to.name}. Not practical.` };
  }
  const qty = roundQty(qtyExact, to);
  const macros = foodMacros(to, qty);
  return { qty, qtyExact, macros, delta: diff(macros, target), match: key };
}

function labelOf(key) {
  return key === 'kcal' ? 'energy' : { p: 'protein', c: 'carbs', f: 'fat' }[key];
}

// Practical rounding: 5 g steps above 50 g, whole grams below; servings in quarters.
export function roundQty(qty, food) {
  if (food.unit === 'serving') return Math.max(0.25, Math.round(qty * 4) / 4);
  if (qty >= 50) return Math.round(qty / 5) * 5;
  return Math.max(1, Math.round(qty));
}

// Rank candidate substitutes of the same category by how little the other
// macros move compared with what you're replacing.
export function suggestSwaps(index, from, fromQty, { limit = 8, cat = from.cat } = {}) {
  const out = [];
  for (const to of index.values()) {
    if (to.id === from.id || to.cat !== cat || to.est) continue;
    const r = swapFood({ from, fromQty, to });
    if (r.error) continue;
    const drift = Math.abs(r.delta.p) + Math.abs(r.delta.c) + Math.abs(r.delta.f) * 1.5;
    out.push({ food: to, ...r, drift: round(drift, 1) });
  }
  return out.sort((a, b) => a.drift - b.drift).slice(0, limit);
}

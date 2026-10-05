import { foodMacros, sumMacros, macros, round } from './macros.js';
import { roundQty } from './swap.js';

// Scaling a meal to new macro targets.
//
// Each ingredient belongs to one "group" by what it is there for: protein
// sources, carb sources, fat sources. Everything else (vegetables, drinks,
// sauces) is left alone. We then find one multiplier per group so the meal's
// totals land on the target. Ingredients carry bits of other macros (rice has
// protein, chicken has fat), so the groups are solved iteratively: fix one
// group at a time against whatever the others currently contribute.

const GROUP_OF_CAT = { protein: 'p', carb: 'c', fruit: 'c', fat: 'f' };
const MAX_SCALE = 4;

export const groupOf = (food) => GROUP_OF_CAT[food.cat] || null;

/**
 * @param items   [{ foodId, qty }]
 * @param target  { p, c, f } grams wanted for the meal
 * @param index   Map foodId -> food
 * @returns { items, totals, scales, notes }
 */
export function scaleItems(items, target, index, { iterations = 40 } = {}) {
  const rows = items
    .map((it) => ({ ...it, food: index.get(it.foodId) }))
    .filter((r) => r.food);

  const unit = rows.map((r) => ({ r, m: foodMacros(r.food, r.qty), g: groupOf(r.food) }));
  const scales = { p: 1, c: 1, f: 1 };
  const present = new Set(unit.map((u) => u.g).filter(Boolean));

  const total = (key) =>
    unit.reduce((s, u) => s + u.m[key] * (u.g ? scales[u.g] : 1), 0);

  for (let i = 0; i < iterations; i++) {
    let moved = 0;
    for (const g of ['p', 'c', 'f']) {
      if (!present.has(g)) continue;
      const own = unit.filter((u) => u.g === g).reduce((s, u) => s + u.m[g], 0);
      if (own <= 0) continue;
      const others = total(g) - own * scales[g];
      const next = Math.min(MAX_SCALE, Math.max(0, (target[g] - others) / own));
      moved = Math.max(moved, Math.abs(next - scales[g]));
      scales[g] = next;
    }
    if (moved < 1e-6) break;
  }

  const notes = [];
  const out = unit.map((u) => {
    const k = u.g ? scales[u.g] : 1;
    const qty = u.g ? (k === 0 ? 0 : roundQty(u.r.qty * k, u.r.food)) : u.r.qty;
    if (u.g && k === 0) notes.push(`${u.r.food.name} removed (target already met by other foods)`);
    return { foodId: u.r.foodId, qty };
  });

  const kept = out.filter((o) => o.qty > 0);
  const totals = sumMacros(kept.map((o) => foodMacros(index.get(o.foodId), o.qty)));
  const hitMax = Object.entries(scales).some(([g, k]) => present.has(g) && k >= MAX_SCALE);
  if (hitMax) notes.push('Target is far from this meal; amounts were capped.');

  // Ingredients carry more than one macro (salmon is protein *and* fat), so some
  // targets simply can't be reached with these foods. Say so rather than hide it.
  const label = { p: 'Protein', c: 'Carbs', f: 'Fat' };
  const residual = {};
  for (const k of ['p', 'c', 'f']) {
    residual[k] = totals[k] - target[k];
    if (Math.abs(residual[k]) > Math.max(5, target[k] * 0.15)) {
      notes.push(`${label[k]} ends ${Math.round(Math.abs(residual[k]))} g ${residual[k] > 0 ? 'over' : 'under'} target. These foods cannot get closer; try different ones.`);
    }
  }
  return { items: kept, totals, scales, notes, residual };
}

/**
 * Distribute what is left of the day across the meals still to be eaten,
 * in proportion to how big each meal is in the plan, then rescale each meal's
 * ingredients to its new share.
 *
 * @param remaining  { p, c, f } left in the day (may be negative)
 * @param meals      [{ slot, items:[{foodId, qty}] }] planned meals still to eat
 * @returns { meals:[{slot, planned, scaled:{items,totals}, target}], overshoot:{p,c,f} }
 */
export function rebalanceMeals(remaining, meals, index) {
  const planned = meals.map((m) => ({
    slot: m.slot,
    items: m.items,
    macros: sumMacros(m.items.map((it) => foodMacros(index.get(it.foodId), it.qty))),
  }));
  const planTotal = sumMacros(planned.map((m) => m.macros));
  const left = { p: Math.max(0, remaining.p), c: Math.max(0, remaining.c), f: Math.max(0, remaining.f) };
  const overshoot = {
    p: Math.max(0, -remaining.p),
    c: Math.max(0, -remaining.c),
    f: Math.max(0, -remaining.f),
  };

  const result = planned.map((m) => {
    const share = (k) => (planTotal[k] > 0 ? m.macros[k] / planTotal[k] : 1 / planned.length);
    const target = { p: left.p * share('p'), c: left.c * share('c'), f: left.f * share('f') };
    const scaled = scaleItems(m.items, target, index);
    return { slot: m.slot, planned: m.macros, target: macros(target), scaled };
  });
  return { meals: result, overshoot };
}

export const describeChange = (before, after, food) => {
  const d = round(after - before, 0);
  if (d === 0) return `${food.name}: no change`;
  return `${food.name}: ${before} → ${after}${food.unit === 'serving' ? '' : ' ' + food.unit} (${d > 0 ? '+' : ''}${d})`;
};

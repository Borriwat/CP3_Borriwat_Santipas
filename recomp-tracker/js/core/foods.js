import { BUILTIN_FOODS } from '../data/builtin-foods.js';

// Precedence when ids collide: your own foods > the plan's foods > built-in.
// A plan can therefore pin a food to the exact numbers your coach used.
export function buildFoodIndex(planFoods = [], customFoods = []) {
  const idx = new Map();
  for (const list of [BUILTIN_FOODS, planFoods, customFoods]) {
    for (const f of list || []) {
      idx.set(f.id, normalizeFood(f));
    }
  }
  return idx;
}

export function normalizeFood(f) {
  return {
    unit: 'g',
    basis: f.unit === 'serving' ? 1 : 100,
    a: 0,
    ...f,
    p: Number(f.p) || 0,
    c: Number(f.c) || 0,
    f: Number(f.f) || 0,
    a: Number(f.a) || 0,
  };
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFKC');

// Simple ranked search: prefix matches first, then word matches, then substring.
export function searchFoods(index, query, { cat = null, limit = 40, recent = [] } = {}) {
  const q = norm(query).trim();
  const recentRank = new Map(recent.map((id, i) => [id, i]));
  const all = [...index.values()].filter((f) => !cat || f.cat === cat);
  if (!q) {
    return all
      .sort((a, b) => (recentRank.get(a.id) ?? 999) - (recentRank.get(b.id) ?? 999) || a.name.localeCompare(b.name))
      .slice(0, limit);
  }
  const terms = q.split(/\s+/);
  const scored = [];
  for (const f of all) {
    const hay = `${norm(f.name)} ${norm(f.th)} ${norm(f.id)}`;
    if (!terms.every((t) => hay.includes(t))) continue;
    const name = norm(f.name);
    let score = 50;
    if (name.startsWith(q) || norm(f.th).startsWith(q)) score = 0;
    else if (name.split(/[\s,()/]+/).some((w) => w.startsWith(terms[0]))) score = 10;
    score += (recentRank.get(f.id) ?? 99) / 100;
    scored.push([score, f]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).slice(0, limit).map((x) => x[1]);
}

// Which macro "owns" a food when swapping: protein foods are matched on
// protein, carb foods on carbs, fats on fat; anything else on energy.
export function matchMacroFor(food) {
  switch (food.cat) {
    case 'protein':
      return 'p';
    case 'carb':
    case 'fruit':
      return 'c';
    case 'fat':
      return 'f';
    default:
      return 'kcal';
  }
}

export function sortRecent(entriesByDate, limit = 20) {
  // entriesByDate: iterable of [date, entries]. Most recently used first.
  const seen = new Set();
  const out = [];
  const sorted = [...entriesByDate].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  for (const [, entries] of sorted) {
    for (const e of [...entries].reverse()) {
      if (e.foodId && !seen.has(e.foodId)) {
        seen.add(e.foodId);
        out.push(e.foodId);
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

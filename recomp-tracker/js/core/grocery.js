import { addDays } from './dates.js';
import { resolveDayType } from './schedule.js';
import { slotsFor, menuSlotItems } from './plan.js';

// Total amount of each food needed over `days` days starting at `start`,
// following the day type each date resolves to (your schedule, or what you set).
// Quantities are the weighed amounts from the menu (e.g. raw weight).
export function shoppingList(state, index, start, days = 7, today = start) {
  const totals = new Map();
  const menuId = state.prefs.menu;
  if (!menuId) return [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const type = resolveDayType(state, date, today);
    for (const slot of slotsFor(state.plan, type)) {
      const items = state.days[date]?.adjust?.[slot] || menuSlotItems(state.plan, menuId, type, slot);
      for (const it of items) {
        const f = index.get(it.foodId);
        if (!f) continue;
        const cur = totals.get(it.foodId) || { food: f, qty: 0, days: new Set() };
        cur.qty += it.qty;
        cur.days.add(date);
        totals.set(it.foodId, cur);
      }
    }
  }
  return [...totals.values()]
    .map((t) => ({ food: t.food, qty: t.qty, days: t.days.size }))
    .sort((a, b) => a.food.cat.localeCompare(b.food.cat) || b.qty - a.qty);
}

// Shared UI context: UI-only state (not saved), the store handle, and the
// view-model for a day.

import { buildFoodIndex } from '../core/foods.js';
import { getDay } from '../core/state.js';
import { resolveDayType, programDayKey } from '../core/schedule.js';
import { targetsOn, menuSlotItems, slotsFor, slotLabel } from '../core/plan.js';
import { dayTotals } from '../core/stats.js';
import { sumMacros, foodMacros, diff, entryMacros } from '../core/macros.js';

export const ui = {
  tab: 'today',
  date: null, // ISO date being viewed on Today
  sheet: null, // { type, ...props }
  timer: null, // { endsAt, total, done }
  open: {}, // expanded sections
  progressRange: 60,
  strengthEx: null,
  edit: null,
  flash: null,
};

let store = null;
let renderFn = () => {};

export const bindStore = (s) => {
  store = s;
};
export const getStore = () => store;
export const setRender = (f) => {
  renderFn = f;
};
export const render = () => renderFn();

export function mutate(fn) {
  store.update(fn);
}

export const openSheet = (type, props = {}) => {
  ui.sheet = { type, ...props };
  render();
};
export const closeSheet = () => {
  ui.sheet = null;
  render();
};

let toastTimer = null;
export function toast(msg, ms = 2400) {
  ui.flash = msg;
  render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    ui.flash = null;
    render();
  }, ms);
}

export const todayISO = () => store.today();
export const viewDate = () => ui.date || todayISO();

export const foodIndex = (s = store.state) => buildFoodIndex(s.plan?.foods || [], s.customFoods);

// Planned items for a slot on a date: today's adjusted version if there is one,
// otherwise the menu template.
export function plannedItems(s, date, type, slot) {
  const adj = s.days[date]?.adjust?.[slot];
  if (adj) return adj;
  return menuSlotItems(s.plan, s.prefs.menu, type, slot);
}

export const itemsMacros = (items, index) =>
  sumMacros(items.map((i) => index.get(i.foodId)).map((f, k) => (f ? foodMacros(f, items[k].qty) : { p: 0, c: 0, f: 0 })));

export function dayModel(date = viewDate()) {
  const s = store.state;
  const today = todayISO();
  const plan = s.plan;
  const type = resolveDayType(s, date, today);
  const target = targetsOn(s.targetHistory, date, type);
  const day = getDay(s, date);
  const index = foodIndex(s);
  const slots = slotsFor(plan, type);
  const totals = dayTotals(day);
  const meals = slots.map((slot) => mealModel(s, date, type, slot, index));
  // entries that belong to slots this day type doesn't show (plus snacks)
  const known = new Set(slots);
  const extraEntries = day.entries.filter((e) => !known.has(e.slot));
  const programKey = plan?.program ? programDayKey(plan, date, s.prefs.programAnchor) : null;
  return {
    s, date, today, plan, type, target, day, index, slots, meals, totals,
    remaining: target ? diff(target, totals) : null,
    extraEntries, programKey,
    isToday: date === today,
    explicitType: !!day.type,
  };
}

export function mealModel(s, date, type, slot, index) {
  const day = s.days[date];
  const entries = (day?.entries || []).filter((e) => e.slot === slot);
  const items = plannedItems(s, date, type, slot);
  const planned = itemsMacros(items, index);
  const template = menuSlotItems(s.plan, s.prefs.menu, type, slot);
  return {
    slot,
    label: slotLabel(s.plan, slot),
    items,
    planned,
    adjusted: !!day?.adjust?.[slot],
    template,
    entries,
    logged: sumMacros(entries.map(entryMacros)),
    status: entries.length ? 'logged' : 'open',
  };
}

export const supplementList = (s) => {
  const ids = s.prefs.supplementIds;
  const all = s.plan?.supplements || [];
  return ids ? all.filter((x) => ids.includes(x.id)) : all.filter((x) => x.base);
};

export const latestWeight = (s) => {
  const dates = Object.keys(s.days).filter((d) => s.days[d].weight).sort();
  return dates.length ? s.days[dates.at(-1)].weight : s.plan?.profile?.weightKg || null;
};

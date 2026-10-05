// Click / input handlers for everything that happens inside sheets.

import { ui, mutate, closeSheet, openSheet, toast, render, getStore, foodIndex, dayModel, todayISO, latestWeight } from './ctx.js';
import { swapSource, computeRebalance } from './sheets-food.js';
import { CARDIO_KINDS, calcInputs } from './sheets.js';
import { calculate, DAY_TYPES } from '../core/tdee.js';
import { validatePlan, basicPlan } from '../core/plan.js';
import { evaluateReview, applySuggestion } from '../core/review.js';
import { foodMacros, normalizeTarget } from '../core/macros.js';
import { swapPrompt } from '../core/prompts.js';
import { newPhoto } from './sheets-photo.js';
import { withCardio, withLift } from '../core/schedule.js';
import { addDays } from '../core/dates.js';
import { slotLabel } from '../core/plan.js';
import { parseNum } from '../core/format.js';
import * as S from '../core/state.js';

const state = () => getStore().state;

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)] = value;
}

const sameItems = (a, b) => a.length === b.length && a.every((x, i) => x.foodId === b[i].foodId && Math.abs(x.qty - b[i].qty) < 1e-9);

function setSlotItems(date, slot, items) {
  const m = dayModel(date);
  const meal = m.meals.find((x) => x.slot === slot);
  mutate((s) => S.setAdjust(s, date, slot, sameItems(items, meal.template) ? null : items));
}

// ---- inputs (fired on every keystroke) ----------------------------------------------------

export const inputs = {
  'sheet-field': (el) => {
    if (!ui.sheet) return;
    setPath(ui.sheet, el.dataset.field, el.value);
    if (ui.sheet.type === 'importPlan' && el.dataset.field === 'text') validateImport();
    render();
  },
  'cardio-kcal': (el) => {
    ui.sheet.kcal = el.value;
    ui.sheet.kcalTouched = true;
    render();
  },
  'target-field': (el) => {
    ui.sheet.t[el.dataset.t][el.dataset.k] = el.value;
    render();
  },
  'calc-field': (el) => {
    ui.sheet.f[el.dataset.k] = el.value;
    render();
  },
  'measure-field': (el) => {
    ui.sheet.m[el.dataset.k] = el.value;
  },
  'review-end': (el) => {
    if (el.value) {
      ui.sheet.end = el.value;
      ui.sheet.applied = false;
      render();
    }
  },
};

function validateImport() {
  const text = ui.sheet.text || '';
  if (!text.trim()) {
    ui.sheet.errors = [];
    ui.sheet.warnings = [];
    return null;
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    ui.sheet.errors = [`That doesn't look like a plan file (${e.message.slice(0, 80)}). Make sure you copied the whole file.`];
    ui.sheet.warnings = [];
    return null;
  }
  const v = validatePlan(raw);
  ui.sheet.errors = v.errors;
  ui.sheet.warnings = v.warnings;
  return v.ok ? v.plan : null;
}

// ---- changes (fired on blur / selection) ------------------------------------------------------

export const sheetChanges = {
  'nf-cat': (el) => {
    ui.sheet.nf.cat = el.value;
    render();
  },
  'plan-file': async (el) => {
    const file = el.files?.[0];
    if (!file) return;
    if (file.size > 3_000_000) {
      ui.sheet.errors = ['That file is too big to be a plan (over 3 MB).'];
      render();
      return;
    }
    ui.sheet.text = await file.text();
    validateImport();
    el.value = '';
    render();
  },
};

// ---- clicks -------------------------------------------------------------------------------------

export const sheetActions = {
  'sheet-close': () => closeSheet(),
  'confirm-yes': () => {
    const { onYes, back } = ui.sheet;
    ui.sheet = back || null;
    onYes?.(back);
    render();
  },
  'confirm-no': () => {
    ui.sheet = ui.sheet.back || null;
    render();
  },
  'sheet-tab': (el) => {
    ui.sheet.tab = el.dataset.v;
    ui.sheet.foodId = null;
    if (el.dataset.v === 'new') ui.sheet.nf ??= { unit: 'g', cat: 'other', name: ui.sheet.q || '' };
    if (el.dataset.v === 'quick') ui.sheet.quick ??= {};
    if (el.dataset.v === 'photo') ui.sheet.photo ??= newPhoto();
    render();
  },

  // -- add food
  'food-pick': (el) => {
    const f = foodIndex().get(el.dataset.id);
    ui.sheet.foodId = f.id;
    ui.sheet.qty = f.unit === 'serving' ? '1' : '100';
    render();
  },
  'food-back': () => {
    ui.sheet.foodId = null;
    render();
  },
  'set-qty': (el) => {
    ui.sheet.qty = el.dataset.v;
    render();
  },
  'food-add': () => {
    const sh = ui.sheet;
    const f = foodIndex().get(sh.foodId);
    const q = parseNum(sh.qty);
    if (!f || !(q > 0)) return;
    mutate((s) => S.addFoodEntry(s, sh.date, f, q, sh.slot));
    closeSheet();
    toast(`Added ${f.name}`);
  },
  'quick-add': () => {
    const sh = ui.sheet;
    const q = sh.quick || {};
    mutate((s) => S.addQuickEntry(s, sh.date, { name: (q.name || '').trim() || 'Quick add', p: parseNum(q.p) || 0, c: parseNum(q.c) || 0, f: parseNum(q.f) || 0 }, sh.slot));
    closeSheet();
    toast('Added');
  },
  'nf-unit': (el) => {
    ui.sheet.nf.unit = el.dataset.v;
    render();
  },
  'nf-save': () => {
    const n = ui.sheet.nf;
    let saved;
    mutate((s) => {
      saved = S.addCustomFood(s, {
        name: n.name.trim(), unit: n.unit, basis: n.unit === 'serving' ? 1 : 100,
        p: parseNum(n.p) || 0, c: parseNum(n.c) || 0, f: parseNum(n.f) || 0, a: 0, cat: n.cat || 'other',
      });
    });
    ui.sheet.tab = 'search';
    ui.sheet.foodId = saved.id;
    ui.sheet.qty = saved.unit === 'serving' ? '1' : '100';
    render();
    toast('Food saved');
  },

  // -- entries
  'entry-save': () => {
    const sh = ui.sheet;
    const q = parseNum(sh.qty);
    if (!(q > 0)) return;
    mutate((s) => S.updateEntryQty(s, sh.date, sh.id, q, foodIndex(s)));
    closeSheet();
  },
  'entry-delete': () => {
    const sh = ui.sheet;
    mutate((s) => S.removeEntry(s, sh.date, sh.id));
    closeSheet();
    toast('Removed');
  },
  'entry-swap': () => {
    const { date, id } = ui.sheet;
    openSheet('swap', { source: 'entry', date, id, q: '', pick: null, qty: '' });
  },

  // -- planned items
  'planned-save': () => {
    const sh = ui.sheet;
    const q = parseNum(sh.qty);
    const meal = dayModel(sh.date).meals.find((x) => x.slot === sh.slot);
    if (!meal || !(q > 0)) return;
    setSlotItems(sh.date, sh.slot, meal.items.map((x, k) => (k === sh.i ? { ...x, qty: q } : { ...x })));
    closeSheet();
  },
  'planned-remove': () => {
    const sh = ui.sheet;
    const meal = dayModel(sh.date).meals.find((x) => x.slot === sh.slot);
    setSlotItems(sh.date, sh.slot, meal.items.filter((_, k) => k !== sh.i).map((x) => ({ ...x })));
    closeSheet();
    toast('Skipped for today');
  },
  'planned-swap': () => {
    const { date, slot, i } = ui.sheet;
    openSheet('swap', { source: 'planned', date, slot, i, q: '', pick: null, qty: '' });
  },

  // -- swap
  'swap-pick': (el) => {
    ui.sheet.pick = el.dataset.id;
    ui.sheet.qty = el.dataset.qty;
    render();
  },
  'swap-back': () => {
    ui.sheet.pick = null;
    render();
  },
  'swap-apply': () => {
    const sh = ui.sheet;
    const src = swapSource(sh);
    const to = foodIndex().get(sh.pick);
    const q = parseNum(sh.qty);
    if (!src || !to || !(q > 0)) return;
    if (sh.source === 'entry') {
      const slot = state().days[sh.date].entries.find((e) => e.id === sh.id)?.slot || 'extra';
      mutate((s) => {
        S.removeEntry(s, sh.date, sh.id);
        S.addFoodEntry(s, sh.date, to, q, slot, 'swap');
      });
    } else {
      const meal = dayModel(sh.date).meals.find((x) => x.slot === sh.slot);
      setSlotItems(sh.date, sh.slot, meal.items.map((x, k) => (k === sh.i ? { foodId: to.id, qty: q } : { ...x })));
    }
    closeSheet();
    toast(`Swapped for ${to.name}`);
  },
  'swap-ask': () => {
    const sh = ui.sheet;
    const src = swapSource(sh);
    const to = foodIndex().get(sh.pick);
    const slot = sh.slot || state().days[sh.date]?.entries.find((e) => e.id === sh.id)?.slot;
    const text = swapPrompt({ slotLabel: slotLabel(state().plan, slot), from: src.from, fromQty: src.qty, toName: to.name, macros: foodMacros(src.from, src.qty) });
    openSheet('prompt', { text, back: sh });
  },

  // -- rebalance
  'rebalance-apply': () => {
    const sh = ui.sheet;
    const c = computeRebalance(sh.date);
    if (!c) return closeSheet();
    mutate((s) => {
      for (const mm of c.res.meals) S.setAdjust(s, sh.date, mm.slot, mm.scaled.items.map((i) => ({ foodId: i.foodId, qty: i.qty })));
    });
    closeSheet();
    toast("Rest of today resized. Tap 'Log as planned' as you eat.");
  },

  // -- prompt
  'prompt-copy': async () => {
    const text = ui.sheet.text || document.getElementById('prompt-text')?.textContent || '';
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* ignore */
      }
      ta.remove();
    }
    toast('Copied. Paste it into your AI chat.');
  },

  // -- cardio
  'cardio-kind': (el) => {
    ui.sheet.kind = el.dataset.v;
    render();
  },
  'cardio-save': () => {
    const sh = ui.sheet;
    const min = parseNum(sh.min);
    const w = latestWeight(state()) || 70;
    const met = CARDIO_KINDS.find((k) => k[0] === sh.kind)?.[1] || 6;
    const kcal = sh.kcalTouched ? parseNum(sh.kcal) || 0 : Math.round((met * w * min) / 60);
    mutate((s) => {
      S.addCardio(s, sh.date, { kind: sh.kind, min, kcal, note: sh.note || '' });
      const d = s.days[sh.date];
      if (d.type) d.type = withCardio(d.type);
    });
    closeSheet();
    toast('Cardio logged');
  },

  // -- supplements
  'supp-pick': (el) => {
    mutate((s) => {
      const all = s.plan.supplements;
      const cur = new Set(s.prefs.supplementIds ?? all.filter((x) => x.base).map((x) => x.id));
      cur.has(el.dataset.id) ? cur.delete(el.dataset.id) : cur.add(el.dataset.id);
      s.prefs.supplementIds = [...cur];
    });
  },

  // -- targets & calculator
  'targets-save': () => {
    const t = {};
    for (const k of DAY_TYPES) {
      const v = ui.sheet.t[k];
      t[k] = normalizeTarget({ p: parseNum(v.p) || 0, c: parseNum(v.c) || 0, f: parseNum(v.f) || 0 });
    }
    mutate((s) => S.setTargets(s, todayISO(), t));
    closeSheet();
    toast('Targets updated from today');
  },
  'calc-sex': (el) => {
    ui.sheet.f.sex = el.dataset.v;
    render();
  },
  'calc-bonus': () => {
    ui.sheet.f.bonus = !ui.sheet.f.bonus;
    render();
  },
  'calc-apply': () => {
    const res = calculate(calcInputs(ui.sheet));
    mutate((s) => {
      const t = {};
      for (const k of DAY_TYPES) {
        t[k] = { p: res.targets[k].p, c: res.targets[k].c, f: res.targets[k].f, kcal: res.targets[k].kcal };
        s.plan.dayTypes[k].tdee = res.tdee[k];
      }
      S.setTargets(s, todayISO(), t);
      s.prefs.sex = ui.sheet.f.sex;
    });
    closeSheet();
    toast('Targets updated from today');
  },
  'calc-create': () => {
    const f = ui.sheet.f;
    const res = calculate(calcInputs(ui.sheet));
    const profile = { name: 'Me', sex: f.sex, age: parseNum(f.age), heightCm: parseNum(f.heightCm), weightKg: parseNum(f.weightKg), bfPct: parseNum(f.bfPct) || null };
    const v = validatePlan(basicPlan({ profile, targets: res.targets, tdee: res.tdee }));
    if (!v.ok) return toast(v.errors[0]);
    mutate((s) => S.applyPlan(s, v.plan, todayISO()));
    ui.sheet = null;
    ui.tab = 'today';
    render();
    toast('Plan created. Add your meals as you eat them.');
  },

  // -- plan import
  'plan-import': () => {
    const plan = validateImport();
    if (!plan) return render();
    mutate((s) => S.applyPlan(s, plan, todayISO()));
    ui.sheet = null;
    ui.tab = 'today';
    render();
    toast(`Imported: ${plan.name}`);
  },

  // -- measurements
  'measure-save': () => {
    const sh = ui.sheet;
    const has = Object.values(sh.m).some((v) => Number.isFinite(parseNum(v)));
    if (!has) return toast('Enter at least one measurement');
    const clean = Object.fromEntries(Object.entries(sh.m).map(([k, v]) => [k, parseNum(v)]));
    mutate((s) => S.saveMeasurement(s, { date: sh.date, ...clean }));
    closeSheet();
    toast('Measurements saved');
  },

  // -- workout
  'workout-finish': () => {
    const sh = ui.sheet;
    const burn = parseNum(sh.burn);
    mutate((s) => {
      S.finishWorkout(s, sh.date);
      const w = s.days[sh.date].workout;
      w.burnKcal = Number.isFinite(burn) ? burn : null;
      w.note = sh.note || '';
      if (s.days[sh.date].type) s.days[sh.date].type = withLift(s.days[sh.date].type);
    });
    ui.timer = null;
    closeSheet();
    toast('Workout saved. Nice work.');
  },
  'program-set': (el) => {
    mutate((s) => S.setProgramDay(s, todayISO(), Number(el.dataset.n)));
    closeSheet();
    toast('Schedule updated');
  },

  // -- review
  'review-apply': () => {
    const sh = ui.sheet;
    const r = evaluateReview(state(), { end: sh.end || addDays(todayISO(), -1), today: todayISO() });
    if (!r.suggestion) return;
    openSheet('confirm', {
      title: 'Change your targets?',
      message: `${r.suggestion.text} This takes effect today and can be changed any time in More > Daily targets.`,
      label: 'Apply changes',
      danger: false,
      back: sh,
      onYes: () => {
        mutate((s) => applySuggestion(s, r.suggestion, todayISO(), S.setTargets));
        ui.sheet = { ...sh, applied: true };
        toast('Targets updated');
      },
    });
  },
  'review-save': () => {
    const sh = ui.sheet;
    const end = sh.end || addDays(todayISO(), -1);
    const r = evaluateReview(state(), { end, today: todayISO() });
    mutate((s) => S.addReview(s, { date: end, decision: r.decision, why: r.why, notes: (sh.notes ?? '').slice(0, 1000), applied: !!sh.applied }));
    closeSheet();
    toast('Review saved');
  },
};


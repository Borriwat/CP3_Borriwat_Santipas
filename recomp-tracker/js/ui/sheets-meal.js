// Renaming a meal: tap its name on Today. Only the name changes, never what is
// planned or logged.

import { html, raw } from './dom.js';
import { seg, chip } from './components.js';
import { ui, mutate, openSheet, closeSheet, toast, render, getStore, dayModel, todayISO } from './ctx.js';
import { shortDate } from '../core/dates.js';
import * as S from '../core/state.js';

const SUGGESTIONS = ['Breakfast', 'Brunch', 'Lunch', 'Dinner', 'Pre-workout', 'Post-workout', 'Snack', 'Late meal'];

export function renameMealSheet(sh) {
  const s = getStore().state;
  const plan = S.planMealLabel(s, sh.slot);
  const everyday = S.everydayMealLabel(s, sh.slot);
  const always = sh.scope === 'always';
  const base = always ? plan : everyday; // what it is called if this rename is removed
  const hasRename = always ? everyday !== plan : !!S.cleanMealName(s.days[sh.date]?.mealNames?.[sh.slot]);
  const clean = S.cleanMealName(sh.name);
  const dayWord = sh.date === todayISO() ? 'today' : shortDate(sh.date);
  return {
    title: 'Rename meal',
    body: html`<div class="stack">
      <p class="small muted">Only the name changes. What is planned for this meal, and anything you have logged, stays as it is.</p>
      <label class="field"><span>Meal name</span>
        <input class="input" autocomplete="off" maxlength="${S.MEAL_NAME_MAX}" enterkeyhint="done" data-input="sheet-field" data-field="name" value="${sh.name}" placeholder="${base}" aria-label="Meal name"></label>
      <div class="chips">${SUGGESTIONS.map((n) => chip('meal-name-pick', n, n, clean === n))}</div>
      <div class="field"><span>Change it for</span>${seg('meal-scope', [['day', `Just ${dayWord}`], ['always', 'Every day']], sh.scope)}</div>
      <p class="tiny muted">${always
        ? 'Every day, including past days and the Plan tab. A name you set for a single day still wins on that day.'
        : `Only ${dayWord}. Every other day keeps its usual name${everyday === plan ? '' : ` (${everyday})`}.`}</p>
      ${hasRename ? html`<button class="btn block" data-act="meal-name-reset">Use “${base}”</button>` : ''}
    </div>`,
    foot: html`<button class="btn primary" data-act="meal-name-save" ${raw(clean ? '' : 'disabled')}>Save</button>`,
  };
}

export const mealActions = {
  'meal-rename': (el) => {
    const date = dayModel().date;
    openSheet('renameMeal', { slot: el.dataset.slot, date, name: S.mealLabel(getStore().state, date, el.dataset.slot), scope: 'day' });
  },
  'meal-name-pick': (el) => {
    ui.sheet.name = el.dataset.v;
    render();
  },
  'meal-scope': (el) => {
    ui.sheet.scope = el.dataset.v;
    render();
  },
  'meal-name-save': () => {
    const { date, slot, name, scope } = ui.sheet;
    mutate((s) => S.setMealName(s, date, slot, name, scope));
    closeSheet();
    toast(`Meal is now “${S.mealLabel(getStore().state, date, slot)}”`);
  },
  'meal-name-reset': () => {
    const { date, slot, scope } = ui.sheet;
    mutate((s) => S.setMealName(s, date, slot, '', scope));
    closeSheet();
    toast(`Back to “${S.mealLabel(getStore().state, date, slot)}”`);
  },
};

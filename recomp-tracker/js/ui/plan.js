import { html } from './dom.js';
import { icon, seg, macroLine } from './components.js';
import { ui, mutate, openSheet, toast, render, getStore, foodIndex, todayISO } from './ctx.js';
import { DAY_TYPES, DAY_TYPE_LABEL, DAY_TYPE_SHORT } from '../core/tdee.js';
import { resolveDayType } from '../core/schedule.js';
import { targetsOn, menuDayTotals, menuSlotItems, slotsFor, slotLabel } from '../core/plan.js';
import { rescaleMenu } from '../core/scale.js';
import { shoppingList } from '../core/grocery.js';
import { itemsMacros } from './ctx.js';
import { n0, qtyText } from '../core/format.js';

const state = () => getStore().state;

function currentTargets(s) {
  const today = todayISO();
  return Object.fromEntries(DAY_TYPES.map((t) => [t, targetsOn(s.targetHistory, today, t)]));
}

// Is the menu sized for different targets than the ones in force now?
export function menuOutOfDate(s, index) {
  const menu = s.plan.menus?.[s.prefs.menu];
  if (!menu) return [];
  const out = [];
  const targets = currentTargets(s);
  for (const dt of DAY_TYPES) {
    if (!menu.days?.[dt]) continue;
    const t = menuDayTotals(s.plan, index, s.prefs.menu, dt);
    const g = targets[dt];
    if (Math.abs(t.kcal - g.kcal) > Math.max(75, g.kcal * 0.035) || Math.abs(t.p - g.p) > 12) out.push({ dt, menu: t, target: g });
  }
  return out;
}

export function renderPlan() {
  const s = state();
  const plan = s.plan;
  const index = foodIndex(s);
  const menuIds = Object.keys(plan.menus || {});
  const type = ui.planType || resolveDayType(s, todayISO(), todayISO());
  const targets = currentTargets(s);
  const tg = targets[type];
  const menu = plan.menus?.[s.prefs.menu];
  const stale = menuOutOfDate(s, index);
  const slots = slotsFor(plan, type);
  const list = menu ? shoppingList(s, index, todayISO(), 7, todayISO()) : [];

  return html`<main class="screen">
    <div class="page-head"><div><h1>Plan</h1><div class="small muted">${plan.name}</div></div><button class="btn sm" data-act="targets-open">Edit targets</button></div>
    <div class="stack">
      ${menuIds.length > 1 ? seg('plan-menu', menuIds.map((id) => [id, plan.menus[id].label]), s.prefs.menu) : ''}
      ${seg('plan-type', DAY_TYPES.map((t) => [t, DAY_TYPE_SHORT[t]]), type, '', 'tight')}
      <div class="card"><div class="row between"><div><div class="small muted bold">${DAY_TYPE_LABEL[type]} day target</div><div style="font-size:24px;font-weight:700">${n0(tg.kcal)} <span class="muted small">kcal</span></div></div>${macroLine({ ...tg })}</div></div>
      ${stale.length ? html`<div class="banner">${icon('alert')}<div class="grow"><b>This menu is sized for older targets.</b>
        <div class="small">${stale.map((x) => `${DAY_TYPE_LABEL[x.dt]}: menu ${n0(x.menu.kcal)} vs target ${n0(x.target.kcal)} kcal`).join(' · ')}</div>
        <button class="btn sm primary" style="margin-top:8px" data-act="menu-rescale">Resize menu to my targets</button></div></div>` : ''}
      ${menu?.days?.[type]
        ? slots.map((slot) => {
            const items = menuSlotItems(plan, s.prefs.menu, type, slot);
            const m = itemsMacros(items, index);
            return html`<section class="card" data-key="pl-${slot}"><div class="meal-title"><h3>${slotLabel(plan, slot)}</h3></div>
              <div style="margin:6px 0">${macroLine(m)}</div>
              <div class="list">${items.map((it) => {
                const f = index.get(it.foodId);
                return f ? html`<div class="item"><div class="grow"><div class="title">${f.name}</div><div class="sub">${f.th || ''}${f.cr ? ` · ≈${n0(it.qty * f.cr)} g cooked` : ''}</div></div><b>${qtyText(it.qty, f.unit)}</b></div>` : '';
              })}</div></section>`;
          })
        : html`<div class="card"><p>${menuIds.length ? 'This menu has no meals for this day type.' : 'Your plan has targets but no meal menus. Log what you eat from the Today tab; your targets guide you.'}</p></div>`}
      ${menu ? html`<section class="card"><div class="card-head"><h2>Shopping list · next 7 days</h2><button class="btn sm" data-act="grocery-copy">${icon('copy')} Copy</button></div>
        <p class="tiny muted" style="margin-bottom:6px">Weighed amounts, as written in your menu (raw weight where it says raw). Follows your schedule and any adjustments.</p>
        <div class="list">${list.map((r) => html`<div class="item" data-key="g-${r.food.id}"><div class="grow"><div class="title">${r.food.name}</div><div class="sub">${r.days} day${r.days === 1 ? '' : 's'}</div></div><b>${qtyText(r.qty, r.food.unit)}</b></div>`)}</div></section>` : ''}
    </div>
  </main>`;
}

export const actions = {
  'plan-menu': (el) => mutate((s) => { s.prefs.menu = el.dataset.v; }),
  'plan-type': (el) => {
    ui.planType = el.dataset.v;
    render();
  },
  'targets-open': () => {
    const s = state();
    const t = Object.fromEntries(DAY_TYPES.map((k) => {
      const v = targetsOn(s.targetHistory, todayISO(), k);
      return [k, { p: String(v.p), c: String(v.c), f: String(v.f) }];
    }));
    openSheet('targets', { t });
  },
  'menu-rescale': () => {
    const s = state();
    const id = s.prefs.menu;
    openSheet('confirm', {
      title: 'Resize this menu?',
      message: 'Food amounts in every meal of this menu are re-calculated to hit your current targets, keeping each meal’s share of the day. You can edit individual amounts any time.',
      label: 'Resize menu',
      danger: false,
      onYes: () => {
        mutate((st) => { st.plan.menus[id] = rescaleMenu(st.plan.menus[id], currentTargets(st), foodIndex(st)); });
        toast('Menu resized to your targets');
      },
    });
  },
  'grocery-copy': async () => {
    const s = state();
    const rows = shoppingList(s, foodIndex(s), todayISO(), 7, todayISO());
    const text = 'Shopping list (7 days)\n' + rows.map((r) => `- ${r.food.name}: ${qtyText(r.qty, r.food.unit)}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('List copied');
    } catch {
      toast('Could not copy. Long-press the list to select it.');
    }
  },
};

import { html, raw } from './dom.js';
import { icon, seg, macroLine, banner } from './components.js';
import { getStore, foodIndex, dayModel } from './ctx.js';
import { searchFoods, sortRecent } from '../core/foods.js';
import { foodMacros, macros, kcalOf, entryMacros, diff, round, sumMacros } from '../core/macros.js';
import { swapFood, suggestSwaps } from '../core/swap.js';
import { rebalanceMeals } from '../core/scale.js';
import { slotLabel } from '../core/plan.js';
import { offPlanPrompt } from '../core/prompts.js';
import { n0, n1, qtyText, signed, parseNum } from '../core/format.js';

const unitWord = (f) => (f.unit === 'serving' ? 'servings' : f.unit);
const per = (f) => (f.unit === 'serving' ? 'per serving' : `per 100 ${f.unit}`);
const foodLine = (f) => `${per(f)}: P ${n1(f.p)} · C ${n1(f.c)} · F ${n1(f.f)}${f.a ? ` · alcohol ${n1(f.a)}` : ''}`;

// ---- Add food ---------------------------------------------------------------------

export function addFoodSheet(sh) {
  const index = foodIndex();
  const s = getState();
  const recent = sortRecent(Object.entries(s.days).map(([d, v]) => [d, v.entries]));
  const label = slotLabel(s.plan, sh.slot);
  const tabs = seg('sheet-tab', [['search', 'Search'], ['quick', 'Quick add'], ['new', 'New food']], sh.tab);
  let body;
  let foot = null;

  if (sh.tab === 'search' && sh.foodId && index.get(sh.foodId)) {
    const f = index.get(sh.foodId);
    const qty = parseNum(sh.qty);
    const m = Number.isFinite(qty) && qty > 0 ? foodMacros(f, qty) : null;
    const chips = f.unit === 'serving' ? [0.5, 1, 1.5, 2] : [50, 100, 150, 200, 250];
    body = html`<div class="stack">
      <div><div class="bold" style="font-size:18px">${f.name}${f.est ? html` <span class="pill warn">estimate</span>` : ''}</div>
      ${f.th ? html`<div class="muted">${f.th}</div>` : ''}<div class="small muted" style="margin-top:2px">${foodLine(f)}</div></div>
      ${f.est ? banner('', 'alert', html`Rough estimate, could be off by 25% or more. Weigh the food or edit the numbers if you know them.`) : ''}
      <label class="field"><span>Amount (${unitWord(f)})${f.cr ? ' · weigh it raw' : ''}</span>
        <div class="input-unit"><input class="input num" inputmode="decimal" autocomplete="off" data-input="sheet-field" data-field="qty" value="${sh.qty}" placeholder="${f.unit === 'serving' ? '1' : '100'}" aria-label="Amount"><i>${f.unit === 'serving' ? '×' : f.unit}</i></div></label>
      <div class="chips">${chips.map((c) => html`<button type="button" class="chip" data-act="set-qty" data-v="${c}">${c}${f.unit === 'serving' ? '×' : ' ' + f.unit}</button>`)}</div>
      ${m ? html`<div class="card flat">${macroLine(m)}${f.cr ? html`<div class="tiny muted" style="margin-top:4px">≈ ${n0(qty * f.cr)} g once cooked</div>` : ''}</div>` : ''}
    </div>`;
    foot = html`<button class="btn" data-act="food-back">Back</button><button class="btn primary" data-act="food-add" ${raw(m ? '' : 'disabled')}>Add to ${label}</button>`;
  } else if (sh.tab === 'search') {
    const list = searchFoods(index, sh.q, { limit: 30, recent });
    body = html`<div class="stack">
      <input class="input" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" placeholder="Search foods (English or ไทย)" data-input="sheet-field" data-field="q" data-keep value="${sh.q}" aria-label="Search foods">
      <div class="list">${list.length ? list.map((f) => html`<button class="item" data-act="food-pick" data-id="${f.id}" data-key="f-${f.id}">
        <div class="grow"><div class="title">${f.name}${f.est ? html` <span class="pill warn">estimate</span>` : ''}${f.custom ? html` <span class="pill">mine</span>` : ''}</div><div class="sub">${f.th ? f.th + ' · ' : ''}${foodLine(f)}</div></div></button>`)
        : html`<p class="muted center" style="padding:20px 0">No match. Try <button class="btn sm ghost" data-act="sheet-tab" data-v="new">creating this food</button>.</p>`}</div>
    </div>`;
  } else if (sh.tab === 'quick') {
    const q = sh.quick || {};
    const m = macros({ p: parseNum(q.p) || 0, c: parseNum(q.c) || 0, f: parseNum(q.f) || 0 });
    body = html`<div class="stack">
      <p class="small muted">Know the numbers (a label, a restaurant menu, an AI estimate)? Enter them directly.</p>
      <label class="field"><span>Name</span><input class="input" autocomplete="off" data-input="sheet-field" data-field="quick.name" value="${q.name || ''}" placeholder="e.g. Ramen at lunch"></label>
      <div class="grid3">${['p', 'c', 'f'].map((k) => html`<label class="field"><span class="mc-${k}">${{ p: 'Protein', c: 'Carbs', f: 'Fat' }[k]}</span><div class="input-unit"><input class="input num" inputmode="decimal" autocomplete="off" data-input="sheet-field" data-field="quick.${k}" value="${q[k] ?? ''}" placeholder="0"><i>g</i></div></label>`)}</div>
      <div class="card flat"><b>${n0(m.kcal)} kcal</b> <span class="muted small">(calculated from P, C and F)</span></div>
    </div>`;
    foot = html`<button class="btn primary" data-act="quick-add" ${raw(m.kcal > 0 ? '' : 'disabled')}>Add to ${label}</button>`;
  } else {
    const n = sh.nf || { unit: 'g', cat: 'other' };
    const basisText = n.unit === 'serving' ? 'per 1 serving' : `per 100 ${n.unit}`;
    const kc = kcalOf({ p: parseNum(n.p) || 0, c: parseNum(n.c) || 0, f: parseNum(n.f) || 0, a: parseNum(n.a) || 0 });
    body = html`<div class="stack">
      <p class="small muted">Save a food you eat often. Enter the values from the label, ${basisText}.</p>
      <label class="field"><span>Name</span><input class="input" autocomplete="off" data-input="sheet-field" data-field="nf.name" value="${n.name || ''}" placeholder="e.g. Oat milk"></label>
      <div class="field"><span>Measured in</span>${seg('nf-unit', [['g', 'grams'], ['ml', 'ml'], ['serving', 'servings']], n.unit)}</div>
      <div class="grid3">${['p', 'c', 'f'].map((k) => html`<label class="field"><span class="mc-${k}">${{ p: 'Protein', c: 'Carbs', f: 'Fat' }[k]}</span><div class="input-unit"><input class="input num" inputmode="decimal" autocomplete="off" data-input="sheet-field" data-field="nf.${k}" value="${n[k] ?? ''}" placeholder="0"><i>g</i></div></label>`)}</div>
      ${n.unit !== 'serving' && n.cat === 'drink' ? '' : ''}
      <label class="field"><span>Counts as (used for swaps)</span><select class="input" data-change="nf-cat" aria-label="Category">${[['protein', 'Protein source'], ['carb', 'Carb source'], ['fat', 'Fat source'], ['fruit', 'Fruit'], ['veg', 'Vegetable'], ['dairy', 'Dairy'], ['drink', 'Drink'], ['other', 'Other']].map(([v, l]) => html`<option value="${v}" ${raw(n.cat === v ? 'selected' : '')}>${l}</option>`)}</select></label>
      <div class="card flat"><b>${n0(kc)} kcal</b> <span class="muted small">${basisText}</span></div>
    </div>`;
    foot = html`<button class="btn primary" data-act="nf-save" ${raw(n.name && kc > 0 ? '' : 'disabled')}>Save and use</button>`;
  }
  return { title: `Add to ${label}`, body: html`<div class="stack">${sh.foodId && sh.tab === 'search' ? '' : tabs}${body}</div>`, foot };
}

// ---- Edit a logged entry -------------------------------------------------------------

export function entrySheet(sh) {
  const s = getState();
  const e = s.days[sh.date]?.entries.find((x) => x.id === sh.id);
  if (!e) return { title: 'Entry', body: html`<p class="muted">This entry no longer exists.</p>` };
  const index = foodIndex();
  const f = index.get(e.foodId);
  const qty = sh.qty ?? String(e.qty);
  const q = parseNum(qty);
  const k = Number.isFinite(q) && e.qty > 0 ? q / e.qty : 1;
  const m = entryMacros(e);
  const prev = macros({ p: m.p * k, c: m.c * k, f: m.f * k, a: (e.a || 0) * k });
  return {
    title: e.name,
    body: html`<div class="stack">
      ${e.est ? banner('', 'alert', html`Rough estimate. Edit the amount to match what you actually ate.`) : ''}
      ${e.foodId ? html`<label class="field"><span>Amount (${e.unit === 'serving' ? 'servings' : e.unit})</span><div class="input-unit"><input class="input num" inputmode="decimal" autocomplete="off" data-input="sheet-field" data-field="qty" value="${qty}" aria-label="Amount"><i>${e.unit === 'serving' ? '×' : e.unit}</i></div></label>` : html`<p class="small muted">Quick-add entries scale together: enter a multiplier.</p><label class="field"><span>Multiplier</span><input class="input num" inputmode="decimal" data-input="sheet-field" data-field="qty" value="${qty}"></label>`}
      <div class="card flat">${macroLine(prev)}</div>
      ${f ? html`<button class="btn block" data-act="entry-swap">${icon('swap')} Swap for another food</button>` : ''}
    </div>`,
    foot: html`<button class="btn danger" data-act="entry-delete">${icon('trash')} Delete</button><button class="btn primary" data-act="entry-save" ${raw(Number.isFinite(q) && q > 0 ? '' : 'disabled')}>Save</button>`,
  };
}

// ---- Edit a planned item --------------------------------------------------------------

export function plannedItemSheet(sh) {
  const m = dayModel(sh.date);
  const meal = m.meals.find((x) => x.slot === sh.slot);
  const it = meal?.items[sh.i];
  const f = it && m.index.get(it.foodId);
  if (!f) return { title: 'Item', body: html`<p class="muted">This item is not available.</p>` };
  const qty = sh.qty ?? String(it.qty);
  const q = parseNum(qty);
  const prev = Number.isFinite(q) && q > 0 ? foodMacros(f, q) : null;
  return {
    title: f.name,
    body: html`<div class="stack">
      <div class="small muted">${meal.label} · planned ${qtyText(it.qty, f.unit)}${f.cr ? ` (≈${n0(it.qty * f.cr)} g cooked)` : ''}</div>
      <label class="field"><span>Amount for today (${unitWord(f)})</span><div class="input-unit"><input class="input num" inputmode="decimal" autocomplete="off" data-input="sheet-field" data-field="qty" value="${qty}"><i>${f.unit === 'serving' ? '×' : f.unit}</i></div></label>
      ${prev ? html`<div class="card flat">${macroLine(prev)}</div>` : ''}
      <button class="btn block" data-act="planned-swap">${icon('swap')} Swap for another food</button>
      <button class="btn block danger" data-act="planned-remove">${icon('trash')} Skip this item today</button>
      <p class="tiny muted">Changes here apply to today only. Your plan stays as it is.</p>
    </div>`,
    foot: html`<button class="btn primary" data-act="planned-save" ${raw(prev ? '' : 'disabled')}>Save amount</button>`,
  };
}

// ---- Swap ------------------------------------------------------------------------------

export function swapSource(sh) {
  const s = getState();
  const index = foodIndex();
  if (sh.source === 'entry') {
    const e = s.days[sh.date]?.entries.find((x) => x.id === sh.id);
    const f = e && index.get(e.foodId);
    return f ? { from: f, qty: e.qty, label: 'logged' } : null;
  }
  const m = dayModel(sh.date);
  const it = m.meals.find((x) => x.slot === sh.slot)?.items[sh.i];
  const f = it && index.get(it.foodId);
  return f ? { from: f, qty: it.qty, label: 'planned' } : null;
}

export function swapSheet(sh) {
  const src = swapSource(sh);
  if (!src) return { title: 'Swap', body: html`<p class="muted">Nothing to swap.</p>` };
  const index = foodIndex();
  const { from, qty } = src;
  const target = foodMacros(from, qty);
  const key = { p: 'protein', c: 'carbs', f: 'fat', kcal: 'energy' }[swapFood({ from, fromQty: qty, to: from }).match || 'kcal'];
  let list;
  if (sh.q?.trim()) {
    list = searchFoods(index, sh.q, { limit: 25 }).filter((x) => x.id !== from.id).map((x) => ({ food: x, ...swapFood({ from, fromQty: qty, to: x }) }));
  } else {
    list = suggestSwaps(index, from, qty, { limit: 8 });
  }
  const pick = sh.pick && index.get(sh.pick);
  let body;
  let foot;
  if (pick) {
    const q = parseNum(sh.qty);
    const m = Number.isFinite(q) && q > 0 ? foodMacros(pick, q) : null;
    const d = m ? diff(m, target) : null;
    body = html`<div class="stack">
      <div class="card flat"><div class="small muted">Replacing</div><div class="bold">${from.name}</div><div class="small">${qtyText(qty, from.unit)}</div>${macroLine(target)}</div>
      <div class="center muted">${icon('swap')}</div>
      <div><div class="bold" style="font-size:18px">${pick.name}</div><div class="small muted">${foodLine(pick)}</div></div>
      <label class="field"><span>Amount (${unitWord(pick)})</span><div class="input-unit"><input class="input num" inputmode="decimal" autocomplete="off" data-input="sheet-field" data-field="qty" value="${sh.qty}"><i>${pick.unit === 'serving' ? '×' : pick.unit}</i></div></label>
      ${m ? html`<div class="card flat">${macroLine(m)}<div class="small" style="margin-top:6px">Change: <b class="mc-p">P ${signed(d.p)}</b> · <b class="mc-c">C ${signed(d.c)}</b> · <b class="mc-f">F ${signed(d.f)}</b> · ${signed(d.kcal)} kcal</div></div>` : ''}
      ${pick.cr ? html`<p class="tiny muted">Weigh it raw. ≈ ${n0((parseNum(sh.qty) || 0) * pick.cr)} g once cooked.</p>` : ''}
    </div>`;
    foot = html`<button class="btn" data-act="swap-back">Back</button><button class="btn icon" data-act="swap-ask" aria-label="Ask an AI instead" title="Ask an AI instead">${icon('sparkle')}</button><button class="btn primary" data-act="swap-apply" ${raw(m ? '' : 'disabled')}>Use swap</button>`;
  } else {
    body = html`<div class="stack">
      <div class="card flat"><div class="small muted">Swapping (${src.label})</div><div class="bold">${from.name}: ${qtyText(qty, from.unit)}</div>${macroLine(target)}
        <div class="tiny muted" style="margin-top:4px">Amounts below match the ${key} of what you're replacing.</div></div>
      <input class="input" type="search" autocomplete="off" autocapitalize="off" placeholder="Search any food" data-input="sheet-field" data-field="q" data-keep value="${sh.q || ''}" aria-label="Search foods">
      <div class="list">${list.length ? list.map((r) => r.error
        ? html`<div class="item" data-key="sw-${r.food.id}"><div class="grow"><div class="title muted">${r.food.name}</div><div class="sub">${r.error}</div></div></div>`
        : html`<button class="item" data-act="swap-pick" data-id="${r.food.id}" data-qty="${r.qty}" data-key="sw-${r.food.id}">
            <div class="grow"><div class="title">${r.food.name}</div><div class="sub">P ${signed(r.delta.p)} · C ${signed(r.delta.c)} · F ${signed(r.delta.f)} · ${signed(r.delta.kcal)} kcal</div></div>
            <b>${qtyText(r.qty, r.food.unit)}</b></button>`) : html`<p class="muted center" style="padding:20px 0">No close matches.</p>`}</div>
    </div>`;
    foot = null;
  }
  return { title: 'Swap ingredient', body, foot };
}

// ---- Rebalance the rest of the day ------------------------------------------------------

export function computeRebalance(date) {
  const m = dayModel(date);
  const open = m.meals.filter((x) => x.status === 'open' && x.items.length);
  if (!open.length || !m.remaining) return null;
  return { m, open, res: rebalanceMeals(m.remaining, open.map((x) => ({ slot: x.slot, items: x.items })), m.index) };
}

export function rebalanceSheet(sh) {
  const c = computeRebalance(sh.date);
  if (!c) return { title: 'Rebalance', body: html`<p class="muted">Nothing left to rebalance today.</p>` };
  const { m, open, res } = c;
  const overs = Object.entries(res.overshoot).filter(([, v]) => v > 0.5);
  const eatenPlanned = m.meals.filter((x) => x.status === 'logged');
  const dev = diff(sumMacros(eatenPlanned.map((x) => x.logged)), sumMacros(eatenPlanned.map((x) => x.planned)));
  return {
    title: 'Rebalance today',
    body: html`<div class="stack">
      <div class="card flat"><div class="small muted">Logged meals vs plan</div>
        <div class="bold"><span class="mc-p">P ${signed(dev.p)}</span> · <span class="mc-c">C ${signed(dev.c)}</span> · <span class="mc-f">F ${signed(dev.f)}</span> · ${signed(dev.kcal)} kcal</div>
        <div class="small muted" style="margin-top:6px">Left for today</div>${macroLine(m.remaining)}</div>
      ${overs.length ? banner('bad', 'alert', html`You're already over on ${overs.map(([k, v]) => `${{ p: 'protein', c: 'carbs', f: 'fat' }[k]} (+${n0(v)} g)`).join(', ')}. The meals below leave that out; you can't take food back, so don't try to "make up" for it.`) : ''}
      ${res.meals.map((mm) => {
        const meal = open.find((x) => x.slot === mm.slot);
        const after = mm.scaled.totals;
        return html`<div class="card"><div class="meal-title"><h3>${meal.label}</h3><span class="small muted">${n0(meal.planned.kcal)} → <b>${n0(after.kcal)}</b> kcal</span></div>
          <div class="list" style="margin-top:6px">${meal.items.map((it) => {
            const f = m.index.get(it.foodId);
            const nx = mm.scaled.items.find((x) => x.foodId === it.foodId);
            const q2 = nx ? nx.qty : 0;
            const ch = round(q2 - it.qty, 1);
            return html`<div class="item" data-key="rb-${mm.slot}-${it.foodId}"><div class="grow"><div class="title">${f.name}</div><div class="sub">${qtyText(it.qty, f.unit)} → <b>${q2 ? qtyText(q2, f.unit) : 'skip'}</b></div></div><span class="pill ${ch < 0 ? 'warn' : ch > 0 ? 'ok' : ''}">${ch === 0 ? 'same' : signed(ch)}</span></div>`;
          })}</div>
          <div style="margin-top:6px">${macroLine(after)}</div>
          ${mm.scaled.notes.length ? html`<div class="tiny muted" style="margin-top:4px">${mm.scaled.notes.join(' ')}</div>` : ''}
        </div>`;
      })}
      <p class="tiny muted">Log the meals you've already eaten first, since only meals still to eat are resized. Amounts are for today only; your plan is not changed.</p>
    </div>`,
    foot: html`<button class="btn" data-act="sheet-close">Not now</button><button class="btn primary" data-act="rebalance-apply">Apply to today</button>`,
  };
}

// ---- Prompt helper ------------------------------------------------------------------------

export function promptSheet(sh) {
  let text;
  let title = 'Ask an AI';
  if (sh.text) text = sh.text;
  else {
    const m = dayModel(sh.date);
    const meal = m.meals.find((x) => x.slot === sh.slot);
    const others = m.day.entries.filter((e) => e.slot !== sh.slot);
    const eaten = sumMacros(others.map(entryMacros));
    const remaining = diff(m.target, eaten);
    const upcoming = m.meals.filter((x) => x.slot !== sh.slot && x.status === 'open').map((x) => x.label);
    text = offPlanPrompt({
      slotLabel: meal?.label || 'this meal',
      plannedItems: meal?.items.map((it) => `${m.index.get(it.foodId)?.name || it.foodId} ${qtyText(it.qty, m.index.get(it.foodId)?.unit)}`),
      planned: meal?.planned || macros({}),
      target: m.target,
      eaten,
      remaining,
      upcoming,
    });
  }
  return {
    title,
    body: html`<div class="stack">
      <p class="small">For a meal you can't weigh, photograph it, then paste this into Claude (or another AI) and attach the photo. The numbers for your day are already filled in.</p>
      <pre class="prompt" id="prompt-text">${text}</pre>
      <p class="tiny muted">AI estimates of portions from a photo can be off by 20% or more. Weigh when it matters.</p>
    </div>`,
    foot: html`<button class="btn primary" data-act="prompt-copy">${icon('copy')} Copy text</button><a class="btn" href="https://claude.ai/new" target="_blank" rel="noopener">Open Claude</a>`,
    text,
  };
}

const getState = () => getStore().state;

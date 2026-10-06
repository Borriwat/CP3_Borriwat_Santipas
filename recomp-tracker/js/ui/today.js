import { html } from './dom.js';
import { icon, ring, macroRow, macroLine, seg, chip, checkbox } from './components.js';
import { ui, dayModel, mutate, openSheet, toast, supplementList, latestWeight, itemsMacros, todayISO, render } from './ctx.js';
import { prettyDate, addDays, fromISO } from '../core/dates.js';
import { DAY_TYPES, DAY_TYPE_SHORT } from '../core/tdee.js';
import { TIMINGS } from '../core/plan.js';
import { n0, n1, qtyText, signed, parseNum } from '../core/format.js';
import { entryMacros, diff } from '../core/macros.js';
import { rebalanceMeals } from '../core/scale.js';
import { sessionVolume } from '../core/stats.js';
import * as S from '../core/state.js';

const QLOW_REASONS = ['Big meal', 'Salty meal', 'Alcohol', 'Poor sleep', 'Period / cycle', 'Stress', 'Travel', 'Late meal'];

export function renderToday() {
  const m = dayModel();
  const { plan } = m;
  return html`<main class="screen">
    ${dayNav(m)}
    ${typeSwitcher(m)}
    ${summaryCard(m)}
    ${rebalanceBanner(m)}
    ${m.meals.map((meal) => mealCard(m, meal))}
    ${extraCard(m)}
    ${waterCard(m)}
    ${suppCard(m)}
    ${plan.program ? workoutCard(m) : ''}
    ${cardioCard(m)}
    ${bodyCard(m)}
  </main>`;
}

function dayNav(m) {
  const dt = fromISO(m.date);
  const sub = dt.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const pk = m.programKey && m.plan.program.days[m.programKey];
  return html`<div class="daynav">
    <button class="btn icon ghost" data-act="day-prev" aria-label="Previous day">${icon('chevL')}</button>
    <h1>${prettyDate(m.date, m.today)}<small>${sub}${pk ? ` · ${pk.label}` : ''}</small></h1>
    <button class="btn icon ghost" data-act="day-next" aria-label="Next day">${icon('chevR')}</button>
  </div>
  ${!m.isToday ? html`<div class="center" style="margin:-4px 0 10px"><button class="btn sm soft" data-act="day-today">Back to today</button></div>` : ''}`;
}

function typeSwitcher(m) {
  const opts = DAY_TYPES.map((t) => [t, DAY_TYPE_SHORT[t]]);
  return html`<div style="margin-bottom:12px">
    ${seg('set-type', opts, m.type, 'tight')}
    <p class="tiny muted center" style="margin-top:6px">${m.explicitType ? 'Set by you.' : 'Chosen from your schedule and what you log.'} Targets follow the day type.</p>
  </div>`;
}

function summaryCard(m) {
  const t = m.target;
  const tot = m.totals;
  const burn = (m.day.cardio || []).reduce((a, c) => a + (c.kcal || 0), 0);
  return html`<section class="card" aria-label="Today's totals">
    <div class="row" style="gap:14px">
      ${ring(tot.kcal, t.kcal)}
      <div class="grow stack" style="--g:8px">
        <div><div class="small muted bold">Eaten</div><div style="font-size:22px;font-weight:700">${n0(tot.kcal)} <span class="muted small">/ ${n0(t.kcal)} kcal</span></div></div>
        ${tot.a > 0 ? html`<div class="tiny muted">includes ${n0(tot.a * 7)} kcal from alcohol</div>` : ''}
        ${burn ? html`<div class="tiny muted">Cardio today: ${n0(burn)} kcal</div>` : ''}
      </div>
    </div>
    <div class="divider"></div>
    <div class="stack" style="--g:10px">
      ${macroRow('p', 'Protein', tot.p, t.p)}
      ${macroRow('c', 'Carbs', tot.c, t.c)}
      ${macroRow('f', 'Fat', tot.f, t.f)}
    </div>
  </section>`;
}

// Should we offer to re-split what's left of the day? Only when the open meals no
// longer fit what's left AND resizing them would actually change something. (If the
// foods can't get closer, e.g. fat is already over, offering it again is just noise.)
export function rebalanceNeeded(m) {
  const open = m.meals.filter((x) => x.status === 'open' && x.items.length);
  if (!open.length || !m.meals.some((x) => x.status === 'logged') || !m.remaining) return null;
  const openPlanned = itemsMacros(open.flatMap((x) => x.items), m.index);
  const d = diff(m.remaining, openPlanned);
  if (Math.abs(d.kcal) < 100 && Math.abs(d.p) < 10) return null;
  const res = rebalanceMeals(m.remaining, open.map((x) => ({ slot: x.slot, items: x.items })), m.index);
  const changes = res.meals.some((mm) => {
    const meal = open.find((x) => x.slot === mm.slot);
    const before = new Map(meal.items.map((i) => [i.foodId, i.qty]));
    const after = new Map(mm.scaled.items.map((i) => [i.foodId, i.qty]));
    return [...before.keys()].some((id) => {
      const a = before.get(id);
      const b = after.get(id) ?? 0;
      return Math.abs(b - a) >= Math.max(5, a * 0.05);
    });
  });
  return changes ? { delta: d, open } : null;
}

function rebalanceBanner(m) {
  const r = rebalanceNeeded(m);
  if (!r) return '';
  const over = r.delta.kcal < 0;
  return html`<div class="banner info" style="margin-top:12px">${icon('sparkle')}
    <div class="grow"><b>${over ? 'Over' : 'Under'} plan by about ${n0(Math.abs(r.delta.kcal))} kcal so far.</b>
    <div class="small">Resize the rest of today's meals to land back on target.</div>
    <button class="btn sm primary" style="margin-top:8px" data-act="rebalance-open">Rebalance the rest of today</button></div></div>`;
}

// The meal's name is a button: tap it to rename the meal.
const nameButton = (slot, label) =>
  html`<button type="button" class="name-btn" data-act="meal-rename" data-slot="${slot}" aria-label="Rename ${label}">${label}${icon('edit')}</button>`;

const cooked = (f, qty) => (f?.cr ? html` <span class="muted">· ≈${n0(qty * f.cr)} g cooked</span>` : '');

function mealCard(m, meal) {
  const logged = meal.status === 'logged';
  const shown = logged ? meal.logged : meal.planned;
  const d = logged ? diff(meal.logged, meal.planned) : null;
  const canLog = !logged && meal.items.length > 0;
  return html`<section class="card" style="margin-top:12px" data-key="meal-${meal.slot}">
    <div class="meal-title">
      <h3>${nameButton(meal.slot, meal.label)}</h3>
      <div class="row" style="gap:4px">
        ${logged ? html`<span class="pill ok">${icon('check')} Logged</span>` : meal.adjusted ? html`<span class="pill warn">Adjusted today</span>` : meal.items.length ? html`<span class="pill">Planned</span>` : html`<span class="pill">Empty</span>`}
        <button class="btn sm ghost icon" data-act="ask-claude" data-slot="${meal.slot}" aria-label="Ask an AI about this meal" title="Ask an AI about this meal">${icon('sparkle')}</button>
        ${logged ? html`<button class="btn sm ghost icon" data-act="unlog-meal" data-slot="${meal.slot}" aria-label="Clear this meal" title="Clear this meal">${icon('trash')}</button>` : meal.adjusted ? html`<button class="btn sm ghost icon" data-act="reset-adjust" data-slot="${meal.slot}" aria-label="Reset to the original plan" title="Reset to the original plan">${icon('x')}</button>` : ''}
      </div>
    </div>
    <div style="margin:6px 0 4px">${macroLine(shown)}</div>
    ${logged && meal.items.length ? html`<div class="tiny muted">vs plan: P ${signed(d.p)} · C ${signed(d.c)} · F ${signed(d.f)} · ${signed(d.kcal)} kcal</div>` : ''}
    <div class="list" style="margin-top:6px">
      ${logged
        ? meal.entries.map((e) => entryRow(e, m.index))
        : meal.items.map((it, i) => {
            const f = m.index.get(it.foodId);
            if (!f) return '';
            return html`<button class="item" data-act="planned-item" data-slot="${meal.slot}" data-i="${i}" data-key="p-${meal.slot}-${i}">
              <div class="grow"><div class="title">${f.name}${f.est ? html` <span class="pill warn">estimate</span>` : ''}</div>
              <div class="sub">${qtyText(it.qty, f.unit)}${cooked(f, it.qty)}</div></div>
              <span class="muted">${icon('chevR')}</span></button>`;
          })}
    </div>
    <div class="row" style="margin-top:10px">
      ${canLog ? html`<button class="btn primary grow" data-act="log-planned" data-slot="${meal.slot}">${icon('check')} Log as planned</button>` : ''}
      <button class="btn ${canLog ? '' : 'soft grow'}" data-act="add-food" data-slot="${meal.slot}">${icon('plus')} Add food</button>
    </div>
  </section>`;
}

function entryRow(e, index) {
  const m = entryMacros(e);
  const f = index.get(e.foodId);
  return html`<button class="item" data-act="entry-open" data-id="${e.id}" data-key="e-${e.id}">
    <div class="grow"><div class="title">${e.name}${e.est ? html` <span class="pill warn">estimate</span>` : ''}</div>
    <div class="sub">${e.foodId ? qtyText(e.qty, e.unit) : 'Quick add'}${f ? cooked(f, e.qty) : ''} · P ${n0(m.p)} C ${n0(m.c)} F ${n0(m.f)}</div></div>
    <b>${n0(m.kcal)}</b></button>`;
}

function extraCard(m) {
  const list = m.extraEntries;
  const tot = list.reduce((a, e) => a + entryMacros(e).kcal, 0);
  return html`<section class="card" style="margin-top:12px">
    <div class="meal-title"><h3>${nameButton('extra', S.mealLabel(m.s, m.date, 'extra'))}</h3>${list.length ? html`<span class="pill">${n0(tot)} kcal</span>` : ''}</div>
    ${list.length ? html`<div class="list" style="margin-top:6px">${list.map((e) => entryRow(e, m.index))}</div>` : html`<p class="small muted" style="margin-top:4px">Anything outside your meals. It counts toward today.</p>`}
    <div style="margin-top:10px"><button class="btn soft block" data-act="add-food" data-slot="extra">${icon('plus')} Add food or drink</button></div>
  </section>`;
}

function waterCard(m) {
  const goal = m.s.prefs.waterGoalMl;
  const ml = m.day.water || 0;
  const frac = Math.min(100, Math.round((ml / goal) * 100));
  return html`<section class="card" style="margin-top:12px">
    <div class="meal-title"><h3>${icon('drop', 'inl')} Water</h3><span class="small"><b>${n1(ml / 1000)}</b> / ${n1(goal / 1000)} L</span></div>
    <div class="bar" style="margin:10px 0" role="progressbar" aria-label="Water" aria-valuenow="${ml}" aria-valuemax="${goal}"><i style="width:${frac}%"></i></div>
    <div class="row">
      <button class="btn grow" data-act="water" data-ml="250">+250 ml</button>
      <button class="btn grow" data-act="water" data-ml="500">+500 ml</button>
      <button class="btn icon" data-act="water" data-ml="-250" aria-label="Remove 250 ml">${icon('minus')}</button>
    </div>
  </section>`;
}

function suppCard(m) {
  const list = supplementList(m.s);
  const taken = new Set(m.day.supps);
  const order = Object.keys(TIMINGS);
  const groups = order.map((k) => [k, list.filter((x) => (x.timing || 'morning') === k)]).filter(([, g]) => g.length);
  const done = list.filter((x) => taken.has(x.id)).length;
  return html`<section class="card" style="margin-top:12px">
    <div class="meal-title"><h3>Supplements</h3>${list.length ? html`<span class="pill ${done === list.length ? 'ok' : ''}">${done}/${list.length}</span>` : ''}</div>
    ${list.length
      ? groups.map(([k, g]) => html`<div class="tiny muted bold" style="margin:10px 0 2px;text-transform:uppercase;letter-spacing:.04em">${TIMINGS[k]}</div>
        <div class="list">${g.map((x) => html`<div class="item" data-key="s-${x.id}">${checkbox('supp-toggle', { id: x.id }, taken.has(x.id), x.name)}
          <div class="grow"><div class="title">${x.name}</div><div class="sub">${x.dose}${x.brand ? ' · ' + x.brand : ''}</div></div></div>`)}</div>`)
      : html`<p class="small muted" style="margin-top:4px">${m.plan.supplements.length ? 'Pick the supplements you take and tick them off each day.' : 'Your plan has no supplements. You can still track daily habits in notes.'}</p>`}
    ${m.plan.supplements.length ? html`<div style="margin-top:10px"><button class="btn sm block" data-act="supp-choose">Choose my supplements</button></div>` : ''}
  </section>`;
}

function workoutCard(m) {
  const prog = m.plan.program;
  const w = m.day.workout;
  const key = w?.dayKey || m.programKey;
  const def = prog.days[key];
  const idxOf = prog.cycle.indexOf(key) + 1;
  const edition = w?.edition || m.s.prefs.edition;
  const exs = prog.editions[edition]?.days?.[key] || [];
  const sets = exs.reduce((a, e) => a + e.sets.length, 0);
  let body;
  if (w && w.finishedAt) {
    body = html`<p class="small"><span class="pill ok">${icon('check')} Done</span> Volume <b>${n0(sessionVolume(w))} kg</b></p>
      <button class="btn block" style="margin-top:8px" data-act="goto-train">View workout</button>`;
  } else if (w) {
    const done = w.exercises.reduce((a, e) => a + e.sets.filter((s) => s.done).length, 0);
    body = html`<p class="small">In progress · ${done} sets done</p><button class="btn primary block" style="margin-top:8px" data-act="goto-train">Continue workout</button>`;
  } else if (def.dayType === 'rest') {
    body = html`<p class="small muted">Rest day. Muscle is built while you recover: eat, sleep, walk.</p>
      <button class="btn block" style="margin-top:8px" data-act="goto-train">Train anyway</button>`;
  } else {
    body = html`<p class="small muted">${exs.length} exercises · ${sets} sets${prog.editions[edition]?.label ? ' · ' + prog.editions[edition].label : ''}</p>
      <button class="btn primary block" style="margin-top:8px" data-act="goto-train">${icon('train')} Open workout</button>`;
  }
  return html`<section class="card" style="margin-top:12px"><div class="meal-title"><h3>Training</h3><span class="pill">Day ${idxOf} · ${def.label}</span></div><div style="margin-top:6px">${body}</div></section>`;
}

function cardioCard(m) {
  const list = m.day.cardio || [];
  return html`<section class="card" style="margin-top:12px">
    <div class="meal-title"><h3>Cardio</h3>${list.length ? html`<span class="pill">${n0(list.reduce((a, c) => a + c.kcal, 0))} kcal</span>` : ''}</div>
    ${list.length ? html`<div class="list" style="margin-top:6px">${list.map((c) => html`<div class="item" data-key="c-${c.id}"><div class="grow"><div class="title">${c.kind}</div><div class="sub">${c.min} min · ${n0(c.kcal)} kcal${c.note ? ' · ' + c.note : ''}</div></div><button class="btn icon sm ghost" data-act="cardio-del" data-id="${c.id}" aria-label="Delete">${icon('trash')}</button></div>`)}</div>` : ''}
    <div style="margin-top:10px"><button class="btn soft block" data-act="cardio-open">${icon('plus')} Log cardio</button></div>
    <p class="tiny muted" style="margin-top:6px">Logging cardio switches the day to a cardio day, so your targets adjust.</p>
  </section>`;
}

function bodyCard(m) {
  const d = m.day;
  const q = d.qlow || { on: false, reasons: [] };
  return html`<section class="card" style="margin-top:12px">
    <div class="meal-title"><h3>Body & recovery</h3></div>
    <div class="grid2" style="margin-top:10px">
      <label class="field"><span>Morning weight</span><div class="input-unit"><input class="input num" inputmode="decimal" autocomplete="off" data-change="weight" value="${d.weight ?? ''}" placeholder="${latestWeight(m.s) ?? ''}" aria-label="Morning weight in kilograms"><i>kg</i></div></label>
      <label class="field"><span>Scale body fat</span><div class="input-unit"><input class="input num" inputmode="decimal" autocomplete="off" data-change="bf" value="${d.bf ?? ''}" placeholder="optional" aria-label="Body fat percent from your scale"><i>%</i></div></label>
      <label class="field"><span>Sleep last night</span><div class="input-unit"><input class="input num" inputmode="decimal" autocomplete="off" data-change="sleep" value="${d.sleep?.h ?? ''}" placeholder="7.5" aria-label="Hours slept"><i>h</i></div></label>
      <div class="field"><span>Sleep quality</span><div class="seg" role="group" aria-label="Sleep quality">${[1, 2, 3, 4, 5].map((n) => html`<button type="button" data-act="sleep-q" data-v="${n}" aria-pressed="${String(d.sleep?.q === n)}">${n}</button>`)}</div></div>
    </div>
    <div class="divider"></div>
    <div class="row between">
      <div class="grow"><div class="bold">Scale reading may be off today</div><div class="tiny muted">Mark a day “Q-low” (big or salty meal, alcohol, poor sleep…). It stays in your data but is counted in the review.</div></div>
      <button class="check" data-act="qlow-toggle" aria-pressed="${String(q.on)}" aria-label="Mark as Q-low day">${icon('check')}</button>
    </div>
    ${q.on ? html`<div class="chips" style="margin-top:8px">${QLOW_REASONS.map((r) => chip('qlow-reason', r, r, q.reasons.includes(r)))}</div>` : ''}
    <div class="divider"></div>
    <label class="field"><span>Notes</span><textarea class="input" data-change="notes" placeholder="How did today go?">${d.notes}</textarea></label>
  </section>`;
}

// ---- actions ------------------------------------------------------------------------

export const actions = {
  'day-prev': () => shift(-1),
  'day-next': () => shift(1),
  'day-today': () => {
    ui.date = null;
    render();
  },
  'set-type': (el) => {
    const m = dayModel();
    const v = el.dataset.v;
    mutate((s) => S.setDayType(s, m.date, m.explicitType && m.type === v ? null : v));
  },
  'log-planned': (el) => {
    const m = dayModel();
    const meal = m.meals.find((x) => x.slot === el.dataset.slot);
    if (!meal?.items.length) return;
    mutate((s) => S.logPlannedItems(s, m.date, meal.slot, meal.items, m.index, meal.adjusted ? 'adjusted' : 'plan'));
    toast(`${meal.label} logged`);
  },
  'unlog-meal': (el) => {
    const m = dayModel();
    const slot = el.dataset.slot;
    openSheet('confirm', {
      title: 'Clear this meal?',
      message: 'Removes everything logged for this meal today. Your plan is untouched.',
      label: 'Clear meal',
      onYes: () => mutate((s) => { s.days[m.date].entries = s.days[m.date].entries.filter((e) => e.slot !== slot); }),
    });
  },
  'reset-adjust': (el) => {
    const m = dayModel();
    mutate((s) => S.setAdjust(s, m.date, el.dataset.slot, null));
  },
  'planned-item': (el) => openSheet('plannedItem', { slot: el.dataset.slot, i: Number(el.dataset.i), date: dayModel().date }),
  'entry-open': (el) => openSheet('entry', { id: el.dataset.id, date: dayModel().date, qty: null }),
  'add-food': (el) => openSheet('addFood', { slot: el.dataset.slot, date: dayModel().date, tab: 'search', q: '', foodId: null, qty: '' }),
  'ask-claude': (el) => openSheet('prompt', { slot: el.dataset.slot, date: dayModel().date }),
  'rebalance-open': () => openSheet('rebalance', { date: dayModel().date }),
  water: (el) => {
    const m = dayModel();
    mutate((s) => S.addWater(s, m.date, Number(el.dataset.ml)));
  },
  'supp-toggle': (el) => {
    const m = dayModel();
    mutate((s) => S.toggleSupp(s, m.date, el.dataset.id));
  },
  'supp-choose': () => openSheet('supplements'),
  'goto-train': () => {
    ui.tab = 'train';
    render();
    window.scrollTo(0, 0);
  },
  'cardio-open': () => openSheet('cardio', { date: dayModel().date, kind: 'Run', min: '30', kcal: '', kcalTouched: false, note: '' }),
  'cardio-del': (el) => {
    const m = dayModel();
    mutate((s) => S.removeCardio(s, m.date, el.dataset.id));
  },
  'qlow-toggle': () => {
    const m = dayModel();
    mutate((s) => S.setQlow(s, m.date, !m.day.qlow.on, m.day.qlow.on ? [] : m.day.qlow.reasons));
  },
  'qlow-reason': (el) => {
    const m = dayModel();
    mutate((s) => S.toggleQlowReason(s, m.date, el.dataset.v));
  },
  'sleep-q': (el) => {
    const m = dayModel();
    const q = Number(el.dataset.v);
    mutate((s) => {
      const d = S.ensureDay(s, m.date);
      d.sleep = { h: d.sleep?.h ?? null, q: d.sleep?.q === q ? null : q };
      if (d.sleep.h == null && d.sleep.q == null) d.sleep = null;
    });
  },
};

export const changes = {
  weight: (el) => {
    const m = dayModel();
    const v = parseNum(el.value);
    mutate((s) => S.setWeight(s, m.date, v, undefined));
    if (Number.isFinite(v) && (v < 25 || v > 300)) toast('That weight looks unusual. Double-check it.');
  },
  bf: (el) => {
    const m = dayModel();
    const v = parseNum(el.value);
    mutate((s) => { const d = S.ensureDay(s, m.date); d.bf = Number.isFinite(v) && v > 0 && v < 70 ? v : null; });
  },
  sleep: (el) => {
    const m = dayModel();
    const v = parseNum(el.value);
    mutate((s) => {
      const d = S.ensureDay(s, m.date);
      const q = d.sleep?.q ?? null;
      d.sleep = Number.isFinite(v) && v > 0 && v <= 24 ? { h: v, q } : q != null ? { h: null, q } : null;
    });
  },
  notes: (el) => {
    const m = dayModel();
    mutate((s) => S.setNotes(s, m.date, el.value));
  },
};

function shift(n) {
  const cur = ui.date || todayISO();
  const next = addDays(cur, n);
  ui.date = next === todayISO() ? null : next;
  render();
  window.scrollTo(0, 0);
}

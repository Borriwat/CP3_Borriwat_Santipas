import { html, raw } from './dom.js';
import { icon, seg, chip, checkbox, banner, girthClass } from './components.js';
import { ui, getStore, todayISO, latestWeight } from './ctx.js';
import { addFoodSheet, entrySheet, plannedItemSheet, swapSheet, rebalanceSheet, promptSheet } from './sheets-food.js';
import { pickSessionSheet } from './train.js';
import { aiKeySheet } from './sheets-photo.js';
import { renameMealSheet } from './sheets-meal.js';
import { calculate } from '../core/tdee.js';
import { DAY_TYPES, DAY_TYPE_LABEL } from '../core/tdee.js';
import { TIMINGS } from '../core/plan.js';
import { evaluateReview } from '../core/review.js';
import { normalizeTarget } from '../core/macros.js';
import { addDays, shortDate } from '../core/dates.js';
import { sessionVolume } from '../core/stats.js';
import { n0, signed, parseNum } from '../core/format.js';

export const CARDIO_KINDS = [
  ['Run', 9.8], ['Jog', 7.0], ['Walk', 3.5], ['Brisk walk', 4.3], ['Cycling', 7.5], ['Swimming', 7.0],
  ['Tennis', 7.3], ['HIIT', 8.8], ['Rowing', 7.0], ['Elliptical', 5.0], ['Other', 6.0],
];

const state = () => getStore().state;

// Wrap any sheet in the standard chrome.
function chrome({ title, body, foot }) {
  return html`<div class="sheet-root">
    <div class="sheet-backdrop" data-act="sheet-close"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="sheet-grab"></div>
      <div class="sheet-head"><h2>${title}</h2><button class="btn ghost icon" data-act="sheet-close" aria-label="Close">${icon('x')}</button></div>
      <div class="sheet-body">${body}</div>
      ${foot ? html`<div class="sheet-foot">${foot}</div>` : ''}
    </div>
  </div>`;
}

export function renderSheet() {
  const sh = ui.sheet;
  if (!sh) return '';
  const fn = SHEETS[sh.type];
  return fn ? chrome(fn(sh)) : '';
}

// ---- Generic confirm -----------------------------------------------------------------

function confirmSheet(sh) {
  return {
    title: sh.title,
    body: html`<p>${sh.message}</p>`,
    foot: html`<button class="btn" data-act="confirm-no">Cancel</button><button class="btn ${sh.danger === false ? 'primary' : 'danger'}" data-act="confirm-yes">${sh.label || 'Confirm'}</button>`,
  };
}

// ---- Cardio --------------------------------------------------------------------------

function cardioSheet(sh) {
  const w = latestWeight(state()) || 70;
  const met = CARDIO_KINDS.find((k) => k[0] === sh.kind)?.[1] || 6;
  const min = parseNum(sh.min);
  const auto = Number.isFinite(min) && min > 0 ? Math.round((met * w * min) / 60) : 0;
  const kcal = sh.kcalTouched ? sh.kcal : String(auto || '');
  return {
    title: 'Log cardio',
    body: html`<div class="stack">
      <div class="chips">${CARDIO_KINDS.map(([k]) => chip('cardio-kind', k, k, sh.kind === k))}</div>
      <div class="grid2">
        <label class="field"><span>Minutes</span><div class="input-unit"><input class="input num" inputmode="decimal" data-input="sheet-field" data-field="min" value="${sh.min}"><i>min</i></div></label>
        <label class="field"><span>Energy burned</span><div class="input-unit"><input class="input num" inputmode="decimal" data-input="cardio-kcal" value="${kcal}"><i>kcal</i></div></label>
      </div>
      <p class="tiny muted">Estimated from MET ${met} × ${n0(w)} kg × time. Overwrite it with your watch's number if you have one. It's an estimate either way.</p>
      <label class="field"><span>Note (optional)</span><input class="input" data-input="sheet-field" data-field="note" value="${sh.note || ''}" placeholder="Zone 2, hilly route…"></label>
    </div>`,
    foot: html`<button class="btn primary" data-act="cardio-save" ${raw(Number.isFinite(min) && min > 0 ? '' : 'disabled')}>Save</button>`,
  };
}

// ---- Supplements ----------------------------------------------------------------------

function supplementsSheet() {
  const s = state();
  const all = s.plan.supplements;
  const ids = new Set(s.prefs.supplementIds ?? all.filter((x) => x.base).map((x) => x.id));
  const groups = Object.keys(TIMINGS).map((k) => [k, all.filter((x) => (x.timing || 'morning') === k)]).filter(([, g]) => g.length);
  return {
    title: 'My supplements',
    body: html`<div class="stack">
      <p class="small muted">Tick what you actually take. These doses come from your plan; they are general guidelines, so check with a doctor or pharmacist if you have a medical condition or take medication.</p>
      ${groups.map(([k, g]) => html`<div><div class="tiny muted bold" style="text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">${TIMINGS[k]}</div>
        <div class="list">${g.map((x) => html`<div class="item" data-key="sp-${x.id}">${checkbox('supp-pick', { id: x.id }, ids.has(x.id), x.name)}
          <div class="grow"><div class="title">${x.name}</div><div class="sub">${x.dose}${x.brand ? ' · ' + x.brand : ''}${x.note ? ' · ' + x.note : ''}</div></div></div>`)}</div></div>`)}
    </div>`,
    foot: html`<button class="btn primary" data-act="sheet-close">Done</button>`,
  };
}

// ---- Targets ---------------------------------------------------------------------------

function targetsSheet(sh) {
  const rows = DAY_TYPES.map((t) => {
    const v = sh.t[t];
    const tg = normalizeTarget({ p: parseNum(v.p) || 0, c: parseNum(v.c) || 0, f: parseNum(v.f) || 0 });
    return html`<div class="card flat" data-key="tg-${t}"><div class="bold" style="margin-bottom:6px">${DAY_TYPE_LABEL[t]} <span class="muted small">· ${n0(tg.kcal)} kcal</span></div>
      <div class="grid3">${['p', 'c', 'f'].map((k) => html`<label class="field"><span class="mc-${k}">${{ p: 'Protein', c: 'Carbs', f: 'Fat' }[k]}</span><div class="input-unit"><input class="input num" inputmode="decimal" data-input="target-field" data-t="${t}" data-k="${k}" value="${v[k]}"><i>g</i></div></label>`)}</div></div>`;
  });
  return {
    title: 'Daily targets',
    body: html`<div class="stack">
      <p class="small muted">Energy is calculated from the macros (4 kcal per g of protein and carbs, 9 per g of fat). The change applies from today; earlier days keep the targets they had.</p>
      ${rows}
    </div>`,
    foot: html`<button class="btn" data-act="sheet-close">Cancel</button><button class="btn primary" data-act="targets-save">Save from today</button>`,
  };
}

// ---- Calculator ------------------------------------------------------------------------

export function calcInputs(sh) {
  const f = sh.f;
  const n = (k) => parseNum(f[k]);
  return {
    sex: f.sex, age: n('age'), heightCm: n('heightCm'), weightKg: n('weightKg'), bfPct: n('bfPct'),
    activityKcal: n('activityKcal') || 0, liftKcal: n('liftKcal') || 0,
    cardio: { met: n('cardioMet') || 0, minutes: n('cardioMin') || 0 },
    proteinPerKg: n('perKg') || 2.3, proteinBonus: f.bonus ? 0.1 : 0,
    proteinOverride: Number.isFinite(n('protein')) && n('protein') > 0 ? n('protein') : null,
  };
}

function calcSheet(sh) {
  const f = sh.f;
  let res = null;
  let err = null;
  const inp = calcInputs(sh);
  try {
    if (![inp.age, inp.heightCm, inp.weightKg].every((x) => Number.isFinite(x) && x > 0)) throw new Error('Enter age, height and weight.');
    res = calculate(inp);
  } catch (e) {
    err = e.message;
  }
  const field = (k, label, unit, ph = '') => html`<label class="field"><span>${label}</span><div class="input-unit"><input class="input num" inputmode="decimal" data-input="calc-field" data-k="${k}" value="${f[k] ?? ''}" placeholder="${ph}"><i>${unit}</i></div></label>`;
  return {
    title: 'Targets calculator',
    body: html`<div class="stack">
      <p class="small muted">Estimates energy from your lean body mass, then splits it into protein, fat and carbs. It's a starting point: weigh in, track results, adjust.</p>
      <div class="field"><span>Sex (for the BMR formula)</span>${seg('calc-sex', [['M', 'Male'], ['F', 'Female']], f.sex)}</div>
      <div class="grid2">${field('age', 'Age', 'yrs')}${field('heightCm', 'Height', 'cm')}${field('weightKg', 'Weight', 'kg')}${field('bfPct', 'Body fat', '%', 'e.g. 20')}</div>
      <div class="grid2">${field('activityKcal', 'Daily movement', 'kcal', '400')}${field('liftKcal', 'Lifting session', 'kcal', '300')}</div>
      <div class="grid2">${field('cardioMet', 'Cardio MET', '', '9.8')}${field('cardioMin', 'Cardio length', 'min', '30')}</div>
      <div class="grid2">${field('perKg', 'Protein per kg lean', 'g/kg', '2.3')}${field('protein', 'Or fixed protein', 'g', 'auto')}</div>
      <div class="row"><button class="check" data-act="calc-bonus" aria-pressed="${String(!!f.bonus)}" aria-label="Add 10 percent protein">${icon('check')}</button><div class="small">Add 10% protein (fat loss or recomp)</div></div>
      ${err ? banner('', 'info', err) : ''}
      ${res ? html`<div class="card flat">
        <div class="small muted">Weight at 10% body fat <b>${res.weightAt10} kg</b> · BMR <b>${res.bmr} kcal</b> · cardio session <b>${res.cardioKcal} kcal</b></div>
        <table class="t" style="margin-top:8px"><thead><tr><th>Day</th><th>TDEE</th><th>P</th><th>C</th><th>F</th><th>kcal</th></tr></thead><tbody>
        ${DAY_TYPES.map((t) => html`<tr><td>${DAY_TYPE_LABEL[t]}</td><td>${res.tdee[t]}</td><td>${res.targets[t].p}</td><td>${res.targets[t].c}</td><td>${res.targets[t].f}</td><td><b>${res.targets[t].kcal}</b></td></tr>`)}</tbody></table>
      </div>` : ''}
    </div>`,
    foot: sh.from === 'welcome'
      ? html`<button class="btn primary" data-act="calc-create" ${raw(res ? '' : 'disabled')}>Create my plan</button>`
      : html`<button class="btn" data-act="sheet-close">Close</button><button class="btn primary" data-act="calc-apply" ${raw(res ? '' : 'disabled')}>Use as my targets</button>`,
  };
}

// ---- Import plan --------------------------------------------------------------------------

function importPlanSheet(sh) {
  return {
    title: 'Import a plan file',
    body: html`<div class="stack">
      <p class="small">Choose your plan file (<code>.plan.json</code>) or paste its contents. It's read on this phone and never uploaded anywhere.</p>
      <label class="btn block"><input type="file" accept=".json,application/json,text/plain" data-change="plan-file" style="display:none">${icon('upload')} Choose file</label>
      <label class="field"><span>…or paste the plan text</span><textarea class="input" style="min-height:120px;font:13px ui-monospace,Menlo,monospace" data-input="sheet-field" data-field="text" placeholder='{"schema":"recomp-tracker-plan/1", …}'>${sh.text || ''}</textarea></label>
      ${sh.errors?.length ? banner('bad', 'alert', html`<b>Can't import this plan:</b><ul style="margin:6px 0 0 18px;padding:0">${sh.errors.slice(0, 8).map((e) => html`<li>${e}</li>`)}</ul>${sh.errors.length > 8 ? html`<div class="small">…and ${sh.errors.length - 8} more</div>` : ''}`) : ''}
      ${sh.warnings?.length ? banner('', 'info', html`<b>Heads up:</b><ul style="margin:6px 0 0 18px;padding:0">${sh.warnings.slice(0, 5).map((e) => html`<li>${e}</li>`)}</ul>`) : ''}
      ${state().plan ? banner('', 'info', 'Your logs, weights and measurements are kept. New targets apply from today.') : ''}
    </div>`,
    foot: html`<button class="btn primary" data-act="plan-import" ${raw(sh.text?.trim() ? '' : 'disabled')}>Import plan</button>`,
  };
}

// ---- Measurements -----------------------------------------------------------------------------

function measureSheet(sh) {
  const m = sh.m;
  const f = (k, label) => html`<label class="field"><span>${label}</span><div class="input-unit"><input class="input num" inputmode="decimal" data-input="measure-field" data-k="${k}" value="${m[k] ?? ''}" placeholder=""><i>${k === 'bf' ? '%' : 'cm'}</i></div></label>`;
  return {
    title: 'Body measurements',
    body: html`<div class="stack">
      <label class="field"><span>Date</span><input class="input" type="date" data-input="sheet-field" data-field="date" value="${sh.date}" max="${todayISO()}"></label>
      <p class="small muted">Measure in the same spots, relaxed, same time of day. Waist at the navel, hips at the widest point, chest at the nipple line, thigh and arm at the midpoint.</p>
      <div class="grid2">${f('waist', 'Waist')}${f('hip', 'Hips')}${f('chest', 'Chest')}${f('thigh', 'Thigh')}${f('arm', 'Arm')}${f('bf', 'Body fat (scale)')}</div>
    </div>`,
    foot: html`<button class="btn primary" data-act="measure-save">Save</button>`,
  };
}

// ---- Finish workout ------------------------------------------------------------------------------

function finishWorkoutSheet(sh) {
  const w = state().days[sh.date]?.workout;
  if (!w) return { title: 'Workout', body: html`<p class="muted">No workout.</p>` };
  const done = w.exercises.reduce((a, e) => a + e.sets.filter((x) => x.done).length, 0);
  const total = w.exercises.reduce((a, e) => a + e.sets.length, 0);
  const mins = Math.max(1, Math.round((Date.now() - w.startedAt) / 60000));
  return {
    title: 'Finish workout',
    body: html`<div class="stack">
      <div class="grid3"><div class="stat"><small>Sets</small><b>${done}/${total}</b></div><div class="stat"><small>Volume</small><b>${n0(sessionVolume(w))}</b><span class="muted"> kg</span></div><div class="stat"><small>Time</small><b>${mins}</b><span class="muted"> min</span></div></div>
      ${done < total ? banner('', 'info', `${total - done} sets not ticked. That's fine; only completed sets count.`) : ''}
      <label class="field"><span>Energy burned (optional)</span><div class="input-unit"><input class="input num" inputmode="decimal" data-input="sheet-field" data-field="burn" value="${sh.burn ?? ''}" placeholder="from your watch"><i>kcal</i></div></label>
      <label class="field"><span>Notes</span><input class="input" data-input="sheet-field" data-field="note" value="${sh.note ?? ''}" placeholder="Felt strong, shoulder tight…"></label>
    </div>`,
    foot: html`<button class="btn" data-act="sheet-close">Keep going</button><button class="btn primary" data-act="workout-finish">Finish</button>`,
  };
}

// ---- Choose / shift program day ---------------------------------------------------------------------

function programDaySheet(sh) {
  const s = state();
  const prog = s.plan.program;
  return {
    title: 'Which day is today?',
    body: html`<div class="stack">
      <p class="small muted">Missed a session or swapped days? Say which day of your program today is. The rest of the cycle shifts to follow.</p>
      <div class="list">${prog.cycle.map((k, i) => html`<button class="item" data-act="program-set" data-n="${i + 1}" data-key="pd-${i}"><div class="grow"><div class="title">Day ${i + 1} · ${prog.days[k].label}</div><div class="sub">${prog.days[k].dayType === 'rest' ? 'Rest' : 'Lifting'}</div></div></button>`)}</div>
    </div>`,
  };
}

// ---- Weekly review -------------------------------------------------------------------------------------

function reviewSheet(sh) {
  const s = state();
  const end = sh.end || addDays(todayISO(), -1);
  const r = evaluateReview(s, { end, today: todayISO() });
  const [w1, w2] = r.weeks;
  const hold = r.decision === 'hold';
  const headline = {
    improving: ['Hold: keep your plan', 'Results are moving the right way. Change nothing and keep collecting data.'],
    'insufficient-data': ['Hold: fix the data first', "Progress looks stalled, but the data isn't solid enough to act on yet."],
    'low-discipline': ['Hold: fix consistency first', "Progress looks stalled, but the plan wasn't followed closely enough to judge it."],
    'not-enough-history': ['Hold: not enough data yet', 'Log your food and weigh in for two weeks, then review again.'],
    stalled: ['Next: take the next step', 'Results are stalled, the data is trustworthy and the plan was followed.'],
    'too-fast': ['Next: ease off', 'You are gaining faster than planned.'],
  }[r.why];
  const status = (ok) => html`<span class="pill ${ok ? 'ok' : 'warn'}">${ok ? 'Pass' : 'Needs work'}</span>`;
  const cell = (v, dp = 1, suffix = '') => (v == null ? '–' : `${(Math.round(v * 10 ** dp) / 10 ** dp).toFixed(dp)}${suffix}`);
  const g = (k, label) => {
    const x = r.body[k];
    return x.state === 'ok' ? html`<tr><td>${label}</td><td>${x.base}</td><td>${x.latest}</td><td class="${girthClass(k, x.delta)}">${signed(x.delta, 1)}</td></tr>` : '';
  };
  const measuresShown = ['waist', 'hip', 'chest', 'thigh', 'arm'].some((k) => r.body[k].state === 'ok');
  const prevReview = s.reviews.find((x) => x.date === end);
  return {
    title: 'Bi-weekly review',
    body: html`<div class="stack">
      <label class="field"><span>Review the 14 days ending</span><input class="input" type="date" data-input="review-end" value="${end}" max="${todayISO()}"></label>
      <div class="card ${hold ? 'good' : 'warn'}"><div class="bold" style="font-size:18px">${headline[0]}</div><p class="small" style="margin-top:4px">${headline[1]}</p></div>

      <div class="card"><div class="meal-title"><h3>1 · Results</h3>${r.improving ? html`<span class="pill ok">Moving right</span>` : html`<span class="pill">No clear change</span>`}</div>
        ${r.steps.results.good.length ? html`<ul style="margin:8px 0 0 18px;padding:0">${r.steps.results.good.map((x) => html`<li>${x}</li>`)}</ul>` : html`<p class="small muted" style="margin-top:6px">No drop in waist, hips or body-fat reading, and no clear strength gain, over these two weeks.</p>`}
        ${r.steps.results.tooFast ? html`<p class="small up" style="margin-top:6px">Gaining faster than planned.</p>` : ''}
      </div>

      <div class="card"><div class="meal-title"><h3>2 · Is the data trustworthy?</h3>${status(r.steps.data.pass)}</div>
        ${r.steps.data.reasons.length ? html`<ul style="margin:8px 0 0 18px;padding:0">${r.steps.data.reasons.map((x) => html`<li>${x}</li>`)}</ul>` : html`<p class="small muted" style="margin-top:6px">Weighed on most days with few distorted readings.</p>`}
      </div>

      <div class="card"><div class="meal-title"><h3>3 · Was the plan followed?</h3>${status(r.steps.discipline.pass)}</div>
        ${r.steps.discipline.reasons.length ? html`<ul style="margin:8px 0 0 18px;padding:0">${r.steps.discipline.reasons.map((x) => html`<li>${x}</li>`)}</ul>` : html`<p class="small muted" style="margin-top:6px">Food logged and close to target on most days.</p>`}
        <p class="tiny muted" style="margin-top:6px">Days you didn't log count as missed.</p>
      </div>

      ${r.suggestion ? html`<div class="card warn"><div class="bold">Suggested next step</div><p class="small" style="margin-top:4px">${r.suggestion.text}</p>
        ${r.suggestion.kind === 'adjust-carbs' ? html`<button class="btn primary block" style="margin-top:10px" data-act="review-apply" ${raw(sh.applied ? 'disabled' : '')}>${sh.applied ? 'Applied to your targets' : `Apply: carbs ${signed(r.suggestion.carbs)} g on ${r.suggestion.dayTypes.length === 4 ? 'all days' : 'training days'}`}</button>` : ''}</div>` : ''}

      <div class="card"><h3>The numbers</h3>
        <table class="t" style="margin-top:6px"><thead><tr><th></th><th>${shortDate(w1.range.start)}</th><th>${shortDate(w2.range.start)}</th></tr></thead><tbody>
          <tr><td>Avg weight</td><td>${cell(w1.weight.avg, 2)}</td><td>${cell(w2.weight.avg, 2)}</td></tr>
          <tr><td>Min / max</td><td>${cell(w1.weight.min)} / ${cell(w1.weight.max)}</td><td>${cell(w2.weight.min)} / ${cell(w2.weight.max)}</td></tr>
          <tr><td>Weigh-ins</td><td>${w1.weight.n}/7</td><td>${w2.weight.n}/7</td></tr>
          <tr><td>Q-low days</td><td>${w1.weight.qlowDays}</td><td>${w2.weight.qlowDays}</td></tr>
          ${w1.weight.bfN || w2.weight.bfN ? html`<tr><td>Body fat avg</td><td>${cell(w1.weight.bfAvg, 1, '%')}</td><td>${cell(w2.weight.bfAvg, 1, '%')}</td></tr>` : ''}
          <tr><td>Logged days</td><td>${w1.logged}</td><td>${w2.logged}</td></tr>
          <tr><td>Missed / off target</td><td>${w1.misses}</td><td>${w2.misses}</td></tr>
          <tr><td>Intake vs target</td><td>${w1.avgBias == null ? '–' : signed(w1.avgBias) + ' kcal'}</td><td>${w2.avgBias == null ? '–' : signed(w2.avgBias) + ' kcal'}</td></tr>
          <tr><td>Avg sleep</td><td>${cell(w1.sleepAvg, 1, ' h')}</td><td>${cell(w2.sleepAvg, 1, ' h')}</td></tr>
        </tbody></table>
        ${measuresShown ? html`<table class="t" style="margin-top:10px"><thead><tr><th>Measure</th><th>Before</th><th>Latest</th><th>Change</th></tr></thead><tbody>${g('waist', 'Waist')}${g('hip', 'Hips')}${g('chest', 'Chest')}${g('thigh', 'Thigh')}${g('arm', 'Arm')}</tbody></table>` : ''}
        ${r.strength.compared ? html`<p class="small" style="margin-top:10px"><b>Strength:</b> ${r.strength.improved} of ${r.strength.compared} lifts up, ${r.strength.worse} down.</p>` : ''}
      </div>

      ${r.warnings.map((w) => banner('', 'alert', w))}

      <label class="field"><span>Your notes / decision</span><textarea class="input" data-input="sheet-field" data-field="notes" placeholder="What will you do for the next two weeks?">${sh.notes ?? prevReview?.notes ?? ''}</textarea></label>
      <p class="tiny muted">This is a guide, not an order, and not medical advice. If your weight changes a lot for no clear reason, or you feel unwell, talk to a health professional.</p>
    </div>`,
    foot: html`<button class="btn" data-act="sheet-close">Close</button><button class="btn primary" data-act="review-save">${prevReview ? 'Update note' : 'Save to history'}</button>`,
  };
}

const SHEETS = {
  confirm: confirmSheet,
  addFood: addFoodSheet,
  entry: entrySheet,
  plannedItem: plannedItemSheet,
  swap: swapSheet,
  rebalance: rebalanceSheet,
  prompt: promptSheet,
  aiKey: aiKeySheet,
  renameMeal: renameMealSheet,
  cardio: cardioSheet,
  supplements: supplementsSheet,
  targets: targetsSheet,
  calc: calcSheet,
  importPlan: importPlanSheet,
  measure: measureSheet,
  finishWorkout: finishWorkoutSheet,
  programDay: programDaySheet,
  pickSession: pickSessionSheet,
  review: reviewSheet,
};

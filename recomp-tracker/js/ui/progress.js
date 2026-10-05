import { html } from './dom.js';
import { icon, seg, lineChart, barChart } from './components.js';
import { ui, mutate, openSheet, render, getStore, todayISO } from './ctx.js';
import { addDays, dateRange, diffDays, prettyDate, shortDate } from '../core/dates.js';
import { weekWeightStats, weightSeries, movingAverage, dayStatus, exerciseVolume, sessionHasData, cardioKcalBetween } from '../core/stats.js';
import { resolveDayType } from '../core/schedule.js';
import { targetsOn } from '../core/plan.js';
import { n0, n1, signed } from '../core/format.js';
import * as S from '../core/state.js';

const state = () => getStore().state;

export function renderProgress() {
  const s = state();
  const today = todayISO();
  const range = ui.progressRange;
  const rangeStart = addDays(today, -(range - 1));
  const all = weightSeries(s.days, rangeStart, today);
  // don't leave the left of the chart empty when there's less data than the range
  const start = all.length ? addDays(all[0].date, -1) : rangeStart;
  const series = all;
  const ma = movingAverage(weightSeries(s.days, addDays(start, -6), today), 7).filter((p) => p.date >= start);
  const cur = weekWeightStats(s.days, addDays(today, -6));
  const prev = weekWeightStats(s.days, addDays(today, -13));
  const dAvg = cur.avg != null && prev.avg != null ? cur.avg - prev.avg : null;

  return html`<main class="screen"><div class="page-head"><h1>Progress</h1></div><div class="stack">
    ${reviewCard(s, today)}
    <section class="card"><div class="card-head"><h2>Weight</h2>${seg('progress-range', [[30, '30d'], [60, '60d'], [90, '90d']], range)}</div>
      ${series.length
        ? html`<div class="grid3" style="margin-bottom:10px">
            <div class="stat"><small>7-day average</small><b>${cur.avg != null ? n1(cur.avg) : '–'}</b>${dAvg != null ? html` <span class="${dAvg > 0 ? 'up' : 'down'}">${signed(dAvg, 2)}</span>` : ''}</div>
            <div class="stat"><small>Lowest</small><b>${cur.min != null ? n1(cur.min) : '–'}</b></div>
            <div class="stat"><small>Highest</small><b>${cur.max != null ? n1(cur.max) : '–'}</b></div></div>
          ${lineChart({ series: [{ cls: 's-raw', pts: series.map((p) => ({ date: p.date, v: p.v, q: p.qlow })), dots: true }, { cls: 's-avg', pts: ma, dots: false }], start, end: today, unit: ' kg', label: 'Weight over time' })}
          <p class="tiny muted" style="margin-top:6px">Grey = daily weigh-ins (hollow = Q-low day). Green = 7-day average, the line to watch. One day means little.</p>`
        : html`<p class="muted small">Log your morning weight on the Today tab. Same time, after the toilet, before food or water.</p>`}
    </section>
    ${measurementsCard(s)}
    ${adherenceCard(s, today)}
    ${strengthCard(s, today)}
    ${cardioCard(s, today)}
  </div></main>`;
}

function reviewCard(s, today) {
  const last = s.reviews.at(-1);
  const firstDay = Object.keys(s.days).filter((d) => s.days[d].entries.length || s.days[d].weight).sort()[0];
  const dataDays = firstDay ? diffDays(firstDay, today) + 1 : 0;
  const since = last ? diffDays(last.date, today) : null;
  const due = dataDays >= 14 && (since == null || since >= 14);
  return html`<section class="card ${due ? 'warn' : ''}"><div class="card-head"><h2>Bi-weekly review</h2>${due ? html`<span class="pill warn">Due</span>` : ''}</div>
    <p class="small">${last ? html`Last review ${prettyDate(last.date, today).toLowerCase()}: <b>${last.decision === 'hold' ? 'Hold' : 'Next'}</b>.` : 'Every two weeks, check whether the plan is working before changing anything.'}
      ${!due && dataDays < 14 ? ` Needs about two weeks of data (you have ${dataDays} ${dataDays === 1 ? 'day' : 'days'}).` : ''}</p>
    <button class="btn ${due ? 'primary' : ''} block" style="margin-top:10px" data-act="review-open">Run review</button></section>`;
}

function measurementsCard(s) {
  const list = s.measurements;
  const latest = list.at(-1);
  const prev = list.at(-2);
  const keys = [['waist', 'Waist'], ['hip', 'Hips'], ['chest', 'Chest'], ['thigh', 'Thigh'], ['arm', 'Arm']];
  return html`<section class="card"><div class="card-head"><h2>Measurements</h2><button class="btn sm soft" data-act="measure-open">${icon('plus')} Add</button></div>
    ${latest
      ? html`<table class="t"><thead><tr><th></th><th>${shortDate(latest.date)}</th>${prev ? html`<th>Change</th>` : ''}</tr></thead><tbody>
        ${keys.filter(([k]) => latest[k]).map(([k, label]) => {
          const p = list.slice(0, -1).reverse().find((m) => m[k]);
          const d = p ? latest[k] - p[k] : null;
          return html`<tr><td>${label}</td><td>${n1(latest[k])} cm</td>${prev ? html`<td class="${d < 0 ? 'down' : d > 0 ? 'up' : ''}">${d == null ? '–' : signed(d, 1)}</td>` : ''}</tr>`;
        })}</tbody></table>
        <div class="list" style="margin-top:8px">${[...list].reverse().slice(0, 4).map((m) => html`<div class="item" data-key="m-${m.id}"><div class="grow"><div class="sub">${shortDate(m.date)} · ${keys.filter(([k]) => m[k]).map(([k]) => `${k} ${n1(m[k])}`).join(' · ')}</div></div><button class="btn icon sm ghost" data-act="measure-del" data-id="${m.id}" aria-label="Delete">${icon('trash')}</button></div>`)}</div>`
      : html`<p class="small muted">Waist and hips can drop even when the scale doesn't move, which is exactly what a recomp looks like. Measure every week or two.</p>`}
  </section>`;
}

function adherenceCard(s, today) {
  const days = dateRange(addDays(today, -13), today);
  const tol = s.prefs.tolerance;
  const cells = days.map((d) => {
    const type = resolveDayType(s, d, today);
    const st = dayStatus(s.days[d], targetsOn(s.targetHistory, d, type), tol);
    const trained = !!s.days[d]?.workout?.finishedAt;
    return { d, st: st.status, trained, label: `${prettyDate(d, today)}: ${st.status === 'on' ? 'on target' : st.status === 'off' ? 'off target' : 'not logged'}${trained ? ', trained' : ''}` };
  });
  const on = cells.filter((c) => c.st === 'on').length;
  const logged = cells.filter((c) => c.st !== 'unlogged').length;
  return html`<section class="card"><div class="card-head"><h2>Last 14 days</h2><span class="pill ${on >= 10 ? 'ok' : ''}">${on} on target</span></div>
    <div class="strip" role="img" aria-label="${on} of 14 days on target, ${logged} logged">${cells.map((c) => html`<i class="${c.st === 'on' ? 'on' : c.st === 'off' ? 'off' : ''} ${c.trained ? 't' : ''}" title="${c.label}"></i>`)}</div>
    <p class="tiny muted" style="margin-top:12px">Green = within ${tol.kcal} kcal and ${tol.p} g protein of target. Amber = logged but off. Grey = not logged. Dot below = trained.</p></section>`;
}

function strengthCard(s, today) {
  const by = new Map();
  for (const [d, day] of Object.entries(s.days)) {
    if (!sessionHasData(day.workout)) continue;
    for (const ex of day.workout.exercises) {
      const v = exerciseVolume(ex);
      if (v <= 0) continue;
      const r = by.get(ex.id) || { id: ex.id, name: ex.name, pts: [] };
      r.pts.push({ date: d, v });
      by.set(ex.id, r);
    }
  }
  const exs = [...by.values()].sort((a, b) => b.pts.length - a.pts.length);
  if (!exs.length) {
    return html`<section class="card"><div class="card-head"><h2>Strength</h2></div><p class="small muted">Finish a workout and your volume (weight × reps) per exercise shows up here. If it trends up, you're getting stronger.</p></section>`;
  }
  const sel = exs.find((e) => e.id === ui.strengthEx) || exs[0];
  const pts = sel.pts.sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-10);
  const first = pts[0].v;
  const last = pts.at(-1).v;
  return html`<section class="card"><div class="card-head"><h2>Strength</h2>${pts.length > 1 ? html`<span class="pill ${last >= first ? 'ok' : 'warn'}">${signed(((last - first) / first) * 100)}%</span>` : ''}</div>
    <label class="field"><span>Exercise</span><select class="input" data-change="strength-ex" aria-label="Exercise">${exs.map((e) => html`<option value="${e.id}" ${e.id === sel.id ? 'selected' : ''}>${e.name} (${e.pts.length})</option>`)}</select></label>
    <div style="margin-top:10px">${barChart({ pts, label: `${sel.name} volume per session` })}</div>
    <p class="tiny muted">Volume = weight × reps over your working sets, per session.</p></section>`;
}

function cardioCard(s, today) {
  const wk = cardioKcalBetween(s.days, addDays(today, -6), today);
  const goal = s.plan.cardio?.weeklyKcalGoal || 0;
  if (!wk && !goal) return '';
  return html`<section class="card"><div class="card-head"><h2>Cardio · last 7 days</h2><span class="pill">${n0(wk)} kcal</span></div>
    ${goal ? html`<div class="bar"><i style="width:${Math.min(100, Math.round((wk / goal) * 100))}%"></i></div><p class="tiny muted" style="margin-top:6px">Goal ${n0(goal)} kcal per week.</p>` : ''}</section>`;
}

export const actions = {
  'progress-range': (el) => {
    ui.progressRange = Number(el.dataset.v);
    render();
  },
  'review-open': () => openSheet('review', { end: null, notes: undefined, applied: false }),
  'measure-open': () => openSheet('measure', { date: todayISO(), m: {} }),
  'measure-del': (el) => mutate((s) => S.removeMeasurement(s, el.dataset.id)),
};

export const changes = {
  'strength-ex': (el) => {
    ui.strengthEx = el.value;
    render();
  },
};

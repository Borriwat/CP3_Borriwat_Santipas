import { html } from './dom.js';
import { icon, seg, banner } from './components.js';
import { ui, mutate, openSheet, toast, getStore, todayISO, latestWeight } from './ctx.js';
import { DAY_TYPES, DAY_TYPE_LABEL } from '../core/tdee.js';
import { targetsOn } from '../core/plan.js';
import { exportState, parseBackup, defaultState } from '../core/state.js';
import { buildReminders } from '../core/ics.js';
import { programDayKey, cycleIndex } from '../core/schedule.js';
import { n0, n1, parseNum } from '../core/format.js';
import { aiSettingsCard, keys } from './sheets-photo.js';

export const APP_VERSION = '1.2.0';
const state = () => getStore().state;

export function renderMore() {
  const s = state();
  const store = getStore();
  const plan = s.plan;
  const today = todayISO();
  const menuIds = Object.keys(plan.menus || {});
  const editions = Object.entries(plan.program?.editions || {});
  const rem = { weigh: '07:00', log: '21:00', measure: '08:00', review: '09:00', ...(s.prefs.reminders || {}) };
  const prog = plan.program;
  const dayNo = prog ? cycleIndex(today, s.prefs.programAnchor, prog.cycle.length) + 1 : null;

  return html`<main class="screen"><div class="page-head"><h1>More</h1></div><div class="stack">
    ${store.meta.kind === 'memory' ? banner('bad', 'alert', html`<b>Your data is not being saved.</b> This browser is blocking storage (private browsing?). Open the app in a normal Safari tab or from the Home Screen.`) : ''}
    ${store.meta.saveError ? banner('bad', 'alert', html`<b>Could not save:</b> ${store.meta.saveError}. Export a backup now.`) : ''}

    <section class="card"><div class="card-head"><h2>My plan</h2><span class="pill">${plan.phase}</span></div>
      <div class="bold">${plan.name}</div>${plan.source ? html`<div class="tiny muted">${plan.source}</div>` : ''}
      <div class="stack" style="margin-top:12px">
        ${menuIds.length > 1 ? html`<div class="field"><span class="small muted bold">Meal menu</span>${seg('plan-menu', menuIds.map((id) => [id, plan.menus[id].label]), s.prefs.menu)}</div>` : ''}
        ${editions.length > 1 ? html`<div class="field"><span class="small muted bold">Training edition</span>${seg('set-edition', editions.map(([k, v]) => [k, v.label]), s.prefs.edition)}</div>` : ''}
        ${prog ? html`<div class="row between"><div><div class="bold">Program schedule</div><div class="small muted">Today is Day ${dayNo} · ${prog.days[programDayKey(plan, today, s.prefs.programAnchor)].label}</div></div><button class="btn sm" data-act="program-open">Change</button></div>` : ''}
        <button class="btn block" data-act="plan-import-open">${icon('upload')} Import a different plan</button>
      </div></section>

    <section class="card"><div class="card-head"><h2>Daily targets</h2><button class="btn sm" data-act="targets-open">Edit</button></div>
      <table class="t"><thead><tr><th>Day</th><th>P</th><th>C</th><th>F</th><th>kcal</th></tr></thead><tbody>
      ${DAY_TYPES.map((t) => { const g = targetsOn(s.targetHistory, today, t); return html`<tr><td>${DAY_TYPE_LABEL[t]}</td><td>${n0(g.p)}</td><td>${n1(g.c)}</td><td>${n0(g.f)}</td><td><b>${n0(g.kcal)}</b></td></tr>`; })}</tbody></table>
      <button class="btn block" style="margin-top:10px" data-act="calc-open">Recalculate from body stats</button></section>

    <section class="card"><div class="card-head"><h2>Daily habits</h2></div>
      <label class="field"><span>Water goal</span><div class="input-unit"><input class="input num" inputmode="decimal" data-change="water-goal" value="${s.prefs.waterGoalMl / 1000}"><i>L</i></div></label>
      ${plan.supplements.length ? html`<button class="btn block" style="margin-top:10px" data-act="supp-choose">Choose my supplements</button>` : ''}
    </section>

    ${aiSettingsCard(s)}

    ${s.customFoods.length ? html`<section class="card"><div class="card-head"><h2>My foods</h2></div><div class="list">${s.customFoods.map((f) => html`<div class="item" data-key="cf-${f.id}"><div class="grow"><div class="title">${f.name}</div><div class="sub">${f.unit === 'serving' ? 'per serving' : 'per 100 ' + f.unit}: P ${n1(f.p)} · C ${n1(f.c)} · F ${n1(f.f)}</div></div><button class="btn icon sm ghost" data-act="food-del" data-id="${f.id}" aria-label="Delete ${f.name}">${icon('trash')}</button></div>`)}</div></section>` : ''}

    <section class="card"><div class="card-head"><h2>Reminders</h2></div>
      <p class="small muted">A web app can't ring your phone by itself, but Calendar can. Download these, open the file, and tap “Add All”. You get a daily weigh-in and logging nudge, plus weekly measurements and the bi-weekly review.</p>
      <div class="grid2" style="margin-top:10px">
        ${[['weigh', 'Weigh-in'], ['log', 'Log your day'], ['measure', 'Measurements'], ['review', 'Review']].map(([k, l]) => html`<label class="field"><span>${l}</span><input class="input" type="time" data-change="reminder-time" data-k="${k}" value="${rem[k]}"></label>`)}
      </div>
      <button class="btn block" style="margin-top:10px" data-act="reminders-download">${icon('download')} Download calendar reminders</button></section>

    <section class="card"><div class="card-head"><h2>Backup & data</h2></div>
      <p class="small muted">Everything lives on this phone only. The backup file contains your plan too, so keep it private. Back up before changing phones or clearing Safari data, and now and then anyway.</p>
      <div class="stack" style="margin-top:10px">
        <button class="btn primary block" data-act="backup-export">${icon('download')} Export backup</button>
        <label class="btn block"><input type="file" accept=".json,application/json" data-change="backup-file" style="display:none">${icon('upload')} Restore from backup</label>
        <button class="btn danger block" data-act="reset-all">${icon('trash')} Delete all data on this phone</button>
      </div>
      <p class="tiny muted" style="margin-top:8px">Storage: ${store.meta.kind}${store.meta.persisted ? ' (protected)' : ''}. ${s.v ? `Data version ${s.v}.` : ''}</p></section>

    <section class="card"><div class="card-head"><h2>Appearance</h2></div>
      ${seg('theme', [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], s.prefs.theme)}
      <div class="row between" style="margin-top:12px"><div><div class="bold">Rest timer sound</div><div class="tiny muted">Beeps when the rest is over</div></div><button class="check" data-act="sound-toggle" aria-pressed="${String(s.prefs.sound !== false)}" aria-label="Rest timer sound">${icon('check')}</button></div></section>

    <section class="card flat"><h2>About</h2>
      <p class="small muted" style="margin-top:6px">Recomp Tracker ${APP_VERSION}. Works offline. Your data never leaves this device unless you export it or use photo logging, which sends the photo you choose to Anthropic.</p>
      <p class="small muted" style="margin-top:6px">Food values are approximate and meant to help you stay near your targets, not to be exact. This app gives general guidance for diet and training and is not medical advice. If you have a medical condition, are pregnant, or take medication, talk to a doctor or dietitian before changing how you eat or train.</p></section>
  </div></main>`;
}

// ---- helpers ------------------------------------------------------------------------------------

function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const actions = {
  'plan-import-open': () => openSheet('importPlan', { text: '', errors: [], warnings: [] }),
  'calc-open': () => {
    const s = state();
    const p = s.plan.profile || {};
    openSheet('calc', {
      from: 'more',
      f: {
        sex: s.prefs.sex || p.sex || 'M', age: p.age ?? '', heightCm: p.heightCm ?? '', weightKg: latestWeight(s) ?? p.weightKg ?? '', bfPct: p.bfPct ?? '',
        activityKcal: '400', liftKcal: '300', cardioMet: String(s.plan.cardio?.met ?? 9.8), cardioMin: '30', perKg: '2.3', bonus: true, protein: '',
      },
    });
  },
  'food-del': (el) => mutate((s) => { s.customFoods = s.customFoods.filter((f) => f.id !== el.dataset.id); }),
  theme: (el) => mutate((s) => { s.prefs.theme = el.dataset.v; }),
  'sound-toggle': () => mutate((s) => { s.prefs.sound = s.prefs.sound === false; }),
  'backup-export': async () => {
    const s = state();
    const text = exportState(s);
    const name = `recomp-tracker-backup-${todayISO()}.json`;
    try {
      const file = new File([text], name, { type: 'application/json' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Recomp Tracker backup' });
        toast('Backup shared');
        return;
      }
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
    download(name, text, 'application/json');
    toast('Backup downloaded');
  },
  'reset-all': () =>
    openSheet('confirm', {
      title: 'Delete everything?',
      message: 'This permanently deletes your plan, logs, weights, workouts, measurements and your AI photo key from this phone. If you have not exported a backup, they cannot be recovered.',
      label: 'Delete all data',
      onYes: () => {
        getStore().replace(defaultState(todayISO()));
        keys.clear();
        ui.aiTest = null;
        ui.tab = 'today';
        ui.date = null;
        toast('All data deleted');
      },
    }),
  'reminders-download': () => {
    const s = state();
    const ics = buildReminders({ startDate: todayISO(), times: s.prefs.reminders || {} });
    download('recomp-reminders.ics', ics, 'text/calendar');
    toast('Open the file, then tap Add All');
  },
};

export const changes = {
  'water-goal': (el) => {
    const v = parseNum(el.value);
    if (v > 0 && v < 15) mutate((s) => { s.prefs.waterGoalMl = Math.round(v * 1000); });
  },
  'reminder-time': (el) => mutate((s) => { s.prefs.reminders = { ...(s.prefs.reminders || {}), [el.dataset.k]: el.value }; }),
  'backup-file': async (el) => {
    const file = el.files?.[0];
    if (!file) return;
    const text = await file.text();
    el.value = '';
    const r = parseBackup(text, todayISO());
    if (!r.ok) return toast(r.error, 4200);
    openSheet('confirm', {
      title: 'Restore this backup?',
      message: `This replaces everything currently on this phone with the backup (${Object.keys(r.state.days).length} logged days). Export a backup of your current data first if you might need it.`,
      label: 'Replace my data',
      danger: false,
      onYes: () => {
        getStore().replace(r.state);
        toast('Backup restored');
      },
    });
  },
};

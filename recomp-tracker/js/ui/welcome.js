import { html } from './dom.js';
import { icon } from './components.js';
import { mutate, openSheet, toast, render, todayISO } from './ctx.js';
import { buildExamplePlan } from '../data/example-plan.js';
import { validatePlan } from '../core/plan.js';
import { applyPlan } from '../core/state.js';

export function installHint() {
  const standalone = window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let dismissed = false;
  try {
    dismissed = localStorage.getItem('rt-install-dismissed') === '1';
  } catch {
    /* ignore */
  }
  if (standalone || dismissed || !ios) return '';
  return html`<div class="banner info" style="margin:0 0 12px">${icon('download')}<div class="grow"><b>Install first.</b> In Safari tap <b>Share</b>, then <b>Add to Home Screen</b>, and open the app from the new icon <b>before</b> importing your plan. The installed app keeps its own storage, separate from Safari.
    <div><button class="btn sm ghost" style="padding:0" data-act="install-dismiss">Got it</button></div></div></div>`;
}

export function renderWelcome() {
  return html`<main class="welcome">
    <div class="row" style="gap:14px"><img class="logo" src="icons/icon.svg" alt="" width="56" height="56" style="width:56px;height:56px"><h1 style="font-size:30px">Recomp Tracker</h1></div>
    <p class="muted" style="font-size:17px">Track meals and macros, training, weight and bi-weekly reviews. All on your phone, no account.</p>
    <div class="stack">
      <button class="btn primary block" data-act="plan-import-open">${icon('upload')} Import my plan file</button>
      <button class="btn block" data-act="calc-welcome">Set up from my body stats</button>
      <button class="btn ghost block" data-act="try-example">Try it with an example plan</button>
    </div>
    ${installHint()}
    <div class="stack" style="--g:14px">
      <div class="feature">${icon('today')}<div><b>Hit your numbers</b><div class="small muted">Log meals in a tap, swap ingredients, and rebalance the rest of the day when you eat off-plan.</div></div></div>
      <div class="feature">${icon('train')}<div><b>Train with a plan</b><div class="small muted">Set-by-set logging, last-time hints and a rest timer.</div></div></div>
      <div class="feature">${icon('progress')}<div><b>Know when to change</b><div class="small muted">Weight trends, measurements, and a Hold-or-Next review every two weeks.</div></div></div>
      <div class="feature">${icon('shield')}<div><b>Private</b><div class="small muted">Your data and plan stay on this device. The only thing that is ever sent is a meal photo you choose to have analysed (optional).</div></div></div>
    </div>
    <p class="tiny muted center">General guidance, not medical advice.</p>
  </main>`;
}

export const actions = {
  'install-dismiss': () => {
    try {
      localStorage.setItem('rt-install-dismissed', '1');
    } catch {
      /* ignore */
    }
    render();
  },
  'try-example': () => {
    const v = validatePlan(buildExamplePlan());
    mutate((s) => applyPlan(s, v.plan, todayISO()));
    toast('Example plan loaded. Import your own any time from More.');
  },
  'calc-welcome': () =>
    openSheet('calc', {
      from: 'welcome',
      f: { sex: 'M', age: '', heightCm: '', weightKg: '', bfPct: '', activityKcal: '400', liftKcal: '300', cardioMet: '9.8', cardioMin: '30', perKg: '2.3', bonus: true, protein: '' },
    }),
};

import './core/polyfills.js';
import { createStore } from './core/store.js';
import { createStorage, requestPersistence } from './core/storage.js';
import { morph, html } from './ui/dom.js';
import { ui, bindStore, setRender, getStore, closeSheet, releaseSheet } from './ui/ctx.js';
import { icon } from './ui/components.js';
import { renderSheet } from './ui/sheets.js';
import { renderToday, actions as todayA, changes as todayC } from './ui/today.js';
import { renderPlan, actions as planA } from './ui/plan.js';
import { renderTrain, actions as trainA, changes as trainC, syncWakeLock, unlockAudio } from './ui/train.js';
import { renderProgress, actions as progressA, changes as progressC } from './ui/progress.js';
import { renderMore, actions as moreA, changes as moreC } from './ui/more.js';
import { renderWelcome, actions as welcomeA } from './ui/welcome.js';
import { sheetActions, sheetChanges, inputs as sheetInputs } from './ui/sheet-actions.js';
import { photoActions, photoChanges, photoInputs } from './ui/sheets-photo.js';

const TABS = [
  ['today', 'Today', 'today'],
  ['plan', 'Plan', 'plan'],
  ['train', 'Train', 'train'],
  ['progress', 'Progress', 'progress'],
  ['more', 'More', 'more'],
];
const VIEWS = { today: renderToday, plan: renderPlan, train: renderTrain, progress: renderProgress, more: renderMore };

const ACTIONS = {
  ...todayA, ...planA, ...trainA, ...progressA, ...moreA, ...welcomeA, ...sheetActions, ...photoActions,
  tab: (el) => {
    ui.tab = el.dataset.v;
    releaseSheet();
    try {
      sessionStorage.setItem('rt-tab', ui.tab);
    } catch {
      /* ignore */
    }
    render();
    window.scrollTo(0, 0);
  },
  'update-reload': () => location.reload(),
};
const CHANGES = { ...todayC, ...trainC, ...progressC, ...moreC, ...sheetChanges, ...photoChanges };
const INPUTS = { ...sheetInputs, ...photoInputs };

const $ = (id) => document.getElementById(id);

function tabbar() {
  return html`<nav class="tabbar" aria-label="Main"><div class="tabbar-inner">${TABS.map(([id, label, ic]) => html`<button class="tab" data-act="tab" data-v="${id}" ${ui.tab === id ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span></button>`)}</div></nav>`;
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}

function paint() {
  const store = getStore();
  if (!store?.meta.ready) return;
  const s = store.state;
  try {
    applyTheme(s.prefs.theme);
    const view = s.plan ? html`${(VIEWS[ui.tab] || renderToday)()}${tabbar()}` : renderWelcome();
    morph($('app'), view);
    morph($('sheet'), renderSheet());
    morph($('toast'), ui.flash ? html`<div class="toast" role="status">${ui.flash}</div>` : '');
    morph($('banner-root'), ui.updateReady ? html`<div class="banner info" style="position:fixed;top:calc(var(--safe-t) + 8px);left:12px;right:12px;z-index:60;max-width:536px;margin:auto">${icon('info')}<div class="grow">A new version is ready.</div><button class="btn sm primary" data-act="update-reload">Reload</button></div>` : '');
    document.body.classList.toggle('locked', !!ui.sheet);
    syncWakeLock();
  } catch (e) {
    console.error(e);
    $('app').innerHTML = `<main class="welcome"><h1>Something went wrong</h1><p class="muted">The screen could not be drawn. Your data is safe. Export a backup first, then reload.</p>
      <pre class="prompt">${String(e?.stack || e).replace(/[<&]/g, (c) => ({ '<': '&lt;', '&': '&amp;' })[c]).slice(0, 600)}</pre>
      <button class="btn primary block" data-act="backup-export">Export backup</button><button class="btn block" data-act="update-reload">Reload</button></main>`;
  }
}

let scheduled = false;
function render() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    paint();
  });
}

function wireEvents() {
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    const fn = ACTIONS[el.dataset.act];
    if (!fn) return console.warn('No action:', el.dataset.act);
    unlockAudio();
    fn(el, ev);
  });
  document.addEventListener('change', (ev) => {
    const el = ev.target.closest('[data-change]');
    if (!el) return;
    const fn = CHANGES[el.dataset.change];
    if (fn) fn(el, ev);
    else console.warn('No change handler:', el.dataset.change);
  });
  document.addEventListener('input', (ev) => {
    const el = ev.target.closest('[data-input]');
    if (!el) return;
    const fn = INPUTS[el.dataset.input];
    if (fn) fn(el, ev);
    else console.warn('No input handler:', el.dataset.input);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && ui.sheet) closeSheet();
    // Enter commits a field and closes the keyboard (except in multi-line notes)
    if (ev.key === 'Enter' && ev.target.tagName === 'INPUT' && ev.target.type !== 'file') ev.target.blur();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') getStore().flush();
    else {
      getStore().rollover();
      render();
    }
  });
  window.addEventListener('pagehide', () => getStore().flush());
}

async function boot() {
  const storage = await createStorage();
  const store = createStore(storage);
  bindStore(store);
  setRender(render);
  store.subscribe(render);
  try {
    ui.tab = sessionStorage.getItem('rt-tab') || 'today';
  } catch {
    /* ignore */
  }
  wireEvents();
  await store.init();
  requestPersistence().then((p) => {
    store.meta.persisted = p;
  });
  paint();
  window.__app = { store, ui }; // handy for debugging and tests

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker failed:', e));
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (had) {
        ui.updateReady = true;
        render();
      }
    });
  }
}

boot();

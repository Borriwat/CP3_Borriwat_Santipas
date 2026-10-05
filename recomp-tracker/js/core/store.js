// Live app store: holds the state, saves it (debounced), and tells the UI to
// re-render. Mutations go through update(fn) where fn edits the state in place.

import { defaultState, parseBackup } from './state.js';
import { todayISO } from './dates.js';

export function createStore(storage, { saveDelay = 350, today = todayISO } = {}) {
  let state = defaultState(today());
  const listeners = new Set();
  let timer = null;
  let saving = Promise.resolve();
  const meta = { ready: false, saveError: null, kind: storage.kind, loadError: null };

  const notify = () => listeners.forEach((fn) => fn());

  async function persist() {
    timer = null;
    try {
      // Snapshot now so edits made while the write is in flight aren't half-saved.
      const snapshot = structuredClone(state);
      saving = saving.then(() => storage.save(snapshot));
      await saving;
      meta.saveError = null;
    } catch (e) {
      meta.saveError = e?.message || 'Could not save';
    }
    notify();
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(persist, saveDelay);
  }

  return {
    meta,
    get state() {
      return state;
    },
    today,

    async init() {
      try {
        const raw = await storage.load();
        if (raw) {
          // Run through the same validation as an import so odd/old data can't crash the app.
          const r = parseBackup(JSON.stringify({ app: 'recomp-tracker', state: raw }), today());
          if (r.ok) state = r.state;
          else meta.loadError = r.error;
        }
      } catch (e) {
        meta.loadError = e?.message || 'Could not read saved data';
      }
      meta.ready = true;
      notify();
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    update(fn) {
      fn(state);
      schedule();
      notify();
    },

    replace(next) {
      state = next;
      schedule();
      notify();
    },

    // Save right now (page hidden / closing).
    async flush() {
      if (timer) {
        clearTimeout(timer);
        await persist();
      } else {
        await saving;
      }
    },
  };
}

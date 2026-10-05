import { html } from './dom.js';
import { icon, seg } from './components.js';
import { ui, mutate, openSheet, render, getStore, viewDate, todayISO } from './ctx.js';
import { programDayKey } from '../core/schedule.js';
import { exercisesFor, SET_TYPES } from '../core/plan.js';
import { lastPerformance, nextHint, sessionVolume, isWorkingSet } from '../core/stats.js';
import { n0, parseNum } from '../core/format.js';
import { prettyDate } from '../core/dates.js';
import * as S from '../core/state.js';

const state = () => getStore().state;

const tagClass = (t) => (t === 'fail' || t === 'w05' ? 'hard' : t === 'drop' ? 'drop' : SET_TYPES[t]?.working ? 'work' : '');
const mmss = (ms) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export function renderTrain() {
  const s = state();
  const prog = s.plan.program;
  const date = viewDate();
  if (!prog) {
    return html`<main class="screen"><div class="page-head"><h1>Train</h1></div>
      <div class="card"><p>Your plan doesn't include a training program, so there is nothing to follow here.</p>
      <p class="small muted" style="margin-top:6px">You can still log cardio from the Today tab, and import a plan with a program from More.</p></div></main>`;
  }
  const day = s.days[date] || {};
  const w = day.workout;
  const key = w?.dayKey || programDayKey(s.plan, date, s.prefs.programAnchor);
  const def = prog.days[key];
  const editions = Object.entries(prog.editions);
  const edition = w?.edition || s.prefs.edition;
  const idx = prog.cycle.indexOf(key) + 1;

  return html`<main class="screen ${ui.timer ? 'has-timer' : ''}">
    <div class="page-head"><div><h1>${def.label}</h1><div class="small muted">${prettyDate(date, todayISO())} · Day ${idx} of ${prog.cycle.length}</div></div>
      <button class="btn sm" data-act="program-open">Change day</button></div>
    ${editions.length > 1 && !w ? html`<div style="margin-bottom:12px">${seg('set-edition', editions.map(([k, v]) => [k, v.label]), edition)}</div>` : ''}
    ${w ? activeWorkout(s, date, w) : preview(s, def, key, edition)}
    ${history(s, date)}
    ${ui.timer ? timerBar() : ''}
  </main>`;
}

function preview(s, def, key, edition) {
  const exs = exercisesFor(s.plan, edition, key);
  if (def.dayType === 'rest') {
    return html`<div class="card"><div class="bold">Rest day</div>
      <p class="small muted" style="margin-top:4px">Recovery is when you actually build muscle. Eat to your targets, sleep 7-8 hours, and take a walk if you like.</p>
      <button class="btn block" style="margin-top:10px" data-act="session-pick">Train a different session today</button></div>`;
  }
  const sets = exs.reduce((a, e) => a + e.sets.length, 0);
  return html`<div class="stack">
    <div class="card"><div class="row between"><div><div class="bold">${exs.length} exercises · ${sets} sets</div><div class="small muted">Tick each set as you finish it. The rest timer starts for you.</div></div></div>
      <div class="list" style="margin-top:8px">${exs.map((e, i) => html`<div class="item" data-key="pv-${e.id}"><div class="grow"><div class="title">${i + 1}. ${e.name}</div><div class="sub">${e.sets.length} sets${e.rest ? ` · rest ${Math.round(e.rest / 60 * 10) / 10 || 0} min` : ''}</div></div></div>`)}</div>
      <button class="btn primary block" style="margin-top:10px" data-act="workout-start" data-key-day="${key}">${icon('train')} Start workout</button>
      <button class="btn ghost block" style="margin-top:6px" data-act="session-pick">Do a different session</button></div>
  </div>`;
}

function activeWorkout(s, date, w) {
  const done = w.exercises.reduce((a, e) => a + e.sets.filter((x) => x.done).length, 0);
  const total = w.exercises.reduce((a, e) => a + e.sets.length, 0);
  const planEx = exercisesFor(s.plan, w.edition, w.dayKey);
  return html`<div class="stack">
    <div class="card ${w.finishedAt ? 'good' : ''}"><div class="row between"><div><div class="bold">${w.finishedAt ? 'Workout complete' : 'Workout in progress'}</div><div class="small">${done}/${total} sets · volume ${n0(sessionVolume(w))} kg</div></div>
      ${w.finishedAt ? html`<span class="pill ok">${icon('check')} Done</span>` : ''}</div>
      <div class="bar" style="margin-top:8px"><i style="width:${total ? Math.round((done / total) * 100) : 0}%"></i></div></div>
    ${w.exercises.map((ex, i) => exerciseCard(s, date, w, ex, i, planEx.find((p) => p.id === ex.id)))}
    ${w.finishedAt ? html`<button class="btn block" data-act="workout-reopen">Edit this workout</button>`
      : html`<div class="row"><button class="btn danger" data-act="workout-cancel">Cancel</button><button class="btn primary grow" data-act="workout-finish-open">Finish workout</button></div>`}
  </div>`;
}

function exerciseCard(s, date, w, ex, i, planEx) {
  const last = lastPerformance(s.days, ex.id, date);
  const noteOpen = ui.open[`note-${i}`];
  const doneSets = ex.sets.filter((x) => x.done).length;
  // "last time" summary: the hardest working set
  let lastLine = null;
  if (last) {
    const best = last.sets.filter((x) => x.done && isWorkingSet(x) && x.w > 0).sort((a, b) => b.w * b.r - a.w * a.r)[0];
    if (best) {
      const hint = nextHint(best, ex.sets.find((x) => isWorkingSet(x))?.target || null);
      lastLine = html`Last time (${prettyDate(last.date, todayISO())}): <b>${best.w} kg × ${best.r}</b>${hint ? html` · ${hint.text}` : ''}`;
    }
  }
  return html`<section class="card" data-key="ex-${i}">
    <div class="ex-head"><div class="grow"><h3>${i + 1}. ${ex.name}</h3>
      <div class="tiny muted">${doneSets}/${ex.sets.length} sets${planEx?.rest ? ` · rest ${planEx.rest >= 60 ? Math.round((planEx.rest / 60) * 10) / 10 + ' min' : planEx.rest + ' s'} between sets` : ''}</div></div>
      ${planEx?.note ? html`<button class="btn sm ghost icon" data-act="ex-note" data-i="${i}" aria-label="Form tips" aria-expanded="${String(!!noteOpen)}">${icon('info')}</button>` : ''}</div>
    ${noteOpen && planEx?.note ? html`<p class="small" style="margin-top:6px">${planEx.note}</p>` : ''}
    ${lastLine ? html`<p class="small muted" style="margin-top:6px">${lastLine}</p>` : ''}
    <div class="set-grid" role="group" aria-label="${ex.name} sets">
      <span class="h">#</span><span class="h">Type</span><span class="h">kg</span><span class="h">Reps</span><span class="h"></span>
      ${ex.sets.map((st, j) => setRow(ex, i, st, j, last))}
    </div>
  </section>`;
}

function setRow(ex, i, st, j, last) {
  // placeholder = what you did on the same set last time (else the same type)
  const ls = last ? last.sets[j] || last.sets.find((x) => x.type === st.type) : null;
  const prevW = ex.sets[j - 1]?.w;
  const phW = ls?.w ?? prevW ?? '';
  const phR = ls?.r ?? st.target ?? '';
  const t = SET_TYPES[st.type];
  return html`<span class="tiny muted">${j + 1}</span>
    <span class="set-tag ${tagClass(st.type)}" title="${t.long}">${t.label}${st.target ? html`<br><span style="font-weight:500">${st.target} reps</span>` : ''}</span>
    <input class="input num" inputmode="decimal" autocomplete="off" data-change="set-w" data-ex="${i}" data-set="${j}" value="${st.w ?? ''}" placeholder="${phW}" aria-label="Set ${j + 1} weight in kilograms">
    <input class="input num" inputmode="numeric" autocomplete="off" data-change="set-r" data-ex="${i}" data-set="${j}" value="${st.r ?? ''}" placeholder="${phR}" aria-label="Set ${j + 1} reps">
    <button class="check" data-act="set-done" data-ex="${i}" data-set="${j}" aria-pressed="${String(st.done)}" aria-label="Mark set ${j + 1} done">${icon('check')}</button>`;
}

function history(s, date) {
  const sessions = Object.entries(s.days)
    .filter(([d, v]) => d < date && v.workout?.finishedAt)
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 8);
  if (!sessions.length) return '';
  const prog = s.plan.program;
  return html`<section class="card" style="margin-top:12px"><div class="card-head"><h2>Recent workouts</h2></div>
    <div class="list">${sessions.map(([d, v]) => {
      const sets = v.workout.exercises.reduce((a, e) => a + e.sets.filter((x) => x.done).length, 0);
      return html`<div class="item" data-key="h-${d}"><div class="grow"><div class="title">${prog.days[v.workout.dayKey]?.label || v.workout.dayKey}</div><div class="sub">${prettyDate(d, todayISO())} · ${sets} sets</div></div><b>${n0(sessionVolume(v.workout))} kg</b></div>`;
    })}</div></section>`;
}

// ---- timer ------------------------------------------------------------------------------------

function timerBar() {
  const t = ui.timer;
  const left = t.endsAt - Date.now();
  const frac = t.total ? Math.max(0, Math.min(100, (left / (t.total * 1000)) * 100)) : 0;
  return html`<div class="timerbar"><div class="timerbar-inner ${t.done ? 'done' : ''}" role="timer" aria-live="off">
    <b id="timer-text">${t.done ? 'Go!' : mmss(left)}</b>
    <div class="track"><i id="timer-fill" style="width:${t.done ? 100 : frac}%"></i></div>
    <button class="btn" data-act="timer-add" data-s="-15" aria-label="15 seconds less">−15</button>
    <button class="btn" data-act="timer-add" data-s="15" aria-label="15 seconds more">+15</button>
    <button class="btn" data-act="timer-stop" aria-label="Skip rest">${icon('x')}</button>
  </div></div>`;
}

let ticker = null;
let audioCtx = null;

export function unlockAudio() {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {
    /* no audio */
  }
}

function beep() {
  if (!audioCtx || state().prefs.sound === false) return;
  const now = audioCtx.currentTime;
  [0, 0.25, 0.5].forEach((off, k) => {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = k === 2 ? 1175 : 880;
    g.gain.setValueAtTime(0.0001, now + off);
    g.gain.exponentialRampToValueAtTime(0.25, now + off + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + off + 0.2);
    o.connect(g).connect(audioCtx.destination);
    o.start(now + off);
    o.stop(now + off + 0.22);
  });
  try {
    navigator.vibrate?.([120, 60, 120]);
  } catch {
    /* ignore */
  }
}

function startTimer(seconds) {
  if (!(seconds > 0)) return;
  ui.timer = { endsAt: Date.now() + seconds * 1000, total: seconds, done: false };
  ensureTicker();
  render();
}

function ensureTicker() {
  if (ticker) return;
  ticker = setInterval(() => {
    const t = ui.timer;
    if (!t) {
      clearInterval(ticker);
      ticker = null;
      return;
    }
    const left = t.endsAt - Date.now();
    if (!t.done && left <= 0) {
      t.done = true;
      beep();
      render();
      setTimeout(() => {
        if (ui.timer === t) {
          ui.timer = null;
          render();
        }
      }, 4000);
      return;
    }
    if (!t.done) {
      const txt = document.getElementById('timer-text');
      const fill = document.getElementById('timer-fill');
      if (txt) txt.textContent = mmss(left);
      if (fill) fill.style.width = `${Math.max(0, Math.min(100, (left / (t.total * 1000)) * 100))}%`;
    }
  }, 250);
}

// Keep the screen awake during a workout so the timer stays in view.
let wakeLock = null;
export async function syncWakeLock() {
  const w = state().days[todayISO()]?.workout;
  const want = !!(w && !w.finishedAt) && ui.tab === 'train' && document.visibilityState === 'visible';
  try {
    if (want && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null;
  }
}

// ---- actions -------------------------------------------------------------------------------------

function restFor(w, exIdx, setIdx) {
  const ex = w.exercises[exIdx];
  const planEx = exercisesFor(state().plan, w.edition, w.dayKey).find((p) => p.id === ex.id);
  const next = ex.sets[setIdx + 1];
  if (next) return next.type === 'drop' ? 10 : planEx?.rest ?? 90;
  return planEx?.restAfter ?? 0;
}

export const actions = {
  'set-edition': (el) => mutate((s) => { s.prefs.edition = el.dataset.v; }),
  'workout-start': (el) => {
    const date = viewDate();
    const s = state();
    const key = el.dataset.keyDay;
    mutate((st) => S.startWorkout(st, date, key, s.prefs.edition));
    unlockAudio();
    syncWakeLock();
  },
  'session-pick': () => openSheet('pickSession', { date: viewDate() }),
  'session-start': (el) => {
    const date = ui.sheet.date;
    const s = state();
    const ed = s.prefs.edition;
    mutate((st) => S.startWorkout(st, date, el.dataset.k, ed));
    ui.sheet = null;
    unlockAudio();
    render();
    syncWakeLock();
  },
  'program-open': () => openSheet('programDay'),
  'ex-note': (el) => {
    const k = `note-${el.dataset.i}`;
    ui.open[k] = !ui.open[k];
    render();
  },
  'set-done': (el) => {
    const date = viewDate();
    const i = Number(el.dataset.ex);
    const j = Number(el.dataset.set);
    const s = state();
    const w = s.days[date]?.workout;
    if (!w) return;
    unlockAudio();
    const st = w.exercises[i].sets[j];
    if (st.done) {
      mutate((x) => S.setWorkoutSet(x, date, i, j, { done: false }));
      return;
    }
    const last = lastPerformance(s.days, w.exercises[i].id, date);
    const ls = last ? last.sets[j] || last.sets.find((x) => x.type === st.type) : null;
    const patch = { done: true };
    if (st.w == null) patch.w = ls?.w ?? w.exercises[i].sets[j - 1]?.w ?? null;
    if (st.r == null) patch.r = ls?.r ?? st.target ?? null;
    mutate((x) => S.setWorkoutSet(x, date, i, j, patch));
    startTimer(restFor(w, i, j));
  },
  'timer-add': (el) => {
    if (!ui.timer) return;
    ui.timer.endsAt += Number(el.dataset.s) * 1000;
    ui.timer.total = Math.max(1, ui.timer.total + Number(el.dataset.s));
    ui.timer.done = false;
    ensureTicker();
    render();
  },
  'timer-stop': () => {
    ui.timer = null;
    render();
  },
  'workout-finish-open': () => openSheet('finishWorkout', { date: viewDate(), burn: '', note: '' }),
  'workout-reopen': () => {
    const date = viewDate();
    mutate((s) => { s.days[date].workout.finishedAt = null; });
  },
  'workout-cancel': () => {
    const date = viewDate();
    openSheet('confirm', {
      title: 'Cancel this workout?',
      message: 'All sets you logged in this session will be deleted.',
      label: 'Delete workout',
      onYes: () => {
        mutate((s) => S.cancelWorkout(s, date));
        ui.timer = null;
        syncWakeLock();
      },
    });
  },
};

export const changes = {
  'set-w': (el) => {
    const date = viewDate();
    mutate((s) => S.setWorkoutSet(s, date, Number(el.dataset.ex), Number(el.dataset.set), { w: parseNum(el.value) }));
  },
  'set-r': (el) => {
    const date = viewDate();
    mutate((s) => S.setWorkoutSet(s, date, Number(el.dataset.ex), Number(el.dataset.set), { r: parseNum(el.value) }));
  },
};

// Sheet for choosing a session to do today without moving the schedule.
export function pickSessionSheet() {
  const prog = state().plan.program;
  return {
    title: 'Pick a session',
    body: html`<div class="list">${prog.cycle.filter((k) => prog.days[k].dayType === 'lift').map((k) => html`<button class="item" data-act="session-start" data-k="${k}" data-key="ps-${k}"><div class="grow"><div class="title">${prog.days[k].label}</div><div class="sub">Day ${prog.cycle.indexOf(k) + 1}</div></div></button>`)}</div>`,
  };
}

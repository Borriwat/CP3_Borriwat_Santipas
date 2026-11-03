import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExamplePlan } from '../js/data/example-plan.js';
import { validatePlan, programList, editionFor } from '../js/core/plan.js';
import { programDayKey, resolveDayType } from '../js/core/schedule.js';
import * as S from '../js/core/state.js';
import { freshState, TODAY } from './helpers.mjs';

const TOMORROW = '2026-06-16';
const withoutPrograms = () => {
  const p = buildExamplePlan();
  delete p.programs;
  return p;
};
const tiny = (label = 'Tiny') => ({
  label,
  cycle: ['a', 'rest'],
  days: { a: { label: 'A', dayType: 'lift' }, rest: { label: 'Rest', dayType: 'rest' } },
  editions: { gym: { label: 'Gym', days: { a: [{ id: `${label}-x`, name: 'X', sets: [['warm', 10], ['fail', 10]] }] } } },
});

// ---- the plan file ---------------------------------------------------------------------

test('a plan with one program (every existing plan file) still works, and that program is the main one', () => {
  const v = validatePlan(withoutPrograms());
  assert.ok(v.ok, v.errors.join('; '));
  assert.deepEqual(Object.keys(v.plan.programs), ['ppl']);
  assert.equal(v.plan.program.id, 'ppl');
  assert.equal(v.plan.defaultProgram, 'ppl');
  assert.equal(v.plan.program, v.plan.programs.ppl, 'plan.program is the active one');

  const old = buildExamplePlan();
  delete old.programs;
  delete old.program.id;
  delete old.program.label;
  const w = validatePlan(old);
  assert.ok(w.ok);
  assert.deepEqual(Object.keys(w.plan.programs), ['main'], 'no id given: it is called "main"');
  assert.match(w.plan.program.label, /^Push/, 'and is labelled from its name');
});

test('a plan with several programs lists the main one first and can choose another as the default', () => {
  const v = validatePlan(buildExamplePlan());
  assert.ok(v.ok, v.errors.join('; '));
  assert.deepEqual(programList(v.plan).map((p) => p.id), ['ppl', 'fullbody']);
  assert.deepEqual(programList(v.plan).map((p) => p.label), ['PPL', 'Full body']);
  assert.equal(v.plan.program.id, 'ppl');

  const p = buildExamplePlan();
  p.defaultProgram = 'fullbody';
  assert.equal(validatePlan(p).plan.program.id, 'fullbody');
  p.defaultProgram = 'does-not-exist';
  assert.equal(validatePlan(p).plan.program.id, 'ppl', 'an unknown default falls back to the first program');

  const onlyExtras = buildExamplePlan();
  delete onlyExtras.program;
  onlyExtras.programs.second = tiny('Second');
  assert.deepEqual(programList(validatePlan(onlyExtras).plan).map((x) => x.id), ['fullbody', 'second'], 'programs alone is fine too');

  const none = buildExamplePlan();
  delete none.program;
  delete none.programs;
  const n = validatePlan(none);
  assert.ok(n.ok);
  assert.equal(n.plan.program, null);
  assert.deepEqual(n.plan.programs, {});
});

test('bad programs are refused with a message that names the program', () => {
  const cases = [
    ['an unsafe id', (p) => { p.programs['bad id!'] = tiny(); }, /Program id "bad id!"/],
    ['a forbidden id', (p) => { p.programs.constructor = tiny(); }, /Program id "constructor"/],
    ['a duplicate of the main one', (p) => { p.programs.ppl = tiny(); }, /Duplicate program id "ppl"/],
    ['a program that is not an object', (p) => { p.programs.oops = 'nope'; }, /Program "oops" is not a program/],
    ['programs as a list', (p) => { p.programs = [tiny()]; }, /programs must be an object/],
    ['a second program with no cycle', (p) => { delete p.programs.fullbody.cycle; }, /Program "fullbody": program\.cycle must list/],
    ['a cycle day that does not exist', (p) => { p.programs.fullbody.cycle.push('ghost'); }, /Program "fullbody": program\.days\.ghost is missing/],
    ['an unknown set type', (p) => { p.programs.fullbody.editions.gym.days.fb1[0].sets.push(['bogus', 10]); }, /unknown set type "bogus"/],
    ['an unsafe exercise id', (p) => { p.programs.fullbody.editions.gym.days.fb1[0].id = 'a b'; }, /Exercise id "a b"/],
    ['a repeated exercise id in one day', (p) => { const d = p.programs.fullbody.editions.gym.days.fb1; d[1].id = d[0].id; }, /Program "fullbody": Edition gym\/fb1: duplicate exercise id/],
  ];
  for (const [name, mutate, re] of cases) {
    const p = buildExamplePlan();
    mutate(p);
    const v = validatePlan(p);
    assert.equal(v.ok, false, name);
    assert.match(v.errors.join(' | '), re, name);
  }
});

test('a plan file cannot pick "__proto__" (or any inherited name) as its default program', () => {
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    const p = buildExamplePlan();
    p.defaultProgram = name;
    const v = validatePlan(p);
    assert.ok(v.ok, v.errors.join('; '));
    assert.equal(v.plan.program.id, 'ppl', name);
    assert.equal(v.plan.defaultProgram, 'ppl', name);
    assert.equal(typeof v.plan.program.cycle.length, 'number', name);
  }
});

test('program labels are kept short and are always text', () => {
  const p = buildExamplePlan();
  p.programs.fullbody.label = 'L'.repeat(200);
  p.programs.second = { ...tiny(), label: undefined, name: undefined };
  const v = validatePlan(p);
  assert.ok(v.ok, v.errors.join('; '));
  assert.equal(v.plan.programs.fullbody.label.length, 40);
  assert.equal(v.plan.programs.second.label, 'second', 'no label or name: the id');
});

// ---- choosing a program --------------------------------------------------------------------

test('a new plan starts on its default program; the chosen program is remembered', () => {
  const s = freshState();
  assert.equal(s.prefs.programId, 'ppl');
  assert.equal(s.plan.program.id, 'ppl');
  assert.deepEqual(Object.keys(s.plan.programs), ['ppl', 'fullbody']);
});

test('switching programs makes today Day 1 of the new one and nothing else changes', () => {
  const s = freshState();
  S.setProgramDay(s, TODAY, 3); // somewhere in the middle of the first program
  const entriesBefore = JSON.stringify(s.days);
  assert.equal(S.setProgram(s, TODAY, 'fullbody'), true);
  assert.equal(s.prefs.programId, 'fullbody');
  assert.equal(s.plan.program.id, 'fullbody');
  assert.equal(programDayKey(s.plan, TODAY, s.prefs.programAnchor), 'fb1', 'today is Day 1');
  assert.equal(programDayKey(s.plan, TOMORROW, s.prefs.programAnchor), 'rest1', 'and the cycle follows from there');
  assert.equal(JSON.stringify(s.days), entriesBefore, 'logged data is untouched');
  assert.equal(S.setProgram(s, TODAY, 'fullbody'), false, 'choosing the same program does nothing');
  assert.equal(S.setProgram(s, TODAY, 'nope'), false, 'an unknown program is ignored');
  assert.equal(S.setProgram(s, TODAY, '__proto__'), false);
  assert.equal(s.prefs.programId, 'fullbody');
  // and back
  assert.equal(S.setProgram(s, TOMORROW, 'ppl'), true);
  assert.equal(s.plan.program.label, 'PPL');
  assert.equal(programDayKey(s.plan, TOMORROW, s.prefs.programAnchor), 'push', "PPL's own first day");
});

test('the schedule (lift or rest) follows the active program', () => {
  const s = freshState();
  S.setProgram(s, TODAY, 'fullbody');
  assert.equal(resolveDayType(s, TODAY, TODAY), 'lift');
  assert.equal(resolveDayType(s, TOMORROW, TODAY), 'rest', 'Full body has a rest day after day 1');
  assert.equal(resolveDayType(s, '2026-06-17', TODAY), 'lift');
});

test('importing a plan again keeps the program you chose when it still exists, else uses the default', () => {
  const s = freshState();
  S.setProgram(s, TODAY, 'fullbody');
  const same = validatePlan(buildExamplePlan());
  S.applyPlan(s, same.plan, TODAY);
  assert.equal(s.prefs.programId, 'fullbody');
  assert.equal(s.plan.program.id, 'fullbody');
  const onlyPpl = validatePlan(withoutPrograms());
  S.applyPlan(s, onlyPpl.plan, TODAY);
  assert.equal(s.prefs.programId, 'ppl');
  assert.equal(s.plan.program.id, 'ppl');
});

// ---- editions ----------------------------------------------------------------------------------

test('a program without your preferred edition uses its own first one, and your preference is not lost', () => {
  const p = buildExamplePlan();
  p.program.editions.home = { label: 'Home', days: structuredClone(p.program.editions.gym.days) };
  const v = validatePlan(p);
  assert.ok(v.ok, v.errors.join('; '));
  assert.equal(editionFor(v.plan.programs.ppl, 'home'), 'home');
  assert.equal(editionFor(v.plan.programs.fullbody, 'home'), 'gym');
  assert.equal(editionFor(v.plan.programs.ppl, 'nope'), 'gym');
  assert.equal(editionFor(null, 'home'), null);

  const s = S.defaultState(TODAY);
  S.applyPlan(s, v.plan, TODAY);
  s.prefs.edition = 'home';
  S.setProgram(s, TODAY, 'fullbody');
  const w = S.startWorkout(s, TODAY, 'fb1', s.prefs.edition);
  assert.equal(w.edition, 'gym', 'the gym-only program trains at the gym');
  assert.equal(s.prefs.edition, 'home', 'but you still prefer home');
  S.setProgram(s, TOMORROW, 'ppl');
  assert.equal(editionFor(s.plan.program, s.prefs.edition), 'home', 'and PPL goes back to home');
  const again = validatePlan(p);
  S.applyPlan(s, again.plan, TODAY);
  assert.equal(s.prefs.edition, 'home', 'importing the plan again keeps it');
});

// ---- workouts and history ------------------------------------------------------------------------

test('a workout remembers its program and session, so it survives switching programs', () => {
  const s = freshState();
  const w = S.startWorkout(s, TODAY, 'push', 'gym', 100);
  assert.equal(w.programId, 'ppl');
  assert.equal(w.dayLabel, 'Push');
  S.setWorkoutSet(s, TODAY, 0, 1, { w: '30', r: '12', done: true });
  S.finishWorkout(s, TODAY, 200);
  const before = JSON.stringify(s.days[TODAY].workout);
  S.setProgram(s, TODAY, 'fullbody');
  assert.equal(JSON.stringify(s.days[TODAY].workout), before, 'the saved workout is unchanged');
  assert.equal(s.plan.program.days[s.days[TODAY].workout.dayKey], undefined, 'its session is not in the new program, and that is fine');
  assert.equal(S.startWorkout(s, TOMORROW, 'fb1', 'gym').programId, 'fullbody');
  assert.equal(S.startWorkout(s, TOMORROW, 'push', 'gym'), null, "a session of the other program can't be started");
});

// ---- saved data and backups ----------------------------------------------------------------------

test('data saved before programs existed is upgraded on load', () => {
  const s = freshState();
  const raw = JSON.parse(S.exportState(s));
  delete raw.state.plan.programs;
  delete raw.state.plan.defaultProgram;
  delete raw.state.prefs.programId;
  raw.state.plan.program = { name: 'Old program', cycle: ['x', 'rest'], days: { x: { label: 'X', dayType: 'lift' }, rest: { label: 'Rest', dayType: 'rest' } }, editions: { gym: { label: 'Gym', days: { x: [{ id: 'x1', name: 'X1', sets: [['fail', 10]] }] } } } };
  const r = S.parseBackup(JSON.stringify(raw), TODAY);
  assert.ok(r.ok);
  assert.deepEqual(Object.keys(r.state.plan.programs), ['main']);
  assert.equal(r.state.prefs.programId, 'main');
  assert.equal(r.state.plan.program.id, 'main');
  assert.equal(r.state.plan.program.label, 'Old program');
  assert.equal(S.startWorkout(r.state, TODAY, 'x', 'gym').programId, 'main');
});

test('the chosen program survives a backup and restore', () => {
  const s = freshState();
  S.setProgram(s, TODAY, 'fullbody');
  const r = S.parseBackup(S.exportState(s), TODAY);
  assert.ok(r.ok);
  assert.equal(r.state.prefs.programId, 'fullbody');
  assert.equal(r.state.plan.program.id, 'fullbody');
  assert.equal(r.state.plan.program, r.state.plan.programs.fullbody, 'plan.program points at the active one again');
});

test('a damaged backup cannot break program handling', () => {
  const variants = [
    (st) => { st.plan.programs = 'nope'; },
    (st) => { st.plan.programs = [1, 2]; },
    (st) => { st.plan.programs = { ppl: 'x', fullbody: null }; },
    (st) => { st.prefs.programId = { evil: true }; },
    (st) => { st.prefs.programId = '__proto__'; },
    (st) => { st.plan.defaultProgram = 42; st.prefs.programId = 'gone'; },
    (st) => { st.plan.program = 'junk'; delete st.plan.programs; },
    (st) => { st.plan = null; },
  ];
  for (const [i, v] of variants.entries()) {
    const raw = JSON.parse(S.exportState(freshState()));
    v(raw.state);
    let r;
    assert.doesNotThrow(() => { r = S.parseBackup(JSON.stringify(raw), TODAY); }, `variant ${i}`);
    assert.ok(r.ok, `variant ${i}`);
    const st = r.state;
    if (st.plan) {
      assert.ok(st.plan.program === null || typeof st.plan.program === 'object', `variant ${i}: plan.program is a program or nothing`);
      if (st.plan.program) assert.equal(typeof st.plan.program.label, 'string', `variant ${i}`);
    }
    assert.doesNotThrow(() => S.setProgram(st, TODAY, 'fullbody'), `variant ${i}`);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReminders, buildICS, escapeText, fold, nextWeekday } from '../js/core/ics.js';
import { swapPrompt, offPlanPrompt } from '../js/core/prompts.js';
import { memoryStorage } from '../js/core/storage.js';
import { createStore } from '../js/core/store.js';
import { addWater, setWeight } from '../js/core/state.js';
import { qtyText, n1, signed } from '../js/core/format.js';

test('ics: structure, CRLF, recurrence and alarms', () => {
  const ics = buildReminders({ startDate: '2026-06-17', now: new Date('2026-06-15T01:02:03Z') }); // a Wednesday
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 4);
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 4);
  assert.ok(!/[^\r]\n/.test(ics), 'no bare LF line endings');
  assert.match(ics, /DTSTAMP:20260615T010203Z/);
  assert.match(ics, /DTSTART:20260617T070000\r\n/, 'daily weigh-in starts at the start date');
  assert.match(ics, /DTSTART:20260621T080000/, 'weekly items start on the next Sunday');
  assert.match(ics, /RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU/);
  assert.match(ics, /UID:weigh@recomp-tracker/);
});

test('ics: custom times and escaping', () => {
  const ics = buildReminders({ startDate: '2026-06-14', times: { weigh: '06:30' } }); // a Sunday
  assert.match(ics, /DTSTART:20260614T063000/);
  assert.match(ics, /DTSTART:20260614T080000/, 'a Sunday start date is its own first Sunday');
  assert.equal(escapeText('a, b; c\\d\ne'), 'a\\, b\\; c\\\\d\\ne');
  const out = buildICS([{ id: 'x', title: 'Hello, world', note: 'n', date: '2026-01-01', time: '09:00', rrule: 'FREQ=DAILY' }]);
  assert.match(out, /SUMMARY:Hello\\, world/);
});

test('ics: long lines fold at 75 octets, including multibyte characters', () => {
  const folded = fold('DESCRIPTION:' + 'ก'.repeat(80));
  for (const l of folded.split('\r\n')) assert.ok(new TextEncoder().encode(l).length <= 75, `line is ${new TextEncoder().encode(l).length} bytes`);
  assert.equal(folded.replace(/\r\n /g, ''), 'DESCRIPTION:' + 'ก'.repeat(80), 'unfolding restores the original');
  assert.equal(fold('short'), 'short');
});

test('nextWeekday', () => {
  assert.equal(nextWeekday('2026-06-14', 0), '2026-06-14');
  assert.equal(nextWeekday('2026-06-15', 0), '2026-06-21');
  assert.equal(nextWeekday('2026-12-30', 1), '2027-01-04');
});

test('prompts include the numbers the assistant needs', () => {
  const p = offPlanPrompt({
    slotLabel: 'Lunch',
    plannedItems: ['Chicken 200 g', 'Rice 90 g'],
    planned: { p: 53, c: 77, f: 15, kcal: 651 },
    target: { p: 160, c: 231, f: 44, kcal: 1960 },
    eaten: { p: 54, c: 75, f: 15, kcal: 650 },
    remaining: { p: 106, c: 156, f: 29, kcal: 1310 },
    upcoming: ['Dinner'],
  });
  assert.match(p, /attached photo/);
  assert.match(p, /Daily target: 1960 kcal \| P 160 g/);
  assert.match(p, /Left for the day: 1310 kcal/);
  assert.match(p, /planned as: Chicken 200 g, Rice 90 g/);
  assert.match(p, /Meals still to eat: Dinner/);
  assert.match(p, /USDA/);
  const s = swapPrompt({ slotLabel: 'Dinner', from: { name: 'Chicken', unit: 'g' }, fromQty: 150, toName: 'Shrimp', macros: { p: 34, c: 0, f: 4 } });
  assert.match(s, /Chicken, 150 g/);
  assert.match(s, /same protein/);
});

test('store: init loads, update saves (debounced), flush persists immediately', async () => {
  const storage = memoryStorage();
  const store = createStore(storage, { saveDelay: 5, today: () => '2026-06-15' });
  let renders = 0;
  store.subscribe(() => renders++);
  await store.init();
  assert.equal(store.meta.ready, true);
  store.update((s) => addWater(s, '2026-06-15', 500));
  store.update((s) => setWeight(s, '2026-06-15', 75));
  assert.equal((await storage.load()), null, 'not saved yet: debounced');
  await store.flush();
  const saved = await storage.load();
  assert.equal(saved.days['2026-06-15'].water, 500);
  assert.equal(saved.days['2026-06-15'].weight, 75);
  assert.ok(renders >= 3);

  // a fresh store reads it back
  const again = createStore(storage, { today: () => '2026-06-15' });
  await again.init();
  assert.equal(again.state.days['2026-06-15'].water, 500);
});

test('store: corrupt saved data does not crash init', async () => {
  const bad = { async load() { return { v: 999 }; }, async save() {}, kind: 'memory' };
  const store = createStore(bad, { today: () => '2026-06-15' });
  await store.init();
  assert.equal(store.meta.ready, true);
  assert.match(store.meta.loadError, /newer version/);
  assert.deepEqual(store.state.days, {}, 'falls back to an empty state');
  const throws = { async load() { throw new Error('disk on fire'); }, async save() {}, kind: 'memory' };
  const s2 = createStore(throws, { today: () => '2026-06-15' });
  await s2.init();
  assert.equal(s2.meta.loadError, 'disk on fire');
});

test('store: a failing save is reported, not thrown', async () => {
  const failing = { async load() { return null; }, async save() { throw new Error('quota exceeded'); }, kind: 'localstorage' };
  const store = createStore(failing, { saveDelay: 1, today: () => '2026-06-15' });
  await store.init();
  store.update((s) => addWater(s, '2026-06-15', 250));
  await store.flush();
  assert.equal(store.meta.saveError, 'quota exceeded');
});

test('formatting helpers', () => {
  assert.equal(qtyText(143.4, 'g'), '143 g');
  assert.equal(qtyText(14.44, 'g'), '14.4 g');
  assert.equal(qtyText(1, 'serving'), '1 serving');
  assert.equal(qtyText(2.5, 'serving'), '2.5 servings');
  assert.equal(n1(80.25), '80.3');
  assert.equal(n1(80), '80');
  assert.equal(signed(-3.2, 1), '−3.2');
  assert.equal(signed(0.04, 1), '0');
  assert.equal(signed(5), '+5');
});

test('parseNum handles comma decimals, blanks and junk', async () => {
  const { parseNum } = await import('../js/core/format.js');
  assert.equal(parseNum('72.5'), 72.5);
  assert.equal(parseNum('72,5'), 72.5);
  assert.equal(parseNum(' 80 '), 80);
  assert.equal(parseNum('.5'), 0.5);
  assert.ok(Number.isNaN(parseNum('')));
  assert.ok(Number.isNaN(parseNum('abc')));
  assert.ok(Number.isNaN(parseNum('1.2.3')));
  assert.ok(Number.isNaN(parseNum(null)));
  assert.equal(parseNum(0), 0);
});

test('store: restoring a backup pins the types of its past days', async () => {
  const { freshState, logPerfectDay } = await import('./helpers.mjs');
  const s = freshState('2026-06-15');
  logPerfectDay(s, '2026-06-12', '2026-06-12');
  delete s.days['2026-06-12'].type;
  const store = createStore(memoryStorage(), { today: () => '2026-06-15' });
  await store.init();
  store.replace(s);
  assert.ok(store.state.days['2026-06-12'].type, 'type was pinned on restore');
});

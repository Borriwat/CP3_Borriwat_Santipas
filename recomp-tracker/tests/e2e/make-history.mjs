// Builds a backup file with ~4 weeks of realistic history on the example plan,
// for exercising the Progress screen and the review. Used by the e2e scripts.
import { writeFileSync } from 'node:fs';
import { freshState, fill, logLift } from '../helpers.mjs';
import * as S from '../../js/core/state.js';
import { addDays, todayISO } from '../../js/core/dates.js';

export function buildHistory(today = todayISO(), days = 28) {
  const s = freshState(today);
  const start = addDays(today, -days);
  s.prefs.programAnchor = addDays(today, -days); // day 1 was the first day of history
  // gentle drift: weight roughly flat, body fat creeping down, a couple of misses and Q-low days
  fill(s, start, days, {
    weights: (i) => (i % 9 === 4 ? null : 75.2 - i * 0.01 + (i % 3 === 0 ? 0.25 : -0.1)),
    bf: (i) => (i % 9 === 4 ? null : 17.9 - i * 0.015),
    perfect: (i) => i % 11 !== 6,
    qlow: (i) => i === 5 || i === 20,
  }, today);
  for (let i = 0; i < days; i += 1) {
    const d = addDays(start, i);
    S.setSleep(s, d, 6.4 + (i % 4) * 0.4, 3 + (i % 3));
    if (i % 2 === 0) S.addWater(s, d, 2400 + (i % 5) * 150);
  }
  // training: push on days 0,7,14,21 with a little progression
  [0, 7, 14, 21].forEach((d, k) => logLift(s, addDays(start, d), 'incline-db-press', [[22.5 + k * 1.25, 10]], 'push'));
  [1, 8, 15, 22].forEach((d, k) => logLift(s, addDays(start, d), 'lat-pulldown', [[40 + k * 2.5, 10]], 'pull'));
  S.saveMeasurement(s, { date: addDays(start, 0), waist: 83.0, hip: 97.0, chest: 101, arm: 35.5 });
  S.saveMeasurement(s, { date: addDays(start, 14), waist: 82.4, hip: 97.0, chest: 101.5, arm: 35.8 });
  S.addCardio(s, addDays(today, -3), { kind: 'Run', min: 30, kcal: 320 });
  S.addCustomFood(s, { name: 'Protein bar', unit: 'serving', basis: 1, p: 20, c: 22, f: 8, cat: 'protein' });
  return s;
}

if (process.argv[1].endsWith('make-history.mjs')) {
  const out = process.argv[2];
  writeFileSync(out, S.exportState(buildHistory()));
  console.log('wrote', out);
}

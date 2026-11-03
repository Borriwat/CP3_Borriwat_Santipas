#!/usr/bin/env node
// Check a plan file before importing it on your phone.
//   node tools/validate-plan.mjs path/to/my.plan.json
// Prints errors, warnings, and every menu next to its targets.

import { readFileSync } from 'node:fs';
import { validatePlan, menuDayTotals, programList } from '../js/core/plan.js';
import { buildFoodIndex } from '../js/core/foods.js';
import { DAY_TYPE_LABEL, DAY_TYPES } from '../js/core/tdee.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node tools/validate-plan.mjs <plan.json>');
  process.exit(2);
}

let raw;
try {
  raw = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`Could not read ${file}: ${e.message}`);
  process.exit(2);
}

const { ok, errors, warnings, plan } = validatePlan(raw);
for (const e of errors) console.log(`ERROR   ${e}`);
for (const w of warnings) console.log(`WARNING ${w}`);
if (!ok) {
  console.log(`\n${errors.length} error(s). Not importable.`);
  process.exit(1);
}

const idx = buildFoodIndex(plan.foods);
const r = (n) => String(Math.round(n)).padStart(4);
console.log(`\nPlan: ${plan.name} (${plan.phase})`);
for (const [menuId, menu] of Object.entries(plan.menus)) {
  console.log(`\nMenu ${menuId}: ${menu.label}`);
  console.log('  day type        |  menu kcal   P    C    F |  target kcal   P    C    F');
  for (const dt of DAY_TYPES) {
    if (!menu.days?.[dt]) continue;
    const t = menuDayTotals(plan, idx, menuId, dt);
    const g = plan.dayTypes[dt].target;
    console.log(`  ${DAY_TYPE_LABEL[dt].padEnd(15)} |  ${r(t.kcal)} ${r(t.p)} ${r(t.c)} ${r(t.f)} |  ${r(g.kcal)} ${r(g.p)} ${r(g.c)} ${r(g.f)}`);
  }
}
const programs = programList(plan);
if (!programs.length) console.log('\nTraining program: none');
for (const p of programs) {
  const editions = Object.values(p.editions || {});
  const ex = editions.reduce((n, ed) => n + Object.values(ed.days).reduce((m, d) => m + d.length, 0), 0);
  const star = programs.length > 1 && p.id === plan.defaultProgram ? ' (starts here)' : '';
  console.log(`\nTraining program ${p.label}${star}: ${p.cycle.length}-day cycle, ${ex} exercises across ${editions.length} edition(s)`);
}
if (!Object.keys(plan.menus).length) console.log('\n(no planned meals; you log each day yourself)');
console.log(`Supplements: ${plan.supplements.length}   Foods defined by the plan: ${plan.foods.length}`);
console.log(`\nOK${warnings.length ? ` (${warnings.length} warning(s))` : ''}`);

// Prompts to paste into Claude (or any assistant) for the two situations a
// food database can't cover well: swapping an ingredient, and eating
// something off-plan from a photo. The app fills in the context so you only
// attach the picture.

import { n0, qtyText } from './format.js';

const line = (label, m) => `${label}: ${n0(m.kcal)} kcal | P ${n0(m.p)} g | C ${n0(m.c)} g | F ${n0(m.f)} g`;

export function swapPrompt({ slotLabel, from, fromQty, toName, macros }) {
  return [
    `I want to swap an ingredient in my ${slotLabel} meal.`,
    `Current: ${from.name}, ${qtyText(fromQty, from.unit)} (${n0(macros.p)} g protein, ${n0(macros.c)} g carbs, ${n0(macros.f)} g fat).`,
    `Replace with: ${toName}.`,
    '',
    'Please:',
    '1. Use USDA FoodData Central values and say whether you mean raw or cooked weight.',
    `2. Tell me how many grams of ${toName} give about the same ${dominant(macros)} as the original.`,
    '3. Show how carbs and fat change compared with the original meal.',
    '4. If the difference is large, tell me how to adjust another meal today.',
  ].join('\n');
}

const dominant = (m) => (m.p >= m.c && m.p >= m.f ? 'protein' : m.c >= m.f ? 'carbs' : 'fat');

export function offPlanPrompt({ slotLabel, plannedItems, planned, target, eaten, remaining, upcoming }) {
  const lines = [
    `The attached photo is what I ate for ${slotLabel} instead of the plan.`,
    '',
    'My plan for today:',
    line('  Daily target', target),
    line('  Eaten so far (before this meal)', eaten),
    line('  Left for the day', remaining),
  ];
  if (plannedItems?.length) {
    lines.push(`  This meal was planned as: ${plannedItems.join(', ')} (${n0(planned.p)} P / ${n0(planned.c)} C / ${n0(planned.f)} F)`);
  }
  if (upcoming?.length) lines.push(`  Meals still to eat: ${upcoming.join(', ')}`);
  lines.push(
    '',
    'Please:',
    '1. Estimate the weight of each item in the photo (ask me if something is unclear).',
    '2. Calculate protein, carbs, fat and calories using USDA FoodData Central.',
    '3. Compare with what this meal was supposed to give me.',
    '4. Tell me how to change my remaining meals today (which foods, how many grams) so the day lands within about 5-10 g of each macro target.'
  );
  return lines.join('\n');
}

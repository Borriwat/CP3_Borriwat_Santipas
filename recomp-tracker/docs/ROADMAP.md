# Roadmap: what else the app could do

Ordered by how much it would help someone following a plan like this, weighed against
effort. The first block is already built.

## Already in the app (beyond logging food and workouts)

- Ingredient **swaps** matched on the macro the ingredient is for.
- **Rebalance** the rest of the day after an off-plan meal.
- A ready-to-paste **AI prompt** (with your numbers) for meals you can't weigh.
- The **bi-weekly review**: Hold vs Next from results → data quality → consistency,
  with Q-low days and "unlogged days count as missed".
- **Targets history** (old days keep old targets), calculator, and **menu resizing**.
- **Photo logging with AI**: photo in, editable estimate out, logged as flagged
  estimates. Uses the person's own API key, stored only on the phone.
- Supplements checklist, water, sleep, weekly-measurement tracking, strength trend.
- **Shopping list** for the next 7 days, calendar **reminders**, backup/restore, dark mode.

## Next, highest value first

1. **Photo logging without a personal API key.** The built-in version asks you to make
   your own key. A tiny server you control (for example a Cloudflare Worker) could hold
   the key instead, so the phone never sees it and setup is one tap. Also worth adding:
   remember corrections ("my usual rice portion is 220 g") and learn from them, and
   use a barcode or label photo when there is one.
2. **Progress photos** with a consistent-pose reminder and a side-by-side slider. The
   review already asks you to compare photos; keeping them in the app (on-device) would
   close that loop.
3. **Cut and bulk manager.** When the review says *Next* on a cut: apply the staged steps
   (first carbs off training days, then cardio in set increments), schedule refeed days
   and the diet-break week, and show the whole multi-week plan so you can see where you
   are in it.
4. **Event / alcohol planner.** "Dinner out Friday": pre-spend or trim carbs across the
   day, with alcohol counted at 7 kcal/g, and log it afterwards in one step.
5. **Barcode scanning** (Open Food Facts) for packaged foods, with the nutrition label
   checked against what the scan returns.
6. **Apple Health.** Pull steps, weight (from a smart scale) and workouts. This needs a
   native iPhone app (SwiftUI + HealthKit), or an iOS Shortcut that exports data to the
   app. A native build also enables real notifications and an Apple Watch complication
   for the rest timer. It needs a Mac, Xcode and an Apple developer account.
7. **Strength extras.** Estimated 1RM, PR badges, and a deload nudge when volume has
   dropped for several sessions.
8. **Meal prep planner.** Batch quantities, containers per day, how long cooked food
   keeps.
9. **Coach report.** One tap to export a clean two-week summary (averages, adherence,
   measurements, notes) as a PDF or image to send to your coach.
10. **Sync between devices** via a user-owned file (iCloud Drive / Google Drive) or a
    small backend, plus automatic scheduled backups.
11. **Day starts at 4 am** option for late eaters, **step / NEAT tracking**, **sodium
    and water insights** (correlate Q-low days with what caused them).

## Things deliberately left out

- Gamification, streak shaming and social feeds. The review is built on *not* reading
  too much into a single day.
- Automatic target changes. The app proposes a step and waits for you to apply it.

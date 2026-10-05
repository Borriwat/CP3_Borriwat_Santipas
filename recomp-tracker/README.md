# Recomp Tracker

An iPhone app (a Progressive Web App) for following a diet-and-training plan:
meals and macros, training logs with a rest timer, weight and measurements, and a
bi-weekly **Hold / Next** review that tells you when it is time to change something.

- Works offline, installs to the Home Screen, no account, no App Store, no cost.
- All data stays on your phone. Nothing is uploaded.
- No build tools or dependencies. Plain JavaScript, HTML and CSS.

> **Privacy note: this repository is public.** The app itself is generic and safe to
> publish. Your *plan* (your coach's meal tables, workouts, supplement list and your
> body stats) is not, so it lives in a separate file that is **never committed**
> (`*.plan.json` is git-ignored) and is imported on your phone. See
> [Your plan file](#your-plan-file).

## Get it on your iPhone

You need the app hosted at a web address once. The simplest free way is GitHub Pages.

### 1. Publish it (once, about 2 minutes)

1. On GitHub, open the repository → **Settings** → **Pages**.
2. **Source:** *Deploy from a branch*.
3. **Branch:** choose the branch that has this folder (for now
   `claude/fitness-tracking-iphone-app-89qu1e`, later `main`) and folder **/ (root)**. Save.
4. Wait a minute or two. Your app is then at
   `https://<your-github-username>.github.io/CP3_Borriwat_Santipas/recomp-tracker/`

### 2. Install it (on the iPhone, in Safari)

1. Open that address in **Safari** (it must be Safari, not Chrome).
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. **Close Safari and open the app from the new Home Screen icon.**

> **Install first, then import your plan.** iOS keeps a Home Screen app's storage
> separate from Safari's. If you set things up in Safari and install afterwards, the
> installed app starts empty. Always do the setup *inside* the installed app.

### 3. Load your plan

Open the app from the Home Screen → **Import my plan file** → pick the file (from the
Files app, iCloud Drive, AirDrop, a message…) or paste its text. Done.

No plan file? Tap **Set up from my body stats** to get targets from the calculator, or
**Try it with an example plan** to look around.

## Using it

| Tab | What it does |
|---|---|
| **Today** | Day type (Rest / Lift / Cardio / Lift+Cardio), calorie ring and macro bars, your meals with **Log as planned**, snacks, water, supplements, cardio, weight, sleep, notes. |
| **Plan** | Browse your menus per day type, edit targets, shopping list for the next 7 days, resize the menu when targets change. |
| **Train** | Today's session, set by set. Last-time numbers and hints, a rest timer that starts when you tick a set, and the screen is kept awake where your iPhone allows it. |
| **Progress** | Weight with 7-day average, measurements, the last 14 days at a glance, strength per exercise, and the **bi-weekly review**. |
| **More** | Menu / gym-or-home choice, schedule, calculator, supplements, reminders, backup, theme. |

**Eating off-plan.** Add what you ate (search, quick-add macros, or your own foods). If
you end up over or under, the **Rebalance** banner resizes the meals you still have to
eat so the day lands back on target. For a meal you can't weigh, the ✨ button builds a
ready-to-paste prompt (with your numbers filled in) for Claude or any AI, to use with a
photo.

**Swapping an ingredient.** Tap a planned item → *Swap*. It matches the macro that
ingredient is there for (protein for a protein source, carbs for a carb source…) and
shows what changes elsewhere.

**The review.** Every two weeks, *Progress → Run review*. It checks, in order: are the
results moving (waist/hips, body-fat reading, strength)? If not, is the data trustworthy
(weighed on most days, few distorted "Q-low" days)? Was the plan followed (food logged and
on target)? Only a stalled result with good data and good consistency gives **Next**;
otherwise it says to **Hold** and what to fix first. Days you didn't log count as missed.
It is guidance, not medical advice.

**Q-low days.** Big or salty meal, alcohol, poor sleep, period, travel? Mark the day.
It is kept in your data, never deleted from averages, and counted in the review.

### Back up your data

Everything lives on the phone. **More → Export backup** saves a file you can keep in
iCloud Drive or email to yourself; **Restore from backup** brings it back. Do it before
changing phones or clearing Safari data, and every few weeks anyway. A backup contains
your plan too, so keep it private.

### Reminders

A web app can't schedule notifications, but Calendar can. **More → Reminders** gives you
an `.ics` file (daily weigh-in and logging nudge, weekly measurements, bi-weekly review).
Open it and tap **Add All**.

## Your plan file

The plan file is JSON: your targets per day type, meal menus, training program and
supplements. The format is described in [`docs/PLAN_FORMAT.md`](docs/PLAN_FORMAT.md).

Check a plan file before importing it:

```bash
node tools/validate-plan.mjs path/to/my.plan.json
```

It lists any problems and prints every menu next to its targets so you can see they add up.

**Keep plan files out of git.** `.gitignore` already excludes `*.plan.json` and a
`private/` folder. If you would rather keep everything in one repository, make the
repository **private** first (note that free GitHub accounts can't serve Pages from a
private repo, so you'd host the app elsewhere).

## What the app can't do

- **No Apple Health / Apple Watch.** Web apps can't read HealthKit. Enter weight and
  cardio by hand (a native app could do this; see the roadmap).
- **No push notifications** (use the calendar reminders above).
- **Food photo recognition is not built in.** It needs an AI service and an API key; for
  now use the prompt button with Claude or another AI.
- **Nutrition values are approximate.** The built-in foods are rounded public-database
  values and the dish entries are rough estimates (flagged as such). Weigh things when it
  matters, and add your own foods for anything you eat often.
- **Data is per device.** There is no sync between phones; use backup and restore.
- iOS can clear storage for sites you stop using. A Home Screen app is much safer than a
  Safari tab, and the app asks the browser to keep its data, but backups are the real
  safety net.

## For developers

```bash
cd recomp-tracker
npm test                  # 90 unit tests, Node only, no dependencies
npm run serve             # http://localhost:8080  (needs http-server: npx will fetch it)
npm run build             # regenerates sw.js, REQUIRED after changing any shipped file
npm run check             # fails if sw.js is stale (also enforced by a unit test)
npm run e2e               # 57 browser checks (needs: npm i --no-save playwright)
node tools/make-icons.mjs # regenerate the PNG icons from icons/icon.svg
```

How it is put together:

- `js/core/*`: pure logic with no DOM (macros, swaps, meal scaling, TDEE, review engine,
  schedule, state, storage). Everything is unit-tested in Node.
- `js/ui/*`: rendering with a tiny auto-escaping `html` template tag and a DOM morph
  (`ui/dom.js`) so a re-render never steals focus from an input you are typing in.
- `js/data/*`: built-in food database and the **fictitious** example plan.
- `sw.js`: generated. It lists and hashes every shipped file, so any change installs a
  fresh cache and the app offers a reload. The offline test really shuts the test server
  down and checks the app still runs.
- The e2e suite serves the app under a sub-path, exactly like GitHub Pages.

Design decisions worth knowing:

- Energy is always computed from the macros (4/4/9 kcal per g, alcohol 7), so kcal and
  macros can never disagree.
- Log entries store a snapshot of their macros: editing a food later never rewrites history.
- Targets keep a history: changing them applies from today, and old days keep the targets
  they had. A day's type is pinned once the day is over, so moving your schedule can't
  rewrite past adherence.
- Plan files are untrusted input: ids are validated, all text is escaped, and long
  unbroken text wraps instead of breaking the layout (all covered by tests).

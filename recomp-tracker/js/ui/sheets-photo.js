// Photo logging: take or choose a photo of a meal, have Claude estimate what is on
// the plate, let the person check and correct it, then log it.

import { html, raw } from './dom.js';
import { icon, seg, banner, macroLine } from './components.js';
import { ui, mutate, openSheet, closeSheet, toast, render, getStore, onSheetClosed } from './ctx.js';
import { prepareImage, releasePreview } from './photo.js';
import { createKeyStore, maskKey } from '../core/aikey.js';
import {
  AI_MODELS, aiError, buildEstimateRequest, buildTestRequest, callMessages, checkKeyFormat, itemMacros, itemsToEntries, modelOrDefault, parseEstimate,
} from '../core/ai.js';
import { macros } from '../core/macros.js';
import { addEstimateEntry } from '../core/state.js';

export const keys = createKeyStore();

// The prepared photo and the request in flight live here, not in the saved state.
const current = { image: null, controller: null, preview: '' };
let seq = 0;

export const newPhoto = () => ({ phase: 'idle', note: '', previewUrl: '', items: [], mealName: '', notes: '', isFood: true, error: null });

// Whenever the sheet goes away: stop any request and let go of the photo.
onSheetClosed(() => {
  seq++;
  current.controller?.abort();
  current.controller = null;
  current.image = null;
  releasePreview(current.preview);
  current.preview = '';
});

const modelInfo = () => AI_MODELS.find((m) => m.id === modelOrDefault(getStore().state.prefs.aiModel));

// ---- Key setup (shared by the Photo tab and the More screen) -----------------------------------

function keySetupBody(sh) {
  return html`<div class="stack">
    <div class="card flat"><b>One-time setup</b>
      <ol class="steps">
        <li>Sign in to the <b>Claude Console</b> at <b>platform.claude.com</b>. It is separate from the Claude chat app. Add a few dollars of credit under Billing.</li>
        <li>Open <b>API keys</b> and create a key just for this app. If the Console lets you set a monthly spend limit, set a small one.</li>
        <li>Copy the key and paste it here.</li>
      </ol></div>
    <label class="field"><span>Your API key</span>
      <input class="input" type="password" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" data-input="sheet-field" data-field="aiKeyInput" value="${sh.aiKeyInput || ''}" placeholder="sk-ant-…" aria-label="API key"></label>
    ${sh.aiKeyError ? html`<p class="small" style="color:var(--bad)" role="alert">${sh.aiKeyError}</p>` : ''}
    <p class="tiny muted">The key stays on this phone. It is not included in backups and is sent only to Anthropic. The photos you analyse go to Anthropic as well, and this app does not keep them. Anthropic charges your account a few cents per photo.</p>
  </div>`;
}

export const aiKeySheet = (sh) => ({
  title: keys.status().has ? 'Change API key' : 'Set up photo logging',
  body: keySetupBody(sh),
  foot: html`<button class="btn primary" data-act="ai-key-save" ${raw((sh.aiKeyInput || '').trim() ? '' : 'disabled')}>Save key</button>`,
});

// ---- The Photo tab inside "Add food" ---------------------------------------------------------------

function errorBox(err) {
  if (!err) return '';
  const fix = ['auth', 'permission'].includes(err.kind) ? html`<div><button class="btn sm" data-act="ai-key-open" style="margin-top:6px">Change API key</button></div>` : '';
  return banner('bad', 'alert', html`${err.message}${err.detail ? html`<div class="tiny muted">${err.detail}</div>` : ''}${fix}`);
}

const fileInput = (label, cls = 'btn block') =>
  html`<label class="${cls}"><input type="file" accept="image/*" data-change="photo-file" style="display:none">${icon('camera')} ${label}</label>`;

export function photoTab(sh, label) {
  if (!keys.status().has) {
    return { body: keySetupBody(sh), foot: html`<button class="btn primary" data-act="ai-key-save" ${raw((sh.aiKeyInput || '').trim() ? '' : 'disabled')}>Save key</button>` };
  }
  const ph = (sh.photo ??= newPhoto());
  const mi = modelInfo();

  if (ph.phase === 'working') {
    return {
      body: html`<div class="stack center" style="padding:12px 0">
        ${ph.previewUrl ? html`<img class="photo-preview" src="${ph.previewUrl}" alt="Your meal">` : ''}
        <div class="spinner" role="status" aria-label="Working"></div>
        <p class="bold">Looking at your meal…</p>
        <p class="tiny muted">Usually 10 to 30 seconds.</p></div>`,
      foot: html`<button class="btn" data-act="photo-cancel">Cancel</button>`,
    };
  }

  if (ph.phase === 'done') {
    const rows = ph.items.map((it, i) => ({ it, i, m: itemMacros(it) }));
    const valid = rows.filter((r) => r.m);
    const total = macros(valid.reduce((a, r) => ({ p: a.p + r.m.p, c: a.c + r.m.c, f: a.f + r.m.f, a: a.a + r.m.a }), { p: 0, c: 0, f: 0, a: 0 }));
    const entries = itemsToEntries(ph.items);
    if (!ph.isFood || !ph.items.length) {
      return {
        body: html`<div class="stack">${banner('info', 'info', html`I could not find food in this photo.${ph.notes ? ' ' + ph.notes : ''}`)}${fileInput('Choose another photo')}</div>`,
        foot: html`<button class="btn" data-act="photo-again">Back</button>`,
      };
    }
    return {
      body: html`<div class="stack">
        <div class="row" style="gap:12px">${ph.previewUrl ? html`<img class="photo-thumb" src="${ph.previewUrl}" alt="Your meal">` : ''}<div class="grow"><div class="bold">${ph.mealName || 'Your meal'}</div><div class="small muted">Check each item and fix the weight if it looks off.</div></div></div>
        <div class="list">${rows.map(({ it, i, m }) => html`<div class="item photo-item" data-key="${it.id}">
          <div class="grow"><div class="title">${it.name}</div>
            ${m ? macroLine({ ...m, kcal: m.p * 4 + m.c * 4 + m.f * 9 + m.a * 7 }) : html`<div class="small" style="color:var(--bad)">Enter an amount</div>`}
            ${it.basis || it.confidence === 'low' ? html`<div class="tiny muted">${it.confidence === 'low' ? html`<span class="pill warn">low confidence</span> ` : ''}${it.basis}</div>` : ''}</div>
          ${it.baseGrams > 0 ? html`<div class="input-unit"><input class="input num" inputmode="decimal" autocomplete="off" data-input="photo-grams" data-i="${i}" value="${it.gramsText}" aria-label="Weight of ${it.name}"><i>g</i></div>` : ''}
          <button class="btn icon sm ghost" data-act="photo-remove" data-i="${i}" aria-label="Remove ${it.name}">${icon('trash')}</button></div>`)}</div>
        <div class="card flat"><div class="small muted bold">Meal total</div>${macroLine(total)}</div>
        ${ph.notes ? banner('info', 'info', html`${ph.notes}`) : ''}
        <label class="field"><span>Something off? Add a note and estimate again</span>
          <input class="input" autocomplete="off" data-input="sheet-field" data-field="photo.note" value="${ph.note}" placeholder="e.g. rice was about 150 g, no sugar in the tea"></label>
        <p class="tiny muted">An estimate from a photo can easily be 20% or more off. Weigh your food when you can.</p>
      </div>`,
      foot: html`<button class="btn" data-act="photo-again">Estimate again</button><button class="btn primary" data-act="photo-add" ${raw(entries.length ? '' : 'disabled')}>Add to ${label}</button>`,
    };
  }

  if (ph.phase === 'ready') {
    return {
      body: html`<div class="stack">
        ${errorBox(ph.error)}
        <img class="photo-preview" src="${ph.previewUrl}" alt="Your meal">
        <label class="field"><span>Anything the photo does not show? (optional)</span>
          <input class="input" autocomplete="off" data-input="sheet-field" data-field="photo.note" value="${ph.note}" placeholder="e.g. small bowl, no sugar, about 150 g rice"></label>
        ${fileInput('Choose a different photo')}
      </div>`,
      foot: html`<button class="btn primary" data-act="photo-analyze">${icon('sparkle')} Estimate calories and macros</button>`,
    };
  }

  // idle
  return {
    body: html`<div class="stack">
      ${errorBox(ph.error)}
      <p class="small muted">Take a photo of your meal, or choose one. The AI estimates what is on the plate and you check the numbers before anything is logged.</p>
      ${fileInput('Take or choose a photo', 'btn primary block')}
      <p class="tiny muted">Using the <b>${mi.label}</b> model, ${mi.cost}. You can change this in More.</p>
      <p class="tiny muted">Estimates from a photo are rough. Use the note for anything hidden, like oil, sauce or sugar.</p>
    </div>`,
    foot: null,
  };
}

// ---- More screen card -----------------------------------------------------------------------------

export function aiSettingsCard(s) {
  const st = keys.status();
  const mi = modelInfo();
  const t = ui.aiTest;
  return html`<section class="card"><div class="card-head"><h2>AI photo logging</h2><span class="pill ${st.has ? 'ok' : ''}">${st.has ? 'Ready' : 'Not set up'}</span></div>
    <p class="small muted">Photograph a meal and get an estimate of calories and macros. It uses your own Anthropic API key, so you pay Anthropic directly, usually a few cents per photo.</p>
    ${st.has ? html`<div class="stack" style="margin-top:12px">
      <div class="field"><span class="small muted bold">Model</span>${seg('ai-model', AI_MODELS.map((m) => [m.id, m.label]), modelOrDefault(s.prefs.aiModel))}<div class="tiny muted" style="margin-top:4px">${mi.cost}</div></div>
      <div class="row between"><div><div class="bold">API key</div><div class="tiny muted">${maskKey(keys.get())}${st.persistent ? '' : ' · only kept until you close the app'}</div></div></div>
      <div class="grid2"><button class="btn" data-act="ai-key-test" ${raw(t?.state === 'working' ? 'disabled' : '')}>Test key</button><button class="btn" data-act="ai-key-open">Change key</button></div>
      ${t?.state === 'working' ? html`<p class="small muted" role="status">Testing…</p>` : t ? html`<p class="small" style="color:var(${t.ok ? '--ok' : '--bad'})" role="status">${t.message}</p>` : ''}
      <button class="btn danger block" data-act="ai-key-remove">${icon('trash')} Remove key from this phone</button>
    </div>` : html`<button class="btn primary block" style="margin-top:12px" data-act="ai-key-open">Set up photo logging</button>`}
  </section>`;
}

// ---- Handlers -------------------------------------------------------------------------------------

async function runEstimate() {
  const sh = ui.sheet;
  const ph = sh?.photo;
  if (!ph || !current.image) return;
  const key = keys.get();
  if (!key) {
    ph.error = aiError('auth');
    ph.phase = 'ready';
    return render();
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    ph.error = aiError('network');
    return render();
  }
  const token = ++seq;
  current.controller?.abort();
  const controller = (current.controller = new AbortController());
  ph.phase = 'working';
  ph.error = null;
  render();
  const model = modelOrDefault(getStore().state.prefs.aiModel);
  const res = await callMessages({ apiKey: key, body: buildEstimateRequest({ model, image: current.image, note: ph.note }), signal: controller.signal });
  if (token !== seq || ui.sheet?.photo !== ph) return; // cancelled, or the sheet moved on
  if (res.kind === 'cancelled') {
    ph.phase = 'ready';
    return render();
  }
  const parsed = res.ok ? parseEstimate(res.json) : res;
  if (!parsed.ok) {
    ph.phase = 'ready';
    ph.error = parsed;
    return render();
  }
  Object.assign(ph, { phase: 'done', isFood: parsed.estimate.isFood, items: parsed.estimate.items, mealName: parsed.estimate.mealName, notes: parsed.estimate.notes, error: null });
  render();
}

export const photoInputs = {
  'photo-grams': (el) => {
    const it = ui.sheet?.photo?.items?.[Number(el.dataset.i)];
    if (!it) return;
    it.gramsText = el.value;
    render();
  },
};

export const photoChanges = {
  'photo-file': async (el) => {
    const file = el.files?.[0];
    el.value = '';
    const sh = ui.sheet;
    if (!file || !sh) return;
    const ph = (sh.photo ??= newPhoto());
    try {
      const img = await prepareImage(file);
      if (ui.sheet !== sh) return releasePreview(img.previewUrl);
      releasePreview(current.preview);
      current.preview = img.previewUrl;
      current.image = { base64: img.base64, mediaType: img.mediaType };
      Object.assign(ph, { phase: 'ready', previewUrl: img.previewUrl, items: [], mealName: '', notes: '', isFood: true, error: null });
    } catch (e) {
      ph.error = { ok: false, kind: 'bad_photo', message: e.message };
    }
    render();
  },
};

export const photoActions = {
  'photo-analyze': () => runEstimate(),
  'photo-cancel': () => {
    const ph = ui.sheet?.photo;
    seq++;
    current.controller?.abort();
    if (ph) ph.phase = current.image ? 'ready' : 'idle';
    render();
  },
  'photo-again': () => {
    const ph = ui.sheet?.photo;
    if (!ph) return;
    ph.phase = current.image ? 'ready' : 'idle';
    ph.error = null;
    render();
  },
  'photo-remove': (el) => {
    const ph = ui.sheet?.photo;
    if (!ph) return;
    ph.items.splice(Number(el.dataset.i), 1);
    render();
  },
  'photo-add': () => {
    const sh = ui.sheet;
    const entries = itemsToEntries(sh?.photo?.items || []);
    if (!entries.length) return;
    mutate((s) => entries.forEach((e) => addEstimateEntry(s, sh.date, e, sh.slot)));
    closeSheet();
    toast(entries.length === 1 ? 'Added 1 item (estimate)' : `Added ${entries.length} items (estimates)`);
  },

  'ai-key-open': () => openSheet('aiKey', { aiKeyInput: '', aiKeyError: '' }),
  'ai-key-save': () => {
    const sh = ui.sheet;
    const r = checkKeyFormat(sh?.aiKeyInput);
    if (!r.ok) {
      sh.aiKeyError = r.error;
      return render();
    }
    keys.set(r.key);
    sh.aiKeyInput = '';
    sh.aiKeyError = '';
    ui.aiTest = null;
    toast(keys.status().persistent ? 'Key saved on this phone' : 'Key kept until you close the app (storage is blocked)', 3200);
    if (sh.type === 'aiKey') closeSheet();
    else render();
  },
  'ai-key-remove': () =>
    openSheet('confirm', {
      title: 'Remove your API key?',
      message: 'Photo logging stops working until you add a key again. Your logged meals are not affected.',
      label: 'Remove key',
      onYes: () => {
        keys.clear();
        ui.aiTest = null;
        toast('Key removed');
      },
    }),
  'ai-key-test': async () => {
    const key = keys.get();
    if (!key) return;
    ui.aiTest = { state: 'working' };
    render();
    const res = await callMessages({ apiKey: key, body: buildTestRequest(getStore().state.prefs.aiModel), timeoutMs: 30_000 });
    ui.aiTest = res.ok ? { ok: true, message: 'Your key works.' } : { ok: false, message: res.message };
    render();
  },
  'ai-model': (el) => mutate((s) => { s.prefs.aiModel = modelOrDefault(el.dataset.v); }),
};

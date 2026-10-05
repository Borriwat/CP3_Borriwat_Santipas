// Meal-photo estimates with Claude. Pure functions with no DOM, so the request
// and the handling of the reply can be tested in Node. The network call takes
// `fetch` as a parameter for the same reason.
//
// The app has no server. The person's own API key stays on their phone (see
// aikey.js) and the photo goes straight from the phone to Anthropic.

import { round } from './macros.js';
import { parseNum } from './format.js';

export const AI_ENDPOINT = 'https://api.anthropic.com/v1/messages';
export const AI_VERSION = '2023-06-01';

// What each choice costs is an estimate (about 1,700 image tokens in, a short
// JSON answer plus some thinking out). Real usage is in the person's Console.
export const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Best accuracy', cost: 'roughly 3 to 5 US cents per photo' },
  { id: 'claude-sonnet-5-5', label: 'Cheaper', cost: 'roughly 1 to 3 US cents per photo' },
];
export const DEFAULT_MODEL = AI_MODELS[0].id;
export const modelOrDefault = (id) => (AI_MODELS.some((m) => m.id === id) ? id : DEFAULT_MODEL);

export const MAX_ITEMS = 25;

// ---- Request ------------------------------------------------------------------------

export const SYSTEM_PROMPT = `You estimate the nutrition of meals from photos for a person who tracks protein, carbs and fat.

Return one item for each distinct food or drink you can see. Merge things that are cooked together into one item (a stir-fry, a curry with its sauce).

- "grams" is the weight of the portion as it appears: cooked weight for cooked food, millilitres for drinks (1 ml is about 1 g). Judge size from objects of known size: the plate or bowl (a dinner plate is about 26 cm across), cutlery, hands, cups, packaging. Round to the nearest 5.
- The macros are for that whole portion, in grams. Include what you cannot see but would normally be there: cooking oil, sauces, dressings, sugar in drinks, coconut milk, fried coating. Restaurant and street food usually has more oil than home cooking, and rice, noodles and soup are often bigger than they look.
- The food may be Thai, other Asian or international. Name it the way the person would, in English, with the Thai name in brackets when that helps.
- If the person's note gives weights, brands, ingredients or corrections, trust it over what you see.
- "confidence": high for packaged food or something easy to weigh, medium for an ordinary plate you can size, low for mixed dishes, sauces or unclear portions.
- "basis": one short sentence on how you sized it, for example "about 1.5 cups of rice, roughly 240 g cooked".
- If the photo shows no food or drink, set "is_food" to false and return an empty list of items.
- "notes": one or two sentences on the biggest uncertainty (what could make this estimate wrong), or an empty string.`;

export const ESTIMATE_SCHEMA = {
  type: 'object',
  properties: {
    is_food: { type: 'boolean' },
    meal_name: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          grams: { type: 'number' },
          protein_g: { type: 'number' },
          carbs_g: { type: 'number' },
          fat_g: { type: 'number' },
          alcohol_g: { type: 'number' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          basis: { type: 'string' },
        },
        required: ['name', 'grams', 'protein_g', 'carbs_g', 'fat_g', 'alcohol_g', 'confidence', 'basis'],
        additionalProperties: false,
      },
    },
    notes: { type: 'string' },
  },
  required: ['is_food', 'meal_name', 'items', 'notes'],
  additionalProperties: false,
};

// `image` is { base64, mediaType }. The structured-output format guarantees the
// reply parses; forced tool use is not available on these models.
export function buildEstimateRequest({ model, image, note }) {
  const text = `Estimate this meal.${note?.trim() ? `\n\nNote from me: ${note.trim().slice(0, 500)}` : ''}`;
  return {
    model: modelOrDefault(model),
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: ESTIMATE_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
          { type: 'text', text },
        ],
      },
    ],
  };
}

export const buildTestRequest = (model) => ({
  model: modelOrDefault(model),
  max_tokens: 64,
  output_config: { effort: 'low' },
  messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
});

export const requestHeaders = (apiKey) => ({
  'content-type': 'application/json',
  'x-api-key': apiKey,
  'anthropic-version': AI_VERSION,
  // Required for calls straight from a web page. The name is a warning: the key
  // is visible to anyone who can run code on this page, so it must be the
  // person's own key, kept on their own device.
  'anthropic-dangerous-direct-browser-access': 'true',
});

// ---- Errors -------------------------------------------------------------------------

const ERRORS = {
  auth: 'That API key was not accepted. Check that you copied all of it, or make a new key.',
  billing: 'Your Anthropic account is out of credit. Add some in the Claude Console, then try again.',
  permission: 'That key is not allowed to use this feature. Make a new key in the Claude Console.',
  model: 'Your account cannot use this model. Choose the other model in More, under AI photo logging.',
  too_large: 'The photo is too large to send. Try a smaller photo.',
  rate_limit: 'Too many requests right now. Wait a minute and try again.',
  overloaded: 'The AI service is busy. Try again in a moment.',
  network: 'Could not reach the AI service. Check your internet connection and try again.',
  timeout: 'It took too long. Try again.',
  refusal: 'The AI declined to analyse this photo. Try a different photo, or enter the numbers yourself.',
  truncated: 'The answer was cut short. Try again.',
  bad_reply: 'The answer could not be read. Try again, or enter the numbers yourself.',
  bad_request: 'The request was rejected.',
};

export const aiError = (kind, detail) => ({ ok: false, kind, message: ERRORS[kind] || ERRORS.bad_request, ...(detail ? { detail: String(detail).slice(0, 200) } : {}) });

export function classifyHttpError(status, body) {
  const msg = body?.error?.message || '';
  if (status === 401) return aiError('auth');
  if (status === 402 || /credit balance/i.test(msg)) return aiError('billing');
  if (status === 403) return aiError('permission');
  if (status === 404) return aiError('model', msg);
  if (status === 413) return aiError('too_large');
  if (status === 429) return aiError('rate_limit');
  if (status >= 500) return aiError('overloaded');
  return aiError('bad_request', msg);
}

// POST to the Messages API. Resolves to { ok:true, json } or an aiError; never throws.
export async function callMessages({ apiKey, body, fetchImpl = globalThis.fetch, signal, timeoutMs = 90_000 }) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const res = await fetchImpl(AI_ENDPOINT, {
      method: 'POST',
      headers: requestHeaders(apiKey),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON error page */
    }
    if (!res.ok) return classifyHttpError(res.status, json);
    if (!json) return aiError('bad_reply');
    return { ok: true, json };
  } catch (e) {
    if (signal?.aborted) return { ok: false, kind: 'cancelled', message: 'Cancelled.' };
    if (timedOut || e?.name === 'AbortError') return aiError('timeout');
    return aiError('network');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

// ---- Reply --------------------------------------------------------------------------

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, hi) => (Number.isFinite(v) ? clamp(v, 0, hi) : 0);
const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

// Never trust a number just because it is well-formed: cap everything to what one
// plate could plausibly hold, and drop anything unusable.
export function sanitizeItem(raw, i = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const name = str(raw.name, 80);
  const p = num(raw.protein_g, 400);
  const c = num(raw.carbs_g, 600);
  const f = num(raw.fat_g, 400);
  const a = num(raw.alcohol_g, 150);
  if (!name || p + c + f + a <= 0) return null;
  const grams = num(raw.grams, 3000);
  return {
    id: `ai${i}`,
    name,
    baseGrams: round(grams, 0),
    base: { p: round(p, 1), c: round(c, 1), f: round(f, 1), a: round(a, 1) },
    gramsText: grams > 0 ? String(round(grams, 0)) : '',
    confidence: ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'medium',
    basis: str(raw.basis, 200),
  };
}

// Turn the Messages API response into { ok, estimate } or an aiError.
export function parseEstimate(json) {
  if (json?.type === 'error') return aiError('bad_request', json.error?.message);
  if (json?.stop_reason === 'refusal') return aiError('refusal');
  if (json?.stop_reason === 'max_tokens') return aiError('truncated');
  const block = Array.isArray(json?.content) ? json.content.find((b) => b?.type === 'text' && typeof b.text === 'string') : null;
  if (!block) return aiError('bad_reply');
  let data;
  try {
    data = JSON.parse(block.text);
  } catch {
    return aiError('bad_reply');
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.items)) return aiError('bad_reply');
  const items = data.items.slice(0, MAX_ITEMS).map((x, i) => sanitizeItem(x, i)).filter(Boolean);
  const isFood = data.is_food !== false && items.length > 0;
  return {
    ok: true,
    estimate: {
      isFood,
      mealName: str(data.meal_name, 80),
      items: isFood ? items : [],
      notes: str(data.notes, 400),
    },
  };
}

// ---- Editing the estimate ------------------------------------------------------------

// Macros for an item at the amount currently typed in. Editing the grams scales
// everything together; an item with no weight keeps its numbers.
export function itemMacros(item) {
  const grams = parseNum(item.gramsText);
  let k = 1;
  if (item.baseGrams > 0) {
    if (!Number.isFinite(grams) || grams < 0) return null;
    k = grams / item.baseGrams;
  }
  return { p: round(item.base.p * k, 1), c: round(item.base.c * k, 1), f: round(item.base.f * k, 1), a: round(item.base.a * k, 1) };
}

// What gets logged: one entry per item, with the weight in the name so the log
// still says what was eaten.
export function itemsToEntries(items) {
  const out = [];
  for (const it of items) {
    const m = itemMacros(it);
    if (!m || m.p + m.c + m.f + m.a <= 0) continue;
    const grams = it.baseGrams > 0 ? Math.round(parseNum(it.gramsText)) : 0;
    out.push({ name: grams > 0 ? `${it.name} (~${grams} g)` : it.name, ...m });
  }
  return out;
}

// Same shape as a key looks like from the Console. Loose on purpose: only catch
// obvious paste mistakes (spaces, a quote mark, the wrong thing entirely).
export function checkKeyFormat(text) {
  const key = String(text ?? '').trim().replace(/^["']|["']$/g, '');
  if (!key) return { ok: false, error: 'Paste your API key first.' };
  if (/\s/.test(key)) return { ok: false, error: 'The key should be one line with no spaces. Copy it again.' };
  if (!/^sk-ant-/.test(key)) return { ok: false, error: 'API keys start with sk-ant-. Check that you copied the key, not something else.' };
  if (/^sk-ant-admin/.test(key)) return { ok: false, error: 'That is an admin key, which cannot be used here. Create a normal API key.' };
  if (key.length < 30) return { ok: false, error: 'That looks too short. Copy the whole key.' };
  return { ok: true, key };
}

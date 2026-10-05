import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_ENDPOINT, AI_MODELS, DEFAULT_MODEL, ESTIMATE_SCHEMA, MAX_ITEMS, aiError, buildEstimateRequest, buildTestRequest, callMessages,
  checkKeyFormat, classifyHttpError, itemMacros, itemsToEntries, modelOrDefault, parseEstimate, requestHeaders, sanitizeItem,
} from '../js/core/ai.js';
import { createKeyStore, maskKey } from '../js/core/aikey.js';
import { defaultState, addEstimateEntry, exportState, parseBackup } from '../js/core/state.js';
import { entryMacros, kcalOf } from '../js/core/macros.js';
import { freshState, TODAY } from './helpers.mjs';

const image = { base64: 'QUJD', mediaType: 'image/jpeg' };
const reply = (obj, extra = {}) => ({ type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }], ...extra });
const goodItem = { name: 'Grilled chicken', grams: 180, protein_g: 54, carbs_g: 0, fat_g: 9, alcohol_g: 0, confidence: 'medium', basis: 'palm-sized fillet' };
const goodReply = { is_food: true, meal_name: 'Chicken and rice', items: [goodItem, { ...goodItem, name: 'Rice', grams: 200, protein_g: 5, carbs_g: 56, fat_g: 1 }], notes: 'Oil not visible.' };

// ---- request -------------------------------------------------------------------------

test('request: image first, structured output, no forced tool use or sampling params', () => {
  const req = buildEstimateRequest({ model: 'claude-opus-5-5', image, note: '  small bowl  ' });
  assert.equal(req.model, 'claude-opus-5-5');
  assert.equal(req.messages.length, 1);
  const [img, text] = req.messages[0].content;
  assert.deepEqual(img, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } });
  assert.match(text.text, /Note from me: small bowl$/);
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.equal(req.output_config.format.schema, ESTIMATE_SCHEMA);
  // these 400 on the current models
  for (const k of ['tool_choice', 'temperature', 'top_p', 'top_k', 'thinking']) assert.ok(!(k in req), `${k} must not be sent`);
  assert.ok(req.max_tokens >= 4000, 'room for thinking plus the answer');
});

test('request: no note means no note line; long notes are capped; unknown model falls back', () => {
  const a = buildEstimateRequest({ model: 'gpt-4', image, note: '   ' });
  assert.equal(a.model, DEFAULT_MODEL);
  assert.equal(a.messages[0].content[1].text, 'Estimate this meal.');
  const b = buildEstimateRequest({ model: DEFAULT_MODEL, image, note: 'x'.repeat(5000) });
  assert.ok(b.messages[0].content[1].text.length < 600);
  assert.equal(modelOrDefault('claude-sonnet-5-5'), 'claude-sonnet-5-5');
  assert.equal(modelOrDefault(undefined), DEFAULT_MODEL);
  assert.ok(AI_MODELS.length >= 2 && AI_MODELS.every((m) => m.id && m.label && m.cost));
});

test('request: schema satisfies the structured-output rules (additionalProperties false everywhere, no numeric limits)', () => {
  const walk = (node, path = 'root') => {
    if (node && typeof node === 'object') {
      if (node.type === 'object') {
        assert.equal(node.additionalProperties, false, `${path} must set additionalProperties:false`);
        assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), `${path} must require every property`);
      }
      for (const bad of ['minimum', 'maximum', 'minLength', 'maxLength', 'multipleOf']) assert.ok(!(bad in node), `${path} uses unsupported ${bad}`);
      for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
    }
  };
  walk(ESTIMATE_SCHEMA);
});

test('headers: key, version and the browser-access opt-in; test request is tiny', () => {
  const h = requestHeaders('sk-ant-abc');
  assert.equal(h['x-api-key'], 'sk-ant-abc');
  assert.equal(h['anthropic-version'], '2023-06-01');
  assert.equal(h['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(h['content-type'], 'application/json');
  assert.ok(!('anthropic-beta' in h), 'no beta features are used');
  const t = buildTestRequest('claude-sonnet-5-5');
  assert.ok(t.max_tokens <= 100 && t.model === 'claude-sonnet-5-5');
});

// ---- reply ---------------------------------------------------------------------------

test('parse: a good reply becomes items with a base for scaling', () => {
  const r = parseEstimate(reply(goodReply));
  assert.ok(r.ok);
  assert.equal(r.estimate.isFood, true);
  assert.equal(r.estimate.mealName, 'Chicken and rice');
  assert.equal(r.estimate.items.length, 2);
  const [chicken] = r.estimate.items;
  assert.deepEqual(chicken.base, { p: 54, c: 0, f: 9, a: 0 });
  assert.equal(chicken.baseGrams, 180);
  assert.equal(chicken.gramsText, '180');
  assert.equal(chicken.id, 'ai0');
});

test('parse: every failure shape gives a clear error, never an exception', () => {
  const cases = [
    [null, 'bad_reply'],
    [{}, 'bad_reply'],
    [{ content: [] }, 'bad_reply'],
    [{ content: [{ type: 'thinking', thinking: '' }] }, 'bad_reply'],
    [{ content: [{ type: 'text', text: 'not json' }] }, 'bad_reply'],
    [{ content: [{ type: 'text', text: '"just a string"' }] }, 'bad_reply'],
    [{ content: [{ type: 'text', text: '{"items":"nope"}' }] }, 'bad_reply'],
    [reply(goodReply, { stop_reason: 'refusal' }), 'refusal'],
    [reply(goodReply, { stop_reason: 'max_tokens' }), 'truncated'],
    [{ type: 'error', error: { type: 'invalid_request_error', message: 'bad' } }, 'bad_request'],
  ];
  for (const [input, kind] of cases) {
    const r = parseEstimate(input);
    assert.equal(r.ok, false, JSON.stringify(input));
    assert.equal(r.kind, kind, JSON.stringify(input));
    assert.ok(r.message.length > 10);
  }
});

test('parse: thinking blocks before the text are skipped', () => {
  const r = parseEstimate({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(goodReply) }] });
  assert.ok(r.ok && r.estimate.items.length === 2);
});

test('parse: not food, or nothing usable, is reported as not food', () => {
  assert.equal(parseEstimate(reply({ is_food: false, meal_name: '', items: [], notes: 'A cat.' })).estimate.isFood, false);
  const empty = parseEstimate(reply({ is_food: true, meal_name: 'x', items: [{ name: '', grams: 1, protein_g: 1, carbs_g: 1, fat_g: 1, alcohol_g: 0, confidence: 'low', basis: '' }], notes: '' }));
  assert.equal(empty.estimate.isFood, false);
  assert.deepEqual(empty.estimate.items, []);
});

test('sanitize: absurd, negative and non-numeric values are capped or dropped', () => {
  const wild = sanitizeItem({ name: '  Huge\n\n meal  ', grams: 1e9, protein_g: 99999, carbs_g: -5, fat_g: 'lots', alcohol_g: NaN, confidence: 'sure', basis: 'y'.repeat(900) });
  assert.equal(wild.name, 'Huge meal');
  assert.equal(wild.baseGrams, 3000);
  assert.equal(wild.base.p, 400);
  assert.equal(wild.base.c, 0);
  assert.equal(wild.base.f, 0);
  assert.equal(wild.confidence, 'medium', 'unknown confidence falls back');
  assert.equal(wild.basis.length, 200);
  assert.equal(sanitizeItem({ name: 'Water', grams: 300, protein_g: 0, carbs_g: 0, fat_g: 0, alcohol_g: 0 }), null, 'zero energy is not worth logging');
  assert.equal(sanitizeItem(null), null);
  assert.equal(sanitizeItem('x'), null);
});

test('sanitize: markup in names is kept as text (the UI escapes it), and the list is capped', () => {
  const r = parseEstimate(reply({ is_food: true, meal_name: '<img src=x onerror=alert(1)>', items: Array.from({ length: 60 }, (_, i) => ({ ...goodItem, name: `<b>${i}</b>` })), notes: '' }));
  assert.equal(r.estimate.items.length, MAX_ITEMS);
  assert.equal(r.estimate.mealName, '<img src=x onerror=alert(1)>');
});

// ---- editing --------------------------------------------------------------------------

test('edit: changing grams scales all macros together; bad input gives null', () => {
  const [chicken] = parseEstimate(reply(goodReply)).estimate.items;
  assert.deepEqual(itemMacros(chicken), { p: 54, c: 0, f: 9, a: 0 });
  assert.deepEqual(itemMacros({ ...chicken, gramsText: '90' }), { p: 27, c: 0, f: 4.5, a: 0 });
  assert.deepEqual(itemMacros({ ...chicken, gramsText: '90,5' }), itemMacros({ ...chicken, gramsText: '90.5' }), 'comma decimals work');
  assert.equal(itemMacros({ ...chicken, gramsText: '' }), null);
  assert.equal(itemMacros({ ...chicken, gramsText: 'abc' }), null);
  assert.equal(itemMacros({ ...chicken, gramsText: '-5' }), null);
  const unweighed = sanitizeItem({ name: 'Sauce', grams: 0, protein_g: 1, carbs_g: 10, fat_g: 3, alcohol_g: 0 });
  assert.deepEqual(itemMacros({ ...unweighed, gramsText: 'whatever' }), { p: 1, c: 10, f: 3, a: 0 }, 'no weight: numbers stay as they are');
});

test('entries: one per usable item, weight in the name, invalid rows skipped', () => {
  const { items } = parseEstimate(reply(goodReply)).estimate;
  const entries = itemsToEntries([items[0], { ...items[1], gramsText: '100' }, { ...items[0], gramsText: 'x' }]);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, 'Grilled chicken (~180 g)');
  assert.equal(entries[1].name, 'Rice (~100 g)');
  assert.equal(entries[1].c, 28, 'rice carbs halved with the weight');
});

test('log: estimate entries are flagged, keep energy derived from macros, and survive backup', () => {
  const s = freshState();
  addEstimateEntry(s, TODAY, { name: 'Pad thai (~350 g)', p: 20, c: 80, f: 25 }, 'lunch');
  const e = s.days[TODAY].entries.at(-1);
  assert.equal(e.src, 'ai');
  assert.equal(e.est, true);
  assert.equal(e.foodId, null);
  assert.equal(kcalOf(entryMacros(e)), 20 * 4 + 80 * 4 + 25 * 9);
  const back = parseBackup(exportState(s), TODAY);
  assert.ok(back.ok);
  assert.equal(back.state.days[TODAY].entries.at(-1).est, true);
});

// ---- errors ---------------------------------------------------------------------------

test('http errors are classified for a non-technical reader', () => {
  const body = (message) => ({ type: 'error', error: { message } });
  assert.equal(classifyHttpError(401, body('API key is invalid.')).kind, 'auth');
  assert.equal(classifyHttpError(402, null).kind, 'billing');
  assert.equal(classifyHttpError(400, body('Your credit balance is too low to access the Anthropic API.')).kind, 'billing');
  assert.equal(classifyHttpError(403, null).kind, 'permission');
  assert.equal(classifyHttpError(404, body('model: nope')).kind, 'model');
  assert.equal(classifyHttpError(413, null).kind, 'too_large');
  assert.equal(classifyHttpError(429, null).kind, 'rate_limit');
  assert.equal(classifyHttpError(529, null).kind, 'overloaded');
  assert.equal(classifyHttpError(500, null).kind, 'overloaded');
  const other = classifyHttpError(400, body('messages: something specific'));
  assert.equal(other.kind, 'bad_request');
  assert.match(other.detail, /something specific/);
  assert.ok(!/sk-ant/.test(JSON.stringify(aiError('auth'))));
});

const fakeFetch = (res) => async (url, init) => {
  fakeFetch.last = { url, init };
  if (res instanceof Error) throw res;
  return { ok: res.status >= 200 && res.status < 300, status: res.status, json: async () => { if (res.badJson) throw new SyntaxError('x'); return res.body; } };
};

test('callMessages: posts to the API with the key in a header, never in the URL or body', async () => {
  const body = buildEstimateRequest({ model: DEFAULT_MODEL, image });
  const r = await callMessages({ apiKey: 'sk-ant-SECRET-123', body, fetchImpl: fakeFetch({ status: 200, body: reply(goodReply) }) });
  assert.ok(r.ok);
  assert.equal(fakeFetch.last.url, AI_ENDPOINT);
  assert.equal(fakeFetch.last.init.method, 'POST');
  assert.equal(fakeFetch.last.init.headers['x-api-key'], 'sk-ant-SECRET-123');
  assert.ok(!fakeFetch.last.url.includes('SECRET'));
  assert.ok(!fakeFetch.last.init.body.includes('SECRET'));
});

test('callMessages: maps failures and never throws', async () => {
  const body = {};
  const run = (res) => callMessages({ apiKey: 'k', body, fetchImpl: fakeFetch(res) });
  assert.equal((await run({ status: 401, body: { error: { message: 'x' } } })).kind, 'auth');
  assert.equal((await run({ status: 529, body: null, badJson: true })).kind, 'overloaded', 'HTML error page');
  assert.equal((await run({ status: 200, body: null, badJson: true })).kind, 'bad_reply');
  assert.equal((await run(new TypeError('Load failed'))).kind, 'network');
});

test('callMessages: timeout and cancel are different outcomes', async () => {
  const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const timedOut = await callMessages({ apiKey: 'k', body: {}, fetchImpl: hang, timeoutMs: 20 });
  assert.equal(timedOut.kind, 'timeout');
  const ctl = new AbortController();
  const p = callMessages({ apiKey: 'k', body: {}, fetchImpl: hang, signal: ctl.signal, timeoutMs: 5000 });
  ctl.abort();
  assert.equal((await p).kind, 'cancelled');
});

// ---- key ------------------------------------------------------------------------------

test('key format: catches paste mistakes without being fussy about the real thing', () => {
  const real = 'sk-ant-api03-' + 'A'.repeat(40);
  assert.deepEqual(checkKeyFormat(`  ${real}\n`), { ok: true, key: real });
  assert.equal(checkKeyFormat(`"${real}"`).key, real, 'surrounding quotes are removed');
  for (const bad of ['', '   ', 'sk-ant-api03-abc def' + 'x'.repeat(30), 'hello', 'sk-proj-' + 'a'.repeat(40), 'sk-ant-short', 'sk-ant-admin01-' + 'a'.repeat(40)]) {
    assert.equal(checkKeyFormat(bad).ok, false, bad);
  }
  assert.equal(checkKeyFormat(null).ok, false);
});

const fakeStorage = (opts = {}) => {
  const m = new Map();
  return { m, getItem: (k) => { if (opts.throws) throw new Error('blocked'); return m.has(k) ? m.get(k) : null; }, setItem: (k, v) => { if (opts.throws) throw new Error('blocked'); m.set(k, v); }, removeItem: (k) => { if (opts.throws) throw new Error('blocked'); m.delete(k); } };
};

test('key store: save, read, clear; falls back to memory when storage is blocked', () => {
  const st = fakeStorage();
  const ks = createKeyStore(st);
  assert.deepEqual(ks.status(), { has: false, persistent: false });
  ks.set('sk-ant-abc');
  assert.equal(ks.get(), 'sk-ant-abc');
  assert.deepEqual(ks.status(), { has: true, persistent: true });
  assert.equal(createKeyStore(st).get(), 'sk-ant-abc', 'a new session sees it');
  ks.clear();
  assert.equal(ks.get(), null);
  assert.equal(st.m.size, 0);

  const blocked = createKeyStore(fakeStorage({ throws: true }));
  blocked.set('sk-ant-mem');
  assert.equal(blocked.get(), 'sk-ant-mem');
  assert.deepEqual(blocked.status(), { has: true, persistent: false }, 'told it will not survive a reload');
  blocked.clear();
  assert.equal(blocked.get(), null);
  assert.equal(createKeyStore(null).get(), null, 'no storage at all is fine');
});

test('key is never part of the app state or a backup file', () => {
  const key = 'sk-ant-api03-' + 'Z'.repeat(40);
  const ks = createKeyStore(fakeStorage());
  ks.set(key);
  const s = freshState();
  const backup = exportState(s);
  assert.ok(!backup.includes(key) && !backup.includes('sk-ant'), 'backup has no key');
  assert.ok(!JSON.stringify(defaultState(TODAY)).includes('ai-key'));
  assert.equal(maskKey(key), 'sk-ant-…ZZZZ');
  assert.equal(maskKey(''), '');
  assert.equal(maskKey(null), '');
});

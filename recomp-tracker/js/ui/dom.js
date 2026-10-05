// Tiny rendering helpers: an auto-escaping template tag and a DOM "morph" that
// updates the page in place, so typing in an input is never interrupted by a
// re-render.

class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

export const raw = (s) => new Raw(String(s ?? ''));

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const piece = (v) => {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(piece).join('');
  if (v === false || v == null) return '';
  return esc(v);
};

// html`<p>${userText}</p>`: values are escaped unless they came from another html``.
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += piece(vals[i]) + strings[i + 1];
  return new Raw(out);
}

// ---- morph ------------------------------------------------------------------

const keyOf = (n) => (n.nodeType === 1 ? n.getAttribute('data-key') : null);

function compatible(a, b) {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType !== 1) return true;
  return a.tagName === b.tagName && (a.tagName !== 'INPUT' || a.type === b.type);
}

function syncAttrs(el, next) {
  for (const a of [...el.attributes]) if (!next.hasAttribute(a.name)) el.removeAttribute(a.name);
  for (const a of [...next.attributes]) if (el.getAttribute(a.name) !== a.value) el.setAttribute(a.name, a.value);
}

function patchNode(el, next) {
  if (el.nodeType !== 1) {
    if (el.nodeValue !== next.nodeValue) el.nodeValue = next.nodeValue;
    return;
  }
  syncAttrs(el, next);
  const tag = el.tagName;
  const focused = el === document.activeElement;
  if (tag === 'INPUT') {
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = next.checked;
    else if (!focused && el.value !== next.getAttribute('value') && !el.hasAttribute('data-keep')) el.value = next.getAttribute('value') ?? '';
    return;
  }
  if (tag === 'TEXTAREA') {
    if (!focused) el.value = next.value;
    return;
  }
  patchChildren(el, [...next.childNodes]);
  if (tag === 'SELECT') {
    const want = [...next.options].find((o) => o.hasAttribute('selected'));
    if (want && el.value !== want.value) el.value = want.value;
  }
}

function patchChildren(parent, newNodes) {
  const oldKids = [...parent.childNodes];
  const keyed = new Map();
  const unkeyed = [];
  for (const o of oldKids) {
    const k = keyOf(o);
    if (k != null) keyed.set(k, o);
    else unkeyed.push(o);
  }
  let u = 0;
  const result = [];
  for (const n of newNodes) {
    const k = keyOf(n);
    let el;
    if (k != null) {
      const o = keyed.get(k);
      keyed.delete(k);
      if (o && compatible(o, n)) {
        patchNode(o, n);
        el = o;
      } else el = n;
    } else {
      const o = unkeyed[u++];
      if (o && compatible(o, n)) {
        patchNode(o, n);
        el = o;
      } else el = n;
    }
    result.push(el);
  }
  const keep = new Set(result);
  for (const o of oldKids) if (!keep.has(o)) parent.removeChild(o);
  let ref = parent.firstChild;
  for (const el of result) {
    if (el === ref) ref = ref.nextSibling;
    else parent.insertBefore(el, ref);
  }
}

export function morph(root, markup) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(markup);
  patchChildren(root, [...tpl.content.childNodes]);
}

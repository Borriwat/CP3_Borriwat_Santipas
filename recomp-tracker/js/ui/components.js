import { html, raw } from './dom.js';
import { n0, n1, pct } from '../core/format.js';
import { shortDate, diffDays } from '../core/dates.js';

// ---- Icons (24x24, stroke) -----------------------------------------------------

const PATHS = {
  today: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/><path d="m9 15 2 2 4-4"/>',
  plan: '<path d="M7 3v8a2 2 0 0 0 2 2v8"/><path d="M11 3v8"/><path d="M7 7h4"/><path d="M17 3c-2 2-3 5-3 8h3v10"/>',
  train: '<path d="M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12"/>',
  progress: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  chevL: '<path d="m15 5-7 7 7 7"/>',
  chevR: '<path d="m9 5 7 7-7 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  swap: '<path d="M7 7h12l-3-3M17 17H5l3 3"/>',
  drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  alert: '<path d="M12 4 3 20h18L12 4z"/><path d="M12 10v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 3h6"/>',
  flame: '<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  scale: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 9.5a5 5 0 0 1 7 0M12 12l2-2"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  download: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/>',
  upload: '<path d="M12 20V9m0 0-4 4m4-4 4 4M5 4h14"/>',
  book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
  shield: '<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3z"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
};

export const icon = (name, cls = '') =>
  raw(`<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`);

// ---- Pieces --------------------------------------------------------------------

export function ring(value, target, label = 'left') {
  const R = 54;
  const C = 2 * Math.PI * R;
  const frac = target > 0 ? Math.min(1, value / target) : 0;
  const over = target > 0 && value > target;
  const left = Math.round(target - value);
  return html`<div class="ring-wrap ${over ? 'over' : ''}" role="img" aria-label="${n0(value)} of ${n0(target)} kilocalories">
    <svg viewBox="0 0 132 132"><circle class="ring-bg" cx="66" cy="66" r="${R}" fill="none" stroke-width="12"/>
    <circle class="ring-fg" cx="66" cy="66" r="${R}" fill="none" stroke-width="12" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - frac)).toFixed(1)}"/></svg>
    <div class="ring-center"><b>${over ? '+' + Math.abs(left) : left}</b><span>${over ? 'kcal over' : 'kcal ' + label}</span></div>
  </div>`;
}

// One macro: label, grams eaten / target, bar, and what's left.
export function macroRow(key, name, eaten, target) {
  const left = Math.round(target - eaten);
  const over = target > 0 && eaten > target + 0.5;
  return html`<div class="macro-row">
    <b class="mc-${key}">${name}</b>
    <div class="bar ${key} ${over ? 'over' : ''}" role="progressbar" aria-label="${name}" aria-valuemin="0" aria-valuemax="${n0(target)}" aria-valuenow="${n0(eaten)}"><i style="width:${Math.min(100, pct(eaten, target))}%"></i></div>
    <span class="small"><b>${n0(eaten)}</b> / ${n0(target)} g <span class="muted">${over ? `(+${Math.abs(left)})` : `(${left} left)`}</span></span>
  </div>`;
}

export const macroLine = (m) =>
  html`<div class="macro-line"><span class="mc-p">P ${n0(m.p)}</span><span class="mc-c">C ${n0(m.c)}</span><span class="mc-f">F ${n0(m.f)}</span><span class="muted">${n0(m.kcal)} kcal</span></div>`;

export const seg = (act, options, current, extra = '', cls = '') =>
  html`<div class="seg ${cls}" role="group">${options.map(([v, label]) => html`<button type="button" data-act="${act}" data-v="${v}" ${raw(extra)} aria-pressed="${String(v === current)}">${label}</button>`)}</div>`;

export const chip = (act, v, label, on, extra = '') =>
  html`<button type="button" class="chip" data-act="${act}" data-v="${v}" ${raw(extra)} aria-pressed="${String(!!on)}">${label}</button>`;

export const checkbox = (act, attrs, on, label) =>
  html`<button type="button" class="check" data-act="${act}" ${raw(attrs)} aria-pressed="${String(!!on)}" aria-label="${label}">${icon('check')}</button>`;

export const banner = (kind, ic, content) => html`<div class="banner ${kind}" role="note">${icon(ic)}<div class="grow">${content}</div></div>`;

// ---- Charts --------------------------------------------------------------------

/**
 * Line chart over dates. series: [{ cls, pts:[{date, v, q?}], dots }]
 * Draws min/max labels, a few gridlines, and first/last dates.
 */
export function lineChart({ series, start, end, height = 170, unit = '', label = 'Chart' }) {
  const W = 340;
  const H = height;
  const m = { l: 34, r: 8, t: 10, b: 20 };
  const all = series.flatMap((s) => s.pts.map((p) => p.v));
  if (!all.length) return html`<p class="muted small center" style="padding:24px 0">No data yet</p>`;
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const pad = Math.max(0.3, (hi - lo) * 0.18);
  lo -= pad;
  hi += pad;
  const span = Math.max(1, diffDays(start, end));
  const x = (d) => m.l + ((W - m.l - m.r) * diffDays(start, d)) / span;
  const y = (v) => m.t + (H - m.t - m.b) * (1 - (v - lo) / (hi - lo));
  const ticks = [lo + pad, (lo + hi) / 2, hi - pad];
  const lines = ticks.map((t) => html`<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text x="${m.l - 5}" y="${(y(t) + 3).toFixed(1)}" text-anchor="end">${n1(t)}</text>`);
  const paths = series.map((s) => {
    const d = s.pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)} ${y(p.v).toFixed(1)}`).join('');
    const dots = s.dots ? s.pts.map((p) => html`<circle class="dot ${p.q ? 'q' : ''}" cx="${x(p.date).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="${p.q ? 3.2 : 2.6}"/>`) : '';
    return html`<path class="${s.cls}" d="${d}"/>${dots}`;
  });
  const last = series.find((s) => s.pts.length)?.pts.at(-1);
  return html`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}${last ? `, latest ${n1(last.v)}${unit}` : ''}">
    ${lines}${paths}
    <text x="${m.l}" y="${H - 5}">${shortDate(start)}</text><text x="${W - m.r}" y="${H - 5}" text-anchor="end">${shortDate(end)}</text>
  </svg>`;
}

// Bars for per-session values.
export function barChart({ pts, height = 130, label = 'Chart' }) {
  if (!pts.length) return html`<p class="muted small center" style="padding:24px 0">No sessions yet</p>`;
  const W = 340;
  const H = height;
  const m = { l: 8, r: 8, t: 8, b: 20 };
  const hi = Math.max(...pts.map((p) => p.v)) * 1.1;
  const bw = Math.min(30, ((W - m.l - m.r) / pts.length) * 0.7);
  const step = (W - m.l - m.r) / pts.length;
  return html`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">
    ${pts.map((p, i) => {
      const h = ((H - m.t - m.b) * p.v) / hi;
      const cx = m.l + step * i + step / 2;
      return html`<rect class="bar-v" x="${(cx - bw / 2).toFixed(1)}" y="${(H - m.b - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3"/>
      <text x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle">${Number(p.date.slice(8))}/${Number(p.date.slice(5, 7))}</text>`;
    })}
  </svg>`;
}

// Waist and hips: smaller is the goal. Chest, arm, thigh: bigger is the goal.
export const girthClass = (key, delta) => {
  if (!delta) return '';
  const shrinkGood = key === 'waist' || key === 'hip';
  return (delta < 0) === shrinkGood ? 'down' : 'up';
};

export const n0 = (n) => (Number.isFinite(n) ? String(Math.round(n)) : '–');

export const n1 = (n) => {
  if (!Number.isFinite(n)) return '–';
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

export const signed = (n, dp = 0) => {
  if (!Number.isFinite(n)) return '–';
  const k = 10 ** dp;
  const r = Math.round(n * k) / k;
  if (r === 0) return '0';
  return (r > 0 ? '+' : '−') + Math.abs(r).toFixed(dp);
};

// Quantities: whole grams for big amounts, one decimal for small ones.
export const qtyText = (qty, unit = 'g') => {
  if (unit === 'serving') return `${n1(qty)} serving${qty === 1 ? '' : 's'}`;
  const v = qty >= 20 ? Math.round(qty) : Math.round(qty * 10) / 10;
  return `${v} ${unit}`;
};

export const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

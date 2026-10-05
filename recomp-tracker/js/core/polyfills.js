// Tiny fallbacks so the app still starts on older iOS (before 15.4), which lacks
// structuredClone and Array.prototype.at. State is plain JSON data, so a JSON
// round trip is an accurate clone.
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
}
if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, 'at', {
    value(n) {
      let i = Math.trunc(n) || 0;
      if (i < 0) i += this.length;
      return this[i];
    },
    writable: true,
    configurable: true,
  });
}
if (!String.prototype.replaceAll) {
  Object.defineProperty(String.prototype, 'replaceAll', {
    value(a, b) {
      return typeof a === 'string' ? this.split(a).join(b) : this.replace(a, b);
    },
    writable: true,
    configurable: true,
  });
}

// Persistence. IndexedDB first (roomy and robust), then localStorage, then
// memory. Memory means nothing survives a reload; the UI shows a warning.

const DB = 'recomp-tracker';
const STORE = 'kv';
const KEY = 'state';
const LS_KEY = 'recomp-tracker:state:v1';

export function memoryStorage(initial = null) {
  let data = initial ? JSON.stringify(initial) : null;
  return {
    kind: 'memory',
    async load() {
      return data ? JSON.parse(data) : null;
    },
    async save(state) {
      data = JSON.stringify(state);
    },
  };
}

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}

const tx = (db, mode, fn) =>
  new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('aborted'));
  });

export async function createStorage() {
  try {
    const db = await openDB();
    // prove it works (Safari private mode can open but then throw on write)
    await tx(db, 'readwrite', (s) => s.put(Date.now(), '__probe'));
    return {
      kind: 'indexeddb',
      async load() {
        return (await tx(db, 'readonly', (s) => s.get(KEY))) ?? null;
      },
      async save(state) {
        await tx(db, 'readwrite', (s) => s.put(state, KEY));
      },
    };
  } catch {
    /* fall through */
  }
  try {
    localStorage.setItem('__probe', '1');
    localStorage.removeItem('__probe');
    return {
      kind: 'localstorage',
      async load() {
        const raw = localStorage.getItem(LS_KEY);
        return raw ? JSON.parse(raw) : null;
      },
      async save(state) {
        localStorage.setItem(LS_KEY, JSON.stringify(state));
      },
    };
  } catch {
    return memoryStorage();
  }
}

// Ask the browser not to evict our data. Safe to call repeatedly.
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* not available */
  }
  return false;
}

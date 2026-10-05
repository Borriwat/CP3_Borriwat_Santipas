// Where the person's own API key lives. It is deliberately NOT part of the app
// state: backups, exports and the "restore" flow never see it, so a backup file
// that gets emailed or stored in iCloud cannot leak it.
//
// localStorage first; if the browser refuses (private mode), the key is kept in
// memory for this session only.

const KEY = 'recomp-tracker:ai-key';

// Merely touching window.localStorage can throw when the browser blocks storage.
const defaultStorage = () => {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
};

export function createKeyStore(storage = defaultStorage()) {
  let memory = null;
  const usable = () => !!storage;
  return {
    get() {
      if (memory) return memory;
      try {
        return usable() ? storage.getItem(KEY) || null : null;
      } catch {
        return null;
      }
    },
    set(value) {
      memory = value;
      try {
        if (usable()) {
          storage.setItem(KEY, value);
          memory = null; // stored properly, no need for the copy
        }
      } catch {
        /* keep the in-memory copy */
      }
    },
    clear() {
      memory = null;
      try {
        if (usable()) storage.removeItem(KEY);
      } catch {
        /* ignore */
      }
    },
    // Is there a key, and will it survive a reload?
    status() {
      const k = this.get();
      return k ? { has: true, persistent: memory === null } : { has: false, persistent: false };
    },
  };
}

// "sk-ant-api03-AbCd…xyz9" -> "sk-ant-…xyz9" (enough to recognise, not enough to use)
export const maskKey = (key) => (key && key.length > 12 ? `sk-ant-…${key.slice(-4)}` : '');

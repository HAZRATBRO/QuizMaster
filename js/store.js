// Saved quizzes, their source PDFs and test attempts, kept in IndexedDB in this browser.
// Falls back to memory (lost on reload) when IndexedDB is unavailable, e.g. in private windows.

const DB_NAME = 'quizmaster';
const DB_VERSION = 1;
const STORES = ['quizzes', 'pdfs', 'attempts'];

let dbPromise = null;
const memory = Object.fromEntries(STORES.map((s) => [s, new Map()]));
export const storage = { persistent: true };

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    const fail = () => {
      storage.persistent = false;
      resolve(null);
    };
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      fail();
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = fail;
    req.onblocked = fail;
  });
  return dbPromise;
}

function request(store, mode, action) {
  return openDb().then((db) => {
    if (!db) return undefined;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = action(tx.objectStore(store));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  });
}

export async function put(store, value) {
  if (await openDb()) return request(store, 'readwrite', (os) => os.put(value));
  memory[store].set(value.id, structuredClone(value));
}

export async function get(store, id) {
  if (await openDb()) return request(store, 'readonly', (os) => os.get(id));
  const v = memory[store].get(id);
  return v === undefined ? undefined : structuredClone(v);
}

export async function getAll(store) {
  if (await openDb()) return request(store, 'readonly', (os) => os.getAll());
  return [...memory[store].values()].map((v) => structuredClone(v));
}

export async function remove(store, id) {
  if (await openDb()) return request(store, 'readwrite', (os) => os.delete(id));
  memory[store].delete(id);
}

export const uid = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

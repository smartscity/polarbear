import { APP_EVENTS } from "../events/appEvents";
import { STORAGE_KEYS } from "../constants/storageKeys";

const DATABASE = "polarbear.settings";
const STORE = "preferences";
const OPEN_TIMEOUT_MS = 5_000;
type Snapshot = { revision: number; value: unknown };
let cached: Snapshot | undefined;
let initializing: Promise<void> | undefined;
let channel: BroadcastChannel | undefined;
let refreshing: Promise<void> | undefined;
let refreshRequested = false;

export function cachedSettings(): unknown {
  return cached?.value;
}

function publish(snapshot: Snapshot) {
  if (cached && snapshot.revision <= cached.revision) return;
  cached = snapshot;
  window.dispatchEvent(new CustomEvent(APP_EVENTS.settingsChanged));
}

function decodeSnapshot(value: unknown): Snapshot {
  if (!value || typeof value !== "object" || !("revision" in value) || !("value" in value)
    || typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 1) {
    throw new Error("Invalid settings database snapshot.");
  }
  return { revision: value.revision, value: value.value };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    let finished = false;
    const fail = (reason: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(reason);
    };
    const timer = setTimeout(() => fail(new Error("Settings database open timed out.")), OPEN_TIMEOUT_MS);
    request.onblocked = () => fail(new Error("Settings database upgrade is blocked by another window."));
    request.onerror = () => fail(request.error);
    request.onupgradeneeded = () => {
      if (finished) { request.transaction?.abort(); return; }
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      if (finished) { request.result.close(); return; }
      finished = true;
      clearTimeout(timer);
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

async function transaction(seed: () => unknown, update?: (value: unknown) => unknown): Promise<Snapshot> {
  const database = await openDatabase();
  try {
    return await new Promise<Snapshot>((resolve, reject) => {
      // IndexedDB serializes this read and write across renderer processes. A
      // Web Lock alone cannot make localStorage replica reads transactional.
      const tx = database.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const read = store.get(STORAGE_KEYS.settings);
      let snapshot: Snapshot;
      let failure: unknown;
      read.onsuccess = () => {
        try {
          const previous = read.result === undefined ? undefined : decodeSnapshot(read.result);
          if (previous && !update) { snapshot = previous; return; }
          const value = previous ? previous.value : seed();
          snapshot = { revision: (previous?.revision ?? 0) + 1, value: update ? update(value) : value };
          if (!Number.isSafeInteger(snapshot.revision)) throw new Error("Settings revision exhausted.");
          store.put(snapshot, STORAGE_KEYS.settings);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.onabort = () => reject(failure ?? tx.error ?? new Error("Settings transaction aborted."));
      tx.oncomplete = () => resolve(snapshot);
    });
  } finally {
    database.close();
  }
}

function connect(seed: () => unknown) {
  if (channel) return;
  channel = new BroadcastChannel(DATABASE);
  channel.onmessage = (event: MessageEvent<unknown>) => {
    if (typeof event.data !== "number" || event.data <= (cached?.revision ?? 0)) return;
    // Only revision notifications cross the channel; IndexedDB is the authority.
    refresh(seed);
  };
}

function refresh(seed: () => unknown) {
  refreshRequested = true;
  if (refreshing) return;
  refreshing = (async () => {
    while (refreshRequested) {
      refreshRequested = false;
      publish(await transaction(seed));
    }
  })().catch(() => {
    // Retain the acknowledged projection; the next notification, focus or
    // explicit mutation retries. Coalesce bursts instead of queuing readers.
  }).finally(() => { refreshing = undefined; });
}

export function initializeSettings(seed: () => unknown): Promise<void> {
  if (!initializing) {
    initializing = Promise.resolve().then(() => {
      connect(seed);
      return transaction(seed);
    }).then(snapshot => {
      publish(snapshot);
      window.addEventListener("focus", () => refresh(seed));
      window.addEventListener("pagehide", () => { channel?.close(); channel = undefined; }, { once: true });
      window.addEventListener("pageshow", () => { connect(seed); refresh(seed); });
    }).catch(error => { initializing = undefined; throw error; });
  }
  return initializing;
}

export async function commitSettings(seed: () => unknown, update: (value: unknown) => unknown): Promise<unknown> {
  connect(seed);
  const snapshot = await transaction(seed, update);
  publish(snapshot);
  try { channel?.postMessage(snapshot.revision); } catch {
    // Notification failure cannot undo a committed transaction. Focus/reopen
    // reads the authority again; do not report a durable write as failed.
  }
  return snapshot.value;
}

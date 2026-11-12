import type { Order } from "@swarm/sim";

/**
 * Planning drafts for online games, in IndexedDB keyed by (gameId, turn), so closing the app
 * never loses planned orders (SPEC §9.4). Every call degrades to a no-op without IndexedDB.
 */
const DB = "swarm-drafts";
const STORE = "drafts";

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

const key = (gameId: string, turn: number) => `${gameId}:${turn}`;

export async function saveDraft(
  gameId: string,
  turn: number,
  orders: readonly Order[],
): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(orders, key(gameId, turn));
    tx.oncomplete = tx.onerror = () => resolve();
  });
  db.close();
}

export async function loadDraft(gameId: string, turn: number): Promise<Order[]> {
  const db = await open();
  if (!db) return [];
  const result = await new Promise<Order[]>((resolve) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key(gameId, turn));
    req.onsuccess = () => resolve(Array.isArray(req.result) ? (req.result as Order[]) : []);
    req.onerror = () => resolve([]);
  });
  db.close();
  return result;
}

export async function clearDrafts(gameId: string, beforeTurn: number): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return;
      const [g, t] = String(cur.key).split(":");
      if (g === gameId && Number(t) < beforeTurn) cur.delete();
      cur.continue();
    };
    tx.oncomplete = tx.onerror = () => resolve();
  });
  db.close();
}

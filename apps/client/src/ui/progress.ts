import { useEffect, useState } from "preact/hooks";
import {
  ACHIEVEMENTS,
  CAMPAIGN,
  campaignNode,
  earnedAchievements,
  emptyProgress,
  mergeProgress,
  nodeCompleted,
  type GameSummary,
  type Progress,
} from "@swarm/content";

/**
 * Player progress (SPEC §11.1): saved locally in IndexedDB and synced to the account when
 * online. Every list only grows, so local and server copies merge by union and neither can roll
 * the other back. Without IndexedDB the progress lasts for this tab only.
 */
const DB = "swarm-progress";
const STORE = "progress";
const KEY = "me";

let current: Progress = emptyProgress();
let loaded: Promise<Progress> | null = null;
const listeners = new Set<(p: Progress) => void>();

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

/** Accepts only well-formed progress (older or hand-edited copies fall back to empty). */
function valid(p: unknown): p is Progress {
  const o = p as Progress | null;
  return (
    !!o &&
    o.version === 1 &&
    [o.completedNodes, o.drafted, o.achievements, o.rewards].every(Array.isArray) &&
    typeof o.selected === "object"
  );
}

async function read(): Promise<Progress> {
  const db = await open();
  if (!db) return emptyProgress();
  const p = await new Promise<unknown>((resolve) => {
    const req = db.transaction(STORE).objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  db.close();
  return valid(p) ? { ...emptyProgress(), ...p } : emptyProgress();
}

async function write(p: Progress): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(p, KEY);
    tx.oncomplete = tx.onerror = () => resolve();
  });
  db.close();
}

function set(p: Progress): void {
  current = p;
  for (const fn of listeners) fn(current);
}

/** Loads progress once (later calls share the first load). */
export function loadProgress(): Promise<Progress> {
  // Anything recorded before the load finished is kept (the union), with the stored choices.
  loaded ??= read().then((p) => {
    set(mergeProgress(p, current));
    return current;
  });
  return loaded;
}

export function getProgress(): Progress {
  return current;
}

/** Applies a change, saves it, and syncs it to the account in the background. */
export async function updateProgress(fn: (p: Progress) => Progress): Promise<Progress> {
  await loadProgress();
  const next = fn(current);
  set(next);
  await write(next);
  void syncProgress();
  return next;
}

/**
 * Merges with the account's copy when this device has an account (a guest is created by
 * online play; progress alone never creates one). Offline, it simply waits for next time.
 */
export async function syncProgress(): Promise<void> {
  try {
    const { api, hasGuest } = await import("../net/api");
    if (!hasGuest()) return;
    const remote = await api.putProgress(current);
    const merged = mergeProgress(current, remote);
    set(merged);
    await write(merged);
  } catch {
    // Offline or server down: the local copy stays authoritative until the next sync.
  }
}

export function useProgress(): Progress {
  const [p, setP] = useState(current);
  useEffect(() => {
    listeners.add(setP);
    // The load resolves to the progress as first read; anything since is in `current`.
    void loadProgress().then(() => setP(current));
    return () => void listeners.delete(setP);
  }, []);
  return p;
}

/** What a finished game earned, for the results screen. */
export interface GameRewards {
  achievements: string[];
  /** The campaign node this game completed (first time or again). */
  completedNode: string | null;
  /** True when the node was completed for the first time. */
  firstCompletion: boolean;
  /** Whether a campaign game met its twist (a win that missed it does not complete). */
  twistMissed: boolean;
  mutationsDiscovered: string[];
  /** A Daily Seed run: the server's score and rank, or why it could not be submitted. */
  daily?:
    | { submitted: true; score: number; best: boolean; rank: number; streak: number }
    | { submitted: false; error: string };
}

export const NO_REWARDS: GameRewards = {
  achievements: [],
  completedNode: null,
  firstCompletion: false,
  twistMissed: false,
  mutationsDiscovered: [],
};

/** Records a finished game: new achievements, drafted mutations, campaign completion. */
export async function recordGame(summary: GameSummary): Promise<GameRewards> {
  const before = await loadProgress();
  const node = summary.context.campaignNode ? campaignNode(summary.context.campaignNode) : null;
  const completes = node ? nodeCompleted(node, summary) : false;
  const earned = earnedAchievements(summary).filter((a) => !before.achievements.includes(a));
  const discovered = summary.mutations.filter((m) => !before.drafted.includes(m));
  await updateProgress((p) =>
    mergeProgress(p, {
      ...p,
      achievements: earned,
      drafted: discovered,
      completedNodes: completes && node ? [node.id] : [],
    }),
  );
  return {
    achievements: earned,
    completedNode: completes && node ? node.id : null,
    firstCompletion: completes && !!node && !before.completedNodes.includes(node.id),
    twistMissed: !!node && summary.outcome === "win" && !completes,
    mutationsDiscovered: discovered,
  };
}

/** Test hook (e2e): marks nodes complete without playing them. */
export function completeNodesForTest(ids: string[]): Promise<Progress> {
  return updateProgress((p) => mergeProgress(p, { ...p, completedNodes: ids }));
}

export const TOTAL_ACHIEVEMENTS = ACHIEVEMENTS.length;
export const TOTAL_NODES = CAMPAIGN.length;

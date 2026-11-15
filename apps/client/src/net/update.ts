import { registerSW } from "virtual:pwa-register";

/**
 * Keeping the installed client current (playtest: phones kept running old builds until their
 * site data was cleared, and an old page broke when its lazy chunks vanished after a deploy).
 *
 * - Checks for a new version at launch, whenever the app comes back to the foreground, and
 *   hourly: an installed PWA is resumed far more often than it is relaunched.
 * - A new version waits rather than reloading under a match. It installs as soon as the player
 *   is on any other screen (`applyUpdateIfIdle`), or at once from Settings.
 * - A page whose lazy chunk fails to load (the chunk is from an older build) reloads once.
 */

/** Build identity, injected by vite.config.ts: the commit and the build date. */
export const BUILD = { commit: __BUILD_COMMIT__, date: __BUILD_DATE__ };

type Listener = () => void;
const listeners = new Set<Listener>();
let pending = false;
let apply: ((reload?: boolean) => Promise<void>) | null = null;
let registration: ServiceWorkerRegistration | undefined;

export const updateReady = () => pending;
export function onUpdateState(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

const HOUR = 60 * 60 * 1000;

export function startUpdates(): void {
  apply = registerSW({
    immediate: true,
    onNeedRefresh() {
      pending = true;
      for (const l of listeners) l();
    },
    onRegisteredSW(_url, r) {
      registration = r;
      if (!r) return;
      setInterval(() => void r.update().catch(() => undefined), HOUR);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void r.update().catch(() => undefined);
      });
    },
  });
}

/** Installs a waiting version unless a match is on screen. Returns whether it reloads. */
export function applyUpdateIfIdle(inMatch: boolean): boolean {
  if (!pending || inMatch || !apply) return false;
  void apply(true);
  return true;
}

/** Settings: look for a new version now. Resolves to what happened. */
export async function checkForUpdate(): Promise<"updating" | "current" | "offline"> {
  if (pending && apply) {
    void apply(true);
    return "updating";
  }
  if (!registration) return "current";
  try {
    await registration.update();
  } catch {
    return "offline";
  }
  // A found update installs, then reports through onNeedRefresh; give it a moment.
  await new Promise((r) => setTimeout(r, 1500));
  if (pending && apply) {
    void apply(true);
    return "updating";
  }
  return "current";
}

const RELOADED_KEY = "swarm-chunk-reload";

/**
 * A lazy chunk failed to load. Offline, the error screen says so and stays. Online, the chunk
 * is from an older build that is gone from the server: reload once to pick up the current one.
 */
export function healStaleChunks(): void {
  window.addEventListener("vite:preloadError", () => {
    void (async () => {
      let last = 0;
      try {
        last = Number(sessionStorage.getItem(RELOADED_KEY) ?? 0);
      } catch {
        // Storage blocked: the once-a-minute guard below still holds within this page.
      }
      // At most once a minute, so a genuinely missing chunk can't loop.
      if (Date.now() - last < 60_000) return;
      try {
        // Reachable server, missing chunk: a stale page. Unreachable: offline, leave the error.
        await fetch(`${import.meta.env.BASE_URL}?probe=${Date.now()}`, {
          method: "HEAD",
          cache: "no-store",
        });
      } catch {
        return;
      }
      try {
        sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
      } catch {
        // ignore
      }
      location.reload();
    })();
  });
}

import { apiUrl } from "./origin";

/**
 * The free Render server sleeps when nobody plays, and the first request after that takes
 * 30–60 s (docs/plans/beta.md, step 2). A refused connection is offline, shown at once; a slow
 * answer or a 502–504 is the server waking: keep trying for up to `maxMs`, reporting the wait.
 */
export type ServerState = "up" | "offline" | "down";

const SLOW_MS = 2500;
const ATTEMPT_MS = 15_000;
const RETRY_MS = 2000;

export async function wakeServer(
  onWaiting: (seconds: number) => void,
  maxMs = 90_000,
): Promise<ServerState> {
  const start = Date.now();
  // Report the wait once the first answer is slow, and every second after.
  let waiting = false;
  const tick = setInterval(() => {
    const ms = Date.now() - start;
    if (ms >= SLOW_MS) waiting = true;
    if (waiting) onWaiting(Math.floor(ms / 1000));
  }, 1000);
  try {
    while (Date.now() - start < maxMs) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), ATTEMPT_MS);
      const t0 = Date.now();
      try {
        const res = await fetch(apiUrl("/health"), { cache: "no-store", signal: ctl.signal });
        if (res.ok) return "up";
        if (![502, 503, 504].includes(res.status)) return "down";
        waiting = true;
      } catch {
        // Refused at once (no network, server gone): offline. Aborted or slow: still waking.
        if (!ctl.signal.aborted && Date.now() - t0 < SLOW_MS && !waiting) return "offline";
        waiting = true;
      } finally {
        clearTimeout(timer);
      }
      await new Promise((r) => setTimeout(r, RETRY_MS));
    }
    return "down";
  } finally {
    clearInterval(tick);
  }
}

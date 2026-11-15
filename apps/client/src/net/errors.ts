import type { ClientErrorReport } from "@swarm/protocol";
import { apiUrl } from "./origin";
import { BUILD } from "./build";

/**
 * Client error reports (docs/plans/beta.md, step 2). A playtester's "it froze" arrives with the
 * error message, the build, the screen and a coarse device class. Nothing personal is sent: no
 * token, no account, no full user agent. Off in development and e2e runs.
 */

let screen = "title";
/** App.tsx keeps this current, so a report says where it happened. */
export function setErrorScreen(name: string): void {
  screen = name;
}

/** "iPhone Safari (app)", "Android Chrome", "Desktop Firefox": enough to reproduce, no more. */
export function deviceClass(ua = navigator.userAgent): string {
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : "Desktop";
  const browser = /SamsungBrowser/.test(ua)
    ? "Samsung Internet"
    : /Firefox|FxiOS/.test(ua)
      ? "Firefox"
      : /Edg\//.test(ua)
        ? "Edge"
        : /Chrome|CriOS/.test(ua)
          ? "Chrome"
          : /Safari/.test(ua)
            ? "Safari"
            : "Other";
  const installed =
    typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches;
  return `${os} ${browser}${installed ? " (app)" : ""}`;
}

/** Most reports per page load, and per device per day. */
const PER_SESSION = 10;
const PER_DAY = 30;
const DAY_KEY = "swarm.errors.v1";
const sent = new Set<string>();

/** Noise that says nothing about the game. */
const IGNORED = [/ResizeObserver loop/, /^Script error\.?$/, /extension:\/\//, /AbortError/];

function underDailyCap(): boolean {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const raw = JSON.parse(localStorage.getItem(DAY_KEY) ?? "{}") as { d?: string; n?: number };
    const n = raw.d === today ? (raw.n ?? 0) : 0;
    if (n >= PER_DAY) return false;
    localStorage.setItem(DAY_KEY, JSON.stringify({ d: today, n: n + 1 }));
    return true;
  } catch {
    return true;
  }
}

export function reportError(err: unknown): void {
  const e = err instanceof Error ? err : new Error(String(err));
  const message = (e.message || String(err)).slice(0, 500);
  if (!message || IGNORED.some((r) => r.test(message))) return;
  if (sent.has(message) || sent.size >= PER_SESSION) return;
  sent.add(message);
  if (!underDailyCap()) return;
  const report: ClientErrorReport = {
    message,
    ...(e.stack ? { stack: e.stack.slice(0, 4000) } : {}),
    build: `${BUILD.commit} · ${BUILD.date}`.slice(0, 40),
    screen: screen.slice(0, 40),
    device: deviceClass().slice(0, 60),
  };
  void fetch(apiUrl("/errors"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(report),
    keepalive: true,
  }).catch(() => undefined);
}

export function installErrorReporting(): void {
  const off = import.meta.env.DEV || new URLSearchParams(location.search).has("e2e");
  if (off) return;
  window.addEventListener("error", (ev) => reportError(ev.error ?? ev.message));
  window.addEventListener("unhandledrejection", (ev) => reportError(ev.reason));
}

/**
 * Where the game server lives, and where the app itself is mounted (deployment, M8+).
 *
 * - Served by the game server (Render, local preview): same origin, app at "/".
 * - Served from GitHub Pages: built with VITE_API_ORIGIN (the server's https origin) and
 *   VITE_BASE ("/Swarm-Bodies/"); the server allows that origin with CORS.
 */
const API_ORIGIN = ((import.meta.env["VITE_API_ORIGIN"] as string | undefined) ?? "").replace(
  /\/$/,
  "",
);

/** The app's base path, always ending in "/". */
export const BASE: string = import.meta.env.BASE_URL;

export function apiUrl(path: string): string {
  return `${API_ORIGIN}/api${path}`;
}

export function wsUrl(): string {
  if (API_ORIGIN) return `${API_ORIGIN.replace(/^http/, "ws")}/ws`;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

/** The current path inside the app ("/replay/…"), with the base path removed. */
export function appPath(): string {
  const p = location.pathname;
  return p.startsWith(BASE) ? `/${p.slice(BASE.length)}` : p;
}

/** An absolute link into the app, for sharing ("replay/abc", "?join=CODE"). */
export function appLink(path: string): string {
  return `${location.origin}${BASE}${path}`;
}

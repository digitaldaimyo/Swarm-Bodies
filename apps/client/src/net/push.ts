import { api } from "./api";

/** Web Push for async turns (SPEC §9.4). The service worker shows the notifications. */

export type PushState = "unsupported" | "off" | "on" | "denied";

export function pushState(): PushState {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  try {
    return localStorage.getItem("swarm.push.v1") === "on" && Notification.permission === "granted"
      ? "on"
      : "off";
  } catch {
    return "off";
  }
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function enablePush(): Promise<PushState> {
  if (pushState() === "unsupported") return "unsupported";
  const { publicKey } = await api.pushKey();
  if (!publicKey) throw new Error("Notifications are not set up on this server.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }));
  await api.pushSubscribe(sub.toJSON());
  try {
    localStorage.setItem("swarm.push.v1", "on");
  } catch {
    // ignore
  }
  return "on";
}

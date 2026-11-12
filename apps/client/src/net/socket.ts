import { parseServerMessage, type ClientMessage, type ServerMessage } from "@swarm/protocol";
import { ensureGuest } from "./api";

type Listener = (msg: ServerMessage) => void;

/**
 * The one WebSocket per client (SPEC §9.4). It says hello with the guest token, re-subscribes
 * to every game after a reconnect (so the server re-sends `gameState`), and backs off while the
 * network is down.
 */
export class GameSocket {
  private ws: WebSocket | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly games = new Set<string>();
  private readonly outbox: ClientMessage[] = [];
  private ready = false;
  private closed = false;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pinger: ReturnType<typeof setInterval> | null = null;
  status: "connecting" | "online" | "offline" = "connecting";
  private readonly statusListeners = new Set<() => void>();

  constructor(private readonly url = defaultUrl()) {
    void this.connect();
  }

  onMessage(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onStatus(fn: () => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  subscribe(gameId: string): void {
    this.games.add(gameId);
    if (this.ready) this.send({ type: "subscribe", gameId });
  }

  unsubscribe(gameId: string): void {
    this.games.delete(gameId);
  }

  /** Sends now, or after the next successful hello. */
  send(msg: ClientMessage): void {
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else this.outbox.push(msg);
  }

  private setStatus(s: GameSocket["status"]) {
    this.status = s;
    for (const fn of this.statusListeners) fn();
  }

  private async connect(): Promise<void> {
    if (this.closed) return;
    this.setStatus("connecting");
    let token: string;
    try {
      token = (await ensureGuest()).token;
    } catch {
      return this.scheduleReconnect();
    }
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "hello",
          authToken: token,
          clientVersion: "m4",
        } satisfies ClientMessage),
      );
    };
    ws.onmessage = (e) => {
      const msg = parseServerMessage(String(e.data));
      if (!msg) return;
      if (msg.type === "welcome") {
        this.ready = true;
        this.retry = 0;
        this.setStatus("online");
        for (const gameId of this.games)
          ws.send(JSON.stringify({ type: "subscribe", gameId } satisfies ClientMessage));
        for (const m of this.outbox.splice(0)) ws.send(JSON.stringify(m));
        this.pinger = setInterval(
          () => ws.readyState === WebSocket.OPEN && ws.send('{"type":"ping"}'),
          25_000,
        );
      }
      for (const fn of this.listeners) fn(msg);
    };
    ws.onclose = () => {
      this.ready = false;
      if (this.pinger) clearInterval(this.pinger);
      if (!this.closed) this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    this.setStatus("offline");
    const delay = Math.min(10_000, 500 * 2 ** this.retry++);
    this.timer = setTimeout(() => void this.connect(), delay);
  }

  /** Test hook: drop the connection as a network blip would. */
  dropConnection(): void {
    this.ws?.close();
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.pinger) clearInterval(this.pinger);
    this.ws?.close();
  }
}

function defaultUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

let shared: GameSocket | null = null;

/** The app's single socket, opened on first use. */
export function gameSocket(): GameSocket {
  shared ??= new GameSocket();
  if (typeof location !== "undefined" && new URLSearchParams(location.search).has("e2e")) {
    (window as unknown as { __swarmSocket?: GameSocket }).__swarmSocket = shared;
  }
  return shared;
}

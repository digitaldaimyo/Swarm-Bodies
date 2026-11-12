import { useEffect, useRef, useState } from "preact/hooks";
import {
  ASYNC_TIMERS,
  LIVE_TIMERS,
  type GameSettings,
  type GameSummary,
  type Strain,
} from "@swarm/protocol";
import { audio } from "../audio/sfx";
import { api, ApiError, ensureGuest } from "../net/api";
import { gameSocket } from "../net/socket";
import { enablePush, pushState } from "../net/push";
import { loadStrain, storeStrain, StrainPicker } from "./StrainPicker";

interface Props {
  onBack(): void;
  onOpen(gameId: string): void;
}

const timerLabel = (s: number) => (s >= 3600 ? `${s / 3600} h` : `${s} s`);

/** Online play (SPEC §10.1 screen 2): your games, create, join by code, quick match. */
export function Online({ onBack, onOpen }: Props) {
  const [name, setName] = useState<string>("");
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [strain, setStrain] = useState<Strain>(loadStrain);
  const [pace, setPace] = useState<GameSettings["pace"]>("live");
  const [timer, setTimer] = useState<number>(60);
  const [players, setPlayers] = useState(2);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const [status, setStatus] = useState(gameSocket().status);
  const [push, setPush] = useState(pushState());
  const queueTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = () =>
    api
      .listGames()
      .then(setGames)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : String(e)));

  useEffect(() => {
    void ensureGuest()
      .then((g) => setName(g.name))
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : String(e)));
    void refresh();
    const socket = gameSocket();
    const off = socket.onStatus(() => setStatus(socket.status));
    const id = setInterval(() => void refresh(), 10_000);
    return () => {
      off();
      clearInterval(id);
      if (queueTimer.current) clearInterval(queueTimer.current);
    };
  }, []);

  const run = async (fn: () => Promise<void>) => {
    audio.click();
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickStrain = (s: Strain) => {
    setStrain(s);
    storeStrain(s);
  };

  const create = () =>
    run(async () => {
      const { gameId } = await api.createGame(
        { pace, turnSeconds: timer, map: "system", players },
        strain,
      );
      onOpen(gameId);
    });

  const join = () =>
    run(async () => {
      const { gameId } = await api.joinGame(code, strain);
      onOpen(gameId);
    });

  const quickMatch = () =>
    run(async () => {
      const r = await api.queue(pace, strain);
      if (r.status === "matched" && r.gameId) return onOpen(r.gameId);
      setQueued(true);
      queueTimer.current = setInterval(() => {
        void api.queue(pace, strain).then((q) => {
          if (q.status === "matched" && q.gameId) {
            if (queueTimer.current) clearInterval(queueTimer.current);
            setQueued(false);
            onOpen(q.gameId);
          }
        });
      }, 2000);
    });

  const cancelQueue = () => {
    if (queueTimer.current) clearInterval(queueTimer.current);
    setQueued(false);
    void api.leaveQueue().catch(() => undefined);
  };

  return (
    <main class="panel-screen">
      <header class="screen-header">
        <button class="btn btn-icon" onClick={onBack} aria-label="Back">
          ←
        </button>
        <h2>Online</h2>
        <span class={`net-status ${status}`} role="status">
          {status === "online"
            ? name || "Online"
            : status === "connecting"
              ? "Connecting…"
              : "Offline"}
        </span>
      </header>
      {error && (
        <p class="error-line" role="alert">
          {error}
        </p>
      )}

      <section class="card">
        <h3>Your games</h3>
        {games === null ? (
          <p class="muted">Loading…</p>
        ) : games.length === 0 ? (
          <p class="muted">No games yet. Create one and share the code, or find a quick match.</p>
        ) : (
          <ul class="game-list">
            {games.map((g) => (
              <li key={g.gameId}>
                <button class="game-row" onClick={() => onOpen(g.gameId)}>
                  <span>
                    <strong>
                      {g.opponents.length
                        ? `vs ${g.opponents.join(", ")}`
                        : "Waiting for an opponent"}
                    </strong>
                    <small class="muted">
                      {g.status === "lobby"
                        ? `Lobby · code ${g.code}`
                        : `Turn ${g.turn} · ${g.pace}`}
                    </small>
                  </span>
                  {g.yourTurn && <span class="your-turn">Your turn</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section class="card">
        <h3>Your strain</h3>
        <StrainPicker value={strain} onChange={pickStrain} />
      </section>

      <section class="card">
        <h3>New game</h3>
        <div class="segmented" role="radiogroup" aria-label="Pace">
          {(["live", "async"] as const).map((p) => (
            <button
              key={p}
              role="radio"
              aria-checked={pace === p}
              class={pace === p ? "seg active" : "seg"}
              onClick={() => {
                setPace(p);
                setTimer(p === "live" ? 60 : 24 * 3600);
              }}
            >
              {p === "live" ? "Live" : "Async"}
            </button>
          ))}
        </div>
        <div class="segmented" role="radiogroup" aria-label="Turn timer">
          {(pace === "live" ? LIVE_TIMERS : ASYNC_TIMERS).map((t) => (
            <button
              key={t}
              role="radio"
              aria-checked={timer === t}
              class={timer === t ? "seg active" : "seg"}
              onClick={() => setTimer(t)}
            >
              {timerLabel(t)}
            </button>
          ))}
        </div>
        <div class="segmented" role="radiogroup" aria-label="Players (new game)">
          {[2, 3, 4].map((n) => (
            <button
              key={n}
              role="radio"
              aria-checked={players === n}
              class={players === n ? "seg active" : "seg"}
              onClick={() => setPlayers(n)}
            >
              {n} players
            </button>
          ))}
        </div>
        <p class="hint">Create game uses this; quick match is always 2 players.</p>
        <div class="button-row">
          <button class="btn btn-primary" disabled={busy || queued} onClick={() => void create()}>
            Create game
          </button>
          {queued ? (
            <button class="btn" onClick={cancelQueue}>
              Searching… cancel
            </button>
          ) : (
            <button class="btn" disabled={busy} onClick={() => void quickMatch()}>
              Quick match
            </button>
          )}
        </div>
      </section>

      <section class="card">
        <h3>Join with a code</h3>
        <form
          class="join-row"
          onSubmit={(e) => {
            e.preventDefault();
            void join();
          }}
        >
          <input
            aria-label="Invite code"
            value={code}
            maxLength={6}
            placeholder="ABC123"
            autocapitalize="characters"
            autocomplete="off"
            spellcheck={false}
            onInput={(e) => setCode((e.target as HTMLInputElement).value.toUpperCase())}
          />
          <button class="btn btn-primary" disabled={busy || code.trim().length !== 6} type="submit">
            Join
          </button>
        </form>
      </section>

      {push !== "unsupported" && (
        <section class="card">
          <h3>Async turn alerts</h3>
          <p class="hint">
            Get a notification when an async turn starts, and an hour before it ends.
          </p>
          <button
            class="btn"
            disabled={push === "on" || push === "denied"}
            onClick={() =>
              void run(async () => {
                setPush(await enablePush());
              })
            }
          >
            {push === "on"
              ? "Notifications on"
              : push === "denied"
                ? "Blocked in browser settings"
                : "Turn on notifications"}
          </button>
        </section>
      )}
    </main>
  );
}

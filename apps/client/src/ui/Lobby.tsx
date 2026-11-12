import { useEffect, useState } from "preact/hooks";
import { strainInfo } from "@swarm/content";
import type { GameMeta, Strain } from "@swarm/protocol";
import type { GameState } from "@swarm/sim";
import { audio } from "../audio/sfx";
import { api, ApiError } from "../net/api";
import { gameSocket } from "../net/socket";
import { PLAYER_CSS } from "../render/palette";
import { StrainPicker } from "./StrainPicker";

interface Props {
  meta: GameMeta;
  onBack(): void;
  onStarted(meta: GameMeta, state: GameState): void;
}

/** Lobby (SPEC §10.1 screen 3): invite code, share, players, strain picks, start. */
export function Lobby({ meta: initial, onBack, onStarted }: Props) {
  const [meta, setMeta] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const socket = gameSocket();
    const off = socket.onMessage((m) => {
      if (m.type === "lobby" && m.meta.gameId === meta.gameId) setMeta(m.meta);
      // Presence changes arrive as playerStatus, not as a new lobby snapshot.
      if (m.type === "playerStatus" && m.gameId === meta.gameId) {
        setMeta((prev) => ({
          ...prev,
          players: prev.players.map((p) =>
            p.seat === m.seat ? { ...p, connected: m.connected } : p,
          ),
        }));
      }
      if (m.type === "gameState" && m.meta.gameId === meta.gameId && m.state)
        onStarted(m.meta, m.state);
    });
    socket.subscribe(meta.gameId);
    return off;
  }, [meta.gameId]);

  const me = meta.players.find((p) => p.you);
  const host = me?.seat === meta.hostSeat;
  const full = meta.players.length >= meta.settings.players;
  const link = `${location.origin}/?join=${meta.code}`;

  const share = async () => {
    audio.click();
    const text = `Join my Swarm Bodies game with code ${meta.code}`;
    try {
      if (navigator.share) await navigator.share({ title: "Swarm Bodies", text, url: link });
      else {
        await navigator.clipboard.writeText(`${text}: ${link}`);
        setCopied(true);
      }
    } catch {
      // Share sheet dismissed.
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <main class="panel-screen">
      <header class="screen-header">
        <button class="btn btn-icon" onClick={onBack} aria-label="Back">
          ←
        </button>
        <h2>Lobby</h2>
      </header>
      <section class="card code-card">
        <span class="muted">Invite code</span>
        <span class="invite-code" aria-label={`Invite code ${meta.code.split("").join(" ")}`}>
          {meta.code}
        </span>
        <button class="btn" onClick={() => void share()}>
          {copied ? "Link copied" : "Share invite"}
        </button>
        <span class="muted small">
          {meta.settings.pace === "live"
            ? `Live · ${meta.settings.turnSeconds} s turns`
            : `Async · ${meta.settings.turnSeconds / 3600} h turns`}{" "}
          ·{" "}
          {meta.settings.map === "system"
            ? `System, ${meta.settings.players} players`
            : "Single Rock"}
        </span>
      </section>
      {error && (
        <p class="error-line" role="alert">
          {error}
        </p>
      )}
      <section class="card">
        <h3>Players</h3>
        <ul class="player-list">
          {meta.players.map((p) => (
            <li key={p.seat}>
              <span class="swatch" style={{ background: PLAYER_CSS[p.seat % PLAYER_CSS.length] }} />
              <span>
                <strong>
                  {p.name}
                  {p.you ? " (you)" : ""}
                </strong>
                <small class="muted">
                  {strainInfo(p.strain).name}
                  {p.seat === meta.hostSeat ? " · host" : ""}
                  {p.connected ? "" : " · away"}
                </small>
              </span>
            </li>
          ))}
          {!full && <li class="muted">Waiting for an opponent…</li>}
        </ul>
      </section>
      {me && (
        <section class="card">
          <h3>Your strain</h3>
          <StrainPicker
            value={me.strain}
            onChange={(s: Strain) => void act(() => api.setStrain(meta.gameId, s))}
          />
        </section>
      )}
      {host ? (
        <button
          class="btn btn-primary btn-wide"
          disabled={!full}
          onClick={() => void act(() => api.startGame(meta.gameId))}
        >
          {full ? "Start game" : "Waiting for players"}
        </button>
      ) : (
        <p class="muted center">The host starts the game.</p>
      )}
    </main>
  );
}

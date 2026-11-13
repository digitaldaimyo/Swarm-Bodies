import { useEffect, useRef, useState } from "preact/hooks";
import type { GameState, PlayerId } from "@swarm/sim";
import type { TurnRecord } from "../game/match-session";
import { buildTimeline } from "../game/timeline";
import { MatchView } from "../render/view";
import { getSettings } from "./settings";
import { BodyStrip } from "./SystemHud";

/**
 * Watch a whole match turn by turn (SPEC §10.1 results → "watch replay", and shared replays at
 * /replay/:id or from a file, SPEC §12). A scrubber jumps to any turn, and the body strip
 * switches between asteroids and the System view (playtest feedback).
 */
export default function ReplayViewer({
  history,
  title,
  me = -1,
  onClose,
}: {
  history: readonly TurnRecord[];
  title?: string | undefined;
  /** The viewer's seat, for "yours" on the body strip; -1 for someone else's game. */
  me?: PlayerId;
  onClose(): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<MatchView | null>(null);
  /** The turn playing (0-based index into history); history.length means "the end". */
  const [cursor, setCursor] = useState(0);
  const [paused, setPaused] = useState(false);
  const [shownState, setShownState] = useState<GameState | null>(history[0]?.before ?? null);
  const [body, setBody] = useState(() => homeBody(history[0]?.before, me));
  const [system, setSystem] = useState(false);
  // The player loop reads these refs; the UI writes them. `jump` restarts at a turn.
  const ctl = useRef({ paused: false, skipped: false, closed: false });
  const jump = useRef<number | null>(null);
  const wake = useRef<(() => void) | null>(null);
  const n = history.length;
  const first = history[0]?.before;
  const multi = !!first && first.bodies.filter((b) => b.orbit).length > 1;

  /** Restart at turn index `i` (on the current body); playing continues unless paused. */
  const seek = (i: number) => {
    jump.current = Math.max(0, Math.min(n, i));
    ctl.current.skipped = true;
    wake.current?.();
  };

  useEffect(() => {
    const el = host.current;
    if (!el || !first) return;
    let v: MatchView | null = null;
    void MatchView.create(el, first, {
      canPaintFrom: () => false,
      passable: () => false,
      reach: 0,
      onPaintStart: () => undefined,
      onPaintChange: () => undefined,
      onPaintEnd: () => undefined,
      onTap: () => undefined,
    }).then(async (created) => {
      v = created;
      view.current = created;
      if (ctl.current.closed) return created.destroy();
      created.setInputEnabled(false);
      created.setPatterns(getSettings().patterns);
      created.reduceMotion = getSettings().reduceMotion;
      created.calm = getSettings().colonyDetail === "calm";
      if (me >= 0) created.setViewer(me);
      created.showBody(body);
      created.showWholeBody();
      let i = 0;
      while (!ctl.current.closed) {
        if (jump.current !== null) {
          i = jump.current;
          jump.current = null;
        }
        ctl.current.skipped = false;
        setCursor(i);
        if (i >= n) {
          // The end: the final position, until the scrubber or a button moves.
          const last = history[n - 1] as TurnRecord;
          created.setState(last.after);
          setShownState(last.after);
          await new Promise<void>((resolve) => (wake.current = resolve));
          wake.current = null;
          continue;
        }
        const h = history[i] as TurnRecord;
        created.setState(h.before);
        setShownState(h.before);
        await created.playTimeline(buildTimeline(h.before, h.after, h.events, h.orders), {
          speed: () => 2 * getSettings().replaySpeed,
          paused: () => ctl.current.paused,
          skipped: () => ctl.current.skipped || ctl.current.closed,
          reduceMotion: getSettings().reduceMotion,
        });
        if (jump.current === null) i++;
      }
    });
    return () => {
      ctl.current.closed = true;
      wake.current?.();
      v?.destroy();
      view.current = null;
    };
  }, [history]);

  const pick = (id: number) => {
    setBody(id);
    setSystem(false);
    view.current?.showBody(id);
    // Replay the current turn on the newly chosen body.
    seek(Math.min(cursor, n - 1));
  };
  const toggleSystem = () => {
    const on = !system;
    setSystem(on);
    view.current?.setMode(on ? "system" : "body");
  };
  const togglePause = () => {
    ctl.current.paused = !ctl.current.paused;
    setPaused(ctl.current.paused);
    // Pressing play at the end starts over.
    if (!ctl.current.paused && cursor >= n) seek(0);
  };

  return (
    <main
      class={multi ? "match replay-viewer has-strip" : "match replay-viewer"}
      data-turns={n}
      data-turn={Math.min(cursor + 1, n)}
    >
      <div class="viewport" ref={host} />
      <header class="hud-top">
        <div class="hud-stats">
          <span class="stat">
            <span class="stat-label">turn</span>
            <span class="num">
              {Math.min(cursor + 1, n)}/{n}
            </span>
          </span>
          {title && <span class="replay-title">{title}</span>}
        </div>
        <button
          class="btn btn-icon menu-btn"
          aria-label="Close replay"
          title="Close replay"
          onClick={onClose}
        >
          ✕
        </button>
      </header>
      <div class="replay-bar" role="group" aria-label="Replay controls">
        <button
          class="btn btn-icon"
          aria-label="Previous turn"
          title="Previous turn"
          disabled={cursor <= 0}
          onClick={() => seek(cursor - 1)}
        >
          ⏮
        </button>
        <button
          class="btn btn-icon"
          aria-label={paused ? "Play" : "Pause"}
          title={paused ? "Play" : "Pause"}
          onClick={togglePause}
        >
          {paused ? "▶" : "❚❚"}
        </button>
        <button
          class="btn btn-icon"
          aria-label="Next turn"
          title="Next turn"
          disabled={cursor >= n}
          onClick={() => seek(cursor + 1)}
        >
          ⏭
        </button>
        <input
          class="replay-scrubber"
          type="range"
          min={1}
          max={n + 1}
          value={Math.min(cursor + 1, n + 1)}
          aria-label="Turn"
          aria-valuetext={cursor >= n ? "End of game" : `Turn ${cursor + 1} of ${n}`}
          onInput={(e) => seek(Number((e.target as HTMLInputElement).value) - 1)}
        />
      </div>
      {multi && shownState && (
        <BodyStrip
          state={shownState}
          me={me}
          shown={body}
          system={system}
          alerts={new Set()}
          onPick={pick}
          onSystem={toggleSystem}
        />
      )}
    </main>
  );
}

/** The body a replay opens on: the viewer's home, else the first body with a colony. */
function homeBody(state: GameState | undefined, me: PlayerId): number {
  if (!state) return 0;
  const mine = state.players.find((p) => p.id === me)?.home?.body;
  if (mine !== undefined) return mine;
  return state.bodies.find((b) => b.colony.some((c) => c))?.id ?? 0;
}

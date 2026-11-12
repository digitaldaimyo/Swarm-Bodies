import { useEffect, useRef, useState } from "preact/hooks";
import type { TurnRecord } from "../game/match-session";
import { buildTimeline } from "../game/timeline";
import { MatchView } from "../render/view";
import { getSettings } from "./settings";

/**
 * Watch a whole match turn by turn (SPEC §10.1 results → "watch replay", and shared replays at
 * /replay/:id or from a file, SPEC §12).
 */
export default function ReplayViewer({
  history,
  title,
  onClose,
}: {
  history: readonly TurnRecord[];
  title?: string | undefined;
  onClose(): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [turn, setTurn] = useState(0);
  const ctl = useRef({ paused: false, skipped: false, closed: false });
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const el = host.current;
    const first = history[0];
    if (!el || !first) return;
    let view: MatchView | null = null;
    void MatchView.create(el, first.before, {
      canPaintFrom: () => false,
      passable: () => false,
      reach: 0,
      onPaintStart: () => undefined,
      onPaintChange: () => undefined,
      onPaintEnd: () => undefined,
      onTap: () => undefined,
    }).then(async (v) => {
      view = v;
      if (ctl.current.closed) return v.destroy();
      v.setInputEnabled(false);
      v.showWholeBody();
      for (const [i, h] of history.entries()) {
        if (ctl.current.closed) return;
        setTurn(i + 1);
        v.setState(h.before);
        await v.playTimeline(buildTimeline(h.before, h.after, h.events, h.orders), {
          speed: () => 2 * getSettings().replaySpeed,
          paused: () => ctl.current.paused,
          skipped: () => ctl.current.skipped || ctl.current.closed,
          reduceMotion: getSettings().reduceMotion,
        });
        ctl.current.skipped = false;
      }
    });
    return () => {
      ctl.current.closed = true;
      view?.destroy();
    };
  }, [history]);

  return (
    <main class="match replay-viewer" data-turns={history.length} data-turn={turn}>
      <div class="viewport" ref={host} />
      <header class="hud-top">
        <div class="hud-stats">
          <span class="stat">
            <span class="stat-label">turn</span>
            <span class="num">
              {turn}/{history.length}
            </span>
          </span>
          {title && <span class="replay-title">{title}</span>}
        </div>
        <button class="btn btn-icon menu-btn" aria-label="Close replay" onClick={onClose}>
          ✕
        </button>
      </header>
      <div class="replay-controls">
        <button
          class="btn btn-icon"
          aria-label={paused ? "Play" : "Pause"}
          onClick={() => {
            ctl.current.paused = !ctl.current.paused;
            setPaused(ctl.current.paused);
          }}
        >
          {paused ? "▶" : "❚❚"}
        </button>
        <button
          class="btn btn-icon"
          aria-label="Next turn"
          onClick={() => (ctl.current.skipped = true)}
        >
          ⏭
        </button>
      </div>
    </main>
  );
}

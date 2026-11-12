import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { getBoard, playerRules, type Hex, type Order } from "@swarm/sim";
import { audio } from "../audio/sfx";
import type { Point } from "../game/layout";
import { previewPath } from "../game/planner";
import { BOT, HUMAN, type SkirmishSession } from "../game/session";
import { buildTimeline, describeEvents, type Frame, type LogEntry } from "../game/timeline";
import { MatchView } from "../render/view";
import { PLAYER_CSS } from "../render/palette";
import { OrderDrawer } from "./OrderDrawer";
import { RadialMenu } from "./RadialMenu";
import { getSettings, haptic, updateSettings, useSettings } from "./settings";
import { saveSkirmish } from "./storage";

interface Props {
  session: SkirmishSession;
  onExit(): void;
  onFinished(): void;
}

type Phase = "planning" | "waiting" | "replay";

const NAMES = ["You", "Bot"];

/** Test hook for the Playwright smoke test (enabled with ?e2e in the URL). */
declare global {
  interface Window {
    __swarm?: {
      autoplay: boolean;
      phase: Phase;
      turn: number;
      finished: boolean;
      view?: MatchView;
    };
  }
}
const e2e = typeof location !== "undefined" && new URLSearchParams(location.search).has("e2e");

export default function Match({ session, onExit, onFinished }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<MatchView | null>(null);
  const [, force] = useState(0);
  const rerender = useCallback(() => force((n) => n + 1), []);
  const [phase, setPhaseState] = useState<Phase>("planning");
  const phaseRef = useRef<Phase>("planning");
  const [radial, setRadial] = useState<{ cell: Hex; at: Point } | null>(null);
  const [info, setInfo] = useState<{ text: string; at: Point } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [paused, setPaused] = useState(false);
  const settings = useSettings();
  const ctl = useRef({ paused: false, skipped: false });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setPhase = (p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
    if (window.__swarm) window.__swarm.phase = p;
  };
  const flash = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };

  const body = () => session.state.bodies[0] as (typeof session.state.bodies)[number];
  const cellOf = (h: Hex) => body().colony[getBoard(body().radius).indexOf(h.q, h.r)] ?? null;

  const refreshPlan = useCallback(() => {
    const { planner } = session;
    const previews = planner.orders.map((o) =>
      o.type === "grow" ? previewPath(session.state, HUMAN, o.body, o.path) : [],
    );
    view.current?.setPlan(planner.orders, HUMAN, previews);
    saveSkirmish(session.save());
    rerender();
  }, [session, rerender]);

  const addOrder = (o: Order): boolean => {
    const r = session.planner.add(o);
    if (!r.ok) {
      flash(r.message);
      audio.thud();
      return false;
    }
    audio.click();
    refreshPlan();
    return true;
  };

  // Mount the Pixi view.
  useEffect(() => {
    let disposed = false;
    const el = host.current;
    if (!el) return;
    void MatchView.create(el, session.state, {
      canPaintFrom: (h) =>
        phaseRef.current === "planning" &&
        !!cellOf(h) &&
        cellOf(h)?.owner === HUMAN &&
        !!cellOf(h)?.connected,
      passable: (h) => {
        const b = body();
        const i = getBoard(b.radius).indexOf(h.q, h.r);
        return i >= 0 && b.terrain[i] !== "rock";
      },
      reach: playerRules(session.state, HUMAN).growReach,
      onPaintStart: () => {
        setRadial(null);
        setInfo(null);
        haptic("tick");
      },
      onPaintChange: (path, added) => {
        const order: Order = { type: "grow", body: 0, path };
        const check = session.planner.check(order);
        view.current?.setPaint({
          path,
          preview: previewPath(session.state, HUMAN, 0, path),
          valid: check.ok,
          cost: check.ok ? check.cost : 0,
          player: HUMAN,
        });
        if (added > 0) {
          haptic("tick");
          audio.tick();
        }
      },
      onPaintEnd: (path) => {
        view.current?.setPaint(null);
        if (path) {
          if (addOrder({ type: "grow", body: 0, path })) audio.squelch();
        }
      },
      onTap: (h, at) => {
        setInfo(null);
        if (!h || phaseRef.current !== "planning") {
          setRadial(null);
          return;
        }
        const c = cellOf(h);
        if (c?.owner === HUMAN) {
          audio.click();
          setRadial({ cell: h, at });
        } else {
          setRadial(null);
          setInfo({ text: describeCell(h), at });
        }
      },
      onCamera: () => setRadial(null),
    }).then((v) => {
      if (disposed) {
        v.destroy();
        return;
      }
      view.current = v;
      v.reduceMotion = getSettings().reduceMotion;
      if (window.__swarm) window.__swarm.view = v;
      refreshPlan();
    });
    return () => {
      disposed = true;
      view.current?.destroy();
      view.current = null;
    };
  }, [session]);

  useEffect(() => {
    if (view.current) view.current.reduceMotion = settings.reduceMotion;
  }, [settings.reduceMotion]);

  useEffect(() => session.onChange(rerender), [session, rerender]);

  useEffect(() => {
    audio.setPad(true, (session.state.turn - 1) / session.state.rules.turnLimit);
    return () => audio.setPad(false);
  }, [session.state.turn]);

  const describeCell = (h: Hex): string => {
    const b = body();
    const i = getBoard(b.radius).indexOf(h.q, h.r);
    const c = b.colony[i];
    const d = b.deposits[i];
    const deposit = d ? ` · ${d} deposit (+${session.state.rules.depositYield[d]} N)` : "";
    if (b.terrain[i] === "rock") return "Rock: impassable";
    if (!c) return `Empty regolith${deposit}`;
    const who = c.owner === HUMAN ? "Your" : "Enemy";
    return `${who} ${c.core ? "core" : "cell"} · biomass ${c.biomass}${c.connected ? "" : " · cut off"}${deposit}`;
  };

  const submit = useCallback(async () => {
    if (phaseRef.current !== "planning" || session.finished) return;
    setRadial(null);
    setInfo(null);
    setDrawer(false);
    haptic("submit");
    audio.click();
    view.current?.setInputEnabled(false);
    setPhase("waiting");
    const record = await session.submit();
    saveSkirmish(session.finished ? null : session.save());
    const frames = buildTimeline(record.before, record.after, record.events, record.orders);
    setLog(describeEvents(record.events, HUMAN, (p) => NAMES[p] ?? `Player ${p}`));
    setPhase("replay");
    setShowLog(true);
    ctl.current = { paused: false, skipped: window.__swarm?.autoplay ?? false };
    setPaused(false);
    view.current?.setPlan([], HUMAN, []);
    await view.current?.playTimeline(
      frames,
      {
        speed: () => getSettings().replaySpeed,
        paused: () => ctl.current.paused,
        skipped: () => ctl.current.skipped,
        reduceMotion: getSettings().reduceMotion,
      },
      frameSound,
    );
    view.current?.setState(session.state);
    view.current?.setInputEnabled(true);
    if (session.finished) {
      setTimeout(onFinished, window.__swarm?.autoplay ? 0 : 900);
      return;
    }
    setPhase("planning");
    if (!window.__swarm?.autoplay) setTimeout(() => setShowLog(false), 2600);
    refreshPlan();
  }, [session, onFinished, refreshPlan]);

  // Keyboard extras (SPEC §10.3).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "Escape") {
        view.current?.cancelPaint();
        setRadial(null);
        setInfo(null);
        setDrawer(false);
      } else if ((e.key === "z" || e.key === "Z") && phaseRef.current === "planning") {
        session.planner.undo();
        refreshPlan();
      } else if (e.key === "Enter" && phaseRef.current === "planning") {
        void submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit, session, refreshPlan]);

  // In e2e mode, notice the autoplay flag flipping even when nothing else re-renders.
  useEffect(() => {
    if (!e2e) return;
    const id = setInterval(() => {
      if (window.__swarm?.autoplay && phaseRef.current === "planning") rerender();
    }, 200);
    return () => clearInterval(id);
  }, [rerender]);

  // Accelerated scripted player for the smoke test.
  useEffect(() => {
    if (!e2e) return;
    window.__swarm = window.__swarm ?? {
      autoplay: false,
      phase: "planning",
      turn: 0,
      finished: false,
    };
    window.__swarm.turn = session.state.turn;
    window.__swarm.finished = session.finished;
    if (!window.__swarm.autoplay || phase !== "planning" || !view.current) return;
    let cancelled = false;
    void import("@swarm/bot").then(({ chooseOrders }) => {
      if (cancelled || phaseRef.current !== "planning") return;
      session.planner.clear();
      for (const o of chooseOrders(session.state, HUMAN, "normal", "e2e")) session.planner.add(o);
      refreshPlan();
      void submit();
    });
    return () => {
      cancelled = true;
    };
  });

  const { planner, state } = session;
  const me = state.players[HUMAN];
  const cost = planner.plannedCost;
  const over = cost > planner.banked;
  const lastStats = session.stats[session.stats.length - 1];
  const dom0 = (lastStats?.dominance[0] ?? 0) / 10;
  const dom1 = (lastStats?.dominance[1] ?? 0) / 10;

  return (
    <main class="match" data-phase={phase}>
      <div class="viewport" ref={host} />

      <header class="hud-top">
        <div class="hud-stats" aria-label="Nutrients">
          <span class="stat" title="Nutrients banked">
            <span class="stat-label">N</span>
            <span class="num">{me?.nutrients ?? 0}</span>
          </span>
          <span class={over ? "stat planned over" : "stat planned"} title="Planned cost">
            <span class="stat-label">plan</span>
            <span class="num">−{cost}</span>
          </span>
          <span class="stat income" title="Projected income per turn">
            <span class="stat-label">income</span>
            <span class="num">+{planner.projectedIncome}</span>
          </span>
        </div>
        <div class="hud-turn">
          <TurnRing turn={state.turn} limit={state.rules.turnLimit} />
          <div class="ready" aria-label="Players">
            <span
              class={`ready-dot ${phase === "planning" ? "" : "on"}`}
              style={{ "--c": PLAYER_CSS[HUMAN] }}
              title="You"
            />
            <span
              class={`ready-dot ${session.botReady ? "on" : "thinking"}`}
              style={{ "--c": PLAYER_CSS[BOT] }}
              title={session.botReady ? "Bot is ready" : "Bot is thinking"}
            />
          </div>
        </div>
        <button class="btn btn-icon menu-btn" aria-label="Leave match" onClick={onExit}>
          ✕
        </button>
        <div class="dominance" aria-label={`Dominance: you ${dom0}%, bot ${dom1}%`}>
          <span style={{ width: `${dom0}%`, background: PLAYER_CSS[0] }} />
          <span class="dom-goal" />
          <span style={{ width: `${dom1}%`, background: PLAYER_CSS[1] }} />
        </div>
      </header>

      {radial && phase === "planning" && (
        <RadialMenu
          session={session}
          cell={radial.cell}
          at={radial.at}
          onAdd={(o) => {
            if (addOrder(o)) setRadial(null);
          }}
          onRemove={(i) => {
            planner.remove(i);
            refreshPlan();
            setRadial(null);
          }}
          onClose={() => setRadial(null)}
        />
      )}
      {info && (
        <div
          class="cell-info"
          style={{ left: `${info.at.x}px`, top: `${info.at.y}px` }}
          role="status"
        >
          {info.text}
        </div>
      )}
      {toast && (
        <div class="toast" role="alert">
          {toast}
        </div>
      )}

      {phase === "replay" && (
        <div class="replay-controls" aria-label="Replay controls">
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
            aria-label="Replay speed"
            onClick={() => updateSettings({ replaySpeed: settings.replaySpeed === 1 ? 2 : 1 })}
          >
            {settings.replaySpeed}×
          </button>
          <button
            class="btn btn-icon"
            aria-label="Skip replay"
            onClick={() => (ctl.current.skipped = true)}
          >
            ⏭
          </button>
        </div>
      )}
      {phase === "waiting" && (
        <div class="waiting" role="status">
          {session.botReady ? "Resolving…" : "Waiting for 1 player…"}
        </div>
      )}

      {showLog && log.length > 0 && (
        <aside class="event-log" aria-label="What happened">
          <div class="event-log-head">
            <strong>Turn {state.turn - 1}</strong>
            <button class="link" onClick={() => setShowLog(false)} aria-label="Hide log">
              hide
            </button>
          </div>
          <ul>
            {log.slice(0, 8).map((l, i) => (
              <li key={i} class={l.important ? "important" : ""}>
                <button
                  class="link"
                  disabled={!l.cell}
                  onClick={() => l.cell && view.current?.centerOn(l.cell)}
                >
                  {l.text}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}

      <OrderDrawer
        open={drawer}
        orders={planner.orders}
        session={session}
        onToggle={() => setDrawer((d) => !d)}
        onFocus={(h) => view.current?.centerOn(h)}
        onRemove={(i) => {
          planner.remove(i);
          refreshPlan();
        }}
      />

      <footer class="hud-bottom">
        <button
          class="btn btn-pill"
          onClick={() => setDrawer((d) => !d)}
          aria-expanded={drawer}
          aria-label="Orders"
        >
          Orders <span class="badge">{planner.orders.length}</span>
        </button>
        <button
          class="btn btn-icon"
          aria-label="Undo last order"
          disabled={planner.orders.length === 0 || phase !== "planning"}
          onClick={() => {
            planner.undo();
            refreshPlan();
          }}
        >
          ↶
        </button>
        <button
          class="btn btn-icon"
          aria-label="Whole body"
          onClick={() => view.current?.showWholeBody()}
        >
          ⤢
        </button>
        {!showLog && log.length > 0 && phase === "planning" && (
          <button
            class="btn btn-icon"
            aria-label="What happened last turn"
            onClick={() => setShowLog(true)}
          >
            ☰
          </button>
        )}
        <button
          class="btn btn-submit"
          disabled={phase !== "planning" || over}
          onClick={() => void submit()}
        >
          {phase === "planning" ? "Submit" : phase === "waiting" ? "Waiting" : "Replaying"}
        </button>
      </footer>
    </main>
  );
}

function frameSound(f: Frame): void {
  if (f.phase !== "growth") return;
  const kinds = new Set(f.effects.map((e) => (e.kind === "tendril" ? e.outcome : e.kind)));
  setTimeout(() => {
    if (kinds.has("capture") || kinds.has("coreLost")) audio.crunch();
    else if (kinds.has("claim")) audio.squelch();
    if (kinds.has("repelled") || kinds.has("splash")) audio.thud();
  }, 380);
}

function TurnRing({ turn, limit }: { turn: number; limit: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const p = Math.min(1, (turn - 1) / limit);
  return (
    <div class="turn-ring" aria-label={`Turn ${turn} of ${limit}`}>
      <svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true">
        <circle cx="22" cy="22" r={r} class="ring-bg" />
        <circle
          cx="22"
          cy="22"
          r={r}
          class="ring-fg"
          stroke-dasharray={`${c * p} ${c}`}
          transform="rotate(-90 22 22)"
        />
      </svg>
      <span class="num">{turn}</span>
    </div>
  );
}

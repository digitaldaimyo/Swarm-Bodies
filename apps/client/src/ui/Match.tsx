import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  getBoard,
  hashState,
  playerRules,
  type GameState,
  type Hex,
  type MutationId,
  type Order,
} from "@swarm/sim";
import { audio } from "../audio/sfx";
import type { Point } from "../game/layout";
import type { MatchSession, SeatStatus, TurnRecord } from "../game/match-session";
import { previewPath } from "../game/planner";
import {
  buildTimeline,
  describeEvents,
  framesFor,
  replayBodies,
  type Frame,
  type LogEntry,
} from "../game/timeline";
import { MatchView } from "../render/view";
import { BodyStrip, ForecastStrip } from "./SystemHud";
import { DraftModal, MutationGlyphs } from "./DraftModal";
import { playerCss, setLocalCosmetics } from "../render/palette";
import { localCosmetics } from "./Cosmetics";
import { OrderDrawer } from "./OrderDrawer";
import { RadialMenu } from "./RadialMenu";
import { getSettings, haptic, updateSettings, useSettings } from "./settings";
import { tutorialReady, type TutorialStep } from "@swarm/content";

interface Props {
  session: MatchSession;
  /** Called after every change worth persisting (skirmish save). */
  onSave?: (() => void) | undefined;
  onExit(): void;
  onFinished(): void;
  /** Scripted tutorial steps (campaign nodes 1–3, SPEC §11.1). */
  tutorial?: readonly TutorialStep[] | undefined;
}

type Phase = "planning" | "waiting" | "replay";

/** Test hook for the Playwright tests (enabled with ?e2e in the URL). */
declare global {
  interface Window {
    __swarm?: {
      autoplay: boolean;
      /** e2e: the scripted player stops by itself when a draft is pending for the viewer. */
      stopAtDraft?: boolean;
      phase: Phase;
      turn: number;
      finished: boolean;
      view?: MatchView;
      session?: MatchSession;
      hash?: () => string;
    };
  }
}
const e2e = typeof location !== "undefined" && new URLSearchParams(location.search).has("e2e");

export default function Match({ session, onSave, onExit, onFinished, tutorial }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<MatchView | null>(null);
  // Your cosmetics (SPEC §11.3), for your seat on this screen; declared first so the view is
  // drawn with them from its first frame.
  useEffect(() => {
    setLocalCosmetics(localCosmetics(session.me));
    return () => setLocalCosmetics(null);
  }, [session]);
  const [, force] = useState(0);
  const rerender = useCallback(() => force((n) => n + 1), []);
  const [phase, setPhaseState] = useState<Phase>("planning");
  const phaseRef = useRef<Phase>("planning");
  const [radial, setRadial] = useState<{ cell: Hex; at: Point } | null>(null);
  // Multi-body (SPEC §10.2): the body Body view shows, System view, and the Launch flow.
  const home = session.state.players.find((p) => p.id === session.me)?.home.body ?? 0;
  const [bodyId, setBodyIdState] = useState(home);
  const bodyRef = useRef(home);
  const [systemView, setSystemViewState] = useState(false);
  const systemRef = useRef(false);
  /** Launch flow: the launcher, then (once picked) the target body awaiting a cell. */
  const [launch, setLaunchState] = useState<{
    body: number;
    cell: Hex;
    target: number | null;
  } | null>(null);
  const launchRef = useRef<typeof launch>(null);
  const [alerts, setAlerts] = useState<ReadonlySet<number>>(new Set());
  /** The turn whose draft offer the player closed ("Decide later"); reopened from the HUD. */
  const [draftClosedTurn, setDraftClosedTurn] = useState(-1);
  const multi = session.state.bodies.filter((b) => b.orbit).length > 1;
  const [info, setInfo] = useState<{ text: string; at: Point } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [log, setLog] = useState<{ turn: number; entries: LogEntry[] } | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [paused, setPaused] = useState(false);
  // Tutorial (SPEC §11.1): the current step, and what happened since it was last checked.
  const [tutorialStep, setTutorialStep] = useState(0);
  const tutorialSignals = useRef(new Set<string>());
  const [now, setNow] = useState(Date.now());
  const settings = useSettings();
  const ctl = useRef({ paused: false, skipped: false });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Turns waiting to be replayed, oldest first; replays run one at a time. */
  const queue = useRef<TurnRecord[]>([]);
  const playing = useRef(false);
  /** The state the view is showing, to spot resyncs that arrive without a turn. */
  const shown = useRef<GameState>(session.state);
  const me = session.me;

  const setPhase = (p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
    if (window.__swarm) window.__swarm.phase = p;
  };
  const flash = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  };

  const setLaunch = (l: typeof launch) => {
    launchRef.current = l;
    setLaunchState(l);
  };
  const setSystemView = (on: boolean) => {
    systemRef.current = on;
    setSystemViewState(on);
    setRadial(null);
    setInfo(null);
    view.current?.setMode(on ? "system" : "body");
  };
  const openBody = (id: number) => {
    bodyRef.current = id;
    setBodyIdState(id);
    setRadial(null);
    setInfo(null);
    systemRef.current = false;
    setSystemViewState(false);
    view.current?.showBody(id);
    setAlerts((a) => {
      if (!a.has(id)) return a;
      const next = new Set(a);
      next.delete(id);
      return next;
    });
  };
  const body = () =>
    (session.state.bodies[bodyRef.current] ??
      session.state.bodies[0]) as (typeof session.state.bodies)[number];
  const cellOf = (h: Hex) => body().colony[getBoard(body().radius).indexOf(h.q, h.r)] ?? null;

  const refreshPlan = useCallback(() => {
    const { planner } = session;
    const previews = planner.orders.map((o) =>
      o.type === "grow" ? previewPath(session.state, me, o.body, o.path) : [],
    );
    view.current?.setPlan(phaseRef.current === "replay" ? [] : planner.orders, me, previews);
    session.saveDraft();
    onSave?.();
    rerender();
  }, [session, rerender, onSave, me]);

  const addOrder = (o: Order): boolean => {
    if (session.submitted) {
      flash("Orders are submitted. Unsubmit to change them.");
      return false;
    }
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

  const planning = () => phaseRef.current === "planning" && !session.submitted && !session.finished;
  // Fruiting hints and frontier feelers while orders can still be planned (colony life).
  const canPlan = phase === "planning" && !session.submitted && !session.finished;
  useEffect(() => view.current?.setPlanHints(canPlan));

  // Mount the Pixi view.
  useEffect(() => {
    let disposed = false;
    const el = host.current;
    if (!el) return;
    void MatchView.create(el, session.state, {
      canPaintFrom: (h) => planning() && cellOf(h)?.owner === me && !!cellOf(h)?.connected,
      passable: (h) => {
        const b = body();
        const i = getBoard(b.radius).indexOf(h.q, h.r);
        return i >= 0 && b.terrain[i] !== "rock";
      },
      reach: playerRules(session.state, me).growReach,
      onPaintStart: () => {
        setRadial(null);
        setInfo(null);
        haptic("tick");
      },
      onPaintChange: (path, added) => {
        const order: Order = { type: "grow", body: bodyRef.current, path };
        const check = session.planner.check(order);
        view.current?.setPaint({
          path,
          preview: previewPath(session.state, me, bodyRef.current, path),
          valid: check.ok,
          cost: check.ok ? check.cost : 0,
          player: me,
        });
        if (added > 0) {
          haptic("tick");
          audio.tick();
        }
      },
      onPaintEnd: (path) => {
        view.current?.setPaint(null);
        if (path && addOrder({ type: "grow", body: bodyRef.current, path })) audio.squelch();
      },
      onTap: (h, at) => {
        setInfo(null);
        if (!h || phaseRef.current === "replay") {
          setRadial(null);
          return;
        }
        const l = launchRef.current;
        if (l && l.target === bodyRef.current && planning()) {
          // Launch flow, step 2: the landing cell.
          if (
            addOrder({
              type: "launch",
              body: l.body,
              cell: l.cell,
              targetBody: l.target,
              targetCell: h,
            })
          ) {
            audio.launch();
            setLaunch(null);
            openBody(l.body);
          }
          return;
        }
        if (cellOf(h)?.owner === me && planning()) {
          audio.click();
          setRadial({ cell: h, at });
        } else {
          setRadial(null);
          setInfo({ text: describeCell(h), at });
        }
      },
      onCamera: () => setRadial(null),
      onBodyTap: (id) => {
        const l = launchRef.current;
        if (l && l.target === null) {
          audio.click();
          setLaunch({ ...l, target: id });
          openBody(id);
          return;
        }
        audio.click();
        openBody(id);
      },
      onPinchOut: () => {
        if (multi && !launchRef.current) setSystemView(true);
      },
    }).then((v) => {
      if (disposed) return v.destroy();
      view.current = v;
      v.setPatterns(getSettings().patterns);
      v.reduceMotion = getSettings().reduceMotion;
      v.calm = getSettings().colonyDetail === "calm";
      v.setViewer(me);
      if (bodyRef.current !== 0) v.showBody(bodyRef.current);
      if (e2e && window.__swarm) window.__swarm.view = v;
      shown.current = session.state;
      v.setState(session.state);
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

  useEffect(() => {
    if (view.current) view.current.calm = settings.colonyDetail === "calm";
  }, [settings.colonyDetail]);

  useEffect(() => {
    const l = launchRef.current;
    view.current?.setSystemOptions({ launchFrom: l && l.target === null ? l.body : null, alerts });
  }, [alerts, launch]);

  const describeCell = (h: Hex): string => {
    const b = body();
    const i = getBoard(b.radius).indexOf(h.q, h.r);
    const c = b.colony[i];
    const d = b.deposits[i];
    const deposit = d ? ` · ${d} deposit (+${session.state.rules.depositYield[d]} N)` : "";
    if (b.terrain[i] === "rock") return "Rock: impassable";
    if (!c) return `Empty regolith${deposit}`;
    const who = c.owner === me ? "Your" : `${session.name(c.owner)}'s`;
    return `${who} ${c.core ? "core" : "cell"} · biomass ${c.biomass}${c.connected ? "" : " · cut off"}${deposit}`;
  };

  /** Plays queued turns one after another, then returns to planning (or results). */
  const drain = useCallback(async () => {
    if (playing.current) return;
    playing.current = true;
    while (queue.current.length > 0) {
      const record = queue.current.shift() as TurnRecord;
      setRadial(null);
      setInfo(null);
      setDrawer(false);
      if (launchRef.current) setLaunch(null);
      setPhase("replay");
      audio.setDuck(true);
      for (const e of record.events)
        if ("player" in e && e.player === me) tutorialSignals.current.add(`event:${e.type}`);
      view.current?.setInputEnabled(false);
      view.current?.setPlan([], me, []);
      view.current?.setState(record.before);
      setLog({
        turn: record.before.turn,
        entries: describeEvents(record.events, me, (p) => session.name(p)),
      });
      setShowLog(true);
      ctl.current = { paused: false, skipped: window.__swarm?.autoplay ?? false };
      setPaused(false);
      const frames = buildTimeline(record.before, record.after, record.events, record.orders);
      const control = {
        speed: () => getSettings().replaySpeed,
        paused: () => ctl.current.paused,
        skipped: () => ctl.current.skipped,
        reduceMotion: getSettings().reduceMotion,
      };
      // Show the turn on every body where something happened (playtest), then hand control
      // back where the player was. Input stays off throughout; Skip ends the whole tour.
      const startBody = bodyRef.current;
      const startSystem = systemRef.current;
      const tour = multi ? replayBodies(frames, startBody) : [startBody];
      // Bodies the tour does not reach (Skip) keep their alert dot on the strip (SPEC §10.5).
      setAlerts(new Set(tour.filter((b) => b !== startBody)));
      for (const [i, b] of tour.entries()) {
        if (i > 0 && ctl.current.skipped) break;
        view.current?.setState(record.before);
        if (b !== bodyRef.current || systemRef.current) openBody(b);
        await view.current?.playTimeline(
          i === 0 ? frames : framesFor(frames, b),
          control,
          frameSound,
        );
      }
      if (bodyRef.current !== startBody) openBody(startBody);
      if (startSystem) setSystemView(true);
    }
    shown.current = session.state;
    view.current?.setState(session.state);
    view.current?.setInputEnabled(true);
    playing.current = false;
    audio.setDuck(false);
    onSave?.();
    if (session.finished) {
      setTimeout(onFinished, window.__swarm?.autoplay ? 0 : 900);
      return;
    }
    setPhase(session.submitted ? "waiting" : "planning");
    if (!window.__swarm?.autoplay) setTimeout(() => setShowLog(false), 2600);
    refreshPlan();
  }, [session, onFinished, refreshPlan, onSave, me]);

  // Turns arrive from the session, whoever triggered them.
  useEffect(
    () =>
      session.onTurn((record) => {
        queue.current.push(record);
        void drain();
      }),
    [session, drain],
  );

  // State changes outside a turn (a resync after a hash mismatch, a reconnect) redraw at once.
  useEffect(
    () =>
      session.onChange(() => {
        const err = (session as { lastError?: string | null }).lastError;
        if (err) {
          flash(err);
          (session as { lastError?: string | null }).lastError = null;
        }
        if (!playing.current && queue.current.length === 0 && session.state !== shown.current) {
          shown.current = session.state;
          view.current?.setState(session.state);
          refreshPlan();
        }
        if (!playing.current) setPhase(session.submitted ? "waiting" : "planning");
        rerender();
      }),
    [session, rerender, refreshPlan],
  );

  // Deadline countdown.
  useEffect(() => {
    if (session.deadline === null) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [session]);

  // Colourblind patterns follow the setting live (SPEC §10.8).
  useEffect(() => view.current?.setPatterns(settings.patterns), [settings.patterns]);

  useEffect(() => {
    audio.setPad(true, (session.state.turn - 1) / session.state.rules.turnLimit);
    return () => audio.setPad(false);
  }, [session.state.turn]);

  const submit = useCallback(() => {
    if (!planning()) return;
    setRadial(null);
    setInfo(null);
    setDrawer(false);
    haptic("submit");
    audio.submit();
    view.current?.cancelPaint();
    setPhase("waiting");
    tutorialSignals.current.add("submit");
    session.submit();
  }, [session]);

  const unsubmit = () => {
    if (!session.canUnsubmit()) return;
    audio.click();
    session.unsubmit();
    setPhase("planning");
  };

  // Keyboard extras (SPEC §10.3).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "Escape") {
        if (launchRef.current) {
          const l = launchRef.current;
          setLaunch(null);
          if (l.target !== null) openBody(l.body);
          else setSystemView(false);
        }
        view.current?.cancelPaint();
        setRadial(null);
        setInfo(null);
        setDrawer(false);
      } else if ((e.key === "z" || e.key === "Z") && planning()) {
        session.planner.undo();
        refreshPlan();
      } else if (e.key === "Enter" && planning()) {
        submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit, session, refreshPlan]);

  // e2e: expose the session, and notice the autoplay flag flipping.
  useEffect(() => {
    if (!e2e) return;
    const id = setInterval(() => {
      if (window.__swarm?.autoplay && phaseRef.current === "planning") rerender();
    }, 200);
    return () => clearInterval(id);
  }, [rerender]);

  // Accelerated scripted player (SPEC §14): plays your turns with the Normal bot policy.
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
    window.__swarm.session = session;
    window.__swarm.hash = () => hashState(session.state);
    if (
      !window.__swarm.autoplay ||
      phase !== "planning" ||
      !view.current ||
      session.submitted ||
      session.finished
    )
      return;
    // Stopping here (not from the test, after the fact) leaves the offer for the test to see:
    // otherwise the scripted player can pick it while the test is still switching autoplay off.
    if (window.__swarm.stopAtDraft && session.state.players.find((p) => p.id === me)?.draft) {
      window.__swarm.autoplay = false;
      return;
    }
    let cancelled = false;
    const turn = session.state.turn;
    void import("@swarm/bot").then(({ chooseOrders }) => {
      // Re-check the flag: it may have been switched off while the bot module loaded.
      // Without this, the scripted player submits one more turn after being stopped.
      if (cancelled || !window.__swarm?.autoplay || !planning() || session.state.turn !== turn)
        return;
      if (window.__swarm.stopAtDraft && session.state.players.find((p) => p.id === me)?.draft) {
        window.__swarm.autoplay = false;
        return;
      }
      session.planner.clear();
      for (const o of chooseOrders(session.state, me, "normal", "e2e")) session.planner.add(o);
      refreshPlan();
      submit();
    });
    return () => {
      cancelled = true;
    };
  });

  // Advances the tutorial when its step's trigger has happened; anything else is forgotten so a
  // stale submit or capture never completes a later step.
  // A step waits, hidden, until the player can do what it asks (M8 pacing).
  const pending = tutorial?.[tutorialStep];
  const step = pending && tutorialReady(session.state, me, pending.when) ? pending : undefined;
  useEffect(() => {
    if (!step) {
      tutorialSignals.current.clear();
      return;
    }
    const u = step.until;
    const signals = tutorialSignals.current;
    const hit =
      (u.kind === "order" && session.planner.orders.some((o) => o.type === u.order)) ||
      (u.kind === "systemView" && systemView) ||
      (u.kind === "submit" && signals.has("submit")) ||
      (u.kind === "event" && signals.has(`event:${u.event}`));
    signals.clear();
    if (hit) setTutorialStep((i) => i + 1);
  });

  const { planner, state } = session;
  const myState = state.players.find((p) => p.id === me);
  const draft = myState?.draft ?? null;
  const draftOpen =
    !!draft && phase === "planning" && !session.submitted && draftClosedTurn !== state.turn;
  const cost = planner.plannedCost;
  const over = cost > planner.banked;
  const lastStats = session.stats[session.stats.length - 1];
  const seats = session.seats();
  const waitingFor = seats.filter(
    (s) => !s.ready && !state.players.find((p) => p.id === s.seat)?.eliminated,
  ).length;
  const remaining =
    session.deadline === null ? null : Math.max(0, Math.ceil((session.deadline - now) / 1000));

  return (
    <main class={multi ? "match has-strip" : "match"} data-phase={phase}>
      <div class="viewport" ref={host} />
      {multi && systemView && <ForecastStrip state={state} me={me} />}
      {launch && (
        <div class="launch-banner" role="status">
          <span>
            {launch.target === null
              ? "Launch: pick a body in range"
              : `Launch: tap a landing cell on body ${launch.target + 1}`}
          </span>
          <button
            class="btn btn-ghost small-btn"
            onClick={() => {
              const l = launch;
              setLaunch(null);
              if (l.target !== null) openBody(l.body);
              else setSystemView(false);
            }}
          >
            Cancel
          </button>
        </div>
      )}
      {multi && (
        <BodyStrip
          state={state}
          me={me}
          shown={bodyId}
          system={systemView}
          alerts={alerts}
          onPick={(id) => {
            const l = launchRef.current;
            if (l && l.target === null) {
              if (!view.current?.canPick(id)) {
                flash("That body is out of launch range");
                return;
              }
              setLaunch({ ...l, target: id });
            }
            audio.click();
            openBody(id);
          }}
          onSystem={() => {
            audio.click();
            setSystemView(!systemRef.current);
          }}
        />
      )}

      <header class="hud-top">
        <div class="hud-stats" role="group" aria-label="Nutrients">
          <span class="stat" title="Nutrients banked">
            <span class="stat-label">N</span>
            <span class="num">{myState?.nutrients ?? 0}</span>
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
          <TurnRing
            turn={state.turn}
            limit={state.rules.turnLimit}
            remaining={remaining}
            total={session.turnSeconds}
          />
          <ReadyMarkers
            seats={seats}
            mutations={(seat) => state.players.find((p) => p.id === seat)?.mutations ?? []}
          />
        </div>
        <button
          class="btn btn-icon menu-btn"
          aria-label="Leave match"
          title="Leave match"
          onClick={onExit}
        >
          ✕
        </button>
        <DominanceBar dominance={lastStats?.dominance ?? []} names={(s) => session.name(s)} />
      </header>

      {draftOpen && draft && (
        <DraftModal
          options={draft.options}
          picked={planner.draftPick}
          index={draft.index + 1}
          onPick={(m) => {
            const r = planner.pickDraft(m);
            if (!r.ok) return flash(r.message);
            refreshPlan();
            setDraftClosedTurn(state.turn);
          }}
          onLater={() => setDraftClosedTurn(state.turn)}
        />
      )}
      {radial && phase === "planning" && (
        <RadialMenu
          session={session}
          body={bodyId}
          onLaunch={(cell) => {
            setRadial(null);
            setLaunch({ body: bodyRef.current, cell, target: null });
            setSystemView(true);
          }}
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
        <div class="replay-controls" role="group" aria-label="Replay controls">
          <button
            class="btn btn-icon"
            aria-label={paused ? "Play" : "Pause"}
            title={paused ? "Play" : "Pause"}
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
            title="Replay speed"
            onClick={() => updateSettings({ replaySpeed: settings.replaySpeed === 1 ? 2 : 1 })}
          >
            {settings.replaySpeed}×
          </button>
          <button
            class="btn btn-icon"
            aria-label="Skip replay"
            title="Skip replay"
            onClick={() => (ctl.current.skipped = true)}
          >
            ⏭
          </button>
        </div>
      )}
      {phase === "waiting" && (
        <div class="waiting" role="status">
          {waitingFor > 0
            ? `Waiting for ${waitingFor} player${waitingFor === 1 ? "" : "s"}…`
            : "Resolving…"}
          {session.canUnsubmit() && (
            <button class="btn btn-ghost small-btn" onClick={unsubmit}>
              Unsubmit
            </button>
          )}
        </div>
      )}

      {showLog && log && log.entries.length > 0 && (
        <aside class="event-log" aria-label="What happened">
          <div class="event-log-head">
            <strong>Turn {log.turn}</strong>
            <button class="link" onClick={() => setShowLog(false)} aria-label="Hide log">
              hide
            </button>
          </div>
          <ul>
            {log.entries.slice(0, 8).map((l, i) => (
              <li key={i} class={l.important ? "important" : ""}>
                <button
                  class="link"
                  disabled={!l.cell}
                  onClick={() => {
                    if (!l.cell) return;
                    if (l.body !== bodyRef.current) openBody(l.body);
                    view.current?.centerOn(l.cell);
                  }}
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
        onFocus={(h, b) => {
          if (b !== bodyRef.current) openBody(b);
          view.current?.centerOn(h);
        }}
        onRemove={(i) => {
          if (session.submitted) return;
          planner.remove(i);
          refreshPlan();
        }}
      />

      {step && phase !== "replay" && !draftOpen && (
        <aside
          class="tutorial-card"
          role="status"
          aria-live="polite"
          data-tutorial-step={tutorialStep}
        >
          <p>{step.text}</p>
          <div class="tutorial-actions">
            <span class="muted">
              {tutorialStep + 1}/{tutorial?.length}
            </span>
            <button
              class="btn btn-ghost small-btn"
              onClick={() => setTutorialStep(tutorial?.length ?? 0)}
            >
              Skip tutorial
            </button>
            {/* Action steps can be skipped one at a time, so none can block the game. */}
            <button
              class={
                step.until.kind === "next" ? "btn btn-primary small-btn" : "btn btn-ghost small-btn"
              }
              onClick={() => {
                audio.click();
                setTutorialStep((i) => i + 1);
              }}
            >
              {step.until.kind === "next" ? "Got it" : "Skip step"}
            </button>
          </div>
        </aside>
      )}
      <footer class="hud-bottom">
        <button
          class="btn btn-pill"
          onClick={() => setDrawer((d) => !d)}
          aria-expanded={drawer}
          aria-label="Orders"
        >
          Orders <span class="badge">{planner.orders.length}</span>
        </button>
        {draft && phase === "planning" && !session.submitted && (
          <button
            class={planner.draftPick ? "btn btn-icon draft-btn" : "btn btn-icon draft-btn pending"}
            aria-label={planner.draftPick ? "Mutation draft (picked)" : "Mutation draft waiting"}
            title={planner.draftPick ? "Mutation draft (picked)" : "Mutation draft waiting"}
            onClick={() => setDraftClosedTurn(-1)}
          >
            ✦
          </button>
        )}
        <button
          class="btn btn-icon"
          aria-label="Undo last order"
          title="Undo last order"
          disabled={planner.orders.length === 0 || phase !== "planning" || session.submitted}
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
          title="Whole body"
          onClick={() => view.current?.showWholeBody()}
        >
          ⤢
        </button>
        {!showLog && log && phase !== "replay" && (
          <button
            class="btn btn-icon"
            aria-label="What happened last turn"
            title="What happened last turn"
            onClick={() => setShowLog(true)}
          >
            ☰
          </button>
        )}
        <button
          class="btn btn-submit"
          disabled={phase !== "planning" || over || session.submitted}
          onClick={submit}
        >
          {phase === "planning" ? "Submit" : phase === "waiting" ? "Waiting" : "Replaying"}
        </button>
      </footer>
    </main>
  );
}

function frameSound(f: Frame): void {
  const has = (k: string) => f.effects.some((e) => e.kind === k);
  switch (f.phase) {
    case "launch":
      if (f.effects.some((e) => e.kind === "launch" && !e.fizzled)) audio.launch();
      if (has("land")) setTimeout(() => audio.squelch(), 380);
      return;
    case "starve":
      if (has("fade")) audio.starve();
      return;
    case "income":
      if (has("income")) audio.income();
      return;
    case "events":
      if (has("flare")) audio.flare();
      else if (has("flash")) audio.thud();
      return;
    case "growth": {
      const kinds = new Set(f.effects.map((e) => (e.kind === "tendril" ? e.outcome : e.kind)));
      setTimeout(() => {
        if (kinds.has("capture") || kinds.has("coreLost")) audio.crunch();
        else if (kinds.has("claim")) audio.squelch();
        if (kinds.has("repelled") || kinds.has("splash")) audio.thud();
      }, 380);
      return;
    }
    default:
  }
}

/** Ready markers per player (SPEC §10.2), with bot takeover and connection shown to everyone. */
function ReadyMarkers({
  seats,
  mutations,
}: {
  seats: SeatStatus[];
  mutations(seat: number): readonly MutationId[];
}) {
  return (
    <div class="ready" role="group" aria-label="Players">
      {seats.map((s) => {
        const status = s.ready ? "ready" : s.thinking ? "thinking" : "planning";
        const label = `${s.name}: ${status}${s.botControlled ? ", bot playing" : ""}${s.connected ? "" : ", offline"}`;
        return (
          <span key={s.seat} class="ready-item" role="img" title={label} aria-label={label}>
            <span
              class={`ready-dot ${s.ready ? "on" : s.thinking ? "thinking" : ""} ${s.connected ? "" : "offline"}`}
              style={{ "--c": playerCss(s.seat) }}
            />
            {s.botControlled && <span class="bot-badge">BOT</span>}
            <MutationGlyphs ids={mutations(s.seat)} />
          </span>
        );
      })}
    </div>
  );
}

function DominanceBar({ dominance, names }: { dominance: number[]; names(seat: number): string }) {
  const parts = dominance.map((d, i) => `${names(i)} ${d / 10}%`).join(", ");
  if (dominance.length > 2) {
    // 3–4 players: one thin row each, all measured against the same goal line.
    return (
      <div class="dominance multi" role="img" aria-label={`Dominance: ${parts}`}>
        {dominance.map((d, i) => (
          <span key={i} class="dom-row">
            <span style={{ width: `${d / 10}%`, background: playerCss(i) }} />
          </span>
        ))}
        <span class="dom-goal" />
      </div>
    );
  }
  return (
    <div class="dominance" role="img" aria-label={`Dominance: ${parts}`}>
      <span style={{ width: `${(dominance[0] ?? 0) / 10}%`, background: playerCss(0) }} />
      <span class="dom-goal" />
      <span style={{ width: `${(dominance[1] ?? 0) / 10}%`, background: playerCss(1) }} />
    </div>
  );
}

function TurnRing({
  turn,
  limit,
  remaining,
  total,
}: {
  turn: number;
  limit: number;
  remaining: number | null;
  total: number | null;
}) {
  const r = 18;
  const c = 2 * Math.PI * r;
  // Online: the ring is the turn timer. Offline: progress toward the turn limit.
  const p =
    remaining !== null && total ? Math.min(1, remaining / total) : Math.min(1, (turn - 1) / limit);
  const urgent = remaining !== null && remaining <= 10;
  const label =
    remaining === null
      ? `Turn ${turn} of ${limit}`
      : `Turn ${turn} of ${limit}, ${remaining >= 3600 ? `${Math.floor(remaining / 3600)} h` : `${remaining} s`} left`;
  return (
    <div
      class={urgent ? "turn-ring urgent" : "turn-ring"}
      role="img"
      aria-label={label}
      title={label}
    >
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
      {remaining !== null && (
        <span class="ring-time num">
          {remaining >= 3600 ? `${Math.floor(remaining / 3600)}h` : `${remaining}s`}
        </span>
      )}
    </div>
  );
}

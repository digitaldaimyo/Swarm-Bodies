import { lazy, Suspense } from "preact/compat";
import { useEffect, useState } from "preact/hooks";
import type { GameMeta } from "@swarm/protocol";
import type { GameState } from "@swarm/sim";
import type { MatchSession } from "../game/match-session";
import type { OnlineSession } from "../game/online-session";
import type { SkirmishSession, SkirmishSettings } from "../game/session";
import { campaignNode, dailySetup, unlockedMutations, type CampaignNode } from "@swarm/content";
import { MUTATION_IDS, type StrainId } from "@swarm/sim";
import { summarizeSession, type TurnRecord } from "../game/match-session";
import type { ReplayFile } from "../game/replay";
import {
  completeNodesForTest,
  getProgress,
  loadProgress,
  NO_REWARDS,
  recordGame,
  syncProgress,
  type GameRewards,
} from "./progress";
import { audio } from "../audio/sfx";
import { loadSkirmish, saveSkirmish } from "./storage";
import { appPath, BASE } from "../net/origin";
import { ErrorBoundary } from "./ErrorBoundary";
import { Lobby } from "./Lobby";
import { Online } from "./Online";
import { SettingsScreen } from "./SettingsScreen";
import { Setup } from "./Setup";
import { Title } from "./Title";
import { useSettings } from "./settings";
import { loadStrain } from "./StrainPicker";

// The match, results and replay viewer pull in PixiJS and the sim; load them on demand
// so the title screen stays small (SPEC §10.7).
const Match = lazy(() => import("./Match"));
const Results = lazy(() => import("./Results"));
const ReplayViewer = lazy(() => import("./ReplayViewer"));
// The campaign and codex are lazy too (SPEC §10.7).
const Campaign = lazy(() => import("./Campaign"));
const Codex = lazy(() => import("./Codex"));
const Daily = lazy(() => import("./Daily"));

type Screen =
  | { name: "title" }
  | { name: "setup" }
  | { name: "settings" }
  | { name: "online" }
  | { name: "lobby"; meta: GameMeta }
  | { name: "campaign" }
  | { name: "codex" }
  | { name: "daily" }
  | { name: "match"; session: MatchSession }
  | { name: "results"; session: MatchSession; rewards?: GameRewards | undefined }
  | { name: "replay"; session: MatchSession; rewards?: GameRewards | undefined }
  | { name: "shared"; history: TurnRecord[]; title: string };

/** The campaign node a session plays, if any. */
function nodeOf(session: MatchSession): CampaignNode | undefined {
  if (session.kind !== "skirmish") return undefined;
  const id = (session as SkirmishSession).settings.campaign;
  return id ? campaignNode(id) : undefined;
}

async function newSkirmish(settings: SkirmishSettings | null): Promise<SkirmishSession> {
  const [{ SkirmishSession }, { workerBot }] = await Promise.all([
    import("../game/session"),
    import("../game/bot-client"),
  ]);
  const saved = settings ? null : loadSkirmish();
  if (saved) return SkirmishSession.restore(saved, workerBot());
  return new SkirmishSession(
    settings ?? { seed: "fallback", difficulty: "easy", strain: "swarmer", botStrain: "biofilm" },
    workerBot(),
  );
}

function randomSeed(): string {
  const words = [
    "amber",
    "basalt",
    "comet",
    "drift",
    "ember",
    "frost",
    "glimmer",
    "halo",
    "ion",
    "jade",
    "krill",
    "lumen",
  ];
  const pick = () => words[Math.floor(Math.random() * words.length)] as string;
  return `${pick()}-${pick()}-${Math.floor(Math.random() * 1000)}`;
}

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: "title" });
  const [hasSave, setHasSave] = useState(() => loadSkirmish() !== null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settings = useSettings();

  useEffect(() => audio.applyLevels(), [settings]);
  useEffect(() => {
    document.documentElement.dataset["motion"] = settings.reduceMotion ? "reduce" : "full";
  }, [settings.reduceMotion]);
  useEffect(() => {
    document.documentElement.style.setProperty("--text-scale", String(settings.textScale));
  }, [settings.textScale]);

  const busy = async (fn: () => Promise<void>) => {
    setLoading(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  /** `null` continues the saved skirmish. */
  const startSkirmish = (settings: SkirmishSettings | null) =>
    busy(async () => {
      const session = await newSkirmish(settings);
      setScreen(session.finished ? { name: "results", session } : { name: "match", session });
    });

  /** Opens an online game: its lobby, or the running match. */
  const openGame = (gameId: string) =>
    busy(async () => {
      const [{ OnlineSession }, { gameSocket }] = await Promise.all([
        import("../game/online-session"),
        import("../net/socket"),
      ]);
      const r = await OnlineSession.open(gameSocket(), gameId);
      if ("lobby" in r) setScreen({ name: "lobby", meta: r.lobby });
      else await showOnline(r);
    });

  const showOnline = async (session: OnlineSession) => {
    if (session.finished) {
      await session.loadFullHistory().catch(() => undefined);
      setScreen({ name: "results", session });
    } else setScreen({ name: "match", session });
  };

  const started = (meta: GameMeta, state: GameState) =>
    busy(async () => {
      const [{ OnlineSession }, { gameSocket }] = await Promise.all([
        import("../game/online-session"),
        import("../net/socket"),
      ]);
      await showOnline(new OnlineSession(gameSocket(), meta, state));
    });

  useEffect(() => {
    void loadProgress().then(() => syncProgress());
    // e2e: unlock campaign nodes without playing them.
    if (new URLSearchParams(location.search).has("e2e"))
      (window as unknown as { __swarmProgress: unknown }).__swarmProgress = {
        completeNodes: completeNodesForTest,
        get: getProgress,
      };
  }, []);

  /**
   * Records what a finished game earned (achievements, codex, campaign) for the results. A Daily
   * run is submitted first: the server replays and scores it, and its streak feeds achievements.
   */
  const finish = async (s: MatchSession): Promise<GameRewards | undefined> => {
    const settings = s.kind === "skirmish" ? (s as SkirmishSession).settings : null;
    let daily: GameRewards["daily"];
    if (settings?.daily) {
      try {
        const { api } = await import("../net/api");
        const r = await api.submitDaily(
          settings.daily,
          s.history.map((h) => h.orders[s.me] ?? []),
        );
        daily = { ...r, submitted: true };
      } catch (e) {
        daily = { submitted: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
    try {
      const online = s.kind === "online" ? (s as OnlineSession) : null;
      const summary = await summarizeSession(s, {
        mode: settings
          ? settings.campaign
            ? "campaign"
            : settings.daily
              ? "daily"
              : "skirmish"
          : online?.ranked
            ? "ranked"
            : "online",
        ...(settings && !settings.daily
          ? { difficulty: nodeOf(s)?.opponent.difficulty ?? settings.difficulty }
          : {}),
        ...(settings?.campaign ? { campaignNode: settings.campaign } : {}),
        ...(daily?.submitted ? { dailyStreak: daily.streak } : {}),
      });
      return { ...(await recordGame(summary)), ...(daily ? { daily } : {}) };
    } catch {
      return daily ? { ...NO_REWARDS, daily } : undefined;
    }
  };

  const playDaily = (date: string) => {
    const setup = dailySetup(date);
    const [you, bot] = setup.config.strains as [
      Exclude<StrainId, "base">,
      Exclude<StrainId, "base">,
    ];
    void startSkirmish({
      seed: setup.seed,
      difficulty: "normal",
      strain: you,
      botStrain: bot,
      daily: date,
    });
  };

  const playNode = (node: CampaignNode, strain: Exclude<StrainId, "base">) => {
    const pool = unlockedMutations(getProgress());
    void startSkirmish({
      seed: node.seed,
      difficulty: node.opponent.difficulty,
      strain: (node.you as Exclude<StrainId, "base"> | null) ?? strain,
      botStrain: node.opponent.strain as Exclude<StrainId, "base">,
      campaign: node.id,
      ...(pool.length < MUTATION_IDS.length ? { mutationPool: pool } : {}),
    });
  };

  /** Plays a shared replay (a link or a file) through the sim and shows it. */
  const openReplay = (load: () => Promise<ReplayFile>) =>
    busy(async () => {
      const { replayHistory } = await import("../game/replay");
      const file = await load();
      const history = await replayHistory(file);
      if (history.length === 0) throw new Error("That replay has no turns");
      setScreen({ name: "shared", history, title: `${file.title} · ${file.names.join(" vs ")}` });
    });

  // Deep links: ?join=CODE from a shared invite, ?game=ID from a push notification,
  // /replay/:id for a shared replay (SPEC §12).
  useEffect(() => {
    const shared = /^\/replay\/([0-9a-f-]{36})\/?$/i.exec(appPath())?.[1];
    if (shared) {
      void openReplay(async () => {
        const [{ api }, { replayFromResponse }] = await Promise.all([
          import("../net/api"),
          import("../game/replay"),
        ]);
        return replayFromResponse(await api.replay(shared));
      });
      return;
    }
    const params = new URLSearchParams(location.search);
    const join = params.get("join");
    const game = params.get("game");
    if (game) void openGame(game);
    else if (join && /^[A-Z2-9]{6}$/i.test(join)) {
      void busy(async () => {
        const { api } = await import("../net/api");
        const { gameId } = await api.joinGame(join, loadStrain());
        await openGame(gameId);
      });
    }
  }, []);

  const toTitle = () => {
    setHasSave(loadSkirmish() !== null);
    setScreen({ name: "title" });
  };

  const leave = (session: MatchSession) => {
    session.dispose();
    if (session.kind === "online") setScreen({ name: "online" });
    else if (nodeOf(session)) {
      setHasSave(loadSkirmish() !== null);
      setScreen({ name: "campaign" });
    } else toTitle();
  };

  const fallback = (
    <div class="loading" role="status">
      Growing…
    </div>
  );
  return (
    <div class="app" onPointerDown={() => audio.unlock()}>
      {loading && fallback}
      {error && (
        <div class="toast global" role="alert" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      <ErrorBoundary
        onReset={() => {
          if (appPath() !== "/") history.replaceState(null, "", BASE);
          toTitle();
        }}
      >
        {screen.name === "title" && (
          <Title
            hasSave={hasSave}
            onPlay={() => setScreen({ name: "setup" })}
            onOnline={() => setScreen({ name: "online" })}
            onContinue={() => void startSkirmish(null)}
            onSettings={() => setScreen({ name: "settings" })}
            onCampaign={() => setScreen({ name: "campaign" })}
            onDaily={() => setScreen({ name: "daily" })}
            onCodex={() => setScreen({ name: "codex" })}
          />
        )}
        {screen.name === "setup" && (
          <Setup
            defaultSeed={randomSeed()}
            onBack={toTitle}
            onStart={(settings) => void startSkirmish(settings)}
          />
        )}
        {screen.name === "settings" && (
          <SettingsScreen onBack={toTitle} onReplayFile={(f) => void openReplay(async () => f)} />
        )}
        {screen.name === "online" && <Online onBack={toTitle} onOpen={(id) => void openGame(id)} />}
        {screen.name === "lobby" && (
          <Lobby
            meta={screen.meta}
            onBack={() => setScreen({ name: "online" })}
            onStarted={(m, s) => void started(m, s)}
          />
        )}
        <Suspense fallback={fallback}>
          {screen.name === "campaign" && <Campaign onBack={toTitle} onPlay={playNode} />}
          {screen.name === "codex" && <Codex onBack={toTitle} />}
          {screen.name === "daily" && <Daily onBack={toTitle} onPlay={playDaily} />}
          {screen.name === "match" && (
            <Match
              session={screen.session}
              tutorial={nodeOf(screen.session)?.tutorial}
              onSave={
                screen.session.kind === "skirmish"
                  ? () => saveSkirmish((screen.session as SkirmishSession).save())
                  : undefined
              }
              onExit={() => leave(screen.session)}
              onFinished={() =>
                void busy(async () => {
                  const s = screen.session;
                  if (s.kind === "skirmish") saveSkirmish(null);
                  else await (s as OnlineSession).loadFullHistory().catch(() => undefined);
                  setScreen({ name: "results", session: s, rewards: await finish(s) });
                })
              }
            />
          )}
          {screen.name === "results" && (
            <Results
              session={screen.session}
              rewards={screen.rewards}
              againLabel={
                nodeOf(screen.session)
                  ? "Retry"
                  : screen.session.kind === "skirmish"
                    ? "Rematch"
                    : "Play again"
              }
              onTitle={() => {
                screen.session.dispose();
                toTitle();
              }}
              onCampaign={
                nodeOf(screen.session)
                  ? () => {
                      screen.session.dispose();
                      setScreen({ name: "campaign" });
                    }
                  : undefined
              }
              onRematch={() => {
                const s = screen.session;
                s.dispose();
                if (s.kind === "online") return setScreen({ name: "online" });
                const settings = (s as SkirmishSession).settings;
                // Campaign nodes replay their fixed seed; skirmishes get a fresh one.
                void startSkirmish(
                  settings.campaign ? settings : { ...settings, seed: randomSeed() },
                );
              }}
              onWatch={() =>
                setScreen({ name: "replay", session: screen.session, rewards: screen.rewards })
              }
            />
          )}
          {screen.name === "shared" && (
            <ReplayViewer
              history={screen.history}
              title={screen.title}
              onClose={() => {
                if (appPath() !== "/") history.replaceState(null, "", BASE);
                toTitle();
              }}
            />
          )}
          {screen.name === "replay" && (
            <ReplayViewer
              history={screen.session.history}
              onClose={() =>
                setScreen({ name: "results", session: screen.session, rewards: screen.rewards })
              }
            />
          )}
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

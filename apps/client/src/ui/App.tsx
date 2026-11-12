import { lazy, Suspense } from "preact/compat";
import { useEffect, useState } from "preact/hooks";
import type { Difficulty } from "@swarm/bot";
import type { GameMeta, Strain } from "@swarm/protocol";
import type { GameState } from "@swarm/sim";
import type { MatchSession } from "../game/match-session";
import type { OnlineSession } from "../game/online-session";
import type { SkirmishSession } from "../game/session";
import { audio } from "../audio/sfx";
import { loadSkirmish, saveSkirmish } from "./storage";
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

type Screen =
  | { name: "title" }
  | { name: "setup" }
  | { name: "settings" }
  | { name: "online" }
  | { name: "lobby"; meta: GameMeta }
  | { name: "match"; session: MatchSession }
  | { name: "results"; session: MatchSession }
  | { name: "replay"; session: MatchSession };

async function newSkirmish(
  seed: string,
  difficulty: Difficulty,
  strain: Strain,
  botStrain: Strain,
  restore = false,
): Promise<SkirmishSession> {
  const [{ SkirmishSession }, { workerBot }] = await Promise.all([
    import("../game/session"),
    import("../game/bot-client"),
  ]);
  const saved = restore ? loadSkirmish() : null;
  return saved
    ? SkirmishSession.restore(saved, workerBot())
    : new SkirmishSession({ seed, difficulty, strain, botStrain }, workerBot());
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

  const startSkirmish = (
    seed: string,
    difficulty: Difficulty,
    strain: Strain,
    botStrain: Strain,
    restore = false,
  ) =>
    busy(async () => {
      const session = await newSkirmish(seed, difficulty, strain, botStrain, restore);
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

  // Deep links: ?join=CODE from a shared invite, ?game=ID from a push notification.
  useEffect(() => {
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
    else toTitle();
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
      {screen.name === "title" && (
        <Title
          hasSave={hasSave}
          onPlay={() => setScreen({ name: "setup" })}
          onOnline={() => setScreen({ name: "online" })}
          onContinue={() => void startSkirmish("", "easy", "swarmer", "biofilm", true)}
          onSettings={() => setScreen({ name: "settings" })}
        />
      )}
      {screen.name === "setup" && (
        <Setup
          defaultSeed={randomSeed()}
          onBack={toTitle}
          onStart={(seed, d, s, b) => void startSkirmish(seed, d, s, b)}
        />
      )}
      {screen.name === "settings" && <SettingsScreen onBack={toTitle} />}
      {screen.name === "online" && <Online onBack={toTitle} onOpen={(id) => void openGame(id)} />}
      {screen.name === "lobby" && (
        <Lobby
          meta={screen.meta}
          onBack={() => setScreen({ name: "online" })}
          onStarted={(m, s) => void started(m, s)}
        />
      )}
      <Suspense fallback={fallback}>
        {screen.name === "match" && (
          <Match
            session={screen.session}
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
                setScreen({ name: "results", session: s });
              })
            }
          />
        )}
        {screen.name === "results" && (
          <Results
            session={screen.session}
            againLabel={screen.session.kind === "skirmish" ? "Rematch" : "Play again"}
            onTitle={() => {
              screen.session.dispose();
              toTitle();
            }}
            onRematch={() => {
              const s = screen.session;
              s.dispose();
              if (s.kind === "online") return setScreen({ name: "online" });
              const { difficulty, strain, botStrain } = (s as SkirmishSession).settings;
              void startSkirmish(randomSeed(), difficulty, strain, botStrain);
            }}
            onWatch={() => setScreen({ name: "replay", session: screen.session })}
          />
        )}
        {screen.name === "replay" && (
          <ReplayViewer
            session={screen.session}
            onClose={() => setScreen({ name: "results", session: screen.session })}
          />
        )}
      </Suspense>
    </div>
  );
}

import { lazy, Suspense } from "preact/compat";
import { useEffect, useState } from "preact/hooks";
import type { Difficulty } from "@swarm/bot";
import type { SkirmishSession } from "../game/session";
import { audio } from "../audio/sfx";
import { loadSkirmish, saveSkirmish } from "./storage";
import { SettingsScreen } from "./SettingsScreen";
import { Setup } from "./Setup";
import { Title } from "./Title";
import { useSettings } from "./settings";

// The match, results and replay viewer pull in PixiJS and the sim; load them on demand
// so the title screen stays small (SPEC §10.7).
const Match = lazy(() => import("./Match"));
const Results = lazy(() => import("./Results"));
const ReplayViewer = lazy(() => import("./ReplayViewer"));

type Screen =
  | { name: "title" }
  | { name: "setup" }
  | { name: "settings" }
  | { name: "match"; session: SkirmishSession }
  | { name: "results"; session: SkirmishSession }
  | { name: "replay"; session: SkirmishSession };

async function newSession(
  seed: string,
  difficulty: Difficulty,
  restore = false,
): Promise<SkirmishSession> {
  const [{ SkirmishSession }, { workerBot }] = await Promise.all([
    import("../game/session"),
    import("../game/bot-client"),
  ]);
  const saved = restore ? loadSkirmish() : null;
  return saved
    ? SkirmishSession.restore(saved, workerBot())
    : new SkirmishSession({ seed, difficulty }, workerBot());
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
  const settings = useSettings();

  useEffect(() => audio.applyLevels(), [settings]);
  useEffect(() => {
    document.documentElement.dataset["motion"] = settings.reduceMotion ? "reduce" : "full";
  }, [settings.reduceMotion]);

  const start = async (seed: string, difficulty: Difficulty, restore = false) => {
    setLoading(true);
    try {
      const session = await newSession(seed, difficulty, restore);
      setScreen(session.finished ? { name: "results", session } : { name: "match", session });
    } finally {
      setLoading(false);
    }
  };

  const toTitle = () => {
    setHasSave(loadSkirmish() !== null);
    setScreen({ name: "title" });
  };

  const fallback = (
    <div class="loading" role="status">
      Growing…
    </div>
  );
  return (
    <div class="app" onPointerDown={() => audio.unlock()}>
      {loading && fallback}
      {screen.name === "title" && (
        <Title
          hasSave={hasSave}
          onPlay={() => setScreen({ name: "setup" })}
          onContinue={() => void start("", "easy", true)}
          onSettings={() => setScreen({ name: "settings" })}
        />
      )}
      {screen.name === "setup" && (
        <Setup
          defaultSeed={randomSeed()}
          onBack={toTitle}
          onStart={(seed, d) => void start(seed, d)}
        />
      )}
      {screen.name === "settings" && <SettingsScreen onBack={toTitle} />}
      <Suspense fallback={fallback}>
        {screen.name === "match" && (
          <Match
            session={screen.session}
            onExit={toTitle}
            onFinished={() => {
              saveSkirmish(null);
              setScreen({ name: "results", session: screen.session });
            }}
          />
        )}
        {screen.name === "results" && (
          <Results
            session={screen.session}
            onTitle={() => {
              screen.session.dispose();
              toTitle();
            }}
            onRematch={() => {
              const { difficulty } = screen.session.settings;
              screen.session.dispose();
              void start(randomSeed(), difficulty);
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

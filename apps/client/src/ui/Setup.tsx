import { useState } from "preact/hooks";
import type { Difficulty } from "@swarm/bot";
import type { Strain } from "@swarm/protocol";
import { audio } from "../audio/sfx";
import type { GameMode } from "@swarm/sim";
import { neutralBodies, type SkirmishSettings, type SystemSize } from "../game/session";
import { strainInfo } from "@swarm/content";
import { loadStrain, storeStrain, STRAINS, StrainPicker } from "./StrainPicker";

interface Props {
  defaultSeed: string;
  onBack(): void;
  onStart(settings: SkirmishSettings): void;
}

const SIZES: { id: SystemSize; label: string }[] = [
  { id: "compact", label: "Compact" },
  { id: "standard", label: "Standard" },
  { id: "wide", label: "Wide" },
];

/** Skirmish setup (SPEC §10.1): bot count and difficulty, strains, system size and seed. */
export function Setup({ defaultSeed, onBack, onStart }: Props) {
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [map, setMap] = useState<GameMode>("system");
  const [bots, setBots] = useState(1);
  const [size, setSize] = useState<SystemSize>("standard");
  const neutral = neutralBodies(bots + 1, size);
  const [seed, setSeed] = useState(defaultSeed);
  const [strain, setStrain] = useState<Strain>(loadStrain);
  const [botStrain, setBotStrain] = useState<Strain>(() =>
    loadStrain() === "swarmer" ? "biofilm" : "swarmer",
  );
  return (
    <main class="panel-screen">
      <header class="screen-header">
        <button class="btn btn-icon" onClick={onBack} aria-label="Back">
          ←
        </button>
        <h2>Skirmish</h2>
      </header>
      <section class="card">
        <h3>Your strain</h3>
        <StrainPicker
          value={strain}
          onChange={(s) => {
            setStrain(s);
            storeStrain(s);
          }}
        />
      </section>
      <section class="card">
        <h3>Opponents</h3>
        {map === "system" && (
          <div class="segmented" role="radiogroup" aria-label="Number of bots">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                role="radio"
                aria-checked={bots === n}
                class={bots === n ? "seg active" : "seg"}
                onClick={() => {
                  audio.click();
                  setBots(n);
                }}
              >
                {n} bot{n === 1 ? "" : "s"}
              </button>
            ))}
          </div>
        )}
        <div class="segmented" role="radiogroup" aria-label="Bot difficulty">
          {(["easy", "normal", "hard"] as const).map((d) => (
            <button
              key={d}
              role="radio"
              aria-checked={difficulty === d}
              class={difficulty === d ? "seg active" : "seg"}
              onClick={() => {
                audio.click();
                setDifficulty(d);
              }}
            >
              {d === "easy" ? "Easy bot" : d === "normal" ? "Normal bot" : "Hard bot"}
            </button>
          ))}
        </div>
        <p class="hint">
          {difficulty === "easy"
            ? "Forgiving: it ignores threats half the time."
            : difficulty === "normal"
              ? "Plays greedily and cuts your supply lines."
              : "Checks its plan against your likely replies before committing."}
        </p>
        <div class="segmented wrap" role="radiogroup" aria-label="Bot strain">
          {STRAINS.map((s) => (
            <button
              key={s}
              role="radio"
              aria-checked={botStrain === s}
              class={botStrain === s ? "seg active" : "seg"}
              onClick={() => setBotStrain(s)}
            >
              {bots > 1 && map === "system" ? "Bots play" : "Bot plays"} {strainInfo(s).name}
            </button>
          ))}
        </div>
      </section>
      <section class="card">
        <h3>System</h3>
        <div class="segmented" role="radiogroup" aria-label="Map">
          {(["system", "singleRock"] as const).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={map === m}
              class={map === m ? "seg active" : "seg"}
              onClick={() => {
                audio.click();
                setMap(m);
              }}
            >
              {m === "system" ? "Asteroid system" : "Single Rock"}
            </button>
          ))}
        </div>
        {map === "system" ? (
          <>
            <div class="segmented" role="radiogroup" aria-label="System size">
              {SIZES.map((z) => (
                <button
                  key={z.id}
                  role="radio"
                  aria-checked={size === z.id}
                  class={size === z.id ? "seg active" : "seg"}
                  onClick={() => setSize(z.id)}
                >
                  {z.label}
                </button>
              ))}
            </div>
            <p class="hint">
              A home asteroid each plus {neutral} neutral bod{neutral === 1 ? "y" : "ies"} in orbit.
              Grow, fruit and launch spores to spread.
            </p>
          </>
        ) : (
          <p class="hint">Practice map: one large asteroid, two colonies on opposite edges.</p>
        )}
        <label class="field">
          <span>Seed</span>
          <input
            value={seed}
            onInput={(e) => setSeed((e.target as HTMLInputElement).value)}
            autocomplete="off"
            spellcheck={false}
          />
        </label>
      </section>
      <button
        class="btn btn-primary btn-wide"
        onClick={() => {
          audio.click();
          onStart({
            seed: seed.trim() || defaultSeed,
            difficulty,
            strain,
            botStrain,
            map,
            bots: map === "system" ? bots : 1,
            size,
          });
        }}
      >
        Start
      </button>
    </main>
  );
}

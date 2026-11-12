import { useState } from "preact/hooks";
import type { Difficulty } from "@swarm/bot";
import type { Strain } from "@swarm/protocol";
import { audio } from "../audio/sfx";
import { loadStrain, storeStrain, StrainPicker } from "./StrainPicker";

interface Props {
  defaultSeed: string;
  onBack(): void;
  onStart(seed: string, difficulty: Difficulty, strain: Strain, botStrain: Strain): void;
}

/** Skirmish setup (SPEC §10.1): bot difficulty, strains and seed. Single Rock until M5. */
export function Setup({ defaultSeed, onBack, onStart }: Props) {
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
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
        <h3>Opponent</h3>
        <div class="segmented" role="radiogroup" aria-label="Bot difficulty">
          {(["easy", "normal"] as const).map((d) => (
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
              {d === "easy" ? "Easy bot" : "Normal bot"}
            </button>
          ))}
        </div>
        <p class="hint">
          {difficulty === "easy"
            ? "Forgiving: it ignores threats half the time."
            : "Plays greedily and cuts your supply lines."}
        </p>
        <div class="segmented" role="radiogroup" aria-label="Bot strain">
          {(["swarmer", "biofilm"] as const).map((s) => (
            <button
              key={s}
              role="radio"
              aria-checked={botStrain === s}
              class={botStrain === s ? "seg active" : "seg"}
              onClick={() => setBotStrain(s)}
            >
              Bot plays {s === "swarmer" ? "Swarmer" : "Biofilm"}
            </button>
          ))}
        </div>
      </section>
      <section class="card">
        <h3>System</h3>
        <p class="option-fixed">
          <strong>Single Rock</strong>: one large asteroid, two colonies on opposite edges.
        </p>
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
          onStart(seed.trim() || defaultSeed, difficulty, strain, botStrain);
        }}
      >
        Start
      </button>
    </main>
  );
}

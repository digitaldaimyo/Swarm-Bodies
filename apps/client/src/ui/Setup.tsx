import { useState } from "preact/hooks";
import type { Difficulty } from "@swarm/bot";
import { audio } from "../audio/sfx";

interface Props {
  defaultSeed: string;
  onBack(): void;
  onStart(seed: string, difficulty: Difficulty): void;
}

/** Skirmish setup (SPEC §10.1). Single Rock and the base strain are the only options until M4/M5. */
export function Setup({ defaultSeed, onBack, onStart }: Props) {
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [seed, setSeed] = useState(defaultSeed);
  return (
    <main class="panel-screen">
      <header class="screen-header">
        <button class="btn btn-icon" onClick={onBack} aria-label="Back">
          ←
        </button>
        <h2>Skirmish</h2>
      </header>
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
      </section>
      <section class="card">
        <h3>System</h3>
        <p class="option-fixed">
          <strong>Single Rock</strong>: one large asteroid, two colonies on opposite edges.
        </p>
        <p class="option-fixed">
          <strong>Strain</strong>: base rules (strains arrive with online play).
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
          onStart(seed.trim() || defaultSeed, difficulty);
        }}
      >
        Start
      </button>
    </main>
  );
}

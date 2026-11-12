import { audio } from "../audio/sfx";
import { useState } from "preact/hooks";
import type { ReplayFile } from "../game/replay";
import { Cosmetics } from "./Cosmetics";
import { updateSettings, useSettings, type Settings } from "./settings";

export function SettingsScreen({
  onBack,
  onReplayFile,
}: {
  onBack(): void;
  onReplayFile(f: ReplayFile): void;
}) {
  const s = useSettings();
  const [fileError, setFileError] = useState<string | null>(null);
  const slider = (key: "master" | "sfx" | "ambience", label: string) => (
    <label class="field slider">
      <span>{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(s[key] * 100)}
        onInput={(e) =>
          updateSettings({
            [key]: Number((e.target as HTMLInputElement).value) / 100,
          } as Partial<Settings>)
        }
        onChange={() => audio.click()}
      />
      <output>{Math.round(s[key] * 100)}</output>
    </label>
  );
  const toggle = (key: "haptics" | "reduceMotion", label: string) => (
    <label class="field toggle">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={s[key]}
        onChange={(e) => updateSettings({ [key]: (e.target as HTMLInputElement).checked })}
      />
    </label>
  );
  return (
    <main class="panel-screen">
      <header class="screen-header">
        <button class="btn btn-icon" onClick={onBack} aria-label="Back">
          ←
        </button>
        <h2>Settings</h2>
      </header>
      <section class="card">
        <h3>Audio</h3>
        {slider("master", "Master")}
        {slider("sfx", "Effects")}
        {slider("ambience", "Ambience")}
      </section>
      <section class="card">
        <h3>Play</h3>
        {toggle("haptics", "Haptics")}
        {toggle("reduceMotion", "Reduce motion")}
        <div class="field">
          <span>Replay speed</span>
          <div class="segmented small">
            {([1, 2] as const).map((v) => (
              <button
                key={v}
                class={s.replaySpeed === v ? "seg active" : "seg"}
                onClick={() => updateSettings({ replaySpeed: v })}
              >
                {v}×
              </button>
            ))}
          </div>
        </div>
      </section>
      <Cosmetics />
      <section class="card">
        <h3>Replays</h3>
        <label class="field">
          <span>Open a replay file</span>
          <input
            type="file"
            accept="application/json,.json"
            aria-label="Open a replay file"
            onChange={(e) => {
              const input = e.target as HTMLInputElement;
              const file = input.files?.[0];
              if (!file) return;
              setFileError(null);
              void file
                .text()
                .then(async (text) => {
                  const { parseReplayFile } = await import("../game/replay");
                  const parsed = parseReplayFile(JSON.parse(text));
                  if (!parsed) throw new Error("not a replay");
                  onReplayFile(parsed);
                })
                .catch(() => setFileError("That file is not a Swarm Bodies replay."))
                .finally(() => (input.value = ""));
            }}
          />
        </label>
        {fileError && (
          <p class="error-line" role="alert">
            {fileError}
          </p>
        )}
      </section>
    </main>
  );
}

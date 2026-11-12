import {
  achievementInfo,
  cosmetic,
  COSMETICS,
  earnedCosmetics,
  type Cosmetic,
  type CosmeticKind,
} from "@swarm/content";
import type { LocalCosmetics } from "../render/palette";
import { getProgress, updateProgress, useProgress } from "./progress";

const KINDS: { kind: CosmeticKind; label: string }[] = [
  { kind: "palette", label: "Colony colour" },
  { kind: "vein", label: "Veins" },
  { kind: "trail", label: "Spore trail" },
];

/** The renderer's view of your selected cosmetics, only those you have earned. */
export function localCosmetics(seat: number): LocalCosmetics {
  const p = getProgress();
  const earned = new Set(earnedCosmetics(p));
  const pick = (kind: CosmeticKind) => {
    const c = cosmetic(kind, p.selected[kind]);
    return earned.has(c.id) ? c : cosmetic(kind, "default");
  };
  const palette = pick("palette");
  const trail = pick("trail");
  return {
    seat,
    palette: palette.id === "default" ? null : palette.value,
    veinScale: pick("vein").value / 100,
    trail: trail.id === "default" ? null : trail.value,
  };
}

const how = (c: Cosmetic) =>
  c.source.kind === "achievement"
    ? `Achievement: ${achievementInfo(c.source.id)?.name ?? c.source.id}`
    : c.source.kind === "season"
      ? `Play ${c.source.minGames} ranked games in a season`
      : "";

const swatch = (c: Cosmetic) =>
  c.kind === "vein" ? undefined : `#${c.value.toString(16).padStart(6, "0")}`;

/**
 * Cosmetics (SPEC §11.3): the only rewards. Pick from what you have earned; locked ones say how
 * to earn them. Your choice recolours your own colony on your own screen.
 */
export function Cosmetics() {
  const progress = useProgress();
  const earned = new Set(earnedCosmetics(progress));
  return (
    <section class="card cosmetics">
      <h3>Cosmetics</h3>
      {KINDS.map(({ kind, label }) => (
        <div key={kind} class="field column">
          <span>{label}</span>
          <div class="segmented wrap" role="radiogroup" aria-label={label}>
            {COSMETICS.filter((c) => c.kind === kind).map((c) => {
              const have = earned.has(c.id);
              const on =
                progress.selected[kind] === c.id ||
                (!earned.has(progress.selected[kind]) && c.id === "default");
              const color = swatch(c);
              return (
                <button
                  key={c.id}
                  role="radio"
                  aria-checked={on}
                  disabled={!have}
                  title={have ? c.name : how(c)}
                  class={on ? "seg active" : have ? "seg" : "seg locked"}
                  onClick={() =>
                    void updateProgress((p) => ({
                      ...p,
                      selected: { ...p.selected, [kind]: c.id },
                    }))
                  }
                >
                  {color && c.id !== "default" && (
                    <span class="swatch" style={{ background: color }} aria-hidden />
                  )}
                  {have ? c.name : `🔒 ${c.name}`}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <p class="hint">Earn more from achievements and ranked seasons. Gameplay never changes.</p>
    </section>
  );
}

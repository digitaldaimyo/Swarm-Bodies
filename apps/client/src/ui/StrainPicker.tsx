import { strainInfo, strainUnlockNode } from "@swarm/content";
import type { Strain } from "@swarm/protocol";
import { audio } from "../audio/sfx";

export const STRAINS: readonly Strain[] = ["swarmer", "biofilm", "predator", "sporer"];

/**
 * Pick a strain (SPEC §7.1). The rule lines come from the sim's own numbers. Offline, strains
 * the campaign has not unlocked yet show where they unlock (SPEC §11.1); online passes none.
 */
export function StrainPicker({
  value,
  onChange,
  label = "Your strain",
  available,
}: {
  value: Strain;
  onChange(s: Strain): void;
  label?: string;
  available?: readonly string[];
}) {
  return (
    <div class="strain-picker" role="radiogroup" aria-label={label}>
      {STRAINS.map((id) => {
        const info = strainInfo(id);
        const locked = available !== undefined && !available.includes(id);
        return (
          <button
            key={id}
            role="radio"
            aria-checked={value === id}
            disabled={locked}
            class={value === id ? "strain active" : locked ? "strain locked" : "strain"}
            onClick={() => {
              audio.click();
              onChange(id);
            }}
          >
            <strong>{info.name}</strong>
            <span class="strain-fantasy">{info.fantasy}</span>
            <span class="strain-rules">
              {locked
                ? `Unlocks at campaign system ${strainUnlockNode(id)}`
                : info.rules.join(" · ")}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const KEY = "swarm.strain.v1";

export function loadStrain(): Strain {
  try {
    const v = localStorage.getItem(KEY);
    return (STRAINS as readonly string[]).includes(v ?? "") ? (v as Strain) : "swarmer";
  } catch {
    return "swarmer";
  }
}

export function storeStrain(s: Strain): void {
  try {
    localStorage.setItem(KEY, s);
  } catch {
    // Not remembered; fine.
  }
}

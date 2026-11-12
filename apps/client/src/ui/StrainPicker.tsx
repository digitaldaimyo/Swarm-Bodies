import { strainInfo } from "@swarm/content";
import type { Strain } from "@swarm/protocol";
import { audio } from "../audio/sfx";

const STRAINS: Strain[] = ["swarmer", "biofilm"];

/** Pick a strain (SPEC §7.1). The rule lines come from the sim's own numbers. */
export function StrainPicker({
  value,
  onChange,
  label = "Your strain",
}: {
  value: Strain;
  onChange(s: Strain): void;
  label?: string;
}) {
  return (
    <div class="strain-picker" role="radiogroup" aria-label={label}>
      {STRAINS.map((id) => {
        const info = strainInfo(id);
        return (
          <button
            key={id}
            role="radio"
            aria-checked={value === id}
            class={value === id ? "strain active" : "strain"}
            onClick={() => {
              audio.click();
              onChange(id);
            }}
          >
            <strong>{info.name}</strong>
            <span class="strain-fantasy">{info.fantasy}</span>
            <span class="strain-rules">{info.rules.join(" · ")}</span>
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
    return v === "biofilm" ? "biofilm" : "swarmer";
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

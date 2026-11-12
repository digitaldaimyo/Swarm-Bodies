import { useState } from "preact/hooks";
import { mutationInfo } from "@swarm/content";
import type { MutationId } from "@swarm/sim";
import { audio } from "../audio/sfx";

interface Props {
  options: readonly MutationId[];
  picked: MutationId | null;
  /** Draft number, 1-based, of the 3 a game can offer. */
  index: number;
  onPick(m: MutationId): void;
  onLater(): void;
}

/**
 * Draft modal (SPEC §10.1 screen 5, §7.2): three mutation cards. Tap a card to inspect it, tap it
 * again to pick. Picking queues a Draft order first in this turn's set; leaving it means the
 * first card is assigned when the turn resolves.
 */
export function DraftModal({ options, picked, index, onPick, onLater }: Props) {
  const [inspect, setInspect] = useState<MutationId | null>(picked);
  return (
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="draft-title">
      <section class="draft">
        <header class="draft-head">
          <h2 id="draft-title">Mutation draft {index} of 3</h2>
          <p class="muted small">
            Tap a card to read it, tap again to pick. Unpicked, the first card is taken.
          </p>
        </header>
        <div class="draft-cards">
          {options.map((id) => {
            const info = mutationInfo(id);
            const open = inspect === id;
            return (
              <button
                key={id}
                class={`draft-card${open ? " open" : ""}${picked === id ? " picked" : ""}`}
                aria-pressed={picked === id}
                aria-label={`${info.name}. ${info.effect}${open ? " Tap again to pick." : ""}`}
                onClick={() => {
                  audio.click();
                  if (open) onPick(id);
                  else setInspect(id);
                }}
              >
                <span class="draft-glyph" aria-hidden="true">
                  {info.glyph}
                </span>
                <strong>{info.name}</strong>
                <span class="draft-effect">{info.effect}</span>
                {open && (
                  <>
                    <em class="draft-flavour">{info.flavour}</em>
                    <span class="draft-note">{info.note}</span>
                    <span class="draft-cta">{picked === id ? "Picked" : "Tap again to pick"}</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
        <button class="btn btn-ghost" onClick={onLater}>
          {picked ? "Done" : "Decide later"}
        </button>
      </section>
    </div>
  );
}

/** Drafted mutations as glyphs, for player banners (SPEC §7.2: drafts are public). */
export function MutationGlyphs({ ids }: { ids: readonly MutationId[] }) {
  if (ids.length === 0) return null;
  const names = ids.map((m) => mutationInfo(m).name).join(", ");
  return (
    <span class="mutation-glyphs" role="img" aria-label={`Mutations: ${names}`} title={names}>
      {ids.map((m) => (
        <span key={m} aria-hidden="true">
          {mutationInfo(m).glyph}
        </span>
      ))}
    </span>
  );
}

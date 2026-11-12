import { useState } from "preact/hooks";
import {
  ACHIEVEMENTS,
  ALL_MUTATIONS,
  CAMPAIGN,
  GUIDE,
  strainInfo,
  strainUnlockNode,
  unlockedMutations,
  unlockedStrains,
} from "@swarm/content";
import { PLAYABLE_STRAINS, type MutationId } from "@swarm/sim";
import { useProgress } from "./progress";

type Tab = "howto" | "strains" | "mutations" | "achievements";

const mutationUnlockNode = (m: MutationId) =>
  CAMPAIGN.find((n) => n.unlocks.mutations?.includes(m))?.index ?? null;

/**
 * Codex (SPEC §11.3, screen 8): strains, mutations and achievements. A mutation's entry fills
 * in once you have drafted it; until then only its name shows.
 */
export default function Codex({ onBack }: { onBack(): void }) {
  const progress = useProgress();
  const [tab, setTab] = useState<Tab>("howto");
  const strains = unlockedStrains(progress);
  const pool = unlockedMutations(progress);
  return (
    <main class="panel-screen codex">
      <header class="screen-header">
        <button class="btn btn-icon" onClick={onBack} aria-label="Back" title="Back">
          ←
        </button>
        <h2>Codex</h2>
      </header>
      <div class="segmented wrap" role="tablist" aria-label="Codex sections">
        {(["howto", "strains", "mutations", "achievements"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            class={tab === t ? "seg active" : "seg"}
            onClick={() => setTab(t)}
          >
            {t === "howto"
              ? "How to play"
              : t === "strains"
                ? "Strains"
                : t === "mutations"
                  ? `Mutations ${progress.drafted.length}/${ALL_MUTATIONS.length}`
                  : `Feats ${progress.achievements.length}/${ACHIEVEMENTS.length}`}
          </button>
        ))}
      </div>
      {tab === "howto" &&
        GUIDE.map((section) => (
          <section key={section.id} class="card guide" aria-labelledby={`guide-${section.id}`}>
            <h3 id={`guide-${section.id}`}>{section.title}</h3>
            <ul class="facts">
              {section.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </section>
        ))}
      {tab === "strains" &&
        PLAYABLE_STRAINS.map((id) => {
          const info = strainInfo(id);
          const open = strains.includes(id);
          return (
            <section key={id} class={open ? "card codex-entry" : "card codex-entry locked"}>
              <h3>{info.name}</h3>
              <p class="strain-fantasy">{info.fantasy}</p>
              <ul class="facts">
                {info.rules.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {!open && (
                <p class="hint">
                  Unlocks at campaign system {strainUnlockNode(id)}. Online: always.
                </p>
              )}
            </section>
          );
        })}
      {tab === "mutations" &&
        ALL_MUTATIONS.map((m) => {
          const known = progress.drafted.includes(m.id);
          const node = pool.includes(m.id) ? null : mutationUnlockNode(m.id);
          return (
            <section
              key={m.id}
              class={known ? "card codex-entry" : "card codex-entry locked"}
              data-mutation={m.id}
            >
              <h3>
                <span class="glyph" aria-hidden>
                  {m.glyph}
                </span>{" "}
                {m.name}
              </h3>
              <p>{m.effect}</p>
              {known ? (
                <>
                  <p class="flavour">“{m.flavour}”</p>
                  <p class="note">{m.note}</p>
                </>
              ) : (
                <p class="hint">Draft it once to fill this entry.</p>
              )}
              {node !== null && (
                <p class="hint">Offline drafts offer it after campaign system {node}.</p>
              )}
            </section>
          );
        })}
      {tab === "achievements" && (
        <ul class="achievements" aria-label="Achievements">
          {ACHIEVEMENTS.map((a) => {
            const got = progress.achievements.includes(a.id);
            return (
              <li key={a.id} class={got ? "achievement got" : "achievement"}>
                <span class="ach-mark" aria-hidden>
                  {got ? "★" : "☆"}
                </span>
                <span>
                  <strong>{a.name}</strong>
                  <span class="muted"> {a.description}</span>
                </span>
                <span class="sr-only">{got ? "earned" : "not yet"}</span>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

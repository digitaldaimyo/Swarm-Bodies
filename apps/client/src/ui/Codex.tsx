import { useState } from "preact/hooks";
import {
  ACHIEVEMENTS,
  ALL_MUTATIONS,
  CAMPAIGN,
  GUIDE,
  JOURNAL,
  MUTATION_NOTES,
  NARRATOR,
  STRAIN_NOTES,
  WORLD,
  journalHint,
  journalUnlocked,
  strainInfo,
  strainUnlockNode,
  unlockedMutations,
  unlockedStrains,
} from "@swarm/content";
import { PLAYABLE_STRAINS, type MutationId } from "@swarm/sim";
import { useProgress } from "./progress";
import { PurrSays } from "./Purr";

type Tab = "howto" | "strains" | "mutations" | "world" | "achievements" | "journal";
const TABS: readonly Tab[] = ["howto", "strains", "mutations", "world", "achievements", "journal"];

/** One of Dr. Purr's field notes on a Codex entry (docs/plans/tutorial.md, step 6). */
function FieldNote({ text }: { text: string | null }) {
  return text ? (
    <p class="field-note">
      <span class="purr-name">{NARRATOR.name}</span> {text}
    </p>
  ) : (
    <p class="hint">Dr. Purr hasn't seen one in the field yet.</p>
  );
}

const mutationUnlockNode = (m: MutationId) =>
  CAMPAIGN.find((n) => n.unlocks.mutations?.includes(m))?.index ?? null;

/**
 * Codex (SPEC §11.3, screen 8), kept as Dr. Purr's field journal (docs/plans/tutorial.md): the
 * rules, strains, mutations, the world, feats, and her Journal. Her field note on an entry opens
 * once you have met it in play; a mutation's entry fills in once you have drafted it.
 */
export default function Codex({ onBack }: { onBack(): void }) {
  const progress = useProgress();
  const [tab, setTab] = useState<Tab>("howto");
  const strains = unlockedStrains(progress);
  const pool = unlockedMutations(progress);
  const met = progress.met ?? [];
  const journalOpen = JOURNAL.filter((j) => journalUnlocked(j, progress)).length;
  const worldMet = WORLD.filter((w) => met.includes(w.id)).length;
  return (
    <main class="panel-screen codex">
      <header class="screen-header">
        <button class="btn btn-icon" onClick={onBack} aria-label="Back" title="Back">
          ←
        </button>
        <h2>Codex</h2>
      </header>
      <div class="segmented wrap" role="tablist" aria-label="Codex sections">
        {TABS.map((t) => (
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
                  : t === "world"
                    ? `World ${worldMet}/${WORLD.length}`
                    : t === "achievements"
                      ? `Feats ${progress.achievements.length}/${ACHIEVEMENTS.length}`
                      : `Journal ${journalOpen}/${JOURNAL.length}`}
          </button>
        ))}
      </div>
      {tab === "howto" && (
        <p class="muted guide-frame">
          {NARRATOR.fullName}'s guide for assistants: the rules, plainly. She insisted on the title.
        </p>
      )}
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
              <FieldNote text={met.includes(`strain:${id}`) ? STRAIN_NOTES[id] : null} />
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
                  <FieldNote text={MUTATION_NOTES[m.id]} />
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
      {tab === "world" &&
        WORLD.map((w) => {
          const known = met.includes(w.id);
          return (
            <section
              key={w.id}
              class={known ? "card codex-entry" : "card codex-entry locked"}
              data-world={w.id}
            >
              <h3>{w.name}</h3>
              <ul class="facts">
                {w.facts.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <FieldNote text={known ? w.note : null} />
            </section>
          );
        })}
      {tab === "journal" && (
        <>
          <PurrSays
            line={{
              mood: "smug",
              text: "My field journal. Read what you've earned; the rest is none of your business yet.",
            }}
          />
          {JOURNAL.map((j) => {
            const open = journalUnlocked(j, progress);
            return (
              <section
                key={j.id}
                class={open ? "card codex-entry journal-entry" : "card codex-entry locked"}
                data-journal={j.id}
                aria-labelledby={`journal-${j.id}`}
              >
                <h3 id={`journal-${j.id}`}>{open ? j.title : "Unread page"}</h3>
                {open ? (
                  j.text.map((t) => <p key={t}>{t}</p>)
                ) : (
                  <p class="hint">{journalHint(j.unlock)}</p>
                )}
              </section>
            );
          })}
        </>
      )}
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

import { LESSONS, type Lesson } from "@swarm/content";
import { audio } from "../audio/sfx";
import { useProgress } from "./progress";

interface Props {
  onBack(): void;
  onPlay(lesson: Lesson): void;
}

/**
 * The Training grounds (docs/plans/tutorial.md): optional lessons, each one idea on a small,
 * hand-placed board. Every lesson is open from the start; finished ones are ticked.
 */
export default function Training({ onBack, onPlay }: Props) {
  const progress = useProgress();
  const done = new Set(progress.completedLessons ?? []);
  return (
    <main class="panel-screen training">
      <header class="screen-header">
        <button class="btn btn-icon" onClick={onBack} aria-label="Back" title="Back">
          ←
        </button>
        <h2>Training grounds</h2>
        <span class="muted header-note">
          {LESSONS.filter((l) => done.has(l.id)).length}/{LESSONS.length}
        </span>
      </header>
      <p class="muted">Short lessons, one idea each. Play them in any order.</p>
      <ol class="lesson-list" aria-label="Lessons">
        {LESSONS.map((l) => (
          <li key={l.id}>
            <button
              class={done.has(l.id) ? "card lesson done" : "card lesson"}
              onClick={() => {
                audio.click();
                onPlay(l);
              }}
            >
              <span class="lesson-index" aria-hidden="true">
                {done.has(l.id) ? "✓" : l.index}
              </span>
              <span>
                <strong>{l.name}</strong>
                <span class="muted"> {l.blurb}</span>
              </span>
              <span class="sr-only">{done.has(l.id) ? "completed" : "not yet completed"}</span>
            </button>
          </li>
        ))}
      </ol>
    </main>
  );
}

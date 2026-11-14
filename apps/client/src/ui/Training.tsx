import { useState } from "preact/hooks";
import { LESSONS, type Lesson } from "@swarm/content";
import { audio } from "../audio/sfx";
import { useProgress } from "./progress";

interface Props {
  onBack(): void;
  onPlay(lesson: Lesson): void;
}

/** Where each lesson sits on the map (0–100 in both axes): a winding path, in order. */
const POSITIONS: Record<string, { x: number; y: number }> = {
  l1: { x: 10, y: 84 },
  l2: { x: 30, y: 66 },
  l3: { x: 14, y: 44 },
  l4: { x: 38, y: 30 },
  l5: { x: 62, y: 46 },
  l6: { x: 84, y: 26 },
  l7: { x: 86, y: 70 },
};
const at = (l: Lesson) => POSITIONS[l.id] ?? { x: 50, y: 50 };

/**
 * The Training grounds (docs/plans/tutorial.md): optional lessons on a map like the campaign's.
 * Every lesson is open from the start and can be played in any order; finished ones are ticked.
 */
export default function Training({ onBack, onPlay }: Props) {
  const progress = useProgress();
  const done = new Set(progress.completedLessons ?? []);
  const next = LESSONS.find((l) => !done.has(l.id));
  const [picked, setPicked] = useState<Lesson | null>(null);
  return (
    <main class="panel-screen campaign training">
      <header class="screen-header">
        <button class="btn btn-icon" onClick={onBack} aria-label="Back" title="Back">
          ←
        </button>
        <h2>Training grounds</h2>
        <span class="muted header-note">
          {LESSONS.filter((l) => done.has(l.id)).length}/{LESSONS.length}
        </span>
      </header>
      <div class="galaxy" role="list" aria-label="Lessons">
        <svg class="galaxy-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {LESSONS.slice(1).map((l, k) => {
            const from = LESSONS[k] as Lesson;
            const a = at(from);
            const b = at(l);
            return (
              <line
                key={l.id}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                class={done.has(from.id) ? "link lit" : "link"}
                vector-effect="non-scaling-stroke"
              />
            );
          })}
        </svg>
        {LESSONS.map((l) => {
          const finished = done.has(l.id);
          const p = at(l);
          return (
            <button
              key={l.id}
              role="listitem"
              class={`galaxy-node ${finished ? "done" : "open"}${l === next ? " next" : ""}`}
              style={{ left: `${6 + p.x * 0.88}%`, top: `${6 + p.y * 0.88}%` }}
              aria-label={`${l.index}. ${l.name}, ${finished ? "complete" : "open"}`}
              data-lesson={l.id}
              onClick={() => {
                audio.click();
                setPicked(l);
              }}
            >
              {finished ? "✓" : l.index}
            </button>
          );
        })}
      </div>
      {picked ? (
        <section class="card briefing" aria-label={`Lesson: ${picked.name}`}>
          <header class="briefing-head">
            <h3>
              {picked.index}. {picked.name}
            </h3>
            <button
              class="btn btn-icon small-btn"
              onClick={() => setPicked(null)}
              aria-label="Close briefing"
              title="Close briefing"
            >
              ×
            </button>
          </header>
          <p>{picked.blurb}</p>
          <ul class="facts">
            <li>
              <strong>Goal:</strong> {picked.goalText}
            </li>
          </ul>
          <button
            class="btn btn-primary btn-wide"
            onClick={() => {
              audio.click();
              onPlay(picked);
            }}
          >
            {done.has(picked.id) ? "Play again" : "Start lesson"}
          </button>
        </section>
      ) : (
        <p class="hint center">Short lessons, one idea each. Tap one to start.</p>
      )}
    </main>
  );
}

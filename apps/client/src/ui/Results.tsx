import type { MatchSession } from "../game/match-session";
import { matchSummary } from "../game/match-session";
import { PLAYER_CSS } from "../render/palette";

interface Props {
  session: MatchSession;
  /** "Rematch" for a skirmish, "Play again" online. */
  againLabel: string;
  onTitle(): void;
  onRematch(): void;
  onWatch(): void;
}

const REASONS: Record<string, string> = {
  lastStanding: "last colony standing",
  dominance: "dominance held for two turns",
  turnLimit: "highest dominance at the turn limit",
  draw: "a draw",
};

/** Results (SPEC §10.1 screen 6): winner, dominance graph, stats, replay and rematch. */
export default function Results({ session, againLabel, onTitle, onRematch, onWatch }: Props) {
  const result = session.state.result;
  const won = result?.winner === session.me;
  const title = result?.winner === null ? "Draw" : won ? "Victory" : "Defeat";
  const seats = session.state.players.map((p) => p.id);
  const summaries = seats.map((s) => matchSummary(session.history, s));
  const last = session.stats[session.stats.length - 1];
  const reason = result ? `Turn ${result.turn}, ${REASONS[result.reason] ?? result.reason}.` : "";
  return (
    <main class="panel-screen results">
      <h2 class={`result-title ${won ? "won" : "lost"}`}>{title}</h2>
      <p class="muted">
        {reason} {session.description}
      </p>
      <section class="card">
        <h3>Dominance</h3>
        <DominanceGraph session={session} />
      </section>
      <section class="card">
        <table class="stats">
          <thead>
            <tr>
              <th />
              {seats.map((s) => (
                <th key={s} style={{ color: PLAYER_CSS[s % PLAYER_CSS.length] }}>
                  {session.name(s)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Row
              label="Strain"
              values={session.state.players.map(
                (p) => p.strain[0]?.toUpperCase() + p.strain.slice(1),
              )}
            />
            <Row label="Cells" values={seats.map((s) => last?.cells[s] ?? 0)} />
            <Row label="Biomass" values={seats.map((s) => last?.biomass[s] ?? 0)} />
            <Row label="Cells grown" values={summaries.map((x) => x.grown)} />
            <Row label="Captures" values={summaries.map((x) => x.captures)} />
            <Row label="Stalemates" values={summaries.map((x) => x.stalemates)} />
          </tbody>
        </table>
      </section>
      <div class="button-row">
        <button class="btn" onClick={onWatch} disabled={session.history.length === 0}>
          Watch replay
        </button>
        <button class="btn btn-primary" onClick={onRematch}>
          {againLabel}
        </button>
      </div>
      <button class="btn btn-ghost btn-wide" onClick={onTitle}>
        Back to title
      </button>
    </main>
  );
}

function Row({ label, values }: { label: string; values: (number | string)[] }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      {values.map((v, i) => (
        <td key={i} class="num">
          {v}
        </td>
      ))}
    </tr>
  );
}

function DominanceGraph({ session }: { session: MatchSession }) {
  const w = 320;
  const h = 140;
  const pad = 8;
  const stats = session.stats;
  const n = Math.max(1, stats.length - 1);
  const goal = session.state.rules.dominanceWinPermille;
  const y = (pm: number) => h - pad - ((h - 2 * pad) * pm) / 1000;
  const x = (i: number) => pad + ((w - 2 * pad) * i) / n;
  const seats = session.state.players.map((p) => p.id);
  const line = (p: number) =>
    stats.map((s, i) => `${x(i).toFixed(1)},${y(s.dominance[p] ?? 0).toFixed(1)}`).join(" ");
  const final = stats[stats.length - 1];
  return (
    <figure class="graph">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Dominance over ${n} turns`}>
        <line x1={pad} x2={w - pad} y1={y(goal)} y2={y(goal)} class="goal-line" />
        <text x={w - pad} y={y(goal) - 4} text-anchor="end" class="goal-label">
          {goal / 10}% wins
        </text>
        {seats.map((p) => (
          <polyline
            key={p}
            points={line(p)}
            fill="none"
            stroke={PLAYER_CSS[p % PLAYER_CSS.length]}
            stroke-width="2.5"
            stroke-linejoin="round"
          />
        ))}
      </svg>
      <figcaption class="muted">
        Final:{" "}
        {seats.map((p) => `${session.name(p)} ${(final?.dominance[p] ?? 0) / 10}%`).join(", ")}
      </figcaption>
    </figure>
  );
}

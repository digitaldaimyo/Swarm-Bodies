import { HUMAN, matchSummary, type SkirmishSession } from "../game/session";
import { PLAYER_CSS } from "../render/palette";

interface Props {
  session: SkirmishSession;
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
export default function Results({ session, onTitle, onRematch, onWatch }: Props) {
  const result = session.state.result;
  const won = result?.winner === HUMAN;
  const title = result?.winner === null ? "Draw" : won ? "Victory" : "Defeat";
  const me = matchSummary(session.history, 0);
  const bot = matchSummary(session.history, 1);
  const last = session.stats[session.stats.length - 1];
  return (
    <main class="panel-screen results">
      <h2 class={`result-title ${won ? "won" : "lost"}`}>{title}</h2>
      <p class="muted">
        {result ? `Turn ${result.turn}, ${REASONS[result.reason] ?? result.reason}.` : ""}{" "}
        {session.settings.difficulty === "easy" ? "Easy" : "Normal"} bot · seed{" "}
        <code>{session.settings.seed}</code>
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
              <th style={{ color: PLAYER_CSS[0] }}>You</th>
              <th style={{ color: PLAYER_CSS[1] }}>Bot</th>
            </tr>
          </thead>
          <tbody>
            <Row label="Cells" a={last?.cells[0]} b={last?.cells[1]} />
            <Row label="Biomass" a={last?.biomass[0]} b={last?.biomass[1]} />
            <Row label="Cells grown" a={me.grown} b={bot.grown} />
            <Row label="Captures" a={me.captures} b={bot.captures} />
            <Row label="Stalemates" a={me.stalemates} b={bot.stalemates} />
          </tbody>
        </table>
      </section>
      <div class="button-row">
        <button class="btn" onClick={onWatch}>
          Watch replay
        </button>
        <button class="btn btn-primary" onClick={onRematch}>
          Rematch
        </button>
      </div>
      <button class="btn btn-ghost btn-wide" onClick={onTitle}>
        Back to title
      </button>
    </main>
  );
}

function Row({ label, a, b }: { label: string; a: number | undefined; b: number | undefined }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td class="num">{a ?? 0}</td>
      <td class="num">{b ?? 0}</td>
    </tr>
  );
}

function DominanceGraph({ session }: { session: SkirmishSession }) {
  const w = 320;
  const h = 140;
  const pad = 8;
  const stats = session.stats;
  const n = Math.max(1, stats.length - 1);
  const goal = session.state.rules.dominanceWinPermille;
  const y = (pm: number) => h - pad - ((h - 2 * pad) * pm) / 1000;
  const x = (i: number) => pad + ((w - 2 * pad) * i) / n;
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
        {[0, 1].map((p) => (
          <polyline
            key={p}
            points={line(p)}
            fill="none"
            stroke={PLAYER_CSS[p]}
            stroke-width="2.5"
            stroke-linejoin="round"
          />
        ))}
      </svg>
      <figcaption class="muted">
        Final: you {(final?.dominance[0] ?? 0) / 10}%, bot {(final?.dominance[1] ?? 0) / 10}%
      </figcaption>
    </figure>
  );
}

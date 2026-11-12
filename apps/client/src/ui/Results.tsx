import { achievementInfo, campaignNode, mutationInfo, strainInfo } from "@swarm/content";
import type { MutationId } from "@swarm/sim";
import type { MatchSession } from "../game/match-session";
import type { GameRewards } from "./progress";
import { useState } from "preact/hooks";
import { matchSummary } from "../game/match-session";
import { PLAYER_CSS } from "../render/palette";

interface Props {
  session: MatchSession;
  /** "Rematch" for a skirmish, "Play again" online. */
  againLabel: string;
  rewards?: GameRewards | undefined;
  /** Campaign games return to the map. */
  onCampaign?: (() => void) | undefined;
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
export default function Results({
  session,
  againLabel,
  rewards,
  onCampaign,
  onTitle,
  onRematch,
  onWatch,
}: Props) {
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
      {rewards && <Rewards rewards={rewards} />}
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
      <ShareReplay session={session} />
      <div class="button-row">
        <button class="btn" onClick={onWatch} disabled={session.history.length === 0}>
          Watch replay
        </button>
        <button class="btn btn-primary" onClick={onRematch}>
          {againLabel}
        </button>
      </div>
      {onCampaign && (
        <button class="btn btn-wide" onClick={onCampaign}>
          Campaign map
        </button>
      )}
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

/** What the game earned: campaign progress, unlocks, achievements, codex entries. */
function Rewards({ rewards }: { rewards: GameRewards }) {
  const node = rewards.completedNode ? campaignNode(rewards.completedNode) : undefined;
  const unlocks =
    node && rewards.firstCompletion
      ? [
          ...(node.unlocks.strains ?? []).map((s) => `${strainInfo(s).name} strain unlocked`),
          ...(node.unlocks.mutations ?? []).map((m) => `${mutationInfo(m).name} joins your drafts`),
        ]
      : [];
  const d = rewards.daily;
  const lines = [
    ...(d
      ? [
          d.submitted
            ? `Daily score ${d.score}${d.best ? "" : " (your best run still counts)"} · rank #${d.rank} · streak ${d.streak}`
            : `Daily run not submitted: ${d.error}`,
        ]
      : []),
    ...(node ? [`System ${node.index} complete: ${node.name}`] : []),
    ...unlocks,
    ...(rewards.twistMissed ? ["A win, but the objective was missed. Try again."] : []),
    ...rewards.achievements.map((a) => `Achievement: ${achievementInfo(a)?.name ?? a}`),
    ...rewards.mutationsDiscovered.map((m) => `Codex entry: ${mutationInfo(m as MutationId).name}`),
  ];
  if (lines.length === 0) return null;
  return (
    <section class="card rewards" aria-label="Rewards" role="status">
      <ul>
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </section>
  );
}

/** Share an online game's replay link, or save any game as a replay file (SPEC §12). */
function ShareReplay({ session }: { session: MatchSession }) {
  const [note, setNote] = useState<string | null>(null);
  const gameId = session.kind === "online" ? (session as { gameId?: string }).gameId : undefined;
  if (session.history.length === 0) return null;
  const share = async () => {
    const { replayLink } = await import("../game/replay");
    const url = replayLink(gameId as string);
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: "Swarm Bodies replay", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setNote("Link copied");
    } catch {
      setNote(url);
    }
  };
  const save = async () => {
    const { downloadReplay, replayFromSession } = await import("../game/replay");
    downloadReplay(replayFromSession(session, session.description));
  };
  return (
    <div class="button-row share-row">
      {gameId && (
        <button class="btn btn-ghost" onClick={() => void share()}>
          Share replay link
        </button>
      )}
      <button class="btn btn-ghost" onClick={() => void save()}>
        Save replay file
      </button>
      {note && (
        <p class="muted share-note" role="status">
          {note}
        </p>
      )}
    </div>
  );
}

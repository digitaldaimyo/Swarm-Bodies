import { useEffect, useState } from "preact/hooks";
import { dailyDate, dailySetup, strainInfo } from "@swarm/content";
import type { DailyResponse } from "@swarm/protocol";
import { audio } from "../audio/sfx";

interface Props {
  onBack(): void;
  onPlay(date: string): void;
}

/**
 * Daily Seed (SPEC §3): one system per UTC day, the same for everyone, against the Normal bot.
 * Play offline; the run is submitted when it ends and the server replays it to score it.
 */
export default function Daily({ onBack, onPlay }: Props) {
  const date = dailyDate(Date.now());
  const setup = dailySetup(date);
  const [you, bot] = setup.config.strains as [string, string];
  const [board, setBoard] = useState<DailyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void import("../net/api")
      .then(({ api }) => api.daily())
      .then((b) => live && setBoard(b))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, []);
  return (
    <main class="panel-screen daily">
      <header class="screen-header">
        <button class="btn btn-icon" onClick={onBack} aria-label="Back">
          ←
        </button>
        <h2>Daily Seed</h2>
        <span class="muted header-note">{date}</span>
      </header>
      <section class="card">
        <h3>Today's system</h3>
        <p>
          You play <strong>{strainInfo(you as "swarmer").name}</strong> against a Normal{" "}
          <strong>{strainInfo(bot as "swarmer").name}</strong> bot. Everyone gets the same map and
          the same bot.
        </p>
        <p class="hint">
          A win scores 1000 plus 20 for every turn under the limit; everyone also scores half their
          final dominance. Your best run counts.
        </p>
        <button
          class="btn btn-primary btn-wide"
          onClick={() => {
            audio.click();
            onPlay(date);
          }}
        >
          {board?.me ? "Play again" : "Play"}
        </button>
      </section>
      <section class="card">
        <h3>Leaderboard</h3>
        {board ? (
          <>
            {board.streak > 0 && (
              <p class="muted">
                Your streak: {board.streak} day{board.streak === 1 ? "" : "s"}
              </p>
            )}
            {board.entries.length === 0 ? (
              <p class="hint">No runs yet today. Be the first.</p>
            ) : (
              <table class="stats leaderboard" aria-label="Daily leaderboard">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Player</th>
                    <th class="num">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {board.entries.map((e) => (
                    <tr key={`${e.rank}-${e.name}`} class={e.you ? "you" : undefined}>
                      <td class="num">{e.rank}</td>
                      <td>
                        {e.name}
                        <span class="muted">
                          {" "}
                          · {e.outcome === "win" ? `won turn ${e.turns}` : e.outcome}
                        </span>
                      </td>
                      <td class="num">{e.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {board.me && !board.entries.some((e) => e.you) && (
              <p class="muted">
                You: #{board.me.rank} with {board.me.score}
              </p>
            )}
            {board.players > 0 && (
              <p class="muted">
                {board.players} player{board.players === 1 ? "" : "s"} today
              </p>
            )}
          </>
        ) : error ? (
          <p class="hint">Leaderboard unavailable offline. Your run is still playable.</p>
        ) : (
          <p class="muted" role="status">
            Loading…
          </p>
        )}
      </section>
    </main>
  );
}

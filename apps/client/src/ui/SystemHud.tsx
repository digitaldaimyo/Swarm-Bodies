import { forecast, type GameState, type PlayerId } from "@swarm/sim";
import { PLAYER_CSS } from "../render/palette";
import { bodyShares } from "../render/system";

const TYPE_CSS = {
  carbonaceous: "#3a312b",
  icy: "#8fa6b8",
  metallic: "#6d7178",
  irradiated: "#4b5a34",
} as const;

const TYPE_LABEL = {
  carbonaceous: "Carbonaceous",
  icy: "Icy",
  metallic: "Metallic",
  irradiated: "Irradiated",
} as const;

/** Ownership as a conic gradient, one sweep per player by share of the body's cells. */
function ring(state: GameState, id: number): string {
  const b = state.bodies[id];
  if (!b) return "transparent";
  const { owners, playable } = bodyShares(b);
  let at = 0;
  const stops: string[] = [];
  for (const [p, n] of [...owners].sort((x, y) => x[0] - y[0])) {
    const end = at + (360 * n) / Math.max(1, playable);
    stops.push(`${PLAYER_CSS[p % PLAYER_CSS.length]} ${at}deg ${end}deg`);
    at = end;
  }
  stops.push(`rgba(255,255,255,0.12) ${at}deg 360deg`);
  return `conic-gradient(${stops.join(", ")})`;
}

/**
 * The body strip (SPEC §10.2): a thumbnail per body with an ownership ring and an alert dot for
 * contested bodies or off-screen action this turn, plus the System view toggle.
 */
export function BodyStrip({
  state,
  me,
  shown,
  system,
  alerts,
  onPick,
  onSystem,
}: {
  state: GameState;
  me: PlayerId;
  shown: number;
  system: boolean;
  alerts: ReadonlySet<number>;
  onPick(id: number): void;
  onSystem(): void;
}) {
  return (
    <nav class="body-strip" aria-label="Bodies">
      <button
        class={system ? "body-thumb system on" : "body-thumb system"}
        aria-pressed={system}
        aria-label="System view"
        onClick={onSystem}
      >
        <span class="sun" aria-hidden="true" />
      </button>
      {state.bodies.map((b) => {
        const { owners } = bodyShares(b);
        const alert = alerts.has(b.id) || owners.size >= 2;
        const mine = owners.has(me);
        const label = `Body ${b.id + 1}, ${TYPE_LABEL[b.type]} ${b.size}${mine ? ", yours" : ""}${owners.size >= 2 ? ", contested" : ""}${alerts.has(b.id) ? ", action this turn" : ""}`;
        return (
          <button
            key={b.id}
            class={!system && b.id === shown ? "body-thumb on" : "body-thumb"}
            aria-label={label}
            title={label}
            aria-current={!system && b.id === shown}
            onClick={() => onPick(b.id)}
          >
            <span class="thumb-ring" style={{ background: ring(state, b.id) }} aria-hidden="true">
              <span
                class={`thumb-rock ${b.size}`}
                style={{ background: TYPE_CSS[b.type] }}
                aria-hidden="true"
              />
            </span>
            <span class="thumb-num num">{b.id + 1}</span>
            {alert && <span class="alert-dot" aria-hidden="true" />}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * Launch windows and events for the next 6 turns (SPEC §4.3, §8): how many launches would be
 * in range from bodies you hold, and when flares and comets strike.
 */
export function ForecastStrip({ state, me }: { state: GameState; me: PlayerId }) {
  const held = new Set(
    state.bodies.filter((b) => b.colony.some((c) => c?.owner === me)).map((b) => b.id),
  );
  const turns = forecast(state, 6, me);
  return (
    <section class="forecast" aria-label="Forecast, next 6 turns">
      {turns.slice(0, 6).map((f) => {
        const windows = f.windows.filter((w) => held.has(w.from));
        const targets = [...new Set(windows.map((w) => w.to + 1))].sort((a, b) => a - b);
        const flare = f.events.some((e) => e.kind === "flare");
        const comet = f.events.find((e) => e.kind === "comet");
        const label = `Turn ${f.turn}: ${targets.length > 0 ? `launch windows to bodies ${targets.join(", ")}` : "no launch windows"}${flare ? ", solar flare" : ""}${comet && comet.kind === "comet" ? `, comet on body ${comet.body + 1}` : ""}`;
        return (
          <div key={f.turn} class="forecast-turn" title={label} aria-label={label}>
            <span class="num forecast-n">{f.turn}</span>
            <span class={targets.length > 0 ? "forecast-win on" : "forecast-win"}>
              {targets.length > 0 ? `⇡${targets.join(",")}` : "·"}
            </span>
            <span class="forecast-ev" aria-hidden="true">
              {flare ? "☀" : ""}
              {comet ? "☄" : ""}
            </span>
          </div>
        );
      })}
    </section>
  );
}

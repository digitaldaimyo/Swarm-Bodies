import { idiv, isqrt } from "./math";
import { playerRules } from "./rules";
import { cosFx, sinFx, TRIG_SCALE } from "./trig";
import type { Body, GameState, PlayerId, ScheduledEvent } from "./types";

/**
 * Orbits and launch windows (SPEC §4.5), all in integers: positions are distance units ×
 * TRIG_SCALE (10000), distances come from an integer square root.
 */

export interface Point {
  x: number;
  y: number;
}

/** Orbit angle in degrees at turn t: (φ + floor(360·t / T)) mod 360. */
export function orbitAngle(body: Body, turn: number): number {
  if (!body.orbit) return 0;
  return (body.orbit.phase + idiv(360 * turn, body.orbit.period)) % 360;
}

/** Position at turn t, in distance units × TRIG_SCALE. The star is at the origin. */
export function bodyPosition(body: Body, turn: number): Point {
  if (!body.orbit) return { x: 0, y: 0 };
  const a = orbitAngle(body, turn);
  return { x: body.orbit.radius * cosFx(a), y: body.orbit.radius * sinFx(a) };
}

export function distanceSquared(a: Body, b: Body, turn: number): number {
  const p = bodyPosition(a, turn);
  const q = bodyPosition(b, turn);
  const dx = p.x - q.x;
  const dy = p.y - q.y;
  return dx * dx + dy * dy;
}

/** Distance in distance units × TRIG_SCALE (floored). */
export function distanceScaled(a: Body, b: Body, turn: number): number {
  return isqrt(distanceSquared(a, b, turn));
}

/** A player's launch range, in distance units, with any strain bonus (SPEC §4.5, §7.1). */
export function launchRangeFor(state: GameState, player: PlayerId): number {
  return playerRules(state, player).launchRange;
}

/** A launch from a to b is legal on turn t if dist ≤ launchRange (exact, in integers). */
export function inLaunchRange(
  state: GameState,
  a: Body,
  b: Body,
  turn: number,
  player: PlayerId,
): boolean {
  if (!a.orbit || !b.orbit || a.id === b.id) return false;
  const range = launchRangeFor(state, player) * TRIG_SCALE;
  return distanceSquared(a, b, turn) <= range * range;
}

/** Travel time: max(1, ceil(dist / sporeSpeed)) turns, fixed at launch. */
export function travelTime(state: GameState, a: Body, b: Body, turn: number): number {
  const speed = state.rules.sporeSpeed * TRIG_SCALE;
  const d = distanceScaled(a, b, turn);
  return Math.max(1, idiv(d + speed - 1, speed));
}

export interface LaunchWindow {
  from: number;
  to: number;
  /** Distance in units × TRIG_SCALE. */
  distance: number;
  travel: number;
}

export interface ForecastTurn {
  turn: number;
  windows: LaunchWindow[];
  events: ScheduledEvent[];
}

/**
 * Launch windows and scheduled events for the current turn and the next `turnsAhead` turns
 * (SPEC §4.5, §8, §9.2). Windows are directed (from → to) and use the base launch range.
 */
export function forecast(
  state: GameState,
  turnsAhead: number,
  player: PlayerId = 0,
): ForecastTurn[] {
  const out: ForecastTurn[] = [];
  for (let k = 0; k <= turnsAhead; k++) {
    const turn = state.turn + k;
    const windows: LaunchWindow[] = [];
    for (const a of state.bodies) {
      for (const b of state.bodies) {
        if (!inLaunchRange(state, a, b, turn, player)) continue;
        windows.push({
          from: a.id,
          to: b.id,
          distance: distanceScaled(a, b, turn),
          travel: travelTime(state, a, b, turn),
        });
      }
    }
    out.push({ turn, windows, events: state.schedule.filter((e) => e.turn === turn) });
  }
  return out;
}

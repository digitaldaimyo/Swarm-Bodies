import { hashString128 } from "./rng";
import type { GameState } from "./types";

/**
 * Canonical JSON: object keys sorted, no whitespace. Used for serialization and hashing so the
 * result never depends on object key insertion order (SPEC §9.2).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value))
      throw new TypeError("Non-finite number in state");
    if (value === undefined) throw new TypeError("undefined is not allowed in canonical JSON");
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function serialize(state: GameState): string {
  return canonicalJson(state);
}

export function deserialize(json: string): GameState {
  const parsed = JSON.parse(json) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { version?: unknown }).version !== 1
  ) {
    throw new Error("Not a Swarm Bodies game state (version 1)");
  }
  return parsed as GameState;
}

/** Stable 128-bit hash of the canonical serialization, as 32 hex characters. */
export function hashState(state: GameState): string {
  return hashString128(serialize(state))
    .map((w) => w.toString(16).padStart(8, "0"))
    .join("");
}

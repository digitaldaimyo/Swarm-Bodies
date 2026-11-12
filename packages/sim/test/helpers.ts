export {
  scenario,
  cellAt,
  grow,
  reinforce,
  retract,
  type CellSpec,
  type ScenarioSpec,
} from "../src/testing";

/** Recursively freezes a value so tests can prove functions never mutate their input. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

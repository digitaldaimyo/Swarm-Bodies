import type { Colony } from "@swarm/sim";

/**
 * Heartbeat (colony life, phase 2): each beat leaves a core and travels outward along the
 * supply tree. Pace and depth come from **defense**, the number an attacker must beat, so a
 * colony's rhythm reads as its strength: a hard-to-take core beats slow and deep, a weak one
 * quick and shallow.
 */

/** Defense mapped to 0..1 (2 is a fresh thin cell, 16+ a fortified core). */
export function strength(defense: number): number {
  return Math.max(0, Math.min(1, (defense - 2) / 14));
}

/** A core's beat: seconds per beat and depth (0..1), from its defense. */
export function beat(defense: number): { period: number; depth: number } {
  const s = strength(defense);
  return { period: 0.9 + 1.1 * s, depth: 0.35 + 0.6 * s };
}

/** Fraction of a beat a wave takes per supply-tree step outward from its core. */
export const WAVE_STEP = 0.11;

/** The pulse at `phase` (any real; one beat per unit): a short swell, then rest. */
export function pulse(phase: number): number {
  const f = phase - Math.floor(phase);
  // A sharp rise and a slower fall, like a heartbeat, over the first 35% of the beat.
  if (f > 0.35) return 0;
  const x = f / 0.35;
  return Math.sin(Math.PI * x) * (1 - 0.4 * x);
}

/**
 * Resolutions a cut-off cell survives if it stays cut (SPEC §5.3 phase 9): its remaining
 * Dormancy grace, then one starvation loss per turn until its biomass is gone.
 */
export function starveTurnsLeft(c: Colony, grace: number, loss: number): number {
  return Math.max(0, grace - c.cut) + Math.ceil(c.biomass / Math.max(1, loss));
}

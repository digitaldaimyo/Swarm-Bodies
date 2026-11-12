/**
 * Deterministic RNG (SPEC §9.3): sfc32 seeded from a string hash, with named streams so that
 * adding a new random use never shifts existing ones.
 */

/** cyrb128: hashes a string to four 32-bit words. */
export function hashString128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export interface Rng {
  /** Uniform unsigned 32-bit integer. */
  nextU32(): number;
  /** Uniform-ish integer in [0, n). n must be a positive integer below 2^32. */
  int(n: number): number;
  /** Integer in [lo, hi], inclusive. */
  range(lo: number, hi: number): number;
  /** One element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** A new array with the items shuffled (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[];
  /** Index chosen with integer weights. Total weight must be positive. */
  weighted(weights: readonly number[]): number;
}

export function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
}

function makeRng(next: () => number): Rng {
  const int = (n: number): number => {
    if (!Number.isInteger(n) || n <= 0)
      throw new RangeError(`rng.int needs a positive integer, got ${n}`);
    // Rejection sampling removes modulo bias.
    const limit = 0x100000000 - (0x100000000 % n);
    for (;;) {
      const v = next();
      if (v < limit) return v % n;
    }
  };
  return {
    nextU32: next,
    int,
    range: (lo, hi) => lo + int(hi - lo + 1),
    pick: (items) => {
      if (items.length === 0) throw new RangeError("rng.pick on empty array");
      return items[int(items.length)] as (typeof items)[number];
    },
    shuffle: (items) => {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1);
        const tmp = out[i] as (typeof out)[number];
        out[i] = out[j] as (typeof out)[number];
        out[j] = tmp;
      }
      return out;
    },
    weighted: (weights) => {
      let total = 0;
      for (const w of weights) total += w;
      if (total <= 0) throw new RangeError("rng.weighted needs a positive total");
      let roll = int(total);
      for (let i = 0; i < weights.length; i++) {
        roll -= weights[i] as number;
        if (roll < 0) return i;
      }
      return weights.length - 1;
    },
  };
}

/** A named, independent random stream derived from `seed` (e.g. "events", "draft:2:1"). */
export function rngStream(seed: string, name: string): Rng {
  const [a, b, c, d] = hashString128(`${seed}\u0000${name}`);
  const next = sfc32(a, b, c, d);
  // Warm up: sfc32's first outputs are weakly mixed.
  for (let i = 0; i < 12; i++) next();
  return makeRng(next);
}

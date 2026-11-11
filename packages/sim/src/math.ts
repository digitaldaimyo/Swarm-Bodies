/** Integer helpers. The sim never relies on floating-point results (SPEC §9.2). */

/** Floor division for integers, exact for all safe integers. */
export function idiv(a: number, b: number): number {
  if (b === 0) throw new RangeError("idiv by zero");
  const r = a % b;
  const q = (a - r) / b;
  // `+ 0` normalises -0 so results compare and serialize identically everywhere.
  return (r !== 0 && r < 0 !== b < 0 ? q - 1 : q) + 0;
}

/** floor(a * permille / 1000) */
export function permille(a: number, pm: number): number {
  return idiv(a * pm, 1000);
}

/** Integer square root: largest x with x*x <= n. Used for orbit distances (SPEC §4.5). */
export function isqrt(n: number): number {
  if (n < 0) throw new RangeError("isqrt of negative");
  if (n < 2) return n;
  let x = n;
  let y = idiv(x + 1, 2);
  while (y < x) {
    x = y;
    y = idiv(x + idiv(n, x), 2);
  }
  return x;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function compareNumbers(a: number, b: number): number {
  return a - b;
}

import { RATING } from "@swarm/sim";

/**
 * Glicko-2 (SPEC §11.2), after Glickman, "Example of the Glicko-2 system" (2013). Ratings are on
 * the familiar 1500 scale outside this module. Each finished ranked game is one rating period:
 * a 1v1 is one result, an FFA is a pairwise result against every other player (DECISIONS).
 */
export interface Rating {
  rating: number;
  deviation: number;
  volatility: number;
}

export interface Outcome {
  opponent: Rating;
  /** 1 win, 0.5 draw, 0 loss. */
  score: number;
}

const SCALE = 173.7178;
const EPSILON = 0.000001;

export function initialRating(): Rating {
  return {
    rating: RATING.initialRating,
    deviation: RATING.initialDeviation,
    volatility: RATING.initialVolatility,
  };
}

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const expected = (mu: number, muJ: number, phiJ: number) =>
  1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/** One rating period. With no games the deviation grows (step 6 alone). */
export function updateRating(
  player: Rating,
  outcomes: readonly Outcome[],
  tau = RATING.tau,
): Rating {
  const mu = (player.rating - RATING.initialRating) / SCALE;
  const phi = player.deviation / SCALE;
  const sigma = player.volatility;
  if (outcomes.length === 0) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    return { ...player, deviation: Math.min(RATING.initialDeviation, phiStar * SCALE) };
  }
  const opp = outcomes.map((o) => ({
    mu: (o.opponent.rating - RATING.initialRating) / SCALE,
    phi: o.opponent.deviation / SCALE,
    score: o.score,
  }));
  // Steps 3–4: estimated variance and improvement.
  let vInv = 0;
  let sum = 0;
  for (const o of opp) {
    const e = expected(mu, o.mu, o.phi);
    const gj = g(o.phi);
    vInv += gj * gj * e * (1 - e);
    sum += gj * (o.score - e);
  }
  const v = 1 / vInv;
  const delta = v * sum;
  // Step 5: new volatility by the Illinois algorithm.
  const a = Math.log(sigma * sigma);
  const f = (x: number) => {
    const ex = Math.exp(x);
    const d = phi * phi + v + ex;
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * d * d) - (x - a) / (tau * tau);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else {
    let k = 1;
    while (f(a - k * tau) < 0) k++;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  for (let i = 0; i < 100 && Math.abs(B - A) > EPSILON; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else fA /= 2;
    B = C;
    fB = fC;
  }
  const sigmaNew = Math.exp(A / 2);
  // Steps 6–8.
  const phiStar = Math.sqrt(phi * phi + sigmaNew * sigmaNew);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * sum;
  return {
    rating: muNew * SCALE + RATING.initialRating,
    deviation: Math.max(RATING.minDeviation, phiNew * SCALE),
    volatility: sigmaNew,
  };
}

/**
 * Pairwise results for a finished game from each player's placing (0 is first). Equal places
 * draw. Every player's update uses the others' ratings from before the game.
 */
export function rateGame(players: readonly { rating: Rating; place: number }[]): Rating[] {
  return players.map((p, i) =>
    updateRating(
      p.rating,
      players
        .filter((_, j) => j !== i)
        .map((o) => ({
          opponent: o.rating,
          score: p.place < o.place ? 1 : p.place === o.place ? 0.5 : 0,
        })),
    ),
  );
}

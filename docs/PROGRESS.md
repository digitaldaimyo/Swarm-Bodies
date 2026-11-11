# Progress

**Current milestone:** M2, Bot: complete. **Next:** M3, Playable client vs bot (SPEC §15).

## M2: Bot: done

Scope (§15): `bot` package at Easy and Normal difficulty.

- [x] `packages/bot`: `chooseOrders(state, playerId, difficulty, seed, options?)` (§13.1). It is pure and deterministic, lint-guarded like the sim, and always returns a set that passes `validateOrderSet`.
- [x] Utility planner (§13.2):
  - Board analysis: deposit pull, threat and defense per cell, and articulation "cut" counts for both sides.
  - Candidates: grow paths (searched up to reach), assaults, reinforce-then-assault combos, severing, and threat-driven reinforces.
  - Greedy selection by value per nutrient, under the budget and the 12-order limit.
- [x] Easy: random top-3 per slot, ignores threats on half of its turns, never severs. Hard plays as Normal until M6.
- [x] Personalities as weight presets (§13.3): balanced, aggressive, greedy, expansionist, saboteur.
- [x] `tools/balance`: `--players a,b` (random, easy, normal, hard), alternating seats, and per-side win rates and turn times.
- [x] Acceptance: **Normal beat random-legal play in 200/200 games** (`tools/balance/test/cli.test.ts` asserts ≥ 190/200).
- [x] Acceptance: scenario puzzles pass (`packages/bot/test/puzzles.test.ts`): reinforce a threatened core, cut a single-link supply line, take a last core, prefer a nearby deposit, and reinforce a feeder to win an assault. The core and sever puzzles were checked to fail when the matching weight is zeroed.
- [x] Acceptance: time budget. The test asserts under 50 ms per Normal turn (200 ms ÷ 4) across full Large-body games; the measured warm worst case is about 7 ms, with a mean of about 2–3 ms.

Reference batch results (200 games each, seats alternating):

| Matchup          | Result                                                                   | Avg length |
| ---------------- | ------------------------------------------------------------------------ | ---------- |
| Normal vs random | 200–0                                                                    | ~15 turns  |
| Easy vs random   | 200–0                                                                    | ~15 turns  |
| Normal vs Easy   | 171–29 (85.5%)                                                           | ~26 turns  |
| Normal vs Normal | 85–115; seat 0 won 46.6% of 399 separate games (no meaningful seat bias) | ~28 turns  |

## Next: M3, Playable client vs bot

- `apps/client`: Vite, PixiJS v8 and Preact. Body view, path painting, radial menu, order drawer, submit, turn replay (§10.5), and results.
- Skirmish against `@swarm/bot` in a Web Worker. Procedural art for the asteroid, cells, veins and cores. Synthesized SFX. PWA shell.
- Acceptance: a full Single Rock game is playable on a phone-size viewport (390×844 first); 60 fps on a mid-range phone profile; the Playwright smoke test passes.

## M1: Simulation core: done

Scope (§15): monorepo scaffold, `sim` with Single Rock, hex grid, Grow/Reinforce/Retract, contests, connectivity, starvation, income, victory. Base values only (no strains).

- [x] pnpm workspace with `packages/sim`, `tools/balance`. TypeScript strict, ESLint (typescript-eslint strict) and Prettier.
- [x] All CLAUDE.md commands exist: `install`, `dev` (no-op until M3 adds the client), `test`, `test:e2e`, `typecheck`, `lint`, `build`, `balance`. Extra: `pnpm golden:update`.
- [x] Sim purity enforced: the sim's tsconfig has no DOM or Node types, and lint forbids `Math.random`, trig, `Date`, and `for…in`.
- [x] `createGame` for Single Rock (§4.1–4.4): rock clusters with a flood-fill region check, deposits, guaranteed home deposits, and the starting colonies.
- [x] `validateOrder` / `validateOrderSet` / `listLegalOrders` (§5.1–5.2).
- [x] `resolveTurn` phases 2–5, 8–10, 15–16 (§5.3–5.5, §3 victory).
- [x] `hashState`, `serialize`, `deserialize`, named sfc32 RNG streams (§9.2–9.3).
- [x] Acceptance: unit tests for every §5 rule (`packages/sim/test/validate.test.ts`, `resolve.test.ts`).
- [x] Acceptance: property tests (`property.test.ts`): invariants, junk-order fuzzing, determinism, key-order independence, and mirror symmetry.
- [x] Acceptance: 20 golden replays committed (`packages/sim/test/golden/replays.json`), checked in Node (Vitest) and Chromium (Playwright); WebKit runs in CI.
- [x] Acceptance: `pnpm balance -- --games N` plays random-legal games to completion without errors.
- [x] CI workflow: typecheck, lint, test, build, a balance smoke run, and Playwright.

Ambiguities resolved during M1 are in `docs/DECISIONS.md`.

## Deferred to later milestones (by design)

- Phase 1 (drafts), phases 6–7 (launches, spores), 11–14 (fruiting, events, body rules, draft offers): M5/M6.
- Orbits, fixed-point trig table, `forecast()`: M5. (`isqrt` already exists.)
- Strains: M4 (Swarmer, Biofilm) and M6 (Predator, Sporer). `pnpm balance --strains` is accepted but ignored until then.
- The balance CI gate on strain win rates: M6.

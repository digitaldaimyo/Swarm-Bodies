# Progress

**Current milestone:** M3, Playable client vs bot: complete. **Next:** M4, Online multiplayer (SPEC §15).

## M3: Playable client vs bot: done

Scope (§15): Vite, Pixi and Preact client; Body view, path painting, radial menu, order drawer, submit, turn replay, results; skirmish against the bot in a Web Worker; procedural art for the asteroid, cells, veins and cores; synthesized SFX; PWA shell.

- [x] `apps/client`: Vite 8, PixiJS 8.22, Preact 10. `pnpm dev` serves it. The initial bundle is about 17 KB gzipped. The match, results and replay viewer (with PixiJS) are lazy-loaded chunks (§10.7: under 400 KB).
- [x] Screens: title (animated SVG slime), skirmish setup (Easy or Normal bot, seed), settings (audio levels, haptics, reduce motion, replay speed), match, results (dominance graph, stats, watch replay, rematch), and a full-game replay viewer. A skirmish in progress is saved and can be continued.
- [x] Body view (§10.2–10.4): seeded procedural asteroid (noisy rim, craters, grit), boulder rock, crystal, pod and fleck deposits, and a two-layer parallax starfield. Colonies have biomass-thick veins, glow by biomass, pulsing cores, flow motes travelling toward cores, and desaturated, slowly pulsing disconnected cells. Hex outlines fade in when zoomed; biomass numbers show when zoomed or on long-press.
- [x] Input (§10.3): Pointer Events. One finger paints from own connected cells or pans; pinch zooms; two fingers pan. Wheel zoom, right-drag pan, Esc, Z (undo) and Enter (submit) on desktop. Haptic ticks while painting and on submit.
- [x] Planning: live sim validation and cost, a ghost path with assault previews ("9 vs 3", green or red, "?" when uncertain), a radial menu with reasons for illegal actions, the order drawer (tap to focus, swipe or ✕ to delete), undo, and HUD (nutrients, planned cost, income, turn ring, ready markers, dominance bar with the 60% mark).
- [x] Turn replay (§10.5): frames built from sim events: prep, each growth step (tendrils, collision splashes, capture flips, core bursts), starvation fades, and income "+N". Pause, 1×/2× and skip; reduce-motion mode; auto-framing; a "what happened" log where tapping an entry focuses the camera. The last frame is always the real resolved state.
- [x] Bot in a Web Worker (§9.5). It plans as soon as a turn starts, and its orders stay sealed until submit.
- [x] Synthesized audio (§10.6): squelch, crunch, thud, click and tick, plus an ambient pad that brightens as the game goes on. Master, effects and ambience sliders. Audio starts on the first gesture.
- [x] PWA (§10.7): manifest, icons rasterised at build time from one SVG (`apps/client/build/icon.svg`), and a Workbox service worker precaching the app shell. Safe-area insets; portrait and landscape layouts.
- [x] Acceptance: a full Single Rock game is playable to the end at 390×844 (Playwright smoke test, plus manual screenshot review at 390×844, 844×390 and 1440×900).
- [x] Acceptance: Playwright smoke test (`e2e/smoke.spec.ts`). It uses a real touch drag (CDP) to paint, then submits, watches the replay, and finishes against the Easy bot with an accelerated scripted player.
- [~] Acceptance: 60 fps on a mid-range phone profile. `e2e/perf.spec.ts` (a CI regression check of CPU work under a 4× throttle, plus a structural guard against per-swap geometry rebuilds) passes. **Open item: real-device validation on a mid-range Android phone and an iPhone 12**, per DECISIONS #33.
- [x] Client unit tests (`apps/client/test/logic.test.ts`): hex layout, path painting (including routing around rock), the planner and assault preview against the sim, replay timeline reconstruction over whole games, the event log, and skirmish save/restore.

## Next: M4, Online multiplayer

- `packages/protocol` (zod message schemas), `apps/server` (Fastify, WebSocket, Postgres via Drizzle).
- Guest accounts; create and join by code; live and async timers; sealed orders; hash verification; reconnects; Web Push; bot takeover after 3 missed turns.
- Swarmer and Biofilm strains in the sim (§7.1), and strain support in `tools/balance`.
- Acceptance: two browsers complete a live game; an async game survives a server restart; a deliberate hash mismatch is detected and recovered; server tests pass.

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

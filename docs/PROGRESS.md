# Progress

**Current milestone:** M4, Online multiplayer: complete. **Next:** M5, The system (SPEC §15).

## M4: Online multiplayer: done

Scope (§15): `protocol`, server, guest accounts, create/join by code, live and async timers, sealed orders, hash verification, reconnects, Web Push, bot takeover; Swarmer and Biofilm strains.

- [x] Strains (§7.1): Swarmer and Biofilm as per-player modifiers in the sim config, used by validation, resolution, the bot, client previews and `pnpm balance -- --strains a,b`. `packages/content` holds strain text, generated from the sim's numbers. The golden replays were regenerated (state shape changed; orders and results identical).
- [x] `packages/protocol`: zod schemas for every WebSocket message and REST payload, validated on both ends.
- [x] `apps/server` (Fastify, @fastify/websocket, Drizzle + Postgres):
  - Guest accounts; create and join by invite code; lobby strain picks; host start; quick match.
  - Sealed orders, re-validated with the sim; unsubmit.
  - Resolution when everyone is in or at the deadline. It is idempotent: a per-game advisory lock plus a unique `(game, turn)` row.
  - Live timers, plus an async deadline sweeper every 30 s.
  - State rebuilt from snapshots (every 10 turns) plus orders, with each hash checked.
  - Normal-bot takeover after 3 missed live turns, shown to everyone and released when the player submits.
  - Web Push: "your turn", and a reminder 1 h before the deadline.
  - `GET /api/replays/:id`.
- [x] Client online play:
  - Online hub: your games with a "your turn" badge; create live or async with the timer presets; join by code or link; quick match; turn notifications.
  - Lobby: invite code, Web Share, players, strain picks, start.
  - Match screen: timer ring countdown, ready and presence markers, a BOT badge on takeover, unsubmit.
  - Local hash verification, with report, refetch and replace on a mismatch.
  - Reconnect with backoff; IndexedDB drafts per (game, turn); full-game replay from the server at the end.
- [x] Acceptance: **two browsers complete a live game** (`e2e/online.spec.ts`).
- [x] Acceptance: **an async game survives a server restart**. `apps/server/test/async.test.ts` covers 12 turns across the turn-11 snapshot, a pending sealed submission, and a restart. The state is rebuilt with a matching hash, the sweeper resolves the missed deadline, and the turn numbering carries on.
- [x] Acceptance: **a deliberate hash mismatch is detected and recovered**. `e2e/online.spec.ts` corrupts one browser's state; that client reports it, refetches, matches the other browser, and play continues. The server records the report (`apps/server/test/play.test.ts`).
- [x] Acceptance: **server tests pass**: 15 tests against Postgres (REST, sealed orders, illegal and malformed orders, deadlines, bot takeover, idempotent resolution across two engines, reconnect, a full game and its replay, push, restart).
- [x] Also: a dropped connection reconnects and catches up (e2e).

**Open items for the user:**

- **Strain balance:** Normal-bot Swarmer beats Biofilm in about 98% of Single Rock games (DECISIONS #36). That is M6's balance work, but the numbers are the spec's, so retuning them is a design call.
- **Real devices:** 60 fps on real devices is still to be confirmed (from M3).
- **WebKit:** WebKit e2e runs only in CI; this container has Chromium only.

Running locally: Postgres 16 (`postgres://swarm:swarm@localhost:5432`). Set `TEST_DATABASE_URL=postgres://swarm:swarm@localhost:5432/postgres` for the server tests; `pnpm test:e2e` starts the server on `swarm_e2e` (created if missing; override with `E2E_DATABASE_URL`). `pnpm dev` runs the client (Vite proxies `/api` and `/ws`) and the server (`DATABASE_URL`, default `postgres://swarm:swarm@localhost:5432/swarm`).

## Next: M5, The system

- Multiple bodies (`playerCount + 2`, 4–7), the four body types (§4.3), orbits with the fixed-point trig table and launch windows (§4.5).
- Fruit, Launch, spores and landings (§5.1, §6); solar flares and comets (§8); `forecast()`.
- Client: System view, body strip, launch flow, forecast strip; the bot uses launches.
- Acceptance: the full rules in §4–8 implemented and tested; the bot uses launches; golden replays extended to 50.

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
- Strains: Predator and Sporer arrive in M6 (Swarmer and Biofilm shipped in M4).
- The balance CI gate on strain win rates, and the strain balance itself: M6.
- Ratings, seasons, Daily Seed (`GET /daily`), campaign, codex: M7.

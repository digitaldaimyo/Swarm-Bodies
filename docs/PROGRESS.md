# Progress

**Current phase:** spec 1.0 is feature-complete. All milestones M1–M8 are done and merged, the game is deployed, and real-device playtests are under way. **Next: an intensive tutorial planning pass** (see "Next" below). Updated 2026-11-14.

## Status (2026-11-14)

- **Deployed:**
  - **Render:** the game server and client.
  - **Neon:** Postgres.
  - **GitHub Pages:** a second front door for the client (DECISIONS #104).
  - **Deploys:** `main` deploys on merge.
- **Real devices: validated by the user** on Android and iPhone, including large systems: no slowdown or lag noticed. This closes the M3 and M8 real-device items (DECISIONS #119).
- **Balance:** the user judges it a very close first attempt that needs only minor tweaking. It is close enough that further play still gives valid insight and data (DECISIONS #120).
- **Play feel (user):**
  - The game is fun, and strategy matters and is flexible.
  - Comeback moments happen.
  - The bots are genuinely challenging, perhaps too much so for early campaign nodes.

### Next

1. **Tutorial: an intensive planning pass**, before any code.
   - **The problem:** there is real depth to on-ramp.
   - **Ideas from the user:**
     - "Mini-world" challenges in small, contrived scenarios: zooming in reveals biomass, using terrain, battle mechanics.
     - A narrator character, a space-cat xenobiologist, who appears now and then. The same voice would enrich the Codex.
     - A deeper Codex that brings the universe to life.
2. **Easier bots on early campaign nodes** (DECISIONS #121).
3. Then the open items below.

### Open items

- **Browsers:** Firefox and Samsung Internet (§10.7) have not been tested. CI covers Chromium and WebKit.
- **Design reviews pending with the user:**
  - Spec numbers changed in balancing (DECISIONS #71, #82).
  - Campaign node 8's twist (DECISIONS #83).
- **Spec questions:**
  - §16 lists preset emotes as the alternative to chat. Are emotes in v1? Not built yet.
  - The notifications toggle lives in the Online hub, not Settings (§10.1, item 9).
  - §17's open questions need more playtest data.
- **Code health:** `apps/client/src/render/view.ts` (about 2,300 lines) does input, camera, colonies, colony life, readouts and replay. Split it into layers before v1.1 features.
- **Rendering tests:** no test checks what a GPU actually draws (the stray-arc bug, DECISIONS #116). A few screenshot-diff scenes would cover the worst of it.

## After M8: deployment, playtests and the colony life pass (PRs #9–#17)

- [x] **Deployment** (PR #9): Render, Neon and Pages (DECISIONS #104).
- [x] **Playtest 1** (PR #10):
  - Combat is taught on campaign node 1.
  - The Codex gains a "How to play" tab (DECISIONS #105).
- [x] **Playtest 2** (PR #11):
  - Deposit badges under colonies.
  - A turn's replay tours every body with action.
  - The replay viewer gains a scrubber and body switching (DECISIONS #106–#108).
- [x] **Colony life pass** (PRs #12–#16; plan and results in `docs/plans/colony-life.md`, DECISIONS #109–#115):
  1. Supply-tree vessels and a translucent colony body.
  2. A heartbeat that flows outward from each core, paced by defense, plus starvation rims.
  3. Nutrient motes along supply routes, and a "Colony detail: Full / Calm" setting.
  4. Long-press readout (supply route, defense split) and the fruiting sparkle.
  5. Strain personality, and frontier feelers.
- [x] **Playtest 3** (PR #17):
  - Stray lines on rings and rims.
  - Orders redrawn after switching bodies.
  - A decluttered System view (DECISIONS #116–#118).

## M8: Polish: done

Scope (§15): audio mix pass, tutorial pacing, accessibility audit against §10.8, performance pass on target devices, landscape and portrait layouts, error states, empty states, and loading states.

- [x] **Acceptance: Lighthouse PWA and accessibility ≥ 90.** `e2e/lighthouse.spec.ts` (Lighthouse 11, mobile emulation) scores PWA 100, accessibility 100 and best practices 100. `e2e/a11y.spec.ts` runs axe (WCAG 2.1 AA) on every screen at 390×844, the match HUD and results included.
- [x] **Acceptance: no console errors in the Playwright suite.** A shared fixture fails any test with an uncaught exception or `console.error` on any page. All 22 Chromium e2e tests pass with it (DECISIONS #95).
- [x] **Accessibility (§10.8):**
  - Colourblind pattern overlays per seat.
  - Text size 100%, 125% and 150%.
  - Contrast fixes.
  - Zoom is no longer blocked.
  - Roles on the labelled HUD elements, and tooltips on icon buttons.
  - The HUD is reachable by keyboard, and tested.
- [x] **Layouts:** landscape phones put the HUD at the sides and the title beside its menu. Tested at 844×390.
- [x] **Error, empty and loading states:**
  - An error boundary turns a crash, or a screen that cannot load offline, into a recoverable message.
  - An unreachable server shows Retry and explains that the leaderboards are unavailable.
  - An unknown replay link fails politely.
  - Tested with route blocking.
- [x] **Audio mix:** a limiter, voice dedupe and cap, rebalanced levels, new sounds (submit, starvation, income, flare, stingers), pad ducking during replays, and suspend in background tabs.
- [x] **Tutorial pacing:** the fruit, launch and capture steps wait until the player can do them, and every action step can be skipped.
- [x] **Performance:** Hard on 4-player systems: mean 54 → 39 ms, p95 133 → 103 ms. Bot decisions are identical before and after; golden replays are unchanged.

**Open items for the user (at the end of M8):**

- **Real devices:** done. The user validated Android and iPhone on 2026-11-14 (DECISIONS #119).
- **WebKit:** the new a11y and state tests are written to handle WebKit (DECISIONS #103), but WebKit runs only in CI here.
- **Unplaytested:** campaign difficulty and tutorial pacing with real players, and 3–4 player balance.
- **§17 open questions** are unchanged, ready for playtests.

## M7: Progression and replayability: done

Scope (§15): campaign (12 nodes with tutorial), codex, achievements, Daily Seed with server validation, ranked ladder with Glicko-2 and seasons/sectors, shareable replays, cosmetics.

- [x] **Content (`packages/content`):**
  - **Campaign:** 12 nodes on a branching graph, with modifiers, twists and unlocks.
  - **Achievements:** 32, as predicates over a game summary, which `summarizeGame` builds by replaying the game.
  - **Also:** modifiers and ranked sectors, seasons, cosmetics, Daily setup and scoring, and progress with a union merge (DECISIONS #83–#91).
- [x] **Client:**
  - **Campaign map:** a node graph with briefings; it is lazy-loaded.
  - **Tutorial:** scripted overlays on nodes 1–3.
  - **Codex:** strains, mutations (filled by drafting), and achievements.
  - **Gating:** campaign unlocks gate the offline strains and the draft pool.
  - **After a game:** rewards are shown on the results screen.
  - **Cosmetics:** chosen in Settings.
  - **Daily Seed:** its own screen with a leaderboard.
  - **Ranked:** the queue and ladder are in Online.
  - **Replays:** `/replay/:id` links, and replay files saved from results and opened in Settings.
  - Every screen was checked at 390×844 first.
- [x] **Server:**
  - **Migration `0001`:** adds the progress, Daily score and rating tables, plus the ranked fields on games.
  - **Endpoints:** `GET/PUT /api/progress`, `GET/POST /api/daily` (replayed against the deterministic Normal bot), `GET /api/ladder`, and ranked queues with sector rules.
  - **Ratings:** Glicko-2 matches Glickman's worked example, with pairwise FFA.
- [x] **Generation fairness and bot fix** (found through the campaign test, DECISIONS #80, #81). Every home now gets an early launch window: 2- and 3-player systems 60/60 seeds by turn 4, 4-player 48/60 (was 32, 19 and 8/60).
- [x] **Retune** (DECISIONS #82): Sporer Fruit 7 → 9 N, Hardened Spores +2 → +1, Biofilm max biomass 12 → 11. 960-game matrix, 2-player systems, default seeds:

  | Pair                | Side A wins |
  | ------------------- | ----------- |
  | Biofilm vs Predator | 58.1%       |
  | Biofilm vs Sporer   | 45.0%       |
  | Predator vs Sporer  | 51.9%       |
  | Swarmer vs Biofilm  | 50.6%       |
  | Swarmer vs Predator | 48.1%       |
  | Swarmer vs Sporer   | 49.4%       |
  - Average length: 23.8 turns. Stalls: 0.9%.
  - Highest mutation pick win rate: 56.9% (Acid Tendrils).
  - CI gate (200 games): passes. Its worst pair is 67.6% against the 70% limit, from small-batch noise.

- [x] **Acceptance: the campaign is completable.** `tools/balance/test/campaign.test.ts` plays every node in order, using only what is unlocked so far. The e2e test plays node 1 through the UI, and the win opens node 2.
- [x] **Acceptance: the daily leaderboard works.** Server tests cover replay validation, rejections, the best run and streaks. The e2e test plays the Daily, and the score appears on the leaderboard.
- [x] **Acceptance: a replay link plays back a finished online game.** The e2e test has two browsers finish a game, and a third opens `/replay/:id`.
- [x] **Golden replays** regenerated deliberately: 27 of 50 replays changed orders (all system replays; Single Rock unchanged), from the generation and tuning changes.

**Open items for the user:**

- **Please review the retune** (DECISIONS #82) and the campaign twist change: node 8 is "launch at most 2" instead of "win without launching" (DECISIONS #83).
- **Achievements are trusted from the client.** They only grant cosmetics, so a cheater gains nothing (DECISIONS #86).
- **Campaign difficulty for real players** is untested. Completability is shown by Hard-bot stand-ins.
- Still open from earlier milestones: 3–4 player balance, Hard's speed on phones, real-device 60 fps, and WebKit e2e (CI only).

## M6: Strains, mutations, and balance: done

Scope (§15): Predator and Sporer; the draft system and all 12 mutations; the `content` package; balance tooling and the CI gate.

- [x] **Strains:** Predator and Sporer as strain modifiers (DECISIONS #67, #71).
- [x] **Mutations and drafts:**
  - All 12 mutations are data plus hooks (`packages/sim/src/mutations.ts`).
  - Drafts trigger at 40, 90 and 160 total biomass, offer 3 options, and are picked by a Draft order or assigned.
  - Every mutation and the draft flow have unit tests (`mutations.test.ts`).
- [x] **Content:** strain and mutation text, with rule lines generated from the sim's numbers, plus flavour and microbiology notes for the codex.
- [x] **Balance tooling:**
  - `pnpm balance -- --matrix` checks every §12.4 target; `--jobs N` runs in parallel and `--rules` overrides tunables.
  - The CI gate runs a 200-game deterministic batch (DECISIONS #74).
- [x] **Acceptance: §12.4 targets met at Normal.** 960-game matrix on 2-player systems with the default seeds:

  | Pair                | Side A wins |
  | ------------------- | ----------- |
  | Biofilm vs Predator | 56.3%       |
  | Biofilm vs Sporer   | 42.5%       |
  | Predator vs Sporer  | 53.1%       |
  | Swarmer vs Biofilm  | 51.9%       |
  | Swarmer vs Predator | 45.6%       |
  | Swarmer vs Sporer   | 50.0%       |
  - Average length: 24.2 turns (target 18–28).
  - Stalls: 0.8% (target under 5%).
  - Highest mutation pick win rate: 57.1%, Radiation Shielding (target at most 58%).
  - Pooled with a second seed set, every target still holds; the second set alone has Swarmer vs Biofilm at 60.6% (noise is about ±4% a pair).

- [x] **Acceptance: Hard bot shipped.** It beats Normal 85% on Single Rock and 60% on systems, and is tested for legality, determinism and budget (DECISIONS #73).
- [x] **Acceptance: draft UI complete.**
  - A modal with three cards: tap to inspect, tap again to pick, or decide later and reopen from the HUD.
  - Glyphs show every player's mutations.
  - Four strains in every picker; Hard bot in skirmish; e2e coverage.
- [x] **Found while balancing:** unreachable launch windows, unclaimable Irradiated bodies, bots that never fruited ahead or spent surplus N, and systems with no neutral body. All fixed and tested (DECISIONS #68, #69, #72).
- [x] **Golden replays** regenerated deliberately. The 50 replays include 73 draft picks covering all 12 mutations.

**Open items for the user:**

- **Spec deviations from balancing:** DECISIONS #71 lists every number changed against the spec's tables. Please review: Swarmer's entry discount, Biofilm's support 2, the 60% dominance and the flare rule are the big ones.
- **3–4 player balance** has not been measured; the targets are 1v1. Single Rock (a test map) is not balanced either.
- **Hard's speed:** Hard averages about 55 ms a turn here, but reaches about 200 ms on 4-player systems. That needs checking on phones (the budget is 200 ms).
- Real-device 60 fps and WebKit e2e (CI only) are still open from earlier milestones.

## M5: The system: done

Scope (§15): multiple bodies, orbits, System view, body strip, Fruit/Launch/spores, launch windows and forecast, solar flares, comets, and all four body types.

- [x] Sim (§4–8):
  - Systems of `playerCount + 2` bodies (clamped to 4–7), on distinct orbits with integer periods and phases. Positions use the fixed-point trig table (`trig.ts`, sin × 10000); distances and launch range are exact integer comparisons.
  - Fair homes: of all assignments, the one with the smallest spread of nearest-neutral distance at turn 1. A home core starts with 2 adjacent cells, and an organic and an ice deposit 2–3 cells away.
  - Body types: Carbonaceous, Icy, Metallic (+2 max biomass), and Irradiated (+50% deposits; burns away non-core biomass-1 cells).
  - Fruit (10 N, biomass ≥ 5, matures in 2 turns, at most 2 at once) and Launch (range 6, plus strain bonus). Spores travel `ceil(distance / 3)` turns, fixed at launch, and land as a core (biomass 3): on empty cells, on own cells, or capturing a weaker enemy cell; ties kill each other.
  - Solar flares every 7–10 turns: −2 biomass on sun-facing cells, with a warning the turn before. Comets every 10–14 turns: a +5 N deposit for 6 turns, with a warning 2 turns ahead. `forecast()` gives launch windows and scheduled events.
  - Elimination waits for a player's spores in flight.
  - 35 new rule tests, plus property tests for system invariants.
- [x] Golden replays extended to **50** (20 Single Rock + 30 system, 2–4 players, every strain). They include 82 Fruit and 28 Launch orders. The 20 Single Rock replays kept identical orders and results through the state-shape change.
- [x] Bot (§13.2):
  - Launches mature fruiting bodies at the best body in range (unclaimed room, deposits, capturable cells).
  - Fruits when the forecast shows a window opening after maturity.
  - Reinforces a fruit site toward biomass 5 when none qualifies yet.
  - Puzzles cover each case. **Normal bots launch in every sampled system game** (acceptance), and `pnpm balance -- --map system` reports launches.
- [x] Protocol and server: games are `singleRock` (2 players) or `system` (2–4 players). Defaults and quick match are 2-player systems. Replays carry the map. A 3-player system game is created, filled and started in the server tests.
- [x] Stored states from before M5 are upgraded on load (`upgradeState`). Startup restore skips, and logs, a game it cannot load, instead of exiting.
- [x] Client:
  - **Body view** shows any body; only the shown body is rendered.
  - **System view** (Pixi): the star, orbits, ownership rings, alert dots, launch range, and spores in flight on curved arcs. Open it from the body strip or by pinching out past the whole body; tap a body to open it.
  - **Body strip**, with ownership rings and alert dots for contested bodies and off-screen action.
  - **Radial menu** gains Fruit, and Launch on mature fruiting bodies (greyed out with the next window when nothing is in range).
  - **Launch flow:** pick an in-range body in System view, then a landing cell.
  - **Forecast strip** for the next 6 turns: windows, flares and comets.
  - **Art:** fruiting stalks that grow and glow when mature, comet shards, landing markers for your own spores, and a sun-direction marker.
  - **Replays:** launch, landing, flare and comet effects, with a launch "thoom". The event log covers all the new events.
  - **Skirmish setup:** asteroid system or Single Rock, 1–3 bots, and system size (compact, standard or wide). Online "create game" offers 2–4 players.
- [x] e2e:
  - The smoke test pins Single Rock, and a new system smoke test covers the strip, System view, a body switch and a full 3-player game with launches.
  - The online tests now play systems.
  - Perf adds a 4-player system run. Body view and System view each stay under the same budgets: p95 2.8 ms and 2.4 ms under 4× throttle.

**Open items for the user:**

- **Balance (M6):** on systems, Normal mirrors reach the turn limit with nobody above 40% dominance in about 80% of games (20-game sample; target under 5%, §12.4). Spores and the 40-turn limit interact here: the turn limit, the 60% threshold and the launch and spore numbers are all M6 tuning.
- **Strains on systems:** Normal Swarmer beats Biofilm in 78% of system games (50-game sample; 98% on Single Rock). CI now runs this batch as a smoke check, without asserting the rate.
- The sun-direction marker sits on the body on very wide screens; the M8 polish pass should revisit it.
- Strain balance (DECISIONS #36), real-device 60 fps, and WebKit e2e (CI only): as below.

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
- **Real devices:** confirmed by the user on 2026-11-14 (DECISIONS #119).
- **WebKit:** WebKit e2e runs only in CI; this container has Chromium only.

Running locally: Postgres 16 (`postgres://swarm:swarm@localhost:5432`). Set `TEST_DATABASE_URL=postgres://swarm:swarm@localhost:5432/postgres` for the server tests; `pnpm test:e2e` starts the server on `swarm_e2e` (created if missing; override with `E2E_DATABASE_URL`). `pnpm dev` runs the client (Vite proxies `/api` and `/ws`) and the server (`DATABASE_URL`, default `postgres://swarm:swarm@localhost:5432/swarm`).

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
- [x] Acceptance: 60 fps on a mid-range phone profile.
  - `e2e/perf.spec.ts` passes: a CI regression check of CPU work under a 4× throttle, plus a structural guard against per-swap geometry rebuilds.
  - Real-device play on Android and iPhone, large systems included, showed no slowdown (user, 2026-11-14; DECISIONS #119).
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

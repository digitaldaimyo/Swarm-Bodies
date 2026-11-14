# Decisions

Rulings on ambiguous or unspecified points in `docs/SPEC.md`, as CLAUDE.md requires. Each picks the simplest reading consistent with the pillars (§1). Revisit any of them with the user.

## 2026-11-11 — M1 simulation core

1. **§5.1 Grow path shape.** `path[0]` is the start cell (an own connected cell) and `path[1..]` are the cells grown into. Reach limits `path.length − 1`, counting own pass-through cells, because reach is a geometric limit. A path with no new cells is rejected as pointless.
2. **§5.4 Feeder with pass-through cells.** A new cell's feeder is the path cell immediately before it: the start cell, an own pass-through cell, or the previous new cell. With no pass-through cells this is exactly the spec's wording; with them, "the cell it grew from" is the adjacent one.
3. **§5.4 Losing part of a path mid-turn.** At each step, every path cell from the previous new cell (or the start) up to the feeder must still be the player's own on the start-of-step board. Otherwise the path halts (`PathHalted`, reason `brokenPath`). This can only happen to own pass-through cells captured in an earlier step.
4. **§5.4 "Other" adjacent attacker cells.** Attack counts the attacker's colony cells adjacent to the target, excluding the feeder (it is already counted as `feeder.biomass`). Connectivity does not matter for attack.
5. **§5.4 Connectivity during growth.** Defender support counts the owner's _connected_ cells adjacent to the target, using connectivity recomputed at the start of each growth step, consistent with "pressure uses the board as it stands at the start of each step".
6. **§5.4 Tied assaults.** A tie between the top attackers on an owned cell emits `CellStalemate`, as on empty cells. The defender takes no damage, and all of those attackers halt.
7. **§5.4 Captured biomass cap.** Captured cells are capped at the normal-cell maximum (9), because a captured core is destroyed and becomes a normal cell.
8. **§5.1 Order conflicts within a set.** A retracted cell cannot also be a grow start, a cell in any own grow path, or a reinforce target, in either order. Reinforce is rejected on a cell already at max biomass. The retract refund (+1 N) is paid in phase 3, so it does not count toward the planning budget.
9. **§5.3 phase 2.** Orders are revalidated in submission order, each one against the start-of-turn state plus the orders accepted before it. An invalid order is dropped on its own; the rest of the set still applies.
10. **§4.1 Single Rock layout.** The body is Large and Carbonaceous. The two start cores sit at distance R−1 from the centre, on opposite ends of a random hex axis. The map is point-symmetric through the centre, so both players get identical positions (pillar 3, "fair"). Random rock and deposits stay at least 3 cells from each start core. The guaranteed Organic and Ice deposits are 2–3 cells away, never on a starting cell.
11. **§3 Simultaneous elimination.** If every player is eliminated in the same resolution, the game is a draw. Eliminated players' leftover cells have no core, so they are disconnected and starve through the normal phase 9 rule. That gives the spec's "−1 per turn, then removed".
12. **§3 Turn numbering.** `state.turn` is the turn being planned and starts at 1. The turn-limit check runs while resolving turn 40, so a game lasts at most 40 resolutions. `GameResult.turn` is the turn that was being resolved.
13. **§9.2 Hash function.** `hashState` is cyrb128 (128 bits, 32 hex characters) over the canonical JSON serialization, rather than the spec's example FNV-1a. It is equally stable, fast, and integer-only, and it reuses the RNG's seed hash.
14. **§9.2 Rules in state.** `GameState.rules` holds the full resolved copy of `config.ts`, plus any per-game overrides. That makes a state self-describing and lets the balance tool vary numbers per game. Golden hashes therefore change whenever a tunable changes, which is intended.
15. **Random-legal player location.** `randomOrderSet` lives in `packages/sim`. It is pure and deterministic, and only uses the public validation API. Property tests, golden replays and `tools/balance` all need it, and the bot package does not exist until M2.
16. **§9.3 WebKit golden run.** The Playwright golden test runs Chromium everywhere, and WebKit in CI (or locally with `PW_WEBKIT=1`), because not every dev machine has the WebKit build.

## 2026-11-11 — M2 bot

17. **Bot weights live with the bot.** CLAUDE.md puts every tunable in `packages/sim/src/config.ts`. That rule is about game rules (the spec's "(tunable)" numbers). The bot's scoring weights are AI tuning, not rules, so they live in `packages/bot/src/weights.ts`. Changing them never moves golden hashes.
18. **Floating-point scoring in the bot (§9.2, §13.1).** The sim stays integer-only. The bot scores candidates with floats but uses only `+ − × /`, which IEEE 754 makes identical in every JS engine. Trig, `pow`, `Math.random` and `Date` are banned by the same lint rules as the sim. So the bot is still deterministic given its inputs, on server and client.
19. **Hard difficulty before M6.** `chooseOrders(…, "hard", …)` plays exactly like Normal until the 1-ply robustness check ships in M6.
20. **Personalities (§13.3) are weight presets.** `chooseOrders` takes an optional fifth `options` argument (`personality` or raw `weights`) beyond the spec's signature. Omitting it gives the spec's behaviour. The presets exist now so M7 campaign nodes can use them.
21. **Threat model.** The bot estimates step-1 assaults only: an adjacent connected enemy cell's biomass plus that enemy's other cells adjacent to the target. It treats an attack that already beats the defense as a 50% loss risk, and one that needs the enemy to reinforce first as 20%. It values a reinforce by the expected loss it avoids. The bot never retracts in M2; Fruit and Launch arrive with M5.
22. **Easy's "random top-3 per slot".** Each greedy slot is filled by a uniform pick among the top three candidates that still fit the plan. On each turn, a coin flip (from the bot's seeded stream) decides whether Easy ignores threats: no reinforce candidates and no contest risk. Easy never adds sever value.
23. **Balance CLI seats.** `--players a,b` sets the two policies, and seats alternate every game, so neither side is always player 0. The default is `normal,normal`, the configuration future strain balance runs use.

## 2026-11-12 — M3 playable client

24. **Skirmish is untimed (§3, §10.2).** The turn timers are for online play. In an offline skirmish the turn ring shows progress toward the turn limit instead of a countdown, and the bot's ready marker lights when its worker has chosen orders.
25. **Seats in skirmish.** The human is always player 0 (cyan) and the bot player 1 (magenta). Single Rock is point-symmetric, so the seat doesn't change the position.
26. **Radial menu before M5 (§10.2).** It offers Reinforce and Retract, each greyed out with the sim's own reason when illegal, plus "Cancel order here" when an order uses the cell. Fruit and Launch are left out until the sim has them (M5), rather than shown permanently disabled.
27. **Starting a paint.** A drag paints only when it starts on an own, connected cell during planning. Any other drag pans. The painted path follows the finger by breadth-first search within the remaining reach, so it routes around rock. If the finger is out of reach, the path walks straight toward it.
28. **Colony art without filters (§10.4, §10.7).** The spec suggests a metaball or blur-threshold filter. Colonies are instead overlapping discs, straight bands between neighbours, and filled triangles between any three mutually adjacent own cells, with a soft halo. That reads as slime and avoids a full-screen filter pass every frame on phones. Static art (asteroid, terrain) and the colony layer are cached as textures; the colony's cache bounds are pinned to the body so redraws reuse one texture.
29. **"60 fps on a mid-range phone profile" (§15 M3).** `e2e/perf.spec.ts` emulates the phone with Chromium's 4× CPU throttle at a 390×844 phone viewport. It asserts the main-thread cost per frame: median under 5 ms, and p95 (replay board swaps) inside one 16.7 ms frame. It does not assert raw requestAnimationFrame rates. GPU-less hosts (CI runners, this repo's dev containers) render WebGL in software (SwiftShader), so raw frame rates there measure the host CPU's fill rate rather than a phone GPU. For the same reason the test defaults to device pixel ratio 1; set `PERF_DPR=2.75` on a machine with a GPU. A real-device check is still listed as an open item in PROGRESS.md.
30. **Saving a skirmish.** The game in progress is saved to `localStorage` as seed plus every turn's orders plus the current draft, and rebuilt by replaying through the sim (§9.4's "reconstructable from the seed plus the orders"). IndexedDB drafts keyed by `(gameId, turn)` arrive with online play in M4.
31. **E2E hook.** With `?e2e` in the URL, the match screen exposes `window.__swarm`: phase, turn, the view, and an `autoplay` flag that plays the human's turns with the Normal bot policy and skips replays. This is the "accelerated scripted player" of §14. The service worker is not registered in that mode.
32. **Fonts.** Fredoka (display) and Inter (UI, tabular figures) load from Google Fonts. The service worker caches them at runtime so the installed app still works offline.

## 2026-11-12 — Performance validation (PR #3 CI failure)

33. **CI regression checks versus real-device validation (§10.7, §15 M3).** The perf test failed on PR #3's first CI run (frame-time p95 19.1 ms against 16.7 ms). Investigation found three causes:
    - **A real cost.** Replay board swaps re-tessellated every vein and gap-triangle polygon (444 on the test board). That is 11–13 ms of CPU per swap at 4× throttle here, and about 18 ms on the slower CI runner, which matches the failing replay p95. It is fixed by drawing those shapes as pooled sprites (backported from M4); a swap now costs 1–7 ms at 4× throttle.
    - **A harness bug.** The e2e scripted player could submit one more turn after being switched off, so a replay animated inside the "idle" window (CI attempt 1: idle median 4.0 ms, p95 23 ms). It now re-checks the flag. The test also waits for real idleness: planning phase, a stable turn, and the bot's worker done.
    - **Unsound statistics.** CI renders WebGL in software at ~10 fps, so the fixed 3 s windows held 25–47 frames, and their "p95" was the second-worst frame. Idle is now sampled by count (120 frames).

    **What CI asserts** (a regression check of the code, at a 4× throttle relative to the runner):
    - idle and replay frame medians under 5 ms;
    - idle p95 within one 16.7 ms frame;
    - a board swap (redraw plus render, median of 7) under 16.7 − 5 = 11.7 ms, so a swap frame plus a typical frame's other work fits in one frame;
    - a hardware-independent structural guard: a swap rebuilds no per-cell geometry. This catches the original regression on any machine, which the timing budget alone does not on a fast host.

    Replay p95 is logged, not asserted: it is the swap frames (measured directly above) plus software-rasteriser stalls.

    **Real-device validation is separate**, because throttled timings are relative to the runner and CI has no GPU. Before each release candidate, and after any rendering change, run the M3/M5 benchmark scene on a physical mid-range Android phone and an iPhone 12. Attach Chrome or Safari remote devtools, or run `PERF_DPR=2.75` on a GPU-equipped machine as a first pass. Pass: a sustained 60 fps (no frame over 16.7 ms outside the replay's board swaps, none over 33 ms at all) mid-game on a Large body. Record the results in `docs/PROGRESS.md`. A device-farm job (real devices, not emulators) can automate this later; it should not gate pull requests.

## 2026-11-12 — M4 online multiplayer and strains

34. **Strain numbers (§7.1).** Strain modifiers live in `packages/sim/src/config.ts` with the other tunables. The `content` package holds names and fantasy text, and generates its rule lines from the sim's numbers so they cannot drift. A strain's "Max biomass" sets normal cells; cores keep the base +3 margin (Swarmer cores 10, Biofilm cores 15). Swarmer's −1 N entry cost still respects the 1 N minimum, and mineral cells still add +1.
35. **The "base" strain.** Players pick Swarmer or Biofilm. An internal `base` strain (the unmodified rules) remains for tests, golden replays and balance baselines. Adding `players[].strain` and `rules.strains` changed every golden hash, so the replays were regenerated; all 20 kept identical orders and results.
36. **Strain balance is not retuned in M4.** On Single Rock with the spec's numbers, Normal-bot Swarmer beats Biofilm in about 98% of games (usually by dominance around turn 11); the Swarmer mirror is 47/53. The spec makes balance M6's job (§12.4: every strain pair within 40–60%), and these numbers are not marked tunable, so changing them is a design decision for the user. **Flagged as an open item.**
37. **Server stack (§9.1).** Fastify 5 with @fastify/websocket and Drizzle ORM over postgres.js, with SQL migrations generated by drizzle-kit and applied at startup. Server tests run on a fresh database per file, either from `TEST_DATABASE_URL` or a Testcontainers Postgres when Docker is available. Without either they are skipped with a warning, so `pnpm test` still passes on a laptop without Postgres. CI sets the URL, so they always run there.
38. **Protocol additions (§9.4).** Beyond the spec's table:
    - `requestState`, for "the client requests the full state" after a hash mismatch.
    - `hashMismatch`, for "reports the mismatch to the server log".
    - `welcome`, the reply to `hello`.
    - `lobby`, for lobby snapshots.
    - `playerStatus`, for presence and bot takeover ("shown to everyone").
    - `ping`/`pong` keepalives, and `{ ok: true }` REST responses.

    Orders in `turnResolved` are keyed by seat.

39. **Missed turns and bot takeover (§3).** A missing submission resolves as an empty order set. After 3 consecutive missed turns in a live game, a Normal bot plays that seat from the next turn. Bot-held seats count as ready, so the others' submissions resolve the turn at once. Submitting orders again releases the bot. Async games never hand seats to the bot. The orders actually resolved (bot and empty sets included) are stored in `turn_results`, so restarts and replays never rerun the bot.
40. **Idempotent resolution (§9.4).** Each game's operations are serialised in-process. Resolution also takes `pg_advisory_xact_lock(hashtext(gameId))` and inserts the unique `(game_id, turn)` result row first. A second resolver (another trigger or another process) finds the row and does nothing.
41. **Deadlines (§9.4).** Live games use in-process timers, re-armed from Postgres at startup. A sweeper runs every 30 s and once at startup, and resolves any active game past its deadline, live or async. That is how an async game, or a live one, moves on after a restart. It also sends the async "1 hour left" push once per turn.
42. **Snapshots (§9.4).** A full state is stored at game start and whenever the state's turn is 11, 21, 31, …, plus at game end. Loading starts from the latest snapshot and replays the stored orders, checking every turn's hash against the stored one.
43. **Lobby and matchmaking.** The host starts the game once it is full; strain picks are locked at start. Quick match pairs two players of the same pace and starts at once with the default timer. The quick-match queue is in memory, so a server restart empties it; players simply queue again.
44. **Online maps.** Online games are Single Rock, 2 players, until the system arrives in M5.
45. **Deferred tables.** `ratings` and `daily_scores` arrive with the ranked ladder and the Daily Seed (M7). `GET /daily` is not implemented yet.
46. **Guest identity.** A guest is a random 256-bit bearer token stored as a SHA-256 hash, with a generated name like "Amber Spore 042". The client keeps the token in `localStorage`. Concurrent first calls share one guest-creation request.
47. **Perf test in M4.** The method is the one in #33 (it began on this branch and was backported to M3 when PR #3's CI failed). M4 adds only what its features need: the test plays a Biofilm mirror, so games last past turn 13 despite the Swarmer imbalance (#36), and it waits for the bot via the new ready markers.

48. **Deep links.** `/?join=CODE` (shared invite) joins and opens the lobby; `/?game=ID` (push notification click) opens that game.

## 2026-11-12 — M5 the system

49. **Fruit timing (§5.2, §6).** Fruit orders apply in phase 4, right after Reinforce and before growth. The cell starts maturing that turn: `fruitMatureTurns` counts down in phase 11, and a Launch is legal once it reaches 0. A fruiting cell cannot also be retracted in the same set.
50. **Launch legality (§6).** A Launch needs a mature fruiting body. Its target must be another body (`sameBody`) whose distance at the current turn is within range, compared exactly in integers. Fruit and Launch are rejected on Single Rock (`noLaunches`).
51. **Launch resolution (§6).** The launcher drops to biomass 1 and stops fruiting. If it was captured during growth, the launch fizzles. Travel time is computed at the launch turn and never changes.
52. **Landings (§6).** Spores aimed at the same cell on the same turn all die (`collided`). Otherwise a spore lands as a core:
    - On an empty cell or an own cell, at the landing biomass (an own cell keeps its biomass if higher).
    - On an enemy cell, against that cell's full defense, including support from connected neighbours. If the landing beats it, the spore captures the cell as a core at `landing − defense` (minimum 1), and a captured core counts as destroyed. If not, the defender loses 1 biomass (minimum 1).
53. **Irradiated bodies (§4.3).** The burn in phase 13 removes non-core cells at biomass 1; cores are spared, so a lone core cannot burn away.
54. **Flares (§8).** A cell is sun-facing when it lies on the star's side of the line through the body's centre, perpendicular to the star direction. The boundary is inclusive, and hex axes are fixed to the system's axes; the test is in integers. Struck cells lose 2 biomass; cores stop at 1, other cells die at 0.
55. **Comets (§8).** The struck cell is chosen at arrival, not at warning: a random empty, non-rock cell without a deposit, from the stream `comet:<turn>:<body>`. If there is none, the comet misses. Its yield counts as income only while the cell is connected.
56. **Spore targets are hidden in the UI only.** The lockstep state is shared, so every client holds every spore. The client shows the landing cell only for your own spores; everyone sees the target body.
57. **Homes and generation (§4.1).** Homes are chosen by brute force over all assignments: the one with the smallest spread of nearest-neutral distance at turn 1 wins. Ties go to the first in canonical order. Flares and comets are scheduled only in system games.
58. **Bot spore play (§13.2).** The bot values a launch by the target's income horizon, its unclaimed room and nearby deposits, and capture value. It values Fruit as a share (`fruitFaith`) of the best launch the forecast opens after maturity. When no cell has biomass 5, it reinforces the best fruit site toward it. Both weights live in `weights.ts`, next to the other bot weights.
59. **Maps online (supersedes #44).** Games are `singleRock` (2 players, a test map, §4.1) or `system` (2–4 players). New games and quick match default to a 2-player system. Replays carry the map.
60. **Stored states.** Snapshots written before M5 lack the system fields. `upgradeState` fills them with Single Rock defaults, so the state equals what a fresh game would hold and resolves identically. Stored hashes for those old turns no longer match the upgraded states; the server logs this and carries on. A game that still cannot load is logged and skipped at startup, so the server stays up.
61. **Skirmish options (§10.1).** "System size" maps to `systemExtraBodies` (compact 1, standard 2, wide 3), within the 4–7 clamp. All bots play the chosen bot strain. Saved skirmishes from earlier versions load as 1-bot Single Rock games.
62. **System view rendering.** The System view is drawn in screen space in Pixi, in the same canvas as the Body view, so there is no second WebGL context. Only one of the two is visible at a time. The body strip and forecast are DOM. Pinching out (or scrolling out on desktop) past the whole body opens the System view.
63. **Body art seeds.** Each body's art is seeded with `seed:bodyId`, so bodies in one system differ. This changed Single Rock's look, but not its rules.

## 2026-11-12 — M6 strains, mutations, and balance

64. **Mutations as data plus hooks (§7.3).** `mutations.ts` declares each mutation. Static changes (`adjust`) are applied to the player's rules after the strain. Per-contest hooks (`attack`, `defense`, `entryCost`, `reach`) run against the board being judged. Both run in mutation-ID order. Validation, the resolver, the bot and the client all use the same helpers from `rules.ts` (`attackOn`, `defenseOf`, `entryCost`, `reachFor`, `cellYield`, `incomeFor`), so a new mutation never touches the resolver.
65. **Drafts (§7.2).**
    - Thresholds are on total biomass across all cells, and each is offered once.
    - Only one offer is pending at a time; a later threshold waits for the pick.
    - A Draft order must be the first order of a set. Later orders are validated with the mutation already in effect.
    - Without a valid pick (none, or a rejected one), the first option is assigned in phase 1, and the turn's orders are judged with it.
    - Offers come from `draft:<player>:<index>`. That makes offers seat-dependent, so the mirror property test runs with drafts off.
66. **Mutation details.**
    - **Quorum:** the attack bonus is judged on the feeder cell; the defense bonus on the defended cell.
    - **Thick Veins:** applies to any cell next to an own core.
    - **Chemotaxis:** the reach bonus applies when the path's last cell is a deposit.
    - **Deep Reserves:** interest is paid on the N held at the income phase, after the turn's costs.
    - **Regeneration:** runs in phase 10, after income.
    - **Dormancy:** counts consecutive disconnected turns in `Colony.cut`, which resets on reconnection.
    - **Radiation Shielding:** covers both flares and the Irradiated rule.
67. **Predator feeding (§7.1).** A capture pays the defender's biomass in N at once, whether it comes from growth or from a spore landing.
68. **Launch windows guaranteed (§4.1, §4.5).**
    - **Reachability:** generation draws up to `orbitAttempts` (32) orbit layouts from the `system` stream. It keeps the first in which every home has a window to a neutral body by turn 4, and on at least 8 of the first 20 turns. If none qualifies, it keeps the fairest layout.
    - **Why:** before this, 38% of body pairs never came into range in 40 turns.
    - **Minimum bodies:** a system always has at least one neutral body. Home placement needs one; without it, the generated state had no players.
69. **Irradiated grace (§4.3).** New cells start at biomass 1, so "remove every biomass-1 cell" made Irradiated bodies impossible to grow on. Cells gained this turn (claimed, captured or landed) are spared once; reinforce them next turn or they burn.
70. **How balance is measured (§12.4).** The measure is 2-player star systems, Normal against Normal, with seats alternating and draws counting half. `pnpm balance -- --matrix` runs every pair of playable strains. "Pick win rate" means how often a player holding the mutation at the end of the game won. Targets are judged on 960-game matrices (160 games a pair). One-pair noise is about ±4%, and a second seed set shifts single pairs by up to about 10 points.
71. **Tuned numbers (§3, §4.1, §7.1, §7.3, §8).** These change values the spec states; they are all in `config.ts`. **Flagged for the user's review**, since several are spec table values.
    - Dominance to win: 60% → **50%**. With two even colonies the front lines lock, and 60% was rarely reached (§17 asks the same question).
    - Starting nutrients: 10 → **20**.
    - Bodies: `players + 2`, min 4 → **`players + 1`, min 3**. With two neutrals, each player took one and never met. One shared neutral body creates the contested hotspot.
    - Solar flares: −2 and removed at 0 → **−1, never below 1** (cores already were). They erased half of every thin colony and drove most stalls.
    - Swarmer: loses **Entry cost −1 N** (it won 70–85% of pairs with it).
    - Biofilm: defensive support 2 → **1**, and **Fruit costs 14 N** (reach 2, max 12 and reinforce +4 kept).
    - Predator: gains **Grow reach 4**.
    - Sporer: Fruit **7 N** (was 6).
    - Acid Tendrils: +2 → **+1**. Dormant Cells: 3 → **5** turns.
    - Regeneration: "even turns, below 3" → **every 3 turns, below 2**.
    - Result on the default CI seeds, 960 games: pairs 42.5–56.3%, average length 24.2 turns, 0.8% stalls, top mutation pick win rate 57.1%.
72. **Bot changes found while balancing.**
    - **Fruiting:** the bot fruits for windows up to 12 turns ahead, discounted 10% a turn. Before, it fruited only for windows within 6 turns, so bots hoarded over 1,000 N with nothing to do.
    - **Rich mode:** when its N outruns what 12 orders can spend, it ranks by value per order.
    - **Irradiated bodies:** it reinforces its thin cells on Irradiated bodies.
73. **Hard (§13.2).**
    - **Weights:** Normal's, sharper on threats, captures, cuts and core kills. These were found by self-play and win about 61% against Normal on their own.
    - **Robustness check:** 4–6 alternative plans are each resolved against 8 opponent samples made with the Normal policy. With several opponents, each has 4 replies and the 8 samples mix them, to stay within the time budget.
    - **Veto:** the check only vetoes. An alternative replaces the plan only if its worst sampled case is at least 12 points better and its average no worse. A free choice by a one-turn evaluation did worse than Normal.
    - **Evaluation:** it values launchers and spores in flight; without that it read Fruit as lost N.
    - **Results:** Hard beats Normal 85% on Single Rock and 60% on systems. It takes about 55 ms a turn mean here (max about 200 ms on 4-player systems).
74. **CI gate.** `pnpm balance -- --matrix --games 200 --map system --gate --jobs 4` fails if any pair leaves 30–70%. Seeds are fixed, so the gate is deterministic and only moves when code changes. The §12.4 targets themselves are verified on the 960-game runs recorded in PROGRESS.
75. **Stored rules from before M6.** `upgradeState` fills rule fields added in M6 with today's defaults, except that old games get no drafts and keep the spec's flares, so they play on as they started.
76. **Mutation glyphs** are text characters, so the HUD needs no bitmap icons (CLAUDE.md).
77. **Skirmish sizes** are Standard (the tuned default), Wide and Vast: +0, +1 and +2 bodies over it. M5 saves that say "compact" load as Standard.
78. **Perf measurement on starved CI hosts (PR #6 CI, refines #33).**
    - **What happened:** one Chromium run drew 4.7 fps where its retry drew 18.7. The replay sample, a fixed 2.5 s window, then held 12 frames, 4–6 of them board swaps, so the "typical frame" median landed on a swap (7.2 ms against 5 ms).
    - **Swap frames excluded:** the replay statistic now leaves out frames in which a board swap ran (the view counts swaps); swaps are timed on their own.
    - **Whole replays:** the sample runs to the end of each replay instead of a fixed window.
    - **Best of several:** idle and view windows are best of 3, replays best of 2, and swap timing is the second-fastest of 9. Contention only ever adds time, so the best measurement estimates the work, while a real regression slows every run.
    - **Verification:** the tests pass three times without retries with four busy loops on a 4-core host, and an injected 10 ms swap regression still fails (15.1 ms against 11.7). Budgets are unchanged.
79. **e2e hook `stopAtDraft`.** The scripted player stops by itself when a draft is pending for the viewer. Before, the draft test turned autoplay off after seeing the turn change. On a slower engine (WebKit on CI) the scripted player had already planned the next turn by then, and took draft 1 with it. This is reproduced in Chromium by slowing the test's polling.

## 2026-11-12 — M7 progression and replayability

80. **Fair orbit layouts (§4.2, §6).** Generation now tries 160 orbit layouts (was 32) and scores each by when every home first gets a launch window, then by the old spread. A layout where some home waits beyond the window horizon loses to any layout where none does. Measured on 60 seeds, every home has a window by turn 4 in 60/60 2-player and 3-player systems (was 32/60 and 19/60) and 48/60 4-player systems (was 8/60). Found because campaign games were lost to layouts where one side could not launch for 10+ turns.
81. **Bot spore targeting.** The bot no longer lands a spore within 2 cells of a landing it already has in flight. Before, it often sent two or three spores to the same cell, and an idle bot with a full home kept doing so.
82. **M7 retune (§12.4).** With fair layouts (#80) and better spore play (#81), Sporer won 61–63% against Swarmer and Biofilm and Hardened Spores reached a 59.2% pick win rate. Changes: **Sporer Fruit 7 → 9 N**, **Hardened Spores landing bonus +2 → +1**, and **Biofilm max biomass 12 → 11**. Results are in PROGRESS. The rules are stored in each game's state, so games that are already running keep their numbers.
83. **Campaign (§11.1).** There are 12 nodes on a branching graph. A node opens when any node before it is complete.
    - Nodes 1–3 are the tutorial: Single Rock twice, then a two-body system (no neutral body, via `systemMinNeutrals: 0`).
    - Modifiers are Flare Storm, Rich Comets and Metallic Only. Twists are "hold 3 bodies", "launch at most 2", "keep every core" and "win by turn 30".
    - **"Win without launching" is not a node twist.** On a system you cannot reach a dominance win without launching, so the node would be impossible. Node 8 is "launch at most 2 spores" instead, and the "Homebody" achievement keeps the spec's wording on any map.
    - Node 4 unlocks Predator, so it cannot need Predator: its bot is Easy.
    - **Completability is tested.** `tools/balance/test/campaign.test.ts` plays the nodes in order, using only the strains and mutations unlocked so far, with the Hard bot (and its personalities) standing in for the player. Every node is completed.
84. **Unlocks.** Swarmer and Biofilm are the starter strains. Predator unlocks at node 4 and Sporer at node 7 (the spec's nodes). Radiation Shielding (5), Quorum (6), Hardened Spores (8) and Deep Reserves (10) are the 4 campaign mutations. Gating applies offline (the skirmish strain pickers, including the bot's strain, and the draft pool through the `mutationPool` rule). Online and the Daily Seed have everything, so a Daily is the same game for everyone.
85. **Tutorial overlays.** The steps are data in `content`. Each step's trigger is one of: "next", placing an order of a kind, submitting, an event of yours (for example capturing a cell), or opening the System view. Anything that happened while another step was showing is forgotten, so an early submit never completes a later step. The player can skip the tutorial.
86. **Progress storage and sync.**
    - **Storage:** progress lives in IndexedDB.
    - **Sync:** it syncs with `PUT /api/progress` only once the device has an account. Campaign play alone never creates one.
    - **Merging:** every list merges by union, so no copy can roll another back. Selected cosmetics are per device.
    - **Trust:** achievements and campaign progress are client-reported and trusted, since the rewards are cosmetic only. The server grants the season rewards itself.
87. **Achievements.** There are 32, as predicates over a game summary that `content` builds by replaying the game. Online games are summarized too (online and ranked wins).
88. **Daily Seed (§3).**
    - **The game:** one 2-player system per UTC day. Strains rotate by day number, and you face the Normal bot with a seed fixed per day. The client runs the bot in its worker and the server runs it again; the bot is deterministic, so both get the same game.
    - **Validation:** you submit your orders for every turn. The server replays them and rejects any illegal order, an unfinished game, or turns after the end.
    - **Score:** a win scores 1000 plus 20 per turn under the limit, and everyone scores half their final dominance in ‰.
    - **Runs:** your best run of the day is kept. Today's and yesterday's seeds are accepted, so a run that crosses midnight UTC still counts.
    - **Streaks:** consecutive days with a run, ending today or yesterday.
89. **Ranked ladder (§11.2).**
    - **Ratings:** Glicko-2 (tested against Glickman's worked example), per mode (duel; free-for-all with 3–4 players) and season. Each finished game is one rating period.
    - **Free-for-all:** results are pairwise by place. The winner is first, then the others by final dominance; equal places draw.
    - **Placement:** players appear on the board after 3 games. The constants are `RATING` in `sim/config.ts`.
    - **Queues:** ranked and casual queues are separate per pace and player count. Ranked games store their season and the sector's rule overrides, which the replay includes.
    - **Seasons:** 42 days from 2026-01-05, rotating 4 sectors (Open Belt, Irradiated Reach, Comet Tail, Wide Systems).
    - **Season reward:** 5 ranked games in a season that has ended earns the season trail.
90. **Shareable replays (§12).**
    - **Links:** `/replay/:id` serves the app shell and plays a finished online game for any guest; only finished games are served. The replay carries seed, map, strains, rules and names.
    - **Files:** any game can be saved as a small JSON file (`swarm-bodies-replay` v1: seed, config, orders), which is validated with zod when it is opened in Settings.
91. **Cosmetics.**
    - **Kinds:** palette (your colony colour), vein thickness (×0.75 or ×1.35) and spore trail colour. All are earned from achievements, plus the season trail.
    - **Who sees them:** they apply to your own seat on your own screen, board and HUD alike. Everyone else sees the standard seat colours, and gameplay never changes.
92. **Stored states from M6** gain the two M7 rule fields when loaded (`upgradeState`). Those fields only affect generation, but they change the hash of a replayed turn, so a reloaded M6 game logs a hash difference for turns stored before the upgrade. Play is unaffected: client and server both work from the upgraded state.

## 2026-11-12 — M8 polish

93. **Lighthouse 11 (§15 M8).** Lighthouse is pinned to 11.7, because version 12 removed the PWA category the acceptance asks for.
    - **What runs:** `e2e/lighthouse.spec.ts` audits the app shell with Lighthouse's default mobile emulation and gates PWA, accessibility and best practices at 90. All three score 100.
    - **Performance is left out.** That category fails inside Lighthouse 11 in this workspace (an old `tslib` in its own dependencies). Frame and bot performance are measured by the Playwright perf specs instead.
94. **Accessibility audit.** Lighthouse only reaches URLs, so `e2e/a11y.spec.ts` runs axe-core (the engine behind Lighthouse's accessibility score) with the WCAG 2.1 A and AA rules on every screen at 390×844. The board canvas is excluded; its content is mirrored in the HUD and log.
    - **Fixes it found:**
      - The viewport no longer sets `user-scalable=no`. The board canvas keeps `touch-action: none`, so pinches on the board still zoom the game, not the page.
      - Labelled `div` and `span` elements get roles (`group`, `img`).
      - Locked and unearned items are dimmed with a dashed border instead of opacity, which failed the 4.5:1 text contrast.
95. **No console errors (§15 M8).** A shared Playwright fixture fails any test whose pages, including pages in extra browser contexts, log an uncaught exception or `console.error`. Only the network-cut tests in `states.spec.ts` allow errors, and only the browser's own failed-request messages.
96. **Text size: 100%, 125% and 150%** (§10.8 asks for 100–150%; three steps keep the layout testable). Every font size scales by `--text-scale`.
    - CSS `zoom` was tried first: percentage sizes and the HUD's absolute insets broke under it.
    - Layouts use `min-height` and wrapping, so larger text grows boxes instead of clipping. The 150% Settings screen passes axe without scrolling sideways.
97. **Colourblind patterns (§10.4).** Each seat has a glyph: stripes, dots, rings and crosshatch, in seat order, matching `PLAYER_PATTERNS`. It is drawn dark over every cell, as pre-rendered sprites inside the cached colony layer, so it adds no per-frame cost. Off by default; on in Settings → Accessibility.
98. **Landscape (§10.7)** applies to landscape screens up to 500 px tall (phones).
    - **Match:** a left column holds stats, turn and dominance; a right column holds orders and Submit; the log and body strip sit between them.
    - **Title:** the logo sits beside the menu.
    - Taller landscape screens (tablets, desktop) keep the portrait arrangement, which fits them.
99. **Error and offline states.**
    - **Error boundary:** a screen that throws, or a lazy screen that cannot load (for example offline before it was cached), shows a recoverable message with "Back to title" and "Reload".
    - **Unreachable server:** the Online screen shows Retry, and the ladder and the Daily leaderboard say they are unavailable offline. Offline play itself is unaffected.
100.  **Audio mix.**
      - **Bus:** a limiter on the master bus (threshold −6 dB, ratio 16).
      - **Stacking:** a 45 ms dedupe per sound and at most 14 voices.
      - **Peak levels:** capture 0.45, launch 0.42, squelch 0.32, thud 0.30, flare 0.30, stingers 0.22, starve 0.16, submit 0.14, click 0.08, income 0.07, tick 0.04.
      - **New sounds:** submit, starvation, income, flare, and a win or lose stinger.
      - **Pad and tabs:** the pad ducks to 45% during replays, and hidden tabs suspend the audio context.
101.  **Tutorial pacing.** A step can wait for a condition: `canFruit` (asked of the sim's own order validator), `canLaunch` (a ripe fruiting body) or `contact` (an enemy cell touches yours). It stays hidden until the condition holds. Every action step has "Skip step".
102.  **Performance pass.**
      - **`playerRules` cache.** It is cached per player by the identity of the mutations array, with the rules object and strain checked as well, and the result is frozen.
        - **Rule to keep:** the sim must keep replacing that array, never mutating it in place, and the same holds for rules objects. Nothing in the code base does otherwise.
      - **Landing scorer:** it scatters neighbourhood sums instead of gathering them.
      - **Results:** Hard on 4-player systems, mean 53.9 → 39.4 ms, p95 133 → 103 ms, max 192 → 165 ms.
      - **Identical decisions:** bot outputs hash the same across 540 decisions before and after.
      - **Devices:** no real phones were available. The 4× CPU-throttle frame tests stand in for a mid-range phone, and the bot runs in a worker, so a slow turn only delays the bot's sealed orders and never blocks input.
103.  **Keyboard test in WebKit** presses Option+Tab: Safari's plain Tab skips buttons unless the user enables "Press Tab to highlight each item".

## 2026-11-12 — Deployment (Render, Neon, GitHub Pages)

104. **One server serves everything; Pages is an extra front door.**
     - **Render:** the game server also serves the built client (`apps/client/dist`), with an SPA fallback, so the app, `/api` and `/ws` share one origin. Hashed assets are cached for a year; the shell, manifest and service worker revalidate.
     - **GitHub Pages:** `.github/workflows/pages.yml` publishes the same client under `/<repo>/`, built with `VITE_BASE` and `VITE_API_ORIGIN`. Offline modes run there even while the free Render instance sleeps. Online play calls Render, which allows the Pages origin through `CORS_ORIGINS`.
       - CORS is safe because auth is a bearer token in a header, never a cookie.
       - `404.html` is a copy of the shell, so `/replay/:id` links work without server rewrites.
     - **Base paths:** the client builds every URL from `import.meta.env.BASE_URL`: the manifest, service-worker fallback, push worker, share links and replay route.
     - **Neon:** a connection through Neon's pooler (a host containing `-pooler.`) turns off named prepared statements, which PgBouncer in transaction mode cannot keep. The transaction-scoped advisory locks used for turn resolution work through the pooler.

## 2026-11-12 — Playtest feedback: combat in node 1

105. **Combat is taught where players first meet it.** In the first real-device playtest, how combat works was unclear on campaign node 1: its bot fights back, but the assault tutorial lived in node 2.
     - **Node 1:** it now has two more steps that wait until the colonies touch (`when: contact`). They explain the attack-vs-defense label and the formula.
     - **Codex:** a "How to play" tab, now the first tab, covers the goal, turns, growing, combat, supply lines, nutrients, spores and mutations.
     - **Generated text:** the rule numbers and the combat formula are generated from `BASE_RULES` (`content/guide.ts`), so the text follows any retune.
     - **Card position:** the tutorial card moved from the bottom to just under the HUD, so it no longer covers the turn log or the order controls.

## 2026-11-13 — Playtest feedback: resources, turn tour, replay controls

106. **Resources stay visible under colonies.** Every occupied deposit or comet cell gets a small badge drawn above the colony: a diamond for ice, a circle for organic, a square for mineral, a star for a comet. The shapes read without colour too. Empty deposit cells keep their full terrain art.
107. **A turn's replay tours every body with action.**
     - **Order:** the body in view plays first, with full timing and sound. Then each other body with action plays in id order, showing only its own frames, so the tour stays short. The system-wide flash plays once.
     - **Control:** input stays off during the tour, then control returns to the starting body (and the System view, if that was open).
     - **Skip:** it ends the whole tour. Bodies it did not reach keep their alert dot on the strip.
108. **Replay viewer controls.**
     - **Transport:** previous, play/pause, next, and a turn scrubber that seeks to any turn, including the final position.
     - **Bodies:** the body strip switches asteroids and the System view; picking a body replays the current turn on it.
     - **Seat:** a local replay opens on your home body; a shared one opens on the first colonised body.

## 2026-11-13 — Colony life pass (PRs #12–#16)

The plan, the user's decisions and the per-phase results are in `docs/plans/colony-life.md`. The rule for the pass: every animated cue must say something true about the game state. Everything here is client presentation only; the sim and golden replays are untouched.

109. **The supply tree is the client's own, and agrees with the sim.**
     - **How it is built:** `vascular()` builds a breadth-first tree from each owner's cores through same-owner cells, in board order, so it is deterministic.
     - **Agreement:** a cell is in the tree exactly when the sim calls it connected. A unit test checks this on real 3-player games.
     - **Load:** the cells and income that depend on a vein set its width.
110. **Vessels live inside the cached colony texture, and the body is translucent as a whole.**
     - **Rejected: an uncached layer.** It cost +0.6–1.2 ms per replay frame.
     - **Rejected: a separate cached layer.** It added a full-body blit every frame.
     - **Chosen:** vessels drawn inside the colony texture. Leaf twigs are left to the webbing.
     - **Translucency:** the whole texture is drawn at 86% opacity. Opacity per triangle gave a visible mosaic.
111. **The heartbeat is paced by defense and flows outward.**
     - **Pace:** a core's defense (biomass plus connected support, the number an attacker must beat) sets its beat, from 0.9 s (weak) to 2 s (fortified).
     - **Flow:** each cell lags its core by 0.11 of a beat per tree step.
     - **Full cells:** cells at maximum biomass glow steadily.
     - **Starvation rims:** cut-off cells drain a rim for the turns they have left, Dormancy grace included.
     - **User's call:** "pulse by defense", with the beat flowing out from the node. Nutrients flow in, so blood goes out and food comes in.
112. **Nutrient motes.**
     - **Routes:** each held deposit or comet sends motes in its badge colour along its supply route to the core. A higher yield sends them more often.
     - **Broken routes:** a cut route runs through the severed patch to the cell nearest a core, and its motes fizzle there.
     - **Pool:** capped at 36 and animated only for the body on screen.
     - **Look:** motes are rimmed beads. Additive dots vanished on cyan colonies.
     - **Still equivalent:** a cut-off deposit's badge is slashed.
     - **Setting:** "Colony detail: Full / Calm". Calm drops the motes, feelers and specks; it keeps the vessels, badges and rims.
113. **Readouts use the sim's own numbers. Intel overlays are held.**
     - **Long-press:** it traces a cell's supply route to the core. The label splits defense into biomass, support and mutation bonus; the total is the sim's `defenseOf`.
     - **Fruiting sparkle:** it marks cells that could fruit now, after queued orders, as the sim's validator decides. It shows only while orders can be planned.
     - **Held (user's decision):** chokepoint outlines and threat rims on any colony.
114. **Strain personality echoes each strain's rules.**

     | Strain   | Veins         | Heartbeat     | Other           |
     | -------- | ------------- | ------------- | --------------- |
     | Swarmer  | thin (×0.6)   | quick (×0.75) |                 |
     | Biofilm  | thick (×1.55) | slow (×1.35)  |                 |
     | Predator | dark          |               | jagged          |
     | Sporer   |               |               | drifting specks |

     The styles are data in `apps/client/src/game/personality.ts`. Client presentation only, so they are not sim config.

115. **Frontier feelers mean "you can grow here".**
     - **Interpretation:** the plan says feelers twitch "toward empty cells within grow reach". They point at the empty, open neighbours of connected cells, the first step of any grow path. Every reachable cell is beyond one of those, and drawing whole paths would be clutter.
     - **Scope:** only the viewer's own colony, while orders can be planned.
     - **Cap and pace:** at most 32, spread evenly over the frontier. They twitch at the strain's pace.
     - **Shape:** soft pseudopods. The first version's tapered spikes read as thorns.

## 2026-11-14 — Playtest feedback: arcs, orders on body switch, crowded systems (PR #17)

116. **Arcs are stroked as standalone polylines (`render/arc.ts`).**
     - **Symptom:** on a phone, lines ran from the sun's centre to each ownership ring, and between starvation rims.
     - **Cause:** with `moveTo` + `arc`, Pixi could start an arc's path from the previous shape's centre. The doubled start point also left a zero-length first segment, whose round cap points in a random direction.
     - **Fix:** `arcPoints` builds the points with no duplicates, and `poly(points, false)` strokes each arc as its own shape.
     - **Rule to keep:** draw no arc with `moveTo` + `arc`.
     - **Note:** the bug never showed in desktop Chromium. Only the user's phone screenshot revealed the cause.
117. **Showing another body redraws the queued plan.** The view keeps the last plan and redraws it for the body now shown. Before, the plan was cleared and never redrawn.
118. **The System view declutters for display only (`game/declutter.ts`).**
     - **Nudging:** bodies that would overlap are pushed apart just enough to clear each other, ring and label included. It is deterministic, and bodies that do not overlap stay exactly where they are.
     - **Tethers:** a moved body keeps a dot on its true orbital position, tethered to where it is drawn.
     - **Picking** uses the drawn position.
     - **Unchanged:** spore trajectories and launch ranges use true positions.

## 2026-11-14 — Real-device validation and the balance verdict

119. **Real devices are validated.**
     - **What the user found:** play on Android and iPhone, large systems included, showed no slowdown or lag.
     - **What it closes:** the real-device items from DECISIONS #33 and #102, and M3's 60 fps acceptance.
     - **CI's role:** the 4× CPU-throttle specs stay as the regression guard.
120. **Balance is accepted as a first pass.**
     - **The user's verdict:** a very close first attempt that needs only minor tweaking.
     - **Approach:** keep collecting play data before retuning. Further play still gives valid insight at this level of balance.
     - **Still pending review:** the spec-number deviations in #71 and #82, and node 8's twist (#83).
121. **The bots are too strong for early campaign nodes.**
     - **The user's verdict:** the bots are genuinely challenging, perhaps too much so early in the campaign.
     - **Next:** early nodes get a weaker opponent. That means an easier difficulty or personality on those nodes, not a retune of Easy and Normal, which skirmish and the balance gate rely on.
     - **When:** this is to be planned together with the tutorial pass.

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

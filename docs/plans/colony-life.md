# Colony life pass (plan)

**Goal:** colonies are the hero of the game. They should feel alive, and every animated cue must
say something true about the game state. No decoration that carries no information.

**Starting point (before this pass):**

- **Body:** blobs, bars and triangle fill are drawn into one cached texture, so they are static and cheap.
- **Veins:** every pair of adjacent own cells gets the same straight bar, with thickness by biomass.
- **Flow dots:** one per cell, with a brightness wave moving inward by distance from the nearest core. Cut-off cells are grey.
- **Cores:** all pulse identically, regardless of strength.
- **Reduce motion:** animation stops and the dots sit at a fixed brightness.

## Decisions (2026-11-13)

- **Intel overlays are held:** no chokepoint outlines or threat rims, on any colony, for now.
- **Triangle fill:** becomes partly transparent so the new layers read through the colony body.
- **Heartbeat:** flows outward from each core along the supply tree, paced by **defense** (biomass plus connected support, the number an attacker must beat). Nutrient motes flow inward, so blood goes out and food comes in.
- **Personality (phase 5) stays in this pass.**

## Phases (one PR each, playtested between them)

1. **Supply tree and vein hierarchy.**
   - **Supply tree:** a deterministic tree per colony, built breadth-first from its cores (board order breaks ties).
   - **Load:** each tree vein carries a load: the cells and income that depend on it.
   - **Trunks:** tree veins are drawn as vessels over the colony body, thicker toward the core and scaled by load. Other links stay as faint webbing.
   - **Severed veins:** cut-off cells carry no vessels, and their webbing thins and fades.
   - **Fill:** the triangle fill is partly transparent.
   - **Cost:** all static, in the cached colony texture.
2. **Heartbeat.**
   - **The wave:** each beat leaves a core and travels outward along the supply tree.
   - **Pace:** each core's rate and depth come from its defense; each cell's swell from its own defense.
   - **Steady glow:** cells at maximum biomass glow steadily (reinforcing them does nothing).
   - **Starvation rim:** cut-off cells show a draining rim for the turns they have left.
3. **Resource motes.**
   - **Motes:** in the badge colours, they travel from each connected deposit or comet along its supply route to the core. Density follows yield.
   - **Broken routes:** motes fizzle at the break.
   - **On arrival:** motes brighten the core.
   - **Limits:** capped and pooled, and only the body on screen animates.
4. **Readouts (no intel).**
   - **Long-press a cell:** highlights its supply route to the core and shows defense as biomass + support.
   - **Can fruit:** a faint sparkle on cells that can fruit.
5. **Personality.**
   - **Strain styles:** Swarmer has thin, quick veins; Biofilm thick and slow; Predator dark and slightly jagged; Sporer has drifting specks.
   - **Frontier feelers:** they twitch toward empty cells within grow reach.

## Progress

**Phase 1 is done.**

- **Supply tree:** `apps/client/src/game/vascular.ts`, unit tested. It matches the sim's own connectivity on real 3-player games: a cell is in the tree exactly when the sim calls it connected.
- **Vessels:** they follow load, from bright arteries at the core to faint branches; leaf twigs are left to the webbing.
- **Severed webbing:** it thins to 55% and fades.
- **Colony body:** about 86% opaque.
- **Performance:** measured as an A/B against `main` with the 4×-throttle spec. Vessels drawn as their own uncached layer cost about +0.6–1.2 ms per replay frame, and a separate cached layer added a full-body blit every frame. So vessels are drawn inside the colony body's cached texture: replay frames match `main`, and a board swap costs about 1 ms more.
- **One opacity, not one per triangle:** the body's translucency is applied to the whole cached texture, not to each triangle. Per-triangle opacity produced a visible triangle mosaic.

**Phase 2 is done.**

- **Heartbeat** (`apps/client/src/game/heartbeat.ts`, unit tested):
  - **Outward flow:** each cell beats with its core's rhythm, delayed 0.11 of a beat per supply-tree step out, so beats flow outward.
  - **Pace:** a core's defense sets its pace, from 0.9 s (weak, shallow) to 2 s (fortified, deep).
  - **Swell:** each cell's own defense sets how much it swells.
- **Steady glow:** cells at maximum biomass glow steadily instead of beating.
- **Starvation rims:** cut-off cells get a draining rim, full at 5+ turns left and red at the last turn, counting Dormancy grace first.
- **Reduce motion:** brightness by strength, and full cells glow; no motion.
- **Performance:** A/B against `main`, replay frames match (2.5–2.6 vs 2.6–2.7 ms p50). Board swaps stay within budget.

**Phase 3 is done.**

- **Resource routes** (`resourceRoutes` in `apps/client/src/game/vascular.ts`, unit tested): a connected deposit's route follows the supply tree to its core. A cut-off deposit's route runs through its severed patch to the cell nearest one of its owner's cores, where it is `broken`.
- **Motes:** beads in the badge colour with a dark rim, so they read on any colony colour (additive dots vanished on cyan colonies). They travel at 2.5 cells/s; a deposit yielding _y_ sends one every 2.4/_y_ s.
- **Broken routes:** motes redden and fizzle at the break.
- **Arrival:** each arriving mote brightens its core briefly.
- **Limits:** one pool, capped at 36 sprites, animated only in Body view for the body on screen. Motes still travelling survive board redraws when their deposit still has a route, so replays keep flowing.
- **Still equivalent:** a cut-off deposit's badge is slashed, shown always, including in Calm and with reduce motion.
- **Setting:** "Colony detail: Full / Calm" in Settings → Play. Calm drops the motes.
- **Performance:** A/B against `main`, typical replay frames match (p50 2.5–3.2 vs 2.0–3.0 ms, within run noise). Idle frames cost about +0.3 ms for the moving motes. Board swaps stay within budget.

## Constraints for every phase

- **Performance:** static parts go in the cached colony texture. Moving parts use pooled sprites with fixed caps. The 4×-throttle frame-budget tests keep passing.
- **Reduce motion:** every animated cue has a still equivalent (brightness, thickness), so no information is lost.
- **Colour-blindness:** information is carried by thickness, brightness, shape and motion, never hue alone.
- **Assets:** procedural only (CLAUDE.md).
- **Determinism:** client-only. The tree, load and defense readouts are pure functions in `apps/client/src/game/` with unit tests. The sim and golden replays are untouched.
- **Settings:** a "Colony detail: Full / Calm" setting. Calm keeps vessels, badges and rims but drops the motes and feelers.
- **Every PR:** unit tests, e2e checks, axe and perf runs, and screenshots at 390×844 and in landscape.

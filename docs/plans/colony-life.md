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

## Constraints for every phase

- **Performance:** static parts go in the cached colony texture. Moving parts use pooled sprites with fixed caps. The 4×-throttle frame-budget tests keep passing.
- **Reduce motion:** every animated cue has a still equivalent (brightness, thickness), so no information is lost.
- **Colour-blindness:** information is carried by thickness, brightness, shape and motion, never hue alone.
- **Assets:** procedural only (CLAUDE.md).
- **Determinism:** client-only. The tree, load and defense readouts are pure functions in `apps/client/src/game/` with unit tests. The sim and golden replays are untouched.
- **Settings:** a "Colony detail: Full / Calm" setting. Calm keeps vessels, badges and rims but drops the motes and feelers.
- **Every PR:** unit tests, e2e checks, axe and perf runs, and screenshots at 390×844 and in landscape.

# Swarm Bodies — Game Design & Technical Specification

Version 1.0 · 2026-11-11

Swarm Bodies is a simultaneous-turn strategy game for web and mobile web. Rival colonies of predatory slime bacteria spread across small asteroids, fight over nutrients, and launch spores between orbiting bodies to dominate a star system.

This document is the source of truth for building the game. Every number marked **(tunable)** is a starting value to be balanced later with headless bot simulations; it lives in one config file (`packages/sim/src/config.ts`), never hard-coded elsewhere.

---

## 1. Pillars

1. **The network is your army.** Players shape where biomass grows and how it is supplied. There are no units to micromanage.
2. **Plan together, resolve together.** All players plan in secret, then every order resolves at the same moment. The replay of each turn is the payoff.
3. **Readable and fair.** Every outcome can be explained from visible numbers. No hidden dice in combat. Progression unlocks options, never power.
4. **Thumb-first.** Every action works with one finger on a phone. A mouse is a bonus, not a requirement.
5. **Deterministic core.** The same seed and the same orders always produce the same game, on server and client alike.

---

## 2. Core concepts and glossary

| Term | Meaning |
|---|---|
| System | One match's map: a star with 3–7 orbiting asteroids ("bodies"). |
| Body | An asteroid. Its surface is a hex grid clipped to a disk. |
| Cell | One hex on a body's surface. |
| Colony cell | A cell a player owns. It has **biomass** (integer, 1 to strain max). |
| Core | A special colony cell that anchors supply. Every player starts with one. Spores create new ones. |
| Connected | A colony cell with a path through same-owner colony cells to a core on the same body. |
| Nutrients (N) | The player's single resource pool, earned each turn from connected cells on deposits. |
| Deposit | A cell feature that yields nutrients when owned and connected. |
| Fruiting body | A colony cell converted to grow a spore launcher. |
| Spore | A projectile in flight between bodies. It becomes a new core when it lands. |
| Strain | The player's faction. It modifies core rules. |
| Mutation | A passive upgrade drafted mid-match. |
| Pressure | The number that decides contests over cells (§5.4). |
| Dominance | Owned non-rock cells ÷ all non-rock cells in the system. |

---

## 3. Match structure

- **Players:** 2–4. Free-for-all only at launch. Teams are listed as a future feature in §16.
- **Modes:**
  - **Skirmish vs bot:** runs fully in the browser with no server and works offline.
  - **Online:** live or async games through the server.
  - **Daily Seed:** one system per day, played against the Normal bot, with a leaderboard.
  - **Campaign:** single-player progression against bots (§11.1).
- **Turn timer presets:**
  - Live: 45 s, 60 s (default), or 90 s.
  - Async: 12 h, 24 h (default), or 48 h.
  - The turn resolves early when every living player has submitted.
- **Turn limit:** 40 turns (tunable).
- **Victory**, checked at the end of each resolution in this order:
  1. **Last colony standing.** All other players are eliminated.
  2. **Dominance.** A player holds ≥ 60% dominance at the end of 2 consecutive turns (tunable).
  3. **Turn limit.** At the turn limit, the highest dominance wins. Ties break on total biomass, then on nutrients banked, then the game is declared a draw.
- **Elimination:** a player with no cores and no spores in flight is eliminated. Any cells they still own decay at −1 biomass per turn and are then removed.
- **Missed turns:** a player who submits nothing has an empty order set (they pass). In live games, after 3 consecutive misses a Normal bot takes over until the player returns. The bot takeover is shown to everyone.

---

## 4. The world

### 4.1 System generation

A system is fully generated from `(seed, playerCount, settings)` with the deterministic RNG (§9.3).

- **Body count:** `playerCount + 2` (tunable), with a minimum of 4 and a maximum of 7.
- **Home bodies:** each player starts alone on their own home body, Medium-sized and of the Carbonaceous or Icy type. Home bodies are placed so their starting distances to the nearest neutral body are as equal as possible.
- **Neutral bodies** get random sizes and types (§4.3).
- **Orbits:** every body has an orbit around the star at the centre. Orbital rules are in §4.5.
- **Test mode, "Single Rock":** one Large body with two players placed on opposite edges. There are no other bodies, no launches, and no orbits. This mode is used for milestone 1 and in tutorials.

### 4.2 Hex grid

- Axial coordinates `(q, r)`. A body of radius R contains every cell with hex distance from the centre ≤ R.
- Body sizes:

| Size | Radius R | Cells |
|---|---|---|
| Small | 5 | 91 |
| Medium | 7 | 169 |
| Large | 9 | 271 |

- **Terrain**, per cell:
  - Regolith: normal ground.
  - Rock: impassable, about 8% of cells, placed in small clusters. Rock is never placed so that it cuts a body into separate regions; generation checks this with a flood fill.
- **Deposits** sit on regolith cells. Their count per body is about 6% of cells (tunable).

| Deposit | Yield per turn | Notes |
|---|---|---|
| Ice | 2 N | — |
| Organic | 3 N | — |
| Mineral | 1 N | Growing onto a mineral cell costs +1 N. |

- Every home body guarantees one Organic and one Ice deposit within 3 cells of the start core.

### 4.3 Body types

| Type | Deposit mix | Special rule |
|---|---|---|
| Carbonaceous | Organic-heavy | none |
| Icy | Ice-heavy | none |
| Metallic | Mineral-heavy | Growth costs +1 N on every cell. Max biomass is +2. |
| Irradiated | Mixed and richer (+50% deposits) | At the end of each turn, every colony cell with biomass 1 is removed. |

### 4.4 Starting state

- Each player has one core with biomass 5 at their start cell, plus 2 adjacent colony cells with biomass 2.
- Starting nutrients: 10 N (tunable).
- Each player starts with their chosen strain and no mutations.

### 4.5 Orbits and launch windows

- **Orbit parameters:** each body i has an orbital radius `rᵢ` (an integer from 3 to 12 distance units), a period `Tᵢ` (an integer from 8 to 24 turns, larger for wider orbits), and a starting phase `φᵢ` (an integer from 0 to 359 degrees).
- **Position:** the angle at turn t is `(φᵢ + floor(360·t / Tᵢ)) mod 360`. Positions use a fixed-point sine/cosine lookup table (360 entries, scaled ×10000) committed in code. **Never call `Math.sin` or `Math.cos` inside the sim.**
- **Distance:** distance between bodies is computed in fixed-point. Use an integer square root.
- **Launch window:** a launch from body A to body B is legal on turn t if `dist(A, B, t) ≤ launchRange`. The default `launchRange` is 6 units (tunable).
- **Travel time:** `max(1, ceil(dist / sporeSpeed))` turns, with `sporeSpeed = 3` (tunable). Travel time is fixed at launch.
- **System view:** the UI shows each body's orbit and the launch range from the selected body. It also shows a forecast strip of which bodies come into range over the next 6 turns.

---

## 5. Rules of play

### 5.1 Orders

During planning, a player builds an **order set**. Orders are validated as they are added, using the shared sim. Nutrient costs are summed live, and the planned total can never exceed the nutrients the player has banked.

| Order | Parameters | Cost | Rules |
|---|---|---|---|
| **Grow** | `path: Cell[]` on one body | Sum of entry costs for each new cell (§5.2) | The path starts at a connected colony cell (not counted in length). It continues through adjacent cells. Length is 1 to the strain's reach (default 3). It may pass through own cells (free, no claim). It may not cross rock. At most one Grow order may start from any one cell. |
| **Reinforce** | `cell` | 3 N | Target is an own connected cell. Adds +3 biomass, capped at the strain max. Each cell may be reinforced once per turn. |
| **Retract** | `cell` | 0 (refund +1 N) | Removes an own non-core cell. Used to reroute or to deny a cell. |
| **Fruit** | `cell` | 10 N | Target is an own connected non-core cell with biomass ≥ 5. The cell becomes a fruiting body that matures in 2 turns. A player may have at most 2 fruiting bodies at once. |
| **Launch** | `fruitingCell`, `targetBody`, `targetCell` | 0 | Requires a mature fruiting body and an open launch window. The target cell must be non-rock. The fruiting body is consumed and its cell becomes a normal colony cell with biomass 1. |
| **Draft pick** | `mutationId` | 0 | Only when a draft is pending (§7.2). |

- **Grow path ordering.** Path step k means the k-th new cell along the path.
- **Overlapping paths.** If two of a player's own Grow paths target the same cell, the later order is rejected during validation.
- **Order limit.** Max 12 orders per set (tunable). This keeps planning fast and limits bot search.

### 5.2 Growth costs

The base entry cost per new cell is 2 N. Modifiers:
- Mineral deposit: +1 N.
- Metallic body: +1 N.
- Strain and mutation modifiers.
- The minimum cost is 1 N.

Entering an enemy-held cell costs the same amount; it is an **assault** (§5.4).

### 5.3 Resolution order

The server, and every client in verification, runs `resolveTurn(state, ordersByPlayer)`. Phases run in this exact order, and players are always iterated in ascending `playerId`.

1. **Draft picks** apply. New mutations take effect immediately, for this resolution.
2. **Pay and validate.** Each order is revalidated against the start-of-turn state. Invalid orders are dropped and a `OrderRejected` event is emitted. Costs are deducted.
3. **Retract** orders apply.
4. **Reinforce** orders apply.
5. **Growth**, resolved in lockstep steps (§5.4).
6. **Launches.** Spores leave. Fruiting bodies are consumed.
7. **Spore arrivals.** Spores whose travel time expires this turn land (§6).
8. **Connectivity.** BFS from every core, per body, per player. Mark each colony cell as connected or disconnected.
9. **Starvation.** Each disconnected cell loses 1 biomass, and is removed at 0. A core never starves: a core is always connected to itself.
10. **Income.** Each player gains `2 N` per core, plus the yield of every connected cell on a deposit.
11. **Fruiting progress.** Every fruiting body advances by 1 turn toward maturity.
12. **Events.** Solar flares and comets resolve (§8).
13. **Body rules.** Irradiated bodies remove biomass-1 cells.
14. **Biomass thresholds.** Queue draft offers (§7.2).
15. **Elimination and victory checks** (§3).
16. **Orbits** advance to turn t + 1.

The output is `{ state, events[] }`. Events are ordered and drive the replay animation (§10.5).

### 5.4 Growth and contests

Growth paths advance in lockstep. In step k = 1, 2, 3, …, every still-active path tries to claim its k-th new cell at the same time.

**Feeder.** A path's feeder for step k is the cell it grew from: its start cell for step 1, otherwise its (k−1)-th new cell.

**Attacker pressure.** For a path entering cell X:

```
attack = feeder.biomass
       + (number of the attacker's other colony cells adjacent to X)
       + strain/mutation bonuses
```

**Defender pressure.** For the current owner of X:

```
defense = X.biomass
        + support × (number of the owner's other connected cells adjacent to X)
        + bonuses
```

The default `support` is 1.

Each step k resolves per target cell:

- **Empty cell, one claimant.** The claimant takes the cell. New biomass is 1, or the strain's new-cell value.
- **Empty cell, several claimants.** The highest attack wins and takes the cell with biomass 1. If the top attacks tie, the cell stays empty and all tied paths halt. This is a **stalemate**, emitted as `CellStalemate`.
- **Owned enemy cell** (an assault, possibly with several attackers):
  - Compare the highest attack against the defense. When there are several attackers, the defender is compared only against the strongest, and the other attackers halt. Ties between attackers mean nobody captures and all of them halt.
  - If `attack > defense`, the cell flips to the attacker with biomass `attack − defense` (minimum 1, capped at strain max). If the cell was a core, it is destroyed (`CoreDestroyed`). If the cell was a fruiting body, it is destroyed.
  - If `attack ≤ defense`, the defender's biomass drops by `floor(attack / 2)` (minimum 1 remaining), and the attacking path halts.
- **Halting.** A path halts at the first step it fails to claim. Later steps of that path do nothing, and their cost is **not** refunded. Committing to an attack is a risk.
- **Pressure uses the board as it stands at the start of each step.** All claims within a step are simultaneous.

Halting rules make long thin paths fragile, because their tip feeders have biomass 1. Thick, reinforced veins are what push frontlines.

### 5.5 Biomass caps

- The default max biomass per cell is 9.
- Cores have max biomass 12.
- Strain, body, and mutation modifiers apply on top.

---

## 6. Spores and expansion

- **Launch rules** are in §5.1. A spore records its owner, source, target body, target cell, landing biomass (default 3), and arrival turn.
- **Visibility.** Spores in flight are visible to all players, including their target **body**. The target **cell** is hidden until landing.
- **Landing on an empty cell.** The cell becomes a new **core** with the landing biomass.
- **Landing on an enemy cell.** Contest the landing biomass, as attack, against the cell's defense. A win creates a core with biomass `attack − defense`, minimum 1. A loss means the spore dies and the defender takes −1 biomass.
- **Landing on an own cell.** The cell becomes a core. Its biomass is the larger of its current biomass and the landing biomass.
- **Simultaneous landings on the same cell** are resolved as a contest of landing biomass. A tie means every spore dies.
- **Multiple cores** on one body are allowed and strengthen connectivity.

---

## 7. Strains and mutations

### 7.1 Strains

Ship **Swarmer** and **Biofilm** first, in milestone 4. Add **Predator** and **Sporer** in milestone 6. Strains must form a soft counter loop:

- Predator beats Swarmer.
- Biofilm beats Predator.
- Sporer outflanks Biofilm.
- Swarmer out-expands Sporer.

No strain pair may exceed a 60/40 win rate in Normal-bot mirror tests (§13.4).

| Strain | Fantasy | Rules |
|---|---|---|
| **Swarmer** | Fast, thin, everywhere | Grow reach 4. Entry cost −1 N (minimum 1). Max biomass 7. |
| **Biofilm** | Slow, dense, immovable | Grow reach 2. Max biomass 12. Defensive `support` is 2. Reinforce adds +4. |
| **Predator** | Eats the enemy | +1 attack on assaults. Gains N equal to the defender's lost biomass on every capture. Deposit yields −1 (minimum 1). |
| **Sporer** | Spreads across the system | Fruit cost 6 N. Matures in 1 turn. Max 3 fruiting bodies. Launch range +2. Landing biomass 2. |

### 7.2 Mutation drafts

- **Trigger.** A player's total biomass across all cells crosses 40, 90, or 160 for the first time (tunable). This gives at most 3 drafts per match.
- **Offer.** 3 mutations are drawn without replacement from the player's unlocked pool, excluding ones already owned. The draw uses the RNG stream `draft:<playerId>:<draftIndex>`.
- **Timing.** The offer appears at the start of the next planning phase. The player picks as part of their order set. If they don't pick, the first offered mutation is assigned.
- **Visibility.** Drafted mutations are public, shown on the player's banner.

### 7.3 Launch mutation pool (12)

| ID | Name | Effect |
|---|---|---|
| `acid_tendrils` | Acid Tendrils | +2 attack on assaults. |
| `rad_shield` | Radiation Shielding | Immune to solar flares. Ignore the Irradiated body rule. |
| `dormancy` | Dormant Cells | Disconnected cells do not starve for their first 3 disconnected turns. |
| `thick_veins` | Thick Veins | Cells adjacent to an own core get +2 defense. |
| `chemotaxis` | Chemotaxis | Entering a deposit cell costs −1 N. Paths ending on a deposit get +1 reach. |
| `cryophile` | Cryophile | Ice yields +2. |
| `lithotroph` | Lithotroph | Mineral costs no extra. Mineral yields +2. |
| `hardened_spores` | Hardened Spores | Landing biomass +2. |
| `rapid_fruiting` | Rapid Fruiting | Fruiting matures 1 turn faster (minimum 1). |
| `quorum` | Quorum Sensing | Cells with ≥ 3 adjacent own cells get +1 attack and +1 defense. |
| `regeneration` | Regeneration | On even turns, connected cells below biomass 3 gain +1. |
| `deep_reserves` | Deep Reserves | +1 N per core per turn. Bank interest: +10% of banked N, rounded down, capped at +3. |

Mutation effects are implemented as **data plus hooks**. Each mutation declares which phase hooks it modifies, such as `modifyAttack`, `modifyDefense`, `modifyEntryCost`, `onIncome`, or `modifyLanding`. The sim calls the hooks in a fixed order sorted by mutation ID, so adding a mutation never requires touching the core resolver.

---

## 8. Events

Events are scheduled at system generation from the RNG stream `events`, and are visible in the forecast strip.

- **Solar flare** (about one every 7–10 turns, tunable)
  - Announced 1 turn ahead with a `FlareWarning` event.
  - On impact, it hits the sun-facing half of each body, meaning cells whose direction from the body's centre is within 90° of the direction to the star.
  - Cells hit lose 2 biomass and are removed at 0.
  - Cores are only reduced, never below 1.
- **Comet pass** (about one every 10–14 turns, tunable)
  - Announced 2 turns ahead.
  - On arrival, it seeds a temporary **Organic** deposit with a yield of 5 on a random empty regolith cell of a random body.
  - The deposit lasts 6 turns.
  - Comets create contested hotspots.

The Ranked "sector" modifiers in §11.2 can change event frequency.

---

## 9. Architecture

### 9.1 Repository layout (pnpm workspace, TypeScript strict everywhere)

```
swarm-bodies/
  packages/
    sim/         Pure deterministic simulation. No DOM, no Node APIs, no Date, no Math.random, no floating point in game logic.
    protocol/    zod schemas and TS types for orders, messages, and REST payloads. Shared by client and server.
    bot/         Bot players. Depends on sim only.
    content/     Strain and mutation data, campaign map, codex/achievement definitions, and text strings.
  apps/
    client/      Vite + PixiJS v8 game client. The UI is built with Preact. A PWA.
    server/      Node 22, Fastify plus @fastify/websocket, Postgres via Drizzle ORM, and Web Push.
  tools/
    balance/     CLI for headless bot-vs-bot batches and balance reports.
  docs/
    SPEC.md      This document.
```

### 9.2 Sim API (`packages/sim`)

```ts
createGame(config: GameConfig, seed: string): GameState
listLegalOrders(state, playerId): LegalOrderIndex      // fast lookup for UI and bots
validateOrder(state, playerId, order, pending: Order[]): ValidationResult
validateOrderSet(state, playerId, orders: Order[]): ValidationResult
resolveTurn(state, ordersByPlayer: Record<PlayerId, OrderSet>): { state: GameState; events: GameEvent[] }
hashState(state): string                               // stable hash, e.g. FNV-1a over canonical serialization
serialize(state) / deserialize(json)
forecast(state, turnsAhead): OrbitForecast             // launch windows and scheduled events
```

- `GameState` is plain JSON-serializable data. Functions never mutate their input; they return a new state, using structural sharing where it is cheap.
- **Integer math only.** Percentages are applied as integer division with floor.
- **Iteration order.** Wherever iteration order matters, iterate sorted keys: never rely on object key order or `Set` order.

### 9.3 Determinism

- **RNG.** Use `sfc32` seeded from a string hash. Use **named streams** such as `rng.stream("events")` and `rng.stream("draft:2:1")`, so adding a new random use never shifts existing ones.
- **What is seeded.** All random draws happen at system generation or in drafts. Combat and growth have **no randomness**.
- **Cross-platform test.** A Vitest suite resolves 50 golden replays (seed + orders) in Node, and a Playwright test runs the same replays in Chromium and WebKit. Every resulting `hashState` must match the committed golden values.

### 9.4 Networking model

- **Authority.** The server is authoritative. Clients only ever send orders.
- **Turn broadcast.** After resolution, the server broadcasts `{ turn, ordersByPlayer, stateHash }`. Every client runs `resolveTurn` locally, which gives it the events for animation, then compares the hash. On a hash mismatch, the client requests the full state (`gameState` message), replaces its own, and reports the mismatch to the server log.
- **Sealed orders.** Orders are never sent to other players before resolution.
- **Transport.** One WebSocket per client, JSON messages validated with zod on both ends.

| Direction | Message | Payload |
|---|---|---|
| C→S | `hello` | `authToken`, `clientVersion` |
| C→S | `subscribe` | `gameId` |
| C→S | `submitOrders` | `gameId`, `turn`, `orders`, `draftPick?` |
| C→S | `unsubmit` | `gameId`, `turn` (allowed until resolution) |
| S→C | `gameState` | full serialized state + meta (players, timers) |
| S→C | `playerSubmitted` | `playerId`, `turn` (who is ready, not what they ordered) |
| S→C | `turnResolved` | `turn`, `ordersByPlayer`, `stateHash`, `nextDeadline` |
| S→C | `gameOver` | result summary |
| S→C | `error` | `code`, `message` |

- **REST** (`/api`):
  - `POST /guest` returns a guest account token.
  - `POST /games` creates a game with settings and returns an invite code.
  - `POST /games/:code/join`.
  - `GET /games`: the player's active games.
  - `GET /games/:id`.
  - `POST /queue` and `DELETE /queue`: quick match.
  - `GET /daily`: today's seed and leaderboard.
  - `POST /push/subscribe`.
  - `GET /replays/:id`.
- **Deadlines.**
  - Live games use in-process timers.
  - Async deadlines are stored in Postgres and swept every 30 s.
  - Resolution is idempotent: a `(gameId, turn)` unique row with an advisory lock guarantees it.
- **Persistence.** Tables:
  - `accounts`
  - `games` (settings, seed, status, current turn)
  - `game_players`
  - `turn_orders` (`gameId`, `turn`, `playerId`, orders JSON)
  - `turn_results` (hash)
  - `ratings`
  - `push_subscriptions`
  - `daily_scores`
  
  Game state is reconstructable from the seed plus the orders. Also store a state snapshot every 10 turns for fast loading.
- **Web Push.** VAPID keys come from the environment. Notify when a new async turn starts and the player hasn't submitted, and again 1 h before the deadline.
- **Reconnects.** The client re-subscribes and receives `gameState`. The planning draft is kept locally, in IndexedDB keyed by `(gameId, turn)`, so closing the app never loses planned orders.

### 9.5 Offline single player

Skirmish, Campaign, and the Daily Seed practice run entirely in the client using `sim` and `bot`. The bot runs in a **Web Worker**. Daily Seed scores are submitted when online, and the server validates them by replaying the orders.

---

## 10. Client

### 10.1 Screens

1. **Title.** Play, Campaign, Daily Seed, Codex, Settings. Animated slime backdrop.
2. **Play.**
   - Skirmish: pick bot count and difficulty, strain, and system size.
   - Online: create game, join by code, quick match, list of my games with a "your turn" badge.
3. **Lobby.** Invite code, share button using the Web Share API, player list, strain picks, start.
4. **Match.** The main screen (§10.2).
5. **Draft modal.** 3 mutation cards. Tap to inspect, tap again to pick.
6. **Results.** Winner, dominance graph over time, stats, a "watch replay" option, and rematch.
7. **Campaign map** (§11.1).
8. **Codex.** Strains, mutations, and achievements.
9. **Settings.** Audio levels, haptics, reduce motion, colourblind patterns, text size, notifications, and replay speed.

### 10.2 Match screen

- **Views.**
  - **Body view:** the hex disk of one body. The game is played here.
  - **System view:** star, orbits, bodies, and spores in flight.
  - Switch with pinch-out, or with a toggle button. Tapping a body in System view opens it.
  - A body strip along the bottom shows thumbnails of every body with ownership rings and alert dots for contested bodies.
- **HUD.**
  - Top bar: nutrients banked, planned cost, and projected income. Planned cost turns red if over budget, which validation should prevent anyway.
  - Turn number, timer ring, and ready markers for each player.
  - Mutation icons per player.
- **Planning interactions.**
  - **Drag** from an own connected cell to paint a Grow path. The path snaps to hex adjacency and shows ghost cells with a cost label. Dragging into an enemy cell shows an assault preview: attack vs defense, coloured green if it will capture and red if it won't, with "uncertain" when other players' orders could change it.
  - **Tap** an own cell to open a radial menu with Reinforce, Fruit, and Retract (each greyed out with the reason when illegal), plus Launch on a mature fruiting body.
  - **Launch flow:** pick a target body in a mini system view showing only in-range bodies, then pick a target cell.
  - **Order list drawer:** every queued order, tap to focus, swipe to delete. An undo button removes the last order.
  - **Submit** is a large button at the bottom right. After submitting, the UI shows "Waiting for N players" and allows unsubmit.
- **Readability.**
  - Biomass is shown as vein thickness and glow intensity, with the number shown on long-press or zoom.
  - Connected vs disconnected: disconnected cells desaturate and pulse slowly.

### 10.3 Controls and input

- Pointer Events for unified touch, mouse, and pen input.
- Gestures: one-finger drag to paint (on own cells), or to pan when the drag starts elsewhere. Two-finger pinch to zoom. Two-finger drag to pan.
- **Minimum touch target 44 px.** The hex render size adapts so a cell is at least 32 px at default zoom. Path painting tolerates imprecise fingers by snapping to the nearest adjacent hex along the drag direction.
- Desktop extras: scroll to zoom, right-drag to pan, `Esc` to cancel a path, `Z` to undo, `Enter` to submit.
- **Haptics** through `navigator.vibrate`, where supported, toggleable: a short tick when each path cell is added, a stronger tap on submit.

### 10.4 Art direction

- **Mood.** Bioluminescent slime on dark, cold rock: deep navy space, grey and brown regolith, and saturated glowing colonies.
- **All art is procedural.** The repository ships no bitmap art. Everything is drawn with PixiJS Graphics, meshes, and shaders, generated from the seed:
  - **Asteroids:** a disk with noise-displaced edges, crater decals, and per-type tint (icy blue-white, carbonaceous brown-black, metallic grey with specular glints, irradiated with a sickly green rim glow).
  - **Hex cells:** subtle outlines visible only near the cursor or finger, or when zoomed in.
  - **Colonies:** veins drawn as smooth curves between cell centres, with thickness proportional to biomass. A metaball or blur-threshold filter makes adjacent cells merge into organic blobs. A slow pulse travels along connected veins toward cores, which visualises flow.
  - **Cores:** larger pulsing nuclei. **Fruiting bodies:** stalks that grow taller with maturity and glow at full maturity.
  - **Spores:** glowing motes with trails along curved arcs in System view.
  - **Deposits:** crystal shards for ice, dark pods for organic, metallic flecks for mineral.
  - **Starfield:** parallax background.
- **Player colours** are colourblind-safe, each paired with a pattern overlay (stripes, dots, rings, crosshatch) that toggles on in settings: Cyan `#3ED6E8`, Magenta `#F25CB8`, Amber `#F2B33E`, Lime `#9BE85A`.
- **Typography.** One display face for titles and one UI face, both from Google Fonts. Use a rounded, slightly organic display face. Numbers use tabular figures.

### 10.5 Turn replay

- After resolution, the client plays the events as a short animation: about 2.5–5 s at 1× speed, with 2× and skip options and a pause.
- The animation sequence follows the resolution phases:
  1. Reinforce pulses.
  2. Growth steps, played one step at a time with tendrils extending, collisions splashing, and captures flipping colour with a wave.
  3. Launches and landings.
  4. Starvation fades.
  5. Income tick-ups as floating "+N" labels.
  6. Events.
- The camera auto-frames the most important action. If something happened on another body, an indicator appears on the body strip.
- A "what happened" log lists the turn's key events, and tapping one focuses the camera.
- With **Reduce motion** on, the replay becomes a crossfade with the event log.

### 10.6 Audio

- **All audio is synthesized** with the WebAudio API (oscillators, noise, and filters). No audio files.
- Sounds: squelch on growth, a crunch on capture, a deep "thoom" for launches, a soft ambient pad that shifts by game phase, and a UI click.
- Separate sliders for master, SFX, and ambience.
- Audio starts only after the first user gesture, as browsers require.

### 10.7 Performance and platform

- Target **60 fps** on a mid-range 2022 Android phone and an iPhone 12, with up to 4 players on Large bodies.
- Render only the visible body in Body view. Cull off-screen cells.
- The initial JS bundle should be under 400 KB gzipped. Lazy-load the campaign, codex, and replay viewer.
- **PWA:** manifest, icons generated at build time from an SVG, offline caching of the app shell, installable.
- Safe-area insets for notched phones. Portrait and landscape both supported: portrait puts the HUD at top and bottom, landscape puts it at the sides.
- Must work in the latest two versions of Chrome, Safari (iOS and macOS), Firefox, and Samsung Internet.

### 10.8 Accessibility

- Colourblind patterns (§10.4).
- Text scale from 100% to 150%.
- Reduce motion.
- All HUD controls reachable by keyboard on desktop.
- Every icon has a text label or tooltip.
- Contrast ratio ≥ 4.5:1 for UI text.

---

## 11. Long-term goals and progression

**Progression is horizontal.** Unlocks add options, never raw power. In online play, everyone has access to the same rules.

### 11.1 Campaign (single player vs bots)

- A galaxy map of 12 systems, shown as a node graph with branches. Each node is one match with:
  - a fixed seed,
  - an opponent bot strain and difficulty,
  - an optional **modifier**, such as "Flare storm" (flares every 4 turns), "Rich comets", or "Metallic only",
  - an optional **objective twist**, such as "Win without launching" or "Hold 3 bodies at once".
- Completing nodes unlocks:
  - **Strains:** Predator at node 4, Sporer at node 7.
  - **Mutations:** 4 of the 12 are campaign unlocks.
  - **Codex entries.**
- Online play has a fixed ruleset in which everything is unlocked. Campaign unlocks only gate what a newcomer sees, to stagger complexity.
- Nodes 1–3 double as the **tutorial**. They cover growing, assaults and supply lines, and fruiting and launching, using the Single Rock and 2-body setups. Tutorial overlays are scripted per node from `content/`.
- Progress is saved locally in IndexedDB, and synced to the account when online.

### 11.2 Ranked ladder (online)

- Glicko-2 rating per mode (1v1, and 3–4 player FFA).
- **Seasons** last 6 weeks. Each season has a **sector** modifier that changes the map, for example more Irradiated bodies, frequent comets, or bigger systems. Modifiers are defined in `content/`.
- Leaderboard per season. Season end grants a cosmetic **colony trail effect**.

### 11.3 Codex and achievements

- Discovering each mutation, by drafting it once, fills its codex entry with flavour text and real microbiology notes.
- About 30 achievements (tunable), defined as data with predicates over game summaries, for example "Won without launching", "Held a single asteroid all game", "Captured a core with a spore", "Won with 5+ stalemates", and "Daily Seed 7-day streak".
- **Cosmetics** are the only rewards: colony palettes in addition to the colourblind-safe defaults, vein styles, and spore trails. They never change gameplay.

---

## 12. Strategy and replayability design

### 12.1 Strategic axes

The design deliberately supports at least four viable plans. Each must stay viable in balance testing.

| Plan | Core idea | Countered by |
|---|---|---|
| **Rush** | Thin, fast lines to the enemy core. Assault before they thicken. | Reinforced chokepoints; cutting the rusher's long supply line. |
| **Economy / turtle** | Claim deposits, reinforce, out-produce, win late. | Early pressure; Sporer expansion taking the rest of the system. |
| **Expansion** | Early fruiting, multiple cores across bodies, dominance through spread. | Assaulting lightly defended new cores; flare timing. |
| **Sabotage** | Cut enemy veins to starve whole regions instead of fighting the front. | Multiple cores; Dormancy; compact shapes. |

### 12.2 Match arc

| Phase | Approx. turns | Focus |
|---|---|---|
| Early | 1–8 | Explore, claim deposits, plan supply routes. No contact. |
| Mid | 9–20 | Frontlines meet, drafts start, first launches. |
| Late | 20+ | Launch race through orbital windows. Dominance push. |

### 12.3 Sources of replayability

1. **Procedural systems:** body count, sizes, types, deposits, orbits, and event schedule.
2. **Strain × mutation draft × map** combinations. With 4 strains, 12 mutations taken 3 at a time with drafting, and the map types, the space of games is large.
3. **Events** break stalemates and reward reading the forecast.
4. **Orbits** change which bodies matter as the match goes on.
5. **Daily Seed:** a shared puzzle with a leaderboard.
6. **Shareable replays:** seed plus orders, viewable at `/replay/:id` or exported to a file.

### 12.4 Balance process

- `tools/balance` runs N headless games for any strain/mutation/map configuration. It outputs win rates, average game length, and dominance curves, plus how often each mutation is picked and its win rate.
- **Balance targets:**
  - Every strain pair is within 40–60% at Normal difficulty.
  - Average 1v1 game length is 18–28 turns.
  - Under 5% of games reach the turn limit with no player above 40% dominance.
  - No mutation's pick win rate is above 58%.
- CI runs a 200-game smoke batch on every PR and fails if any strain pair leaves 30–70%. This range is wider than the target to avoid noise.

---

## 13. Bot

### 13.1 Interface

```ts
chooseOrders(state: GameState, playerId: PlayerId, difficulty: "easy" | "normal" | "hard", seed: string): OrderSet
```

- The bot is deterministic given its inputs.
- It submits orders through the same `validateOrderSet` path that human players use.
- **Time budget:** 200 ms per turn on mobile (Web Worker), and 1 s on the server.

### 13.2 Behaviour

**Utility-based planning.**
1. **Generate candidates:** Grow paths toward the nearest unclaimed deposits; reinforcement of frontline cells with the highest incoming threat; assaults where `attack > defense` is achievable; severing enemy veins at articulation points of their connectivity graph; Fruit when nutrients and biomass allow; Launch toward bodies with a high unclaimed share in range.
2. **Score each candidate:** expected Δ(income), Δ(dominance), Δ(threat), and the cost.
3. **Select greedily** under the nutrient budget, then repair conflicts between candidates.

**Difficulty.**
- **Easy:** random top-3 choice per slot, ignores threats 50% of the time, never severs.
- **Normal:** greedy as described.
- **Hard:** greedy, plus a 1-ply robustness check. It samples 8 plausible opponent order sets (generated with the Normal policy) and prefers plans whose worst case is best.

**Drafts:** the bot picks the mutation that best matches its current plan, using a fixed affinity table per strain.

### 13.3 Personalities (campaign flavour)

Weights in the scoring function produce named personalities: Aggressive, Greedy, Expansionist, and Saboteur. These are used by campaign nodes.

### 13.4 Testing with the bot

- Unit tests include scenario puzzles. For example, "bot must cut this single-link supply line" or "bot must reinforce the threatened core."
- Balance runs are described in §12.4.

---

## 14. Quality and testing

| Layer | Tooling | Must cover |
|---|---|---|
| Sim | Vitest + fast-check | Every rule in §5–8 has a unit test. Property tests: total cells never exceed the board, biomass stays within caps, nutrients never go negative, resolution is deterministic, the order of player IDs in the input object does not change results. |
| Golden replays | Vitest + Playwright | 50 seeds × scripted orders → committed hashes, identical in Node, Chromium, and WebKit. |
| Protocol | Vitest | zod round-trips. Server rejects malformed or illegal orders. |
| Server | Vitest + Testcontainers (Postgres) | Join, submit, resolve, deadline sweep, idempotent resolution, reconnect. |
| Client | Playwright, mobile viewport emulation | Smoke flow: start a skirmish, paint a path, submit, watch the replay, finish a game against an Easy bot with an accelerated scripted player. |
| Bot | Vitest | Scenario puzzles; time budget. |
| Balance | `tools/balance` in CI | §12.4 thresholds. |

- **Lint and format:** ESLint (typescript-eslint strict) and Prettier.
- **CI:** GitHub Actions running typecheck, lint, test, build, and the balance smoke batch.

---

## 15. Milestones and acceptance criteria

Each milestone ends with all tests green and a commit. Do not start the next milestone until the current one meets its acceptance criteria.

### M1: Simulation core
- **Scope:** monorepo scaffold, `sim` with the Single Rock mode, hex grid, Grow/Reinforce/Retract, contests, connectivity, starvation, income, victory. No strains yet: use base values.
- **Acceptance:**
  - Unit tests for every §5 rule.
  - Property tests.
  - 20 golden replays committed.
  - A `tools/balance` CLI that plays random-legal-order games to completion without errors.

### M2: Bot
- **Scope:** `bot` package at Easy and Normal difficulty.
- **Acceptance:**
  - Normal beats random-legal play ≥ 95% of the time over 200 games.
  - Scenario puzzles pass.
  - Under 200 ms per turn on a Large body (measured in Node, with a 4× safety factor).

### M3: Playable client vs bot
- **Scope:** Vite, Pixi, and Preact client. Body view, path painting, radial menu, order drawer, submit, turn replay, results. Skirmish against the bot in a Web Worker. Procedural art for asteroid, cells, veins, and cores. Synthesized SFX. PWA shell.
- **Acceptance:**
  - A full Single Rock game is playable to the end on a phone-size viewport.
  - 60 fps on a mid-range phone profile.
  - Playwright smoke test passes.

### M4: Online multiplayer
- **Scope:** `protocol`, server, guest accounts, create/join by code, live and async timers, sealed orders, hash verification, reconnects, Web Push, bot takeover. Swarmer and Biofilm strains.
- **Acceptance:**
  - Two browsers complete a live game.
  - An async game survives a server restart.
  - A deliberate hash mismatch is detected and recovered.
  - Server tests pass.

### M5: The system
- **Scope:** multiple bodies, orbits, System view, body strip, Fruit/Launch/spores, launch windows and forecast, solar flares, comets, and all four body types.
- **Acceptance:**
  - The full rules in §4–8 are implemented and tested.
  - The bot uses launches.
  - Golden replays are extended to 50.

### M6: Strains, mutations, and balance
- **Scope:** Predator and Sporer; the draft system and all 12 mutations; the `content` package; balance tooling and CI gate.
- **Acceptance:**
  - §12.4 targets are met at Normal difficulty.
  - The Hard bot is shipped.
  - The draft UI is complete.

### M7: Progression and replayability
- **Scope:** campaign (12 nodes with tutorial), codex, achievements, Daily Seed with server validation, ranked ladder with Glicko-2 and seasons/sectors, shareable replays, cosmetics.
- **Acceptance:**
  - The campaign is completable.
  - Daily leaderboard works.
  - A replay link plays back a finished online game.

### M8: Polish
- **Scope:** audio mix pass, tutorial pacing, accessibility audit against §10.8, performance pass on target devices, landscape and portrait layouts, error states, empty states, and loading states.
- **Acceptance:**
  - Lighthouse PWA and accessibility scores ≥ 90.
  - No console errors in the Playwright suite.

---

## 16. Out of scope for v1 (future)

- Team modes (2v2).
- Spectator mode for live games.
- Chat. Instead, ship a small set of preset emotes, such as "gg", "well played", and "oops".
- Native app store wrappers. The PWA comes first.
- Map editor.
- Additional strains: Symbiont (allies with neutral microbes) and Phage-resistant.

---

## 17. Open questions to revisit after M3 playtests

- Is 3-step reach too long for readable simultaneous resolution on Small bodies?
- Should disconnected cells starve faster (−2 per turn) to make sabotage more decisive?
- Is the 60% dominance threshold reachable in 4-player games, or should it scale with player count (for example 50% for 3–4 players)?
- Should spore target cells be visible to everyone, to make landings counterable?

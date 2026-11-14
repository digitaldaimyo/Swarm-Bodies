# Tutorial pass (plan)

**Goal:** on-ramp the game's real depth. Players should understand why things happen, not just which button to press. Teach by showing, with short text and room for character.

**Parts of this pass:**

1. **Training grounds:** mini-world lessons. This document, settled below.
2. **The narrator:** Dr. Ottoline Purr, a space-cat xenobiologist. Settled below.
3. **A deeper Codex,** written as Dr. Purr's field journal. Settled below.
4. **Easier opponents on early campaign nodes** (DECISIONS #121). To plan with this pass.

## Decisions (2026-11-14)

- **Training grounds are optional.** They open from the title screen, on a map like the campaign map. Nothing is gated behind them.
- **The campaign drops its tutorial cards.** Once the lessons exist, campaign nodes 1–3 lose them and become "use what you learned" games.
- **Base strain throughout,** so players learn the reference numbers: reach 3, 2 N a cell, Reinforce +3 for 3 N.
- **Seven lessons,** including "At the same time".

## Lesson design rules

- **One idea per lesson,** about 2–4 minutes each.
- **No failing.** If the player does something else, the narrator says what happened and offers **"Try that turn again"**: the turn is rewound. The sim is deterministic, so this is cheap and exact.
- **Show, then tell.** The enemy's moves are scripted, so each lesson's key moment always happens.
- **Every board fits a Small body (radius 5)** and reads well on a phone.
- **The real rules, unchanged.** No lesson alters a rule to make its point.

## The lessons

Coordinates are axial `(q, r)`. "b" is biomass. The outcomes marked **verified** were run through the real `resolveTurn` with these exact boards (2026-11-14); they become the lessons' unit tests.

### 1. Grow: paths, cost, reach, resources

- **Teaches:**
  - Drag from your colony to grow.
  - Each new cell costs N, and mineral costs +1.
  - A path reaches at most 3 new cells a turn.
  - Rock blocks paths.
  - Deposits pay income once connected.
- **Board:**
  - Your core plus 2 cells near one edge.
  - An ice deposit and an organic deposit, each 4–5 cells away, so neither can be reached in one turn.
  - One mineral cell on the way.
  - A short rock ridge to path around.
  - No enemy.
- **Nutrients:** about 10 N, so cost matters at once.
- **Goal:** income ≥ 7 (core 2 + ice 2 + organic 3).

### 2. Mass matters: Reinforce, and zoom to see biomass (verified)

- **Board:**
  - **Rock:** a ridge across the middle, leaving a 3-cell chokepoint. Rock cells are listed when this is built.
  - **Deposit:** one in the gap.
  - **You:** core (-4,0) b5, then (-3,0) b3, (-2,0) b3, (-1,0) b4, and a thin cell in the gap at (0,0) b1.
  - **Enemy:** core (4,0) b5, then (3,0) b3, (2,0) b3, (1,0) b3.
- **Turn 1:** you submit nothing. The enemy attacks (1,0)→(0,0): attack 3 vs defense 1 + 1 support = 2. **Captured:** the gap cell and its deposit are lost.
- **Turn 2:** you retake it from (-1,0) b4 into (0,0): 4 vs 1 + 1 = 2. **Captured,** with b2.
- **Turn 3:** you Reinforce (0,0) to 5, and the enemy repeats the same attack. Reinforce resolves before growth, so it is 3 vs 5 + 1 = 6. **Repelled:** your cell keeps 4 (5 − ⌊3/2⌋).
- **Along the way:**
  - A step asks you to **zoom in**, which reveals the biomass numbers.
  - The drag label (attack vs defense) is pointed out.
  - A failed attack still costs, and its path halts.
- **Goal:** hold the gap through turn 3.

### 3. Neighbours matter: attack and defense from adjacency (verified)

- **Board:**
  - **You:** core (-4,0) b5 and (-3,0) b3.
    - Feeder A at (-2,-1) b4.
    - (-3,1) b2, and feeder B at (-2,1) b4.
    - Helpers at (-2,2) b2 and (-1,2) b2, both touching target B.
  - **Enemy:** core (2,-1) b5.
    - Top arm: (2,-2) b2, (1,-2) b2, (0,-2) b2, then **target A** at (-1,-2) b3.
    - Bottom arm: (1,0) b2, (0,1) b2, then **target B** at (-1,1) b3.
    - Each target has exactly one connected neighbour, so defense is 3 + 1 = 4.
- **One turn, two attacks with the same feeder strength:**
  - **A, alone:** 4 vs 4 is a tie, and ties fail. **Repelled:** the target drops to 1.
  - **B, with two of your cells touching the target:** 4 + 2 = 6 vs 4. **Captured,** with b2.
- **Teaches:**
  - Attack = feeder + your other cells touching the target.
  - Defense = biomass + 1 for each of its connected neighbours.
  - Ties go to the defender.
- **Goal:** capture target B. A follow-up turn can finish the weakened target A.

### 4. Protect your core (verified)

- **Board:**
  - **You:** core (-3,0) b5, then (-2,0) b5 and (-1,0) b7.
  - **Enemy:** a weak core (0,0) b2, with thin cells (1,0) b1, (1,-1) b1, (0,1) b1 and (2,0) b2.
- **Turn 1:** you attack (-1,0)→(0,0): 7 vs 2 + 3 support = 5. **Captured.**
- **What happens:**
  - The core is destroyed (`CoreDestroyed`).
  - With no cores and no spores in flight, the enemy is **eliminated in the same turn**.
  - Their cut-off cells starve in the same replay.
  - The game ends.
- **Pacing:** there is no "watch" step. The collapse plays out in that single replay, and the narrator points at it.
- **Also teaches:** keep your own core thick and surrounded.

### 5. Supply is critical (verified)

- **Board:**
  - **You:** core (0,-4) b5, then (0,-3) b4, (0,-2) b4, (0,-1) b5.
  - **Enemy:** core (3,0) b5, then (2,0) b3 and (1,0) b3.
    - **The neck:** (0,0) b1.
    - **The far arm:** (-1,0) b2, (-2,0) b2, (-2,1) b2.
- **Turn 1:** you attack (0,-1)→(0,0): 5 vs 1 + 2 support = 3. **Captured.**
- **What happens:**
  - The far arm is cut off and goes grey, with starvation rims.
  - Starvation begins the same turn: the arm drops to b1.
  - **Turn 2:** you submit nothing, and the arm is gone.
- **Also shown:** cut-off deposit badges are slashed, so lost income is visible too.
- **Goal:** cut the enemy off, and watch the arm starve.

### 6. Fruit and launch

- **Teaches:**
  - Fruit needs biomass 5 and costs 10 N.
  - A fruiting body ripens in 2 turns.
  - Launch windows open when orbits line up, shown by the forecast.
  - A spore lands as a new core.
- **Board:**
  - A two-body system (`TWO_BODY` rules).
  - **Launch window:** the seed or orbits are chosen so a window from home opens on turn 4–5. The seed is found by search when this is built.
  - **Your colony:** one connected cell starts at b4, so Reinforce comes first (b7, a call-back to Lesson 2), then Fruit.
- **Goal:** a spore lands (`SporeLanded`).

### 7. At the same time (verified)

- **Teaches:**
  - Everyone's orders are sealed and resolve together.
  - Equal pressure on an empty cell is a stalemate.
  - The thicker path wins.
  - This is what the "?" in the attack preview means.
- **Board:**
  - **You:** core (-3,0) b5, then (-2,0) b2 and (-1,0) b2.
  - **Enemy:** core (3,0) b5, then (2,0) b2 and (1,0) b2.
  - The empty cell (0,0) between you.
- **Turn 1:** both of you grow into (0,0) at 2 vs 2. **Stalemate** (`CellStalemate`): nobody takes it, and both paths halt.
- **Turn 2:** you Reinforce (-1,0) to 5.
- **Turn 3:** both of you grow into (0,0) again, 5 vs 2. **You claim it;** the enemy's path halts.
- **Goal:** take (0,0).

## The narrator: Dr. Ottoline Purr (decided 2026-11-14)

### Who she is

- **Role:** Senior Xenobiologist aboard the survey ship _Third Nap_. She studies slime colonies across a dying star's asteroid belt.
- **Your role:** the player is her research assistant, issued a chemotactic guidance beam. This explains why you can steer a slime.
- **The running question:** are the swarms intelligent, or just very, very hungry? Dr. Purr is certain of the answer, and the answer changes from one journal entry to the next.

### Voice

- **A little smug, as cats are, and never mean.** She looks down on the slime, the universe and mildly on you, always in the tone of "keep up, assistant".
- **The fact comes first, plain and correct.** The smugness is garnish, and a joke never makes a rule unclear.
- **At most two short sentences per bubble.**
- **Sample lines:**
  - "Drag from the colony to grow. Three cells a turn: the specimen is ambitious, not fast."
  - "A single cell, biomass one, guarding a feeding ground. I've seen better strategy from a hairball."
  - "Same feeder, two results. Friends help. Even for slime."
  - "You both reached for it at the same moment. Neither got it. I relate to this deeply."

### Look and sound

- **A vector SVG portrait,** drawn in the page itself: a cat head in a round survey helmet beside a speech bubble. No bitmap art (CLAUDE.md).
- **Three expressions:**

  | Expression         | When                     | Look                              |
  | ------------------ | ------------------------ | --------------------------------- |
  | **Smug** (default) | explaining, neutral      | half-lidded eyes, one-sided smirk |
  | **Intrigued**      | discoveries, good play   | ears forward, wide pupils         |
  | **Unimpressed**    | mistakes, failed attacks | flat ears, a slow blink           |

- **Motion:** a blink every few seconds, and a small pop on an expression change. Both hold still with reduce motion.
- **Sound:** a very quiet synthesized "mrrp" chirp when a bubble opens, made with WebAudio. It follows the effects volume.

### Where she speaks

- **Lessons:** throughout. She hosts every Training-grounds lesson.
- **Campaign map:** she introduces each node in its briefing. These lines replace or extend the current blurbs.
- **Results screen:** a closing line on a win or a loss.
- **In other games:** only at moments we can detect reliably and that are worth a line.
  - **Detectors:** each moment is a pure function of the previous state, the turn's events and the new state, and each is unit tested.
  - **Measured before shipping:** run the detectors over hundreds of bot games to measure how often they fire. The target is about 3–5 lines in a typical game.
  - **Candidate moments,** each at most once per game:

    | Moment                     | How it's detected                                                   |
    | -------------------------- | ------------------------------------------------------------------- |
    | Your first capture         | your first `CellCaptured`                                           |
    | Your first repelled attack | `AssaultRepelled` with you attacking (cue: neighbours or Reinforce) |
    | You cut their supply       | your capture this turn, plus ≥ 2 enemy cells newly disconnected     |
    | Your supply is cut         | ≥ 2 of your cells newly disconnected                                |
    | A core falls               | `CoreDestroyed`, yours or theirs                                    |
    | First stalemate            | `CellStalemate` involving you                                       |
    | First spore landing        | your `SporeLanded`                                                  |
    | First flare or comet       | its warning event                                                   |
    | A comeback                 | you were at ≤ 50% of the leader's cells, and now you lead           |

  - **Taste rules:**
    - At most one line per turn, with a cooldown of a few turns between lines.
    - When several moments fire together, a priority order picks one.
    - Lines appear after the replay, never while planning, and dismiss with a tap.
- **Setting:** "Dr. Purr: On / Lessons only / Off". It defaults to On in campaign and skirmish, and to Lessons only in online play.

## The Codex: Dr. Purr's field journal (decided 2026-11-14)

- **The rules stay plain.** "How to play" stays a factual reference, lightly framed as Dr. Purr's "Guide for assistants".
- **Field notes:** each entry (strains, mutations, body types, deposits, flares and comets) gains a short note in her voice. It unlocks when the player first meets that thing, the way mutation entries already fill in when drafted.
- **A new Journal tab** holds lore entries unlocked by lessons, campaign nodes and achievements. Over time it tells the story of the survey, the belt and the "clever or hungry?" question.
- **Content:** all text is data in `packages/content`, so writing can grow without code changes.

## What needs building

1. **Authored maps (sim):** a production way to build a game from a hand-placed board: radius, rock, deposits, cells and nutrients. Today only the test helper `scenario()` can do this. Golden replays stay unaffected.
2. **A scripted opponent (content and client):** fixed orders per turn instead of a bot. They are still checked by the sim's validator, and an invalid order is skipped.
3. **Lesson goals and triggers (content):**
   - income ≥ N
   - capture a given cell
   - hold a cell through turn N
   - core destroyed
   - enemy cells cut off
   - spore landed
   - zoomed in
   - The existing tutorial triggers and conditions are reused.
4. **Turn rewind** ("Try that turn again").
5. **Training grounds screen:**
   - It reuses the campaign map, opened from the title screen.
   - Lesson completion is stored in progress, with the same union merge as the campaign.
   - Lesson replays need no server: everything is offline.
6. **Campaign cleanup:** remove the tutorial cards from nodes 1–3 once the lessons ship.
7. **The narrator:**
   - The portrait component (three expressions) and the speech bubble.
   - The chirp.
   - The moment detectors (client, pure, unit tested) and a measuring script over bot games.
   - The setting.
   - Campaign-map introductions.
8. **The Codex:**
   - A field note on every entry.
   - The Journal tab.
   - Unlock tracking in progress, with the same union merge as the campaign.

## Still to discuss

- Easier early-campaign opponents (DECISIONS #121).
- Order of work: which parts ship first, and in which PRs.
- Achievements for completing the Training grounds.

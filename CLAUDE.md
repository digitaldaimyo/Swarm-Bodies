# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Source of truth

`docs/SPEC.md` is the complete design and technical spec for Swarm Bodies. Read it fully before starting work, and re-read the relevant sections before each milestone. If the spec and the code disagree, the spec wins, unless the user says otherwise. If a rule is ambiguous, choose the simplest reading that is consistent with the pillars in §1. Record the decision in `docs/DECISIONS.md` with the date and the spec section it concerns.

## How to work

- **Build milestone by milestone (§15)**, in order: M1 → M8.
  - Finish each milestone's acceptance criteria before starting the next.
  - Commit at the end of each milestone, and at sensible points within it.
  - Use small, focused commits with clear messages.
- **Keep the plan visible.** Keep `docs/PROGRESS.md` updated with the current milestone, what's done, and what's next. A fresh session must be able to resume from it.
- **Sim first.** `packages/sim` must stay pure and deterministic:
  - No `Math.random`, `Date`, `Math.sin`/`Math.cos`, floating-point game math, DOM, or Node APIs.
  - Iterate sorted keys wherever order matters.
  - Use the fixed-point trig table and the named RNG streams (§9.3).
- **Never tune numbers inline.** Every tunable value lives in `packages/sim/src/config.ts`.
- **Shared code is shared, not copied.**
  - Order validation lives in `sim`. The client, server, and bot all call it.
  - Message types live in `protocol`.
  - Strain, mutation, campaign, and achievement data live in `content`.
- **No bitmap or audio assets.** All art is procedural (Pixi Graphics, meshes, and shaders) and all audio is synthesized with WebAudio (§10.4, §10.6).
- **Mobile is the primary target.** Test every UI change at a 390×844 viewport first, then at desktop size.

## Commands (create these in M1 and keep them working)

```
pnpm install
pnpm dev            # client (and server once M4 exists)
pnpm test           # all Vitest suites
pnpm test:e2e       # Playwright
pnpm typecheck
pnpm lint
pnpm build
pnpm balance -- --games 200 --strains swarmer,biofilm   # headless bot batches
```

## Definition of done for any change

- `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass.
- New rules have unit tests. Changes to the sim keep golden replay hashes stable, or regenerate them deliberately and explain why in the commit message.
- UI changes work with touch at phone size.

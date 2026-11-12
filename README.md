# Swarm Bodies

A simultaneous-turn strategy game for web and mobile web. Rival colonies of slime bacteria spread across small asteroids, fight over nutrients, and launch spores between orbiting bodies to dominate a star system.

- **Design and technical spec:** [docs/SPEC.md](docs/SPEC.md)
- **Instructions for Claude Code:** [CLAUDE.md](CLAUDE.md)

## Status

Milestones 1–3 are complete: the deterministic simulation core, the Easy and Normal bot, and a playable offline skirmish client (a PWA). Next is M4, online multiplayer. See [docs/PROGRESS.md](docs/PROGRESS.md) for details, and [docs/DECISIONS.md](docs/DECISIONS.md) for rulings on ambiguous spec points.

## Getting started

```
pnpm install
pnpm dev                     # the client at http://localhost:5173
pnpm test                    # Vitest: sim rules, property tests, golden replays
pnpm test:e2e                # Playwright: golden replays, client smoke test, frame budget
pnpm typecheck && pnpm lint
pnpm balance -- --games 200 --players normal,random  # headless batch on Single Rock
```

Requires Node 22+ and pnpm 10.

## Stack

TypeScript (pnpm monorepo), PixiJS v8 with Preact for the client, Node with Fastify, WebSockets and Postgres for the server, and Vitest and Playwright for tests.

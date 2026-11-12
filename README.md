# Swarm Bodies

A simultaneous-turn strategy game for web and mobile web. Rival colonies of slime bacteria spread across small asteroids, fight over nutrients, and launch spores between orbiting bodies to dominate a star system.

- **Design and technical spec:** [docs/SPEC.md](docs/SPEC.md)
- **Instructions for Claude Code:** [CLAUDE.md](CLAUDE.md)

## Status

Milestone 1 (the deterministic simulation core) is complete. Next is M2, the bot. See [docs/PROGRESS.md](docs/PROGRESS.md) for details, and [docs/DECISIONS.md](docs/DECISIONS.md) for rulings on ambiguous spec points.

## Getting started

```
pnpm install
pnpm test                    # Vitest: sim rules, property tests, golden replays
pnpm test:e2e                # Playwright: golden replays in the browser
pnpm typecheck && pnpm lint
pnpm balance -- --games 200  # headless random-legal batch on Single Rock
```

Requires Node 22+ and pnpm 10.

## Stack

TypeScript (pnpm monorepo), PixiJS v8 with Preact for the client, Node with Fastify, WebSockets and Postgres for the server, and Vitest and Playwright for tests.

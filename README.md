# Swarm Bodies

A simultaneous-turn strategy game for web and mobile web. Rival colonies of slime bacteria spread across small asteroids, fight over nutrients, and launch spores between orbiting bodies to dominate a star system.

- **Design and technical spec:** [docs/SPEC.md](docs/SPEC.md)
- **Instructions for Claude Code:** [CLAUDE.md](CLAUDE.md)

## Status

Milestones 1–5 are complete: the deterministic simulation core, the Easy and Normal bot, a playable client (a PWA) with offline skirmish, online multiplayer with Swarmer and Biofilm strains, and the multi-body star system (orbits, spores, flares and comets). Next is M6: strains, mutations, and balance. See [docs/PROGRESS.md](docs/PROGRESS.md) for details, and [docs/DECISIONS.md](docs/DECISIONS.md) for rulings on ambiguous spec points.

## Getting started

```
pnpm install
pnpm dev                     # the client at http://localhost:5173
pnpm test                    # Vitest: sim rules, property tests, golden replays
pnpm test:e2e                # Playwright: golden replays, client smoke, frame budget, online play
pnpm typecheck && pnpm lint
pnpm balance -- --games 200 --players normal,random  # headless batch on Single Rock
```

Requires Node 22+, pnpm 10 and, for online play and the server tests, Postgres 16:

```
TEST_DATABASE_URL=postgres://swarm:swarm@localhost:5432/postgres pnpm test   # include server tests
pnpm dev     # client on :5173 and server on :8787 (DATABASE_URL, default postgres://swarm:swarm@localhost:5432/swarm)
```

## Stack

TypeScript (pnpm monorepo), PixiJS v8 with Preact for the client, Node with Fastify, WebSockets and Postgres for the server, and Vitest and Playwright for tests.

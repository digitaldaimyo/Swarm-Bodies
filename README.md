# Swarm Bodies

A simultaneous-turn strategy game for web and mobile web. Rival colonies of slime bacteria spread across small asteroids, fight over nutrients, and launch spores between orbiting bodies to dominate a star system.

- **Design and technical spec:** [docs/SPEC.md](docs/SPEC.md)
- **Instructions for Claude Code:** [CLAUDE.md](CLAUDE.md)

## Status

Pre-development. The build follows the milestones in [SPEC §15](docs/SPEC.md#15-milestones-and-acceptance-criteria), starting with the deterministic simulation core.

## Stack

TypeScript (pnpm monorepo), PixiJS v8 with Preact for the client, Node with Fastify, WebSockets and Postgres for the server, and Vitest and Playwright for tests.

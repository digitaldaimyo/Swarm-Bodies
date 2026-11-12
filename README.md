# Swarm Bodies

A simultaneous-turn strategy game for web and mobile web. Rival colonies of slime bacteria spread across small asteroids, fight over nutrients, and launch spores between orbiting bodies to dominate a star system.

- **Design and technical spec:** [docs/SPEC.md](docs/SPEC.md)
- **Instructions for Claude Code:** [CLAUDE.md](CLAUDE.md)

## Status

All eight milestones (M1–M8) are complete:

- the deterministic simulation core, and the Easy, Normal and Hard bots;
- a playable client (a PWA) with offline skirmish and online multiplayer;
- the multi-body star system;
- four strains with 12 drafted mutations, balanced to the spec's targets;
- progression: a 12-node campaign with a tutorial, the codex and achievements, cosmetics, the Daily Seed with a server-validated leaderboard, a Glicko-2 ranked ladder with seasons, and shareable replays;
- polish: accessibility (colourblind patterns, text size, keyboard), landscape layouts, error and offline states, an audio mix pass, and Lighthouse PWA and accessibility scores of 100. See [docs/PROGRESS.md](docs/PROGRESS.md) for details, and [docs/DECISIONS.md](docs/DECISIONS.md) for rulings on ambiguous spec points.

## Getting started

```
pnpm install
pnpm dev                     # the client at http://localhost:5173
pnpm test                    # Vitest: sim rules, property tests, golden replays
pnpm test:e2e                # Playwright: golden replays, smoke, frame budget, online, a11y, Lighthouse
pnpm typecheck && pnpm lint
pnpm balance -- --games 200 --players normal,random  # headless batch on Single Rock
pnpm balance -- --matrix --games 960 --map system --jobs 4   # strain matrix vs the §12.4 targets
pnpm --filter @swarm/balance exec tsx src/campaign-play.ts   # play the campaign with stand-in bots
```

Requires Node 22+, pnpm 10 and, for online play and the server tests, Postgres 16:

```
TEST_DATABASE_URL=postgres://swarm:swarm@localhost:5432/postgres pnpm test   # include server tests
pnpm dev     # client on :5173 and server on :8787 (DATABASE_URL, default postgres://swarm:swarm@localhost:5432/swarm)
```

## Deploying

**Render** (game server, also serving the client). Use these settings on the web service:

| Setting       | Value                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| Build command | `corepack enable && pnpm install --frozen-lockfile --prod=false && pnpm --filter @swarm/client build` |
| Start command | `pnpm --filter @swarm/server start`                                                                   |
| Health check  | `/api/health`                                                                                         |

`--prod=false` is required: with `NODE_ENV=production`, pnpm would otherwise skip the dev tools the build and `tsx` need.

Environment variables:

| Variable       | Value                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | The Neon connection string, with `?sslmode=require`. Pooled (`-pooler`) or direct both work. |
| `HOST`         | `0.0.0.0`                                                                                    |
| `NODE_ENV`     | `production`                                                                                 |
| `CORS_ORIGINS` | `https://<user>.github.io`, to allow the Pages copy                                          |

Render provides `PORT` itself. Migrations run on start.

**GitHub Pages** (static client, optional). Set Settings → Pages → Source to **GitHub Actions**. The `Pages` workflow builds and publishes on every push to `main`. It points at `https://swarm-bodies.onrender.com`; set the repository variable `API_ORIGIN` to use another server.

## Stack

TypeScript (pnpm monorepo), PixiJS v8 with Preact for the client, Node with Fastify, WebSockets and Postgres for the server, and Vitest and Playwright for tests.

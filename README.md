# OpenClaw HUD

Local dashboard for OpenClaw runtime visibility. It reads your local OpenClaw data and shows agents, sessions, chat activity, cron jobs, and model usage in one place.

## Features

- Live agent/session views with click-through chat history
- Real-time updates over WebSocket
- Weekly model usage and cost display
- Cron job status visibility
- Local-only architecture (no external database)

## Requirements

- Node.js 20+ (LTS recommended)
- Local OpenClaw install with gateway running
- Read access to `~/.openclaw` (or `OPENCLAW_HOME` override)

## Quick Start

```bash
npm ci
npm start
```

Open: `http://localhost:3777`

## Configuration

Copy `.env.example` values as needed in your environment:

- `PORT` (default `3777`)
- `OPENCLAW_HOME` (default `~/.openclaw`)
- `HUD_USAGE_TZ` (default `America/Chicago`)
- `HUD_USAGE_CACHE_TTL_MS` (default `15000`)

See [CONFIGURATION.md](./CONFIGURATION.md) for troubleshooting and runtime details.

## Scripts

- `npm start` — run server
- `npm run fmt` — apply Oxc formatter
- `npm run fmt:check` — fail if formatting differs
- `npm run lint` — run Oxlint (warnings fail)
- `npm run lint:type-aware` — run Oxlint type-aware alpha checks
- `npm run quality` — run formatter check, lint, coverage, and bundle checks
- `npm test` — run unit tests
- `npm run test:coverage` — run tests with coverage
- `npm run test:e2e` — run Playwright tests
- `npm run bundle:analyze` — bundle/asset analysis

## E2E Notes

- Playwright runs can execute without a gateway token. In that mode, model-usage can legitimately render the empty state (`No model data yet`) instead of live per-model bars.
- The spawn modal does not include a `mode` field; `mode` is enforced server-side as `run`.

## Development

Contributions are welcome. Please read:

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [SECURITY.md](./SECURITY.md)
- [CHANGELOG.md](./CHANGELOG.md)

## License

[MIT](./LICENSE)

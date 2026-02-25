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
- `npm test` — run unit tests
- `npm run test:coverage` — run tests with coverage
- `npm run test:e2e` — run Playwright tests
- `npm run bundle:analyze` — bundle/asset analysis

## Development

Contributions are welcome. Please read:

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [SECURITY.md](./SECURITY.md)
- [CHANGELOG.md](./CHANGELOG.md)

## License

[MIT](./LICENSE)

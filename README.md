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
- `.nvmrc` is pinned to Node.js `22` for contributors/CI consistency
- Local OpenClaw install with gateway running
- Read access to `~/.openclaw` (or `OPENCLAW_HOME` override)

## First-run setup

```bash
git clone https://github.com/treygoff24/openclaw-hud.git
cd openclaw-hud
git checkout master
npm ci
cp .env.example .env

# 1) Export settings (required in your shell, or load .env in your preferred way)
# Example minimum: export OPENCLAW_HOME="$HOME/.openclaw" PORT=3777

# 2) Verify gateway prerequisites
openclaw gateway status

# 3) Start HUD
npm start
```

Open: `http://localhost:3777`

### Quick first-run checks

- `openclaw gateway status` returns healthy before `npm start`.
- UI opens at `http://localhost:3777` within a few seconds.
- `npm run test:e2e` is optional; smoke state is that the dashboard loads without startup crash.
- If no model rows render initially, this can be normal for a new local setup (especially without recent gateway activity).

### Common first-run issues

- `openclaw: command not found` → install OpenClaw CLI and retry.
- `EADDRINUSE: 127.0.0.1:3777` → another process is using port 3777; stop it or set `PORT`.
- `Gateway not connected` → confirm OpenClaw gateway is running and `OPENCLAW_HOME` points to your real OpenClaw data dir.

## Configuration

Copy `.env.example` values as needed in your environment:

- `PORT` (default `3777`)
- `OPENCLAW_HOME` (default `~/.openclaw`)
- `HUD_USAGE_TZ` (default `America/Chicago`)
- `HUD_USAGE_CACHE_TTL_MS` (default `60000`)
- `HUD_USAGE_SESSIONS_LIMIT` (default `500`)
- `HUD_USAGE_MONTH_MEMO_TTL_MS` (default `15000`)
- `HUD_USAGE_MONTH_MAX_WINDOWS` (default `30`)
- `HUD_USAGE_MONTH_MAX_DURATION_MS` (default `7000`)
- `HUD_WS_AUTH_TOKEN` (optional): enables header-based auth for WebSocket clients from non-loopback origins. Set this to a shared secret and pass it in the `x-hud-ws-auth` header.

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
- `scripts/diag/macos-perf-capture.sh --run-id <RUN_ID> --once` — collect macOS GPU power/thermal samples and POST to `/api/diag/perf/system`

The capture script is intended for a remote viewer machine and posts samples using a shared `runId`:

```bash
bash scripts/diag/macos-perf-capture.sh \
  --server http://viewer-machine:3777 \
  --run-id $(date +%s)-run-1 \
  --once \
  --show-json
```

It posts power/thermal metrics plus capture availability and failure counters, and continues sending thermal samples when `powermetrics` is unavailable.

## E2E Notes

- Playwright runs can execute without a gateway token. In that mode, model-usage can legitimately render the empty state (`No model data yet`) instead of live per-model bars.
- The spawn modal does not include a `mode` field; `mode` is enforced server-side as `run`.

## Development

Contributions are welcome. Please read:

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [SUPPORT.md](./SUPPORT.md)
- [SECURITY.md](./SECURITY.md)
- [CHANGELOG.md](./CHANGELOG.md)
- [docs/release-process.md](./docs/release-process.md)

## License

[MIT](./LICENSE)

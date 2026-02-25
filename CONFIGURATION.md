# Configuration

OpenClaw HUD reads runtime data from your local OpenClaw installation.

## Requirements

- Node.js 20+ (LTS recommended)
- OpenClaw gateway configured locally
- Read access to your OpenClaw home directory (default `~/.openclaw`)

## Runtime Inputs

HUD reads these values from either environment variables or OpenClaw config:

- `PORT` (default: `3777`)
- `OPENCLAW_HOME` (default: `~/.openclaw`)
- Gateway host/port/token from `~/.openclaw/openclaw.json`
- `HUD_USAGE_TZ` (default: `America/Chicago`)
- `HUD_USAGE_CACHE_TTL_MS` (default: `60000`)
- `HUD_USAGE_MONTH_MAX_WINDOWS` (default: `30`)
- `HUD_USAGE_MONTH_MAX_DURATION_MS` (default: `7000`)

## Start

```bash
npm ci
npm start
```

Open `http://localhost:3777`.

## Common Troubleshooting

### `Gateway not connected`

- Confirm gateway is running:

```bash
openclaw gateway status
```

- Confirm token exists in OpenClaw config.

### `EADDRINUSE: 127.0.0.1:3777`

- Another process is using the HUD port.
- Stop that process or set `PORT` to a different value.

### Model usage errors

- Confirm gateway method availability and auth scopes.
- Run:

```bash
openclaw doctor
```

### No chat history on load

- Ensure session key is canonical (`agent:<agentId>:<session>`).
- Check server logs for `[CHAT-HISTORY]` events.

# Configuration

OpenClaw HUD reads runtime data from your local OpenClaw installation.

## Requirements

- Node.js 20+ (LTS recommended)
- OpenClaw CLI + running local gateway (required for live data)
- OpenClaw gateway configured locally
- Read access to your OpenClaw home directory (default `~/.openclaw`)

## Runtime Inputs

HUD reads these values from either environment variables or OpenClaw config:

- `PORT` (default: `3777`)
- `OPENCLAW_HOME` (default: `~/.openclaw`)
- Gateway host/port/token from `~/.openclaw/openclaw.json`
- `HUD_USAGE_TZ` (default: `America/Chicago`)
- `HUD_USAGE_CACHE_TTL_MS` (default: `60000`)
- `HUD_USAGE_SESSIONS_LIMIT` (default: `500`, clamp: `1..2000`)
- `HUD_USAGE_MONTH_MEMO_TTL_MS` (default: `15000`, clamp: `0..300000`)
- `HUD_USAGE_MONTH_MAX_WINDOWS` (default: `30`)
- `HUD_USAGE_MONTH_MAX_DURATION_MS` (default: `7000`)
- `HUD_WS_AUTH_TOKEN` (optional): optional shared secret for non-loopback websocket clients.

### Websocket auth hardening

- If `HUD_WS_AUTH_TOKEN` is set, websocket clients from non-loopback origins must send matching token in the `x-hud-ws-auth` header.
- Loopback websocket clients (`127.0.0.1`, `::1`, `localhost`) are accepted without this header.

## Start

```bash
cd /path/to/openclaw-hud
npm ci
cp .env.example .env

# Load your variables in shell (or from a `.env` loader in your environment)
# Example:
# export OPENCLAW_HOME="$HOME/.openclaw"
# export PORT=3777
# set -a; . ./.env; set +a

openclaw gateway status
npm start
```

Open `http://localhost:3777`.

## Quick first-run smoke checks

1. `openclaw gateway status` (must show a running gateway)
2. `openclaw doctor` (optional, useful for auth/connectivity and environment diagnostics)
3. If startup fails, check logs and confirm:
   - `OPENCLAW_HOME` points to the correct OpenClaw data dir
   - gateway is started with the same profile as the HUD points to
   - `PORT` is not already in use

## Common Troubleshooting

### `Gateway not connected`

- Confirm gateway is running:

```bash
openclaw gateway status
```

- Confirm token exists in OpenClaw config.

- Confirm the configured gateway host/token matches your running gateway process.

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

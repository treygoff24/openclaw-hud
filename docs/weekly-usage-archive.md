# Weekly Usage Archive

This project keeps **live weekly usage** and **historical weekly usage** separate:

- `/api/model-usage/live-weekly` always reads live data from `sessions.usage`.
- `/api/model-usage/history` reads immutable archived snapshots only.

## Live-weekly cache freshness

`/api/model-usage/live-weekly` supports a short in-memory TTL cache via `HUD_USAGE_CACHE_TTL_MS`.

- Default: `15000` (15 seconds)
- Guidance: keep this value short (for example `5000`–`15000`) to minimize stale UI windows.
- Set `HUD_USAGE_CACHE_TTL_MS=0` to disable caching.
- Pass `?refresh=1` to bypass cache for an on-demand fresh read.

Cache entries are also keyed by pricing-config fingerprint (file timestamp/size), so pricing edits invalidate the cached response even before TTL expiry.

## Archive storage

Weekly snapshots are written to:

`$OPENCLAW_HOME/state/usage-archive/weekly/*.json`

By default, `OPENCLAW_HOME` resolves to `~/.openclaw`.

Each file is named by week key (UTC date):

- `2026-02-15.json`
- `2026-02-22.json`

## API

### Read all snapshots

`GET /api/model-usage/history`

Response:

```json
{
  "snapshots": [
    {
      "meta": {
        "period": "weekly",
        "weekStart": "2026-02-15T06:00:00.000Z"
      },
      "models": [],
      "totals": { "totalTokens": 0, "totalCost": 0 }
    }
  ]
}
```

### Read a specific week

`GET /api/model-usage/history?weekStart=2026-02-15`

Response:

```json
{
  "snapshot": {
    "meta": {
      "period": "weekly",
      "weekStart": "2026-02-15T06:00:00.000Z"
    },
    "models": [],
    "totals": { "totalTokens": 0, "totalCost": 0 }
  }
}
```

If the week is missing, the route returns HTTP 404.

## Immutability

`lib/usage-archive.js` writes snapshots with `flag: 'wx'`, so existing weekly files cannot be overwritten.

## Cron setup

Install the weekly snapshot cron job:

```bash
./scripts/setup-weekly-archive-cron.sh
```

This installs a Sunday cron entry that:

1. fetches `/api/model-usage/live-weekly?refresh=1`
2. writes the payload via `writeWeeklySnapshot(...)`
3. logs to `$OPENCLAW_HOME/logs/weekly-usage-archive.log`

### Optional environment overrides

- `OPENCLAW_HOME` (default: `~/.openclaw`)
- `HUD_PORT` (default: `3777`)
- `WEEKLY_ARCHIVE_HOUR` (default: `0`)
- `WEEKLY_ARCHIVE_MINUTE` (default: `5`)

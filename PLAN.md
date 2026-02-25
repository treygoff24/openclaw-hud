# QoL + Spend + Uptime Plan (TDD First)

## Goals

- Increase chat pane text size while preserving current formatting quality.
- Fix providers formatting in System Status so long lists render cleanly.
- Add prominent Model Usage summary blocks (week spend, month spend, top-spend model + amount).
- Increase pane header sizes across dashboard.
- Add a top status-bar monthly spend tracker.
- Make uptime track gateway runtime (since last gateway restart), not page-open time.

## Execution Strategy

1. Lock behavior with failing tests first (RED).
2. Implement backend contract changes (GREEN).
3. Implement frontend rendering/styling changes (GREEN).
4. Refactor for clean architecture and maintainability (REFACTOR).
5. Run full verification gates before merge.

## 1) Tests First (RED)

1. Update backend tests in `tests/routes/model-usage-live-weekly.test.js` for new response fields:
   - `weekSpend`
   - `monthSpend`
   - `topMonthModel` (`model`, `alias`, `totalCost`)
2. Add/expand frontend model panel tests in `tests/public/panels/models.test.js`:
   - Summary cards render above model list.
   - Top header monthly spend stat updates.
3. Add/expand system panel tests in `tests/public/panels/system.test.js`:
   - Providers/channels render as readable wrapped content (no broken inline overflow).
4. Add status/uptime tests in `tests/public/app.test.js` (or focused status tests):
   - Uptime derives from gateway lifecycle payload, not page start.
5. Add e2e checks in `e2e/dashboard.spec.js`:
   - Summary cards visible.
   - Header monthly spend visible.
   - Providers rendering remains readable.

## 2) Backend Changes (Gateway-first, no duct-tape fallback)

1. Extend `routes/model-usage.js` (`/api/model-usage/live-weekly`) with summary fields:
   - `weekSpend`
   - `monthSpend`
   - `topMonthModel`
2. Add month-window helper logic in `lib/helpers.js` using `HUD_USAGE_TZ`.
3. Compute spend values from gateway `sessions.usage` data.
4. Add truncation-resistant month aggregation strategy (adaptive date window splitting when needed).
5. Keep explicit diagnostics when gateway scope/availability prevents data (no silent degradation).

## 3) Uptime Source of Truth

1. Use gateway snapshot uptime (`snapshot.uptimeMs`) as baseline from `lib/gateway-ws.js`.
2. Broadcast uptime metadata in gateway status websocket messages from `server.js`.
3. Update `public/app/status.js` so `#stat-uptime` reflects gateway runtime + elapsed time while connected.
4. Wire status updates through `public/app/ws.js` and existing gateway-status handlers.

## 4) Frontend QoL / UI

1. Chat readability in `public/chat-pane.css`:
   - Increase message/body/markdown sizes proportionally.
   - Preserve hierarchy for code, tool blocks, and metadata.
2. Providers formatting in `public/panels/system.js` + `public/styles/system.css`:
   - Render as structured wrapped chips/list.
   - Keep alignment stable on narrow widths.
3. Model summary cards in `public/panels/models.js` + `public/styles/models.css`:
   - Place directly below MODEL USAGE header and above per-model bars.
4. Larger pane headers in `public/styles/panels.css` (+ chat header alignment in `public/chat-pane.css` if needed).
5. Header monthly spend stat:
   - Add stat block in `public/index.html`.
   - Style in `public/styles/header.css`.
   - Populate from model usage payload in `public/panels/models.js`.

## 5) Verification Gates

1. `npm test`
2. `npm run test:e2e`
3. `npm run quality`
4. Manual smoke:
   - Reload with gateway connected.
   - Confirm uptime resets on gateway restart.
   - Confirm month/week spend + top model refresh correctly.
   - Confirm providers rendering on desktop + narrow viewport.

## Acceptance Criteria

1. Chat pane text is clearly larger without visual regressions.
2. System providers formatting is clean and readable.
3. Model Usage shows live summary cards:
   - Week spend
   - Month spend
   - Top month model + spend
4. Pane headers are larger and consistent.
5. Top header includes live month spend.
6. Uptime reflects gateway runtime, not page session runtime.
7. Unit + e2e + quality gates all pass.

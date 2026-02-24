# Weekly Live Usage — Replanned for Post-Modularization Codebase (c5574ea)

**Date:** 2026-02-24  
**Repo:** `/Users/treygoff/Development/openclaw-hud`  
**Context:** Replanned after large modularization merge (`c5574ea`, chat-input/chat-pane/ws/frontend splits)

---

## Mission (unchanged)

Ship one trustworthy model-usage experience in HUD:

1. **Single operative mode only** (no mode switch).
2. **Live week-to-now** on every refresh: Sunday 00:00 (TZ) → request time.
3. **Costs repriced from current `~/.openclaw/openclaw.json`** (including zero-priced models).
4. **Include all models with `totalTokens > 0`** for the live week.
5. **Week resets naturally on Sunday** (window logic).
6. **Sunday snapshots archived immutably** for history only (never live source).

---

## What changed in architecture (important re-targeting)

### Backend ownership (updated)
- Do **not** keep piling weekly usage logic into `routes/config.js`.
- Introduce dedicated route boundary:
  - `routes/model-usage.js` (new)
- Introduce dedicated gateway/RPC seam:
  - `lib/usage-rpc.js` (new, wraps existing gateway request path)
- Shared domain modules:
  - `lib/pricing.js` (new)
  - `lib/cache.js` (new)
  - `lib/usage-archive.js` (new)

### Frontend ownership (updated)
- `public/app.js` is facade; don’t wire feature logic there.
- Live usage flow belongs in:
  - `public/app/data.js` (endpoint fetch wiring)
  - `public/panels/models.js` (contract adapter + rendering)
- Refresh orchestration already good:
  - Polling: `public/app/polling.js`
  - WS tick refresh: `public/app/ws.js`

---

## Canonical data & pricing policy

1. Canonical usage rows come from OpenClaw `sessions.usage` for live week window.
2. HUD display costs are **always** computed from current config pricing in `openclaw.json`.
3. HUD does **not** trust transcript logged `message.usage.cost.total` for display totals.
4. If provider/model pricing missing: set cost to 0 and emit diagnostics metadata.

---

## Live endpoint contract (freeze this early)

`GET /api/model-usage/live-weekly`

Response:

```json
{
  "meta": {
    "period": "live-weekly",
    "tz": "America/Chicago",
    "weekStart": "ISO",
    "now": "ISO",
    "generatedAt": "ISO",
    "source": "sessions.usage+config-reprice",
    "missingPricingModels": ["optional list"]
  },
  "models": [
    {
      "provider": "string",
      "model": "string",
      "inputTokens": 0,
      "outputTokens": 0,
      "cacheReadTokens": 0,
      "cacheWriteTokens": 0,
      "totalTokens": 0,
      "totalCost": 0
    }
  ],
  "totals": {
    "inputTokens": 0,
    "outputTokens": 0,
    "cacheReadTokens": 0,
    "cacheWriteTokens": 0,
    "totalTokens": 0,
    "totalCost": 0
  }
}
```

Rules:
- `models[]` must include only rows with `totalTokens > 0`.
- `generatedAt` reflects cache behavior (stable within TTL, refreshed after).

---

## Execution waves (final)

## Wave 0 — Foundation (serial)

### T1. Week window + runtime config boundary
**Parallel:** No  
**Blocked by:** none

**Files**
- `lib/helpers.js` (modify)
- `server.js` (modify)
- `tests/lib/helpers.test.js` (modify/expand)

**Work**
- Add `getLiveWeekWindow(tz, nowMs?)` (Sunday 00:00 to now).
- Add envs:
  - `HUD_USAGE_TZ` default `America/Chicago`
  - `HUD_USAGE_CACHE_TTL_MS` default `15000`
- Validate DST and week boundary behavior.

**Quality gate (required)**
- `npm test -- tests/lib/helpers.test.js`

---

## Wave 1 — Backend core contract (serial)

### T2a. Create dedicated usage RPC + route seam
**Parallel:** No  
**Blocked by:** T1

**Files**
- `lib/usage-rpc.js` (new)
- `routes/model-usage.js` (new)
- `server.js` (wire route)

**Work**
- Wrap gateway request for `sessions.usage` in `lib/usage-rpc.js`.
- Add new route module to own model-usage endpoints.

**Quality gate (required)**
- route/module load tests pass.

### T2b. Implement `/api/model-usage/live-weekly` using week window
**Parallel:** No  
**Blocked by:** T2a

**Files**
- `routes/model-usage.js` (modify)
- `tests/routes/model-usage-live-weekly.test.js` (new)

**Work**
- Call `sessions.usage` with Sun→now.
- Return frozen contract (`meta/models/totals`).
- Keep legacy `/api/model-usage` temporarily (deprecation path).

**Quality gate (required)**
- `npm test -- tests/routes/model-usage-live-weekly.test.js`

### T3. Repricing engine (config-authoritative)
**Parallel:** No  
**Blocked by:** T2b

**Files**
- `lib/pricing.js` (new)
- `routes/model-usage.js` (modify)
- `tests/lib/pricing.test.js` (new)
- `tests/routes/model-usage-pricing.test.js` (new)

**Work**
- Resolve rates from active `openclaw.json`.
- Recompute every model row cost from token buckets.
- Ignore transcript logged costs in HUD response.
- Emit `missingPricingModels` diagnostics.

**Quality gate (required)**
- `npm test -- tests/lib/pricing.test.js tests/routes/model-usage-pricing.test.js`

---

## Wave 2 — Parallel tracks (after T2b contract freeze)

### T4. TTL cache + refresh bypass
**Parallel:** Yes  
**Blocked by:** T2b

**Files**
- `lib/cache.js` (new)
- `routes/model-usage.js` (modify)
- `tests/lib/cache.test.js` (new)
- `tests/routes/model-usage-cache.test.js` (new)

**Work**
- Cache key: `(weekStartIso, tz, pricingFingerprint)`.
- Default TTL 15s.
- `?refresh=1` bypass.

**Quality gate (required)**
- `npm test -- tests/lib/cache.test.js tests/routes/model-usage-cache.test.js`

### T5. Frontend migration to live-weekly contract
**Parallel:** Yes  
**Blocked by:** T2b (final wiring), T3 (final cost semantics)

**Files**
- `public/app/data.js` (modify)
- `public/panels/models.js` (modify)
- `tests/public/panels/models.test.js` (modify)
- `tests/public/fetch-resilience.test.js` (modify)
- `tests/public/models-live-weekly.test.js` (new, optional if panel tests cover all)

**Work**
- Swap endpoint to `/api/model-usage/live-weekly` in data controller.
- Adapt renderer from legacy map to `{ meta, models[], totals }`.
- Render label: `This week (Sun → now, TZ)` from `meta`.
- Preserve empty state.

**Quality gate (required)**
- `npm test -- tests/public/panels/models.test.js`

### T6. `/api/models` phantom model cleanup (gated)
**Parallel:** Yes  
**Blocked by:** T2b

**Files**
- `routes/config.js` (modify)
- `tests/routes/config.test.js` (modify)

**Work**
- Remove hardcoded alias/model injection only after regression guard coverage.
- Ensure spawn/model-picker dependencies still pass.

**Quality gate (required)**
- `npm test -- tests/routes/config.test.js`

---

## Wave 3 — Integration lock (serial)

### T7. Integrate + verify live behavior
**Parallel:** No  
**Blocked by:** T3, T4, T5 (T6 strongly recommended)

**Files**
- `e2e/models-live-weekly.spec.js` (new)
- `docs/plans/rollout-live-weekly.md` (new)

**Work**
- Verify week-to-now refresh behavior via polling + WS tick.
- Verify zero-cost pricing behavior from config edits after TTL.
- Verify inclusive model rows (`totalTokens > 0`).

**Quality gate (required)**
- `npm run test:e2e -- e2e/models-live-weekly.spec.js`

---

## Wave 4 — Sunday archive (serial)

### T8. Immutable historical snapshot pipeline
**Parallel:** No  
**Blocked by:** T3 (repricing finalized)

**Files**
- `lib/usage-archive.js` (new)
- `routes/model-usage.js` (modify: historical read endpoint)
- `scripts/setup-weekly-archive-cron.sh` (new)
- `tests/lib/usage-archive.test.js` (new)
- `docs/weekly-usage-archive.md` (new)

**Work**
- Sunday job writes just-ended week snapshot immutably.
- Historical endpoint reads archive only.
- Ensure live route never reads archive.

**Quality gate (required)**
- `npm test -- tests/lib/usage-archive.test.js`

---

## Wave 5 — Deprecation cleanup (serial)

### T9. Remove legacy route + finalize rollout
**Parallel:** No  
**Blocked by:** T7 + T8 + parity window

**Files**
- `routes/config.js` / `routes/model-usage.js` (modify)
- `docs/plans/rollout-live-weekly.md` (update)

**Work**
- Monitor parity for 24h.
- Remove deprecated `/api/model-usage` path.
- Confirm single source path in docs + tests.

**Quality gate (required)**
- full targeted suite passes.

---

## Required validation bundle (merge-blocking)

```bash
npm test -- tests/lib/helpers.test.js \
  tests/lib/pricing.test.js \
  tests/lib/cache.test.js \
  tests/routes/model-usage-live-weekly.test.js \
  tests/routes/model-usage-pricing.test.js \
  tests/routes/model-usage-cache.test.js \
  tests/routes/config.test.js \
  tests/public/panels/models.test.js

npm run test:e2e -- e2e/models-live-weekly.spec.js
```

---

## Top rollout risks + mitigation

1. **Contract drift (`map` vs `models[]`)** → dual-shape adapter until FE fully migrated.
2. **Route merge churn** → isolate usage logic in `routes/model-usage.js` early.
3. **Stale costs after config edit** → pricing fingerprint in cache key + `refresh=1`.
4. **Sunday/DST errors** → deterministic boundary tests in helpers.
5. **Missing pricing silent failures** → explicit `missingPricingModels` metadata.
6. **Archive contaminates live pane** → separate service functions + integration assertion.
7. **/api/models cleanup regressions** → gate with route regression coverage before removal.

---

## Definition of done

- One live weekly usage mode exists and is the only mode.
- Frontend consumes `/api/model-usage/live-weekly` via modular data/panel seams.
- Costs match current `openclaw.json` pricing, including zero-cost models.
- All models with weekly usage (`totalTokens > 0`) are displayed.
- Sunday reset and immutable weekly archives both work.
- Legacy route removed after parity validation.

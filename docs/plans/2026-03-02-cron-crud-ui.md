# OpenClaw HUD Cron CRUD Gateway-Canonical Migration Plan

**Goal:** Replace HUD cron file-mutation behavior with gateway WS RPC-backed CRUD that stays aligned with canonical OpenClaw cron contracts and hardened gateway policy.

**Architecture:** Keep HUD as a thin API/UI layer. All cron writes (`add/update/remove`) go through gateway RPC methods, and list reads use gateway pagination as the canonical path. Local list fallback exists only as an explicit degraded secondary path with operator-visible diagnostics; it is not a primary reliability strategy. Centralize error normalization so HUD status codes are stable even when raw gateway messages vary.

**Tech Stack:** Node.js + Express (CommonJS), existing `GatewayWS` + `gateway-connect-auth`, Vanilla JS panel UI, Vitest, Playwright.

---

## Strict-Mode Note (Latest-Only Baseline)

- This plan targets newest OpenClaw gateway contracts as first-class baseline.
- Cron mutation flows are fail-fast with actionable diagnostics; no silent fallback substitution is allowed for core operations.
- `GET /api/cron` local fallback is degraded secondary-only and must be explicitly flagged (`meta.gatewayAvailable=false`) in API/UI state.

## Ground Truth (Canonical Contract)

- Canonical cron RPC handlers live in `/Users/treygoff/Code/openclaw/src/gateway/server-methods/cron.ts`.
- Canonical cron schemas live in `/Users/treygoff/Code/openclaw/src/gateway/protocol/schema/cron.ts`.
- Canonical scope policy lives in `/Users/treygoff/Code/openclaw/src/gateway/method-scopes.ts`.
- Canonical runtime semantics (including remove idempotency) live in `/Users/treygoff/Code/openclaw/src/cron/service/ops.ts`.

Current HUD mismatch: `routes/cron.js` directly reads/writes `~/.openclaw/cron/jobs.json` and does not implement canonical `POST /api/cron` + `DELETE /api/cron/:jobId` gateway-backed CRUD flow.

Scope constraint: this plan is cron-specific only. It does not change spawn transport constraints; `sessions_spawn` remains a `/tools/invoke` compatibility path in current OpenClaw.

## Canonical WS RPC Cron Path

All HUD cron operations must use the same gateway WS request path:

1. `connect.challenge` event received from gateway.
2. HUD sends `connect` request with `buildConnectParams(...)` device proof.
3. HUD sends request frame: `{ type: "req", id, method, params }`.
4. HUD consumes response frame: `{ type: "res", id, ok, payload?, error? }`.

Canonical methods:

- `cron.list`
- `cron.add`
- `cron.update`
- `cron.remove`

## Scope Requirements (Least Privilege)

- `cron.list` requires `operator.read` (read-compatible callers with `operator.write` also pass server auth).
- `cron.add`, `cron.update`, `cron.remove` require `operator.admin`.
- HUD cron service must request only method-required scopes per call path; do not rely on a broad static scope set for all operations.

## Canonical Payload Shapes (Must Match)

### `cron.list`

Request params shape:

```json
{
  "includeDisabled": true,
  "limit": 50,
  "offset": 0,
  "query": "optional",
  "enabled": "all",
  "sortBy": "nextRunAtMs",
  "sortDir": "asc"
}
```

Response payload shape:

```json
{
  "jobs": [
    {
      "id": "...",
      "name": "...",
      "enabled": true,
      "schedule": { "kind": "every", "everyMs": 60000, "anchorMs": 0 },
      "sessionTarget": "main",
      "wakeMode": "next-heartbeat",
      "payload": { "kind": "systemEvent", "text": "..." },
      "state": { "nextRunAtMs": 0 }
    }
  ],
  "total": 1,
  "offset": 0,
  "limit": 50,
  "hasMore": false,
  "nextOffset": null
}
```

### `cron.update`

Request params shape:

```json
{
  "id": "job-id",
  "patch": {
    "enabled": false,
    "schedule": { "kind": "at", "at": "2026-03-05T12:00:00.000Z" },
    "payload": { "kind": "systemEvent", "text": "updated" }
  }
}
```

Notes:

- `jobId` alias is accepted by gateway, but HUD should normalize to `id` for outbound calls.
- `patch` is required and must follow canonical `CronJobPatchSchema`.
- Response payload is the full updated `CronJob` object.

## Remove Not-Found Semantics (Canonical)

`cron.remove` is idempotent. Unknown IDs return success payload with `removed: false`.

```json
{ "ok": true, "removed": false }
```

HUD must not remap this to `404`. Return `200` with `removed:false` and let UI show "already absent" semantics.

## Corrected Error Mapping (HUD HTTP)

Translate gateway errors using code + message pattern instead of raw string passthrough:

- `INVALID_REQUEST` + `missing scope` or `unauthorized role` -> `403 Forbidden`
- `INVALID_REQUEST` + `unknown cron job id` (update/run paths) -> `404 Not Found`
- Other `INVALID_REQUEST` -> `400 Bad Request`
- `UNAVAILABLE` or transport/connect failures (`ECONN*`, timeout, connect closed) -> `503 Service Unavailable`
- Unclassified gateway response failure -> `502 Bad Gateway`

## Local-Origin Guard (HUD Policy)

Even with gateway auth/scope checks, keep `requireLocalOrigin` for all mutating HUD cron endpoints as an explicit HUD browser-surface policy:

- Blocks cross-site mutation attempts early (`403 Forbidden origin`).
- Allows loopback-origin requests and tailscale loopback proxy path.
- This is defense-in-depth for local operator UX, not a substitute for gateway auth.

## Endpoint Contract (HUD)

- `GET /api/cron`
  - Primary: gateway `cron.list`
  - Degraded secondary path only: local read-only list with `meta.gatewayAvailable=false` and explicit operator-facing degraded diagnostics
- `POST /api/cron`
  - Gateway `cron.add`
- `PUT /api/cron/:jobId`
  - Gateway `cron.update`
- `DELETE /api/cron/:jobId`
  - Gateway `cron.remove`
- `POST /api/cron/:jobId/toggle`
  - Compatibility shim: gateway `cron.update` with `{ patch: { enabled: !current } }`

## Task Plan

### Task 1: Add Cron Gateway Adapter + Error Normalizer

**Parallel:** no  
**Blocked by:** none  
**Owned files:** `lib/cron-gateway.js`, `lib/gateway-rpc-errors.js`, `tests/lib/cron-gateway.test.js`

**Files:**
- Create: `lib/cron-gateway.js`
- Create: `lib/gateway-rpc-errors.js`
- Test: `tests/lib/cron-gateway.test.js`

**Step 1: Write failing adapter tests**
- Covers method names, param shaping, and response normalization.
- Covers corrected error mapping table.

**Step 2: Run tests (expect fail)**
Run: `npx vitest run tests/lib/cron-gateway.test.js`

**Step 3: Implement adapter + error mapping**
- Add `list/add/update/remove/toggle` helpers.
- Normalize `jobId` to `id` outbound.

**Step 4: Re-run tests (expect pass)**
Run: `npx vitest run tests/lib/cron-gateway.test.js`

### Task 2: Migrate Cron Routes to Gateway-First Controllers

**Parallel:** no  
**Blocked by:** Task 1  
**Owned files:** `routes/cron.js`, `tests/routes/cron.test.js`

**Files:**
- Modify: `routes/cron.js`
- Modify: `tests/routes/cron.test.js`

**Step 1: Write failing route tests**
- `POST /api/cron`, `DELETE /api/cron/:jobId`, toggle-via-update behavior.
- `removed:false` returns `200`, not `404`.
- Scope/auth mapping and `UNAVAILABLE` mapping.

**Step 2: Run tests (expect fail)**
Run: `npx vitest run tests/routes/cron.test.js`

**Step 3: Implement route migration**
- Remove direct file writes from mutation handlers.
- Keep read fallback path only as degraded secondary behavior with explicit diagnostics.
- Preserve `requireLocalOrigin` on mutations.

**Step 4: Re-run tests (expect pass)**
Run: `npx vitest run tests/routes/cron.test.js`

### Task 3: Update Cron Panel Contract + UX States

**Parallel:** yes  
**Blocked by:** Task 2  
**Owned files:** `public/panels/cron.js`, `tests/public/panels/cron.test.js`

**Files:**
- Modify: `public/panels/cron.js`
- Modify: `tests/public/panels/cron.test.js`

**Step 1: Add failing UI tests**
- Handles `removed:false` user messaging.
- Displays explicit degraded gateway-unavailable read-only state.
- Handles paged list payload from `cron.list` contract.

**Step 2: Run tests (expect fail)**
Run: `npx vitest run tests/public/panels/cron.test.js`

**Step 3: Implement UI updates**
- Adapt list parsing to page shape.
- Add explicit idempotent-delete messaging.

**Step 4: Re-run tests (expect pass)**
Run: `npx vitest run tests/public/panels/cron.test.js`

### Task 4: E2E CRUD + Contract Regression Coverage

**Parallel:** no  
**Blocked by:** Tasks 2, 3  
**Owned files:** `e2e/cron-crud.spec.js`

**Files:**
- Create or modify: `e2e/cron-crud.spec.js`

**Step 1: Add CRUD path tests**
- Create, update, remove, and remove-again idempotent flow.
- One scope/permission negative case.

**Step 2: Run E2E spec**
Run: `npx playwright test e2e/cron-crud.spec.js`

### Task 5: Integration Gate

**Parallel:** no  
**Blocked by:** Tasks 2, 3, 4  
**Owned files:** none

**Step 1: Run focused backend + frontend suites**
Run: `npx vitest run tests/lib/cron-gateway.test.js tests/routes/cron.test.js tests/public/panels/cron.test.js`

**Step 2: Run cron e2e**
Run: `npx playwright test e2e/cron-crud.spec.js`

**Step 3: Run full unit suite**
Run: `npm test`

## Acceptance Criteria

- Cron mutations are gateway-canonical (`cron.add/update/remove`) with no direct HUD cron file writes.
- HUD cron list contract correctly handles canonical page payload shape.
- HUD cron list fallback is degraded secondary-only, explicitly marked, and not relied upon as primary behavior.
- Error mapping reflects gateway hardening and yields stable HTTP statuses.
- `cron.remove` idempotency is preserved (`removed:false` => HTTP 200).
- Core cron operations fail fast with actionable diagnostics when gateway contract/scope requirements are not met.
- `requireLocalOrigin` remains enforced for all mutating cron routes as HUD policy.

## Non-Goals

- No upstream OpenClaw gateway/protocol changes.
- No removal of legacy toggle endpoint in this migration (compat shim retained).
- No broad cron UI redesign beyond contract-compatibility behavior.
- No claim that other privileged HUD flows (for example spawn) are currently WS-replaceable.
- No backward-compatibility-first framing for older OpenClaw cron contracts.

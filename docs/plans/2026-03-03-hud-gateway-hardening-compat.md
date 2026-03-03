# OpenClaw HUD Gateway Hardening Compatibility Migration Plan

**Goal:** Move the entire HUD gateway surface (HTTP routes + WS chat paths + usage RPC) onto one hardened compatibility layer that matches the newest OpenClaw gateway contracts and scope policy, with fail-fast diagnostics for core operator flows.

**Architecture:** Introduce a shared gateway compatibility module for method invocation, scope-aware auth/session setup, and normalized error translation. Route/chat modules become thin adapters over that module. Core mutation and operator flows fail fast with actionable diagnostics; degraded read paths are explicit and secondary.

**Tech Stack:** Node.js + Express (CommonJS), `ws`, existing `GatewayWS` + `gateway-connect-auth`, Vanilla JS frontend, Vitest, Playwright.

**Transport constraint:** OpenClaw currently has no first-class `sessions.spawn` WS RPC in the method catalog. `sessions_send` can be covered by `chat.send`, but spawn remains a `/tools/invoke` (`sessions_spawn`) compatibility concern in this migration.

---

## Support Posture (Strict Latest-Only)

- Baseline is newest supported OpenClaw only; this plan does not optimize for older gateway contracts.
- Core flows (`spawn`, cron mutations, chat send/abort, usage calls) are fail-fast: no silent fallback substitution, and every failure returns actionable diagnostics (error category, reason, operator remediation).
- Degraded behavior is explicitly surfaced and limited to read-only endpoints where product policy still allows it; degraded paths are secondary and never the primary success strategy.
- Spawn remains on `/tools/invoke` for now, and required allowlist/denylist override configuration is a hard setup gate before spawn UI is enabled.

## Incompatibility Inventory (Current HUD vs Canonical Gateway)

1. `routes/cron.js`
- Uses local file writes for mutations.
- Does not use canonical RPC payload shapes (`cron.update` expects nested `patch`).
- Missing canonical idempotent remove semantics.

2. `routes/spawn.js` and `ws/chat-handlers/command-handlers.js`
- Call `/tools/invoke` directly with per-call ad hoc mapping.
- Gateway failure classification differs from other modules.
- No direct `sessions.spawn` WS RPC exists today, so spawn cannot be fully moved off invoke transport yet.

3. `lib/usage-rpc.js`
- Owns a second WS connect/request implementation.
- Error codes differ from chat and route adapters.

4. `ws/chat-handlers/history.js`
- Has strong fallback classification, but mapping is local to chat-history and not reused by routes.

5. Scope usage drift across entry points
- Canonical method scopes are centralized upstream, but HUD entry points use mixed static scope sets and message-string checks.

6. Origin/local policy duplication
- `requireLocalOrigin` exists in multiple routes with near-duplicate logic.
- Policy is good, but not centralized and easy to drift.

## Architecture Decision

### Decision

Create a single HUD Gateway Compatibility Layer, then migrate every gateway-touching route/WS handler onto it.

### Why

- One place for gateway handshake, method invocation, and response/error normalization.
- Prevents drift between cron/spawn/chat/usage behavior.
- Lets HUD apply gateway hardening consistently (scope correctness, host locality policy, degraded fallback behavior).

### Core Modules

- `lib/gateway-compat/client.js`
  - Scope-aware WS request helper (`callGatewayMethod(method, params, options)`).
  - Shared connect/auth path using `buildConnectParams`.

- `lib/gateway-compat/error-map.js`
  - Canonical mapping of gateway errors -> HUD categories -> route status codes.

- `lib/gateway-compat/origin-policy.js`
  - Shared `requireLocalOrigin` middleware factory for HTTP mutation routes.

- `lib/gateway-compat/contracts/`
  - Thin contract helpers for known methods (`cron`, `sessions.usage`, `chat.history`) plus explicit spawn invoke compatibility helpers (`sessions_spawn`).

## Phased Migration Tasks

### Phase 0: Spawn Invoke Preflight and Setup Gate

**Parallel:** no  
**Blocked by:** none  
**Owned files:** `routes/spawn.js`, `server.js`, `public/panels/spawn.js`, `tests/routes/spawn.test.js`, `tests/public/panels/spawn.test.js`

**Files:**
- Modify: `routes/spawn.js`
- Modify: `server.js`
- Modify: `public/panels/spawn.js`
- Modify: `tests/routes/spawn.test.js`
- Modify: `tests/public/panels/spawn.test.js`

**Work:**
- Add explicit startup preflight that validates `sessions_spawn` invoke capability and required allowlist/denylist override configuration.
- Gate spawn UI enablement on successful preflight; if preflight fails, keep UI disabled and show actionable diagnostics for operator setup.
- Ensure no silent spawn fallback path exists when invoke capability or hardening config is missing.

**Verification commands:**
- `npx vitest run tests/routes/spawn.test.js tests/public/panels/spawn.test.js`

### Phase 1: Compatibility Core Foundation

**Parallel:** no  
**Blocked by:** none  
**Owned files:** `lib/gateway-compat/client.js`, `lib/gateway-compat/error-map.js`, `lib/gateway-compat/origin-policy.js`, `tests/lib/gateway-compat-client.test.js`, `tests/lib/gateway-compat-error-map.test.js`, `tests/lib/gateway-compat-origin-policy.test.js`

**Files:**
- Create: `lib/gateway-compat/client.js`
- Create: `lib/gateway-compat/error-map.js`
- Create: `lib/gateway-compat/origin-policy.js`
- Create: `tests/lib/gateway-compat-client.test.js`
- Create: `tests/lib/gateway-compat-error-map.test.js`
- Create: `tests/lib/gateway-compat-origin-policy.test.js`

**Verification commands:**
- `npx vitest run tests/lib/gateway-compat-client.test.js`
- `npx vitest run tests/lib/gateway-compat-error-map.test.js`
- `npx vitest run tests/lib/gateway-compat-origin-policy.test.js`

### Phase 2: Cron Canonical Migration

**Parallel:** no  
**Blocked by:** Phase 1  
**Owned files:** `routes/cron.js`, `lib/gateway-compat/contracts/cron.js`, `tests/routes/cron.test.js`, `tests/lib/cron-gateway.test.js`, `public/panels/cron.js`, `tests/public/panels/cron.test.js`

**Files:**
- Create: `lib/gateway-compat/contracts/cron.js`
- Modify: `routes/cron.js`
- Modify: `tests/routes/cron.test.js`
- Create: `tests/lib/cron-gateway.test.js`
- Modify: `public/panels/cron.js`
- Modify: `tests/public/panels/cron.test.js`

**Verification commands:**
- `npx vitest run tests/lib/cron-gateway.test.js tests/routes/cron.test.js`
- `npx vitest run tests/public/panels/cron.test.js`

### Phase 3A: Spawn Route Compatibility (HTTP)

**Parallel:** yes  
**Blocked by:** Phase 0, Phase 1  
**Owned files:** `routes/spawn.js`, `tests/routes/spawn.test.js`

**Files:**
- Modify: `routes/spawn.js`
- Modify: `tests/routes/spawn.test.js`

**Work:**
- Keep spawn on `/tools/invoke` (`sessions_spawn`) via a shared compatibility helper; do not attempt WS replacement in this phase.
- Route uses `gateway-compat` error mapping and shared origin middleware.
- Preserve loopback-host guard and explicit `GATEWAY_HOST_UNSUPPORTED` handling.
- Treat allowlist/denylist override as required setup state and fail fast with actionable diagnostics when missing/invalid.
- Add explicit handling for gateway hardening denylist outcomes; do not silently degrade spawn behavior.

**Verification commands:**
- `npx vitest run tests/routes/spawn.test.js`

### Phase 3B: Usage RPC Compatibility (WS)

**Parallel:** yes  
**Blocked by:** Phase 1  
**Owned files:** `lib/usage-rpc.js`, `tests/lib/usage-rpc.test.js`, `routes/model-usage.js`, `tests/routes/model-usage-live-weekly.test.js`, `tests/routes/model-usage-monthly.test.js`

**Files:**
- Modify: `lib/usage-rpc.js`
- Modify: `tests/lib/usage-rpc.test.js`
- Modify: `routes/model-usage.js`
- Modify: `tests/routes/model-usage-live-weekly.test.js`
- Modify: `tests/routes/model-usage-monthly.test.js`

**Work:**
- Replace one-off WS call path with compatibility client.
- Keep existing degraded payload semantics (`meta.unavailable`) for usage routes.

**Verification commands:**
- `npx vitest run tests/lib/usage-rpc.test.js`
- `npx vitest run tests/routes/model-usage-live-weekly.test.js tests/routes/model-usage-monthly.test.js`

### Phase 3C: Chat Handler Compatibility

**Parallel:** yes  
**Blocked by:** Phase 1  
**Owned files:** `ws/chat-handlers/command-handlers.js`, `ws/chat-handlers/history.js`, `tests/ws/chat-handlers.test.js`

**Files:**
- Modify: `ws/chat-handlers/command-handlers.js`
- Modify: `ws/chat-handlers/history.js`
- Modify: `tests/ws/chat-handlers.test.js`

**Work:**
- Reuse compatibility error categories for chat-history, chat-send, and chat-abort responses.
- Keep fallback behavior explicit and diagnostics-first; remove ad hoc duplication and silent fallback reliance.

**Verification commands:**
- `npx vitest run tests/ws/chat-handlers.test.js`

### Phase 4: Server-Wide Gateway Policy Consistency

**Parallel:** no  
**Blocked by:** Phases 3A, 3B, 3C  
**Owned files:** `server.js`, `lib/gateway-ws.js`, `tests/lib/gateway-ws.test.js`, `tests/routes/health.test.js`

**Files:**
- Modify: `server.js`
- Modify: `lib/gateway-ws.js`
- Modify: `tests/lib/gateway-ws.test.js`
- Modify: `tests/routes/health.test.js`

**Work:**
- Ensure connection defaults/scopes are explicit and compatible with method-level calls.
- Keep status broadcast behavior (`gateway-status`) stable for UI consumers.

**Verification commands:**
- `npx vitest run tests/lib/gateway-ws.test.js tests/routes/health.test.js`

### Phase 5: Integration and E2E Contract Lock

**Parallel:** no  
**Blocked by:** Phases 0, 2, 3A, 3B, 3C, 4  
**Owned files:** `e2e/cron-crud.spec.js`, `e2e/modals.spec.js`, `e2e/chat.spec.js` (or existing chat e2e), `docs/plans/2026-03-03-hud-gateway-hardening-compat.md`

**Files:**
- Modify/create: `e2e/cron-crud.spec.js`
- Modify: `e2e/modals.spec.js`
- Modify/create: chat e2e spec covering fail-fast diagnostics and explicit degraded-state behavior
- Modify: this plan doc with final execution notes (post-implementation)

**Verification commands:**
- `npx playwright test e2e/cron-crud.spec.js`
- `npx playwright test e2e/modals.spec.js`
- `npm test`
- `npm run test:e2e`

**Execution notes (2026-03-03):**
- E2E focus for Phase 5 was run with these commands:
  - `npx playwright test e2e/cron-crud.spec.js`
  - `npx playwright test e2e/modals.spec.js`
  - `npx playwright test e2e/chat.spec.js`
- `e2e/cron-crud.spec.js` now asserts fixture IDs/names plus deterministic PUT payload shape and explicit cron degraded banner behavior.
- `e2e/modals.spec.js` now includes spawn preflight fail-fast gating + diagnostic surfacing when gate returns degraded state.
- `e2e/chat.spec.js` now covers chat gateway disconnected banner transitions and explicit send failure/failed-message retry path.
- Phase 5 run summary (2026-03-03):
  - `npx playwright test e2e/cron-crud.spec.js` → 3 passed.
  - `npx playwright test e2e/modals.spec.js` → 10 passed.
  - `npx playwright test e2e/chat.spec.js` → 2 passed.
  - Initial flake observed in modal tests from spawn preflight defaulting to blocked state was converted to deterministic pass-fail behavior by explicit preflight stubbing.

### Phase 6 (Optional): Upstream First-Class Spawn RPC Collaboration

**Parallel:** yes  
**Blocked by:** none  
**Owned files:** `docs/plans/2026-03-03-hud-gateway-hardening-compat.md`

**Work:**
- Open upstream collaboration item proposing a first-class spawn RPC contract (`sessions.spawn` or equivalent) with required scope model and parity behavior for current `sessions_spawn` tool invocation.
- Track decision outcome and migration trigger conditions in this plan doc.

## Test Strategy

1. Unit tests (new compatibility layer)
- Validate scope routing, request shaping, and all error-map branches.
- Validate shared origin middleware behavior (loopback, tailscale proxy, non-local denial).
- Validate preflight gate behavior for spawn invoke capability and allowlist/denylist override requirements.

2. Route tests
- Cron: canonical CRUD, idempotent remove, corrected HTTP status mapping.
- Spawn: host guard + unified gateway errors + required setup/preflight gate diagnostics.
- Model usage: degraded/unavailable metadata remains stable.

3. WS/chat tests
- Gateway-first paths still succeed.
- Degraded behavior is explicit and classified; no silent fallback substitution for core operations.
- Error payloads use normalized categories.

4. E2E tests
- Cron CRUD flow from UI.
- Chat history behavior under connected and degraded gateway states with explicit diagnostics.
- Spawn UI remains disabled until preflight passes; no hidden transport fallback.
- No regressions in modal/spawn UX where gateway calls are involved.

## Rollout and Risk Mitigation

1. Incremental release slices
- Land Phase 0 first to enforce spawn setup gates before enabling UI paths.
- Land Phase 1 next with no behavior changes.
- Migrate cron next (highest contract drift, isolated surface).
- Migrate spawn/usage/chat in parallel lanes with file ownership boundaries.

2. Strict-mode guards
- Keep `POST /api/cron/:jobId/toggle` as compatibility shim until UI migration is fully stable.
- Keep degraded behavior explicit and operator-visible; no silent fallback assumptions.

3. Failure containment
- Route-level degraded paths are read-only only (`/api/cron` list degraded path, model usage unavailable metadata) and must carry explicit diagnostics.
- If compatibility client fails, fail closed on core mutation/operator flows and fail with explicit degraded status on approved read-only endpoints.

4. Verification gates before merge
- Targeted Vitest slices per phase must pass before moving to next phase.
- Final `npm test` + `npm run test:e2e` required.

5. Rollback strategy
- Each phase is separately revertible by file ownership; avoid bundling phases into one PR/commit.

## Acceptance Criteria

- Every HUD gateway call path uses shared compatibility adapters and error mapping, including explicit invoke-transport handling for `sessions_spawn`.
- HUD support posture is strict latest-only; plan and implementation target newest OpenClaw contracts as first-class baseline.
- Spawn UI is gated by successful preflight validation of invoke capability and required allowlist/denylist override configuration.
- Cron API matches canonical OpenClaw WS contracts, including idempotent remove semantics.
- Scope failures and unavailable failures map to stable HUD categories/statuses.
- Local-origin guard remains enforced for mutating HTTP routes as HUD policy.
- Core flows fail fast with actionable diagnostics and no silent fallback reliance.
- Degraded read behavior is explicit, secondary, and operator-visible (for example model usage unavailable metadata, read-only cron list degraded path).
- Spawn path handles hardening denylist outcomes predictably and enforces required allowlist/denylist override setup gate.
- Full unit + e2e gates pass.

## Non-Goals

- No upstream OpenClaw gateway protocol or scope policy changes.
- No immediate replacement of `sessions_spawn` invoke transport with WS RPC in HUD-only scope.
- No redesign of HUD visual UI beyond compatibility/error-state behavior.
- No backward-compatibility-first behavior for older OpenClaw gateway contracts.
- No hidden fallback dependency for core mutation/operator paths.
- No auth model expansion beyond current local operator + gateway token/device model.

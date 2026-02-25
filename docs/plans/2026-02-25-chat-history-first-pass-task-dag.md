# Chat History First-Pass Reliability — Task DAG

Date: 2026-02-25  
Scope: HUD-only changes (no OpenClaw runtime/source changes)

## Goal

Make chat history load succeed on first pass in normal conditions, while preserving fallback behavior for degraded gateway paths.

## DAG Nodes

### N1 — Request Lifecycle State Model

- Status: `planned`
- Files:
  - `public/chat-pane/state.js`
  - `public/chat-pane/pane-lifecycle.js`
  - `public/chat-ws/system-events.js`
  - `public/chat-pane/transport.js`
- Work:
  - Add explicit chat-history lifecycle flags (in-flight, loaded key, request id/timestamp).
  - Ensure only one effective `chat-history` request per session at a time.
  - Prevent reconnect-triggered duplicate history requests when already loaded/in-flight.
- Acceptance:
  - Hard reload does not enqueue duplicate `chat-history` for same session.
  - Reconnect path requests history only when needed.

### N2 — Idempotent History Rendering + Warning Hygiene

- Status: `planned`
- Depends on: `N1`
- Files:
  - `public/chat-ws/history-log.js`
  - `public/chat-pane/history-timeout.js`
  - `public/chat-pane/state.js`
- Work:
  - Ignore duplicate `chat-history-result` payloads for same session/load attempt.
  - Prevent duplicate timeout/fallback warning banners and duplicate A11y announcements.
- Acceptance:
  - Duplicate history responses do not duplicate message DOM.
  - Timeout warnings appear once per load attempt.

### N3 — Server Error Adapter + Fallback Policy Tightening

- Status: `planned`
- Files:
  - `ws/chat-handlers/history.js`
  - `ws/chat-handlers/command-handlers.js`
- Work:
  - Normalize raw gateway errors to stable internal categories:
    - `forbidden`, `not_found`, `unavailable`, `timeout`, `auth_scope_missing`, `unknown`.
  - Preserve raw gateway metadata in logs.
  - Expand fallback eligibility to include transient transport/availability failures while keeping current forbidden/not-found behavior.
- Acceptance:
  - Gateway-first remains default.
  - Recoverable gateway failures return local history fallback without user-visible breakage.

### N4 — Observability + Diagnostics Contract

- Status: `planned`
- Depends on: `N3`
- Files:
  - `ws/chat-handlers/history.js`
  - `ws/chat-handlers/command-handlers.js`
  - `server.js` (if needed for lifecycle events)
- Work:
  - Add structured log fields for attempt/success/fallback/error with request/session correlation.
  - Include normalized reason + raw code/message for field debugging.
- Acceptance:
  - Logs allow answering: "why did fallback happen?" and "how often?" from one run.

### N5 — TDD Coverage for Gateway/Fallback + Dedupe

- Status: `planned`
- Depends on: `N1`, `N2`, `N3`
- Files:
  - `tests/ws/chat-handlers.test.js`
  - `tests/public/chat-pane.test.js`
  - `tests/lib/gateway-ws.test.js` (targeted retry policy assertions as needed)
- Work:
  - Add `FORBIDDEN` and transient gateway failure fallback tests.
  - Add client dedupe/single-flight tests.
  - Add duplicate render/timeout-warning suppression tests.
- Acceptance:
  - New reliability tests pass and fail on pre-fix behavior.

### N6 — End-to-End Reliability Smoke

- Status: `planned`
- Depends on: `N1`, `N2`, `N3`, `N4`, `N5`
- Files:
  - Existing e2e coverage and/or targeted smoke command set
- Work:
  - Validate hard reload behavior, reconnect behavior, and fallback behavior with no duplicate history render.
- Acceptance:
  - No duplicate request/fallback cascades in server logs for single reload cycle.
  - Chat history pane remains stable and readable across reconnect.

## Execution Order

1. `N1` and `N3` in parallel
2. `N2` after `N1`
3. `N4` after `N3`
4. `N5` across all prior nodes
5. `N6` final verification

## Non-Goals

- No OpenClaw runtime patches
- No API contract changes requiring gateway/server upstream modifications

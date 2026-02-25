# Chat History First-Pass Device Auth Fix DAG (2026-02-25)

## Objective

Make chat history load succeed on first pass via gateway (no fallback in normal conditions) by aligning HUD gateway WS authentication with OpenClaw's device-bound scope model.

## Constraints

- Do not modify OpenClaw upstream source.
- Keep fallback logic in HUD as a safety net for real degradation.
- Durable for any user cloning/running this repo.

## Confirmed Root Cause

- HUD main gateway WS client sends declared scopes but no `device` identity/proof.
- OpenClaw clears unbound scopes when device identity is missing.
- `chat.history` requires `operator.read`, so gateway rejects with missing scope -> HUD fallback.

## DAG

### D1 - Shared Connect/Auth Primitive

- Create a shared module for gateway connect auth payload construction:
- Stable device proof generation (`id/publicKey/signature/signedAt/nonce`).
- Reusable connect params builder (role/scopes/auth/client metadata).
- Used by both main WS client and usage RPC path to prevent drift.
- Fresh proof per handshake (never cached): new signature/signedAt each connect.
- Fail closed on missing token/nonce/identity; never log private key or token.

Acceptance:
- One canonical codepath builds signed device connect payloads.
- No duplicated handshake-signing logic across modules.

### D2 - Main WS Handshake Upgrade

- Update `lib/gateway-ws.js` to include signed `device` proof in connect request.
- Keep token auth in `auth.token`.
- Keep role `operator`; set scopes to least privilege needed by HUD (`operator.read`, `operator.write`).
- Ensure reconnect path reuses the same handshake builder (no shortcut path without device proof).

Acceptance:
- Main WS client can call `chat.history` immediately after connect without scope error.
- Existing connection/reconnect behavior remains intact.

### D3 - Usage RPC Refactor to Shared Primitive

- Refactor `lib/usage-rpc.js` to consume shared auth/connect builder from D1.
- Preserve current successful behavior for `sessions.usage`.
- Keep this step isolated and verifiable; revert independently if any usage regression appears.

Acceptance:
- `requestSessionsUsage` still succeeds.
- No behavior regressions in usage error mapping.

### D4 - TDD Coverage (Red -> Green)

- Add/adjust tests for handshake payload correctness in `tests/lib/gateway-ws.test.js`.
- Add tests that prove signed `device` is present and scope list is expected.
- Add reconnect test proving a fresh signed proof is sent on reconnect.
- Add scope-clearing regression test (missing device would fail scope-gated method).
- Add test for shared auth helper deterministic shape and required fields.
- Update usage-rpc tests if needed for shared builder integration.

Acceptance:
- Targeted suite passes.
- New tests fail on pre-fix code and pass post-fix.

### D5 - Integration Verification Against Live Gateway

- Reproduce previous failure path (`chat.history` missing scope) no longer occurs.
- Verify first-pass chat history returns from gateway for:
- `agent:codex:main`
- `agent:codex:discord:channel:1475972666773995580` (if available)

Acceptance:
- Logs show `gateway-success` on first request; no fallback for normal startup path.

### D6 - Cross-Model Review and Incorporation

- Run independent architecture/code review via:
- Gemini lane (OpenClaw `gemini-reasoning` agent)
- Claude lane (`claude -p`)
- Incorporate concrete, non-conflicting suggestions into implementation/tests.

Acceptance:
- Both review outputs captured.
- Incorporated deltas are test-validated.

## File Ownership Plan

- `lib/gateway-connect-auth.js` (new): shared auth/connect payload logic.
- `lib/gateway-ws.js`: main WS handshake update.
- `lib/usage-rpc.js`: adopt shared auth/connect logic.
- `tests/lib/gateway-ws.test.js`: handshake payload + regressions.
- `tests/lib/usage-rpc.test.js` (if needed): shared helper integration.

## Test Strategy

- Unit:
- `tests/lib/gateway-ws.test.js`
- `tests/lib/usage-rpc.test.js`
- Existing chat handler tests to guard fallback behavior:
- `tests/ws/chat-handlers.test.js`
- Runtime verification:
- local gateway request script for `chat.history` first-pass success.

## Success Criteria

- First chat history load succeeds through gateway in normal conditions.
- Fallback remains only for genuine degradation (disconnect/unavailable/etc.).
- Implementation is minimal, shared, and resistant to future protocol drift.

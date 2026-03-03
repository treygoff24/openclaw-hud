# OpenClaw HUD Cron CRUD + Arbitrary Edit Implementation Plan

**Goal:** Add durable cron job create, delete, and arbitrary edit capabilities to OpenClaw HUD UI/UX while staying consistent with OpenClaw's canonical cron semantics.

**Architecture:** Use gateway-proxy writes as the single-writer path for cron mutations. HUD route handlers remain thin controllers and delegate to a cron service client that calls OpenClaw gateway cron methods. Keep read-only fallback for listing cron jobs when gateway is unavailable.

**Tech Stack:** Node.js + Express (CommonJS), Vanilla JS frontend, Vitest, Playwright.

---

## Grounding Summary

- OpenClaw canonical cron semantics live in `/Users/treygoff/Code/openclaw` (not `/code/openclaw` on this machine).
- Canonical cron write APIs: `cron.add`, `cron.update`, `cron.remove` in `/Users/treygoff/Code/openclaw/src/gateway/server-methods/cron.ts`.
- Canonical validation/normalization: `/Users/treygoff/Code/openclaw/src/gateway/protocol/schema/cron.ts`, `/Users/treygoff/Code/openclaw/src/cron/normalize.ts`, `/Users/treygoff/Code/openclaw/src/cron/service/jobs.ts`.
- Current HUD route implementation in `routes/cron.js` still mutates `~/.openclaw/cron/jobs.json` directly for update/toggle.

## Architecture Decision

### Chosen approach: Gateway-proxy writes with read-only fallback

- HUD mutation endpoints call gateway methods and do not directly mutate cron store files.
- Listing endpoint can fall back to local file reads if gateway list call fails.
- This minimizes semantic drift and preserves canonical OpenClaw behavior.

### Why this approach

- OpenClaw already handles durability, normalization, and edge-case semantics.
- A second validator/writer in HUD would diverge over time.
- Existing HUD route architecture already proxies gateway calls in spawn routes; cron should follow the same pattern.

## API Contract (HUD)

- `GET /api/cron`
  - Primary: proxy to gateway list method.
  - Fallback: local read-only jobs payload with `meta.gatewayAvailable=false`.
- `POST /api/cron`
  - Create job (full payload or normalized form payload).
- `PUT /api/cron/:jobId`
  - Update existing job.
- `DELETE /api/cron/:jobId`
  - Remove job.
- `POST /api/cron/:jobId/toggle`
  - Keep for compatibility; implemented as thin update proxy that flips `enabled`.

### Error mapping

- Validation errors -> `400`
- Not found -> `404`
- Conflict (duplicate ID) -> `409`
- Gateway unavailable / downstream transport failure -> `503`

## OpenClaw Constraints HUD Must Respect

- `sessionTarget` and `payload.kind` coupling:
  - `main` -> `systemEvent`
  - `isolated` -> `agentTurn`
- Main-session job agent restrictions.
- `schedule.at` bounds:
  - Reject >1 minute in past.
  - Reject >10 years in future.
- Delivery URL must be valid `http(s)`.
- Canonical field name is `id`; be tolerant if inputs use `jobId`.

## Task Plan

### Task 1: Add Cron Gateway Service Layer

**Parallel:** no  
**Blocked by:** none  
**Owned files:** `lib/cron-service.js`, `lib/gateway-tool-client.js` (new), `lib/cron-read-fallback.js` (new)

**Files:**
- Create: `lib/gateway-tool-client.js`
- Create: `lib/cron-service.js`
- Create: `lib/cron-read-fallback.js`
- Test: `tests/lib/cron-service.test.js`

**Step 1: Write failing tests for service behavior**
- Gateway success paths for list/create/update/delete/toggle.
- Gateway failure translation to app-level errors.
- Read-only fallback behavior for `list`.

**Step 2: Run targeted tests and confirm failure**
Run: `npx vitest run tests/lib/cron-service.test.js`

**Step 3: Implement minimal service**
- Shared helper to invoke gateway tool methods.
- Cron service wrapper methods with consistent return/error shapes.

**Step 4: Run tests and confirm pass**
Run: `npx vitest run tests/lib/cron-service.test.js`

---

### Task 2: Refactor Cron Routes to Thin Controllers

**Parallel:** no  
**Blocked by:** Task 1  
**Owned files:** `routes/cron.js`

**Files:**
- Modify: `routes/cron.js`
- Test: `tests/routes/cron.test.js`

**Step 1: Add failing route tests for create/delete and gateway-proxy behavior**
- Ensure mutation paths no longer depend on direct file writes.
- Assert route-level status code mapping.

**Step 2: Run route test slice and confirm failure**
Run: `npx vitest run tests/routes/cron.test.js`

**Step 3: Implement route handlers**
- Wire route handlers to `cron-service` methods.
- Keep `requireLocalOrigin` on mutating endpoints.
- Preserve existing response envelope format where possible.

**Step 4: Re-run route tests**
Run: `npx vitest run tests/routes/cron.test.js`

---

### Task 3: Expand Route Test Matrix for Constraints and Failure Modes

**Parallel:** yes  
**Blocked by:** Task 2  
**Owned files:** `tests/routes/cron.test.js`

**Files:**
- Modify: `tests/routes/cron.test.js`

**Step 1: Add P0 integration cases**
- `POST /api/cron` success.
- `DELETE /api/cron/:jobId` success, not found, invalid id.
- Origin guard denies non-local mutation attempts.

**Step 2: Add constraint/error cases**
- Invalid `sessionTarget/payload.kind` combination.
- Main-session restricted agent.
- Invalid `schedule.at` (past/far future/invalid date).
- Invalid delivery URL.
- Duplicate id conflict -> `409`.

**Step 3: Execute test file**
Run: `npx vitest run tests/routes/cron.test.js`

---

### Task 4: Implement Frontend Cron CRUD UX + Arbitrary Edit Mode

**Parallel:** yes  
**Blocked by:** Task 2  
**Owned files:** `public/panels/cron.js`, `public/index.html`, `public/styles/cron.css`, optional `public/app/cron-api.js`

**Files:**
- Modify: `public/panels/cron.js`
- Modify: `public/index.html`
- Modify: `public/styles/cron.css`
- Create (optional): `public/app/cron-api.js`
- Test: `tests/public/panels/cron.test.js`

**Step 1: Add failing frontend unit tests**
- Create mode defaults/reset.
- Delete action flow.
- Form-to-payload serialization correctness.
- Advanced JSON mode parse/validation messaging.

**Step 2: Run panel tests and confirm failure**
Run: `npx vitest run tests/public/panels/cron.test.js`

**Step 3: Implement UI changes**
- Add Create CTA.
- Add Delete button in modal.
- Add explicit modal modes: `create`, `edit`, `advanced`.
- Add read-only mutation state when gateway unavailable.
- Keep list refresh behavior consistent.

**Step 4: Re-run panel tests**
Run: `npx vitest run tests/public/panels/cron.test.js`

---

### Task 5: Add/Update E2E Cron CRUD Coverage

**Parallel:** no  
**Blocked by:** Tasks 3, 4  
**Owned files:** `e2e/modals.spec.js` or `e2e/cron-crud.spec.js`

**Files:**
- Modify: `e2e/modals.spec.js`
- or Create: `e2e/cron-crud.spec.js`

**Step 1: Add CRUD happy-path flow**
- Create isolated one-shot cron.
- Edit same cron and switch target to main.
- Delete the cron.

**Step 2: Add one negative case**
- Invalid `schedule.at` or invalid delivery URL with blocked submit/error display.

**Step 3: Run E2E target spec**
Run: `npx playwright test e2e/cron-crud.spec.js`

---

### Task 6: Documentation and Spec Alignment

**Parallel:** yes  
**Blocked by:** Task 2  
**Owned files:** `CLAUDE.md`, `SPEC.md`, optional `README.md`

**Files:**
- Modify: `CLAUDE.md`
- Modify: `SPEC.md`
- Modify (optional): `README.md`

**Step 1: Remove stale read-only cron wording**

**Step 2: Document new CRUD API and degraded read-only fallback behavior**

**Step 3: Quick doc consistency pass**
Run: `rg -n \"read-only|cron\" CLAUDE.md SPEC.md README.md`

---

### Task 7: Integration Gate

**Parallel:** no  
**Blocked by:** Tasks 3, 4, 5, 6  
**Owned files:** none

**Step 1: Run focused test slices**
Run: `npx vitest run tests/routes/cron.test.js tests/public/panels/cron.test.js`

**Step 2: Run cron E2E spec**
Run: `npx playwright test e2e/cron-crud.spec.js`

**Step 3: Run full unit suite**
Run: `npm test`

**Step 4: Run full E2E suite**
Run: `npm run test:e2e`

## Acceptance Criteria

- HUD supports create, update, delete, and arbitrary edit of cron jobs.
- Mutation writes are durable through OpenClaw canonical cron persistence path.
- HUD no longer performs direct cron file mutations in route handlers for write operations.
- Gateway-unavailable state degrades to read-only list mode with clear UI state.
- Test coverage includes backend route/integration, frontend unit behavior, and E2E CRUD flow.

## Parallel Work Safety

- Task 3 and Task 4 can run in parallel (owned files do not overlap).
- Task 6 can run in parallel with Tasks 3/4 after Task 2.
- Avoid overlapping edits to `routes/cron.js` outside Task 2.

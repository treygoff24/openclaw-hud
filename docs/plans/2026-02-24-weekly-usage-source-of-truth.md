# Weekly Usage Source-of-Truth + Sunday Archive Implementation Plan

> **For Claude:** Spawn `task-builder` agent to implement this plan task-by-task.

**Goal:** Replace HUD’s ad-hoc model usage aggregation with canonical OpenClaw weekly usage data (Sun–Sat, inclusive), show all models with >0 weekly usage, and archive immutable weekly snapshots every Sunday.

**Architecture:** HUD stops scraping local JSONL session files for the model pane. Instead, backend calls OpenClaw `sessions.usage` with explicit weekly boundaries and timezone, derives model rows from canonical aggregates, and exposes a weekly API contract (`meta + models + totals + archive`). A Sunday cron-triggered snapshot job persists weekly rollups for longitudinal tracking.

**Tech Stack:** Node/Express (openclaw-hud), OpenClaw gateway JSON-RPC (`sessions.usage`), Cron scheduler (`cron` jobs), Vitest/Playwright.

---

## Scope and acceptance criteria

- Weekly window is **Sunday 00:00:00.000 → Saturday 23:59:59.999** in configured timezone.
- Model list includes **every model with >0 weekly usage** (token-based).
- Model/token/cost data comes from **OpenClaw canonical usage pipeline** (`sessions.usage`) rather than HUD filesystem scraping.
- Weekly data **resets each Sunday** by design of requested week window.
- Weekly snapshot is **saved/archived every Sunday** and retrievable for history.
- No hardcoded “phantom” model rows in usage pane.

---

### Task 1: Add weekly window utilities and config

**Parallel:** no  
**Blocked by:** none  
**Owned files:** `server.js`, `lib/helpers.js`, `README.md`

**Files:**
- Modify: `server.js`
- Modify: `lib/helpers.js`
- Modify: `README.md`

**Step 1: Add timezone and weekly settings env surface**
- Add config constants for:
  - `HUD_USAGE_TZ` (default `America/Chicago`)
  - `HUD_WEEK_START_DAY` (fixed Sunday; keep constant)
  - `HUD_ARCHIVE_DIR` default under `~/.openclaw/cron/usage-archive/weekly`

**Step 2: Add reusable week boundary helpers**
- In `lib/helpers.js`, add helpers to compute:
  - current week Sunday start
  - corresponding Saturday end
  - optional week selection by `weekStart=YYYY-MM-DD`
- Return both date strings and epoch bounds for diagnostics.

**Step 3: Add tests for boundary calculations**
- Add/extend helper tests for:
  - exact Sunday start inclusion
  - exact Saturday end inclusion
  - DST-transition week behavior in configured TZ

**Step 4: Validate**
- Run unit tests for helper module.

**Step 5: Commit**
- `feat: add weekly window helper/config for usage reporting`

---

### Task 2: Build canonical weekly usage backend endpoint (OpenClaw-driven)

**Parallel:** no  
**Blocked by:** Task 1  
**Owned files:** `routes/config.js`, `lib/openclaw-client.js`, `tests/routes/model-usage-weekly.test.js`

**Files:**
- Create: `lib/openclaw-client.js`
- Modify: `routes/config.js`
- Create: `tests/routes/model-usage-weekly.test.js`

**Step 1: Add OpenClaw RPC client wrapper**
- Implement a minimal server-side helper for gateway calls used by HUD:
  - method: `sessions.usage`
  - params: `startDate`, `endDate`, `mode: "gateway"`, `limit`
- Include error handling + timeout.

**Step 2: Add `GET /api/model-usage/weekly`**
- New endpoint contract:
  - Query: `weekStart?`, `tz?`
  - Response:
    - `meta` `{ period, weekStart, weekEnd, tz, generatedAt, source: "sessions.usage" }`
    - `models[]` rows from canonical aggregates
    - `totals`
    - `archive` info for this week if exists

**Step 3: Derive models list from canonical aggregates**
- Map `sessions.usage.aggregates.byModel` to response rows.
- Filter condition: `totalTokens > 0`.
- Include full token fields + `totalCost` + provider/model identifiers.

**Step 4: Preserve backward compatibility temporarily**
- Keep existing `/api/model-usage` route for one migration cycle but mark deprecated in response `meta`.

**Step 5: Add tests**
- Integration tests with mocked OpenClaw response:
  - includes all >0 models
  - excludes zero-usage rows
  - uses correct Sunday/Saturday boundaries
  - returns `meta.source = sessions.usage`

**Step 6: Commit**
- `feat: add canonical weekly model usage endpoint backed by sessions.usage`

---

### Task 3: Remove hardcoded/hot-window usage path from UI flow

**Parallel:** yes  
**Blocked by:** Task 2  
**Owned files:** `public/app.js`, `public/panels/models.js`, `public/index.html`

**Files:**
- Modify: `public/app.js`
- Modify: `public/panels/models.js`
- Modify: `public/index.html`

**Step 1: Switch frontend fetch to weekly endpoint**
- Replace usage call path from `/api/model-usage` to `/api/model-usage/weekly`.
- Pass optional `weekStart` and `tz` if controls are present.

**Step 2: Update renderer for new shape**
- Render `models[]` rather than object map.
- Display weekly range from `meta.weekStart`–`meta.weekEnd`.
- Show token columns that include both cache read + cache write.

**Step 3: Add weekly context label in UI**
- Add explicit text like: `Week of YYYY-MM-DD (Sun–Sat, TZ)`.

**Step 4: Add UI tests**
- Ensure all >0 weekly models render.
- Ensure no hardcoded model stubs are injected into usage panel.

**Step 5: Commit**
- `feat: migrate model usage pane to weekly canonical endpoint`

---

### Task 4: Remove misleading hardcoded model entries and unify config source path

**Parallel:** yes  
**Blocked by:** Task 2  
**Owned files:** `routes/config.js`, `tests/routes/config-models.test.js`

**Files:**
- Modify: `routes/config.js`
- Create/Modify: `tests/routes/config-models.test.js`

**Step 1: Remove unconditional alias injection in `/api/models`**
- Delete hardcoded additions that fabricate model options unrelated to actual config/state.

**Step 2: Unify config loading strategy**
- Make `/api/models` use same primary/fallback loading policy as `/api/config`.

**Step 3: Add regression tests**
- Verify models list reflects real config only.
- Verify no phantom `haiku` / `vulcan (codex)` insertion unless explicitly configured.

**Step 4: Commit**
- `fix: remove hardcoded model aliases and unify models config source`

---

### Task 5: Implement Sunday weekly archive writer

**Parallel:** no  
**Blocked by:** Task 2  
**Owned files:** `lib/usage-archive.js`, `routes/config.js`, `tests/lib/usage-archive.test.js`

**Files:**
- Create: `lib/usage-archive.js`
- Modify: `routes/config.js`
- Create: `tests/lib/usage-archive.test.js`

**Step 1: Define archive record format**
- JSON schema:
  - `weekKey`, `weekStart`, `weekEnd`, `tz`, `generatedAt`
  - `totals`
  - `models[]`
  - `sourceMeta` (gateway method + params)

**Step 2: Add write/read helpers**
- Write immutable snapshot to:
  - `${HUD_ARCHIVE_DIR}/${YYYY}/${weekStart}.json`
- Add `readWeeklySnapshot(weekStart, tz)` helper.

**Step 3: Add endpoint accessor**
- Add `GET /api/model-usage/archive?weekStart=...` for historical retrieval.

**Step 4: Add tests**
- write/read round-trip
- idempotency behavior (no accidental overwrite)
- path hygiene

**Step 5: Commit**
- `feat: add weekly usage archive persistence and retrieval`

---

### Task 6: Schedule Sunday archive job (cron)

**Parallel:** no  
**Blocked by:** Task 5  
**Owned files:** `docs/ops/weekly-usage-archive.md`, `scripts/setup-weekly-archive-cron.sh`

**Files:**
- Create: `scripts/setup-weekly-archive-cron.sh`
- Create: `docs/ops/weekly-usage-archive.md`

**Step 1: Define cron job payload**
- Schedule: Sunday in desired TZ (e.g., 00:05 local).
- Job action triggers internal request to snapshot previous/completed week.

**Step 2: Add setup script and docs**
- Script should install/update cron via OpenClaw cron API/CLI.
- Document job id, schedule, rerun procedure, and failure recovery.

**Step 3: Add observability hooks**
- Log success/failure with week key, model count, total tokens/cost.

**Step 4: Commit**
- `chore: add sunday weekly usage archive cron setup and runbook`

---

### Task 7: End-to-end validation + rollout

**Parallel:** no  
**Blocked by:** Tasks 3, 4, 5, 6  
**Owned files:** `e2e/dashboard-weekly-usage.spec.js`, `docs/plans/rollout-weekly-usage.md`

**Files:**
- Create/Modify: `e2e/dashboard-weekly-usage.spec.js`
- Create: `docs/plans/rollout-weekly-usage.md`

**Step 1: Add E2E scenarios**
- Weekly range visible and correct.
- Full model inclusion (>0 usage).
- Costs/tokens match canonical backend payload.

**Step 2: Add rollout checklist**
- Deploy backend endpoint
- migrate frontend fetch
- keep legacy endpoint one release
- remove legacy endpoint after verification

**Step 3: Manual validation checklist**
- Compare HUD weekly totals with direct `sessions.usage` call for same week.
- Verify archive file created on Sunday and retrievable in UI/API.

**Step 4: Commit**
- `test: add e2e and rollout checklist for weekly usage source-of-truth migration`

---

## Test command matrix

- Unit/integration:
  - `npm test -- tests/routes/model-usage-weekly.test.js`
  - `npm test -- tests/routes/config-models.test.js`
  - `npm test -- tests/lib/usage-archive.test.js`
  - `npm test -- tests/public/panels/models.test.js`
- E2E:
  - `npm run test:e2e -- e2e/dashboard-weekly-usage.spec.js`

---

## Risks and mitigations

- **Risk:** Week boundary drift due to timezone handling.  
  **Mitigation:** centralize boundary helper + test DST edge weeks.

- **Risk:** Perceived jump in totals after removing 10-file sampling.  
  **Mitigation:** add UI note for first release (“now sourced from full canonical weekly usage”).

- **Risk:** Gateway query latency for large windows.  
  **Mitigation:** one-week window only + optional short-lived server cache keyed by week/tz.

- **Risk:** Historical snapshots overwritten accidentally.  
  **Mitigation:** immutable write semantics + explicit overwrite flag only for admin repair.

---

## Definition of done

- HUD model usage pane shows weekly Sun–Sat data from canonical OpenClaw usage source.
- Every model with >0 weekly usage appears.
- Costs align with canonical usage computation behavior.
- Week changes naturally every Sunday.
- Weekly snapshots are archived every Sunday and queryable for historical analysis.

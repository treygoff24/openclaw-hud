# UI QoL Plan (Living Doc)

## Scope: Session Label Readability
Goal: Replace hard-to-scan session slugs in the Session Tree and active session list with compact, human-readable labels that prioritize:
- Session type (`Main` vs `Subagent`)
- Model (alias/name)
- Subagent name/alias

Keep full session slug/key available for tooltips, data attributes, and debugging.

## Scope: Chat Pane Sender Label Readability
Goal: In chat message headers, replace raw session-label strings (for example `AGENT:...:CHANNEL:...`) with:
- `Ren` when the active session is a main-agent session
- Subagent alias when the active session is a subagent session

Keep canonical session key in machine-facing state/attributes for routing and diagnostics.

## Current State (Mapped)
- Session tree label text is currently set in `public/panels/session-tree.js` (`label || key`).
- Active/recent session rows are currently rendered in `public/panels/sessions.js` (`label || sessionKey || short sessionId`).
- Agent panel summary is rendered in `public/panels/agents.js` (counts/status, not rich per-session metadata).
- Backend APIs (`/api/sessions`, `/api/session-tree`, `/api/agents`) expose session identity/status/spawn depth, but do not currently provide a normalized display-label payload with model + role + alias.

## Current State (Mapped): Chat Pane
- Chat header text is rendered in `public/chat-message.js` from `window.ChatState.currentSession.label` (fallbacks: `agentId`, then `assistant`).
- That `label` is passed from session list/tree click handlers into `openChatPane(...)` and persisted in `window.ChatState.currentSession`.
- Current label source for many sessions is raw `sessions.json` label content returned by `/api/sessions`, which can include long channel-style strings.
- Role metadata (`spawnDepth`, `spawnedBy`) is available via `/api/sessions` and stored on `window._allSessions`, but `openChatPane` currently stores only `agentId`, `sessionId`, `label`, and `sessionKey`.

## Implementation Plan
1. Define a normalized display-label shape
- Add a shared object contract for session display metadata, e.g.:
  - `sessionRole`: `main | subagent`
  - `sessionAlias`: best human name for the session/subagent
  - `modelLabel`: preferred model alias/name
  - `fullSlug`: canonical session key for fallback/debug
- Keep existing API fields unchanged for backward compatibility.

2. Add backend enrichment for display metadata
- Target files:
  - `routes/sessions.js`
  - `routes/agents.js`
  - (optional shared helper) `lib/helpers.js`
- Enrichment logic (priority order):
  - Role: derive from `spawnDepth`/`spawnedBy`
  - Alias: prefer explicit session label, then safe fallback
  - Model: prefer explicit session model field if present; otherwise map from available channel/model metadata
- Emit new fields in both `/api/sessions` and `/api/session-tree` responses.

3. Create one frontend formatter used in both panels
- Target files:
  - `public/panels/session-tree.js`
  - `public/panels/sessions.js`
  - (optional shared module) `public/session-labels.js`
- Build label UI with consistent ordering:
  - `[Main|Subagent] [Model] [Alias]`
- Keep `title`/`aria-label` rich with full context and full slug.

4. Update styling for readability
- Target files:
  - `public/styles/session-tree.css`
  - `public/styles/sessions.css`
- Add compact visual tokens (role/model) plus primary alias text.
- Maintain existing density and mobile layout behavior.

5. Add/expand tests (required)
- Frontend tests:
  - `tests/public/panels/session-tree.test.js`
  - `tests/public/panels/sessions.test.js`
  - `tests/public/panels/agents.test.js` (only if active-session labeling behavior changes there)
- Backend tests:
  - `tests/routes/sessions.test.js`
  - `tests/routes/agents.test.js`
- Assertions to add:
  - Role derivation (`main` vs `subagent`)
  - Model label fallback behavior
  - Alias fallback behavior when labels are missing
  - Full slug still preserved in machine-facing attributes

6. Verification checklist
- Run targeted unit tests for touched suites first.
- Run full `npm test` before calling done.
- Manual UI pass:
  - Session tree readability
  - Active session list readability
  - No regressions in click-to-open chat/session linking

## Implementation Plan: Chat Pane Sender Labels
1. Introduce a shared chat sender display resolver
- Target files:
  - `public/chat-message.js`
  - `public/chat-pane.js`
  - (optional shared helper) `public/chat-session-labels.js`
- Add a pure resolver that takes current session metadata and returns:
  - `displayName` (what the header shows)
  - `role` (`main` or `subagent`) for future styling hooks

2. Ensure chat state has role/alias metadata at open time
- Extend `openChatPane(...)` state creation to attach session metadata for the active key (via `window._allSessions` lookup):
  - `spawnDepth`, `spawnedBy`
  - normalized alias candidate
- Keep state backward-compatible if metadata is missing.

3. Apply naming rules
- Main session (`spawnDepth === 0` and/or no `spawnedBy`) -> header label is exactly `Ren`.
- Subagent session (`spawnDepth > 0` or `spawnedBy` present) -> header label uses normalized subagent alias.
- Alias fallback order for subagents:
  - cleaned human label if available
  - alias segment from canonical key/session id
  - existing safe fallback (`agentId` or `assistant`)

4. Add optional normalization guard for noisy labels
- Add a small sanitizer to avoid surfacing channel-like all-caps labels in header display.
- Do not mutate underlying persisted labels; normalization is display-only.

5. Tests (required)
- Update/add frontend tests:
  - `tests/public/chat-message.test.js`
  - `tests/public/panels/sessions.test.js` (if `openChatPane` args/state shape change)
  - `tests/public/panels/session-tree.test.js` (if `openChatPane` args/state shape change)
- Assertions:
  - main session header renders `Ren`
  - subagent header renders alias
  - missing metadata falls back safely
  - routing still uses canonical `sessionKey` unchanged

6. Verification checklist (chat pane)
- Open a main-agent session and verify header shows `Ren`.
- Open a subagent session and verify header shows alias, not raw channel-style slug.
- Send/receive messages in both paths; confirm no subscription/routing regressions.

## Acceptance Criteria
- Session tree and active session list no longer rely on raw full slugs as primary visible labels.
- Each visible label clearly communicates role + model + alias in a consistent format.
- Full session slug remains available for hover/a11y/debug paths.
- Existing behavior is preserved when metadata is missing (graceful fallback).

## Acceptance Criteria: Chat Pane
- Chat message headers no longer display raw channel-style session labels as the primary sender identity.
- Main-agent chats display `Ren`.
- Subagent chats display a readable alias.
- Message routing/subscriptions remain strictly keyed by canonical `sessionKey`.

## Open Questions To Resolve Before Implementation
- Exact model source of truth per session when not explicitly stored on session records.
- Final text format preference:
  - Example A: `Subagent · GPT-5 · research-planner`
  - Example B: `[S] GPT-5 — research-planner`
- Whether to surface this format in Agents panel cards beyond counts/status.
- Whether `Ren` should be hardcoded or read from a configurable display-name source (future-proofing).

## Parallelization + Dependencies
Use these IDs when dispatching subagents.

### Workstream A: Session Tree + Active Session Labels
- `A1` Define display-label contract (role/model/alias/fullSlug)
  - Depends on: none
  - Parallelizable: yes
- `A2` Backend enrichment in `routes/sessions.js` + `routes/agents.js` (+ helper if needed)
  - Depends on: `A1`
  - Parallelizable: yes (can run in parallel with `B2`, `B4`)
- `A3` Frontend formatter wiring in `public/panels/session-tree.js` + `public/panels/sessions.js`
  - Depends on: `A1` (and ideally `A2` shape)
  - Parallelizable: partial (can scaffold before `A2`, finalize after)
- `A4` Styling updates for readability (`public/styles/session-tree.css`, `public/styles/sessions.css`)
  - Depends on: `A3` markup decisions
  - Parallelizable: yes once markup is stable
- `A5` Backend tests (`tests/routes/sessions.test.js`, `tests/routes/agents.test.js`)
  - Depends on: `A2`
  - Parallelizable: yes
- `A6` Frontend tests (`tests/public/panels/session-tree.test.js`, `tests/public/panels/sessions.test.js`, optional agents panel test)
  - Depends on: `A3` (and `A4` only if classnames/structure change)
  - Parallelizable: yes

### Workstream B: Chat Pane Sender Labels (`Ren` vs subagent alias)
- `B1` Define sender-display resolver contract and fallback rules
  - Depends on: none
  - Parallelizable: yes
- `B2` Chat state enrichment in `public/chat-pane.js` (attach role metadata from session meta lookup)
  - Depends on: `B1`
  - Parallelizable: yes (can run parallel with `A2`)
- `B3` Apply resolver in `public/chat-message.js` rendering paths
  - Depends on: `B1`, `B2`
  - Parallelizable: limited (implementation can start early; final wiring needs `B2`)
- `B4` Optional display-only sanitizer/helper module for noisy labels
  - Depends on: `B1`
  - Parallelizable: yes
- `B5` Chat tests (`tests/public/chat-message.test.js`; panel tests only if openChatPane payload changes)
  - Depends on: `B2`, `B3` (and `B4` if used)
  - Parallelizable: yes

### Global Coordination Tasks
- `G1` Decide unresolved product choices (model source-of-truth, exact label format, hardcoded vs configurable `Ren`)
  - Depends on: none
  - Blocks: `A1`, `B1` finalization
- `G2` Integration sanity pass (click/open chat, routing, a11y title/labels)
  - Depends on: `A3`, `A4`, `B3`
  - Parallelizable: no (integration checkpoint)
- `G3` Final verification run (`npm test`, targeted reruns as needed)
  - Depends on: `A5`, `A6`, `B5`, `G2`
  - Parallelizable: no (final gate)

## Suggested Parallel Lanes (Subagent Dispatch)
- Lane 1 (Backend): `A2` + `A5`
- Lane 2 (Session UI): `A3` + `A4` + `A6`
- Lane 3 (Chat UI): `B2` + `B3` + `B5`
- Lane 4 (Optional helper): `B4`
- Coordinator lane: `G1` decisions first, then `G2` and `G3`

## Critical Path
`G1 -> A1/B1 -> A2/B2 -> A3/B3 -> A6/B5 -> G2 -> G3`

## Session Log
- 2026-02-24: Initial plan created from codebase mapping; no implementation yet.
- 2026-02-24: Added scoped plan for chat-pane sender labels (`Ren` for main sessions, alias for subagents), including frontend state/renderer/test touchpoints.

# Null-Safe Panel Rendering — Reconnaissance Results

**Date:** 2026-03-03  
**Status:** Recon complete, ready for implementation  
**Parent plan:** `2026-03-03-hud-gateway-hardening-compat.md` (Phase 3C context)

## Root Cause (Sonnet)

`data.js` passes `null` to panel `render()` on fetch failure. `shouldRenderEndpointPayload` returns `true` for null, so all four panels are called with null and crash before `renderPanelSafe` can suppress the error.

**No changes to `data.js`** — the null-passthrough is intentional design. Fix at the panel level.

## Files to Patch (4 panels)

| Panel        | File                            | Guard                                                               |
| ------------ | ------------------------------- | ------------------------------------------------------------------- |
| agents       | `public/panels/agents.js`       | `buildAgentsHTML` + `render`: `Array.isArray(agents) ? agents : []` |
| sessions     | `public/panels/sessions.js`     | `render`: guard `sessions`                                          |
| session-tree | `public/panels/session-tree.js` | `render` + `buildTreeHTML`: guard `sessions`                        |
| activity     | `public/panels/activity.js`     | `render`: guard `events`                                            |

Pattern: early guard clause `if (!data || !Array.isArray(data)) data = []` or equivalent, plus fallback UI showing "0" counts and empty containers.

## Test Plan (Minimax — 16 new tests)

4 tests per panel × 4 panels:

- `render(null)` → no throw, count element shows "0", no cards
- `render(undefined)` → same
- `render("not-an-array")` → same
- `render({})` → same

**New test file:** `tests/public/fetch-resilience.test.js` (or per-panel files like `agents.test.js`)

No existing tests need modification — they cover valid empty `[]` and item-level validation, not input-level null handling.

## Docs Update (Haiku)

Add to `CLAUDE.md` under "Frontend (Vanilla JS, zero deps)" after the `public/panels/` bullet:

> **Null-safe panel rendering hardening:** All panel `render(data)` methods must validate input data existence before DOM access. Use guard clauses (e.g., `if (!data || !data.length) return`) at render entry, defensive property access (optional chaining where safe), and explicit fallback UI for unavailable/null data states.

## Implementation Notes

- Simple, mechanical fix — each panel gets ~3 lines of guard code
- Tests are straightforward assertion specs
- No architectural changes needed
- Can be done in a single branch + PR

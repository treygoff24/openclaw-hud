# Phase C Implementation Spec — Rich Chat Rendering (Final)

**Date:** 2026-02-22  
**Status:** Core implementation complete; final hardening/spec alignment in progress  
**Commit Baseline:** f891eef

---

## 1. Executive Summary

Phase C delivers rich message rendering for the OpenClaw HUD chat interface. Core features (markdown, tool blocks, thinking blocks) are implemented. This spec defines the remaining implementation-ready hardening work, ordered for sign-off.

---

## 2. Core Implementation (✅ Complete)

| Feature | File(s) | Status |
|---------|---------|--------|
| Markdown rendering (GFM + breaks) | `chat-markdown.js` | ✅ |
| HTML sanitization (DOMPurify) | `chat-markdown.js` | ✅ |
| Tool use/result blocks | `chat-tool-blocks.js` | ✅ |
| Tool grouping (3+ calls) | `chat-tool-blocks.js` | ✅ |
| Thinking blocks | `chat-tool-blocks.js` | ✅ |
| System message styling | `chat-message.js`, CSS | ✅ |
| Marked v15 token API | `chat-markdown.js` | ✅ |
| Vulcan code review fixes | All files | ✅ |

**Architecture:**
```
chat-pane.js → chat-ws-handler.js → chat-message.js → [chat-markdown.js | chat-tool-blocks.js]
```

**CDN Dependencies (public/index.html):**
- marked@15.0.7 (SRI hash configured)
- dompurify@3.2.4 (SRI hash configured)

---

## 3. Hardening: Priority Buckets

### P0 — Must Ship for Phase C Sign-Off

These block Phase C completion.

| # | Item | Files | Fix | Verification |
|---|------|-------|-----|--------------|
| 1 | **Test-runner isolation (Vitest vs Playwright)** | `vitest.config.js`<br>`playwright.config.js`<br>`package.json`<br>`tests/**`<br>`e2e/**` | Remove runner overlap so unit and e2e suites are independently discoverable/executable:<br>- Set explicit Vitest `include` to unit paths only (e.g., `tests/**/*.test.js`) and `exclude` e2e paths.<br>- Set explicit Playwright `testDir: 'e2e'` + `testMatch` and keep it isolated from `tests/`.<br>- Confirm scripts remain independent: `npm test` (Vitest only), `npm run test:e2e` (Playwright only). | Run both commands separately and confirm no cross-runner suite loading and no unhandled worker/process errors. |
| 2 | **App test global dependency fix (`openChatPane`)** | `tests/public/app.test.js`<br>`public/app.js` (reference only) | Resolve missing global at test time via one concrete path:<br>- **Preferred:** import chat modules that initialize `window.openChatPane` before importing `app.js`.<br>- **Fallback:** explicit deterministic mock/stub for `window.openChatPane` in test setup when import ordering is insufficient.<br>Keep setup explicit and local to test bootstrap. | `npm test` passes with `tests/public/app.test.js` loaded directly; no `openChatPane is not defined` (or equivalent reference) errors. |
| 3 | **Phase C E2E + security coverage expansion** | `e2e/chat-rich-content.spec.js` | Add/complete e2e coverage for rich rendering and sanitization:<br>- Markdown renders (headers, lists, links), code blocks styled, tool blocks and grouping behavior, thinking blocks.
- XSS/sanitization matrix includes: `javascript:`, `data:`, `vbscript:` link schemes; inline handlers (`onclick`, `onerror`); raw HTML; nested HTML payload attempts.
- Anchor assertions verify safe output (`href` sanitized/removed as expected, `rel="noopener noreferrer"` when `target="_blank"`). | `npm run test:e2e` passes; no unhandled page errors during suite; security assertions pass for all payload classes. |

### P1 — Near-Term Hardening (Next 1–2 Weeks)

Complete these immediately after P0 sign-off.

| # | Item | Files | Approach | Effort |
|---|------|-------|----------|--------|
| 4 | **Local fallback for CDN dependencies (move earlier)** | `public/index.html`<br>`public/vendor/**` or build config | Implement concrete mitigation now (not deferred):<br>- Add local fallback path (or bundle marked/DOMPurify into app assets) used when CDN load fails.<br>- Keep SRI on CDN path; fallback must be deterministic and tested. | 2-4h |
| 5 | **A11y state + keyboard interaction coverage** | `public/chat-tool-blocks.js`<br>`tests/public/chat-tool-blocks.test.js`<br>`e2e/chat-rich-content.spec.js` | Ensure interactive headers support keyboard and ARIA state transitions:<br>- `role="button"`, `tabindex="0"`, `aria-expanded` state updates on toggle.
- Enter/Space activation tests (unit + e2e). | 2-3h |
| 6 | **Progressive expansion for large tool results** | `public/chat-tool-blocks.js` | Avoid full synchronous render for very large content:
- Render truncated preview first (e.g., first 50KB) with explicit “Show more/Show all”.
- Expand progressively after user action without blocking UI thread. | 2-4h |

### P2 — Nice-to-Have / Phase D Candidates

Defer until after P0/P1 complete, or fold into Phase D.

| # | Item | Files | Notes | Effort |
|---|------|-------|-------|--------|
| 7 | **Copy-to-clipboard** | `public/chat-markdown.js`<br>`public/chat-pane.css` | Add copy button on code block hover | 2h |
| 8 | **Performance profiling** | All chat files | Profile large conversation (100+ messages), capture hotspots before further UI enhancements | 2-4h |
| 9 | **Cross-browser testing** | E2E suite | Validate Chrome/Firefox/Safari | 2h |

---

## 4. Execution Order & Effort

**Phase C Completion Path:**

```
P0.1 → P0.2 → P0.3 → Sign-off → P1.4 → P1.5 → P1.6 → Hardened baseline → P2 items → Phase D
```

| Item | Priority | Effort | Cumulative |
|------|----------|--------|------------|
| Test-runner isolation | P0 | 1-2h | 1-2h |
| `openChatPane` app test fix | P0 | 30-60m | 1.5-3h |
| Phase C e2e + security matrix | P0 | 2-3h | 3.5-6h |
| **Phase C Sign-off** |  |  | **~4-6h** |
| Local CDN fallback/bundling path | P1 | 2-4h | 5.5-10h |
| A11y ARIA + keyboard coverage | P1 | 2-3h | 7.5-13h |
| Progressive large-result expansion | P1 | 2-4h | 9.5-17h |
| Copy-to-clipboard | P2 | 2h | 11.5-19h |
| Performance profiling | P2 | 2-4h | 13.5-23h |

---

## 5. Acceptance Criteria

### Phase C Sign-Off (P0 Complete)
- [ ] `npm test` executes Vitest unit suites only (no e2e files loaded)
- [ ] `npm run test:e2e` executes Playwright e2e suites only (no unit suites loaded)
- [ ] No unhandled errors/exceptions in either runner (worker/process/page)
- [ ] `tests/public/app.test.js` confirms `openChatPane` dependency is resolved via import ordering or explicit mock strategy
- [ ] Rich content e2e spec passes (markdown/tool/thinking coverage)
- [ ] Security matrix passes for `javascript:`, `data:`, `vbscript:`, inline handlers, and raw/nested HTML payloads

### Hardened Baseline (P1 Complete)
- [ ] CDN failure path verified: local fallback/bundled assets load successfully
- [ ] Tool blocks are keyboard accessible (Tab + Enter/Space)
- [ ] ARIA state (`aria-expanded`) toggles correctly and is tested
- [ ] Large tool results expand progressively without freezing UI

---

## 6. Verification Sequence (CI/Local)

### Local Commands
```bash
npm test
npm run test:e2e
```

### CI Gate Order
1. Run unit runner gate (`npm test`) and fail if any e2e files are discovered.
2. Run e2e runner gate (`npm run test:e2e`) and fail if any unit files are discovered.
3. Fail on any unhandled errors in either run.
4. Require green on `chat-rich-content` security/a11y assertions before Phase C sign-off.

---

## 7. Quick Reference

### File Inventory
| File | Purpose | Test File |
|------|---------|-----------|
| `public/chat-markdown.js` | Markdown + sanitization | `tests/public/chat-markdown.test.js` |
| `public/chat-tool-blocks.js` | Tool/result/thinking blocks | `tests/public/chat-tool-blocks.test.js` |
| `public/chat-message.js` | Message assembly | `tests/public/chat-message.test.js` |
| `public/chat-pane.css` | Chat styling | E2E + visual checks |
| `e2e/chat-rich-content.spec.js` | Rich rendering + security/a11y e2e | Playwright |

### DOMPurify Config
```javascript
{
  ALLOWED_TAGS: ['p','br','strong','em','a','ul','ol','li','h1','h2','h3','h4','h5','h6',
    'pre','code','blockquote','table','thead','tbody','tr','th','td','hr','del','sup','sub'],
  ALLOWED_ATTR: ['href','target','rel'],
  ALLOW_DATA_ATTR: false
}
```

### Tool Icon Mapping
```javascript
{
  browser: '🌐',
  Read: '📁', Write: '📁', read: '📁', write: '📁',
  exec: '⚡',
  web_search: '🔍', web_fetch: '🔍',
  image: '🖼️'
}
// Default: 🔧
```

---

## 8. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Cross-runner test contamination | Medium | High | P0 runner isolation + CI gating sequence |
| XSS bypass regression | Low | Critical | Expanded payload matrix + sanitized anchor assertions |
| CDN outage/degradation | Low | High | P1 local fallback/bundled dependency path |
| Large message UI jank | Medium | Medium | P1 progressive expansion strategy |
| Accessibility regressions | Medium | Medium | P1 ARIA/keyboard tests in unit + e2e |

---

**End of Spec**

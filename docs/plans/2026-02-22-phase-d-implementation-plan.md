# Phase D Implementation Plan — Stability & Polish

**Date:** 2026-02-22  
**Status:** Ready for execution  
**Baseline:** Phase C complete (commit f891eef)  

---

## 1. Executive Summary

Phase D takes openclaw-hud from "feature complete" to "stable and polished." Five parallel tracks address reliability, UX power-ups, performance with large data, resilience/fallbacks, and accessibility. Each track is decomposed into bite-sized, independently executable tasks with clear TDD flow and acceptance criteria.

**Goal:** HUD is robust for daily personal use — fast, resilient, accessible, and maintainable.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (Vanilla JS, CDN deps: marked@15, DOMPurify@3)   │
│  ├── Chat Rendering Layer (markdown, tool blocks, a11y)    │
│  ├── State Management (ChatState, WS queue, localStorage)    │
│  └── HUD Panels (agents, sessions, cron, activity, tree)     │
├─────────────────────────────────────────────────────────────┤
│  WebSocket Gateway (real-time push, subscription mgmt)      │
├─────────────────────────────────────────────────────────────┤
│  Node.js + Express (routes: agents, sessions, cron, spawn)  │
└─────────────────────────────────────────────────────────────┘
```

**Tech Stack:**
- **Frontend:** Vanilla JS (ES modules via script tags), CSS custom properties, WebSocket
- **Backend:** Node.js 18+, Express 4, ws (WebSocket library)
- **Testing:** Vitest (unit), Playwright (e2e), jsdom, supertest
- **Build:** None (static files served); CDN deps with local fallback
- **Data:** JSON files in `~/.openclaw/`

---

## 3. Implementation Tracks

### Track D1: Reliability & Quality Hygiene

**Goal:** Deterministic builds, no flaky tests, clear update path.

#### D1.1 — Version Pinning & Lockfile Hygiene
- **Parallel:** Yes
- **Blocked by:** None
- **Owned files:** `package.json`, `package-lock.json`
- **Files to modify:** `package.json`
- **TDD flow:**
  1. Run `npm audit` → note vulnerabilities
  2. Update `package.json` to use exact versions (no `^` or `~`)
  3. Run `npm install --package-lock-only` to regenerate lockfile
  4. Verify `npm ci` works in clean environment
  5. Commit with message: `chore(deps): pin all dependencies to exact versions`
- **Acceptance:** `npm ci` succeeds in fresh clone; `npm audit` shows 0 high/critical

#### D1.2 — Release Script & Changelog Automation
- **Parallel:** Yes (blocked by D1.1 only for version consistency)
- **Blocked by:** D1.1
- **Owned files:** `scripts/release.sh`, `CHANGELOG.md`, `package.json` (add script)
- **Files to create:**
  - `scripts/release.sh` (bash release automation)
  - `scripts/bump-version.js` (Node version bumper)
- **TDD flow:**
  1. Write failing test: `npm run release:dry` exits with error (script doesn't exist)
  2. Implement `scripts/release.sh` with validation checks
  3. Verify dry-run outputs proposed version bump and changelog entry
  4. Test full release path in temp clone
  5. Commit: `ci(release): add automated release script`
- **Commands:**
  ```bash
  npm run release:dry    # Preview changes
  npm run release        # Full release (tag + push)
  ```
- **Acceptance:** Running release script creates annotated git tag, updates CHANGELOG.md, bumps package.json version

#### D1.3 — Local CI/Testing Pipeline
- **Parallel:** Yes
- **Blocked by:** None
- **Owned files:** `scripts/test-all.sh`, `package.json` (add script)
- **Files to create:** `scripts/test-all.sh`
- **TDD flow:**
  1. Create script that runs unit tests, e2e tests, lint, and audit
  2. Run locally, verify all checks execute
  3. Commit: `ci(local): add comprehensive test script`
- **Acceptance:** `npm run test:all` runs full verification suite locally

#### D1.4 — Test Flake Elimination
- **Parallel:** No (requires understanding current flake patterns)
- **Blocked by:** None
- **Owned files:** `tests/**/*.test.js`, `e2e/**/*.spec.js`, `playwright.config.js`
- **Files to modify:**
  - `tests/public/app.test.js` (timing-dependent tests)
  - `e2e/chat-pane.spec.js` (if any race conditions)
  - `playwright.config.js` (add explicit timeouts)
- **TDD flow:**
  1. Run tests 10x: `for i in {1..10}; do npm test; done | grep -c FAIL`
  2. Identify flaky tests (should be 0 failures if stable)
  3. Add explicit wait conditions, avoid `setTimeout` in tests
  4. Run 10x again, verify 0 failures
  5. Commit: `test(reliability): eliminate timing-dependent assertions`
- **Acceptance:** 10 consecutive test runs pass with no flakes

#### D1.5 — Health Check Endpoint
- **Parallel:** Yes
- **Blocked by:** None
- **Owned files:** `routes/health.js`, `server.js`, `tests/routes/health.test.js`
- **Files to create:**
  - `routes/health.js`
  - `tests/routes/health.test.js`
- **Files to modify:** `server.js` (mount route)
- **TDD flow:**
  1. Write test: `GET /health` returns 200 with JSON
  2. Implement route with dependency checks (gateway WS status, disk space)
  3. Verify test passes
  4. Commit: `feat(health): add /health endpoint with dependency checks`
- **Response format:**
  ```json
  {
    "status": "healthy",
    "version": "1.0.0",
    "uptime": 3600,
    "checks": {
      "websocket": "connected",
      "filesystem": "writable"
    }
  }
  ```
- **Acceptance:** `curl http://localhost:3777/health` returns 200; e2e test verifies response schema

#### D1.6 — Rollback Procedure Documentation
- **Parallel:** Yes
- **Blocked by:** D1.2
- **Owned files:** `docs/operations/rollback.md`
- **Files to create:** `docs/operations/rollback.md`
- **TDD flow:**
  1. Document rollback steps in markdown
  2. Create test script that simulates rollback
  3. Execute rollback in temp environment, verify service recovery
  4. Commit: `docs(ops): add rollback procedure and test script`
- **Acceptance:** Can execute rollback in <5 minutes using only the doc

---

### Track D2: Chat UX Power-Ups

**Goal:** Delight with copy-to-clipboard, message search, and inline previews.

#### D2.1 — Copy-to-Clipboard for Code Blocks
- **Parallel:** Yes
- **Blocked by:** None
- **Owned files:** `public/chat-markdown.js`, `public/chat-pane.css`, `e2e/chat-rich-content.spec.js`
- **Files to modify:**
  - `public/chat-markdown.js` (add copy button to code block renderer)
  - `public/chat-pane.css` (copy button styling)
- **TDD flow:**
  1. Add e2e test: "code block has copy button that copies content"
  2. Run test → expect failure (no copy button)
  3. Implement copy button using `navigator.clipboard.writeText()`
  4. Add fallback for non-secure contexts
  5. Verify test passes
  6. Commit: `feat(chat): add copy-to-clipboard for code blocks`
- **Commands:**
  ```bash
  npm run test:e2e -- e2e/chat-rich-content.spec.js -g "copy"
  ```
- **Acceptance:** Clicking copy button on code block copies exact text; visual feedback shows "Copied!"

#### D2.2 — Message Search (In-Chat)
- **Parallel:** Yes (blocked by D2.3 for UI consistency)
- **Blocked by:** D2.3 (search input component)
- **Owned files:** `public/chat-pane.js`, `public/chat-pane.css`, `public/chat-message.js`
- **Files to modify:**
  - `public/chat-pane.js` (add search input, filtering logic)
  - `public/chat-message.js` (add data attributes for search indexing)
  - `public/chat-pane.css` (search highlight styles)
- **Files to create:** `tests/public/chat-search.test.js`
- **TDD flow:**
  1. Write unit test: `filterMessages('query')` returns matching message indices
  2. Implement search logic with debounce (300ms)
  3. Add search input UI to chat header
  4. Add highlight styling for matches
  5. Write e2e: search filters visible messages
  6. Commit: `feat(chat): add in-chat message search with highlight`
- **Commands:**
  ```bash
  npm test -- tests/public/chat-search.test.js
  npm run test:e2e -- e2e/chat-rich-content.spec.js -g "search"
  ```
- **Acceptance:** Typing in search box filters messages; matches are highlighted; clearing shows all

#### D2.3 — Keyboard Shortcuts System
- **Parallel:** Yes
- **Blocked by:** None
- **Owned files:** `public/chat-input.js`, `public/chat-pane.js`, `public/chat-pane.css`
- **Files to modify:**
  - `public/chat-input.js` (extract keyboard handling)
  - `public/chat-pane.js` (global shortcut handler)
- **Files to create:** `public/keyboard-shortcuts.js`, `tests/public/keyboard-shortcuts.test.js`
- **TDD flow:**
  1. Write unit test: `KeyboardShortcuts.register('Cmd+K', handler)` works
  2. Implement shortcut registry with platform detection
  3. Add `/` for search focus, `Esc` for close, `Cmd/Ctrl+Enter` for send
  4. Add visual shortcut hints in UI
  5. Verify e2e tests for each shortcut
  6. Commit: `feat(chat): add keyboard shortcut system`
- **Shortcuts:**
  | Key | Action |
  |-----|--------|
  | `/` | Focus search |
  | `Esc` | Close chat/clear search |
  | `Cmd/Ctrl+Enter` | Send message |
  | `Cmd/Ctrl+Shift+C` | Copy last code block |
  | `j/k` | Navigate messages (vim-style, optional) |
- **Acceptance:** All shortcuts work in Chrome, Firefox, Safari

#### D2.4 — Message Time Display
- **Parallel:** Yes
- **Blocked by:** None
- **Owned files:** `public/chat-message.js`, `public/chat-pane.css`
- **Files to modify:** `public/chat-message.js`, `public/chat-pane.css`
- **TDD flow:**
  1. Add unit test: `renderHistoryMessage` includes timestamp
  2. Implement relative time display ("2m ago", "1h ago", exact on hover)
  3. Update CSS for timestamp positioning
  4. Verify e2e shows timestamps
  5. Commit: `feat(chat): add message timestamps with relative display`
- **Acceptance:** Each message shows relative timestamp; hover shows exact ISO time

#### D2.5 — Inline Image Preview
- **Parallel:** Yes (blocked by D2.1 for copy pattern consistency)
- **Blocked by:** D2.1 (copy button pattern)
- **Owned files:** `public/chat-markdown.js`, `public/chat-pane.css`, `e2e/chat-rich-content.spec.js`
- **Files to modify:** `public/chat-markdown.js`
- **TDD flow:**
  1. Add e2e test: "markdown image renders as clickable thumbnail"
  2. Extend marked renderer to handle image tokens
  3. Add lightbox/modal for full-size view
  4. Verify e2e passes
  5. Commit: `feat(chat): add inline image preview with lightbox`
- **Security:** Only allow `data:image/` and `https://` schemes; sanitize with DOMPurify
- **Acceptance:** Image URLs in markdown render as thumbnails; click opens lightbox

---

### Track D3: Performance at Scale

**Goal:** Smooth performance at 1000+ messages, large tool results, and concurrent sessions.

#### D3.1 — Virtual Scrolling for Large Conversations
- **Parallel:** No (foundational)
- **Blocked by:** None
- **Owned files:** `public/chat-messages.js` (create), `public/chat-pane.js`, `public/chat-pane.css`
- **Files to create:**
  - `public/chat-messages.js` (virtual scroll controller)
  - `tests/public/chat-messages.test.js`
- **Files to modify:**
  - `public/chat-pane.js` (integrate virtual scroll)
  - `public/index.html` (if structure changes needed)
- **TDD flow:**
  1. Create test: render 1000 messages without >50ms frame drops
  2. Implement virtual scroll with `IntersectionObserver`
  3. Measure FPS during scroll; verify >55fps
  4. Commit: `perf(chat): implement virtual scrolling for large conversations`
- **Commands:**
  ```bash
  npm run test:e2e -- e2e/chat-performance.spec.js
  ```
- **Acceptance:** Scroll through 1000 messages maintains 55fps+; no memory leaks on session switch

#### D3.2 — Progressive Rendering for Tool Results
- **Parallel:** Yes (extends D3.1 concepts)
- **Blocked by:** D3.1 (virtual scroll patterns)
- **Owned files:** `public/chat-tool-blocks.js`, `public/chat-pane.css`
- **Files to modify:** `public/chat-tool-blocks.js`
- **TDD flow:**
  1. Add e2e: "50KB tool result renders progressively without blocking"
  2. Implement chunked rendering (10KB chunks, `requestAnimationFrame`)
  3. Add progress indicator
  4. Verify UI remains responsive during render
  5. Commit: `perf(chat): progressive rendering for large tool results`
- **Acceptance:** Tool result >50KB renders without blocking input; progress bar shows status

#### D3.3 — Memory Leak Audit & Fix
- **Parallel:** No (requires analysis)
- **Blocked by:** None
- **Owned files:** All `public/*.js` files
- **Files to create:** `tests/memory/leak-check.test.js`
- **TDD flow:**
  1. Write memory test: switch sessions 100x, heap growth <10%
  2. Run test, identify leaks (detached DOM nodes, uncleared intervals)
  3. Fix leaks: clear timeouts, remove listeners, nullify refs
  4. Re-run test, verify heap stable
  5. Commit: `fix(memory): resolve session switch leaks`
- **Commands:**
  ```bash
  npm run test:memory  # Custom script using --expose-gc
  ```
- **Acceptance:** Heap size after 100 session switches within 10% of baseline

#### D3.4 — WebSocket Message Batching
- **Parallel:** Yes
- **Blocked by:** None
- **Owned files:** `public/chat-ws-handler.js`, `ws/chat-handlers.js`
- **Files to modify:**
  - `public/chat-ws-handler.js` (add batching buffer)
  - `ws/chat-handlers.js` (server-side batch flush)
- **TDD flow:**
  1. Add unit test: rapid WS messages are batched and flushed
  2. Implement 50ms batch buffer on client
  3. Verify render batching reduces DOM operations
  4. Commit: `perf(ws): batch rapid WebSocket messages`
- **Acceptance:** 100 rapid messages result in ≤5 DOM updates; UI remains responsive

#### D3.5 — Bundle Analysis & Lazy Loading
- **Parallel:** Yes
- **Blocked by:** None
- **Owned files:** `public/index.html`, `public/app.js`
- **Files to create:** `scripts/bundle-analyze.js`
- **TDD flow:**
  1. Create bundle analyzer script
  2. Identify large dependencies
  3. Implement dynamic import for heavy features (e.g., image preview)
  4. Measure initial load size reduction
  5. Commit: `perf(bundle): lazy load image preview module`
- **Acceptance:** Initial bundle <100KB; dynamic chunks load on demand

---

### Track D4: Resilience / Fallback Behavior

**Goal:** Graceful degradation when CDN fails, WS drops, or browser lacks features.

#### D4.1 — CDN Dependency Local Fallback
- **Parallel:** Yes
- **Blocked by:** None
- **Owned files:** `public/index.html`, `public/vendor/` (create), `scripts/vendor-sync.js`
- **Files to create:**
  - `public/vendor/marked.min.js` (v15.0.7)
  - `public/vendor/purify.min.js` (v3.2.4)
  - `scripts/vendor-sync.js` (automation script)
- **Files to modify:** `public/index.html` (fallback script logic)
- **TDD flow:**
  1. Write e2e test: block CDN domain, verify local assets load
  2. Add fallback script detection to `index.html`
  3. Download vendor files to `public/vendor/`
  4. Run e2e with network throttling, verify fallback
  5. Commit: `feat(resilience): add CDN fallback for marked and DOMPurify`
- **Commands:**
  ```bash
  npm run vendor:sync  # Download and verify vendor files
  npm run test:e2e -- e2e/resilience.spec.js
  ```
- **Acceptance:** With CDN blocked, HUD loads successfully; vendor files served locally

#### D4.2 — WebSocket Reconnection with Exponential Backoff
- **Parallel:** Yes
- **Blocked by:** None
- **Owned files:** `public/app.js`, `public/chat-pane.js`
- **Files to modify:** `public/app.js` (WS connection logic)
- **TDD flow:**
  1. Add unit test: WS disconnect triggers reconnect with backoff
  2. Implement exponential backoff (1s, 2s, 4s, 8s, max 30s)
  3. Add visual indicator for reconnection state
  4. Verify e2e with network drop simulation
  5. Commit: `feat(resilience): exponential backoff WebSocket reconnection`
- **Acceptance:** WS drop reconnects automatically; UI shows reconnection status; max 30s retry

#### D4.3 — Graceful Degradation without JavaScript
- **Parallel:** Yes
- **Blocked by:** None
- **Owned files:** `public/index.html`, `public/styles/base.css`
- **Files to modify:** `public/index.html` (noscript content), `public/styles/base.css`
- **TDD flow:**
  1. Disable JS in browser, verify HUD shows meaningful state
  2. Add `<noscript>` message explaining JS requirement
  3. Ensure basic layout works without JS
  4. Verify with e2e `javaScriptEnabled: false`
  5. Commit: `feat(a11y): add noscript fallback message`
- **Acceptance:** With JS disabled, user sees clear message; no broken layout

#### D4.4 — LocalStorage Quota Handling
- **Parallel:** Yes
- **Blocked by:** None
- **Owned files:** `public/chat-pane.js`, `public/utils.js`
- **Files to modify:** `public/utils.js` (add safe storage wrapper)
- **TDD flow:**
  1. Write unit test: `safeStorage.set()` handles quota exceeded
  2. Implement try/catch wrapper with LRU eviction
  3. Update all localStorage calls to use wrapper
  4. Verify test passes
  5. Commit: `feat(resilience): handle LocalStorage quota exceeded`
- **Acceptance:** When quota exceeded, old sessions evicted; new saves succeed; no console errors

#### D4.5 — Offline Mode Detection
- **Parallel:** Yes
- **Blocked by:** None
- **Owned files:** `public/app.js`, `public/styles/base.css`
- **Files to modify:** `public/app.js`
- **TDD flow:**
  1. Add unit test: `navigator.onLine` changes trigger status update
  2. Implement online/offline listeners
  3. Add banner UI for offline state
  4. Queue messages when offline, send on reconnect
  5. Verify e2e with network offline simulation
  6. Commit: `feat(resilience): add offline detection and message queueing`
- **Acceptance:** Going offline shows banner; messages queue; coming online flushes queue

---

### Track D5: Accessibility Hardening

**Goal:** WCAG 2.1 AA compliance, full keyboard navigation, screen reader support.

#### D5.1 — Keyboard Navigation for All Interactive Elements
- **Parallel:** No (foundational)
- **Blocked by:** None
- **Owned files:** All `public/panels/*.js`, `public/chat-*.js`
- **Files to create:** `tests/a11y/keyboard-navigation.test.js`
- **TDD flow:**
  1. Write e2e: Tab through all panels, verify focusable elements
  2. Identify gaps (missing tabindex, non-button clickable divs)
  3. Convert clickable divs to `<button>` or add `role="button" tabindex="0"`
  4. Add visible focus indicators (CSS `:focus-visible`)
  5. Verify all interactive elements reachable via Tab
  6. Commit: `a11y: full keyboard navigation support`
- **Acceptance:** Tab traverses all interactive elements; Enter/Space activates; focus visible

#### D5.2 — ARIA Live Regions for Dynamic Content
- **Parallel:** Yes (extends D5.1)
- **Blocked by:** D5.1 (focus management)
- **Owned files:** `public/chat-message.js`, `public/chat-ws-handler.js`, `public/panels/activity.js`
- **Files to modify:**
  - `public/chat-message.js` (add `aria-live` to message container)
  - `public/panels/activity.js` (announce new activities)
- **TDD flow:**
  1. Add e2e with screen reader simulation: verify announcements
  2. Implement polite live regions for incoming messages
  3. Add assertive region for errors
  4. Verify announcements not overwhelming (debounced)
  5. Commit: `a11y: add ARIA live regions for chat and activity`
- **Acceptance:** Screen reader announces new messages; errors announced immediately

#### D5.3 — Focus Trap in Modals
- **Parallel:** Yes
- **Blocked by:** D5.1
- **Owned files:** `public/panels/spawn.js`, `public/panels/cron.js`
- **Files to create:** `public/a11y/focus-trap.js`, `tests/a11y/focus-trap.test.js`
- **TDD flow:**
  1. Write unit test: `FocusTrap` class cycles focus within container
  2. Implement focus trap utility
  3. Apply to spawn modal and cron modal
  4. Add e2e: Tab from last element returns to first
  5. Verify Escape closes modal and restores focus
  6. Commit: `a11y: add focus trap to modals`
- **Acceptance:** Tab cycles within open modal; Escape closes and returns focus to trigger

#### D5.4 — Color Contrast Audit & Fix
- **Parallel:** Yes
- **Blocked by:** None
- **Owned files:** `public/styles/*.css`
- **Files to create:** `tests/a11y/contrast.test.js` (using axe-core or similar)
- **TDD flow:**
  1. Run contrast audit tool, identify failures
  2. Update CSS variables for failing combinations
  3. Re-run audit, verify 0 failures
  4. Commit: `a11y: fix color contrast to meet WCAG AA`
- **Acceptance:** All text meets 4.5:1 contrast ratio; large text 3:1

#### D5.5 — Screen Reader Labels & Descriptions
- **Parallel:** Yes
- **Blocked by:** D5.2
- **Owned files:** All `public/*.js`, `public/index.html`
- **Files to modify:**
  - `public/index.html` (add `aria-label` where text missing)
  - `public/panels/*.js` (add descriptive labels to icon buttons)
  - `public/chat-tool-blocks.js` (tool icons need labels)
- **TDD flow:**
  1. Run screen reader audit (axe-core), identify missing labels
  2. Add `aria-label` or `aria-labelledby` to all icon-only buttons
  3. Add `aria-describedby` for context
  4. Re-run audit, verify 0 violations
  5. Commit: `a11y: add screen reader labels to all interactive elements`
- **Acceptance:** All buttons have accessible names; form inputs have labels

#### D5.6 — Reduced Motion Support
- **Parallel:** Yes
- **Blocked by:** None
- **Owned files:** `public/styles/*.css`, `public/chat-pane.css`
- **Files to modify:** All CSS files with animations
- **TDD flow:**
  1. Add `prefers-reduced-motion` media query tests
  2. Wrap animations in `@media (prefers-reduced-motion: no-preference)`
  3. Provide instant-state alternatives
  4. Verify with browser devtools reduced motion simulation
  5. Commit: `a11y: respect prefers-reduced-motion`
- **Acceptance:** With reduced motion on: no animations; all state changes instant

---

## 4. File Ownership Matrix

| File | Primary Owner | Secondary | Tracks |
|------|---------------|-----------|--------|
| `public/chat-markdown.js` | D2 | D4, D5 | Copy, images, security |
| `public/chat-tool-blocks.js` | D2 | D3, D5 | Progressive render, a11y |
| `public/chat-message.js` | D5 | D2, D3 | ARIA, timestamps, virtual scroll |
| `public/chat-pane.js` | D3 | D2, D4, D5 | Virtual scroll, search, offline |
| `public/chat-ws-handler.js` | D4 | D3 | Batching, reconnection |
| `public/keyboard-shortcuts.js` | D2 | D5 | Shortcuts, focus mgmt |
| `public/chat-messages.js` | D3 | — | Virtual scroll controller |
| `public/app.js` | D4 | D3, D5 | Reconnection, offline, a11y |
| `public/index.html` | D4 | D5 | CDN fallback, noscript |
| `public/styles/*.css` | D5 | D2, D3 | Contrast, motion, focus |
| `routes/health.js` | D1 | — | Health endpoint |
| `scripts/release.sh` | D1 | — | Release automation |
| `scripts/test-all.sh` | D1 | — | Local CI |
| `tests/**/*.test.js` | D1 | All | Test reliability |
| `e2e/**/*.spec.js` | D1 | All | E2E coverage |
| `docs/operations/*.md` | D1 | — | Operations docs |

---

## 5. Execution Order / Priorities

**Priority 1: Foundation (Start Here)**
1. **D1.1** — Version pinning (deterministic builds)
2. **D1.4** — Test flake elimination (trustworthy tests)
3. **D4.1** — CDN fallback (works offline/in walled gardens)
4. **D1.5** — Health endpoint (visibility into system state)

**Priority 2: Resilience & Core UX**
5. **D4.2** — WS reconnection (survives network blips)
6. **D4.4** — LocalStorage quota (handles large session history)
7. **D2.1** — Copy-to-clipboard (daily quality-of-life)
8. **D2.3** — Keyboard shortcuts (power user features)
9. **D2.4** — Message timestamps (contextual awareness)

**Priority 3: Performance**
10. **D3.1** — Virtual scrolling (handles long conversations)
11. **D3.3** — Memory leak audit (stable long-running sessions)
12. **D3.2** — Progressive tool render (smooth large outputs)
13. **D3.4** — WS batching (responsive during high activity)

**Priority 4: Search & Advanced Features**
14. **D2.2** — Message search (find anything in history)
15. **D2.5** — Inline image preview (rich content)
16. **D4.5** — Offline mode (full offline resilience)

**Priority 5: Polish & Accessibility**
17. **D5.1** — Keyboard navigation (no-mouse operation)
18. **D5.4** — Color contrast (comfortable reading)
19. **D5.6** — Reduced motion (respects system preferences)
20. **D5.3** — Focus trap (modal safety)
21. **D5.2** — ARIA live regions (screen reader support)
22. **D5.5** — Screen reader labels (complete a11y)

**Priority 6: Automation & Docs**
23. **D1.2** — Release script (easy versioning)
24. **D1.3** — Local test pipeline (one-command verification)
25. **D1.6** — Rollback docs (recovery path)
26. **D4.3** — No-JS fallback (complete degradation handling)

---

## 6. Acceptance Criteria by Track

### D1: Reliability & Quality Hygiene
- [ ] `npm ci` produces deterministic builds
- [ ] Release script creates tagged release with changelog
- [ ] `npm run test:all` passes locally (unit + e2e + lint + audit)
- [ ] 10 consecutive test runs with 0 flakes
- [ ] `/health` endpoint returns accurate dependency status
- [ ] Rollback procedure documented and tested

### D2: Chat UX Power-Ups
- [ ] Code block copy button works in all browsers
- [ ] Search filters messages with <100ms latency
- [ ] All documented keyboard shortcuts work
- [ ] Message timestamps display (relative + absolute)
- [ ] Images render as thumbnails with lightbox

### D3: Performance at Scale
- [ ] 1000 messages scroll at 55fps+
- [ ] 50KB+ tool results render progressively
- [ ] 100 session switches cause <10% heap growth
- [ ] 100 rapid WS messages batch to ≤5 renders
- [ ] Initial bundle <100KB, lazy chunks on demand

### D4: Resilience / Fallback
- [ ] HUD loads with CDN blocked (local vendor)
- [ ] WS reconnects automatically with exponential backoff
- [ ] No-JS shows meaningful message
- [ ] LocalStorage quota handled gracefully
- [ ] Offline mode detected, messages queued and flushed

### D5: Accessibility Hardening
- [ ] All interactive elements keyboard accessible
- [ ] Screen reader announces new messages
- [ ] Modal focus traps cycle correctly
- [ ] 0 color contrast violations (WCAG AA)
- [ ] All buttons have accessible names
- [ ] Reduced motion respected, animations disabled

---

## 7. Quality Checklist (Pre-Tag)

Before creating any release tag:

1. **Test Suite:** `npm run test:all` passes (unit + e2e + lint + audit)
2. **Lint:** No console errors or warnings in browser
3. **Security:** `npm audit` shows 0 high/critical
4. **Performance:** Lighthouse score ≥90 (Performance, Accessibility)
5. **Manual QA:** All tracks acceptance criteria verified
6. **Rollback Test:** Procedure executed successfully

---

## 8. Summary

| Track | Tasks | Key Deliverable |
|-------|-------|-----------------|
| **D1** Reliability & Quality Hygiene | 6 | Automated release, zero flakes, local test suite |
| **D2** Chat UX Power-Ups | 5 | Copy, search, shortcuts, timestamps, images |
| **D3** Performance at Scale | 5 | Virtual scroll, progressive render, memory stable |
| **D4** Resilience / Fallback | 5 | CDN fallback, WS reconnection, offline mode |
| **D5** Accessibility Hardening | 6 | WCAG AA compliance, full keyboard nav |
| **Total** | 27 tasks | Stable, polished HUD for daily personal use |

---

**Path:** `docs/plans/2026-02-22-phase-d-implementation-plan.md`

**Next steps:** Pick a task from Priority 1 and begin execution. Track progress against acceptance criteria in this document.
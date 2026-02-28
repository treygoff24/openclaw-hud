# GPU Optimization Plan (Frontend HUD)

*Codex investigation + Athena architecture review. Last updated: 2026-02-28.*

## Executive Summary
The frontend scan covered every CSS and JS file under `public/` and found the biggest GPU pressure comes from always-on full-viewport visual effects (`body::before/::after` overlays and `backdrop-filter` blur), high-frequency chat streaming without layout isolation, and full DOM replacement patterns in panel rendering. The fastest path to meaningful GPU relief is to remove/replace the expensive full-screen effects first, add CSS containment to chat messages, then batch and diff UI updates so the compositor gets fewer, simpler frames.

## Top 5 Highest-Impact Issues (Ranked)

### 1) Full-viewport fixed overlays force expensive painting/compositing
- File path: `public/styles/base.css`
- Line numbers: `55-67`, `71-79`
- Current snippet:
```css
body::after {
  content: "";
  position: fixed;
  inset: 0;
  background:
    repeating-linear-gradient(0deg, transparent 0 2px, rgba(255, 255, 255, 0.03) 2px 3px),
    radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.04), transparent 60%);
  pointer-events: none;
  z-index: 9999;
}
body::before {
  content: "";
  position: fixed;
  inset: 0;
  background-image: url("data:image/svg+xml,...feTurbulence...");
  opacity: 0.06;
  pointer-events: none;
  z-index: 9998;
}
```
- What it does wrong: keeps two full-screen fixed layers active at all times; scrolling and live updates trigger large repaints/compositing on each frame.
- Proposed fix:
```css
/* Default: disable heavy overlays */
body::before,
body::after {
  content: none;
}

/* Optional opt-in "fx" mode only */
body.fx-on::after {
  content: "";
  position: fixed;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent 0 3px,
    rgba(255, 255, 255, 0.015) 3px 4px
  );
  opacity: 0.35;
  pointer-events: none;
  z-index: 20;
}
```
- Estimated impact: **High**

### 2) Backdrop blur in command palette is a high-cost compositor effect
- File path: `public/styles/slash-commands.css`
- Line numbers: `22`, `118`
- Current snippet: `backdrop-filter: blur(8px);`
- What it does wrong: requires sampling and filtering pixels behind the element each frame, expensive on animated/interactive overlays.
- Proposed fix:
```css
.slash-commands-dropdown,
.slash-command-input-wrap {
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  background: rgba(10, 12, 16, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
```
- Estimated impact: **High**

### 3) Chat streaming/history path causes repeated layout/paint work (promoted from #5)
- File paths + line numbers:
  - `public/chat-ws/history-log.js:52-54`
  - `public/chat-ws/stream-events.js:42,137`
  - `public/chat-markdown.js:75-95,150-163`
- Current snippets:
```js
// history-log.js — appends nodes one-by-one
(data.messages || []).forEach(function (msg) {
  container.appendChild(window.ChatMessage.renderHistoryMessage(msg));
});

// stream-events.js — forces layout read on every delta
container.scrollTop = container.scrollHeight;

// chat-markdown.js — reparses on every call
var raw = marked.parse(text);
var sanitized = DOMPurify.sanitize(raw, config);
return postProcessAnchors(sanitized);
```
- What it does wrong: appends history nodes one-by-one (triggering layout per append), forces synchronous autoscroll during streaming (layout thrashing), and reparses/sanitizes markdown without caching.
- **Why ranked #3:** Chat streaming is the highest-frequency continuous operation. Dropping frames here degrades the core UX more than intermittent panel updates.
- **Important distinction:** History load (bulk messages) benefits from DocumentFragment batching. Live token streaming (character-by-character) mutates existing nodes, so batching doesn't apply there. The rAF-throttled autoscroll and markdown caching help both paths.
- Proposed fix:
```js
// 1) Batch history load insertions (bulk path only)
const frag = document.createDocumentFragment();
for (const msg of data.messages || []) {
  frag.appendChild(window.ChatMessage.renderHistoryMessage(msg));
}
container.appendChild(frag);

// 2) Throttle autoscroll to animation frames + only when pinned to bottom
let scrollQueued = false;
function scheduleAutoScroll(container) {
  if (scrollQueued || !isPinnedToBottom(container)) return;
  scrollQueued = true;
  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
    scrollQueued = false;
  });
}

// 3) Cache markdown by content hash (for completed messages, not live stream)
// LRU-bounded markdown cache (cap at 500 entries to prevent memory leaks in long sessions)
const MD_CACHE_MAX = 500;
const mdCache = new Map();
function renderMarkdownCached(text) {
  const key = hash(text);
  if (mdCache.has(key)) {
    const val = mdCache.get(key);
    mdCache.delete(key);
    mdCache.set(key, val); // refresh LRU position
    return val;
  }
  const html = postProcessAnchors(DOMPurify.sanitize(marked.parse(text), config));
  mdCache.set(key, html);
  if (mdCache.size > MD_CACHE_MAX) {
    mdCache.delete(mdCache.keys().next().value); // evict oldest
  }
  return html;
}
```
- Estimated impact: **High**

### 4) Missing CSS containment on chat messages (NEW — from Athena review)
- File path: `public/chat-pane.css`
- Affected selectors: `.chat-msg`, `#chat-messages`
- What's missing: When a new chunk of text streams into a chat message, the browser may recalculate layout for the *entire page*. Without CSS containment, every token append triggers global layout.
- Proposed fix:
```css
/* Isolate layout/paint per message — changes inside won't trigger page-wide reflow */
.chat-msg {
  contain: content;
}

/* Isolate the scrolling container itself */
#chat-messages {
  contain: strict;
  overflow-anchor: auto;
}
```
- **Note:** `contain: content` tells the browser "DOM changes inside this element will not affect layout outside of it." This drastically shrinks layout scope during active streaming.
- Estimated impact: **High**

### 5) Session tree fully re-renders and rebinds handlers on every toggle/update (demoted from #3)
- File path: `public/panels/session-tree.js`
- Line numbers: `89`, `95-98`, `100-137`
- Current snippet:
```js
$("#tree-body").innerHTML = html;
...
collapseState[key] = !collapseState[key];
if (window._treeData) render(window._treeData);
...
document.querySelectorAll(".tree-node-content").forEach(...)
document.querySelectorAll(".tree-toggle").forEach(...)
```
- What it does wrong: destroys and recreates the whole tree DOM and reattaches listeners on every toggle/data update.
- **Why demoted:** This is intermittent (user-triggered), not continuous like chat streaming.
- Proposed fix — use event delegation (quick) + `morphdom` for diffing (avoids hand-rolling a DOM differ in vanilla JS):
```js
// One-time delegated listeners (bind once, never rebind)
const treeBody = $("#tree-body");
treeBody.addEventListener("click", (e) => {
  const toggle = e.target.closest(".tree-toggle");
  if (toggle) {
    const key = toggle.dataset.key;
    collapseState[key] = !collapseState[key];
    updateTree(); // morphdom diff, not full innerHTML
    return;
  }
  const node = e.target.closest(".tree-node-content");
  if (node) handleSessionActivate(node.dataset.sessionId);
});

// Use morphdom for efficient DOM diffing instead of innerHTML replacement
// npm install morphdom (4KB gzipped, zero deps)
import morphdom from "morphdom";
function updateTree() {
  const nextHTML = buildTreeHTML(window._treeData);
  const temp = document.createElement("div");
  temp.innerHTML = nextHTML;
  morphdom(treeBody, temp, { childrenOnly: true });
}
```
- **Why morphdom over hand-rolled diffing:** Writing keyed incremental DOM patching from scratch in vanilla JS is a complexity trap with high risk for memory leaks and state desync. `morphdom` is 4KB gzipped, battle-tested, zero dependencies.
- Estimated impact: **High**

### Also notable: Virtualized chat path double-renders each item
- File path: `public/chat-messages.js`
- Line numbers: `169-173`
- Current snippet:
```js
const messageEl = window.ChatMessage.renderHistoryMessage(item);
el.className = messageEl.className;
el.innerHTML = messageEl.innerHTML;
```
- What it does wrong: creates a full DOM tree, serializes it via innerHTML, then parses it again into the recycled element.
- Proposed fix:
```js
const messageEl = window.ChatMessage.renderHistoryMessage(item);
el.replaceChildren(messageEl);
```
- **Regression watch:** Ensure no event listeners are attached to `messageEl` children that would leak when recycled. If ChatMessage attaches listeners, use event delegation on the container instead.
- Estimated impact: **Medium-High**

## Quick Wins (<30 Minutes Each)
1. Remove or gate `body::before`/`body::after` overlays in `public/styles/base.css`
2. Replace `backdrop-filter: blur(8px)` with opaque/translucent background in `public/styles/slash-commands.css`
3. Add `contain: content` to `.chat-msg` and `contain: strict` to `#chat-messages` in `public/chat-pane.css`
4. Convert `transition: all` to specific properties (`transform, opacity`) across `chat-pane.css`, `panels.css`, `agents.css`, `spawn.css`, `toast.css`
5. Remove persistent `will-change: transform` in `public/chat-pane.css:840`; apply only before known animation and clear afterward
6. Batch history append with `DocumentFragment` in `public/chat-ws/history-log.js` (bulk history load path only)
7. Merge two 1s timers in `public/app/status.js:83-85` into a single scheduler; pause when tab is hidden via `document.visibilitychange`

## Architecture Improvements (Bigger Refactors)
- Build a small render scheduler (single `requestAnimationFrame` queue) so websocket/polling updates coalesce into one paint per frame.
- Move panel rendering (`session-tree`, `agents`, `sessions`, `activity`, `cron`, `models`) from full `innerHTML` replacement to `morphdom`-based diffing. Do NOT hand-roll a DOM differ in vanilla JS.
- Add event delegation for all list/tree components so listeners are bound once instead of per render pass.
- Introduce markdown render caching (for completed messages) and optional worker offload for long outputs to keep main thread free.
- Add visibility-aware polling (`document.hidden`) and adaptive refresh intervals to reduce unnecessary update work in background tabs.
- Define a "visual effects budget" policy: no backdrop filters, no infinite glow animations, no large animated shadows on frequently updated surfaces.

## Testing Methodology (Verify GPU Improvement)

### 1) Baseline Capture (before changes)
- Chrome DevTools Performance recording: capture 30-60s during active websocket/chat streaming and panel updates.
- **Enable 4x CPU throttling** in DevTools to simulate lower-end hardware (M-series Macs will brute-force past inefficiencies otherwise).
- Record:
  - **FPS stability** (enable FPS meter in DevTools rendering tab)
  - Main-thread time in `Recalculate Style`, `Layout`, `Paint`, `Composite Layers`
  - Long tasks count
- Open `chrome://gpu` (GPU diagnostics) and note renderer/compositing status.
- Use DevTools Layers panel to count large promoted layers and identify full-screen composited surfaces.
- Use DevTools Performance Monitor to watch `CPU`, `JS heap`, and `GPU memory` while reproducing load.

### 2) Scenario-Based Profiling
- Scenario A: idle dashboard for 5 minutes.
- Scenario B: heavy websocket stream (chat + panels updating).
- Scenario C: open/close slash commands repeatedly.
- Scenario D: expand/collapse session tree rapidly.
- Capture each scenario pre/post changes with same data load.

### 3) Pass/Fail Targets
- Maintain **60fps** during Scenario B (stream + panel updates) with 4x CPU throttling.
- Reduce `Paint + Composite Layers` time by at least **30-50%** in Scenario B.
- Reduce large full-screen composited layers count in Layers panel.
- Reduce GPU memory variance/spikes in Performance Monitor during command palette usage.
- Eliminate visible stutter when expanding session tree and during streaming autoscroll.

## Scan Coverage Notes
- Coverage completed: all CSS and JS files in `public/` were reviewed (including `public/vendor/*.min.js`).
- No first-party Canvas/WebGL rendering pipeline was found.

### Appendix: Reviewed Files With No Significant GPU Issues (Grouped)
- Root JS: `public/app.js`, `public/storage.js`, `public/utils.js`, `public/keyboard-shortcuts.js`, `public/copy-utils.js`, `public/lazy-loader.js`, `public/session-labels.js`, `public/chat-pane.js`, `public/chat-commands.js`, `public/chat-sender-resolver.js`, `public/chat-tool-blocks.js`, `public/chat-ws-batcher.js`, `public/chat-ws-handler.js`, `public/chat-message.js`, `public/label-sanitizer.js`.
- `public/app/`: `bootstrap.js`, `diagnostics.js`, `ui.js`, `ws.js`.
- `public/chat-pane/`: `constants.js`, `diagnostics.js`, `export.js`, `history-timeout.js`, `pane-lifecycle.js`, `session-metadata.js`, `session-restore.js`, `state.js`, `transport.js`, `ws-bridge.js`.
- `public/chat-ws/`: `runtime.js`, `system-events.js`.
- `public/chat-input/`: `model-picker.js`, `send-flow.js`.
- `public/chat-commands/`: `catalog.js`, `fuzzy.js`, `help.js`, `local-exec.js`, `registry.js`.
- `public/a11y/`: `announcer.js`, `focus-trap.js`.
- Panels with lower/no direct GPU concerns vs top issues: `panels/spawn.js`, `panels/system.js`.
- CSS mostly clean/low impact: `public/noscript.css`, `public/styles/a11y.css`, `public/styles/activity.css`, `public/styles/main.css`, `public/styles/system.css`.
- Vendor (minified) reviewed for first-party risk only: `public/vendor/marked.min.js`, `public/vendor/purify.min.js`.

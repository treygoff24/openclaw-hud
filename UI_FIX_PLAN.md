# UI Fix Plan — OpenClaw HUD

All issues investigated, root causes identified. Tasks are ordered by complexity (quick wins first, big features last).

---

## Task 1: Remove "KIMI K2.5 / COMMAND CENTER" text
**Complexity:** Trivial (2 lines)
**Files:**
- `public/index.html:20` — delete `<div class="hud-subtitle">KIMI K2.5 // COMMAND CENTER</div>`
- `public/index.html:6` — change `<title>OPENCLAW HUD // KIMI K2.5</title>` to `<title>OPENCLAW HUD</title>`
- `server.js:58` — update console banner from `KIMI K2.5 EDITION` to just `OPENCLAW HUD`

---

## Task 2: Fix chat input scrollbar (auto-grow textarea)
**Complexity:** Trivial (1 CSS change)
**Root cause:** `overflow-y: auto` shows the OS scrollbar. Auto-grow JS already exists and works correctly.
**Files:**
- `public/chat-pane.css:119` — change `overflow-y: auto` to `overflow-y: hidden`

The existing JS in `chat-input.js:68-74` (`e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'`) handles expansion. CSS `max-height: 160px` caps it. Once content exceeds max-height, the user needs to scroll, so also add: when `scrollHeight > 160`, set `overflow-y: auto` via JS so the scrollbar only appears when actually needed.

**Implementation:**
```css
/* chat-pane.css line 119 */
overflow-y: hidden;   /* was: auto */
```
```js
/* chat-input.js, inside the input handler after setting height */
e.target.style.overflowY = e.target.scrollHeight > 160 ? 'auto' : 'hidden';
```

---

## Task 3: Scale up all font sizes (everything too small)
**Complexity:** Medium (many files, mechanical changes)
**Root cause:** All font sizes are hardcoded `px` values scattered across 12+ CSS files. No CSS variables for sizing. Smallest values (9-11px) are everywhere — timestamps, labels, chat roles, tool blocks.

**Approach:** Introduce font-size CSS variables in `base.css` `:root`, then replace all hardcoded values with variables. Bump everything ~25-30%.

**Step 1 — Add variables to `public/styles/base.css` `:root`:**
```css
--fs-2xs: 10px;    /* was 9px  — timestamps, hints */
--fs-xs:  11px;    /* was 10px — chat roles, stat labels, tool bodies */
--fs-sm:  13px;    /* was 11-12px — panel headers, labels, meta */
--fs-base: 15px;   /* was 13-14px — body text, tree labels, activity */
--fs-lg:  17px;    /* was 15px — agent IDs, session rows, sys values */
--fs-xl:  20px;    /* was 18px — clock */
--fs-2xl: 24px;    /* was 22px — stat values */
--fs-3xl: 2rem;    /* was 1.8rem — logo */
```

**Step 2 — Replace hardcoded values across all CSS files:**

| File | Selector | Old | New Variable |
|------|----------|-----|-------------|
| `header.css:51` | `.logo-glitch` | `1.8rem` | `var(--fs-3xl)` |
| `header.css:23` | `.hud-subtitle` | `13px` | `var(--fs-sm)` |
| `header.css:29` | `.hud-time` | `18px` | `var(--fs-xl)` |
| `header.css:91` | `.stat-label` | `10px` | `var(--fs-xs)` |
| `header.css:98` | `.stat-value` | `22px` | `var(--fs-2xl)` |
| `panels.css:94` | `.panel-header` | `11px` | `var(--fs-sm)` |
| `panels.css:106` | `.panel-header .count` | `12px` | `var(--fs-sm)` |
| `panels.css:203` | `.modal-header` | `12px` | `var(--fs-sm)` |
| `panels.css:226` | `.hud-input, .hud-select, .hud-textarea` | `14px` | `var(--fs-base)` |
| `panels.css:244` | `.form-group label` | `11px` | `var(--fs-sm)` |
| `panels.css:257` | `.hud-btn` | `14px` | `var(--fs-base)` |
| `spawn.css:4` | `.spawn-btn` | `11px` | `var(--fs-sm)` |
| `spawn.css:23` | `.label-hint` | `9px` | `var(--fs-2xs)` |
| `agents.css:21` | `.agent-id` | `15px` | `var(--fs-lg)` |
| `agents.css:27` | `.agent-sessions-count` | `13px` | `var(--fs-sm)` |
| `agents.css:43` | `.search-box` | `14px` | `var(--fs-base)` |
| `sessions.css:8` | `.session-row` | `15px` | `var(--fs-lg)` |
| `sessions.css:17` | `.session-agent` | `13px` | `var(--fs-sm)` |
| `sessions.css:31` | `.session-age` | `13px` | `var(--fs-sm)` |
| `cron.css:15` | `.cron-name` | `15px` | `var(--fs-lg)` |
| `cron.css:21` | `.cron-agent-tag` | `11px` | `var(--fs-sm)` |
| `cron.css:31` | `.cron-meta` | `12px` | `var(--fs-sm)` |
| `cron.css:35` | `.cron-schedule` | `13px` | `var(--fs-sm)` |
| `cron.css:40` | `.cron-model-info` | `11px` | `var(--fs-sm)` |
| `cron.css:47` | `.cron-status-row` | `12px` | `var(--fs-sm)` |
| `system.css:10` | `.sys-label` | `12px` | `var(--fs-sm)` |
| `system.css:17` | `.sys-value` | `15px` | `var(--fs-lg)` |
| `models.css:5` | `.model-bar-label` | `13px` | `var(--fs-sm)` |
| `models.css:38` | `.model-agents` | `11px` | `var(--fs-sm)` |
| `models.css:44` | `.token-breakdown` | `11px` | `var(--fs-sm)` |
| `activity.css:8` | `.activity-item` | `14px` | `var(--fs-base)` |
| `activity.css:12` | `.activity-time` | `12px` | `var(--fs-sm)` |
| `activity.css:19` | `.activity-type` | `12px` | `var(--fs-sm)` |
| `activity.css:39` | `.activity-agent` | `10px` | `var(--fs-xs)` |
| `tree.css:35` | `.tree-indent` | `14px` | `var(--fs-base)` |
| `tree.css:43` | `.tree-toggle` | `13px` | `var(--fs-sm)` |
| `tree.css:62` | `.tree-label` | `14px` | `var(--fs-base)` |
| `tree.css:69` | `.tree-agent` | `12px` | `var(--fs-sm)` |
| `tree.css:75` | `.tree-age` | `12px` | `var(--fs-sm)` |
| `tree.css:82` | `.tree-child-count` | `11px` | `var(--fs-sm)` |
| `chat-pane.css:16` | `.chat-header` | `12px` | `var(--fs-sm)` |
| `chat-pane.css:50` | `.chat-msg-role` | `10px` | `var(--fs-xs)` |
| `chat-pane.css:62` | `.chat-msg-time` | `9px` | `var(--fs-2xs)` |
| `chat-pane.css:73` | `.chat-msg-content` | `12px` | `var(--fs-sm)` |
| `chat-pane.css:117` | `.chat-input` | `12px` | `var(--fs-sm)` |
| `chat-pane.css:204-207` | `.chat-msg-content h1-h6` | `13-16px` | `var(--fs-base)` to `var(--fs-lg)` |
| `chat-pane.css:227,231` | `.chat-msg-content pre, code` | `11px` | `var(--fs-sm)` |
| `chat-pane.css:291` | `.chat-tool-use-header` | `11px` | `var(--fs-sm)` |
| `chat-pane.css:298` | `.chat-tool-use-body` | `10px` | `var(--fs-xs)` |
| `chat-pane.css:308` | `.chat-tool-result-content` | `10px` | `var(--fs-xs)` |

**Step 3 — Update container query breakpoints** in `agents.css:61-66`, `cron.css:57-71`, `system.css:29-35` to use the new variables instead of hardcoded smaller values.

---

## Task 4: Fix System Status panel (shows nothing)
**Complexity:** Small-Medium
**Root cause:** `routes/config.js:8` reads `~/.openclaw/config/source-of-truth.json5` which doesn't exist. Returns `{}`. Additionally, `app.js:146` uses `Promise.all` for 8 endpoints — if ANY fails, no panels render.

**Fix A — Config route (`routes/config.js:7-9`):**
Use `getGatewayConfig()` from `lib/helpers.js` instead of `safeJSON5(source-of-truth.json5)`. `getGatewayConfig()` already tries `openclaw.json` primary with `source-of-truth.json5` fallback.
```js
// routes/config.js line 7-9, replace:
const config = safeJSON5(path.join(OPENCLAW_HOME, 'config', 'source-of-truth.json5'));
// with:
const { getGatewayConfig } = require('../lib/helpers');
const config = getGatewayConfig();
```

**Fix B — Resilient fetchAll (`public/app.js:146-170`):**
Replace `Promise.all` with `Promise.allSettled` so individual endpoint failures don't blank every panel. Each panel renders with whatever data is available, showing a "—" or "unavailable" state for failed endpoints.

---

## Task 5: Agent turn labels ("assistant" → "Ren" / model alias)
**Complexity:** Small
**Root cause:** `public/chat-message.js:130` uses `role` (always "assistant") as display text. `ChatState.currentSession` has `agentId` and `label` but they're never consulted.

**Fix in `public/chat-message.js`:**

For `renderHistoryMessage` (line 128-131):
```js
// Replace: roleSpan.textContent = role;
// With:
if (role === 'assistant') {
  const session = window.ChatState?.currentSession;
  roleSpan.textContent = session?.label || session?.agentId || 'assistant';
} else {
  roleSpan.textContent = role;
}
```

For `createAssistantStreamEl` (line 175):
```js
// Replace: roleSpan.textContent = 'assistant';
// With:
const session = window.ChatState?.currentSession;
roleSpan.textContent = session?.label || session?.agentId || 'assistant';
```

---

## Task 6: Spawn modal — subagent always called "codex"
**Complexity:** Small
**Root cause:** When no label is entered in the spawn modal, the session key segment (derived from model ID like `gpt-5.3-codex`) becomes the display name. The alias is visible in the dropdown but never auto-populated as the label.

**Fix in `public/panels/spawn.js`:**

Auto-populate the label field when the user selects a model, if the label is empty:
```js
// After the model <select> change event:
$('#spawn-model').addEventListener('change', function() {
  const labelField = $('#spawn-label');
  if (!labelField.value.trim()) {
    labelField.value = this.selectedOptions[0]?.text || '';
  }
});
```

Also in `routes/spawn.js:78-86`, if no label is provided, derive one from the model alias:
```js
// Fallback: if no label, use the alias from the model list
const label = req.body.label || resolveAliasFromModel(req.body.model) || undefined;
```

---

## Task 7: Copy buttons on all output types
**Complexity:** Medium
**Root cause:** Only fenced code blocks in markdown have copy buttons (already implemented in `chat-markdown.js`). Tool use inputs, tool results, bash output, and full assistant messages have no copy functionality.

**Files to modify:**

### 7a: Copy button on full assistant message
- `public/chat-message.js` — add a copy button to each `.chat-msg.assistant` div (appears on hover, top-right)
- Reuse clipboard pattern from `chat-markdown.js:122-140`
- Copy source: `ChatMessage.extractText(msg)` (already exists) for history messages; for streaming, grab `contentEl.textContent`
- CSS: add `.chat-msg-copy-btn` styles to `chat-pane.css` (position absolute, top-right, same pattern as `.code-copy-btn`)

### 7b: Copy button on tool use blocks
- `public/chat-tool-blocks.js:20-48` — add a copy button to `.chat-tool-use-body`
- Content to copy: `JSON.stringify(block.input, null, 2)`
- Positioned top-right of the tool-use body

### 7c: Copy button on tool result blocks
- `public/chat-tool-blocks.js:50-87` — add a copy button to `.chat-tool-result-content`
- Content to copy: the raw text content of the result
- Also wrap tool result content in `<pre>` styling for code-like appearance

### 7d: Format tool results/bash output as code blocks
- `public/chat-tool-blocks.js` — wrap `.chat-tool-result-content` text in a `.code-block-wrapper` with the same styling as markdown fenced code blocks
- Detect tool name — if it's `Bash`, `bash`, `execute_command`, etc., add a language label "bash"
- Apply `var(--bg-code)` background, mono font, same padding as `.chat-msg-content pre`

---

## Task 8: Export session to markdown / copy entire turn
**Complexity:** Medium

### 8a: Cache raw messages in ChatState
- `public/chat-pane.js` — add `ChatState.currentMessages = []`
- `public/chat-ws-handler.js:103-106` — in `handleHistoryResult`, cache the raw `messages` array: `ChatState.currentMessages = data.messages`
- On new streaming messages, push to `ChatState.currentMessages` as they finalize

### 8b: Per-turn copy button
- Part of Task 7a above — the copy button on assistant messages

### 8c: Export session button
- `public/index.html` — add an export button in `.chat-header` (next to `+ NEW`)
- `public/chat-pane.js` or new `public/chat-export.js` — export function:
  1. Build markdown from `ChatState.currentMessages`:
     - Frontmatter: agent, session, date
     - Each message: `## Role` header, content as markdown, tool calls as fenced code blocks
  2. Trigger download via `URL.createObjectURL(new Blob([md], {type:'text/markdown'}))` + temp `<a download>`
- Button text: "EXPORT" or a download icon

---

## Task 9: File/image attachment support
**Complexity:** Medium-Large (3 layers)
**Root cause:** Gateway has full attachment support (`chat.send` accepts `attachments[]` with base64 content, MIME sniffing, 5MB cap). HUD passes nothing through.

### 9a: Frontend — file input UI
- `public/index.html` — add a hidden `<input type="file" id="chat-file-input" accept="image/*" multiple>` near chat input
- `public/chat-input.js` — add:
  - Paperclip/attach button next to send button that triggers file input
  - `paste` event handler on textarea for clipboard images
  - `dragover`/`drop` handlers on chat input area for drag-and-drop
  - `FileReader.readAsDataURL()` to convert to base64
  - Preview thumbnails above the textarea for queued attachments
  - Store pending attachments in an array

### 9b: Backend — pass attachments through
- `ws/chat-handlers.js:56` — extract `attachments` from incoming WS message, include in `gatewayWS.request('chat.send', { sessionKey, message, attachments, idempotencyKey })`

### 9c: Frontend — render received images
- `public/chat-message.js` — detect `image` content blocks in messages and render as `<img>` tags
- Note: gateway's `chat.history` returns `{ type: 'image', omitted: true, bytes }` (data stripped for bandwidth). For history, show a placeholder with size info. For live messages, the image may be available.

---

## Task 10: Slash command system (full TUI parity)
**Complexity:** Large (biggest task)
**Root cause:** HUD has zero slash command handling. Text goes straight to `chat.send`. TUI has a full command registry with 30+ commands, autocomplete, argument discovery, and local dispatch.

### 10a: Port command registry
- New file `public/chat-commands.js`:
  - Static array of command definitions (ported from `openclaw/src/auto-reply/commands-registry.data.ts`)
  - Each entry: `{ name, aliases[], description, args[], category }`
  - Args: `{ name, type, required, choices[] }`
  - ~30 commands total

### 10b: Autocomplete UI
- `public/chat-input.js` — detect `/` as first character, show dropdown:
  - Filter commands by prefix as user types
  - Show command name + description in dropdown
  - On Tab/Enter, complete the command name
  - After command name + space, show argument choices if defined
  - Arrow keys to navigate, Escape to dismiss
- New CSS in `chat-pane.css` for `.slash-autocomplete` dropdown (positioned above the textarea, dark theme, monospace)

### 10c: Local slash command dispatch
- `public/chat-input.js` — before sending via `chat-send`, check if input starts with `/`
  - **TUI-local commands** (handled client-side):
    - `/help` — render command list into chat area
    - `/abort` — send `{ type: 'chat-abort' }` over WS
    - `/new`, `/reset` — send `{ type: 'chat-new' }` over WS
    - `/model <name>` — send `sessions.patch` to change model
    - `/think <level>` — send `sessions.patch` to change thinking level
    - `/verbose <mode>` — send `sessions.patch`
    - `/status` — render current session info into chat area
    - `/models` — fetch and display available models
  - **Gateway commands** — send as regular `chat-send` (gateway's auto-reply handles them)

### 10d: `sessions.patch` WS handler
- `ws/chat-handlers.js` — add handler for `sessions-patch` message type:
  ```js
  case 'sessions-patch':
    const result = await gatewayWS.request('sessions.patch', { sessionKey, ...msg.patch });
    ws.send(JSON.stringify({ type: 'sessions-patch-result', ...result }));
  ```

### 10e: `/help` rendering
- Intercept `/help` in `chat-input.js`, render a formatted command reference into `#chat-messages`
- Group by category (session, options, status, management, media, tools)
- Show command name, aliases, description, and available arguments

---

## Task Dependency Graph

```
Task 1 (remove text)          — independent, do first
Task 2 (input scrollbar)      — independent, do first
Task 3 (font sizes)           — independent, do anytime
Task 4 (system status)        — independent, do anytime
Task 5 (agent labels)         — independent, do anytime
Task 6 (spawn naming)         — independent, do anytime
Task 7 (copy buttons)         — do before Task 8
Task 8 (export/copy turn)     — depends on Task 7a (message copy pattern)
Task 9 (file attachments)     — independent, do anytime
Task 10 (slash commands)      — independent, biggest task, parallelize sub-parts
```

Tasks 1-6 are all independent and can be done in parallel.
Tasks 7-8 have a dependency (7a pattern needed for 8).
Tasks 9 and 10 are independent of everything else.

---

## Suggested Execution Order

**Wave 1 (quick wins, parallel):** Tasks 1, 2, 4, 5, 6
**Wave 2 (medium, parallel):** Tasks 3, 7
**Wave 3 (medium, sequential):** Task 8 (after 7)
**Wave 4 (large, parallel):** Tasks 9, 10 (can be parallelized internally — 10a-10e can be split across agents)

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenClaw HUD is a cyberpunk-themed local dashboard for monitoring OpenClaw AI agents. It reads data from `~/.openclaw/` (overridable via `OPENCLAW_HOME` env var) and displays agents, sessions, cron jobs, model usage, and system status in real-time. No authentication, no external databases — read-only local dashboard.

## Commands

```bash
npm start              # Start server on localhost:3777
npm test               # Run unit tests (vitest)
npm run test:watch     # Run tests in watch mode
npx vitest run tests/routes/agents.test.js  # Run a single test file
npm run test:e2e       # Run Playwright E2E tests (launches server on port 3779)
npm run test:e2e:ui    # Run E2E tests with Playwright UI
npm run vendor:sync    # Download CDN deps (marked, dompurify) to public/vendor/
npm run bundle:analyze # Analyze frontend bundle sizes
```

## Architecture

### Backend (Node.js + Express)

- **`server.js`** — Entry point. Creates Express app + HTTP server + WebSocket server. Mounts routes, initializes `GatewayWS` client, sets up tick broadcasts every 10s.
- **`lib/helpers.js`** — Shared utilities for reading OpenClaw data files. `OPENCLAW_HOME` is resolved here. Has `safeRead`, `safeJSON`, `safeJSON5`, `stripSecrets` (filters API keys/tokens from config objects), `getSessionStatus`.
- **`lib/gateway-ws.js`** — `GatewayWS` class: WebSocket client that connects to the OpenClaw gateway (default port 18789). Implements challenge-based auth handshake, request/response with UUID tracking, auto-reconnect with exponential backoff + jitter, and event routing (`chat-event`, `tick`, `agent-event`, `shutdown`).
- **`routes/`** — Express routers, each mounted at `/api/*`:
  - `agents.js` → `/api/agents` — Lists agents from disk
  - `sessions.js` → `/api/sessions`, `/api/session-log/:agentId/:sessionId`, `/api/session-tree`
  - `config.js` → `/api/config`, `/api/models`, `/api/model-usage`
  - `cron.js` → `/api/cron`
  - `spawn.js` → `/api/spawn` (POST) — Spawns sessions via gateway
  - `activity.js` → `/api/activity`
  - `health.js` → `/api/health`
- **`ws/log-streaming.js`** — WebSocket handler for real-time session log streaming. Uses `fs.watch` to tail JSONL files. Manages per-client subscriptions (max 5), auto-unsubscribes old ones.
- **`ws/chat-handlers.js`** — WebSocket handler for chat functionality: subscribe/unsubscribe to sessions, send messages via gateway, fetch history (gateway-first with local JSONL fallback), abort, spawn new sessions, list models.

### Frontend (Vanilla JS, zero deps)

All frontend code is in `public/`. No build step — served directly by Express static middleware.

- **`index.html`** — Single page with all panel markup. Loads scripts at bottom.
- **`app.js`** — Entry point. Initializes panels, runs `fetchAll()` to hydrate UI, sets up WebSocket for tick-based refresh, falls back to 15s polling.
- **`public/panels/`** — One JS file per dashboard panel (`agents.js`, `sessions.js`, `cron.js`, `system.js`, `models.js`, `activity.js`, `spawn.js`, `session-tree.js`). Each registers on the global `HUD` namespace (e.g., `HUD.agents.render(data)`).
- **Null-safe panel rendering:** All panel `render(data)` methods guard against null/non-array input with `Array.isArray` checks before DOM access.
- **`public/chat-*.js`** — Chat pane modules: `chat-pane.js` (pane open/close), `chat-messages.js` (message list rendering), `chat-message.js` (single message), `chat-markdown.js` (markdown rendering via marked + DOMPurify), `chat-tool-blocks.js` (tool use/result rendering), `chat-progressive-render.js` (streaming render), `chat-ws-handler.js` (WebSocket message routing), `chat-ws-batcher.js` (batches rapid WS messages), `chat-input.js` (input box).
- **`public/styles/`** — CSS split per component. `main.css` imports others via `@import`. `base.css` has CSS variables and the cyberpunk theme.
- **`public/vendor/`** — Vendored `marked.min.js` and `purify.min.js`.
- **`public/a11y/`** — Accessibility utilities: `announcer.js` (screen reader announcements), `focus-trap.js` (modal focus trapping).

### Data Flow

1. All data reads go through `lib/helpers.js` which reads from `OPENCLAW_HOME` (default `~/.openclaw/`)
2. Routes read data from disk and return JSON
3. Frontend fetches all APIs on load, then refreshes on WebSocket ticks (or 15s polling fallback)
4. Chat messages route through gateway WS when connected, with local JSONL file fallback for history

### Global Frontend Pattern

Panels use a `HUD` global namespace (set on `window`). Each panel file adds itself: `window.HUD = window.HUD || {}; HUD.agents = { render(data) {...}, init() {...} }`. The `openChatPane(agentId, sessionId, label)` function is also global.

## Testing

- **Unit tests** (`tests/`): Vitest with jsdom environment for frontend tests. Mirror the source structure (`tests/routes/`, `tests/public/`, `tests/lib/`, `tests/ws/`, `tests/a11y/`).
- **E2E tests** (`e2e/`): Playwright (Chromium only). Uses fixture data at `e2e/fixtures/openclaw-home/` with `OPENCLAW_HOME` env override. Global setup at `e2e/fixtures/generate-timestamps.js` writes fresh timestamps into fixture files so session data appears recent.
- E2E server runs on port **3779** (not the default 3777).

## Key Conventions

- CommonJS (`require`/`module.exports`) throughout — no ESM except vitest config
- Input validation uses regex `/^[a-zA-Z0-9_-]+$/` for agentId/sessionId parameters
- `stripSecrets()` removes sensitive config keys before sending to frontend
- Config files use JSON5 format (parsed via `json5` package)
- Session status is derived from age: active (<5min), warm (<1hr), stale (>1hr), completed (subagent >5min)
- Panel `render` methods must defensively handle null/invalid payloads by treating non-array inputs as empty arrays, while preserving validation for real items.

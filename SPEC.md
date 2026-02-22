# OpenClaw HUD — Full Spec

## Overview
Build a local-only web dashboard ("HUD") for OpenClaw — a real-time heads-up display showing all agents, sessions, cron jobs, and system status. Think cyberpunk hacker terminal meets mission control. This runs on `localhost` and reads local data files directly.

## Tech Stack
- **Frontend:** Single-page app. HTML/CSS/JS. You may use React, Vue, Svelte, or vanilla — your choice. Must look stunning.
- **Backend:** Node.js (Express or Fastify) or Python (FastAPI/Flask). Serves the frontend + API endpoints that read OpenClaw data files.
- **No external databases.** All data comes from local JSON/JSONL files on disk.

## Design Direction
**Cyberpunk hacker HUD.** Think: dark backgrounds, neon accents (cyan, magenta, amber), scanline effects, monospace fonts mixed with sleek sans-serif, glowing borders, terminal-style animations. NOT generic Bootstrap/Tailwind dashboard. This should feel like you're piloting a fleet of AI agents from a command center.

**Must be visually distinctive and memorable.** Apply the Frontend Design skill guidelines — bold aesthetic choices, unexpected layouts, atmospheric backgrounds, creative typography. No AI slop.

## Data Sources

All data lives under `~/.openclaw/` (use environment variable `OPENCLAW_HOME` with fallback to `~/.openclaw`).

### 1. Agents
- **Agent list:** Read from `~/.openclaw/config/source-of-truth.json5` → `agents.list[]` array. Each has `id` field.
- **Agent directories:** `~/.openclaw/agents/<id>/` — one folder per agent.
- **Display:** Show all agents as cards/tiles with their ID, status indicator, and any active sessions.

### 2. Sessions
- **Session index:** `~/.openclaw/agents/<agentId>/sessions/sessions.json` — JSON object where keys are session keys and values contain:
  - `sessionId`, `updatedAt` (unix ms), `label`, `spawnedBy`, `spawnDepth`, `lastChannel`, `groupChannel`
- **Session logs:** `~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl` — newline-delimited JSON. Each line has:
  - `type`: "session", "model_change", "thinking_level_change", "message", "tool_use", "tool_result", "summary", etc.
  - `timestamp`: ISO 8601
  - `role`: "user", "assistant", "system" (for messages)
  - Messages have `content` field (text or array)
  - Tool uses have `name`, `input` fields
- **Display:** Active sessions panel. Show session key, label, age, last activity, parent agent, spawn depth. Clicking a session shows its message log.

### 3. Cron Jobs
- **Jobs file:** `~/.openclaw/cron/jobs.json` — structure:
  ```json
  {
    "version": 1,
    "jobs": [
      {
        "id": "uuid",
        "agentId": "main",
        "name": "heartbeat",
        "enabled": true,
        "schedule": { "kind": "cron", "expr": "0 0,2,4,6,22 * * *", "tz": "America/Chicago" },
        "sessionTarget": "main|isolated",
        "payload": { "kind": "systemEvent|agentTurn", "text": "...", "model": "..." },
        "state": {
          "nextRunAtMs": 1771819200000,
          "lastRunAtMs": 1771761600029,
          "lastStatus": "completed|error|skipped",
          "lastDurationMs": 10,
          "consecutiveErrors": 0,
          "lastError": "string or null"
        }
      }
    ]
  }
  ```
- **Run history:** `~/.openclaw/cron/runs/<jobId>/` directory with run log files.
- **Display:** Cron dashboard showing all jobs, their schedule, last run status, next run time, error count. Color-code: green=healthy, red=erroring, yellow=skipped/disabled.

### 4. System Status
- **Config:** `~/.openclaw/config/source-of-truth.json5` — parse as JSON5 (strip comments). Contains:
  - `agents.defaults.model.primary` — default model
  - `agents.defaults.maxConcurrent` — concurrency limit
  - `agents.defaults.subagents` — spawn depth, max children
  - `channels.discord` — channel config
  - `gateway.port`, `gateway.mode`, `gateway.bind`
- **Display:** System info panel showing gateway port, mode, default model, concurrency limits, channel status.

### 5. Model Usage (from session logs)
- Parse JSONL session logs for `type: "model_change"` events to track which models are in use.
- Count messages per model, per agent.
- **Display:** Model usage breakdown — which agents used which models, message counts, a visual chart or graph.

## Layout

Design a single-page dashboard with these panels (layout is your creative choice — grid, asymmetric, floating panels, whatever fits the aesthetic):

1. **Agent Fleet** — Overview of all agents with status
2. **Active Sessions** — Live sessions with activity indicators
3. **Cron Control** — All cron jobs with status/schedule
4. **System Status** — Gateway info, config, limits
5. **Model Usage** — Charts/visual breakdown of model usage across agents
6. **Activity Feed** — Recent events across all agents (parsed from session logs)

## Requirements

1. Must start with a single command (e.g., `npm start`, `python app.py`, or similar)
2. Must auto-refresh or poll for updates (every 5-30 seconds)
3. Must handle missing/empty data gracefully (no crashes if an agent has no sessions)
4. Must be responsive (work on different screen sizes)
5. Must include a README with setup instructions
6. Code must be clean, well-organized, and production-grade
7. Include at least basic error handling

## Bonus Points
- Real-time WebSocket updates instead of polling
- Animations on data changes (new sessions appearing, status changes)
- Click-to-expand session logs
- Searchable/filterable agent list
- Sound effects or visual alerts for errors

## What NOT to Build
- No authentication (local only)
- No write operations (read-only dashboard)
- No external API calls
- No Docker/containerization needed

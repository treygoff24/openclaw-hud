# 🔮 OpenClaw HUD — Kimi K2.5 Edition

A cyberpunk command center dashboard for OpenClaw. Real-time monitoring of agents, sessions, cron jobs, model usage, and system status.

![Cyberpunk HUD](https://img.shields.io/badge/theme-cyberpunk-00e5ff?style=for-the-badge)

## Quick Start

```bash
npm install && npm start
```

Then open **http://localhost:3777**

## Features

- **Agent Fleet** — All agents with status indicators and session counts
- **Active Sessions** — Real-time session list with click-to-view logs
- **Cron Control** — All cron jobs with color-coded status (green/red/amber)
- **System Status** — Gateway info, model config, concurrency limits
- **Model Usage** — Visual bar chart of model usage across agents
- **Activity Feed** — Live event stream from all agent sessions
- **WebSocket** — Real-time push updates
- **Searchable** — Filter agents instantly
- **Session Log Viewer** — Click any session to read its message log
- **Responsive** — Works on any screen size

## Tech Stack

- **Backend:** Node.js + Express + WebSocket
- **Frontend:** Vanilla HTML/CSS/JS (zero dependencies)
- **Fonts:** Orbitron (display), Share Tech Mono (code), Rajdhani (body)
- **Data:** Reads directly from `~/.openclaw/` local files

## Design

Cyberpunk hacker HUD aesthetic with:
- Scanline overlay effect
- Noise texture background
- Neon glow borders (cyan, magenta, amber)
- Staggered panel animations
- Glitch text effects on hover
- Corner bracket decorations
- Color-coded status indicators

Built by Kimi K2.5 🏆

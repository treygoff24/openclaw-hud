# OpenClaw HUD V2 — Implementation Plan

> **Base**: Kimi K2.5 codebase (port 3778)
> **Goal**: Incorporate the best elements from Qwen, GLM, and MiniMax into the winning Kimi base
> **Status**: PLAN ONLY — Do not implement until reviewed

---

## Phase 1: File Restructuring
**Complexity**: Low (30 min)
**Risk**: Low

Split the monolithic `public/index.html` (843 lines) into three files:

### 1.1 Create `public/style.css`
- Extract everything inside `<style>...</style>` (lines ~12–370) into `public/style.css`
- All CSS custom properties (`:root`), all component styles, all animations, all responsive rules

### 1.2 Create `public/app.js`
- Extract everything inside `<script>...</script>` (lines ~620–840) into `public/app.js`
- All state management, rendering functions, fetch calls, WebSocket, modal handlers, clock

### 1.3 Slim down `public/index.html`
- Keep only the HTML structure
- Add `<link rel="stylesheet" href="style.css">` in `<head>`
- Add `<script src="app.js"></script>` before `</body>`
- Keep the Google Fonts link

### Verification
- Load `http://localhost:3778` — should look identical to before

---

## Phase 2: Font Size Overhaul — "Make ALL Text Bigger"
**Complexity**: Low (20 min)
**Risk**: Low

Trey says everything is too small. Increase all font sizes across the board.

### 2.1 Base font size
```css
/* BEFORE */ html, body { /* no explicit font-size, defaults ~16px */ }
/* AFTER */  html { font-size: 16px; }
```

### 2.2 Specific size increases (in `style.css`)

| Element | Current | New |
|---------|---------|-----|
| `.hud-logo` | 20px | 26px |
| `.hud-subtitle` | 11px | 13px |
| `.hud-time` | 14px | 18px |
| `.panel-header` font-size | 11px | 13px |
| `.panel-header .count` | 12px | 14px |
| `.agent-id` | 13px | 15px |
| `.agent-sessions-count` | 11px | 13px |
| `.session-row` font-size | 13px | 15px |
| `.session-agent` | 11px | 13px |
| `.session-age` | 11px | 13px |
| `.cron-row` font-size | 13px | 15px |
| `.cron-schedule` | 11px | 13px |
| `.cron-next` | 11px | 13px |
| `.sys-label` | 10px | 12px |
| `.sys-value` | 13px | 15px |
| `.model-bar-label` font-size | 11px | 13px |
| `.activity-item` font-size | 12px | 14px |
| `.activity-time` | 10px | 12px |
| `.activity-type` | 10px | 12px |
| `.activity-content` | (inherit 12px) | 14px |
| `.search-box` | 12px | 14px |
| `#sys-model` (header model display) | (inherit ~11px) | 14px |

### 2.3 Panel body padding increase
```css
.panel-body { padding: 14px 18px; } /* was 12px 16px */
```

---

## Phase 3: Steal the Qwen Logo
**Complexity**: Low (15 min)
**Risk**: Low

### What Qwen has
Qwen uses a glitch-animated `OPENCLAW` text logo with `::before` and `::after` pseudo-elements that create a red/amber glitch flicker effect using `clip-path: inset()` and `translateX` animations.

### What to do
Replace Kimi's `.hud-logo` in the header-left with Qwen's approach:

**HTML change** (in header):
```html
<!-- BEFORE -->
<div class="hud-logo glitch-hover">OPEN<span>CLAW</span> HUD</div>

<!-- AFTER -->
<div class="logo-glitch" data-text="OPENCLAW">OPENCLAW</div>
```

**CSS to add** (steal from Qwen's `style.css`):
```css
.logo-glitch {
  font-family: var(--font-display);
  font-weight: 900;
  font-size: 1.8rem;  /* bigger than Qwen's 1.6rem for readability */
  letter-spacing: 0.15em;
  color: var(--cyan);
  text-shadow: 0 0 20px rgba(0,229,255,0.4), 0 0 40px rgba(0,229,255,0.1);
  position: relative;
}
.logo-glitch::before,
.logo-glitch::after {
  content: attr(data-text);
  position: absolute; left: 0; top: 0;
  width: 100%; height: 100%;
  overflow: hidden;
}
.logo-glitch::before {
  color: var(--magenta);
  animation: glitch1 3s infinite;
  clip-path: inset(0 0 65% 0);
}
.logo-glitch::after {
  color: var(--amber);
  animation: glitch2 3s infinite;
  clip-path: inset(65% 0 0 0);
}
@keyframes glitch1 {
  0%, 95%, 100% { transform: translateX(0); }
  96% { transform: translateX(-3px); }
  97% { transform: translateX(3px); }
}
@keyframes glitch2 {
  0%, 93%, 100% { transform: translateX(0); }
  94% { transform: translateX(4px); }
  95% { transform: translateX(-2px); }
}
```

**Remove**: `.glitch-hover` and its `@keyframes glitch` (replaced by the always-on subtle glitch).

---

## Phase 4: Steal MiniMax Top Summary Bar
**Complexity**: Low-Medium (20 min)
**Risk**: Low

### What MiniMax has
In the header-right, three `stat-block` elements showing:
- **AGENTS**: total count
- **ACTIVE**: active count (neon cyan)
- **UPTIME**: HH:MM:SS counter since page load

### What to do

**HTML**: Add to header-right area (keep existing model display, add summary stats):
```html
<div class="header-right">
  <div class="stat-block">
    <span class="stat-label">AGENTS</span>
    <span class="stat-value" id="stat-agents">—</span>
  </div>
  <div class="stat-block">
    <span class="stat-label">ACTIVE</span>
    <span class="stat-value neon-cyan" id="stat-active">—</span>
  </div>
  <div class="stat-block">
    <span class="stat-label">UPTIME</span>
    <span class="stat-value" id="stat-uptime">—</span>
  </div>
  <div class="header-divider"></div>
  <div style="text-align:right;">
    <div class="hud-time"><span class="hud-status-dot"></span><span id="clock"></span></div>
    <div class="hud-subtitle" id="sys-model" style="margin-top:4px;"></div>
  </div>
</div>
```

**CSS to add** (adapted from MiniMax):
```css
.header-right { display: flex; align-items: center; gap: 24px; }
.stat-block { text-align: center; }
.stat-label {
  display: block;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 3px;
  color: var(--text-dim);
  margin-bottom: 2px;
}
.stat-value {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
}
.stat-value.neon-cyan {
  color: var(--cyan);
  text-shadow: 0 0 10px rgba(0,229,255,0.3);
}
.header-divider {
  width: 1px;
  height: 32px;
  background: var(--border-dim);
}
```

**JS to add**:
```javascript
// Uptime counter
const pageStartTime = Date.now();
function updateUptime() {
  const diff = Date.now() - pageStartTime;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  document.getElementById('stat-uptime').textContent =
    `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
setInterval(updateUptime, 1000);

// In fetchAll/renderAgents, update:
// document.getElementById('stat-agents').textContent = agents.length;
// document.getElementById('stat-active').textContent = agents.filter(a => isActive(a)).length;
```

---

## Phase 5: Steal GLM Animated Status Lights
**Complexity**: Low (20 min)
**Risk**: Low

### What GLM has
Pulsing/blinking colored dots for status indicators:
- Green pulsing dot for active/healthy (`@keyframes pulse-dot` with opacity 1→0.4 and scale 1→0.7)
- Red blinking dot for errors (`@keyframes blink-red` with opacity flash at 50%)
- Amber steady dot for warnings
- Gray dot for disabled/dormant

### What to do

Kimi already has a basic `pulse-dot` animation, but it only applies to the header dot. Extend it to ALL status indicators.

**CSS changes**:

```css
/* GLM-style animated status dots — universal */
.status-dot-green {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--green);
  box-shadow: 0 0 6px var(--green);
  animation: pulse-dot 2s ease-in-out infinite;
}
.status-dot-amber {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--amber);
  box-shadow: 0 0 6px var(--amber);
  animation: pulse-dot 2s ease-in-out infinite;
}
.status-dot-red {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--red);
  box-shadow: 0 0 6px var(--red);
  animation: blink-red 1s infinite;
}
.status-dot-gray {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--text-dim);
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.7); }
}
@keyframes blink-red {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
```

**Apply to**:
1. **Agent cards** (`.agent-dot`): Use `status-dot-green` for active, `status-dot-gray` for idle
2. **Cron status dots** (`.cron-status`): Use `status-dot-green` for healthy, `status-dot-red` for error, `status-dot-amber` for skipped, `status-dot-gray` for disabled
3. **Session rows**: Add a status dot showing session recency (green = <10min, amber = <1h, gray = older)
4. **Header status dot**: Already pulsing, keep as-is

**JS changes**: In `renderAgents`, `renderCron`, `renderSessions` — use the new status-dot classes.

---

## Phase 6: Steal Qwen's System Status Panel
**Complexity**: Medium (30 min)
**Risk**: Medium (needs server-side API changes)

### What Qwen has that Kimi doesn't
Qwen's `/api/system` endpoint returns more data:
- `gateway.bind`
- `channels` (list)
- `modelAliases` (from `agents.defaults.models`)
- `providers` (from `models.providers`)

Qwen renders MODEL ALIASES as a sub-section below the main system rows.

### Server-side changes (`server.js`)

Update `/api/config` to also return:
```javascript
app.get('/api/config', (req, res) => {
  const config = safeJSON5(path.join(OPENCLAW_HOME, 'config', 'source-of-truth.json5'));
  if (!config) return res.json({});
  const defaults = config.agents?.defaults || {};
  const gateway = config.gateway || {};
  const channels = config.channels || {};
  const models = config.models || {};

  res.json({
    defaultModel: defaults.model?.primary || 'unknown',
    maxConcurrent: defaults.maxConcurrent,
    subagents: defaults.subagents,
    gateway: { port: gateway.port, mode: gateway.mode, bind: gateway.bind },
    channels: Object.keys(channels),
    models: defaults.models || {},
    modelAliases: defaults.models || {},      // ADD
    providers: Object.keys(models.providers || {}),  // ADD
    agentCount: /* count from agents dir */,   // ADD
    meta: config.meta
  });
});
```

### Frontend changes

In `renderSystem()`, add more rows:
```javascript
const items = [
  ['DEFAULT MODEL', config.defaultModel || '—'],
  ['GATEWAY PORT', config.gateway?.port || '—'],
  ['GATEWAY MODE', config.gateway?.mode || '—'],
  ['GATEWAY BIND', config.gateway?.bind || '—'],       // NEW
  ['MAX CONCURRENT', config.maxConcurrent || '—'],
  ['SPAWN DEPTH', config.subagents?.maxSpawnDepth || '—'],
  ['MAX CHILDREN', config.subagents?.maxChildren || '—'],
  ['CHANNELS', (config.channels || []).join(', ') || '—'],
  ['PROVIDERS', (config.providers || []).join(', ') || '—'],  // NEW
];
```

Add model aliases sub-section (from Qwen):
```javascript
// After main rows, if modelAliases exist:
const aliases = config.modelAliases || {};
const aliasHtml = Object.entries(aliases).map(([model, cfg]) =>
  `<div class="sys-row"><span class="sys-label">${cfg.alias || '?'}</span><span class="sys-value" style="font-size:12px">${model}</span></div>`
).join('');
if (aliasHtml) {
  html += `<div class="sys-row" style="border-top:1px solid var(--border-dim);margin-top:8px;padding-top:8px;">
    <span class="sys-label" style="color:var(--magenta)">MODEL ALIASES</span></div>${aliasHtml}`;
}
```

---

## Phase 7: Steal Qwen's Model Stats Panel
**Complexity**: Medium (25 min)
**Risk**: Low

### What Qwen has
- Gradient-colored bar fills (cyan→green, magenta→amber, etc.) instead of solid colors
- Shows `byAgent` breakdown below each bar (e.g., `codex:12 · kimi:5`)
- Display says "X msgs" instead of just a number
- Alternating color classes: `.alt1`, `.alt2`, `.alt3`

### Server-side changes

No structural server change needed — Kimi already returns `agents` per model in the model-usage endpoint. However, the sampling needs improvement (see Phase 9.3 — increase from 5 to 10 files, add proper `model_change` tracking).

### Frontend changes

Replace `renderModelUsage()`:
```javascript
function renderModelUsage(usage) {
  const entries = Object.entries(usage).sort((a,b) => b[1].total - a[1].total);
  const max = entries[0]?.[1]?.total || 1;
  const colorClasses = ['', 'alt1', 'alt2', 'alt3'];

  $('#model-usage').innerHTML = entries.map(([model, data], i) => {
    const pct = Math.round((data.total / max) * 100);
    const shortName = model.split('/').pop();
    const colorClass = colorClasses[i % colorClasses.length];
    const agentBreakdown = Object.entries(data.agents || {})
      .sort((a,b) => b[1] - a[1])
      .map(([a, c]) => `${a}:${c}`)
      .join(' · ');

    return `<div class="model-bar-row">
      <div class="model-bar-label"><span>${shortName}</span><span>${data.total} msgs</span></div>
      <div class="model-bar-track"><div class="model-bar-fill ${colorClass}" style="width:${pct}%"></div></div>
      <div class="model-agents">${agentBreakdown}</div>
    </div>`;
  }).join('') || '<div style="color:var(--text-dim);font-family:var(--font-mono);font-size:13px;">No model data yet</div>';
}
```

**CSS to add** (from Qwen):
```css
.model-bar-fill {
  background: linear-gradient(90deg, var(--cyan), var(--green));
  box-shadow: 0 0 8px var(--cyan);
}
.model-bar-fill.alt1 {
  background: linear-gradient(90deg, var(--magenta), var(--amber));
  box-shadow: 0 0 8px var(--magenta);
}
.model-bar-fill.alt2 {
  background: linear-gradient(90deg, var(--amber), var(--green));
  box-shadow: 0 0 8px var(--amber);
}
.model-bar-fill.alt3 {
  background: linear-gradient(90deg, var(--green), var(--cyan));
  box-shadow: 0 0 8px var(--green);
}
.model-agents {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-dim);
  margin-top: 3px;
}
```

---

## Phase 8: Enhanced Cron Job Rows
**Complexity**: Medium (30 min)
**Risk**: Medium (needs server-side changes)

### What Qwen has (steal)
- Shows `agentId` per cron job
- Shows schedule expression AND timezone
- Shows last status with color-coded text (COMPLETED/ERROR/SKIPPED)
- Shows `consecutiveErrors` count when > 0
- Shows both last run time and next run time

### What Trey wants added
- Show whether each job uses the **default model** or a **specific model override**, and which model

### Server-side changes

Update `/api/cron` to return richer data:
```javascript
app.get('/api/cron', (req, res) => {
  const jobs = safeJSON(path.join(OPENCLAW_HOME, 'cron', 'jobs.json'));
  const config = safeJSON5(path.join(OPENCLAW_HOME, 'config', 'source-of-truth.json5'));
  const defaultModel = config?.agents?.defaults?.model?.primary || 'unknown';

  const enrichedJobs = (jobs?.jobs || []).map(j => ({
    ...j,
    defaultModel,
    // model override is inside payload for agentTurn jobs
    modelOverride: j.payload?.model || j.model || null,
    usesDefaultModel: !(j.payload?.model || j.model),
  }));

  res.json({ version: jobs?.version || 1, jobs: enrichedJobs });
});
```

### Frontend changes

Redesign `renderCron()` for richer rows:
```javascript
function renderCron(data) {
  const jobs = data.jobs || [];
  $('#cron-count').textContent = jobs.length;
  $('#cron-list').innerHTML = jobs.map(j => {
    // Status dot class
    let dotClass = 'status-dot-gray';
    if (j.enabled && j.state?.lastStatus === 'completed') dotClass = 'status-dot-green';
    else if (j.state?.lastStatus === 'error') dotClass = 'status-dot-red';
    else if (j.state?.lastStatus === 'skipped') dotClass = 'status-dot-amber';
    else if (j.enabled) dotClass = 'status-dot-green';

    // Status text
    let statusText = j.state?.lastStatus || 'unknown';
    let statusColor = 'var(--text-dim)';
    if (statusText === 'completed') statusColor = 'var(--green)';
    else if (statusText === 'error') statusColor = 'var(--red)';
    else if (statusText === 'skipped') statusColor = 'var(--amber)';

    const lastRun = j.state?.lastRunAtMs ? timeAgo(j.state.lastRunAtMs) : 'never';
    const nextRun = j.state?.nextRunAtMs ? new Date(j.state.nextRunAtMs).toLocaleString() : '—';
    const errors = j.state?.consecutiveErrors > 0
      ? `<span style="color:var(--red)">errors: ${j.state.consecutiveErrors}</span>` : '';

    // Model info
    const modelInfo = j.usesDefaultModel
      ? `<span style="color:var(--text-dim)">default model</span>`
      : `<span style="color:var(--amber)">${j.modelOverride}</span>`;

    return `<div class="cron-row-v2">
      <div class="${dotClass}"></div>
      <div class="cron-main">
        <div class="cron-name">${j.name}
          <span class="cron-agent-tag">${j.agentId || ''}</span>
        </div>
        <div class="cron-meta">
          <span class="cron-schedule">${j.schedule?.expr || '?'} (${j.schedule?.tz || '?'})</span>
          <span class="cron-model-info">${modelInfo}</span>
        </div>
        <div class="cron-status-row">
          <span style="color:${statusColor}">${statusText.toUpperCase()}</span>
          <span style="color:var(--text-dim)">last: ${lastRun}</span>
          <span style="color:var(--text-dim)">next: ${nextRun}</span>
          ${errors}
        </div>
      </div>
    </div>`;
  }).join('');
}
```

**CSS to add**:
```css
.cron-row-v2 {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(26,30,53,0.5);
}
.cron-main { flex: 1; }
.cron-name {
  font-family: var(--font-mono);
  font-size: 15px;
  color: var(--text-primary);
  font-weight: 600;
}
.cron-agent-tag {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--magenta);
  margin-left: 8px;
  opacity: 0.7;
}
.cron-meta {
  display: flex;
  gap: 16px;
  margin-top: 4px;
  font-family: var(--font-mono);
  font-size: 12px;
}
.cron-model-info {
  font-family: var(--font-mono);
  font-size: 11px;
}
.cron-status-row {
  display: flex;
  gap: 12px;
  margin-top: 4px;
  font-family: var(--font-mono);
  font-size: 12px;
}
```

---

## Phase 9: Wire Up ALL Data Correctly
**Complexity**: High (45 min)
**Risk**: Medium

Audit every panel and ensure real data from `~/.openclaw/` is correctly displayed.

### 9.1 Agents Panel
- **Current issue**: Only shows sessions from `sessions.json`, no concept of "active" vs "total"
- **Fix**: Count sessions with `updatedAt` within last hour as "active" (like Qwen/MiniMax do)
- **Update server**: Already returns `sessions` array per agent — add `activeSessions` count
- **Update `renderAgents`**: Show "X live" badge when activeSessions > 0 (like Qwen)

### 9.2 Sessions Panel
- Already functional. Verify `spawnDepth`, `lastChannel`, `label` all display.
- Add spawn depth indicator for subagent sessions (from Qwen: `depth:N`)

### 9.3 Model Usage
- **Current issue**: Kimi samples only last 5 `.jsonl` files per agent. This can miss data.
- **Fix**: Increase to 10 (like Qwen) and sort by mtime
- **Fix**: Track `model_change` events to attribute assistant messages to the right model (Qwen does this correctly with `currentModel` tracking)

### 9.4 Activity Feed
- Working but verify timestamps render correctly
- Ensure `tool_use` events show the tool name prominently

### 9.5 Config/System
- Ensure `source-of-truth.json5` is parsed with JSON5 (already is)
- Verify all fields render: gateway port/mode/bind, default model, channels, providers

### Server-side changes for 9.1:
```javascript
// In /api/agents endpoint, add:
const activeSessions = sessionList.filter(s => s.updatedAt && (Date.now() - s.updatedAt) < 3600000).length;
return { id, sessions: sessionList, sessionCount: sessionList.length, activeSessions };
```

### Server-side changes for 9.3:
Update model-usage to sample 10 files and track model changes:
```javascript
// Change .slice(-5) to .slice(-10) and sort by mtime
const files = safeReaddir(sessDir)
  .filter(f => f.endsWith('.jsonl'))
  .map(f => ({ name: f, mtime: fs.statSync(path.join(sessDir, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime)
  .slice(0, 10);

// Track currentModel per file:
let currentModel = null;
for (const line of raw.split('\n').filter(Boolean)) {
  const e = JSON.parse(line);
  if (e.type === 'model_change' && (e.model || e.modelId)) {
    currentModel = e.modelId || e.model;
  }
  if (e.type === 'message' && (e.role === 'assistant' || e.message?.role === 'assistant')) {
    const model = currentModel || 'unknown';
    // ... count it
  }
}
```

---

## Phase 10: Polish & Integration Testing
**Complexity**: Low (20 min)
**Risk**: Low

### 10.1 Header layout
Ensure the header flows well with all new elements:
- **Left**: Qwen glitch logo + subtitle
- **Right**: MiniMax stat blocks (Agents/Active/Uptime) + divider + clock + model display

### 10.2 Remove old CSS
- Remove `.glitch-hover` and its `@keyframes glitch`
- Remove `.hud-logo` style (replaced by `.logo-glitch`)
- Remove `.hex-bg` element and style (visual noise, not needed)

### 10.3 Ensure WebSocket still works
- Verify `ws://localhost:3778` connection and auto-refresh on `tick` events

### 10.4 Responsive
- Test at 1200px, 900px, 600px widths
- Ensure stat blocks hide on mobile (like MiniMax: `@media (max-width: 1024px) { .header-right .stat-block { display: none; } }`)

### 10.5 Panel scroll heights
- Increase `.panel-body` `max-height` from 400px to 500px for better data visibility on large screens

---

## Summary Table

| Phase | What | From | Complexity | Est. Time |
|-------|------|------|------------|-----------|
| 1 | Split files | Trey request | Low | 30 min |
| 2 | Bigger fonts | Trey request | Low | 20 min |
| 3 | Glitch logo | Qwen | Low | 15 min |
| 4 | Summary stats bar | MiniMax | Low-Med | 20 min |
| 5 | Animated status dots | GLM | Low | 20 min |
| 6 | Enhanced system panel | Qwen | Medium | 30 min |
| 7 | Better model stats | Qwen | Medium | 25 min |
| 8 | Rich cron rows + model | Qwen + Trey | Medium | 30 min |
| 9 | Wire all data correctly | Trey request | High | 45 min |
| 10 | Polish & testing | — | Low | 20 min |
| **Total** | | | | **~4 hours** |

## Execution Order

Phases 1→2 must go first (restructure, then resize).
Phases 3–5 are independent and can be parallelized.
Phases 6–8 can be parallelized.
Phase 9 should come after 6–8 (depends on server changes).
Phase 10 is last.

**Recommended**: Execute as 3 batches:
1. **Batch A** (sequential): Phases 1, 2 (foundation — must complete before anything else)
2. **Batch B** (parallel): Phases 3, 4, 5, 6, 7, 8 (features — all independent, can run simultaneously)
3. **Batch C** (sequential): Phases 9, 10 (integration & polish — depends on all prior phases)

## CRITICAL NOTES FOR EXECUTION

1. **Security**: NEVER expose API keys, tokens, or secrets through any API endpoint. Strip `apiKey`, `token`, `password` fields from all config responses. GLM was the only model that did this in the battle royale — we must do it too.
2. **Error handling**: Use `safeReaddir` and `safeJSON` helpers throughout. Wrap all JSONL parsing in try/catch per-line (never let one bad line crash the whole response).
3. **File paths**: All OpenClaw data is under `~/.openclaw/` (use `OPENCLAW_HOME` env var with fallback). Use `os.homedir()` in Node, never hardcode `/Users/treygoff`.
4. **JSON5**: `source-of-truth.json5` MUST be parsed with the `json5` npm package, not `JSON.parse`.
5. **Port**: Keep using `process.env.PORT || 3777` (currently running on 3778 via PORT override).
6. **Git**: Commit after each phase with a descriptive message. Final commit: "OpenClaw HUD V2: all phases complete"

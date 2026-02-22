const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

// Phase 4: Uptime counter
const pageStartTime = Date.now();
function updateUptime() {
  const diff = Date.now() - pageStartTime;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  const el = document.getElementById('stat-uptime');
  if (el) el.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
setInterval(updateUptime, 1000);
updateUptime();

// Clock
function updateClock() {
  const now = new Date();
  $('#clock').textContent = now.toLocaleString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
}
setInterval(updateClock, 1000);
updateClock();

// Time ago helper
function timeAgo(ms) {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 60000) return `${Math.floor(diff/1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
  return `${Math.floor(diff/86400000)}d ago`;
}

// Neon bar colors
const BAR_COLORS = ['var(--cyan)', 'var(--magenta)', 'var(--amber)', 'var(--green)', '#7c4dff', '#ff6e40', '#64ffda', '#ffd600'];

// State
let agentFilter = '';
$('#agent-search').addEventListener('input', e => {
  agentFilter = e.target.value.toLowerCase();
  renderAgents(window._agents || []);
});

// Render agents
function renderAgents(agents) {
  window._agents = agents;
  const filtered = agents.filter(a => a.id.toLowerCase().includes(agentFilter));
  $('#agent-count').textContent = filtered.length;
  const now = Date.now();
  let activeCount = 0;
  $('#agents-list').innerHTML = filtered.map(a => {
    const recent = a.sessions[0]?.updatedAt;
    const isActive = recent && (now - recent < 600000);
    if (isActive) activeCount++;
    const dotClass = isActive ? 'status-dot-green' : 'status-dot-gray';
    const activeBadge = (a.activeSessions > 0) ? `<span style="color:var(--green);font-size:11px;margin-left:6px;">${a.activeSessions} live</span>` : '';
    return `<div class="agent-card" onclick="showAgentSessions('${a.id}')">
      <div class="${dotClass}"></div>
      <div class="agent-id">${a.id}${activeBadge}</div>
      <div class="agent-sessions-count">${a.sessionCount} sess</div>
    </div>`;
  }).join('');
  // Phase 4: Update summary stats
  const statAgents = document.getElementById('stat-agents');
  const statActive = document.getElementById('stat-active');
  if (statAgents) statAgents.textContent = agents.length;
  if (statActive) statActive.textContent = activeCount;
}

// Render sessions
function renderSessions(sessions) {
  $('#session-count').textContent = sessions.length;
  const now = Date.now();
  $('#sessions-list').innerHTML = sessions.slice(0, 40).map(s => {
    const label = s.label || s.key || s.sessionId?.slice(0,8);
    const age = s.updatedAt ? (now - s.updatedAt) : Infinity;
    const dotClass = age < 600000 ? 'status-dot-green' : age < 3600000 ? 'status-dot-amber' : 'status-dot-gray';
    const depthTag = s.spawnDepth > 0 ? `<span style="color:var(--text-dim);font-size:11px;margin-left:4px;">depth:${s.spawnDepth}</span>` : '';
    return `<div class="session-row" onclick="openSessionLog('${s.agentId || ''}','${s.sessionId}','${(label||'').replace(/'/g,'\\&#39;')}')">
      <div class="${dotClass}"></div>
      <div class="session-agent">${s.agentId || '?'}</div>
      <div class="session-label">${label}${depthTag}</div>
      <div class="session-age">${timeAgo(s.updatedAt)}</div>
    </div>`;
  }).join('');
}

// Render cron (Phase 8: enhanced rows)
function renderCron(data) {
  const jobs = data.jobs || [];
  $('#cron-count').textContent = jobs.length;
  $('#cron-list').innerHTML = jobs.map(j => {
    let dotClass = 'status-dot-gray';
    if (j.enabled && j.state?.lastStatus === 'completed') dotClass = 'status-dot-green';
    else if (j.state?.lastStatus === 'error') dotClass = 'status-dot-red';
    else if (j.state?.lastStatus === 'skipped') dotClass = 'status-dot-amber';
    else if (j.enabled) dotClass = 'status-dot-green';

    let statusText = j.state?.lastStatus || 'unknown';
    let statusColor = 'var(--text-dim)';
    if (statusText === 'completed') statusColor = 'var(--green)';
    else if (statusText === 'error') statusColor = 'var(--red)';
    else if (statusText === 'skipped') statusColor = 'var(--amber)';

    const lastRun = j.state?.lastRunAtMs ? timeAgo(j.state.lastRunAtMs) : 'never';
    const nextRun = j.state?.nextRunAtMs ? new Date(j.state.nextRunAtMs).toLocaleString() : '—';
    const errors = j.state?.consecutiveErrors > 0
      ? `<span style="color:var(--red)">errors: ${j.state.consecutiveErrors}</span>` : '';

    const modelInfo = j.usesDefaultModel
      ? `<span style="color:var(--text-dim)">default model</span>`
      : `<span style="color:var(--amber)">${j.modelOverride || '?'}</span>`;

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

// Render system (Phase 6: enhanced)
function renderSystem(config) {
  const items = [
    ['DEFAULT MODEL', config.defaultModel || '—'],
    ['GATEWAY PORT', config.gateway?.port || '—'],
    ['GATEWAY MODE', config.gateway?.mode || '—'],
    ['GATEWAY BIND', config.gateway?.bind || '—'],
    ['MAX CONCURRENT', config.maxConcurrent || '—'],
    ['SPAWN DEPTH', config.subagents?.maxSpawnDepth || '—'],
    ['MAX CHILDREN', config.subagents?.maxChildren || '—'],
    ['CHANNELS', (config.channels || []).join(', ') || '—'],
    ['PROVIDERS', (config.providers || []).join(', ') || '—'],
  ];
  let html = items.map(([l,v]) =>
    `<div class="sys-row"><span class="sys-label">${l}</span><span class="sys-value">${v}</span></div>`
  ).join('');

  // Model aliases sub-section
  const aliases = config.modelAliases || {};
  const aliasEntries = Object.entries(aliases);
  if (aliasEntries.length > 0) {
    html += `<div class="sys-row" style="border-top:1px solid var(--border-dim);margin-top:8px;padding-top:8px;">
      <span class="sys-label" style="color:var(--magenta)">MODEL ALIASES</span></div>`;
    html += aliasEntries.map(([model, cfg]) => {
      const alias = (typeof cfg === 'object' && cfg.alias) ? cfg.alias : (typeof cfg === 'string' ? cfg : '?');
      return `<div class="sys-row"><span class="sys-label">${alias}</span><span class="sys-value" style="font-size:12px">${model}</span></div>`;
    }).join('');
  }

  $('#system-info').innerHTML = html;
  $('#sys-model').textContent = `MODEL: ${config.defaultModel || '?'}`;
}

// Render model usage (Phase 7: gradient bars + agent breakdown)
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

// Render activity feed
function renderActivity(events) {
  $('#activity-count').textContent = events.length;
  $('#activity-feed').innerHTML = events.map(e => {
    const t = new Date(e.timestamp);
    const time = t.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    const typeClass = e.type || 'session';
    let content = e.content || e.type || '';
    if (e.toolName) content = `⚡ ${e.toolName}`;
    return `<div class="activity-item">
      <span class="activity-time">${time}</span>
      <span class="activity-type ${typeClass}">${e.type || '?'}</span>
      <span class="activity-agent">${e.agentId}</span>
      <span class="activity-content">${escapeHtml(content)}</span>
    </div>`;
  }).join('');
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// Show agent sessions (filter sessions panel)
function showAgentSessions(agentId) {
  const sessions = (window._allSessions || []).filter(s => s.agentId === agentId);
  renderSessions(sessions.length ? sessions : window._allSessions || []);
}

// Open session log modal
async function openSessionLog(agentId, sessionId, label) {
  if (!agentId || !sessionId) return;
  $('#modal-title').textContent = `${agentId} // ${label || sessionId.slice(0,8)}`;
  $('#modal-body').innerHTML = '<div style="color:var(--text-dim);font-family:var(--font-mono);">Loading...</div>';
  $('#log-modal').classList.add('active');

  try {
    const res = await fetch(`/api/session-log/${agentId}/${sessionId}?limit=80`);
    const entries = await res.json();
    if (!entries.length) {
      $('#modal-body').innerHTML = '<div style="color:var(--text-dim);font-family:var(--font-mono);">No log entries</div>';
      return;
    }
    $('#modal-body').innerHTML = entries.map(e => {
      const role = e.role || e.type || '?';
      let roleClass = 'system';
      if (role === 'user') roleClass = 'user';
      else if (role === 'assistant') roleClass = 'assistant';
      else if (e.type === 'tool_use' || e.type === 'tool_result') roleClass = 'tool';

      let content = '';
      if (typeof e.content === 'string') content = e.content.slice(0, 500);
      else if (Array.isArray(e.content)) {
        content = e.content.map(c => typeof c === 'string' ? c : (c.text || JSON.stringify(c).slice(0,200))).join('\n').slice(0,500);
      }
      if (e.name) content = `[${e.name}] ${content}`;
      if (!content && e.type) content = e.type;

      const time = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '';
      return `<div class="log-entry">
        <span class="log-time">${time}</span>
        <span class="log-role ${roleClass}">${role}</span>
        <div class="log-content">${escapeHtml(content)}</div>
      </div>`;
    }).join('');
  } catch (err) {
    $('#modal-body').innerHTML = `<div style="color:var(--red);font-family:var(--font-mono);">Error: ${err.message}</div>`;
  }
}

$('#modal-close').onclick = () => $('#log-modal').classList.remove('active');
$('#log-modal').onclick = e => { if (e.target === $('#log-modal')) $('#log-modal').classList.remove('active'); };
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#log-modal').classList.remove('active'); });

// Fetch all data
async function fetchAll() {
  try {
    const [agents, sessions, cron, config, usage, activity] = await Promise.all([
      fetch('/api/agents').then(r => r.json()),
      fetch('/api/sessions').then(r => r.json()),
      fetch('/api/cron').then(r => r.json()),
      fetch('/api/config').then(r => r.json()),
      fetch('/api/model-usage').then(r => r.json()),
      fetch('/api/activity').then(r => r.json()),
    ]);
    window._allSessions = sessions;
    renderAgents(agents);
    renderSessions(sessions);
    renderCron(cron);
    renderSystem(config);
    renderModelUsage(usage);
    renderActivity(activity);
  } catch (err) {
    console.error('Fetch error:', err);
  }
}

fetchAll();
setInterval(fetchAll, 15000);

// WebSocket for ticks
try {
  const ws = new WebSocket(`ws://${location.host}`);
  ws.onmessage = e => {
    const data = JSON.parse(e.data);
    if (data.type === 'tick') fetchAll();
  };
} catch {}

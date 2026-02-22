const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

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
  $('#agents-list').innerHTML = filtered.map(a => {
    const recent = a.sessions[0]?.updatedAt;
    const isActive = recent && (now - recent < 600000);
    return `<div class="agent-card" onclick="showAgentSessions('${a.id}')">
      <div class="agent-dot ${isActive ? 'active' : 'idle'}"></div>
      <div class="agent-id">${a.id}</div>
      <div class="agent-sessions-count">${a.sessionCount} sess</div>
    </div>`;
  }).join('');
}

// Render sessions
function renderSessions(sessions) {
  $('#session-count').textContent = sessions.length;
  $('#sessions-list').innerHTML = sessions.slice(0, 40).map(s => {
    const label = s.label || s.key || s.sessionId?.slice(0,8);
    return `<div class="session-row" onclick="openSessionLog('${s.agentId || ''}','${s.sessionId}','${(label||'').replace(/'/g,'\\&#39;')}')">
      <div class="session-agent">${s.agentId || '?'}</div>
      <div class="session-label">${label}</div>
      <div class="session-age">${timeAgo(s.updatedAt)}</div>
    </div>`;
  }).join('');
}

// Render cron
function renderCron(data) {
  const jobs = data.jobs || [];
  $('#cron-count').textContent = jobs.length;
  $('#cron-list').innerHTML = jobs.map(j => {
    let statusClass = 'disabled';
    if (j.enabled && j.state?.lastStatus === 'completed') statusClass = 'healthy';
    else if (j.state?.lastStatus === 'error') statusClass = 'error';
    else if (j.state?.lastStatus === 'skipped') statusClass = 'skipped';
    else if (j.enabled) statusClass = 'healthy';

    const nextRun = j.state?.nextRunAtMs ? new Date(j.state.nextRunAtMs).toLocaleString() : '—';
    return `<div class="cron-row">
      <div class="cron-status ${statusClass}"></div>
      <div class="cron-name">${j.name}</div>
      <div class="cron-schedule">${j.schedule?.expr || ''}</div>
      <div class="cron-next">${timeAgo(j.state?.lastRunAtMs)}</div>
    </div>`;
  }).join('');
}

// Render system
function renderSystem(config) {
  const items = [
    ['DEFAULT MODEL', config.defaultModel || '—'],
    ['GATEWAY PORT', config.gateway?.port || '—'],
    ['GATEWAY MODE', config.gateway?.mode || '—'],
    ['MAX CONCURRENT', config.maxConcurrent || '—'],
    ['SPAWN DEPTH', config.subagents?.maxSpawnDepth || '—'],
    ['MAX CHILDREN', config.subagents?.maxChildren || '—'],
    ['CHANNELS', (config.channels || []).join(', ') || '—'],
  ];
  $('#system-info').innerHTML = items.map(([l,v]) =>
    `<div class="sys-row"><span class="sys-label">${l}</span><span class="sys-value">${v}</span></div>`
  ).join('');
  $('#sys-model').textContent = `MODEL: ${config.defaultModel || '?'}`;
}

// Render model usage
function renderModelUsage(usage) {
  const entries = Object.entries(usage).sort((a,b) => b[1].total - a[1].total);
  const max = entries[0]?.[1]?.total || 1;
  $('#model-usage').innerHTML = entries.map(([model, data], i) => {
    const pct = Math.round((data.total / max) * 100);
    const color = BAR_COLORS[i % BAR_COLORS.length];
    const shortName = model.split('/').pop();
    return `<div class="model-bar-row">
      <div class="model-bar-label"><span>${shortName}</span><span>${data.total}</span></div>
      <div class="model-bar-track"><div class="model-bar-fill" style="width:${pct}%;background:${color};box-shadow:0 0 8px ${color};"></div></div>
    </div>`;
  }).join('') || '<div style="color:var(--text-dim);font-family:var(--font-mono);font-size:12px;">No model data yet</div>';
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

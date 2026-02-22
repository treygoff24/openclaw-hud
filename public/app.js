const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

// escapeHtml is loaded from utils.js

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

// Connection status
let connected = true;
function setConnectionStatus(ok) {
  connected = ok;
  let badge = document.getElementById('connection-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.id = 'connection-badge';
    badge.style.cssText = 'color:#ff1744;font-weight:bold;font-size:12px;margin-left:12px;font-family:var(--font-mono);';
    const header = $('header') || document.querySelector('.header') || document.body.firstElementChild;
    if (header) header.appendChild(badge);
  }
  badge.textContent = ok ? '' : '⚠ DISCONNECTED';
  badge.style.display = ok ? 'none' : 'inline';
}

// State
let agentFilter = '';
$('#agent-search').addEventListener('input', e => {
  agentFilter = e.target.value.toLowerCase();
  renderAgents(window._agents || []);
});

// Event delegation for session rows and cron rows
document.addEventListener('click', e => {
  const cronRow = e.target.closest('[data-cron-id]');
  if (cronRow) {
    openCronEditor(cronRow.dataset.cronId);
    return;
  }
  const row = e.target.closest('[data-agent][data-session]');
  if (row) {
    openChatPane(row.dataset.agent, row.dataset.session, row.dataset.label || '');
  }
  const card = e.target.closest('[data-agent-id]');
  if (card && !row) {
    showAgentSessions(card.dataset.agentId);
  }
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
    return `<div class="agent-card" data-agent-id="${escapeHtml(a.id)}">
      <div class="${dotClass}"></div>
      <div class="agent-id">${escapeHtml(a.id)}${activeBadge}</div>
      <div class="agent-sessions-count">${a.sessionCount} sess</div>
    </div>`;
  }).join('');
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
    const statusMap = { active: 'status-dot-green', completed: 'status-dot-completed', warm: 'status-dot-amber', stale: 'status-dot-gray' };
    const dotClass = statusMap[s.status] || 'status-dot-gray';
    const depthTag = s.spawnDepth > 0 ? `<span style="color:var(--text-dim);font-size:11px;margin-left:4px;">depth:${s.spawnDepth}</span>` : '';
    return `<div class="session-row" data-agent="${escapeHtml(s.agentId || '')}" data-session="${escapeHtml(s.sessionId || '')}" data-label="${escapeHtml(label || '')}">
      <div class="${dotClass}"></div>
      <div class="session-agent">${escapeHtml(s.agentId || '?')}</div>
      <div class="session-label">${escapeHtml(label)}${depthTag}</div>
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
      : `<span style="color:var(--amber)">${escapeHtml(j.modelOverride || '?')}</span>`;

    const lastError = j.state?.lastError ? `<div style="color:var(--red);font-size:11px;margin-top:2px;">${escapeHtml(j.state.lastError)}</div>` : '';

    return `<div class="cron-row-v2" data-cron-id="${escapeHtml(j.id)}">
      <div class="${dotClass}"></div>
      <div class="cron-main">
        <div class="cron-name">${escapeHtml(j.name)}
          <span class="cron-agent-tag">${escapeHtml(j.agentId || '')}</span>
        </div>
        <div class="cron-meta">
          <span class="cron-schedule">${escapeHtml(j.schedule?.expr || '?')} (${escapeHtml(j.schedule?.tz || '?')})</span>
          <span class="cron-model-info">${modelInfo}</span>
        </div>
        <div class="cron-status-row">
          <span style="color:${statusColor}">${escapeHtml(statusText).toUpperCase()}</span>
          <span style="color:var(--text-dim)">last: ${lastRun}</span>
          <span style="color:var(--text-dim)">next: ${nextRun}</span>
          ${errors}
        </div>
        ${lastError}
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
    `<div class="sys-row"><span class="sys-label">${escapeHtml(l)}</span><span class="sys-value">${escapeHtml(String(v))}</span></div>`
  ).join('');

  // Model aliases sub-section
  const aliases = config.modelAliases || {};
  const aliasEntries = Object.entries(aliases);
  if (aliasEntries.length > 0) {
    html += `<div class="sys-row" style="border-top:1px solid var(--border-dim);margin-top:8px;padding-top:8px;">
      <span class="sys-label" style="color:var(--magenta)">MODEL ALIASES</span></div>`;
    html += aliasEntries.map(([model, cfg]) => {
      const alias = (typeof cfg === 'object' && cfg.alias) ? cfg.alias : (typeof cfg === 'string' ? cfg : '?');
      return `<div class="sys-row"><span class="sys-label">${escapeHtml(alias)}</span><span class="sys-value" style="font-size:12px">${escapeHtml(model)}</span></div>`;
    }).join('');
  }

  $('#system-info').innerHTML = html;
  $('#sys-model').textContent = `MODEL: ${config.defaultModel || '?'}`;
}

// Render model usage (Phase 7: gradient bars + agent breakdown)
function formatTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function renderModelUsage(usage) {
  const entries = Object.entries(usage).sort((a,b) => b[1].totalTokens - a[1].totalTokens);
  const max = entries[0]?.[1]?.totalTokens || 1;
  const colorClasses = ['', 'alt1', 'alt2', 'alt3'];

  $('#model-usage').innerHTML = entries.map(([model, data], i) => {
    const pct = Math.round((data.totalTokens / max) * 100);
    const shortName = model.split('/').pop();
    const colorClass = colorClasses[i % colorClasses.length];
    const agentBreakdown = Object.entries(data.agents || {})
      .sort((a,b) => b[1].totalTokens - a[1].totalTokens)
      .map(([a, d]) => `${escapeHtml(a)}:${formatTokens(d.totalTokens)}`)
      .join(' · ');
    const costStr = data.totalCost > 0 ? ` · <span class="token-cost">$${data.totalCost.toFixed(2)}</span>` : '';

    return `<div class="model-bar-row">
      <div class="model-bar-label"><span>${escapeHtml(shortName)}</span><span>${formatTokens(data.totalTokens)} tokens</span></div>
      <div class="model-bar-track"><div class="model-bar-fill ${colorClass}" style="width:${pct}%"></div></div>
      <div class="token-breakdown">IN: ${formatTokens(data.inputTokens)} · OUT: ${formatTokens(data.outputTokens)} · CACHE: ${formatTokens(data.cacheReadTokens)}${costStr}</div>
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
      <span class="activity-type ${typeClass}">${escapeHtml(e.type || '?')}</span>
      <span class="activity-agent">${escapeHtml(e.agentId)}</span>
      <span class="activity-content">${escapeHtml(content)}</span>
    </div>`;
  }).join('');
}

// Session Tree
const treeCollapseState = {};

function renderSessionTree(sessions) {
  $('#tree-count').textContent = sessions.length;
  
  // Build parent->children map
  const byKey = {};
  sessions.forEach(s => { byKey[s.key] = s; });
  const children = {};
  const roots = [];
  sessions.forEach(s => {
    if (s.spawnedBy && byKey[s.spawnedBy]) {
      if (!children[s.spawnedBy]) children[s.spawnedBy] = [];
      children[s.spawnedBy].push(s);
    } else {
      roots.push(s);
    }
  });
  // Sort children by updatedAt desc
  for (const k in children) children[k].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  roots.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  function renderNode(node, prefix, isLast) {
    const now = Date.now();
    const statusMap = { active: 'status-dot-green', completed: 'status-dot-completed', warm: 'status-dot-amber', stale: 'status-dot-gray' };
    const dotClass = statusMap[node.status] || 'status-dot-gray';
    const label = node.label || node.key;
    const kids = children[node.key] || [];
    const hasKids = kids.length > 0;
    const collapsed = treeCollapseState[node.key] === true;
    const toggleChar = hasKids ? (collapsed ? '▸' : '▾') : ' ';
    const countBadge = (hasKids && collapsed) ? `<span class="tree-child-count">${kids.length}</span>` : '';

    let html = `<div class="tree-node">
      <div class="tree-node-content" data-tree-key="${escapeHtml(node.key)}" data-agent="${escapeHtml(node.agentId || '')}" data-session="${escapeHtml(node.sessionId || '')}" data-label="${escapeHtml(label)}">
        <span class="tree-indent">${escapeHtml(prefix)}</span>
        <span class="tree-toggle" data-toggle-key="${escapeHtml(node.key)}">${toggleChar}</span>
        <div class="${dotClass}"></div>
        <span class="tree-label">${escapeHtml(label)}</span>
        <span class="tree-agent">${escapeHtml(node.agentId || '')}</span>
        ${countBadge}
        <span class="tree-age">${timeAgo(node.updatedAt)}</span>
      </div>`;

    if (hasKids) {
      html += `<div class="tree-children${collapsed ? ' collapsed' : ''}">`;
      kids.forEach((kid, i) => {
        const kidIsLast = i === kids.length - 1;
        const childPrefix = prefix + (isLast ? '   ' : '│  ');
        const connector = kidIsLast ? '└─ ' : '├─ ';
        html += renderNode(kid, childPrefix + connector, kidIsLast);
      });
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  let html = '<div class="tree-root">';
  roots.forEach((r, i) => {
    const connector = i === roots.length - 1 ? '└─ ' : '├─ ';
    html += renderNode(r, connector, i === roots.length - 1);
  });
  html += '</div>';
  
  $('#tree-body').innerHTML = html;
}

// Tree event delegation
document.addEventListener('click', e => {
  const toggle = e.target.closest('[data-toggle-key]');
  if (toggle) {
    const key = toggle.dataset.toggleKey;
    treeCollapseState[key] = !treeCollapseState[key];
    if (window._treeData) renderSessionTree(window._treeData);
    e.stopPropagation();
    return;
  }
  const treeNode = e.target.closest('[data-tree-key]');
  if (treeNode && !e.target.closest('[data-toggle-key]')) {
    const agent = treeNode.dataset.agent;
    const session = treeNode.dataset.session;
    if (agent && session) openChatPane(agent, session, treeNode.dataset.label || '');
  }
});

// Show agent sessions (filter sessions panel)
function showAgentSessions(agentId) {
  const sessions = (window._allSessions || []).filter(s => s.agentId === agentId);
  if (sessions.length === 0) {
    $('#sessions-list').innerHTML = `<div style="color:var(--text-dim);font-family:var(--font-mono);padding:16px;text-align:center;">No sessions for ${escapeHtml(agentId)}</div>`;
    $('#session-count').textContent = '0';
    return;
  }
  renderSessions(sessions);
}

// Session log modal removed — replaced by chat pane

function closeModal() {
  // Close only the topmost active modal
  const modals = ['#spawn-modal', '#cron-modal'];
  for (const id of modals) {
    if ($(id).classList.contains('active')) {
      $(id).classList.remove('active');
      return; // only close one
    }
  }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// --- Cron Editor ---
let _cronData = null;
let _editingJobId = null;

function openCronEditor(jobId) {
  if (!_cronData) return;
  const job = (_cronData.jobs || []).find(j => j.id === jobId);
  if (!job) return;
  _editingJobId = jobId;

  $('#cron-edit-name').textContent = job.name || jobId;
  $('#cron-name').value = job.name || '';
  $('#cron-enabled').checked = !!job.enabled;

  // Populate agent dropdown
  const agentSelect = $('#cron-agent');
  const agents = (window._agents || []).map(a => a.id);
  agentSelect.innerHTML = agents.map(id =>
    `<option value="${escapeHtml(id)}"${id === job.agentId ? ' selected' : ''}>${escapeHtml(id)}</option>`
  ).join('');

  $('#cron-session-target').value = job.sessionTarget || 'main';
  updateSessionTargetFields();

  // Schedule
  const sched = job.schedule || {};
  if (sched.at) {
    $('#cron-schedule-kind').value = 'at';
    const d = new Date(sched.at);
    $('#cron-at').value = d.toISOString().slice(0, 16);
  } else {
    $('#cron-schedule-kind').value = 'cron';
    $('#cron-expr').value = sched.expr || '';
    $('#cron-tz').value = sched.tz || 'America/Chicago';
  }
  updateScheduleFields();

  // Populate model dropdown
  const modelSelect = $('#cron-model');
  if (window._modelAliases) {
    modelSelect.innerHTML = window._modelAliases.map(m =>
      `<option value="${escapeHtml(m.fullId)}">${escapeHtml(m.alias)}${m.fullId ? ' (' + escapeHtml(m.fullId.split('/').pop()) + ')' : ''}</option>`
    ).join('');
  }

  // Payload
  const payload = job.payload || {};
  modelSelect.value = payload.model || '';
  $('#cron-timeout').value = payload.timeoutSeconds || '';
  $('#cron-prompt').value = payload.message || payload.text || '';

  $('#cron-modal').classList.add('active');
}

function closeCronModal() {
  $('#cron-modal').classList.remove('active');
  _editingJobId = null;
}

function updateSessionTargetFields() {
  const isIsolated = $('#cron-session-target').value === 'isolated';
  $('#cron-model-group').style.display = isIsolated ? '' : 'none';
  $('#cron-timeout-group').style.display = isIsolated ? '' : 'none';
  $('#cron-prompt-label').textContent = isIsolated ? 'Prompt / Task' : 'System Event Message';
}

function updateScheduleFields() {
  const isCron = $('#cron-schedule-kind').value === 'cron';
  $('#cron-expr-group').style.display = isCron ? '' : 'none';
  $('#cron-tz-group').style.display = isCron ? '' : 'none';
  $('#cron-at-group').style.display = isCron ? 'none' : '';
}

$('#cron-session-target').addEventListener('change', updateSessionTargetFields);
$('#cron-schedule-kind').addEventListener('change', updateScheduleFields);
$('#cron-modal-close').onclick = closeCronModal;
$('#cron-modal').addEventListener('click', e => { if (e.target === $('#cron-modal')) closeCronModal(); });

// Spawn modal
$('#open-spawn-btn').addEventListener('click', openSpawnModal);
$('#spawn-cancel-btn').addEventListener('click', closeSpawnModal);
$('#spawn-modal-close').addEventListener('click', closeSpawnModal);
$('#spawn-launch-btn').addEventListener('click', launchSession);
$('#spawn-modal').addEventListener('click', (e) => {
  if (e.target.id === 'spawn-modal') closeSpawnModal();
});

async function saveCronJob() {
  if (!_editingJobId) return;
  const sessionTarget = $('#cron-session-target').value;
  const isIsolated = sessionTarget === 'isolated';
  const isCron = $('#cron-schedule-kind').value === 'cron';

  const schedule = isCron
    ? { kind: 'cron', expr: $('#cron-expr').value, tz: $('#cron-tz').value || 'America/Chicago' }
    : { kind: 'at', at: new Date($('#cron-at').value).toISOString() };

  const payloadKind = isIsolated ? 'agentTurn' : 'systemEvent';
  const payload = { kind: payloadKind };
  const promptVal = $('#cron-prompt').value;
  if (isIsolated) {
    payload.message = promptVal;
    if ($('#cron-model').value) payload.model = $('#cron-model').value;
    if ($('#cron-timeout').value) payload.timeoutSeconds = parseInt($('#cron-timeout').value);
  } else {
    payload.text = promptVal;
  }

  const updates = {
    name: $('#cron-name').value,
    enabled: $('#cron-enabled').checked,
    agentId: $('#cron-agent').value,
    sessionTarget,
    schedule,
    payload
  };

  try {
    const res = await fetch(`/api/cron/${encodeURIComponent(_editingJobId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');
    closeCronModal();
    fetchAll();
  } catch (err) {
    alert('Error saving: ' + err.message);
  }
}

// --- Spawn Session ---
function openSpawnModal() {
  // Reset form
  $('#spawn-error').style.display = 'none';
  $('#spawn-label').value = '';
  $('#spawn-mode').value = 'run';
  $('#spawn-timeout').value = '300';
  $('#spawn-files').value = '';
  $('#spawn-prompt').value = '';

  // Populate agent dropdown
  const agentSelect = $('#spawn-agent');
  const agents = (window._agents || []).map(a => a.id);
  agentSelect.innerHTML = agents.map(id =>
    `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`
  ).join('');

  // Populate model dropdown (reuse cached _modelAliases from fetchAll)
  const modelSelect = $('#spawn-model');
  if (window._modelAliases) {
    modelSelect.innerHTML = window._modelAliases.map(m =>
      `<option value="${escapeHtml(m.fullId)}">${escapeHtml(m.alias)}${m.fullId ? ' (' + escapeHtml(m.fullId.split('/').pop()) + ')' : ''}</option>`
    ).join('');
  }

  $('#spawn-modal').classList.add('active');
  $('#spawn-prompt').focus();
}

function closeSpawnModal() {
  $('#spawn-modal').classList.remove('active');
}

async function launchSession() {
  const btn = $('#spawn-launch-btn');
  const errorEl = $('#spawn-error');
  errorEl.style.display = 'none';

  const data = {
    agentId: $('#spawn-agent').value,
    model: $('#spawn-model').value || undefined,
    label: $('#spawn-label').value.trim() || undefined,
    mode: $('#spawn-mode').value,
    timeout: parseInt($('#spawn-timeout').value) || undefined,
    contextFiles: $('#spawn-files').value || undefined,
    prompt: $('#spawn-prompt').value,
  };

  // Client-side validation
  if (!data.prompt?.trim()) {
    errorEl.textContent = 'Task / Prompt is required';
    errorEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = 'LAUNCHING...';

  try {
    const res = await fetch('/api/spawn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Spawn failed');

    closeSpawnModal();
    showToast(`Session launched: ${data.label || data.agentId}`);
    setTimeout(fetchAll, 2000); // slight delay for session to register in tree
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

function showToast(message, isError = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.className = 'toast' + (isError ? ' error' : '');
  requestAnimationFrame(() => {
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 3000);
  });
}

// Fetch all data
async function fetchAll() {
  try {
    const [agents, sessions, cron, config, usage, activity, tree, models] = await Promise.all([
      fetch('/api/agents').then(r => r.json()),
      fetch('/api/sessions').then(r => r.json()),
      fetch('/api/cron').then(r => r.json()),
      fetch('/api/config').then(r => r.json()),
      fetch('/api/model-usage').then(r => r.json()),
      fetch('/api/activity').then(r => r.json()),
      fetch('/api/session-tree').then(r => r.json()),
      fetch('/api/models').then(r => r.json()),
    ]);
    window._modelAliases = models;
    window._allSessions = sessions;
    window._treeData = tree;
    renderAgents(agents);
    renderSessions(sessions);
    _cronData = cron;
    renderCron(cron);
    renderSystem(config);
    renderModelUsage(usage);
    renderActivity(activity);
    renderSessionTree(tree);
    setConnectionStatus(true);
  } catch (err) {
    console.error('Fetch error:', err);
    setConnectionStatus(false);
  }
}

fetchAll();

// Polling management - avoid double fetch
let pollInterval = null;
function startPolling() {
  if (!pollInterval) pollInterval = setInterval(fetchAll, 15000);
}
function stopPolling() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

startPolling(); // start as fallback

// WebSocket for ticks
try {
  const ws = new WebSocket(`ws://${location.host}`);
  window._hudWs = ws;
  ws.onopen = () => {
    stopPolling();
    setConnectionStatus(true);
    if (window._flushChatWsQueue) window._flushChatWsQueue();
  };
  ws.onmessage = e => {
    const data = JSON.parse(e.data);
    if (data.type === 'tick') fetchAll();
    if (data.type === 'subscribed' || data.type === 'log-entry') {
      if (window.handleChatWsMessage) window.handleChatWsMessage(data);
    }
  };
  ws.onclose = () => {
    startPolling();
    setConnectionStatus(false);
  };
  ws.onerror = () => {
    setConnectionStatus(false);
  };
} catch {}

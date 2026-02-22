window.HUD = window.HUD || {};
HUD.agents = (function() {
  'use strict';
  const $ = s => document.querySelector(s);

  let agentFilter = '';

  function render(agents) {
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

  function init() {
    $('#agent-search').addEventListener('input', e => {
      agentFilter = e.target.value.toLowerCase();
      render(window._agents || []);
    });
  }

  function showAgentSessions(agentId) {
    const sessions = (window._allSessions || []).filter(s => s.agentId === agentId);
    if (sessions.length === 0) {
      $('#sessions-list').innerHTML = `<div style="color:var(--text-dim);font-family:var(--font-mono);padding:16px;text-align:center;">No sessions for ${escapeHtml(agentId)}</div>`;
      $('#session-count').textContent = '0';
      return;
    }
    HUD.sessions.render(sessions);
  }

  return { render, init, showAgentSessions };
})();

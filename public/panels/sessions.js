window.HUD = window.HUD || {};
HUD.sessions = (function() {
  'use strict';
  const $ = s => document.querySelector(s);

  function render(sessions) {
    $('#session-count').textContent = sessions.length;
    $('#sessions-list').innerHTML = sessions.slice(0, 40).map((s, index) => {
      const label = s.label || s.key || s.sessionId?.slice(0,8);
      const statusMap = { active: 'status-dot-green', completed: 'status-dot-completed', warm: 'status-dot-amber', stale: 'status-dot-gray' };
      const dotClass = statusMap[s.status] || 'status-dot-gray';
      const depthTag = s.spawnDepth > 0 ? `<span style="color:var(--text-dim);font-size:11px;margin-left:4px;">depth:${s.spawnDepth}</span>` : '';
      const statusLabel = s.status || 'unknown';
      return `<div class="session-row" data-agent="${escapeHtml(s.agentId || '')}" data-session="${escapeHtml(s.sessionId || '')}" data-session-key="${escapeHtml(s.sessionKey || s.key || '')}" data-label="${escapeHtml(label || '')}" role="listitem" tabindex="0" aria-label="Session ${escapeHtml(label || s.sessionId?.slice(0,8) || 'unknown')} by ${escapeHtml(s.agentId || '?')}, status ${statusLabel}" data-index="${index}">
        <div class="${dotClass}" aria-hidden="true"></div>
        <div class="session-agent">${escapeHtml(s.agentId || '?')}</div>
        <div class="session-label">${escapeHtml(label)}${depthTag}</div>
        <div class="session-age">${HUD.utils.timeAgo(s.updatedAt)}</div>
      </div>`;
    }).join('');

    // Add keyboard support to session rows
    document.querySelectorAll('.session-row').forEach(row => {
      window.makeFocusable(row, () => {
        if (row.dataset.agent && row.dataset.sessionKey) {
          openChatPane(row.dataset.agent, row.dataset.session || '', row.dataset.label || '', row.dataset.sessionKey);
        }
      });
    });
  }

  return { render };
})();

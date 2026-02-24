window.HUD = window.HUD || {};
HUD.sessions = (function() {
  'use strict';
  const $ = s => document.querySelector(s);
  const normalizeLabel = (window.HUD && HUD.labelSanitizer && typeof HUD.labelSanitizer.normalizeLabel === 'function')
    ? HUD.labelSanitizer.normalizeLabel
    : function(value) {
      if (value == null) return '';
      return String(value);
    };
  const defaultMeta = {
    roleLabel: 'Main',
    modelLabel: 'unknown model',
    sessionAlias: 'session',
    compactLabel: 'Main · unknown model · session'
  };

  function resolveSessionDisplayMeta(session) {
    if (window.SessionLabels && typeof window.SessionLabels.getDisplayMeta === 'function') {
      return window.SessionLabels.getDisplayMeta(session);
    }
    const safeSession = session && typeof session === 'object' ? session : {};
    const spawnDepth = Number(safeSession.spawnDepth);
    const isSubagent = safeSession.spawnedBy || (Number.isFinite(spawnDepth) && spawnDepth > 0);
    const roleLabel = isSubagent ? 'Subagent' : 'Main';
    const aliasCandidate = safeSession.label ? safeSession.label : (
      safeSession.key ? safeSession.key.split(':').pop() : (
        safeSession.sessionId ? safeSession.sessionId : 'session'
      )
    );
    const sessionAlias = normalizeLabel(aliasCandidate, safeSession.sessionId ? safeSession.sessionId : 'session');
    return Object.assign({}, defaultMeta, { roleLabel, sessionAlias, compactLabel: `${roleLabel} · ${defaultMeta.modelLabel} · ${sessionAlias}` });
  }

  function resolveSessionMetaText(session, meta) {
    return window.SessionLabels && typeof window.SessionLabels.buildSessionAriaLabel === 'function'
      ? window.SessionLabels.buildSessionAriaLabel(session, meta)
      : `Session ${session?.sessionKey || 'unknown session'}; role ${meta.roleLabel}; model ${meta.modelLabel}; alias ${meta.sessionAlias}; agent ${session?.agentId || 'unknown'}; status ${session?.status || 'unknown'}`;
  }

  function render(sessions) {
    for (const s of sessions) {
      if (!s.sessionKey) throw new Error('sessions.render requires canonical sessionKey for each session');
    }
    $('#session-count').textContent = sessions.length;
    $('#sessions-list').innerHTML = sessions.slice(0, 40).map((s, index) => {
      const sessionKey = s.sessionKey;
      if (!sessionKey || typeof sessionKey !== 'string') {
        throw new Error('sessions.render requires canonical sessionKey for each session');
      }
      const meta = resolveSessionDisplayMeta(s);
      const label = meta.compactLabel;
      const statusMap = { active: 'status-dot-green', completed: 'status-dot-completed', warm: 'status-dot-amber', stale: 'status-dot-gray' };
      const dotClass = statusMap[s.status] || 'status-dot-gray';
      const statusLabel = s.status || 'unknown';
      const fullContext = resolveSessionMetaText(s, meta);
      return `<div class="session-row" data-agent="${escapeHtml(s.agentId || '')}" data-session="${escapeHtml(s.sessionId || '')}" data-session-key="${escapeHtml(sessionKey)}" data-label="${escapeHtml(label || '')}" role="listitem" tabindex="0" title="${escapeHtml(fullContext)}" aria-label="${escapeHtml(fullContext)}" data-index="${index}">
        <div class="${dotClass}" aria-hidden="true"></div>
        <div class="session-agent">${escapeHtml(s.agentId || '?')}</div>
        <div class="session-label" title="${escapeHtml(fullContext)}"><span class="session-label-role">${escapeHtml(meta.roleLabel)}</span><span class="session-label-sep"> · </span><span class="session-label-model">${escapeHtml(meta.modelLabel)}</span><span class="session-label-sep"> · </span><span class="session-label-alias">${escapeHtml(meta.sessionAlias)}</span></div>
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

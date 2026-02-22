// Chat Pane Module
(function() {
  'use strict';

  let currentSession = null;
  let subscribedKey = null;
  const _wsQueue = [];
  // I3: Generation counter to discard stale fetch responses
  let _openGeneration = 0;

  function createMessageEl(entry) {
    // M7: removed dead `esc` variable (getEscape() call that was never used)
    const role = entry.role || entry.type || 'system';
    let roleClass = 'system';
    if (role === 'user') roleClass = 'user';
    else if (role === 'assistant') roleClass = 'assistant';
    else if (entry.type === 'tool_use' || entry.type === 'tool_result') roleClass = 'tool';

    let content = '';
    if (typeof entry.content === 'string') {
      content = entry.content;
    } else if (Array.isArray(entry.content)) {
      content = entry.content.map(c => typeof c === 'string' ? c : (c.text || JSON.stringify(c).slice(0, 200))).join('\n');
    }
    if (entry.name) content = '[' + entry.name + '] ' + content;
    if (!content && entry.type) content = entry.type;

    // M2: Truncation indicator
    const MAX_CONTENT = 2000;
    let truncated = false;
    if (content.length > MAX_CONTENT) {
      content = content.slice(0, MAX_CONTENT);
      truncated = true;
    }

    const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '';

    const div = document.createElement('div');
    div.className = 'chat-msg ' + roleClass;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'chat-msg-time';
    timeSpan.textContent = time;
    div.appendChild(timeSpan);

    const roleSpan = document.createElement('span');
    roleSpan.className = 'chat-msg-role ' + roleClass;
    roleSpan.textContent = role;
    div.appendChild(roleSpan);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'chat-msg-content';
    contentDiv.textContent = content;
    if (truncated) {
      const indicator = document.createElement('span');
      indicator.className = 'chat-truncated';
      indicator.textContent = ' … [truncated]';
      contentDiv.appendChild(indicator);
    }
    div.appendChild(contentDiv);

    return div;
  }

  // I1: Safe WS send with pending-message queue
  function sendWs(msg) {
    if (window._hudWs && window._hudWs.readyState === WebSocket.OPEN) {
      window._hudWs.send(JSON.stringify(msg));
    } else {
      _wsQueue.push(msg);
    }
  }

  window._flushChatWsQueue = function() {
    while (_wsQueue.length > 0) {
      const msg = _wsQueue.shift();
      if (window._hudWs && window._hudWs.readyState === WebSocket.OPEN) {
        window._hudWs.send(JSON.stringify(msg));
      } else {
        // WS not ready yet, put it back
        _wsQueue.unshift(msg);
        break;
      }
    }
  };

  window.openChatPane = function(agentId, sessionId, label) {
    if (!agentId || !sessionId) return;

    // I3: Increment generation so in-flight fetches become stale
    const gen = ++_openGeneration;

    const layout = document.querySelector('.hud-layout');
    if (layout) layout.classList.add('chat-open');

    const titleEl = document.getElementById('chat-title');
    if (titleEl) titleEl.textContent = agentId + ' // ' + (label || sessionId.slice(0, 8));

    // Hide LIVE indicator until subscription confirmed
    const liveEl = document.getElementById('chat-live');
    if (liveEl) liveEl.classList.remove('visible');

    // Unsubscribe previous
    if (subscribedKey && subscribedKey !== agentId + '/' + sessionId) {
      const parts = subscribedKey.split('/');
      sendWs({ type: 'unsubscribe-log', agentId: parts[0], sessionId: parts[1] });
    }

    currentSession = { agentId, sessionId, label };
    subscribedKey = agentId + '/' + sessionId;
    localStorage.setItem('hud-chat-session', JSON.stringify(currentSession));

    const messagesEl = document.getElementById('chat-messages');

    // Clear messages
    while (messagesEl.firstChild) {
      messagesEl.removeChild(messagesEl.firstChild);
    }
    // Add loading indicator
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'chat-loading';
    loadingDiv.id = 'chat-empty';
    loadingDiv.textContent = 'Loading...';
    messagesEl.appendChild(loadingDiv);

    // Fetch log
    fetch('/api/session-log/' + encodeURIComponent(agentId) + '/' + encodeURIComponent(sessionId) + '?limit=100')
      .then(r => r.json())
      .then(entries => {
        // I3: Discard if a newer openChatPane call has occurred
        if (gen !== _openGeneration) return;

        const empty = document.getElementById('chat-empty');
        if (!entries.length) {
          if (empty) empty.textContent = 'No log entries';
          return;
        }
        if (empty) empty.remove();
        const container = document.getElementById('chat-messages');
        entries.forEach(e => container.appendChild(createMessageEl(e)));
        container.scrollTop = container.scrollHeight;
      })
      .catch(err => {
        if (gen !== _openGeneration) return;
        const empty = document.getElementById('chat-empty');
        if (empty) empty.textContent = 'Error: ' + err.message;
      });

    // Subscribe via WS
    sendWs({ type: 'subscribe-log', agentId, sessionId });
  };

  window.closeChatPane = function() {
    const layout = document.querySelector('.hud-layout');
    if (layout) layout.classList.remove('chat-open');

    if (subscribedKey) {
      const parts = subscribedKey.split('/');
      sendWs({ type: 'unsubscribe-log', agentId: parts[0], sessionId: parts[1] });
      subscribedKey = null;
    }

    currentSession = null;
    localStorage.removeItem('hud-chat-session');
  };

  // WS message handler - called from app.js
  window.handleChatWsMessage = function(data) {
    // M4: Handle subscribed confirmation — show LIVE indicator
    if (data.type === 'subscribed') {
      if (currentSession && data.sessionId === currentSession.sessionId) {
        const liveEl = document.getElementById('chat-live');
        if (liveEl) liveEl.classList.add('visible');
      }
      return;
    }

    if (data.type !== 'log-entry') return;
    if (!currentSession) return;
    if (data.agentId !== currentSession.agentId || data.sessionId !== currentSession.sessionId) return;

    const container = document.getElementById('chat-messages');
    if (!container) return;

    // Remove empty placeholder if present
    const empty = document.getElementById('chat-empty');
    if (empty) empty.remove();

    const nearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 100;

    container.appendChild(createMessageEl(data.entry || data));

    if (nearBottom) {
      container.scrollTop = container.scrollHeight;
    } else {
      // M5: Toggle pill visibility via CSS class instead of inline style
      const pill = document.getElementById('chat-new-pill');
      if (pill) pill.classList.add('visible');
    }
  };

  // Pill click
  document.addEventListener('click', function(e) {
    if (e.target.id === 'chat-new-pill') {
      const container = document.getElementById('chat-messages');
      if (container) container.scrollTop = container.scrollHeight;
      // M5: Use CSS class
      e.target.classList.remove('visible');
    }
  });

  // Close button
  document.addEventListener('click', function(e) {
    if (e.target.id === 'chat-close') {
      window.closeChatPane();
    }
  });

  // Escape key (only if no modal is open)
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      const activeModal = document.querySelector('.modal-overlay.active');
      if (!activeModal) {
        window.closeChatPane();
      }
    }
  });

  // Restore from localStorage on load
  document.addEventListener('DOMContentLoaded', function() {
    try {
      const saved = localStorage.getItem('hud-chat-session');
      if (saved) {
        const s = JSON.parse(saved);
        if (s.agentId && s.sessionId) {
          window.openChatPane(s.agentId, s.sessionId, s.label || '');
        }
      }
    } catch(e) {}
  });
})();

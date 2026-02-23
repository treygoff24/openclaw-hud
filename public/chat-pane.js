// Chat Pane Module — main controller, state, and WS dispatch
(function() {
  'use strict';
  const CHAT_LOG_PREFIX = '[HUD-CHAT]';

  if (!window.__hudDiagLog) {
    window.__hudDiagLog = function(prefix, event, fields) {
      const now = new Date().toISOString();
      const diag = window.__HUD_DIAG__ || (window.__HUD_DIAG__ = { maxEvents: 200, events: [], seq: 0 });
      if (!Array.isArray(diag.events)) diag.events = [];
      if (!diag.maxEvents || diag.maxEvents < 1) diag.maxEvents = 200;
      if (typeof diag.seq !== 'number') diag.seq = 0;
      const payload = fields || {};
      const entry = Object.assign({ seq: ++diag.seq, ts: now, prefix: prefix, event: event }, payload);
      diag.events.push(entry);
      if (diag.events.length > diag.maxEvents) {
        diag.events.splice(0, diag.events.length - diag.maxEvents);
      }
      const parts = [];
      for (const key in payload) {
        if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
        const value = payload[key];
        if (value === undefined) continue;
        parts.push(key + '=' + (typeof value === 'string' ? JSON.stringify(value) : String(value)));
      }
      console.log((prefix + ' ' + event + ' ts=' + now + (parts.length ? ' ' + parts.join(' ') : '')).trim());
    };
  }
  const hudDiagLog = window.__hudDiagLog;

  const _wsQueue = [];
  const HISTORY_LOAD_TIMEOUT_MS = 10000;
  const CANONICAL_SESSION_KEY_RE = /^agent:[a-zA-Z0-9_-]+:[a-zA-Z0-9:_-]+$/;
  let historyLoadTimer = null;

  function isCanonicalSessionKey(sessionKey) {
    return typeof sessionKey === 'string' && CANONICAL_SESSION_KEY_RE.test(sessionKey);
  }

  function clearHistoryLoadTimer() {
    if (historyLoadTimer) {
      clearTimeout(historyLoadTimer);
      historyLoadTimer = null;
    }
  }

  function startHistoryLoadTimer(sessionKey) {
    clearHistoryLoadTimer();
    hudDiagLog(CHAT_LOG_PREFIX, 'history_timeout_started', {
      sessionKey: sessionKey || '',
      timeoutMs: HISTORY_LOAD_TIMEOUT_MS
    });
    historyLoadTimer = setTimeout(function() {
      historyLoadTimer = null;
      const state = window.ChatState;
      if (!state.currentSession || state.currentSession.sessionKey !== sessionKey) return;
      const container = document.getElementById('chat-messages');
      if (!container) return;

      const loading = container.querySelector('.chat-loading');
      if (loading) loading.remove();
      if (container.querySelector('.chat-history-warning')) return;

      const warning = document.createElement('div');
      warning.className = 'chat-history-warning';
      warning.textContent = 'History is taking longer than expected. Close and reopen chat to retry.';
      container.appendChild(warning);
      container.dataset.ready = 'true';

      if (window.A11yAnnouncer) {
        window.A11yAnnouncer.announceAssertive('Chat history is taking longer than expected. Close and reopen chat to retry.');
      }
      hudDiagLog(CHAT_LOG_PREFIX, 'history_timeout_fired', {
        sessionKey: sessionKey || ''
      });
    }, HISTORY_LOAD_TIMEOUT_MS);
  }

  function sendWs(msg) {
    if (window._hudWs && window._hudWs.readyState === WebSocket.OPEN) {
      window._hudWs.send(JSON.stringify(msg));
      hudDiagLog(CHAT_LOG_PREFIX, 'send_open', {
        type: msg && msg.type ? msg.type : '',
        sessionKey: msg && msg.sessionKey ? msg.sessionKey : '',
        queueLength: _wsQueue.length
      });
    } else {
      _wsQueue.push(msg);
      const payload = {
        type: msg && msg.type ? msg.type : '',
        sessionKey: msg && msg.sessionKey ? msg.sessionKey : '',
        queueLength: _wsQueue.length
      };
      if (payload.type === 'chat-subscribe' || payload.type === 'chat-history') {
        hudDiagLog(CHAT_LOG_PREFIX, 'queue_enqueue', payload);
      }
      hudDiagLog(CHAT_LOG_PREFIX, 'send_deferred', payload);
      if (typeof window._connectWs === 'function') {
        window._connectWs();
      }
    }
  }

  // Shared state accessible across modules
  window.ChatState = {
    currentSession: null,
    subscribedKey: null,
    activeRuns: new Map(),
    pendingAcks: new Map(),
    cachedModels: null,
    sendWs: sendWs,
  };

  window._flushChatWsQueue = function() {
    hudDiagLog(CHAT_LOG_PREFIX, 'queue_flush_start', {
      queued: _wsQueue.length
    });
    let flushed = 0;
    while (_wsQueue.length > 0) {
      const msg = _wsQueue.shift();
      if (window._hudWs && window._hudWs.readyState === WebSocket.OPEN) {
        window._hudWs.send(JSON.stringify(msg));
        flushed += 1;
      } else {
        _wsQueue.unshift(msg);
        break;
      }
    }
    hudDiagLog(CHAT_LOG_PREFIX, 'queue_flush_end', {
      flushed: flushed,
      remaining: _wsQueue.length
    });
  };

  window.openChatPane = function(agentId, sessionId, label, sessionKey) {
    if (!agentId) {
      console.warn('[HUD-CHAT] openChatPane aborted: missing agentId');
      return;
    }
    if (!isCanonicalSessionKey(sessionKey)) {
      console.warn('[HUD-CHAT] openChatPane aborted: non-canonical sessionKey', { agentId, sessionId, sessionKey });
      throw new Error('openChatPane requires canonical sessionKey from /api/sessions');
    }
    const displaySessionId = sessionId || sessionKey.split(':').slice(2).join(':');
    clearHistoryLoadTimer();
    const state = window.ChatState;

    if (state.subscribedKey === sessionKey) return;

    const layout = document.querySelector('.hud-layout');
    if (layout) layout.classList.add('chat-open');

    const titleEl = document.getElementById('chat-title');
    if (titleEl) titleEl.textContent = agentId + ' // ' + (label || displaySessionId.slice(0, 8));

    const liveEl = document.getElementById('chat-live');
    if (liveEl) liveEl.classList.remove('visible');

    if (state.subscribedKey) {
      sendWs({ type: 'chat-unsubscribe', sessionKey: state.subscribedKey });
      if (state.currentSession && state.currentSession.sessionId) {
        sendWs({ type: 'unsubscribe-log', sessionId: state.currentSession.sessionId });
      }
    }

    state.currentSession = { agentId, sessionId: sessionId || '', label, sessionKey };
    state.subscribedKey = sessionKey;
    localStorage.setItem('hud-chat-session', JSON.stringify(state.currentSession));

    const messagesEl = document.getElementById('chat-messages');
    if (messagesEl) {
      while (messagesEl.firstChild) messagesEl.removeChild(messagesEl.firstChild);
      // Clear ready state so tests can wait for fresh content
      delete messagesEl.dataset.ready;
      const loading = document.createElement('div');
      loading.className = 'chat-loading';
      loading.textContent = 'Loading...';
      messagesEl.appendChild(loading);
    }

    state.activeRuns.clear();
    if (window.ChatWsHandler) window.ChatWsHandler.updateButtons();

    hudDiagLog(CHAT_LOG_PREFIX, 'history_request', {
      agentId: agentId,
      sessionId: sessionId || '',
      sessionKey: sessionKey
    });
    sendWs({ type: 'chat-subscribe', sessionKey });
    sendWs({ type: 'chat-history', sessionKey });
    startHistoryLoadTimer(sessionKey);
  };

  window.closeChatPane = function() {
    clearHistoryLoadTimer();
    const state = window.ChatState;
    const layout = document.querySelector('.hud-layout');
    if (layout) layout.classList.remove('chat-open');

    if (state.subscribedKey) {
      sendWs({ type: 'chat-unsubscribe', sessionKey: state.subscribedKey });
      if (state.currentSession) {
        sendWs({ type: 'unsubscribe-log', sessionId: state.currentSession.sessionId });
      }
      state.subscribedKey = null;
    }
    state.currentSession = null;
    state.activeRuns.clear();
    
    // Clean up virtual scroller and other resources (guard against null)
    try { if (window.VirtualScroller) window.VirtualScroller.destroy(); } catch(e) {}
    try { if (window.ProgressiveToolRenderer) window.ProgressiveToolRenderer.destroy(); } catch(e) {}
    try { if (window.WebSocketMessageBatcher) window.WebSocketMessageBatcher.destroy(); } catch(e) {}

    if (window.ChatWsHandler) window.ChatWsHandler.updateButtons();
    localStorage.removeItem('hud-chat-session');
  };

  window.restoreSavedChatSession = function(sessions) {
    let savedRaw = null;
    try {
      savedRaw = localStorage.getItem('hud-chat-session');
    } catch (e) {
      return false;
    }
    if (!savedRaw) return false;

    let saved = null;
    try {
      saved = JSON.parse(savedRaw);
    } catch (e) {
      localStorage.removeItem('hud-chat-session');
      return false;
    }

    const savedSessionKey = saved && saved.sessionKey;
    if (!isCanonicalSessionKey(savedSessionKey)) {
      localStorage.removeItem('hud-chat-session');
      return false;
    }

    const list = Array.isArray(sessions) ? sessions : [];
    const matched = list.find(function(session) {
      return session && session.sessionKey === savedSessionKey;
    });
    if (!matched || !isCanonicalSessionKey(matched.sessionKey)) {
      localStorage.removeItem('hud-chat-session');
      return false;
    }

    const agentId = matched.agentId || saved.agentId;
    if (!agentId) {
      localStorage.removeItem('hud-chat-session');
      return false;
    }

    const sessionId = matched.sessionId || saved.sessionId || '';
    const label = matched.label || saved.label || '';
    window.openChatPane(agentId, sessionId, label, matched.sessionKey);
    return true;
  };

  window.handleChatWsMessage = function(data) {
    const state = window.ChatState;
    if (data && data.type === 'chat-history-result') {
      const currentSessionKey = state.currentSession ? state.currentSession.sessionKey : '';
      const isMatch = !!(state.currentSession && data.sessionKey === currentSessionKey);
      hudDiagLog(CHAT_LOG_PREFIX, 'history_result_received', {
        sessionKey: data.sessionKey || '',
        currentSessionKey: currentSessionKey || '',
        matched: isMatch
      });
      if (isMatch) {
        clearHistoryLoadTimer();
        const container = document.getElementById('chat-messages');
        if (container) {
          const warning = container.querySelector('.chat-history-warning');
          const warningCleared = !!warning;
          if (warning) warning.remove();
          hudDiagLog(CHAT_LOG_PREFIX, 'history_result_matched', {
            sessionKey: data.sessionKey || '',
            warningCleared: warningCleared
          });
        }
      }
    }
    if (window.ChatWsHandler) window.ChatWsHandler.handle(data);
  };

  // Close button
  document.addEventListener('click', function(e) {
    if (e.target.id === 'chat-close') window.closeChatPane();
  });

  // Pill click
  document.addEventListener('click', function(e) {
    if (e.target.id === 'chat-new-pill') {
      const container = document.getElementById('chat-messages');
      if (container) container.scrollTop = container.scrollHeight;
      e.target.classList.remove('visible');
    }
  });

  // Escape key — only close if chat pane is actually open
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      if (e.defaultPrevented) return;
      const activeModal = document.querySelector('.modal-overlay.active');
      if (!activeModal && window.ChatState.subscribedKey) window.closeChatPane();
    }
  });
})();

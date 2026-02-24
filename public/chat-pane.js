// Chat Pane Module — main controller, state, and WS dispatch
(function() {
  'use strict';
  const CHAT_LOG_PREFIX = '[HUD-CHAT]';
  const normalizeLabel = (window.HUD && HUD.labelSanitizer && typeof HUD.labelSanitizer.normalizeLabel === 'function')
    ? HUD.labelSanitizer.normalizeLabel
    : function(value, fallback) {
      if (value == null) return fallback || '';
      return String(value);
    };

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

  function getSenderResolver() {
    return window.ChatSenderResolver && typeof window.ChatSenderResolver.resolveChatSenderDisplay === 'function'
      ? window.ChatSenderResolver
      : null;
  }

  function findSessionMetadata(agentId, sessionId, sessionKey) {
    const sessions = Array.isArray(window._allSessions) ? window._allSessions : [];
    let match = null;
    for (const session of sessions) {
      if (!session || typeof session !== 'object') continue;
      if (session.sessionKey === sessionKey) {
        match = session;
        break;
      }
    }
    if (!match && agentId && sessionId) {
      for (const session of sessions) {
        if (!session || typeof session !== 'object') continue;
        if (session.agentId === agentId && session.sessionId === sessionId) {
          match = session;
          break;
        }
      }
    }
    return match;
  }

  function enrichSessionMetadata(agentId, sessionId, label, sessionKey) {
    const sessionMeta = findSessionMetadata(agentId, sessionId, sessionKey) || {};
    const resolver = getSenderResolver();
    const resolveTarget = Object.assign({}, sessionMeta, {
      agentId: sessionMeta.agentId || agentId,
      sessionId: sessionMeta.sessionId || sessionId || '',
      sessionKey: sessionMeta.sessionKey || sessionKey || '',
      label: sessionMeta.label || label || '',
      spawnDepth: sessionMeta.spawnDepth,
      spawnedBy: sessionMeta.spawnedBy
    });

    const sender = resolver ? resolver.resolveChatSenderDisplay(resolveTarget) : {
      displayName: label || normalizeLabel(label, agentId),
      role: (typeof sessionMeta.spawnDepth === 'number' && sessionMeta.spawnDepth > 0) ? 'subagent' :
        (typeof sessionMeta.spawnedBy === 'string' && sessionMeta.spawnedBy) ? 'subagent' :
          (typeof sessionMeta.spawnDepth === 'number' && sessionMeta.spawnDepth === 0 ? 'main' : 'unknown'),
      alias: normalizeLabel(sessionMeta.label || label, null) || null,
      model: sessionMeta.model || null
    };

    return {
      sessionMeta: sessionMeta,
      currentSession: {
        agentId,
        sessionId: sessionId || '',
        label,
        sessionKey,
        spawnDepth: sessionMeta.spawnDepth,
        spawnedBy: sessionMeta.spawnedBy || null,
        sessionRole: sender.role,
        sessionAlias: sender.alias || null,
        model: sender.model || null,
      }
    };
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
    currentMessages: [],
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
    if (!agentId) return;
    if (!isCanonicalSessionKey(sessionKey)) {
      throw new Error('openChatPane requires canonical sessionKey from /api/sessions');
    }
    const displaySessionId = sessionId || sessionKey.split(':').slice(2).join(':');
    clearHistoryLoadTimer();
    const state = window.ChatState;

    if (state.subscribedKey === sessionKey) return;

    const layout = document.querySelector('.hud-layout');
    if (layout) layout.classList.add('chat-open');

    const titleEl = document.getElementById('chat-title');
    if (titleEl) titleEl.textContent = agentId + ' // ' + normalizeLabel(label, displaySessionId.slice(0, 8));

    // Create or update export button
    let exportBtn = document.getElementById('chat-export-btn');
    if (!exportBtn) {
      exportBtn = document.createElement('button');
      exportBtn.id = 'chat-export-btn';
      exportBtn.className = 'chat-export-btn';
      exportBtn.setAttribute('aria-label', 'Export session to markdown');
      exportBtn.title = 'Export session to markdown';
      exportBtn.textContent = '⬇ Export';
      exportBtn.onclick = function() {
        window.exportChatSession();
      };
      const header = document.querySelector('.chat-header');
      const closeBtn = document.getElementById('chat-close');
      if (header && closeBtn) {
        header.insertBefore(exportBtn, closeBtn);
      }
    }

    const liveEl = document.getElementById('chat-live');
    if (liveEl) liveEl.classList.remove('visible');

    if (state.subscribedKey) {
      sendWs({ type: 'chat-unsubscribe', sessionKey: state.subscribedKey });
      if (state.currentSession && state.currentSession.sessionId) {
        sendWs({ type: 'unsubscribe-log', sessionId: state.currentSession.sessionId });
      }
    }

    const enriched = enrichSessionMetadata(agentId, sessionId, label, sessionKey);
    state.currentSession = Object.assign({}, enriched.currentSession);
    state.subscribedKey = sessionKey;
    state.currentMessages = [];
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
    
    // Clean up virtual scroller and other resources
    if (window.VirtualScroller) {
      window.VirtualScroller.destroy();
    }
    if (window.ProgressiveToolRenderer) {
      window.ProgressiveToolRenderer.destroy();
    }
    if (window.WebSocketMessageBatcher) {
      window.WebSocketMessageBatcher.destroy();
    }
    
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

  // Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      if (e.defaultPrevented) return;
      const activeModal = document.querySelector('.modal-overlay.active');
      if (!activeModal && window.ChatState && window.ChatState.subscribedKey) window.closeChatPane();
    }
  });

  // Message caching helpers
  const MAX_CACHED_MESSAGES = 500;
  const DEDUP_RECENT_WINDOW = 10;

  window.ChatState.addMessage = function(msg) {
    if (!msg || !msg.role) return;
    const messages = window.ChatState.currentMessages;
    // Check for duplicates - only check recent messages (within last 10)
    // Duplicates from streaming typically arrive back-to-back
    const startIndex = Math.max(0, messages.length - DEDUP_RECENT_WINDOW);
    const isDuplicate = messages.slice(startIndex).some(function(existing) {
      if (existing.timestamp && msg.timestamp && existing.timestamp === msg.timestamp) {
        return true;
      }
      // Compare content if no timestamp match
      const existingContent = typeof existing.content === 'string' ? existing.content : JSON.stringify(existing.content);
      const msgContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      return existing.role === msg.role && existingContent === msgContent;
    });
    if (!isDuplicate) {
      messages.push(msg);
      // Cap the cache size - evict oldest messages if over limit
      if (messages.length > MAX_CACHED_MESSAGES) {
        messages.splice(0, messages.length - MAX_CACHED_MESSAGES);
      }
    }
  };

  window.ChatState.setMessages = function(messages) {
    if (!Array.isArray(messages)) {
      window.ChatState.currentMessages = [];
      return;
    }
    // Cap the cache to MAX_CACHED_MESSAGES, keeping the most recent
    if (messages.length > MAX_CACHED_MESSAGES) {
      window.ChatState.currentMessages = messages.slice(messages.length - MAX_CACHED_MESSAGES);
    } else {
      window.ChatState.currentMessages = messages.slice();
    }
  };

  // Export session to markdown
  window.exportChatSession = function() {
    const state = window.ChatState;
    if (!state.currentMessages || state.currentMessages.length === 0) {
      alert('No messages to export');
      return;
    }

    const session = state.currentSession;
    const sessionLabel = session ? normalizeLabel(session.label, session.sessionKey || 'chat') : 'chat';
    const sessionTitle = session ? sessionLabel : 'chat';

    let markdown = '# ' + sessionTitle + '\n\n';

    var userMessage = null;
    state.currentMessages.forEach(function(msg) {
      if (msg.role === 'user') {
        userMessage = msg;
      } else if (msg.role === 'assistant') {
        if (userMessage) {
          markdown += '## User\n';
          markdown += window.ChatMessage.extractText(userMessage) + '\n\n';
          userMessage = null;
        }
        markdown += '## Assistant\n';
        var content = msg.content;
        if (Array.isArray(content)) {
          markdown += window.CopyUtils.buildContentBlocksMarkdown(content);
        } else {
          markdown += window.ChatMessage.extractText(msg) + '\n';
        }
        markdown += '\n';
      }
    });

    // Handle orphaned user message at end
    if (userMessage) {
      markdown += '## User\n';
      markdown += window.ChatMessage.extractText(userMessage) + '\n\n';
    }

    // Trigger download
    var blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = sessionTitle + '.md';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
})();

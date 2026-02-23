// Chat Pane Module — main controller, state, and WS dispatch
(function() {
  'use strict';

  const _wsQueue = [];

  function sendWs(msg) {
    if (window._hudWs && window._hudWs.readyState === WebSocket.OPEN) {
      window._hudWs.send(JSON.stringify(msg));
    } else {
      _wsQueue.push(msg);
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
    while (_wsQueue.length > 0) {
      const msg = _wsQueue.shift();
      if (window._hudWs && window._hudWs.readyState === WebSocket.OPEN) {
        window._hudWs.send(JSON.stringify(msg));
      } else {
        _wsQueue.unshift(msg);
        break;
      }
    }
  };

  function updateButtons() {
    const sendBtn = document.getElementById('chat-send-btn');
    const stopBtn = document.getElementById('chat-stop-btn');
    if (!sendBtn || !stopBtn) return;
    const state = window.ChatState;
    if (state.activeRuns.size > 0) {
      sendBtn.style.display = 'none';
      stopBtn.style.display = '';
    } else {
      sendBtn.style.display = '';
      stopBtn.style.display = 'none';
    }
  }

  window.openChatPane = function(agentId, sessionId, label) {
    if (!agentId || !sessionId) return;
    const state = window.ChatState;

    const sessionKey = 'agent:' + agentId + ':' + sessionId;
    if (state.subscribedKey === sessionKey) return;

    const layout = document.querySelector('.hud-layout');
    if (layout) layout.classList.add('chat-open');

    const titleEl = document.getElementById('chat-title');
    if (titleEl) titleEl.textContent = agentId + ' // ' + (label || sessionId.slice(0, 8));

    const liveEl = document.getElementById('chat-live');
    if (liveEl) liveEl.classList.remove('visible');

    // Unsubscribe previous
    if (state.subscribedKey) {
      sendWs({ type: 'chat-unsubscribe', sessionKey: state.subscribedKey });
      if (state.currentSession) {
        sendWs({ type: 'unsubscribe-log', sessionId: state.currentSession.sessionId });
      }
    }

    state.currentSession = { agentId: agentId, sessionId: sessionId, label: label, sessionKey: sessionKey };
    state.subscribedKey = sessionKey;
    localStorage.setItem('hud-chat-session', JSON.stringify(state.currentSession));

    // Clear and show loading (I-3: no innerHTML)
    const messagesEl = document.getElementById('chat-messages');
    if (messagesEl) {
      while (messagesEl.firstChild) messagesEl.removeChild(messagesEl.firstChild);
      const loading = document.createElement('div');
      loading.className = 'chat-loading';
      loading.textContent = 'Loading...';
      messagesEl.appendChild(loading);
    }

    state.activeRuns.clear();
    updateButtons();

    sendWs({ type: 'chat-subscribe', sessionKey: sessionKey });
    sendWs({ type: 'chat-history', sessionKey: sessionKey });
  };

  window.closeChatPane = function() {
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
    updateButtons();
    localStorage.removeItem('hud-chat-session');
  };

  window.handleChatWsMessage = function(data) {
    if (!data || !data.type) return;
    const state = window.ChatState;

    if (data.type === 'subscribed') {
      if (state.currentSession && data.sessionId === state.currentSession.sessionId) {
        const liveEl = document.getElementById('chat-live');
        if (liveEl) liveEl.classList.add('visible');
      }
      return;
    }

    if (data.type === 'chat-subscribe-ack') {
      if (state.currentSession && data.sessionKey === state.currentSession.sessionKey) {
        const liveEl = document.getElementById('chat-live');
        if (liveEl) liveEl.classList.add('visible');
      }
      return;
    }

    if (data.type === 'chat-history-result') {
      if (!state.currentSession || data.sessionKey !== state.currentSession.sessionKey) return;
      const container = document.getElementById('chat-messages');
      if (!container) return;
      const loading = container.querySelector('.chat-loading');
      if (loading) loading.remove();
      // I-5: handle errors
      if (data.error) {
        const errDiv = document.createElement('div');
        errDiv.className = 'chat-loading';
        errDiv.textContent = 'Error loading history: ' + (data.error.message || data.error);
        container.appendChild(errDiv);
        return;
      }
      (data.messages || []).forEach(function(msg) {
        container.appendChild(window.ChatMessage.renderHistoryMessage(msg));
      });
      container.scrollTop = container.scrollHeight;
      return;
    }

    if (data.type === 'chat-event') {
      const p = data.payload;
      if (!p || !state.currentSession || p.sessionKey !== state.currentSession.sessionKey) return;
      const container = document.getElementById('chat-messages');
      if (!container) return;

      if (p.state === 'delta' || p.state === 'final') {
        let run = state.activeRuns.get(p.runId);
        if (!run) {
          const el = window.ChatMessage.createAssistantStreamEl();
          container.appendChild(el);
          run = { el: el, lastSeq: 0 };
          state.activeRuns.set(p.runId, run);
        }
        if (p.seq && p.seq > run.lastSeq + 1 && run.lastSeq > 0) {
          console.warn('Gap detected: expected seq ' + (run.lastSeq + 1) + ' got ' + p.seq);
        }
        if (p.seq) run.lastSeq = p.seq;
        if (p.message) {
          const text = window.ChatMessage.extractText(p.message);
          const contentEl = run.el.querySelector('.chat-msg-content');
          if (contentEl) contentEl.textContent = text;
        }
        if (p.state === 'final') {
          run.el.classList.remove('streaming');
          run.el.classList.add('final');
          state.activeRuns.delete(p.runId);
        }
        updateButtons();
        container.scrollTop = container.scrollHeight;
        return;
      }

      if (p.state === 'error') {
        const errEl = document.createElement('div');
        errEl.className = 'chat-msg error';
        errEl.textContent = p.errorMessage || 'Unknown error';
        // C-2: retry button with click handler
        const retryBtn = document.createElement('button');
        retryBtn.className = 'retry-btn';
        retryBtn.textContent = 'Retry';
        if (state.currentSession) {
          retryBtn.dataset.sessionKey = state.currentSession.sessionKey;
        }
        retryBtn.onclick = function() {
          errEl.remove();
          const newKey = crypto.randomUUID();
          const div = document.createElement('div');
          div.className = 'chat-msg user pending';
          const roleSpan = document.createElement('span');
          roleSpan.className = 'chat-msg-role user';
          roleSpan.textContent = 'user';
          div.appendChild(roleSpan);
          const contentDiv = document.createElement('div');
          contentDiv.className = 'chat-msg-content';
          contentDiv.textContent = '(retry)';
          div.appendChild(contentDiv);
          if (container) container.appendChild(div);
          sendWs({ type: 'chat-send', sessionKey: this.dataset.sessionKey, message: '(retry)', idempotencyKey: newKey });
        };
        errEl.appendChild(retryBtn);
        container.appendChild(errEl);
        state.activeRuns.delete(p.runId);
        updateButtons();
        return;
      }

      if (p.state === 'aborted') {
        const run2 = state.activeRuns.get(p.runId);
        if (run2) {
          run2.el.classList.remove('streaming');
          run2.el.classList.add('aborted');
          const badge = document.createElement('span');
          badge.className = 'chat-aborted-badge';
          badge.textContent = 'Aborted: ' + (p.stopReason || 'unknown');
          run2.el.appendChild(badge);
          state.activeRuns.delete(p.runId);
        }
        updateButtons();
        return;
      }
      return;
    }

    if (data.type === 'chat-send-ack') {
      const ack = state.pendingAcks.get(data.idempotencyKey);
      if (!ack) return;
      state.pendingAcks.delete(data.idempotencyKey);
      const input = document.getElementById('chat-input');
      if (input) input.disabled = false;
      if (data.ok) {
        ack.el.classList.remove('pending');
      } else {
        ack.el.classList.remove('pending');
        ack.el.classList.add('failed');
        // C-2: retry button with click handler
        const retryBtn = document.createElement('button');
        retryBtn.className = 'retry-btn';
        retryBtn.textContent = 'Retry';
        retryBtn.dataset.sessionKey = state.currentSession ? state.currentSession.sessionKey : '';
        retryBtn.dataset.message = ack.message || '';
        retryBtn.onclick = function() {
          ack.el.remove();
          const newKey = crypto.randomUUID();
          const div = document.createElement('div');
          div.className = 'chat-msg user pending';
          const roleSpan = document.createElement('span');
          roleSpan.className = 'chat-msg-role user';
          roleSpan.textContent = 'user';
          div.appendChild(roleSpan);
          const contentDiv = document.createElement('div');
          contentDiv.className = 'chat-msg-content';
          contentDiv.textContent = this.dataset.message;
          div.appendChild(contentDiv);
          const container = document.getElementById('chat-messages');
          if (container) container.appendChild(div);
          sendWs({ type: 'chat-send', sessionKey: this.dataset.sessionKey, message: this.dataset.message, idempotencyKey: newKey });
        };
        ack.el.appendChild(retryBtn);
      }
      return;
    }

    if (data.type === 'gateway-status') {
      const banner = document.getElementById('gateway-banner');
      if (!banner) return;
      if (data.status === 'disconnected') {
        banner.style.display = 'block';
      } else if (data.status === 'connected') {
        banner.style.display = 'none';
        if (state.currentSession) {
          sendWs({ type: 'chat-subscribe', sessionKey: state.currentSession.sessionKey });
          sendWs({ type: 'chat-history', sessionKey: state.currentSession.sessionKey });
        }
      }
      return;
    }

    if (data.type === 'models-list-result') {
      state.cachedModels = data.models;
      window.ChatInput.renderModelPicker(data.models);
      return;
    }

    if (data.type === 'chat-new-result') {
      if (data.ok && data.sessionKey) {
        const parts = data.sessionKey.split(':');
        if (parts.length >= 3) {
          window.openChatPane(parts[1], parts.slice(2).join(':'), '');
        }
      }
      return;
    }

    if (data.type === 'log-entry') {
      if (!state.currentSession) return;
      if (data.agentId !== state.currentSession.agentId || data.sessionId !== state.currentSession.sessionId) return;
      const container = document.getElementById('chat-messages');
      if (!container) return;
      const entry = data.entry || data;
      container.appendChild(window.ChatMessage.renderHistoryMessage({
        role: entry.role || 'system',
        content: typeof entry.content === 'string' ? [{ type: 'text', text: entry.content }] : entry.content || []
      }));
      container.scrollTop = container.scrollHeight;
      return;
    }
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
      const activeModal = document.querySelector('.modal-overlay.active');
      if (!activeModal) window.closeChatPane();
    }
  });

  // Restore from localStorage
  document.addEventListener('DOMContentLoaded', function() {
    try {
      const saved = localStorage.getItem('hud-chat-session');
      if (saved) {
        const s = JSON.parse(saved);
        if (s.agentId && s.sessionId) {
          window.openChatPane(s.agentId, s.sessionId, s.label || '');
        }
      }
    } catch(e) { /* ignore */ }
  });
})();

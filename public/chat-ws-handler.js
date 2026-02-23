// Chat WS Message Handler — processes incoming WebSocket messages
(function() {
  'use strict';
  function handleSubscribed(data, state) {
    if (state.currentSession && data.sessionId === state.currentSession.sessionId) {
      var liveEl = document.getElementById('chat-live');
      if (liveEl) liveEl.classList.add('visible');
    }
  }
  function handleSubscribeAck(data, state) {
    if (state.currentSession && data.sessionKey === state.currentSession.sessionKey) {
      var liveEl = document.getElementById('chat-live');
      if (liveEl) liveEl.classList.add('visible');
    }
  }
  function handleHistoryResult(data, state) {
    if (!state.currentSession || data.sessionKey !== state.currentSession.sessionKey) return;
    var container = document.getElementById('chat-messages');
    if (!container) return;
    var loading = container.querySelector('.chat-loading');
    if (loading) loading.remove();
    if (data.error) {
      var errDiv = document.createElement('div');
      errDiv.className = 'chat-loading';
      errDiv.textContent = 'Error loading history: ' + (data.error.message || data.error);
      container.appendChild(errDiv);
      return;
    }
    (data.messages || []).forEach(function(msg) {
      container.appendChild(window.ChatMessage.renderHistoryMessage(msg));
    });
    container.scrollTop = container.scrollHeight;
  }
  function handleChatEvent(data, state, updateButtons) {
    var p = data.payload;
    if (!p || !state.currentSession || p.sessionKey !== state.currentSession.sessionKey) return;
    var container = document.getElementById('chat-messages');
    if (!container) return;
    if (p.state === 'delta' || p.state === 'final') {
      var run = state.activeRuns.get(p.runId);
      if (!run) {
        var el = window.ChatMessage.createAssistantStreamEl();
        container.appendChild(el);
        run = { el: el, lastSeq: 0 };
        state.activeRuns.set(p.runId, run);
      }
      if (p.seq && p.seq > run.lastSeq + 1 && run.lastSeq > 0) {
        console.warn('Gap detected: expected seq ' + (run.lastSeq + 1) + ' got ' + p.seq);
      }
      if (p.seq) run.lastSeq = p.seq;
      if (p.message) {
        var text = window.ChatMessage.extractText(p.message);
        var contentEl = run.el.querySelector('.chat-msg-content');
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
      var errEl = document.createElement('div');
      errEl.className = 'chat-msg error';
      errEl.textContent = p.errorMessage || 'Unknown error';
      var retryBtn = document.createElement('button');
      retryBtn.className = 'retry-btn';
      retryBtn.textContent = 'Retry';
      if (state.currentSession) {
        retryBtn.dataset.sessionKey = state.currentSession.sessionKey;
      }
      retryBtn.onclick = function() {
        errEl.remove();
        var newKey = crypto.randomUUID();
        var div = document.createElement('div');
        div.className = 'chat-msg user pending';
        var roleSpan = document.createElement('span');
        roleSpan.className = 'chat-msg-role user';
        roleSpan.textContent = 'user';
        div.appendChild(roleSpan);
        var contentDiv = document.createElement('div');
        contentDiv.className = 'chat-msg-content';
        contentDiv.textContent = '(retry)';
        div.appendChild(contentDiv);
        if (container) container.appendChild(div);
        state.sendWs({ type: 'chat-send', sessionKey: this.dataset.sessionKey, message: '(retry)', idempotencyKey: newKey });
      };
      errEl.appendChild(retryBtn);
      container.appendChild(errEl);
      state.activeRuns.delete(p.runId);
      updateButtons();
      return;
    }
    if (p.state === 'aborted') {
      var run2 = state.activeRuns.get(p.runId);
      if (run2) {
        run2.el.classList.remove('streaming');
        run2.el.classList.add('aborted');
        var badge = document.createElement('span');
        badge.className = 'chat-aborted-badge';
        badge.textContent = 'Aborted: ' + (p.stopReason || 'unknown');
        run2.el.appendChild(badge);
        state.activeRuns.delete(p.runId);
      }
      updateButtons();
    }
  }
  function handleSendAck(data, state) {
    var ack = state.pendingAcks.get(data.idempotencyKey);
    if (!ack) return;
    state.pendingAcks.delete(data.idempotencyKey);
    var input = document.getElementById('chat-input');
    if (input) input.disabled = false;
    if (data.ok) {
      ack.el.classList.remove('pending');
    } else {
      ack.el.classList.remove('pending');
      ack.el.classList.add('failed');
      var retryBtn = document.createElement('button');
      retryBtn.className = 'retry-btn';
      retryBtn.textContent = 'Retry';
      retryBtn.dataset.sessionKey = state.currentSession ? state.currentSession.sessionKey : '';
      retryBtn.dataset.message = ack.message || '';
      retryBtn.onclick = function() {
        ack.el.remove();
        var newKey = crypto.randomUUID();
        var div = document.createElement('div');
        div.className = 'chat-msg user pending';
        var roleSpan = document.createElement('span');
        roleSpan.className = 'chat-msg-role user';
        roleSpan.textContent = 'user';
        div.appendChild(roleSpan);
        var contentDiv = document.createElement('div');
        contentDiv.className = 'chat-msg-content';
        contentDiv.textContent = this.dataset.message;
        div.appendChild(contentDiv);
        var container = document.getElementById('chat-messages');
        if (container) container.appendChild(div);
        state.sendWs({ type: 'chat-send', sessionKey: this.dataset.sessionKey, message: this.dataset.message, idempotencyKey: newKey });
      };
      ack.el.appendChild(retryBtn);
    }
  }
  function handleGatewayStatus(data, state) {
    var banner = document.getElementById('gateway-banner');
    if (!banner) return;
    if (data.status === 'disconnected') {
      banner.style.display = 'block';
    } else if (data.status === 'connected') {
      banner.style.display = 'none';
      if (state.currentSession) {
        state.sendWs({ type: 'chat-subscribe', sessionKey: state.currentSession.sessionKey });
        state.sendWs({ type: 'chat-history', sessionKey: state.currentSession.sessionKey });
      }
    }
  }
  function handleLogEntry(data, state) {
    if (!state.currentSession) return;
    if (data.agentId !== state.currentSession.agentId || data.sessionId !== state.currentSession.sessionId) return;
    var container = document.getElementById('chat-messages');
    if (!container) return;
    var entry = data.entry || data;
    container.appendChild(window.ChatMessage.renderHistoryMessage({
      role: entry.role || 'system',
      content: typeof entry.content === 'string' ? [{ type: 'text', text: entry.content }] : entry.content || []
    }));
    container.scrollTop = container.scrollHeight;
  }
  window.ChatWsHandler = {
    handle: function(data, updateButtons) {
      if (!data || !data.type) return;
      var state = window.ChatState;
      switch (data.type) {
        case 'subscribed': return handleSubscribed(data, state);
        case 'chat-subscribe-ack': return handleSubscribeAck(data, state);
        case 'chat-history-result': return handleHistoryResult(data, state);
        case 'chat-event': return handleChatEvent(data, state, updateButtons);
        case 'chat-send-ack': return handleSendAck(data, state);
        case 'gateway-status': return handleGatewayStatus(data, state);
        case 'models-list-result':
          state.cachedModels = data.models;
          window.ChatInput.renderModelPicker(data.models);
          return;
        case 'chat-new-result':
          if (data.ok && data.sessionKey) {
            var parts = data.sessionKey.split(':');
            if (parts.length >= 3) {
              window.openChatPane(parts[1], parts.slice(2).join(':'), '');
            }
          }
          return;
        case 'log-entry': return handleLogEntry(data, state);
      }
    }
  };
})();

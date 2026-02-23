// Chat Pane Module — streaming chat with gateway WebSocket
(function() {
  'use strict';

  let currentSession = null;
  let subscribedKey = null;
  const activeRuns = new Map();
  const pendingAcks = new Map();
  let cachedModels = null;
  const _wsQueue = [];

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
        _wsQueue.unshift(msg);
        break;
      }
    }
  };

  function updateButtons() {
    const sendBtn = document.getElementById('chat-send-btn');
    const stopBtn = document.getElementById('chat-stop-btn');
    if (!sendBtn || !stopBtn) return;
    if (activeRuns.size > 0) {
      sendBtn.style.display = 'none';
      stopBtn.style.display = '';
    } else {
      sendBtn.style.display = '';
      stopBtn.style.display = 'none';
    }
  }

  function extractText(message) {
    if (typeof message === 'string') return message;
    if (message && Array.isArray(message.content)) {
      return message.content
        .filter(function(b) { return b.type === 'text'; })
        .map(function(b) { return b.text; })
        .join('\n');
    }
    if (message && typeof message.content === 'string') return message.content;
    return String(message || '');
  }

  function createToolBlock(name, content) {
    var wrapper = document.createElement('div');
    wrapper.className = 'chat-tool-block collapsed';
    var header = document.createElement('div');
    header.className = 'chat-tool-block-header';
    header.textContent = '\u25B6 Tool: ' + name;
    header.onclick = function() {
      wrapper.classList.toggle('collapsed');
      header.textContent = wrapper.classList.contains('collapsed')
        ? '\u25B6 Tool: ' + name : '\u25BC Tool: ' + name;
    };
    var body = document.createElement('div');
    body.className = 'tool-block-body';
    body.textContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    wrapper.appendChild(header);
    wrapper.appendChild(body);
    return wrapper;
  }

  function createResultBlock(content) {
    var wrapper = document.createElement('div');
    wrapper.className = 'chat-tool-block collapsed';
    var header = document.createElement('div');
    header.className = 'chat-tool-block-header';
    header.textContent = '\u25B6 Result';
    header.onclick = function() {
      wrapper.classList.toggle('collapsed');
      header.textContent = wrapper.classList.contains('collapsed')
        ? '\u25B6 Result' : '\u25BC Result';
    };
    var body = document.createElement('div');
    body.className = 'tool-block-body';
    body.textContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    wrapper.appendChild(header);
    wrapper.appendChild(body);
    return wrapper;
  }

  function renderHistoryMessage(msg) {
    var div = document.createElement('div');
    var role = msg.role || 'system';
    var roleClass = role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : role === 'tool' ? 'tool' : 'system';
    div.className = 'chat-msg ' + roleClass;

    var roleSpan = document.createElement('span');
    roleSpan.className = 'chat-msg-role ' + roleClass;
    roleSpan.textContent = role;
    div.appendChild(roleSpan);

    var blocks = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content || '') }];
    blocks.forEach(function(block) {
      if (block.type === 'tool_use') {
        div.appendChild(createToolBlock(block.name, block.input));
      } else if (block.type === 'tool_result') {
        div.appendChild(createResultBlock(block.content));
      } else {
        var contentDiv = document.createElement('div');
        contentDiv.className = 'chat-msg-content';
        contentDiv.textContent = block.text || '';
        div.appendChild(contentDiv);
      }
    });
    return div;
  }

  function createAssistantStreamEl() {
    var div = document.createElement('div');
    div.className = 'chat-msg assistant streaming';
    var roleSpan = document.createElement('span');
    roleSpan.className = 'chat-msg-role assistant';
    roleSpan.textContent = 'assistant';
    div.appendChild(roleSpan);
    var contentDiv = document.createElement('div');
    contentDiv.className = 'chat-msg-content';
    div.appendChild(contentDiv);
    return div;
  }

  function sendMessage() {
    if (!currentSession) return;
    var input = document.getElementById('chat-input');
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;

    var idempotencyKey = crypto.randomUUID();
    var div = document.createElement('div');
    div.className = 'chat-msg user pending';
    var roleSpan = document.createElement('span');
    roleSpan.className = 'chat-msg-role user';
    roleSpan.textContent = 'user';
    div.appendChild(roleSpan);
    var contentDiv = document.createElement('div');
    contentDiv.className = 'chat-msg-content';
    contentDiv.textContent = text;
    div.appendChild(contentDiv);

    var container = document.getElementById('chat-messages');
    if (container) container.appendChild(div);

    pendingAcks.set(idempotencyKey, { el: div });
    input.value = '';
    input.disabled = true;

    sendWs({ type: 'chat-send', sessionKey: currentSession.sessionKey, message: text, idempotencyKey: idempotencyKey });
  }

  window.openChatPane = function(agentId, sessionId, label) {
    if (!agentId || !sessionId) return;

    var sessionKey = 'agent:' + agentId + ':' + sessionId;
    if (subscribedKey === sessionKey) return;

    var layout = document.querySelector('.hud-layout');
    if (layout) layout.classList.add('chat-open');

    var titleEl = document.getElementById('chat-title');
    if (titleEl) titleEl.textContent = agentId + ' // ' + (label || sessionId.slice(0, 8));

    var liveEl = document.getElementById('chat-live');
    if (liveEl) liveEl.classList.remove('visible');

    // Unsubscribe previous
    if (subscribedKey) {
      sendWs({ type: 'chat-unsubscribe', sessionKey: subscribedKey });
      // backward compat
      if (currentSession) {
        sendWs({ type: 'unsubscribe-log', sessionId: currentSession.sessionId });
      }
    }

    currentSession = { agentId: agentId, sessionId: sessionId, label: label, sessionKey: sessionKey };
    subscribedKey = sessionKey;
    localStorage.setItem('hud-chat-session', JSON.stringify(currentSession));

    // Clear and show loading
    var messagesEl = document.getElementById('chat-messages');
    if (messagesEl) {
      messagesEl.innerHTML = '';
      var loading = document.createElement('div');
      loading.className = 'chat-loading';
      loading.textContent = 'Loading...';
      messagesEl.appendChild(loading);
    }

    activeRuns.clear();
    updateButtons();

    sendWs({ type: 'chat-subscribe', sessionKey: sessionKey });
    sendWs({ type: 'chat-history', sessionKey: sessionKey });
  };

  window.closeChatPane = function() {
    var layout = document.querySelector('.hud-layout');
    if (layout) layout.classList.remove('chat-open');

    if (subscribedKey) {
      sendWs({ type: 'chat-unsubscribe', sessionKey: subscribedKey });
      if (currentSession) {
        sendWs({ type: 'unsubscribe-log', sessionId: currentSession.sessionId });
      }
      subscribedKey = null;
    }
    currentSession = null;
    activeRuns.clear();
    updateButtons();
    localStorage.removeItem('hud-chat-session');
  };

  window.handleChatWsMessage = function(data) {
    if (!data || !data.type) return;

    // Backward compat: subscribed
    if (data.type === 'subscribed') {
      if (currentSession && data.sessionId === currentSession.sessionId) {
        var liveEl = document.getElementById('chat-live');
        if (liveEl) liveEl.classList.add('visible');
      }
      return;
    }

    if (data.type === 'chat-subscribe-ack') {
      if (currentSession && data.sessionKey === currentSession.sessionKey) {
        var liveEl2 = document.getElementById('chat-live');
        if (liveEl2) liveEl2.classList.add('visible');
      }
      return;
    }

    if (data.type === 'chat-history-result') {
      if (!currentSession || data.sessionKey !== currentSession.sessionKey) return;
      var container = document.getElementById('chat-messages');
      if (!container) return;
      // Remove loading
      var loading = container.querySelector('.chat-loading');
      if (loading) loading.remove();
      (data.messages || []).forEach(function(msg) {
        container.appendChild(renderHistoryMessage(msg));
      });
      container.scrollTop = container.scrollHeight;
      return;
    }

    if (data.type === 'chat-event') {
      var p = data.payload;
      if (!p || !currentSession || p.sessionKey !== currentSession.sessionKey) return;
      var container2 = document.getElementById('chat-messages');
      if (!container2) return;

      if (p.state === 'delta' || p.state === 'final') {
        var run = activeRuns.get(p.runId);
        if (!run) {
          var el = createAssistantStreamEl();
          container2.appendChild(el);
          run = { el: el, lastSeq: 0 };
          activeRuns.set(p.runId, run);
        }
        if (p.seq && p.seq > run.lastSeq + 1 && run.lastSeq > 0) {
          console.warn('Gap detected: expected seq ' + (run.lastSeq + 1) + ' got ' + p.seq);
        }
        if (p.seq) run.lastSeq = p.seq;
        if (p.message) {
          var text = extractText(p.message);
          var contentEl = run.el.querySelector('.chat-msg-content');
          if (contentEl) contentEl.textContent = text;
        }
        if (p.state === 'final') {
          run.el.classList.remove('streaming');
          run.el.classList.add('final');
          activeRuns.delete(p.runId);
        }
        updateButtons();
        container2.scrollTop = container2.scrollHeight;
        return;
      }

      if (p.state === 'error') {
        var errEl = document.createElement('div');
        errEl.className = 'chat-msg error';
        errEl.textContent = p.errorMessage || 'Unknown error';
        var retryBtn = document.createElement('button');
        retryBtn.className = 'retry-btn';
        retryBtn.textContent = 'Retry';
        errEl.appendChild(retryBtn);
        container2.appendChild(errEl);
        activeRuns.delete(p.runId);
        updateButtons();
        return;
      }

      if (p.state === 'aborted') {
        var run2 = activeRuns.get(p.runId);
        if (run2) {
          run2.el.classList.remove('streaming');
          run2.el.classList.add('aborted');
          var badge = document.createElement('span');
          badge.className = 'chat-aborted-badge';
          badge.textContent = 'Aborted: ' + (p.stopReason || 'unknown');
          run2.el.appendChild(badge);
          activeRuns.delete(p.runId);
        }
        updateButtons();
        return;
      }
      return;
    }

    if (data.type === 'chat-send-ack') {
      var ack = pendingAcks.get(data.idempotencyKey);
      if (!ack) return;
      pendingAcks.delete(data.idempotencyKey);
      var input = document.getElementById('chat-input');
      if (input) input.disabled = false;
      if (data.ok) {
        ack.el.classList.remove('pending');
      } else {
        ack.el.classList.remove('pending');
        ack.el.classList.add('failed');
        var retryBtn2 = document.createElement('button');
        retryBtn2.className = 'retry-btn';
        retryBtn2.textContent = 'Retry';
        ack.el.appendChild(retryBtn2);
      }
      return;
    }

    if (data.type === 'gateway-status') {
      var banner = document.getElementById('gateway-banner');
      if (!banner) return;
      if (data.status === 'disconnected') {
        banner.style.display = 'block';
      } else if (data.status === 'connected') {
        banner.style.display = 'none';
        if (currentSession) {
          sendWs({ type: 'chat-subscribe', sessionKey: currentSession.sessionKey });
          sendWs({ type: 'chat-history', sessionKey: currentSession.sessionKey });
        }
      }
      return;
    }

    if (data.type === 'models-list-result') {
      cachedModels = data.models;
      renderModelPicker(data.models);
      return;
    }

    if (data.type === 'chat-new-result') {
      if (data.ok && data.sessionKey) {
        var parts = data.sessionKey.split(':');
        if (parts.length >= 3) {
          window.openChatPane(parts[1], parts.slice(2).join(':'), '');
        }
      }
      return;
    }

    // Backward compat: log-entry
    if (data.type === 'log-entry') {
      if (!currentSession) return;
      if (data.agentId !== currentSession.agentId || data.sessionId !== currentSession.sessionId) return;
      var container3 = document.getElementById('chat-messages');
      if (!container3) return;
      var entry = data.entry || data;
      container3.appendChild(renderHistoryMessage({
        role: entry.role || 'system',
        content: typeof entry.content === 'string' ? [{ type: 'text', text: entry.content }] : entry.content || []
      }));
      container3.scrollTop = container3.scrollHeight;
      return;
    }
  };

  function renderModelPicker(models) {
    var existing = document.querySelector('.model-picker');
    if (existing) existing.remove();
    if (!models || !models.length) return;
    var picker = document.createElement('div');
    picker.className = 'model-picker';
    models.forEach(function(m) {
      var item = document.createElement('div');
      item.className = 'model-picker-item';
      item.textContent = m;
      item.onclick = function() {
        sendWs({ type: 'chat-new', model: m });
        picker.remove();
      };
      picker.appendChild(item);
    });
    var header = document.querySelector('.chat-header');
    if (header) {
      header.style.position = 'relative';
      header.appendChild(picker);
    }
  }

  // Input events
  document.addEventListener('keydown', function(e) {
    if (e.target.id === 'chat-input') {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    }
  });

  // Auto-grow textarea
  document.addEventListener('input', function(e) {
    if (e.target.id === 'chat-input') {
      e.target.style.height = 'auto';
      e.target.style.height = e.target.scrollHeight + 'px';
    }
  });

  // Send button
  document.addEventListener('click', function(e) {
    if (e.target.id === 'chat-send-btn') sendMessage();
  });

  // Stop button
  document.addEventListener('click', function(e) {
    if (e.target.id === 'chat-stop-btn') {
      if (currentSession) sendWs({ type: 'chat-abort', sessionKey: currentSession.sessionKey });
    }
  });

  // Close button
  document.addEventListener('click', function(e) {
    if (e.target.id === 'chat-close') window.closeChatPane();
  });

  // New chat button
  document.addEventListener('click', function(e) {
    if (e.target.id === 'chat-new-btn') {
      if (cachedModels) {
        renderModelPicker(cachedModels);
      } else {
        sendWs({ type: 'models-list' });
      }
    }
  });

  // Pill click
  document.addEventListener('click', function(e) {
    if (e.target.id === 'chat-new-pill') {
      var container = document.getElementById('chat-messages');
      if (container) container.scrollTop = container.scrollHeight;
      e.target.classList.remove('visible');
    }
  });

  // Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      var activeModal = document.querySelector('.modal-overlay.active');
      if (!activeModal) window.closeChatPane();
    }
  });

  // Restore from localStorage
  document.addEventListener('DOMContentLoaded', function() {
    try {
      var saved = localStorage.getItem('hud-chat-session');
      if (saved) {
        var s = JSON.parse(saved);
        if (s.agentId && s.sessionId) {
          window.openChatPane(s.agentId, s.sessionId, s.label || '');
        }
      }
    } catch(e) {}
  });
})();

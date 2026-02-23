// Chat WS Handler — processes incoming WebSocket messages
(function() {
  'use strict';

  function updateButtons() {
    const sendBtn = document.getElementById('chat-send-btn');
    const stopBtn = document.getElementById('chat-stop-btn');
    if (!sendBtn || !stopBtn) return;
    const active = window.ChatState.activeRuns.size > 0;
    sendBtn.style.display = active ? 'none' : '';
    stopBtn.style.display = active ? '' : 'none';
  }

  function showLive(match) {
    if (!match) return;
    const el = document.getElementById('chat-live');
    if (el) el.classList.add('visible');
  }

  function createRetryBtn(sessionKey, message, parentEl) {
    const btn = document.createElement('button');
    btn.className = 'retry-btn';
    btn.textContent = 'Retry';
    btn.dataset.sessionKey = sessionKey || '';
    btn.dataset.message = message || '';
    btn.onclick = function() {
      parentEl.remove();
      const key = crypto.randomUUID();
      const div = document.createElement('div');
      div.className = 'chat-msg user pending';
      const role = document.createElement('span');
      role.className = 'chat-msg-role user';
      role.textContent = 'user';
      div.appendChild(role);
      const content = document.createElement('div');
      content.className = 'chat-msg-content';
      content.textContent = this.dataset.message || '(retry)';
      div.appendChild(content);
      const container = document.getElementById('chat-messages');
      if (container) container.appendChild(div);
      window.ChatState.sendWs({ type: 'chat-send', sessionKey: this.dataset.sessionKey, message: this.dataset.message || '(retry)', idempotencyKey: key });
    };
    return btn;
  }

  function handleHistoryResult(data) {
    const s = window.ChatState;
    if (!s.currentSession || data.sessionKey !== s.currentSession.sessionKey) return;
    const container = document.getElementById('chat-messages');
    if (!container) return;
    const loading = container.querySelector('.chat-loading');
    if (loading) loading.remove();
    
    // Handle error case only if we have no messages to display
    if (data.error && !(data.messages && data.messages.length > 0)) {
      const errDiv = document.createElement('div');
      errDiv.className = 'chat-loading';
      errDiv.textContent = 'Error loading history: ' + (data.error.message || data.error);
      container.appendChild(errDiv);
      // Signal ready state even on error so tests don't hang
      container.dataset.ready = 'true';
      // Announce error to screen readers
      if (window.A11yAnnouncer) {
        window.A11yAnnouncer.announceAssertive('Error loading chat history: ' + (data.error.message || data.error));
      }
      return;
    }
    
    // Render messages
    (data.messages || []).forEach(function(msg) {
      container.appendChild(window.ChatMessage.renderHistoryMessage(msg));
    });
    container.scrollTop = container.scrollHeight;
    
    // Signal that messages are ready for E2E tests
    container.dataset.ready = 'true';
    
    // Announce loaded message
    if (window.A11yAnnouncer) {
      window.A11yAnnouncer.announce('Chat history loaded, ' + (data.messages || []).length + ' messages');
    }
  }

  function handleChatEvent(data) {
    const s = window.ChatState;
    const p = data.payload;
    if (!p || !s.currentSession || p.sessionKey !== s.currentSession.sessionKey) return;
    const container = document.getElementById('chat-messages');
    if (!container) return;
    if (p.state === 'delta' || p.state === 'final') {
      let run = s.activeRuns.get(p.runId);
      if (!run) {
        const el = window.ChatMessage.createAssistantStreamEl();
        container.appendChild(el);
        run = { el: el, lastSeq: 0 };
        s.activeRuns.set(p.runId, run);
      }
      if (p.seq && p.seq > run.lastSeq + 1 && run.lastSeq > 0)
        console.warn('Gap detected: expected seq ' + (run.lastSeq + 1) + ' got ' + p.seq);
      if (p.seq) run.lastSeq = p.seq;
      if (p.message) {
        const contentEl = run.el.querySelector('.chat-msg-content');
        if (contentEl) {
          const text = window.ChatMessage.extractText(p.message);
          if (p.state === 'final' && window.ChatMarkdown) {
            contentEl.innerHTML = window.ChatMarkdown.renderMarkdown(text);
          } else {
            contentEl.textContent = text;
          }
        }
      }
      if (p.state === 'final') {
        run.el.classList.remove('streaming');
        run.el.classList.add('final');
        s.activeRuns.delete(p.runId);
      }
      updateButtons();
      container.scrollTop = container.scrollHeight;
      return;
    }
    if (p.state === 'error') {
      const errEl = document.createElement('div');
      errEl.className = 'chat-msg error';
      errEl.textContent = p.errorMessage || 'Unknown error';
      errEl.appendChild(createRetryBtn(s.currentSession ? s.currentSession.sessionKey : '', '', errEl));
      container.appendChild(errEl);
      s.activeRuns.delete(p.runId);
      updateButtons();
      return;
    }
    if (p.state === 'aborted') {
      const run2 = s.activeRuns.get(p.runId);
      if (run2) {
        run2.el.classList.remove('streaming');
        run2.el.classList.add('aborted');
        const badge = document.createElement('span');
        badge.className = 'chat-aborted-badge';
        badge.textContent = 'Aborted: ' + (p.stopReason || 'unknown');
        run2.el.appendChild(badge);
        s.activeRuns.delete(p.runId);
      }
      updateButtons();
    }
  }

  function handleSendAck(data) {
    const s = window.ChatState;
    const ack = s.pendingAcks.get(data.idempotencyKey);
    if (!ack) return;
    s.pendingAcks.delete(data.idempotencyKey);
    const input = document.getElementById('chat-input');
    if (input) input.disabled = false;
    if (data.ok) {
      ack.el.classList.remove('pending');
    } else {
      ack.el.classList.remove('pending');
      ack.el.classList.add('failed');
      ack.el.appendChild(createRetryBtn(s.currentSession ? s.currentSession.sessionKey : '', ack.message || '', ack.el));
      // Announce error to screen readers
      if (window.A11yAnnouncer) {
        window.A11yAnnouncer.announceAssertive('Message failed to send. Retry button available.');
      }
    }
  }

  function handleGatewayStatus(data) {
    const banner = document.getElementById('gateway-banner');
    if (!banner) return;
    if (data.status === 'disconnected') {
      banner.style.display = 'block';
    } else if (data.status === 'connected') {
      banner.style.display = 'none';
      const s = window.ChatState;
      if (s.currentSession) {
        s.sendWs({ type: 'chat-subscribe', sessionKey: s.currentSession.sessionKey });
        s.sendWs({ type: 'chat-history', sessionKey: s.currentSession.sessionKey });
      }
    }
  }

  function handleLogEntry(data) {
    const s = window.ChatState;
    if (!s.currentSession) return;
    if (data.agentId !== s.currentSession.agentId || data.sessionId !== s.currentSession.sessionId) return;
    const container = document.getElementById('chat-messages');
    if (!container) return;
    const entry = data.entry || data;
    container.appendChild(window.ChatMessage.renderHistoryMessage({
      role: entry.role || 'system',
      content: typeof entry.content === 'string' ? [{ type: 'text', text: entry.content }] : entry.content || []
    }));
    container.scrollTop = container.scrollHeight;
  }

  // Batch processor for chat events
  function processChatEventBatch(batch) {
    const s = window.ChatState;
    const container = document.getElementById('chat-messages');
    if (!container || !s.currentSession) return;
    
    // Process all events in the batch
    const fragment = document.createDocumentFragment();
    let needsScroll = false;
    let hasNewContent = false;
    let assistantMessageCount = 0;
    
    batch.forEach(function(data) {
      if (data.type !== 'chat-event') return;
      
      const p = data.payload;
      if (!p || p.sessionKey !== s.currentSession.sessionKey) return;
      
      if (p.state === 'delta' || p.state === 'final') {
        let run = s.activeRuns.get(p.runId);
        if (!run) {
          const el = window.ChatMessage.createAssistantStreamEl();
          fragment.appendChild(el);
          run = { el: el, lastSeq: 0 };
          s.activeRuns.set(p.runId, run);
          hasNewContent = true;
        }
        if (p.seq && p.seq > run.lastSeq + 1 && run.lastSeq > 0)
          console.warn('Gap detected: expected seq ' + (run.lastSeq + 1) + ' got ' + p.seq);
        if (p.seq) run.lastSeq = p.seq;
        if (p.message) {
          const contentEl = run.el.querySelector('.chat-msg-content');
          if (contentEl) {
            const text = window.ChatMessage.extractText(p.message);
            if (p.state === 'final' && window.ChatMarkdown) {
              contentEl.innerHTML = window.ChatMarkdown.renderMarkdown(text);
            } else {
              contentEl.textContent = text;
            }
          }
        }
        if (p.state === 'final') {
          run.el.classList.remove('streaming');
          run.el.classList.add('final');
          s.activeRuns.delete(p.runId);
          assistantMessageCount++;
        }
        needsScroll = true;
      }
    });
    
    // Append all new elements in one DOM operation
    if (fragment.childNodes.length > 0) {
      container.appendChild(fragment);
    }
    
    // Announce new assistant messages to screen readers (debounced)
    if (assistantMessageCount > 0 && window.A11yAnnouncer) {
      window.A11yAnnouncer.announce(
        assistantMessageCount + ' new assistant message' + (assistantMessageCount > 1 ? 's' : ''),
        'chat-messages',
        500
      );
    }
    
    // Single scroll update
    if (needsScroll) {
      updateButtons();
      container.scrollTop = container.scrollHeight;
    }
  }

  // Initialize batcher when available
  if (window.WebSocketMessageBatcher) {
    window.WebSocketMessageBatcher.initialize(processChatEventBatch);
  }

  window.ChatWsHandler = {
    updateButtons: updateButtons,
    handle: function(data) {
      if (!data || !data.type) return;
      
      // Route chat-events through batcher if available
      if (data.type === 'chat-event' && window.WebSocketMessageBatcher) {
        window.WebSocketMessageBatcher.queue(data);
        return;
      }
      
      const s = window.ChatState;
      switch (data.type) {
        case 'subscribed':
          return showLive(s.currentSession && data.sessionId === s.currentSession.sessionId);
        case 'chat-subscribe-ack':
          return showLive(s.currentSession && data.sessionKey === s.currentSession.sessionKey);
        case 'chat-history-result': return handleHistoryResult(data);
        case 'chat-event': return handleChatEvent(data);
        case 'chat-send-ack': return handleSendAck(data);
        case 'gateway-status': return handleGatewayStatus(data);
        case 'models-list-result':
          s.cachedModels = data.models;
          window.ChatInput.renderModelPicker(data.models);
          return;
        case 'chat-new-result':
          if (data.ok && data.sessionKey) {
            const parts = data.sessionKey.split(':');
            if (parts.length >= 3) window.openChatPane(parts[1], parts.slice(2).join(':'), '', data.sessionKey);
          }
          return;
        case 'log-entry': return handleLogEntry(data);
      }
    },
    // Expose for testing
    processChatEventBatch: processChatEventBatch
  };
})();

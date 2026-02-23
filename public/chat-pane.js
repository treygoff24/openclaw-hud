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

    if (state.subscribedKey) {
      sendWs({ type: 'chat-unsubscribe', sessionKey: state.subscribedKey });
      if (state.currentSession) {
        sendWs({ type: 'unsubscribe-log', sessionId: state.currentSession.sessionId });
      }
    }

    state.currentSession = { agentId, sessionId, label, sessionKey };
    state.subscribedKey = sessionKey;
    localStorage.setItem('hud-chat-session', JSON.stringify(state.currentSession));

    const messagesEl = document.getElementById('chat-messages');
    if (messagesEl) {
      while (messagesEl.firstChild) messagesEl.removeChild(messagesEl.firstChild);
      const loading = document.createElement('div');
      loading.className = 'chat-loading';
      loading.textContent = 'Loading...';
      messagesEl.appendChild(loading);
    }

    state.activeRuns.clear();
    if (window.ChatWsHandler) window.ChatWsHandler.updateButtons();

    sendWs({ type: 'chat-subscribe', sessionKey });
    sendWs({ type: 'chat-history', sessionKey });
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
    if (window.ChatWsHandler) window.ChatWsHandler.updateButtons();
    localStorage.removeItem('hud-chat-session');
  };

  window.handleChatWsMessage = function(data) {
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

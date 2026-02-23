// Chat Input Module — input handling and model picker
(function() {
  'use strict';

  function sendMessage() {
    const state = window.ChatState;
    if (!state.currentSession) return;
    const input = document.getElementById('chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    const idempotencyKey = crypto.randomUUID();
    const div = document.createElement('div');
    div.className = 'chat-msg user pending';
    const roleSpan = document.createElement('span');
    roleSpan.className = 'chat-msg-role user';
    roleSpan.textContent = 'user';
    div.appendChild(roleSpan);
    const contentDiv = document.createElement('div');
    contentDiv.className = 'chat-msg-content';
    contentDiv.textContent = text;
    div.appendChild(contentDiv);

    const container = document.getElementById('chat-messages');
    if (container) container.appendChild(div);

    state.pendingAcks.set(idempotencyKey, { el: div, message: text });
    input.value = '';
    input.disabled = true;

    window.ChatState.sendWs({ type: 'chat-send', sessionKey: state.currentSession.sessionKey, message: text, idempotencyKey: idempotencyKey });
  }

  function renderModelPicker(models) {
    const existing = document.querySelector('.model-picker');
    if (existing) existing.remove();
    if (!models || !models.length) return;
    const picker = document.createElement('div');
    picker.className = 'model-picker';
    models.forEach(function(m) {
      const item = document.createElement('div');
      item.className = 'model-picker-item';
      item.textContent = m;
      item.onclick = function() {
        window.ChatState.sendWs({ type: 'chat-new', model: m });
        picker.remove();
      };
      picker.appendChild(item);
    });
    const header = document.querySelector('.chat-header');
    if (header) {
      header.style.position = 'relative';
      header.appendChild(picker);
    }
  }

  // Input events — Enter sends, Shift+Enter newline
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
      const state = window.ChatState;
      if (state.currentSession) {
        state.sendWs({ type: 'chat-abort', sessionKey: state.currentSession.sessionKey });
      }
    }
  });

  // New chat button
  document.addEventListener('click', function(e) {
    if (e.target.id === 'chat-new-btn') {
      const state = window.ChatState;
      if (state.cachedModels) {
        renderModelPicker(state.cachedModels);
      } else {
        state.sendWs({ type: 'models-list' });
      }
    }
  });

  window.ChatInput = {
    sendMessage: sendMessage,
    renderModelPicker: renderModelPicker,
  };
})();

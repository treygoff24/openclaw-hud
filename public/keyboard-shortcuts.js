// Keyboard Shortcuts Module — D2.3 implementation
(function() {
  'use strict';

  var shortcuts = {
    'Ctrl+Enter': { action: 'send', description: 'Send message' },
    'Ctrl+Shift+Enter': { action: 'stop', description: 'Stop generation' },
    'Ctrl+N': { action: 'new', description: 'New chat' },
    'Escape': { action: 'close', description: 'Close chat pane' },
    'Ctrl+Slash': { action: 'help', description: 'Show shortcuts' },
  };

  var isMac = navigator.platform.toLowerCase().indexOf('mac') >= 0;

  function getShortcutDisplay(shortcut) {
    return isMac 
      ? shortcut.replace('Ctrl', '⌘').replace('Shift', '⇧')
      : shortcut;
  }

  function sendMessage() {
    if (window.ChatInput && window.ChatInput.sendMessage) {
      window.ChatInput.sendMessage();
    }
  }

  function stopGeneration() {
    var state = window.ChatState;
    if (state && state.currentSession) {
      state.sendWs({ type: 'chat-abort', sessionKey: state.currentSession.sessionKey });
    }
  }

  function newChat() {
    var state = window.ChatState;
    if (state && state.cachedModels && window.ChatInput && window.ChatInput.renderModelPicker) {
      window.ChatInput.renderModelPicker(state.cachedModels);
    } else if (state) {
      state.sendWs({ type: 'models-list' });
    }
  }

  function closeChat() {
    if (window.closeChatPane) {
      window.closeChatPane();
    }
  }

  function focusInput() {
    var input = document.getElementById('chat-input');
    if (input) {
      input.focus();
    }
  }

  function showShortcuts() {
    var existing = document.querySelector('.keyboard-shortcuts-overlay');
    if (existing) {
      existing.remove();
      return;
    }

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay keyboard-shortcuts-overlay active';
    
    var content = document.createElement('div');
    content.className = 'modal-content';
    content.style.maxWidth = '400px';
    
    var header = document.createElement('div');
    header.className = 'modal-header';
    header.innerHTML = '<span>Keyboard Shortcuts</span><span class="modal-close">&times;</span>';
    
    var body = document.createElement('div');
    body.className = 'modal-body';
    body.style.padding = '16px';
    
    var list = document.createElement('div');
    list.style.display = 'grid';
    list.style.gridTemplateColumns = 'auto 1fr';
    list.style.gap = '8px 16px';
    list.style.fontFamily = 'var(--font-mono)';
    list.style.fontSize = '12px';
    
    Object.keys(shortcuts).forEach(function(key) {
      var shortcut = shortcuts[key];
      var keyEl = document.createElement('span');
      keyEl.style.color = 'var(--cyan)';
      keyEl.style.whiteSpace = 'nowrap';
      keyEl.textContent = getShortcutDisplay(key);
      
      var descEl = document.createElement('span');
      descEl.style.color = 'var(--text-label)';
      descEl.textContent = shortcut.description;
      
      list.appendChild(keyEl);
      list.appendChild(descEl);
    });
    
    body.appendChild(list);
    content.appendChild(header);
    content.appendChild(body);
    overlay.appendChild(content);
    document.body.appendChild(overlay);
    
    // Close handlers
    overlay.querySelector('.modal-close').onclick = function() { overlay.remove(); };
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
  }

  // Main keyboard handler
  document.addEventListener('keydown', function(e) {
    // Don't trigger shortcuts when typing in inputs (except specific ones)
    var target = e.target;
    var isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
    var isChatInput = target.id === 'chat-input';
    
    // Build shortcut key string
    var keys = [];
    if (e.ctrlKey || e.metaKey) keys.push('Ctrl');
    if (e.altKey) keys.push('Alt');
    if (e.shiftKey) keys.push('Shift');
    
    var key = e.key;
    if (key === '/') key = 'Slash';
    if (key === 'Enter') key = 'Enter';
    if (key === 'Escape') key = 'Escape';
    if (key.length === 1) key = key.toUpperCase();
    
    keys.push(key);
    var shortcut = keys.join('+');
    
    // Chat pane shortcuts
    if (shortcut === 'Ctrl+Enter' && isChatInput) {
      e.preventDefault();
      sendMessage();
      return;
    }
    
    if (shortcut === 'Ctrl+Shift+Enter') {
      e.preventDefault();
      stopGeneration();
      return;
    }
    
    if (shortcut === 'Ctrl+N' && !isInput) {
      e.preventDefault();
      newChat();
      return;
    }
    
    if (shortcut === 'Ctrl+Slash' && !isInput) {
      e.preventDefault();
      showShortcuts();
      return;
    }
    
    // Global shortcuts (work even in inputs)
    if (key === 'Escape') {
      // Close modals first, then chat pane
      var modal = document.querySelector('.modal-overlay.active');
      if (modal) {
        e.preventDefault();
        e.stopImmediatePropagation();
        modal.classList.remove('active');
        if (modal.classList.contains('keyboard-shortcuts-overlay')) {
          modal.remove();
        }
        return;
      }
      
      // Only close chat if not in an input with text
      if (!isInput || (isChatInput && !target.value.trim())) {
        e.preventDefault();
        closeChat();
        return;
      }
    }
  });

  // Export for testing and external access
  window.KeyboardShortcuts = {
    shortcuts: shortcuts,
    showShortcuts: showShortcuts,
    sendMessage: sendMessage,
    stopGeneration: stopGeneration,
    newChat: newChat,
    closeChat: closeChat,
    focusInput: focusInput,
    _getShortcutDisplay: getShortcutDisplay,
  };
})();

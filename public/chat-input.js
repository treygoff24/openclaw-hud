// Chat Input Module — input handling and model picker with slash command autocomplete
(function() {
  'use strict';

  // ============================================
  // Autocomplete State
  // ============================================
  
  let autocompleteDropdown = null;
  let autocompleteItems = [];
  let selectedIndex = -1;
  let currentFilter = '';
  let argumentHints = null;

  // ============================================
  // DOM Element Creation
  // ============================================

  function createAutocompleteDropdown() {
    if (autocompleteDropdown) return autocompleteDropdown;
    
    const input = document.getElementById('chat-input');
    const inputArea = document.getElementById('chat-input-area');
    if (!input || !inputArea) return null;
    
    autocompleteDropdown = document.createElement('div');
    autocompleteDropdown.id = 'slash-autocomplete';
    autocompleteDropdown.className = 'slash-autocomplete';
    autocompleteDropdown.setAttribute('role', 'listbox');
    autocompleteDropdown.setAttribute('aria-label', 'Command suggestions');
    autocompleteDropdown.style.display = 'none';
    
    inputArea.style.position = 'relative';
    inputArea.appendChild(autocompleteDropdown);
    
    return autocompleteDropdown;
  }

  function createArgumentHints() {
    if (argumentHints) return argumentHints;
    
    const inputArea = document.getElementById('chat-input-area');
    if (!inputArea) return null;
    
    argumentHints = document.createElement('div');
    argumentHints.id = 'slash-hints';
    argumentHints.className = 'slash-hints';
    argumentHints.style.display = 'none';
    
    inputArea.appendChild(argumentHints);
    
    return argumentHints;
  }

  function removeAutocomplete() {
    if (autocompleteDropdown) {
      autocompleteDropdown.remove();
      autocompleteDropdown = null;
    }
    autocompleteItems = [];
    selectedIndex = -1;
    currentFilter = '';
  }

  function removeArgumentHints() {
    if (argumentHints) {
      argumentHints.remove();
      argumentHints = null;
    }
  }

  // ============================================
  // Autocomplete Logic
  // ============================================

  function updateAutocomplete(input) {
    const value = input.value;
    const cursorPos = input.selectionStart;
    const textBeforeCursor = value.substring(0, cursorPos);
    
    // Check if we're typing a command
    const slashMatch = textBeforeCursor.match(/\/(\S*)$/);
    
    if (!slashMatch) {
      removeAutocomplete();
      removeArgumentHints();
      return;
    }
    
    currentFilter = slashMatch[1];
    
    // Check if command has been selected (has space after it)
    const hasSelectedCommand = textBeforeCursor.match(/\/\w+\s/);
    
    if (hasSelectedCommand) {
      // Show argument hints instead
      showArgumentHints(input);
      if (autocompleteDropdown) {
        autocompleteDropdown.style.display = 'none';
      }
      return;
    }
    
    // Search for matching commands
    const matches = window.ChatCommands ? window.ChatCommands.search(currentFilter) : [];
    
    if (matches.length === 0) {
      removeAutocomplete();
      return;
    }
    
    renderAutocomplete(matches);
  }

  function renderAutocomplete(commands) {
    const dropdown = createAutocompleteDropdown();
    if (!dropdown) return;
    
    autocompleteItems = commands.slice(0, 8); // Limit to 8 suggestions
    selectedIndex = autocompleteItems.length > 0 ? 0 : -1;
    
    dropdown.innerHTML = '';
    
    autocompleteItems.forEach((cmd, index) => {
      const item = document.createElement('div');
      item.className = 'slash-item';
      if (index === 0) item.classList.add('selected');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
      
      const aliases = cmd.aliases.length > 0 
        ? `<span class="slash-aliases">${cmd.aliases.slice(0, 2).join(', ')}</span>` 
        : '';
      
      const localBadge = cmd.local ? '<span class="slash-local">*</span>' : '';
      
      item.innerHTML = `
        <div class="slash-item-main">
          <span class="slash-name">/${cmd.name}</span>
          ${localBadge}
          ${aliases}
        </div>
        <div class="slash-desc">${cmd.description}</div>
      `;
      
      item.addEventListener('click', function() {
        completeCommand(cmd);
      });
      
      item.addEventListener('mouseenter', function() {
        selectItem(index);
      });
      
      dropdown.appendChild(item);
    });
    
    dropdown.style.display = 'block';
    
    // Position dropdown below input
    const input = document.getElementById('chat-input');
    const inputRect = input.getBoundingClientRect();
    const containerRect = document.getElementById('chat-input-area').getBoundingClientRect();
    
    dropdown.style.position = 'absolute';
    dropdown.style.bottom = (containerRect.height - (inputRect.top - containerRect.top) + inputRect.height + 4) + 'px';
    dropdown.style.left = '0';
    dropdown.style.right = '0';
  }

  function selectItem(index) {
    if (!autocompleteDropdown) return;
    
    const items = autocompleteDropdown.querySelectorAll('.slash-item');
    items.forEach((item, i) => {
      item.classList.toggle('selected', i === index);
      item.setAttribute('aria-selected', i === index ? 'true' : 'false');
    });
    
    selectedIndex = index;
    
    // Scroll selected into view
    if (items[index]) {
      items[index].scrollIntoView({ block: 'nearest' });
    }
  }

  function navigateDown() {
    if (selectedIndex < autocompleteItems.length - 1) {
      selectItem(selectedIndex + 1);
    }
  }

  function navigateUp() {
    if (selectedIndex > 0) {
      selectItem(selectedIndex - 1);
    }
  }

  function completeCommand(cmd) {
    const input = document.getElementById('chat-input');
    if (!input || !cmd) return;
    
    const value = input.value;
    const cursorPos = input.selectionStart;
    const textBeforeCursor = value.substring(0, cursorPos);
    
    // Replace the partial command with the full one
    const newTextBefore = textBeforeCursor.replace(/\/(\S*)$/, '/' + cmd.name + ' ');
    const newValue = newTextBefore + value.substring(cursorPos);
    
    input.value = newValue;
    input.focus();
    
    // Position cursor after command
    const newCursorPos = newTextBefore.length;
    input.setSelectionRange(newCursorPos, newCursorPos);
    
    removeAutocomplete();
    
    // Show argument hints if command has arguments
    if (cmd.args && cmd.args.length > 0) {
      showArgumentHintsForCommand(cmd);
    }
    
    // Trigger input event for auto-resize
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function completeSelected() {
    if (selectedIndex >= 0 && selectedIndex < autocompleteItems.length) {
      completeCommand(autocompleteItems[selectedIndex]);
      return true;
    }
    return false;
  }

  function showArgumentHints(input) {
    const value = input.value;
    const cmdMatch = value.match(/^\/(\w+)/);
    if (!cmdMatch) {
      removeArgumentHints();
      return;
    }
    
    const cmd = window.ChatCommands ? window.ChatCommands.find(cmdMatch[1]) : null;
    if (!cmd) {
      removeArgumentHints();
      return;
    }
    
    showArgumentHintsForCommand(cmd);
  }

  function showArgumentHintsForCommand(cmd) {
    const hints = createArgumentHints();
    if (!hints || !cmd.args || cmd.args.length === 0) {
      removeArgumentHints();
      return;
    }
    
    const argTexts = cmd.args.map(arg => {
      const required = arg.required ? '<span class="hint-required">*</span>' : '';
      const choices = arg.choices ? ` [${arg.choices.join('|')}]` : '';
      return `<span class="hint-arg">&lt;${arg.name}${choices}&gt;${required}</span>`;
    });
    
    hints.innerHTML = `
      <span class="hint-cmd">/${cmd.name}</span>
      <span class="hint-args">${argTexts.join(' ')}</span>
      <span class="hint-close" title="Hide hints">×</span>
    `;
    
    hints.style.display = 'block';
    
    // Add close handler
    const closeBtn = hints.querySelector('.hint-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function() {
        removeArgumentHints();
      });
    }
  }

  // ============================================
  // Message Sending with Slash Command Support
  // ============================================

  function sendMessage() {
    const state = window.ChatState;
    if (!state.currentSession) return;
    
    const input = document.getElementById('chat-input');
    if (!input) return;
    
    const text = input.value.trim();
    if (!text) return;
    
    // Check for slash commands
    if (text.startsWith('/')) {
      const result = window.ChatCommands ? window.ChatCommands.execute(text) : null;
      
      if (result && result.handled && result.local) {
        // Command was handled locally - show result in chat
        showCommandResult(result.result);
        input.value = '';
        input.style.height = 'auto';
        removeAutocomplete();
        removeArgumentHints();
        return;
      }
      
      // Command not handled locally - send to server as regular message
      // (Server may process it as a native command)
    }
    
    // Regular message flow
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
    input.style.height = 'auto';
    input.disabled = true;

    removeAutocomplete();
    removeArgumentHints();

    window.ChatState.sendWs({ type: 'chat-send', sessionKey: state.currentSession.sessionKey, message: text, idempotencyKey: idempotencyKey });
  }

  function showCommandResult(result) {
    if (!result) return;
    
    const container = document.getElementById('chat-messages');
    if (!container) return;
    
    const div = document.createElement('div');
    div.className = 'chat-msg system';
    
    const roleSpan = document.createElement('span');
    roleSpan.className = 'chat-msg-role system';
    roleSpan.textContent = 'system';
    div.appendChild(roleSpan);
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'chat-msg-content';
    
    // Format the result with proper line breaks
    const formatted = result
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    
    contentDiv.innerHTML = `<pre class="command-output">${formatted}</pre>`;
    div.appendChild(contentDiv);
    
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  // ============================================
  // Model Picker
  // ============================================

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

  // ============================================
  // Event Handlers
  // ============================================

  function handleKeyDown(e) {
    if (e.target.id !== 'chat-input') return;
    
    // Handle autocomplete navigation
    if (autocompleteDropdown && autocompleteDropdown.style.display !== 'none') {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          navigateDown();
          return;
        case 'ArrowUp':
          e.preventDefault();
          navigateUp();
          return;
        case 'Tab':
          e.preventDefault();
          if (completeSelected()) {
            return;
          }
          break;
        case 'Enter':
          if (!e.shiftKey) {
            if (completeSelected()) {
              e.preventDefault();
              return;
            }
          }
          break;
        case 'Escape':
          e.preventDefault();
          removeAutocomplete();
          return;
      }
    }
    
    // Handle regular send
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleInput(e) {
    if (e.target.id !== 'chat-input') return;
    
    // Auto-grow textarea
    const input = e.target;
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';
    input.style.overflowY = input.scrollHeight > 160 ? 'auto' : 'hidden';
    
    // Update autocomplete
    updateAutocomplete(input);
  }

  function handleClick(e) {
    if (e.target.id === 'chat-send-btn') {
      sendMessage();
    } else if (e.target.id === 'chat-stop-btn') {
      const state = window.ChatState;
      if (state.currentSession) {
        state.sendWs({ type: 'chat-abort', sessionKey: state.currentSession.sessionKey });
      }
    } else if (e.target.id === 'chat-new-btn') {
      const state = window.ChatState;
      if (state.cachedModels) {
        renderModelPicker(state.cachedModels);
      } else {
        state.sendWs({ type: 'models-list' });
      }
    }
  }

  // ============================================
  // Event Listeners
  // ============================================

  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('input', handleInput);
  document.addEventListener('click', handleClick);

  // Close autocomplete when clicking outside
  document.addEventListener('click', function(e) {
    if (!autocompleteDropdown) return;
    if (!e.target.closest('#chat-input') && !e.target.closest('#slash-autocomplete')) {
      removeAutocomplete();
    }
  });

  // ============================================
  // Public API
  // ============================================

  window.ChatInput = {
    sendMessage: sendMessage,
    renderModelPicker: renderModelPicker,
    // Expose for testing
    _showCommandResult: showCommandResult,
    _removeAutocomplete: removeAutocomplete,
    _removeArgumentHints: removeArgumentHints
  };
})();

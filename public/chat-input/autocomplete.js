(function() {
  'use strict';

  const MAX_AUTOCOMPLETE_ITEMS = 8;

  let autocompleteDropdown = null;
  let autocompleteItems = [];
  let selectedIndex = -1;
  let currentFilter = '';
  let argumentHints = null;

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

  function updateAutocomplete(input) {
    const value = input.value;
    const cursorPos = input.selectionStart;
    const textBeforeCursor = value.substring(0, cursorPos);

    const slashMatch = textBeforeCursor.match(/\/(\S*)$/);

    if (!slashMatch) {
      removeAutocomplete();
      removeArgumentHints();
      return;
    }

    currentFilter = slashMatch[1];

    const hasSelectedCommand = textBeforeCursor.match(/\/\w+\s/);

    if (hasSelectedCommand) {
      showArgumentHints(input);
      if (autocompleteDropdown) {
        autocompleteDropdown.style.display = 'none';
      }
      return;
    }

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

    autocompleteItems = commands.slice(0, MAX_AUTOCOMPLETE_ITEMS);
    selectedIndex = autocompleteItems.length > 0 ? 0 : -1;

    dropdown.innerHTML = '';

    autocompleteItems.forEach(function(cmd, index) {
      const item = document.createElement('div');
      item.className = 'slash-item';
      if (index === 0) item.classList.add('selected');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', index === 0 ? 'true' : 'false');

      const aliases = cmd.aliases.length > 0
        ? '<span class="slash-aliases">' + cmd.aliases.slice(0, 2).join(', ') + '</span>'
        : '';

      const localBadge = cmd.local ? '<span class="slash-local">*</span>' : '';

      item.innerHTML = [
        '<div class="slash-item-main">',
        '<span class="slash-name">/' + cmd.name + '</span>',
        localBadge,
        aliases,
        '</div>',
        '<div class="slash-desc">' + cmd.description + '</div>'
      ].join('');

      item.addEventListener('click', function() {
        completeCommand(cmd);
      });

      item.addEventListener('mouseenter', function() {
        selectItem(index);
      });

      dropdown.appendChild(item);
    });

    dropdown.style.display = 'block';

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
    items.forEach(function(item, i) {
      item.classList.toggle('selected', i === index);
      item.setAttribute('aria-selected', i === index ? 'true' : 'false');
    });

    selectedIndex = index;

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

    const newTextBefore = textBeforeCursor.replace(/\/(\S*)$/, '/' + cmd.name + ' ');
    const newValue = newTextBefore + value.substring(cursorPos);

    input.value = newValue;
    input.focus();

    const newCursorPos = newTextBefore.length;
    input.setSelectionRange(newCursorPos, newCursorPos);

    removeAutocomplete();

    if (cmd.args && cmd.args.length > 0) {
      showArgumentHintsForCommand(cmd);
    }

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

    const argTexts = cmd.args.map(function(arg) {
      const required = arg.required ? '<span class="hint-required">*</span>' : '';
      const choices = arg.choices ? ' [' + arg.choices.join('|') + ']' : '';
      return '<span class="hint-arg">&lt;' + arg.name + choices + '&gt;' + required + '</span>';
    });

    hints.innerHTML = [
      '<span class="hint-cmd">/' + cmd.name + '</span>',
      '<span class="hint-args">' + argTexts.join(' ') + '</span>',
      '<span class="hint-close" title="Hide hints">×</span>'
    ].join('');

    hints.style.display = 'block';

    const closeBtn = hints.querySelector('.hint-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function() {
        removeArgumentHints();
      });
    }
  }

  function isAutocompleteOpen() {
    return !!(autocompleteDropdown && autocompleteDropdown.style.display !== 'none');
  }

  window.ChatInputAutocomplete = {
    updateAutocomplete: updateAutocomplete,
    removeAutocomplete: removeAutocomplete,
    removeArgumentHints: removeArgumentHints,
    navigateDown: navigateDown,
    navigateUp: navigateUp,
    completeSelected: completeSelected,
    isAutocompleteOpen: isAutocompleteOpen
  };
})();

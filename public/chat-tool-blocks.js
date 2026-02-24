// Chat Tool Blocks Module — compact/expanded tool call & result rendering
(function() {
  'use strict';

  // SVG icons for copy buttons
  var COPY_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
  var CHECK_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';

  function createCopyButton(copyText) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-btn';
    btn.setAttribute('aria-label', 'Copy to clipboard');
    btn.innerHTML = COPY_ICON;
    btn.title = 'Copy to clipboard';
    
    btn.onclick = function(e) {
      e.stopPropagation();
      navigator.clipboard.writeText(copyText).then(function() {
        btn.classList.add('copied');
        btn.innerHTML = CHECK_ICON;
        btn.title = 'Copied!';
        setTimeout(function() {
          btn.classList.remove('copied');
          btn.innerHTML = COPY_ICON;
          btn.title = 'Copy to clipboard';
        }, 2000);
      }).catch(function(err) {
        console.error('Failed to copy:', err);
      });
    };
    
    return btn;
  }

  var TOOL_ICONS = {
    browser: '🌐', Read: '📁', Write: '📁', read: '📁', write: '📁',
    exec: '⚡', web_search: '🔍', web_fetch: '🔍', image: '🖼️',
  };

  function getToolIcon(name) {
    return TOOL_ICONS[name] || '🔧';
  }

  function getArgPreview(input) {
    if (!input || typeof input !== 'object') return '';
    var first = String(input.command || input.query || input.path || input.url || input.file_path || Object.values(input)[0] || '');
    return first.length > 60 ? first.slice(0, 57) + '...' : first;
  }

  function createToolUseBlock(block) {
    var wrapper = document.createElement('div');
    wrapper.className = 'chat-tool-use expanded';
    wrapper.dataset.toolUseId = block.id || '';

    // Create header container
    var headerContainer = document.createElement('div');
    headerContainer.className = 'chat-tool-use-header-row';

    var bodyId = 'chat-tool-use-body-' + Math.random().toString(36).slice(2, 10);
    var header = document.createElement('button');
    header.type = 'button';
    header.className = 'chat-tool-use-header';
    header.setAttribute('aria-expanded', 'true');
    header.setAttribute('aria-controls', bodyId);
    var icon = getToolIcon(block.name);
    var preview = getArgPreview(block.input);
    header.textContent = icon + ' ' + block.name + (preview ? ' "' + preview + '"' : '');

    // Create copy button for tool use
    var copyData = JSON.stringify({ name: block.name, input: block.input || {} }, null, 2);
    var copyBtn = createCopyButton(copyData);

    headerContainer.appendChild(header);
    headerContainer.appendChild(copyBtn);

    var body = document.createElement('div');
    body.className = 'chat-tool-use-body';
    body.id = bodyId;
    body.textContent = JSON.stringify(block.input, null, 2);

    header.onclick = function() {
      wrapper.classList.toggle('expanded');
      header.setAttribute('aria-expanded', wrapper.classList.contains('expanded') ? 'true' : 'false');
    };

    wrapper.appendChild(headerContainer);
    wrapper.appendChild(body);
    return wrapper;
  }

  function createToolResultBlock(block) {
    var wrapper = document.createElement('div');
    wrapper.className = 'chat-tool-result';
    wrapper.dataset.toolUseId = block.tool_use_id || '';

    var raw = typeof block.content === 'string' ? block.content : (block.content != null ? JSON.stringify(block.content, null, 2) : '');
    
    // Use progressive rendering for large content (>10KB)
    var PROGRESSIVE_THRESHOLD = 10000;
    if (raw.length > PROGRESSIVE_THRESHOLD && window.ProgressiveToolRenderer) {
      window.ProgressiveToolRenderer.render(wrapper, raw);
      // Add copy button for progressive renders
      var copyBtn = createCopyButton(raw);
      wrapper.appendChild(copyBtn);
      return wrapper;
    }
    
    // Standard rendering for smaller content
    var truncated = raw.length > 1000;
    var preview = truncated ? raw.slice(0, 1000) : raw;

    var contentContainer = document.createElement('div');
    contentContainer.className = 'chat-tool-result-container';

    var contentEl = document.createElement('div');
    contentEl.className = 'chat-tool-result-content code-block';
    contentEl.textContent = preview;
    contentContainer.appendChild(contentEl);

    // Add copy button for tool result
    var copyBtn = createCopyButton(raw);
    contentContainer.appendChild(copyBtn);
    wrapper.appendChild(contentContainer);

    if (truncated) {
      var more = document.createElement('button');
      more.className = 'chat-tool-result-more';
      more.textContent = 'Show more...';
      var expanded = false;
      more.onclick = function() {
        expanded = !expanded;
        contentEl.textContent = expanded ? raw : preview;
        more.textContent = expanded ? 'Show less' : 'Show more...';
      };
      wrapper.appendChild(more);
    }

    return wrapper;
  }

  function createToolGroup(toolBlocks) {
    if (toolBlocks.length < 3) return null;
    var wrapper = document.createElement('div');
    wrapper.className = 'chat-tool-group collapsed';

    var bodyId = 'chat-tool-group-body-' + Math.random().toString(36).slice(2, 10);
    var header = document.createElement('button');
    header.type = 'button';
    header.className = 'chat-tool-group-header';
    header.textContent = '🔧 ' + toolBlocks.length + ' tool calls';
    header.setAttribute('aria-expanded', 'false');
    header.setAttribute('aria-controls', bodyId);
    header.onclick = function() {
      wrapper.classList.toggle('collapsed');
      header.setAttribute('aria-expanded', wrapper.classList.contains('collapsed') ? 'false' : 'true');
    };

    var body = document.createElement('div');
    body.className = 'chat-tool-group-body';
    body.id = bodyId;
    toolBlocks.forEach(function(el) { body.appendChild(el); });

    wrapper.appendChild(header);
    wrapper.appendChild(body);
    return wrapper;
  }

  function createThinkingBlock(block) {
    var wrapper = document.createElement('div');
    wrapper.className = 'chat-thinking-block';
    wrapper.textContent = block.thinking || '';
    return wrapper;
  }

  window.ChatToolBlocks = {
    getToolIcon: getToolIcon,
    getArgPreview: getArgPreview,
    createToolUseBlock: createToolUseBlock,
    createToolResultBlock: createToolResultBlock,
    createToolGroup: createToolGroup,
    createThinkingBlock: createThinkingBlock,
  };
})();

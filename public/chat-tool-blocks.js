// Chat Tool Blocks Module — compact/expanded tool call & result rendering
(function() {
  'use strict';

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

    var bodyId = 'chat-tool-use-body-' + Math.random().toString(36).slice(2, 10);
    var header = document.createElement('button');
    header.type = 'button';
    header.className = 'chat-tool-use-header';
    header.setAttribute('aria-expanded', 'true');
    header.setAttribute('aria-controls', bodyId);
    var icon = getToolIcon(block.name);
    var preview = getArgPreview(block.input);
    header.textContent = icon + ' ' + block.name + (preview ? ' "' + preview + '"' : '');

    var body = document.createElement('div');
    body.className = 'chat-tool-use-body';
    body.id = bodyId;
    body.textContent = JSON.stringify(block.input, null, 2);

    header.onclick = function() {
      wrapper.classList.toggle('expanded');
      header.setAttribute('aria-expanded', wrapper.classList.contains('expanded') ? 'true' : 'false');
    };

    wrapper.appendChild(header);
    wrapper.appendChild(body);
    return wrapper;
  }

  function createToolResultBlock(block) {
    var wrapper = document.createElement('div');
    wrapper.className = 'chat-tool-result';
    wrapper.dataset.toolUseId = block.tool_use_id || '';

    var raw = typeof block.content === 'string' ? block.content : (block.content != null ? JSON.stringify(block.content, null, 2) : '');
    
    // Use progressive rendering for large content (>10KB)
    const PROGRESSIVE_THRESHOLD = 10000;
    if (raw.length > PROGRESSIVE_THRESHOLD && window.ProgressiveToolRenderer) {
      window.ProgressiveToolRenderer.render(wrapper, raw);
      return wrapper;
    }
    
    // Standard rendering for smaller content
    var truncated = raw.length > 1000;
    var preview = truncated ? raw.slice(0, 1000) : raw;

    var contentEl = document.createElement('div');
    contentEl.className = 'chat-tool-result-content';
    contentEl.textContent = preview;
    wrapper.appendChild(contentEl);

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

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
    var vals = Object.values(input);
    if (vals.length === 0) return '';
    var first = String(vals[0]);
    return first.length > 60 ? first.slice(0, 57) + '...' : first;
  }

  function createToolUseBlock(block) {
    var wrapper = document.createElement('div');
    wrapper.className = 'chat-tool-use';
    wrapper.dataset.toolUseId = block.id || '';

    var header = document.createElement('div');
    header.className = 'chat-tool-use-header';
    var icon = getToolIcon(block.name);
    var preview = getArgPreview(block.input);
    header.textContent = icon + ' ' + block.name + (preview ? ' "' + preview + '"' : '');

    var body = document.createElement('div');
    body.className = 'chat-tool-use-body';
    body.textContent = JSON.stringify(block.input, null, 2);

    header.onclick = function() {
      wrapper.classList.toggle('expanded');
    };

    wrapper.appendChild(header);
    wrapper.appendChild(body);
    return wrapper;
  }

  function createToolResultBlock(block) {
    var wrapper = document.createElement('div');
    wrapper.className = 'chat-tool-result';
    wrapper.dataset.toolUseId = block.tool_use_id || '';

    var raw = typeof block.content === 'string' ? block.content : JSON.stringify(block.content, null, 2);
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
      more.onclick = function() {
        if (contentEl.textContent.length < raw.length) {
          contentEl.textContent = raw;
          more.textContent = 'Show less';
        } else {
          contentEl.textContent = preview;
          more.textContent = 'Show more...';
        }
      };
      wrapper.appendChild(more);
    }

    return wrapper;
  }

  function createToolGroup(toolBlocks) {
    if (toolBlocks.length < 3) return null;
    var wrapper = document.createElement('div');
    wrapper.className = 'chat-tool-group collapsed';

    var header = document.createElement('div');
    header.className = 'chat-tool-group-header';
    header.textContent = '🔧 ' + toolBlocks.length + ' tool calls';
    header.onclick = function() {
      wrapper.classList.toggle('collapsed');
    };

    var body = document.createElement('div');
    body.className = 'chat-tool-group-body';
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

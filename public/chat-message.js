// Chat Message Module — message rendering functions
(function() {
  'use strict';

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

  // Format timestamp for display
  function formatTimestamp(timestamp) {
    if (!timestamp) return '';
    var date = new Date(timestamp);
    if (isNaN(date.getTime())) return '';
    
    var now = new Date();
    var diffMs = now - date;
    var diffMins = Math.floor(diffMs / 60000);
    var diffHours = Math.floor(diffMs / 3600000);
    var diffDays = Math.floor(diffMs / 86400000);
    
    // Relative time for recent messages
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return diffMins + 'm ago';
    if (diffHours < 24) return diffHours + 'h ago';
    if (diffDays < 7) return diffDays + 'd ago';
    
    // Absolute time for older messages
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
           date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  function formatAbsoluteTime(timestamp) {
    if (!timestamp) return '';
    var date = new Date(timestamp);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleString('en-US', { 
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }

  // Legacy wrappers for backward compat (tests reference these)
  function createToolBlock(name, content) {
    if (window.ChatToolBlocks) {
      return window.ChatToolBlocks.createToolUseBlock({ name: name, input: content, id: '' });
    }
    var wrapper = document.createElement('div');
    wrapper.className = 'chat-tool-block collapsed';
    wrapper.textContent = 'Tool: ' + name;
    return wrapper;
  }

  function createResultBlock(content) {
    if (window.ChatToolBlocks) {
      return window.ChatToolBlocks.createToolResultBlock({ content: content, tool_use_id: '' });
    }
    var wrapper = document.createElement('div');
    wrapper.className = 'chat-tool-block collapsed';
    wrapper.textContent = 'Result';
    return wrapper;
  }

  function renderContentBlock(block, role) {
    if (block.type === 'tool_use') {
      return window.ChatToolBlocks
        ? window.ChatToolBlocks.createToolUseBlock(block)
        : createToolBlock(block.name, block.input);
    }
    if (block.type === 'tool_result') {
      return window.ChatToolBlocks
        ? window.ChatToolBlocks.createToolResultBlock(block)
        : createResultBlock(block.content);
    }
    if (block.type === 'thinking') {
      if (window.ChatToolBlocks) return window.ChatToolBlocks.createThinkingBlock(block);
      var thinkDiv = document.createElement('div');
      thinkDiv.className = 'chat-thinking-block';
      thinkDiv.textContent = block.thinking || '';
      return thinkDiv;
    }
    // Unknown block type
    if (block.type !== 'text') {
      var unknownDiv = document.createElement('div');
      unknownDiv.className = 'chat-msg-content';
      unknownDiv.style.opacity = '0.4';
      unknownDiv.textContent = 'unsupported block type: ' + block.type;
      return unknownDiv;
    }
    // Text block
    var contentDiv = document.createElement('div');
    contentDiv.className = 'chat-msg-content';
    var text = block.text || '';
    if (role === 'assistant' && window.ChatMarkdown) {
      contentDiv.innerHTML = window.ChatMarkdown.renderMarkdown(text);
    } else {
      contentDiv.textContent = text;
    }
    return contentDiv;
  }

  function renderHistoryMessage(msg) {
    var div = document.createElement('div');
    var role = msg.role || 'system';
    var roleClass = role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : role === 'tool' ? 'tool' : 'system';
    div.className = 'chat-msg ' + roleClass;
    if (msg.timestamp) {
      div.dataset.timestamp = msg.timestamp;
    }

    // System messages get special styling
    if (role === 'system') {
      div.className = 'chat-msg system';
      var blocks = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content || '') }];
      blocks.forEach(function(block) {
        div.appendChild(renderContentBlock(block, role));
      });
      return div;
    }

    var roleSpan = document.createElement('span');
    roleSpan.className = 'chat-msg-role ' + roleClass;
    roleSpan.textContent = role;
    div.appendChild(roleSpan);

    // Timestamp element
    if (msg.timestamp) {
      var timeSpan = document.createElement('span');
      timeSpan.className = 'chat-msg-time';
      timeSpan.textContent = formatTimestamp(msg.timestamp);
      timeSpan.title = formatAbsoluteTime(msg.timestamp);
      div.appendChild(timeSpan);
    }

    var blocks = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content || '') }];

    // Collect tool_use blocks for potential grouping
    var toolUseEls = [];
    var otherEls = [];
    blocks.forEach(function(block) {
      var el = renderContentBlock(block, role);
      if (block.type === 'tool_use') {
        toolUseEls.push(el);
      } else {
        otherEls.push(el);
      }
    });

    // Append non-tool elements first
    otherEls.forEach(function(el) { div.appendChild(el); });

    // Group tool calls if 3+
    if (toolUseEls.length >= 3 && window.ChatToolBlocks) {
      div.appendChild(window.ChatToolBlocks.createToolGroup(toolUseEls));
    } else {
      toolUseEls.forEach(function(el) { div.appendChild(el); });
    }

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

  window.ChatMessage = {
    extractText: extractText,
    createToolBlock: createToolBlock,
    createResultBlock: createResultBlock,
    renderHistoryMessage: renderHistoryMessage,
    createAssistantStreamEl: createAssistantStreamEl,
    renderContentBlock: renderContentBlock,
  };
})();

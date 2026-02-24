// Chat Message Module — message rendering functions
(function() {
  'use strict';

  // createCopyButton and buildContentBlocksMarkdown are provided by
  // window.CopyUtils (copy-utils.js, loaded before this script).
  function resolveSenderDisplay(session) {
    return window.ChatSenderResolver.resolveChatSenderDisplay(session);
  }

  function createMessageCopyButton(text) {
    return window.CopyUtils.createCopyButton(text, 'Copy message');
  }

  function createCopyTurnButton(assistantMsg) {
    var btn = window.CopyUtils.createCopyButton(function() {
      return buildTurnMarkdown(assistantMsg);
    }, 'Copy entire turn', { visibleLabel: 'Copy turn' });
    btn.classList.add('copy-turn-btn');
    return btn;
  }

  function buildTurnMarkdown(assistantMsg) {
    var state = window.ChatState;
    var messages = state.currentMessages || [];

    // Find the index of this assistant message in the cached messages
    var assistantIndex = -1;
    for (var i = 0; i < messages.length; i++) {
      if (messages[i].role === 'assistant') {
        // Match by content comparison
        var msgContent = typeof messages[i].content === 'string' ? messages[i].content : JSON.stringify(messages[i].content);
        var asstContent = typeof assistantMsg.content === 'string' ? assistantMsg.content : JSON.stringify(assistantMsg.content);
        if (msgContent === asstContent) {
          assistantIndex = i;
          break;
        }
      }
    }

    // Look backwards to find the preceding user message
    var userMsg = null;
    if (assistantIndex > 0) {
      for (var j = assistantIndex - 1; j >= 0; j--) {
        if (messages[j].role === 'user') {
          userMsg = messages[j];
          break;
        }
      }
    }

    var markdown = '';

    // Add user message
    if (userMsg) {
      markdown += '## User\n';
      markdown += extractText(userMsg) + '\n\n';
    }

    // Add assistant message
    markdown += '## Assistant\n';
    var content = assistantMsg.content;
    if (Array.isArray(content)) {
      markdown += window.CopyUtils.buildContentBlocksMarkdown(content);
    } else {
      markdown += extractText(assistantMsg) + '\n';
    }

    return markdown;
  }

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
    // Image block
    if (block.type === 'image') {
      return renderImageBlock(block);
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

  function renderImageBlock(block) {
    var container = document.createElement('div');
    container.className = 'chat-image';
    
    var source = block.source;
    if (!source) {
      var placeholder = document.createElement('div');
      placeholder.className = 'chat-image-placeholder';
      placeholder.textContent = 'Image (data not available)';
      container.appendChild(placeholder);
      return container;
    }
    
    var img = document.createElement('img');
    img.alt = 'Image';
    
    if (source.type === 'base64') {
      if (!source.data) {
        var placeholder = document.createElement('div');
        placeholder.className = 'chat-image-placeholder';
        var sizeInfo = source.media_type ? ' (' + source.media_type + ')' : '';
        placeholder.textContent = 'Image' + sizeInfo + ' (data not available)';
        container.appendChild(placeholder);
        return container;
      }
      img.src = 'data:' + source.media_type + ';base64,' + source.data;
    } else if (source.type === 'url') {
      img.src = source.url;
    } else {
      // Unknown source type
      var placeholder = document.createElement('div');
      placeholder.className = 'chat-image-placeholder';
      placeholder.textContent = 'Image (unknown source type: ' + source.type + ')';
      container.appendChild(placeholder);
      return container;
    }
    
    container.appendChild(img);
    return container;
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

    var headerRow = document.createElement('div');
    headerRow.className = 'chat-msg-header';

    var roleSpan = document.createElement('span');
    roleSpan.className = 'chat-msg-role ' + roleClass;
    if (role === 'assistant') {
      var sender = resolveSenderDisplay(window.ChatState && (window.ChatState.currentSession || window.ChatState));
      roleSpan.textContent = sender && sender.displayName ? sender.displayName : 'assistant';
    } else {
      roleSpan.textContent = role;
    }
    headerRow.appendChild(roleSpan);

    // Add copy button for assistant and user messages (not tool)
    if (role === 'assistant' || role === 'user') {
      var blocks = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content || '') }];
      var textContent = blocks
        .filter(function(b) { return b.type === 'text'; })
        .map(function(b) { return b.text || ''; })
        .join('\n');
      var copyBtn = createMessageCopyButton(textContent);
      headerRow.appendChild(copyBtn);
    }

    var copyTurnBtn = role === 'assistant' ? createCopyTurnButton(msg) : null;

    // Timestamp element
    if (msg.timestamp) {
      var timeSpan = document.createElement('span');
      timeSpan.className = 'chat-msg-time';
      timeSpan.textContent = formatTimestamp(msg.timestamp);
      timeSpan.title = formatAbsoluteTime(msg.timestamp);
      headerRow.appendChild(timeSpan);
    }

    div.appendChild(headerRow);

    blocks = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content || '') }];

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

    if (copyTurnBtn) {
      var turnActions = document.createElement('div');
      turnActions.className = 'chat-turn-actions';
      turnActions.appendChild(copyTurnBtn);
      div.appendChild(turnActions);
    }

    return div;
  }

  function createAssistantStreamEl() {
    var div = document.createElement('div');
    div.className = 'chat-msg assistant streaming';
    var roleSpan = document.createElement('span');
    roleSpan.className = 'chat-msg-role assistant';
    var streamSession = resolveSenderDisplay(window.ChatState && (window.ChatState.currentSession || window.ChatState));
    roleSpan.textContent = streamSession && streamSession.displayName ? streamSession.displayName : 'assistant';
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
    resolveSenderDisplay: resolveSenderDisplay,
    renderContentBlock: renderContentBlock,
  };
})();

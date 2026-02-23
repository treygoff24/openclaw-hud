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

  function createToolBlock(name, content) {
    const wrapper = document.createElement('div');
    wrapper.className = 'chat-tool-block collapsed';
    const header = document.createElement('div');
    header.className = 'chat-tool-block-header';
    header.textContent = '\u25B6 Tool: ' + name;
    header.onclick = function() {
      wrapper.classList.toggle('collapsed');
      header.textContent = wrapper.classList.contains('collapsed')
        ? '\u25B6 Tool: ' + name : '\u25BC Tool: ' + name;
    };
    const body = document.createElement('div');
    body.className = 'tool-block-body';
    body.textContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    wrapper.appendChild(header);
    wrapper.appendChild(body);
    return wrapper;
  }

  function createResultBlock(content) {
    const wrapper = document.createElement('div');
    wrapper.className = 'chat-tool-block collapsed';
    const header = document.createElement('div');
    header.className = 'chat-tool-block-header';
    header.textContent = '\u25B6 Result';
    header.onclick = function() {
      wrapper.classList.toggle('collapsed');
      header.textContent = wrapper.classList.contains('collapsed')
        ? '\u25B6 Result' : '\u25BC Result';
    };
    const body = document.createElement('div');
    body.className = 'tool-block-body';
    body.textContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    wrapper.appendChild(header);
    wrapper.appendChild(body);
    return wrapper;
  }

  function renderHistoryMessage(msg) {
    const div = document.createElement('div');
    const role = msg.role || 'system';
    const roleClass = role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : role === 'tool' ? 'tool' : 'system';
    div.className = 'chat-msg ' + roleClass;

    const roleSpan = document.createElement('span');
    roleSpan.className = 'chat-msg-role ' + roleClass;
    roleSpan.textContent = role;
    div.appendChild(roleSpan);

    const blocks = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content || '') }];
    blocks.forEach(function(block) {
      if (block.type === 'tool_use') {
        div.appendChild(createToolBlock(block.name, block.input));
      } else if (block.type === 'tool_result') {
        div.appendChild(createResultBlock(block.content));
      } else {
        const contentDiv = document.createElement('div');
        contentDiv.className = 'chat-msg-content';
        contentDiv.textContent = block.text || '';
        div.appendChild(contentDiv);
      }
    });
    return div;
  }

  function createAssistantStreamEl() {
    const div = document.createElement('div');
    div.className = 'chat-msg assistant streaming';
    const roleSpan = document.createElement('span');
    roleSpan.className = 'chat-msg-role assistant';
    roleSpan.textContent = 'assistant';
    div.appendChild(roleSpan);
    const contentDiv = document.createElement('div');
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
  };
})();

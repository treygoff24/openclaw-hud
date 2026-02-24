(function() {
  'use strict';
  var runtime = window.ChatPaneRuntime || (window.ChatPaneRuntime = {});

  function exportChatSession() {
    var state = runtime.ChatState;
    if (!state.currentMessages || state.currentMessages.length === 0) {
      alert('No messages to export');
      return;
    }

    var session = state.currentSession;
    var sessionLabel = session ? runtime.normalizeLabel(session.label, session.sessionKey || 'chat') : 'chat';
    var sessionTitle = session ? sessionLabel : 'chat';

    var markdown = '# ' + sessionTitle + '\n\n';
    var userMessage = null;

    state.currentMessages.forEach(function(msg) {
      if (msg.role === 'user') {
        userMessage = msg;
      } else if (msg.role === 'assistant') {
        if (userMessage) {
          markdown += '## User\n';
          markdown += window.ChatMessage.extractText(userMessage) + '\n\n';
          userMessage = null;
        }
        markdown += '## Assistant\n';
        var content = msg.content;
        if (Array.isArray(content)) {
          markdown += window.CopyUtils.buildContentBlocksMarkdown(content);
        } else {
          markdown += window.ChatMessage.extractText(msg) + '\n';
        }
        markdown += '\n';
      }
    });

    if (userMessage) {
      markdown += '## User\n';
      markdown += window.ChatMessage.extractText(userMessage) + '\n\n';
    }

    var blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = sessionTitle + '.md';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  runtime.exportChatSession = exportChatSession;
})();

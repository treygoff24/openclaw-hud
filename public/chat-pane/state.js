(function() {
  'use strict';
  var runtime = window.ChatPaneRuntime || (window.ChatPaneRuntime = {});
  var constants = runtime.constants;

  var chatState = {
    currentSession: null,
    subscribedKey: null,
    activeRuns: new Map(),
    pendingAcks: new Map(),
    cachedModels: null,
    sendWs: runtime.sendWs,
    currentMessages: [],
  };

  chatState.addMessage = function(msg) {
    if (!msg || !msg.role) return;

    var messages = chatState.currentMessages;
    var startIndex = Math.max(0, messages.length - constants.DEDUP_RECENT_WINDOW);
    var isDuplicate = messages.slice(startIndex).some(function(existing) {
      if (existing.timestamp && msg.timestamp && existing.timestamp === msg.timestamp) {
        return true;
      }
      var existingContent = typeof existing.content === 'string' ? existing.content : JSON.stringify(existing.content);
      var msgContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      return existing.role === msg.role && existingContent === msgContent;
    });

    if (!isDuplicate) {
      messages.push(msg);
      if (messages.length > constants.MAX_CACHED_MESSAGES) {
        messages.splice(0, messages.length - constants.MAX_CACHED_MESSAGES);
      }
    }
  };

  chatState.setMessages = function(messages) {
    if (!Array.isArray(messages)) {
      chatState.currentMessages = [];
      return;
    }

    if (messages.length > constants.MAX_CACHED_MESSAGES) {
      chatState.currentMessages = messages.slice(messages.length - constants.MAX_CACHED_MESSAGES);
      return;
    }

    chatState.currentMessages = messages.slice();
  };

  runtime.ChatState = chatState;
})();

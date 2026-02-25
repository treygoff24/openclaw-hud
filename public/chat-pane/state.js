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
    historyLoadBySession: new Map(),
  };

  function getHistoryLoadEntry(sessionKey) {
    var entry = chatState.historyLoadBySession.get(sessionKey);
    if (!entry) {
      entry = {
        attempt: 0,
        inFlight: false,
        loaded: false,
        timeoutWarningShown: false,
      };
      chatState.historyLoadBySession.set(sessionKey, entry);
    }
    return entry;
  }

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

  chatState.beginHistoryLoad = function(sessionKey, options) {
    if (!sessionKey) return { started: false, reason: 'missing_session_key', attempt: 0 };
    var entry = getHistoryLoadEntry(sessionKey);
    var force = !!(options && options.force);

    if (!force) {
      if (entry.inFlight) return { started: false, reason: 'in_flight', attempt: entry.attempt };
      if (entry.loaded) return { started: false, reason: 'loaded', attempt: entry.attempt };
    }

    entry.attempt += 1;
    entry.inFlight = true;
    entry.loaded = false;
    entry.timeoutWarningShown = false;
    return { started: true, reason: force ? 'forced' : 'new_attempt', attempt: entry.attempt };
  };

  chatState.requestChatHistory = function(sessionKey, source, options) {
    var begin = chatState.beginHistoryLoad(sessionKey, options);
    if (!begin.started) {
      runtime.hudDiagLog(constants.CHAT_LOG_PREFIX, 'history_request_skipped', {
        sessionKey: sessionKey || '',
        source: source || '',
        reason: begin.reason || '',
        attempt: begin.attempt || 0,
      });
      return false;
    }

    runtime.hudDiagLog(constants.CHAT_LOG_PREFIX, 'history_request', {
      sessionKey: sessionKey || '',
      source: source || '',
      attempt: begin.attempt || 0,
    });

    chatState.sendWs({ type: 'chat-history', sessionKey: sessionKey });
    runtime.startHistoryLoadTimer(sessionKey, begin.attempt);
    return true;
  };

  chatState.resolveHistoryResult = function(sessionKey) {
    if (!sessionKey) return { accept: false, reason: 'missing_session_key', attempt: 0 };
    var entry = getHistoryLoadEntry(sessionKey);

    if (entry.loaded && !entry.inFlight) {
      return { accept: false, reason: 'already_loaded', attempt: entry.attempt };
    }

    entry.inFlight = false;
    entry.loaded = true;
    return { accept: true, reason: 'accepted', attempt: entry.attempt };
  };

  chatState.shouldShowHistoryTimeoutWarning = function(sessionKey, attempt) {
    if (!sessionKey) return false;
    var entry = chatState.historyLoadBySession.get(sessionKey);
    if (!entry) return false;
    if (typeof attempt === 'number' && attempt > 0 && entry.attempt !== attempt) return false;
    if (!entry.inFlight) return false;
    if (entry.timeoutWarningShown) return false;
    entry.timeoutWarningShown = true;
    return true;
  };

  chatState.resetHistoryLoadState = function(sessionKey) {
    if (!sessionKey) return;
    chatState.historyLoadBySession.delete(sessionKey);
  };

  runtime.requestChatHistory = chatState.requestChatHistory;
  runtime.ChatState = chatState;
})();

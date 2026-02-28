(function () {
  "use strict";

  function handleHistoryResult(data) {
    var s = window.ChatState;
    var runtime = window.ChatWsRuntime;
    if (!s.currentSession || data.sessionKey !== s.currentSession.sessionKey) return;

    var container = document.getElementById("chat-messages");
    if (!container) return;

    if (typeof s.resolveHistoryResult === "function") {
      var resolution = s.resolveHistoryResult(data.sessionKey);
      if (!resolution.accept) {
        runtime.hudDiagLog(runtime.CHAT_LOG_PREFIX, "history_result_ignored_duplicate", {
          sessionKey: data.sessionKey || "",
          reason: resolution.reason || "",
          attempt: resolution.attempt || 0,
        });
        return;
      }
    }

    var loading = container.querySelector(".chat-loading");
    var hadLoading = !!loading;
    if (loading) loading.remove();

    if (s.setMessages && data.messages) {
      s.setMessages(data.messages);
    }

    if (data.error && !(data.messages && data.messages.length > 0)) {
      var errDiv = document.createElement("div");
      errDiv.className = "chat-loading";
      errDiv.textContent = "Error loading history: " + (data.error.message || data.error);
      container.appendChild(errDiv);
      container.dataset.ready = "true";
      if (window.A11yAnnouncer) {
        window.A11yAnnouncer.announceAssertive(
          "Error loading chat history: " + (data.error.message || data.error),
        );
      }
      runtime.hudDiagLog(runtime.CHAT_LOG_PREFIX, "history_loading_cleared", {
        sessionKey: data.sessionKey || "",
        hadLoading: hadLoading,
        messageCount: (data.messages || []).length,
        error: true,
      });
      return;
    }

    (data.messages || []).forEach(function (msg) {
      container.appendChild(window.ChatMessage.renderHistoryMessage(msg));
    });
    if (window.ChatScroll) window.ChatScroll.scrollToBottom(true);
    container.dataset.ready = "true";

    if (window.A11yAnnouncer) {
      window.A11yAnnouncer.announce(
        "Chat history loaded, " + (data.messages || []).length + " messages",
      );
    }
    runtime.hudDiagLog(runtime.CHAT_LOG_PREFIX, "history_loading_cleared", {
      sessionKey: data.sessionKey || "",
      hadLoading: hadLoading,
      messageCount: (data.messages || []).length,
      error: false,
    });
  }

  function handleLogEntry(data) {
    var s = window.ChatState;
    if (!s.currentSession) return;
    if (data.agentId !== s.currentSession.agentId || data.sessionId !== s.currentSession.sessionId)
      return;

    var container = document.getElementById("chat-messages");
    if (!container) return;
    var entry = data.entry || data;

    var msg = {
      role: entry.role || "system",
      content:
        typeof entry.content === "string"
          ? [{ type: "text", text: entry.content }]
          : entry.content || [],
    };
    if (entry.timestamp) msg.timestamp = entry.timestamp;
    if (s.addMessage) s.addMessage(msg);

    container.appendChild(window.ChatMessage.renderHistoryMessage(msg));
    if (window.ChatScroll) window.ChatScroll.scrollToBottom(true);
  }

  window.ChatWsHistoryLog = {
    handleHistoryResult: handleHistoryResult,
    handleLogEntry: handleLogEntry,
  };
})();

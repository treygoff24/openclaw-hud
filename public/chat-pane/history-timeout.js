(function () {
  "use strict";
  var runtime = window.ChatPaneRuntime || (window.ChatPaneRuntime = {});
  var constants = runtime.constants;

  var historyLoadTimer = null;

  function clearHistoryLoadTimer() {
    if (historyLoadTimer) {
      clearTimeout(historyLoadTimer);
      historyLoadTimer = null;
    }
  }

  function startHistoryLoadTimer(sessionKey, attempt) {
    clearHistoryLoadTimer();
    runtime.hudDiagLog(constants.CHAT_LOG_PREFIX, "history_timeout_started", {
      sessionKey: sessionKey || "",
      timeoutMs: constants.HISTORY_LOAD_TIMEOUT_MS,
      attempt: attempt || 0,
    });

    historyLoadTimer = setTimeout(function () {
      historyLoadTimer = null;
      var state = runtime.ChatState;
      if (!state.currentSession || state.currentSession.sessionKey !== sessionKey) return;
      if (
        state.shouldShowHistoryTimeoutWarning &&
        !state.shouldShowHistoryTimeoutWarning(sessionKey, attempt)
      )
        return;

      var container = document.getElementById("chat-messages");
      if (!container) return;

      var loading = container.querySelector(".chat-loading");
      if (loading) loading.remove();
      if (container.querySelector(".chat-history-warning")) return;

      var warning = document.createElement("div");
      warning.className = "chat-history-warning";
      warning.textContent =
        "History is taking longer than expected. Close and reopen chat to retry.";
      container.appendChild(warning);
      container.dataset.ready = "true";

      if (window.A11yAnnouncer) {
        window.A11yAnnouncer.announceAssertive(
          "Chat history is taking longer than expected. Close and reopen chat to retry.",
        );
      }

      runtime.hudDiagLog(constants.CHAT_LOG_PREFIX, "history_timeout_fired", {
        sessionKey: sessionKey || "",
        attempt: attempt || 0,
      });
    }, constants.HISTORY_LOAD_TIMEOUT_MS);
  }

  runtime.clearHistoryLoadTimer = clearHistoryLoadTimer;
  runtime.startHistoryLoadTimer = startHistoryLoadTimer;
})();

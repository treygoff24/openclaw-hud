(function () {
  "use strict";
  var runtime = window.ChatPaneRuntime || (window.ChatPaneRuntime = {});

  function handleChatWsMessage(data) {
    var state = runtime.ChatState;
    if (data && data.type === "chat-history-result") {
      var currentSessionKey = state.currentSession ? state.currentSession.sessionKey : "";
      var isMatch = !!(state.currentSession && data.sessionKey === currentSessionKey);

      runtime.hudDiagLog(runtime.constants.CHAT_LOG_PREFIX, "history_result_received", {
        sessionKey: data.sessionKey || "",
        currentSessionKey: currentSessionKey || "",
        matched: isMatch,
      });

      if (isMatch) {
        runtime.clearHistoryLoadTimer();
        var container = document.getElementById("chat-messages");
        if (container) {
          var warning = container.querySelector(".chat-history-warning");
          var warningCleared = !!warning;
          if (warning) warning.remove();
          runtime.hudDiagLog(runtime.constants.CHAT_LOG_PREFIX, "history_result_matched", {
            sessionKey: data.sessionKey || "",
            warningCleared: warningCleared,
          });
        }
      }
    }

    if (window.ChatWsHandler) window.ChatWsHandler.handle(data);
  }

  if (!runtime.uiBindingsAttached) {
    runtime.uiBindingsAttached = true;

    document.addEventListener("click", function (e) {
      if (e.target.id === "chat-close") runtime.closeChatPane();
    });

    document.addEventListener("click", function (e) {
      if (e.target.id === "chat-new-pill") {
        if (window.ChatScroll) window.ChatScroll.scrollToBottom(true);
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (e.defaultPrevented) return;
        var activeModal = document.querySelector(".modal-overlay.active");
        if (!activeModal && runtime.ChatState && runtime.ChatState.subscribedKey)
          runtime.closeChatPane();
      }
    });
  }

  runtime.handleChatWsMessage = handleChatWsMessage;
})();

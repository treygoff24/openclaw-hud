(function () {
  "use strict";

  var runtime = window.ChatPaneRuntime;
  var requiredApi = [
    "openChatPane",
    "closeChatPane",
    "restoreSavedChatSession",
    "handleChatWsMessage",
    "flushWsQueue",
    "exportChatSession",
    "ChatState",
  ];

  if (!runtime) {
    throw new Error(
      "ChatPaneRuntime is missing. Ensure chat-pane modules load before chat-pane.js.",
    );
  }

  for (var i = 0; i < requiredApi.length; i += 1) {
    if (runtime[requiredApi[i]] == null) {
      throw new Error("ChatPaneRuntime missing required API: " + requiredApi[i]);
    }
  }

  window.openChatPane = runtime.openChatPane;
  window.closeChatPane = runtime.closeChatPane;
  window.restoreSavedChatSession = runtime.restoreSavedChatSession;
  window.handleChatWsMessage = runtime.handleChatWsMessage;
  window._flushChatWsQueue = runtime.flushWsQueue;
  window.exportChatSession = runtime.exportChatSession;
  window.ChatState = runtime.ChatState;
})();

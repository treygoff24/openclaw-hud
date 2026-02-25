// Chat WS Handler facade — routes incoming WebSocket messages to focused modules
(function () {
  "use strict";

  function requireApi(obj, objName, methodName) {
    if (!obj || typeof obj[methodName] !== "function") {
      throw new Error(
        "[ChatWsHandler] Missing " + objName + "." + methodName + ". Check script load order.",
      );
    }
  }

  var runtime = window.ChatWsRuntime;
  var historyLog = window.ChatWsHistoryLog;
  var streamEvents = window.ChatWsStreamEvents;
  var systemEvents = window.ChatWsSystemEvents;

  requireApi(runtime, "ChatWsRuntime", "updateButtons");
  requireApi(runtime, "ChatWsRuntime", "showLive");
  requireApi(runtime, "ChatWsRuntime", "createRetryBtn");
  requireApi(historyLog, "ChatWsHistoryLog", "handleHistoryResult");
  requireApi(historyLog, "ChatWsHistoryLog", "handleLogEntry");
  requireApi(streamEvents, "ChatWsStreamEvents", "handleChatEvent");
  requireApi(streamEvents, "ChatWsStreamEvents", "processChatEventBatch");
  requireApi(streamEvents, "ChatWsStreamEvents", "initializeBatcher");
  requireApi(systemEvents, "ChatWsSystemEvents", "handleSendAck");
  requireApi(systemEvents, "ChatWsSystemEvents", "handleGatewayStatus");

  streamEvents.initializeBatcher();

  window.ChatWsHandler = {
    updateButtons: runtime.updateButtons,
    handle: function (data) {
      if (!data || !data.type) return;

      if (data.type === "chat-event" && window.WebSocketMessageBatcher) {
        window.WebSocketMessageBatcher.queue(data);
        return;
      }

      var s = window.ChatState;
      switch (data.type) {
        case "subscribed":
          return runtime.showLive(
            s.currentSession && data.sessionId === s.currentSession.sessionId,
          );
        case "chat-subscribe-ack":
          return runtime.showLive(
            s.currentSession && data.sessionKey === s.currentSession.sessionKey,
          );
        case "chat-history-result":
          return historyLog.handleHistoryResult(data);
        case "chat-event":
          return streamEvents.handleChatEvent(data);
        case "chat-send-ack":
          return systemEvents.handleSendAck(data);
        case "gateway-status":
          return systemEvents.handleGatewayStatus(data);
        case "models-list-result":
          s.cachedModels = data.models;
          window.ChatInput.renderModelPicker(data.models);
          return;
        case "chat-new-result":
          if (data.ok && data.sessionKey) {
            var parts = data.sessionKey.split(":");
            if (parts.length >= 3)
              window.openChatPane(parts[1], parts.slice(2).join(":"), "", data.sessionKey);
          }
          return;
        case "log-entry":
          return historyLog.handleLogEntry(data);
      }
    },
    processChatEventBatch: streamEvents.processChatEventBatch,
  };
})();

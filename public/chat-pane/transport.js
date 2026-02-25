(function () {
  "use strict";
  var runtime = window.ChatPaneRuntime || (window.ChatPaneRuntime = {});
  var constants = runtime.constants;

  var wsQueue = [];

  function sendWs(msg) {
    var payload = {
      type: msg && msg.type ? msg.type : "",
      sessionKey: msg && msg.sessionKey ? msg.sessionKey : "",
      queueLength: wsQueue.length,
    };

    if (window._hudWs && window._hudWs.readyState === WebSocket.OPEN) {
      window._hudWs.send(JSON.stringify(msg));
      runtime.hudDiagLog(constants.CHAT_LOG_PREFIX, "send_open", {
        type: payload.type,
        sessionKey: payload.sessionKey,
        queueLength: wsQueue.length,
      });
      return;
    }

    if (
      payload.type === "chat-history" &&
      payload.sessionKey &&
      wsQueue.some(function (queued) {
        return queued && queued.type === "chat-history" && queued.sessionKey === payload.sessionKey;
      })
    ) {
      runtime.hudDiagLog(constants.CHAT_LOG_PREFIX, "queue_skip_duplicate", {
        type: payload.type,
        sessionKey: payload.sessionKey,
        queueLength: wsQueue.length,
      });
      return;
    }

    wsQueue.push(msg);
    payload.queueLength = wsQueue.length;

    if (payload.type === "chat-subscribe" || payload.type === "chat-history") {
      runtime.hudDiagLog(constants.CHAT_LOG_PREFIX, "queue_enqueue", payload);
    }
    runtime.hudDiagLog(constants.CHAT_LOG_PREFIX, "send_deferred", payload);
  }

  function flushWsQueue() {
    runtime.hudDiagLog(constants.CHAT_LOG_PREFIX, "queue_flush_start", {
      queued: wsQueue.length,
    });

    var flushed = 0;
    while (wsQueue.length > 0) {
      var msg = wsQueue.shift();
      if (window._hudWs && window._hudWs.readyState === WebSocket.OPEN) {
        window._hudWs.send(JSON.stringify(msg));
        flushed += 1;
      } else {
        wsQueue.unshift(msg);
        break;
      }
    }

    runtime.hudDiagLog(constants.CHAT_LOG_PREFIX, "queue_flush_end", {
      flushed: flushed,
      remaining: wsQueue.length,
    });
  }

  runtime.sendWs = sendWs;
  runtime.flushWsQueue = flushWsQueue;
})();

(function () {
  "use strict";

  function handleSendAck(data) {
    var s = window.ChatState;
    var runtime = window.ChatWsRuntime;
    var ack = s.pendingAcks.get(data.idempotencyKey);
    if (!ack) return;

    s.pendingAcks.delete(data.idempotencyKey);
    var input = document.getElementById("chat-input");
    if (input) input.disabled = false;

    if (data.ok) {
      ack.el.classList.remove("pending");
      return;
    }

    ack.el.classList.remove("pending");
    ack.el.classList.add("failed");
    ack.el.appendChild(
      runtime.createRetryBtn(
        s.currentSession ? s.currentSession.sessionKey : "",
        ack.message || "",
        ack.el,
      ),
    );
    if (window.A11yAnnouncer) {
      window.A11yAnnouncer.announceAssertive("Message failed to send. Retry button available.");
    }
  }

  function handleGatewayStatus(data) {
    var banner = document.getElementById("gateway-banner");
    if (!banner) return;

    if (data.status === "disconnected") {
      banner.style.display = "block";
      return;
    }

    if (data.status === "connected") {
      banner.style.display = "none";
      var s = window.ChatState;
      if (s.currentSession) {
        s.sendWs({ type: "chat-subscribe", sessionKey: s.currentSession.sessionKey });
        var paneRuntime = window.ChatPaneRuntime;
        if (paneRuntime && typeof paneRuntime.requestChatHistory === "function") {
          paneRuntime.requestChatHistory(s.currentSession.sessionKey, "gateway_connected");
        } else {
          s.sendWs({ type: "chat-history", sessionKey: s.currentSession.sessionKey });
        }
      }
    }
  }

  window.ChatWsSystemEvents = {
    handleSendAck: handleSendAck,
    handleGatewayStatus: handleGatewayStatus,
  };
})();

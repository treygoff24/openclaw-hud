(function () {
  "use strict";

  window.HUDApp = window.HUDApp || {};

  const WS_RECONNECT_BASE_MS = 500;
  const WS_RECONNECT_MAX_MS = 5000;
  const WS_RECONNECT_JITTER_MS = 250;
  const WS_POST_OPEN_RECONNECT_MS = 2000;

  function createWsController(options) {
    const opts = options || {};
    const diagLog = opts.diagLog || function () {};
    const wsLogPrefix = opts.wsLogPrefix || "[HUD-WS]";
    const fetchAll = opts.fetchAll;
    const setConnectionStatus = opts.setConnectionStatus;
    const setGatewayUptimeSnapshot = opts.setGatewayUptimeSnapshot;
    const startPolling = opts.startPolling;
    const stopPolling = opts.stopPolling;
    const wsUrlFactory =
      opts.wsUrlFactory ||
      function () {
        return window.HUD && window.HUD.utils
          ? window.HUD.utils.wsUrl(location)
          : "ws://localhost:3777/ws";
      };

    let wsReconnectAttempts = 0;
    let wsReconnectTimer = null;
    let wsEverOpened = false;
    let wsConnectAttempt = 0;

    function clearWsReconnectTimer() {
      if (!wsReconnectTimer) return;
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }

    function scheduleWsReconnect(trigger, wasPreviouslyOpened) {
      if (wsReconnectTimer) return;

      let delayMs;
      let reconnectAttempt;

      if (wasPreviouslyOpened) {
        delayMs = WS_POST_OPEN_RECONNECT_MS;
        reconnectAttempt = wsReconnectAttempts + 1;
        wsReconnectAttempts += 1;
        diagLog(wsLogPrefix, "reconnect_scheduled", {
          trigger: trigger || "unknown",
          reconnectAttempt: reconnectAttempt,
          delayMs: delayMs,
          type: "post_open",
        });
      } else {
        const exp = Math.min(wsReconnectAttempts, 6);
        const backoff = Math.min(WS_RECONNECT_MAX_MS, WS_RECONNECT_BASE_MS * Math.pow(2, exp));
        const jitter = Math.floor(Math.random() * WS_RECONNECT_JITTER_MS);
        delayMs = backoff + jitter;
        reconnectAttempt = wsReconnectAttempts + 1;
        wsReconnectAttempts += 1;
        diagLog(wsLogPrefix, "reconnect_scheduled", {
          trigger: trigger || "unknown",
          reconnectAttempt: reconnectAttempt,
          delayMs: delayMs,
          backoffMs: backoff,
          jitterMs: jitter,
          type: "pre_open",
        });
      }

      wsReconnectTimer = setTimeout(function () {
        wsReconnectTimer = null;
        diagLog(wsLogPrefix, "reconnect_fired", {
          reconnectAttempt: reconnectAttempt,
        });
        connect();
      }, delayMs);
    }

    function connect() {
      const existing = window._hudWs;
      if (
        existing &&
        (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }

      const attempt = ++wsConnectAttempt;
      const wsUrl = wsUrlFactory();
      diagLog(wsLogPrefix, "connect_attempt", {
        attempt: attempt,
        url: wsUrl,
      });

      let ws;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        diagLog(wsLogPrefix, "connect_constructor_error", {
          attempt: attempt,
          url: wsUrl,
        });
        startPolling();
        setConnectionStatus(false);
        scheduleWsReconnect("constructor_error", wsEverOpened);
        return;
      }

      window._hudWs = ws;
      let opened = false;

      ws.onopen = function () {
        if (window._hudWs !== ws) return;
        opened = true;
        wsEverOpened = true;
        wsReconnectAttempts = 0;
        clearWsReconnectTimer();
        stopPolling();
        setConnectionStatus(true);
        diagLog(wsLogPrefix, "open", {
          attempt: attempt,
          url: wsUrl,
        });
        if (window._flushChatWsQueue) {
          window._flushChatWsQueue();
        }
      };

      ws.onmessage = function (event) {
        const data = JSON.parse(event.data);
        if (data.type === "tick") {
          fetchAll({ includeCold: false });
        }
        if (data.type === "gateway-status" && typeof setGatewayUptimeSnapshot === "function") {
          setGatewayUptimeSnapshot(data.uptimeMs);
        }
        if (window.handleChatWsMessage) {
          window.handleChatWsMessage(data);
        }
      };

      ws.onclose = function (evt) {
        if (window._hudWs === ws) {
          window._hudWs = null;
        }
        startPolling();
        setConnectionStatus(false);
        diagLog(wsLogPrefix, "close", {
          attempt: attempt,
          url: wsUrl,
          code: evt && typeof evt.code === "number" ? evt.code : "",
          reason: evt && typeof evt.reason === "string" ? evt.reason : "",
          wasClean: evt && typeof evt.wasClean === "boolean" ? evt.wasClean : "",
          opened: opened,
          wsEverOpened: wsEverOpened,
        });
        scheduleWsReconnect(opened ? "close_after_open" : "close_before_open", wsEverOpened);
      };

      ws.onerror = function () {
        setConnectionStatus(false);
        diagLog(wsLogPrefix, "error", {
          attempt: attempt,
          url: wsUrl,
          opened: opened,
          wsEverOpened: wsEverOpened,
        });
        if (!opened) {
          scheduleWsReconnect("error_before_open", wsEverOpened);
        }
      };
    }

    return {
      connect,
      clearWsReconnectTimer,
    };
  }

  window.HUDApp.ws = {
    createWsController,
  };
})();

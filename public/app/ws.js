(function () {
  "use strict";

  window.HUDApp = window.HUDApp || {};

  const WS_RECONNECT_BASE_MS = 500;
  const WS_RECONNECT_MAX_MS = 5000;
  const WS_RECONNECT_JITTER_MS = 250;
  const WS_POST_OPEN_RECONNECT_MS = 2000;
  let textEncoder = null;

  function resolvePerfMonitor() {
    const monitor = window.HUDApp && window.HUDApp.perfMonitor;
    if (!monitor) return null;
    if (typeof monitor.isEnabled === "function" && !monitor.isEnabled()) return null;
    if (typeof monitor.record !== "function") return null;
    return monitor;
  }

  function recordPerf(entry) {
    const monitor = resolvePerfMonitor();
    if (!monitor) return;
    try {
      monitor.record(entry);
    } catch {
      // Ignore diagnostics failures for runtime behavior.
    }
  }

  function estimateMessageBytes(rawMessage) {
    if (typeof rawMessage === "string") {
      if (!textEncoder && typeof TextEncoder === "function") {
        textEncoder = new TextEncoder();
      }
      return textEncoder ? textEncoder.encode(rawMessage).length : rawMessage.length;
    }
    if (!rawMessage) return 0;
    if (typeof rawMessage.byteLength === "number") return rawMessage.byteLength;
    return String(rawMessage).length;
  }

  function resolveNowMs(options) {
    if (options && typeof options.now === "function") {
      return options.now;
    }
    if (
      typeof performance !== "undefined" &&
      performance &&
      typeof performance.now === "function"
    ) {
      return function () {
        return performance.now();
      };
    }
    return function () {
      return Date.now();
    };
  }

  function normalizeDurationMs(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return 0;
    return numeric;
  }

  function normalizeMessageType(type) {
    const normalized = typeof type === "string" ? type.trim().toLowerCase() : "";
    if (!normalized) return "unknown";
    const safe = normalized.replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
    return safe || "unknown";
  }

  function createMessageMetricName(type) {
    return "ws.message." + normalizeMessageType(type);
  }

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
    const nowMs = resolveNowMs(opts);

    let wsReconnectAttempts = 0;
    let wsReconnectTimer = null;
    let wsEverOpened = false;
    let wsConnectAttempt = 0;
    let inboundMessageCount = 0;
    let inboundMessageBytes = 0;
    let tickRefreshInFlight = false;
    let tickRefreshQueued = false;
    let tickRunSeq = 0;
    let tickRefreshQueuedContext = null;
    let activeTickRunId = null;
    const perfContext = (window.HUDApp && window.HUDApp.perfEventContext) || null;

    function setPerfRunId(nextRunId) {
      if (!perfContext || typeof perfContext.setRunId !== "function") return;
      if (nextRunId == null) {
        return;
      }
      perfContext.setRunId(nextRunId);
    }

    function resolvePerfRunIdFromContext() {
      if (!perfContext || typeof perfContext.getRunId !== "function") return null;
      try {
        return perfContext.getRunId();
      } catch (_error) {
        return null;
      }
    }

    function resolveTickRefreshContext(context) {
      if (!context || typeof context !== "object") return null;

      const runId = context.runId;
      if (runId == null) return context;

      return {
        runId: runId,
        tickPaintStartMs: context.tickPaintStartMs,
        includeCold: false,
      };
    }

    function scheduleTickRefresh(runContext) {
      if (typeof fetchAll !== "function") {
        return;
      }

      if (tickRefreshInFlight) {
        tickRefreshQueued = true;
        tickRefreshQueuedContext = resolveTickRefreshContext(runContext);
        return;
      }

      tickRefreshInFlight = true;
      const request = resolveTickRefreshContext(runContext) || { includeCold: false };
      let refreshResult;
      try {
        refreshResult = fetchAll(request);
      } catch (_error) {
        refreshResult = Promise.reject(_error);
      }

      Promise.resolve(refreshResult)
        .catch(function () {})
        .finally(function () {
          tickRefreshInFlight = false;
          if (!tickRefreshQueued) {
            activeTickRunId = null;
          }
          if (tickRefreshQueued) {
            tickRefreshQueued = false;
            const nextContext = tickRefreshQueuedContext;
            tickRefreshQueuedContext = null;
            scheduleTickRefresh(nextContext);
          }
        });
    }

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
        const shouldRecord = Boolean(resolvePerfMonitor());
        let inboundBytes = 0;
        if (shouldRecord) {
          inboundBytes = estimateMessageBytes(event && event.data);
          inboundMessageCount += 1;
          inboundMessageBytes += inboundBytes;
        }

        const parseStart = shouldRecord ? nowMs() : 0;
        let data;
        try {
          data = JSON.parse(event.data);
        } catch (error) {
          const parseMs = shouldRecord ? normalizeDurationMs(nowMs() - parseStart) : 0;
          if (shouldRecord) {
            recordPerf({
              name: "ws.message.parse_error",
              payloadBytes: inboundBytes,
              parseMs: parseMs,
              dispatchMs: 0,
              messageCount: inboundMessageCount,
              bytesTotal: inboundMessageBytes,
            });
          }
          diagLog(wsLogPrefix, "message_parse_error", {
            error: error && error.message ? error.message : String(error),
          });
          return;
        }
        const parseMs = shouldRecord ? normalizeDurationMs(nowMs() - parseStart) : 0;

        const messageType = data && data.type;
        const dispatchStart = shouldRecord ? nowMs() : 0;
        if (messageType === "tick") {
          const tickPaintStartMs = shouldRecord ? nowMs() : null;
          const currentRunId = resolvePerfRunIdFromContext();
          const tickRunId =
            currentRunId == null ? activeTickRunId || "tick-" + ++tickRunSeq : currentRunId;

          if (currentRunId == null) {
            activeTickRunId = tickRunId;
            if (shouldRecord) {
              setPerfRunId(tickRunId);
            }
          }

          scheduleTickRefresh({
            runId: tickRunId,
            tickPaintStartMs: tickPaintStartMs,
          });
        }
        if (messageType === "gateway-status" && typeof setGatewayUptimeSnapshot === "function") {
          setGatewayUptimeSnapshot(data.uptimeMs);
        }
        if (window.handleChatWsMessage) {
          window.handleChatWsMessage(data);
        }
        const dispatchMs = shouldRecord ? normalizeDurationMs(nowMs() - dispatchStart) : 0;

        if (shouldRecord) {
          recordPerf({
            name: createMessageMetricName(messageType),
            payloadBytes: inboundBytes,
            parseMs: parseMs,
            dispatchMs: dispatchMs,
            messageCount: inboundMessageCount,
            bytesTotal: inboundMessageBytes,
          });
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

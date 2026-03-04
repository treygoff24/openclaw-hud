(function () {
  "use strict";

  window.HUDApp = window.HUDApp || {};

  function initApp(options) {
    const opts = options || {};
    const doc = opts.document || document;
    const HUD = opts.HUD || window.HUD;
    let localStorage;

    try {
      localStorage = window.localStorage;
    } catch (_error) {
      localStorage = null;
    }

    const $ = function (selector) {
      return doc.querySelector(selector);
    };

    const diagnostics = window.HUDApp.diagnostics || {};
    const diagLog = diagnostics.ensureHudDiagLogger();
    const perfTransportLogger = function (event, message) {
      diagLog("[HUD-PERF]", "transport", {
        event: typeof event === "string" ? event : "perf-batch",
        message: message,
      });
    };
    const previousPerfMonitor = window.HUDApp.perfMonitor;
    const previousPerfLongTaskHook = window.HUDApp.perfLongTaskHook;
    const previousPerfLongAnimationFrameHook = window.HUDApp.perfLongAnimationFrameHook;
    const previousPerfFrameBudgetHook = window.HUDApp.perfFrameBudgetHook;

    if (
      previousPerfMonitor &&
      typeof previousPerfMonitor.stop === "function"
    ) {
      try {
        previousPerfMonitor.stop();
      } catch (_error) {
        diagLog(
          "[HUD-PERF]",
          "previous monitor stop failed",
          String(_error && _error.message ? _error.message : _error)
        );
      }
    }

    if (
      previousPerfLongTaskHook &&
      typeof previousPerfLongTaskHook.stop === "function"
    ) {
      try {
        previousPerfLongTaskHook.stop();
      } catch (_error) {
        diagLog(
          "[HUD-PERF]",
          "previous long-task monitor stop failed",
          String(_error && _error.message ? _error.message : _error),
        );
      }
    }

    if (
      previousPerfLongAnimationFrameHook &&
      typeof previousPerfLongAnimationFrameHook.stop === "function"
    ) {
      try {
        previousPerfLongAnimationFrameHook.stop();
      } catch (_error) {
        diagLog(
          "[HUD-PERF]",
          "previous long-animation-frame monitor stop failed",
          String(_error && _error.message ? _error.message : _error),
        );
      }
    }

    if (previousPerfFrameBudgetHook && typeof previousPerfFrameBudgetHook.stop === "function") {
      try {
        previousPerfFrameBudgetHook.stop();
      } catch (_error) {
        diagLog(
          "[HUD-PERF]",
          "previous frame-budget monitor stop failed",
          String(_error && _error.message ? _error.message : _error),
        );
      }
    }

    const wsLogPrefix = "[HUD-WS]";
    const perfDiagnosticsFlags =
      typeof diagnostics.resolvePerfDiagnosticsFlags === "function"
            ? diagnostics.resolvePerfDiagnosticsFlags({
                locationSearch: window.location.search,
                localStorage: localStorage,
                globalConfig: opts.globalConfig,
              })
        : { enabled: false };
    const perfBatchTransport =
      typeof diagnostics.createPerfBatchTransport === "function"
        ? diagnostics.createPerfBatchTransport({
            enabled: perfDiagnosticsFlags.enabled,
            sink: perfDiagnosticsFlags.sink,
            endpoint: "/api/diag/perf",
            batchSize: opts.perfBatchSize || 5,
            flushIntervalMs: 3000,
            logger: perfTransportLogger,
            fetchImpl: function (url, options) {
              return window.fetch(url, options);
            },
          })
        : null;

    const perfMonitor =
      typeof diagnostics.createPerfMonitor === "function"
        ? diagnostics.createPerfMonitor({
            enabled: perfDiagnosticsFlags.enabled,
            summaryIntervalMs: opts.perfSummaryIntervalMs,
            transport: perfBatchTransport,
            emitSummary: function (summary) {
              diagLog("[HUD-PERF]", "summary", summary);
            },
            logger: function () {},
          })
        : {
            start: () => {},
            stop: () => {},
            record: () => {},
            flushSummary: () => ({}),
            isEnabled: () => false,
          };

    const perfLongTaskHook =
      typeof diagnostics.createLongTaskTelemetryHook === "function"
        ? diagnostics.createLongTaskTelemetryHook({
            enabled: perfDiagnosticsFlags.longTask,
            monitor: perfMonitor,
            performanceObserver: window.PerformanceObserver,
            logger: function (event, fields) {
              var eventName =
                typeof event === "string" && event.trim()
                  ? event.trim()
                  : "long-task";
              var payload =
                fields && typeof fields === "object" && !Array.isArray(fields)
                  ? fields
                  : fields == null
                    ? {}
                    : { message: String(fields) };
              diagLog("[HUD-PERF]", eventName, payload);
            },
          })
        : {
            start: function () {},
            stop: function () {},
            isEnabled: function () {
              return false;
            },
          };

    const perfLongAnimationFrameHook =
      typeof diagnostics.createLongAnimationFrameTelemetryHook === "function"
        ? diagnostics.createLongAnimationFrameTelemetryHook({
            enabled: perfDiagnosticsFlags.longTask,
            monitor: perfMonitor,
            performanceObserver: window.PerformanceObserver,
            logger: function (event, fields) {
              var eventName =
                typeof event === "string" && event.trim()
                  ? event.trim()
                  : "long-animation-frame-observer-failed";
              var payload =
                fields && typeof fields === "object" && !Array.isArray(fields)
                  ? fields
                  : fields == null
                    ? {}
                    : { message: String(fields) };
              diagLog("[HUD-PERF]", eventName, payload);
            },
          })
        : {
            start: function () {},
            stop: function () {},
            isEnabled: function () {
              return false;
            },
          };

    const perfFrameBudgetHook =
      typeof diagnostics.createFrameBudgetTelemetryHook === "function"
        ? diagnostics.createFrameBudgetTelemetryHook({
            enabled: perfDiagnosticsFlags.enabled,
            monitor: perfMonitor,
            requestAnimationFrame: window.requestAnimationFrame,
            cancelAnimationFrame: window.cancelAnimationFrame,
            logger: function (event, fields) {
              var eventName =
                typeof event === "string" && event.trim()
                  ? event.trim()
                  : "frame-budget";
              var payload =
                fields && typeof fields === "object" && !Array.isArray(fields)
                  ? fields
                  : fields == null
                    ? {}
                    : { message: String(fields) };
              diagLog("[HUD-PERF]", eventName, payload);
            },
          })
        : {
            start: function () {},
            stop: function () {},
            isEnabled: function () {
              return false;
            },
          };

    if (typeof diagnostics.resolvePerfEventContext === "function") {
      window.HUDApp.perfEventContext = diagnostics.resolvePerfEventContext();
    } else {
      window.HUDApp.perfEventContext = window.HUDApp.perfEventContext || {
        runId: null,
        setRunId: function (runId) {
          this.runId = runId == null ? null : String(runId);
        },
        getRunId: function () {
          return this.runId;
        },
      };
    }

    window.HUDApp.perfMonitor = perfMonitor;
    window.HUDApp.perfLongTaskHook = perfLongTaskHook;
    window.HUDApp.perfLongAnimationFrameHook = perfLongAnimationFrameHook;
    window.HUDApp.perfFrameBudgetHook = perfFrameBudgetHook;

    const statusController = window.HUDApp.status.createStatusController({
      document: doc,
      querySelector: $,
    });
    statusController.start();

    const uiController = window.HUDApp.ui.createUiController({
      document: doc,
      querySelector: $,
      HUD: HUD,
    });
    uiController.bindDelegationHandlers();

    HUD.showToast = uiController.showToast;
    window.renderPanelSafe = uiController.renderPanelSafe;
    window.retryPanel = uiController.retryPanel;

    const dataController = window.HUDApp.data.createDataController({
      document: doc,
      HUD: HUD,
      getFetch: function () {
        return window.fetch.bind(window);
      },
      renderPanelSafe: uiController.renderPanelSafe,
      setConnectionStatus: statusController.setConnectionStatus,
      onChatRestore: function (sessions) {
        if (typeof window.restoreSavedChatSession === "function") {
          window.restoreSavedChatSession(sessions);
        }
      },
    });

    HUD.fetchAll = dataController.fetchAll;
    uiController.setRetryHandler(HUD.fetchAll);

    const pollingController = window.HUDApp.polling.createPollingController({
      task: HUD.fetchAll,
      intervalMs: 15000,
    });

    const wsController = window.HUDApp.ws.createWsController({
      diagLog: diagLog,
      wsLogPrefix: wsLogPrefix,
      fetchAll: HUD.fetchAll,
      setConnectionStatus: statusController.setConnectionStatus,
      setGatewayUptimeSnapshot: statusController.setGatewayUptimeSnapshot,
      startPolling: pollingController.start,
      stopPolling: pollingController.stop,
      wsUrlFactory: function () {
        return HUD.utils.wsUrl(location);
      },
    });

    HUD.agents.init();
    HUD.cron.init();
    HUD.spawn.init();

      if (perfMonitor.isEnabled && perfMonitor.isEnabled()) {
        perfMonitor.start();
        if (perfLongTaskHook && typeof perfLongTaskHook.start === "function") {
          perfLongTaskHook.start();
        }
        if (perfLongAnimationFrameHook && typeof perfLongAnimationFrameHook.start === "function") {
          perfLongAnimationFrameHook.start();
        }
        if (perfFrameBudgetHook && typeof perfFrameBudgetHook.start === "function") {
          perfFrameBudgetHook.start();
        }
      }

    HUD.fetchAll();
    pollingController.start();
    wsController.connect();

    return {
      fetchAll: HUD.fetchAll,
      showToast: HUD.showToast,
      renderPanelSafe: window.renderPanelSafe,
      retryPanel: window.retryPanel,
      connectWs: wsController.connect,
    };
  }

  window.HUDApp.bootstrap = {
    initApp,
  };
})();

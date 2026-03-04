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

    window.HUDApp.perfMonitor = perfMonitor;

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

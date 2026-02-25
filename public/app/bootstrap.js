(function () {
  "use strict";

  window.HUDApp = window.HUDApp || {};

  function initApp(options) {
    const opts = options || {};
    const doc = opts.document || document;
    const HUD = opts.HUD || window.HUD;
    const $ = function (selector) {
      return doc.querySelector(selector);
    };

    const diagLog = window.HUDApp.diagnostics.ensureHudDiagLogger();
    const wsLogPrefix = "[HUD-WS]";

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

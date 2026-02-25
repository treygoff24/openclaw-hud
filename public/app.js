// app.js — Thin facade: validates app modules and boots runtime
(function () {
  "use strict";

  window.HUD = window.HUD || {};

  const root = window.HUDApp;
  const requiredPaths = [
    "diagnostics.ensureHudDiagLogger",
    "status.createStatusController",
    "ui.createUiController",
    "data.createDataController",
    "polling.createPollingController",
    "ws.createWsController",
    "bootstrap.initApp",
  ];

  function hasPath(obj, path) {
    return path.split(".").every(function (segment) {
      if (!obj || !Object.prototype.hasOwnProperty.call(obj, segment)) {
        obj = null;
        return false;
      }
      obj = obj[segment];
      return true;
    });
  }

  if (!root) {
    throw new Error("[HUD] App bootstrap failed: window.HUDApp is not initialized.");
  }

  const missing = requiredPaths.filter(function (path) {
    return !hasPath(root, path);
  });

  if (missing.length > 0) {
    const message =
      "[HUD] App bootstrap failed: missing required module APIs: " + missing.join(", ");
    console.error(message);
    throw new Error(message);
  }

  const runtime = root.bootstrap.initApp({
    document: document,
    HUD: window.HUD,
  });

  // Compatibility globals expected by other scripts/tests.
  window.HUD.fetchAll = runtime.fetchAll;
  window.HUD.showToast = runtime.showToast;
  window.renderPanelSafe = runtime.renderPanelSafe;
  window.retryPanel = runtime.retryPanel;
  window._modelAliases = window._modelAliases || [];
  window._allSessions = window._allSessions || [];
  window._hudWs = window._hudWs || null;
})();

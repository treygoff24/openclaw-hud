(function () {
  "use strict";

  window.HUDApp = window.HUDApp || {};

  function createPollingController(options) {
    const opts = options || {};
    const task = opts.task;
    const intervalMs = typeof opts.intervalMs === "number" ? opts.intervalMs : 15000;
    let pollInterval = null;

    function start() {
      if (pollInterval || typeof task !== "function") return;
      pollInterval = setInterval(task, intervalMs);
    }

    function stop() {
      if (!pollInterval) return;
      clearInterval(pollInterval);
      pollInterval = null;
    }

    return {
      start,
      stop,
    };
  }

  window.HUDApp.polling = {
    createPollingController,
  };
})();

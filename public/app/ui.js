(function () {
  "use strict";

  window.HUDApp = window.HUDApp || {};
  const PANEL_POST_PAINT_SAMPLE_INTERVAL = 4;
  let panelRenderPostPaintCounter = 0;

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
      // Ignore diagnostics failures for user-visible behavior.
    }
  }

  function shouldSamplePostPaint() {
    panelRenderPostPaintCounter += 1;
    return panelRenderPostPaintCounter % PANEL_POST_PAINT_SAMPLE_INTERVAL === 0;
  }

  function createUiController(options) {
    const opts = options || {};
    const doc = opts.document || document;
    const $ =
      opts.querySelector ||
      function (selector) {
        return doc.querySelector(selector);
      };
    const HUD = opts.HUD || window.HUD;
    let retryHandler = function () {};

    function resolveOpenChatPane() {
      if (typeof opts.openChatPane === "function") return opts.openChatPane;
      if (typeof window.openChatPane === "function") return window.openChatPane;
      return null;
    }

    function tryOpenChatPane(agentId, sessionId, label, sessionKey) {
      const openChatPane = resolveOpenChatPane();
      if (typeof openChatPane !== "function") {
        console.warn("openChatPane is unavailable; chat pane scripts may not be loaded yet.");
        return;
      }

      openChatPane(agentId, sessionId, label, sessionKey);
    }

    function showToast(message, isError) {
      const toast = $("#toast");
      if (!toast) return;

      toast.textContent = message;
      toast.className = "toast" + (isError ? " error" : "");
      requestAnimationFrame(function () {
        toast.classList.add("visible");
        setTimeout(function () {
          toast.classList.remove("visible");
        }, 3000);
      });
    }

  function renderPanelSafe(panelName, panelEl, renderFn, data) {
      if (!panelEl) {
        console.warn("Panel element not found: " + panelName);
        return;
      }

      const shouldRecordPerf = Boolean(resolvePerfMonitor());
      const renderStartedAt = shouldRecordPerf
        ? typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now()
        : null;

      let renderSucceeded = 0;
      try {
        renderFn(panelEl, data);
        renderSucceeded = 1;
      } catch (err) {
        console.error("Panel render failed: " + panelName, err);
        panelEl.innerHTML =
          '<div class="panel-error">' +
          '<span class="panel-error-msg">—</span>' +
          '<button class="panel-retry-btn" onclick="retryPanel(\'' +
          panelName +
          '\')" title="Retry">↻</button>' +
          "</div>";
      }

      if (shouldRecordPerf) {
        const renderFinishedAt =
          typeof performance !== "undefined" && typeof performance.now === "function"
            ? performance.now()
            : Date.now();
        recordPerf({
          name: "panelRender",
          panelName: panelName,
          durationMs: renderFinishedAt - renderStartedAt,
          status: renderSucceeded,
        });
      }

      if (shouldRecordPerf && shouldSamplePostPaint() && typeof requestAnimationFrame === "function") {
        const paintScheduledAt =
          typeof performance !== "undefined" && typeof performance.now === "function"
            ? performance.now()
            : Date.now();

        requestAnimationFrame(function () {
          const paintDoneAt =
            typeof performance !== "undefined" && typeof performance.now === "function"
              ? performance.now()
              : Date.now();
          recordPerf({
            name: "panelRender.postPaintDelay",
            panelName: panelName,
            durationMs: paintDoneAt - paintScheduledAt,
          });
        });
      }
    }

    function retryPanel(panelName) {
      console.log("Retrying panel: " + panelName);
      retryHandler();
    }

    function setRetryHandler(fn) {
      retryHandler = typeof fn === "function" ? fn : function () {};
    }

    function handleGlobalClick(event) {
      const cronRow = event.target.closest("[data-cron-id]");
      if (cronRow) {
        HUD.cron.openEditor(cronRow.dataset.cronId);
        return;
      }

      const row = event.target.closest("[data-agent][data-session-key]");
      if (row) {
        tryOpenChatPane(
          row.dataset.agent,
          row.dataset.session || "",
          row.dataset.label || "",
          row.dataset.sessionKey,
        );
      }

      const card = event.target.closest("[data-agent-id]");
      if (card && !row) {
        HUD.agents.showAgentSessions(card.dataset.agentId);
      }
    }

    function handleTreeClick(event) {
      const toggle = event.target.closest("[data-toggle-key]");
      if (toggle) {
        HUD.sessionTree.toggleNode(toggle.dataset.toggleKey);
        event.stopPropagation();
        return;
      }

      const treeNode = event.target.closest("[data-tree-key]");
      if (treeNode && !event.target.closest("[data-toggle-key]")) {
        const agent = treeNode.dataset.agent;
        const session = treeNode.dataset.session;
        const sessionKey = treeNode.dataset.sessionKey;
        if (agent && sessionKey) {
          tryOpenChatPane(agent, session || "", treeNode.dataset.label || "", sessionKey);
        }
      }
    }

    function bindEscapeModalClose() {
      doc.addEventListener("keydown", function (event) {
        if (event.key !== "Escape") return;

        const modals = ["#spawn-modal", "#cron-modal"];
        for (const id of modals) {
          const modal = $(id);
          if (!modal || !modal.classList.contains("active")) continue;
          event.preventDefault();
          modal.classList.remove("active");
          event.stopImmediatePropagation();
          return;
        }
      });
    }

    function bindDelegationHandlers() {
      doc.addEventListener("click", handleGlobalClick);
      doc.addEventListener("click", handleTreeClick);
      bindEscapeModalClose();
    }

    return {
      bindDelegationHandlers,
      showToast,
      renderPanelSafe,
      retryPanel,
      setRetryHandler,
    };
  }

  window.HUDApp.ui = {
    createUiController,
  };
})();

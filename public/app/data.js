(function () {
  "use strict";

  window.HUDApp = window.HUDApp || {};

  function createDataController(options) {
    const opts = options || {};
    const HUD = opts.HUD || window.HUD;
    const doc = opts.document || document;
    const renderPanelSafe = opts.renderPanelSafe;
    const setConnectionStatus = opts.setConnectionStatus;
    const onChatRestore = opts.onChatRestore;
    const getFetch =
      opts.getFetch ||
      function () {
        return window.fetch.bind(window);
      };

    let hasAttemptedChatSessionRestore = false;

    async function fetchAll() {
      const endpoints = [
        { name: "agents", url: "/api/agents" },
        { name: "sessions", url: "/api/sessions" },
        { name: "cron", url: "/api/cron" },
        { name: "config", url: "/api/config" },
        { name: "model-usage", url: "/api/model-usage/live-weekly" },
        { name: "activity", url: "/api/activity" },
        { name: "session-tree", url: "/api/session-tree" },
        { name: "models", url: "/api/models" },
      ];

      function extractResponseMeta(response, payload) {
        const headerRequestId = response?.headers?.get?.("x-request-id") || "";
        const payloadRequestId =
          payload && typeof payload === "object"
            ? payload.requestId || payload?.meta?.requestId || ""
            : "";
        const payloadTimestamp =
          payload && typeof payload === "object"
            ? payload.timestamp || payload?.meta?.requestTimestamp || ""
            : "";

        return {
          ok: Boolean(response?.ok),
          status: Number.isFinite(response?.status) ? response.status : 0,
          statusText: response?.statusText || "",
          requestId: headerRequestId || payloadRequestId || "",
          timestamp: payloadTimestamp,
        };
      }

      try {
        const runFetch = getFetch();
        const results = await Promise.allSettled(
          endpoints.map(function (endpoint) {
            return runFetch(endpoint.url)
              .then(function (response) {
                return response
                  .json()
                  .then(function (payload) {
                    return {
                      payload,
                      meta: extractResponseMeta(response, payload),
                    };
                  })
                  .catch(function (err) {
                    console.warn("Endpoint " + endpoint.name + " JSON parse failed:", err);
                    return {
                      payload: null,
                      meta: extractResponseMeta(response, null),
                    };
                  });
              })
              .catch(function (err) {
                console.warn("Endpoint " + endpoint.name + " failed:", err);
                return {
                  payload: null,
                  meta: {
                    ok: false,
                    status: 0,
                    statusText: err?.message || "fetch-failed",
                    requestId: "",
                    timestamp: "",
                  },
                };
              });
          }),
        );

        const data = {};
        const responseMeta = {};
        results.forEach(function (result, index) {
          const endpointName = endpoints[index].name;
          if (result.status === "fulfilled" && result.value && typeof result.value === "object") {
            data[endpointName] = Object.prototype.hasOwnProperty.call(result.value, "payload")
              ? result.value.payload
              : null;
            responseMeta[endpointName] = result.value.meta || null;
            return;
          }
          data[endpointName] = null;
          responseMeta[endpointName] = null;
        });

        window._endpointResponseMeta = responseMeta;
        window._modelAliases = data.models || [];
        window._allSessions = data.sessions || [];

        renderPanelSafe(
          "agents",
          doc.getElementById("agents-list"),
          function (el, panelData) {
            HUD.agents.render(panelData);
          },
          data.agents,
        );
        renderPanelSafe(
          "sessions",
          doc.getElementById("sessions-list"),
          function (el, panelData) {
            HUD.sessions.render(panelData);
          },
          data.sessions,
        );
        renderPanelSafe(
          "cron",
          doc.getElementById("cron-list"),
          function (el, panelData) {
            HUD.cron.render(panelData);
          },
          data.cron,
        );
        renderPanelSafe(
          "system",
          doc.getElementById("system-info"),
          function (el, panelData) {
            HUD.system.render(panelData);
          },
          data.config,
        );
        renderPanelSafe(
          "models",
          doc.getElementById("model-usage"),
          function (el, panelData) {
            HUD.models.render(panelData, responseMeta["model-usage"]);
          },
          data["model-usage"],
        );
        renderPanelSafe(
          "activity",
          doc.getElementById("activity-feed"),
          function (el, panelData) {
            HUD.activity.render(panelData);
          },
          data.activity,
        );
        renderPanelSafe(
          "session-tree",
          doc.getElementById("tree-body"),
          function (el, panelData) {
            HUD.sessionTree.render(panelData);
          },
          data["session-tree"],
        );

        if (
          !hasAttemptedChatSessionRestore &&
          typeof onChatRestore === "function" &&
          data.sessions
        ) {
          hasAttemptedChatSessionRestore = true;
          onChatRestore(data.sessions);
        }

        const hasAnyData = results.some(function (result) {
          return result.status === "fulfilled" && result.value && result.value.payload !== null;
        });
        setConnectionStatus(hasAnyData);
      } catch (err) {
        console.error("Fetch error:", err);
        setConnectionStatus(false);
      }
    }

    return {
      fetchAll,
    };
  }

  window.HUDApp.data = {
    createDataController,
  };
})();

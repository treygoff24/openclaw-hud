(function () {
  "use strict";

  window.HUDApp = window.HUDApp || {};
  const DEFAULT_ENDPOINT_TIMEOUT_MS = 8000;
  const COLD_REFRESH_INTERVAL_MS = 60 * 1000;

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
    const endpointTimeoutMs =
      Number.isFinite(opts.endpointTimeoutMs) && opts.endpointTimeoutMs > 0
        ? Math.floor(opts.endpointTimeoutMs)
        : DEFAULT_ENDPOINT_TIMEOUT_MS;

    let hasAttemptedChatSessionRestore = false;
    let latestFetchRunId = 0;
    let activeFetchAll = null;
    let queuedColdFetch = null;
    let lastColdRefreshAt = 0;
    let cachedMonthlyFingerprint = null;

    // Cached monthly data survives across tick-based fetchAll() calls so the
    // models panel never flashes back to $0 between the weekly render and the
    // async monthly callback.
    let cachedMonthlyPayload = null;

    const hotEndpoints = [
      { name: "agents", url: "/api/agents" },
      { name: "sessions", url: "/api/sessions" },
      { name: "cron", url: "/api/cron" },
      { name: "config", url: "/api/config" },
      { name: "model-usage", url: "/api/model-usage/live-weekly" },
      { name: "activity", url: "/api/activity" },
      { name: "session-tree", url: "/api/session-tree" },
    ];

    const coldEndpoints = [
      { name: "models", url: "/api/models" },
    ];
    const coldEndpointNames = coldEndpoints.map(function (endpoint) {
      return endpoint.name;
    });

    // Monthly usage endpoint - fetched asynchronously (not blocking initial render)
    const monthlyEndpoint = { name: "model-usage-monthly", url: "/api/model-usage/monthly" };

    const endpointPanels = {
      agents: {
        panelName: "agents",
        elementId: "agents-list",
        render: function (payload) {
          HUD.agents.render(payload);
        },
      },
      sessions: {
        panelName: "sessions",
        elementId: "sessions-list",
        render: function (payload) {
          HUD.sessions.render(payload);
        },
      },
      cron: {
        panelName: "cron",
        elementId: "cron-list",
        render: function (payload) {
          HUD.cron.render(payload);
        },
      },
      config: {
        panelName: "system",
        elementId: "system-info",
        render: function (payload) {
          HUD.system.render(payload);
        },
      },
      "model-usage": {
        panelName: "models",
        elementId: "model-usage",
        render: function (payload, meta) {
          HUD.models.render(payload, meta);
        },
      },
      activity: {
        panelName: "activity",
        elementId: "activity-feed",
        render: function (payload) {
          HUD.activity.render(payload);
        },
      },
      "session-tree": {
        panelName: "session-tree",
        elementId: "tree-body",
        render: function (payload) {
          HUD.sessionTree.render(payload);
        },
        },
    };

    function normalizeFetchRequest(request) {
      return {
        includeCold: Boolean(request && request.includeCold),
      };
    }

    function shouldFetchColdEndpoints(includeColdRequest) {
      const now = Date.now();
      const dueForRefresh = now - lastColdRefreshAt >= COLD_REFRESH_INTERVAL_MS;
      return includeColdRequest || dueForRefresh;
    }

    function monthlyFingerprint(payload) {
      try {
        return JSON.stringify(payload);
      } catch {
        return "";
      }
    }

    function modelUsageWithMonthly(state) {
      const weeklyPayload = state.data["model-usage"];
      if (!cachedMonthlyPayload) {
        return weeklyPayload;
      }

      if (!weeklyPayload || typeof weeklyPayload !== "object") {
        return weeklyPayload;
      }

      return Object.assign({}, weeklyPayload, {
        _monthlyData: cachedMonthlyPayload,
      });
    }

    function renderModelUsagePanel(state) {
      renderEndpointPanel("model-usage", modelUsageWithMonthly(state), state.responseMeta["model-usage"]);
    }

    function applyMonthlyPayload(state, runId, monthlyResult) {
      if (runId !== latestFetchRunId) return false;
      if (!monthlyResult.payload) return false;

      const nextFingerprint = monthlyFingerprint(monthlyResult.payload);
      const monthlyChanged = nextFingerprint !== cachedMonthlyFingerprint;
      if (!monthlyChanged) return false;
      cachedMonthlyPayload = monthlyResult.payload;
      cachedMonthlyFingerprint = nextFingerprint;
      if (!Object.prototype.hasOwnProperty.call(state.data, "model-usage")) return false;
      renderModelUsagePanel(state);
      return true;
    }

    function createFailureMeta(statusText) {
      return {
        ok: false,
        status: 0,
        statusText: statusText || "fetch-failed",
        requestId: "",
        timestamp: "",
      };
    }

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

    function renderEndpointPanel(endpointName, payload, endpointMeta) {
      const panel = endpointPanels[endpointName];
      if (!panel) return;

      renderPanelSafe(
        panel.panelName,
        doc.getElementById(panel.elementId),
        function (el, panelData) {
          panel.render(panelData, endpointMeta);
        },
        payload,
      );
    }

    function fetchEndpoint(runFetch, endpoint) {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      let timeoutId = null;
      let timedOut = false;

      const timeoutPromise = new Promise(function (resolve) {
        timeoutId = setTimeout(function () {
          timedOut = true;
          if (controller) controller.abort();
          console.warn(
            "Endpoint " + endpoint.name + " timed out after " + endpointTimeoutMs + "ms",
          );
          resolve({
            payload: null,
            meta: createFailureMeta("timeout"),
          });
        }, endpointTimeoutMs);
      });

      const fetchPromise = Promise.resolve()
        .then(function () {
          return controller
            ? runFetch(endpoint.url, { signal: controller.signal })
            : runFetch(endpoint.url);
        })
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
          if (timedOut || err?.name === "AbortError") {
            return {
              payload: null,
              meta: createFailureMeta("timeout"),
            };
          }
          console.warn("Endpoint " + endpoint.name + " failed:", err);
          return {
            payload: null,
            meta: createFailureMeta(err?.message || "fetch-failed"),
          };
        });

      return Promise.race([fetchPromise, timeoutPromise]).finally(function () {
        if (timeoutId) clearTimeout(timeoutId);
      });
    }

    function applyEndpointResult(runId, state, endpointName, result) {
      if (runId !== latestFetchRunId) return;

      state.data[endpointName] = Object.prototype.hasOwnProperty.call(result, "payload")
        ? result.payload
        : null;
      state.responseMeta[endpointName] = result.meta || null;

      window._endpointResponseMeta = state.responseMeta;
      if (endpointName === "models") {
        window._modelAliases = state.data.models || [];
      }
      if (endpointName === "sessions") {
        window._allSessions = state.data.sessions || [];
      }

      if (endpointName === "model-usage") {
        renderModelUsagePanel(state);
        return;
      }

      renderEndpointPanel(endpointName, state.data[endpointName], state.responseMeta[endpointName]);

      if (
        endpointName === "sessions" &&
        !hasAttemptedChatSessionRestore &&
        typeof onChatRestore === "function" &&
        state.data.sessions
      ) {
        hasAttemptedChatSessionRestore = true;
        onChatRestore(state.data.sessions);
      }

      if (state.data[endpointName] !== null) {
        state.hasAnyData = true;
        if (!state.connectionSetConnected) {
          state.connectionSetConnected = true;
          setConnectionStatus(true);
        }
      }
    }

    async function fetchAll(options) {
      const request = normalizeFetchRequest(options);

      if (activeFetchAll) {
        if (request.includeCold) {
          if (!queuedColdFetch) {
            const queue = activeFetchAll.then(function () {
              return fetchAll({ includeCold: true });
            });
            queuedColdFetch = queue;
            queue.finally(function () {
              if (queuedColdFetch === queue) {
                queuedColdFetch = null;
              }
            });
          }
          return queuedColdFetch;
        }
        return activeFetchAll;
      }

      const runId = ++latestFetchRunId;
      const shouldFetchCold = shouldFetchColdEndpoints(request.includeCold);
      const runTargets = shouldFetchCold ? hotEndpoints.concat(coldEndpoints) : hotEndpoints;
      const runFetch = getFetch();
      const data = {};
      const responseMeta = {};

      runTargets.forEach(function (endpoint) {
        data[endpoint.name] = null;
        responseMeta[endpoint.name] = null;
      });

      const state = {
        data,
        responseMeta,
        hasAnyData: false,
        connectionSetConnected: false,
      };

      window._endpointResponseMeta = responseMeta;

      const run = function () {
        try {
          const endpointTasks = runTargets.map(function (endpoint) {
            return fetchEndpoint(runFetch, endpoint).then(function (result) {
              applyEndpointResult(runId, state, endpoint.name, result);
              return {
                endpointName: endpoint.name,
                result,
              };
            });
          });

          return Promise.allSettled(endpointTasks)
            .then(function (results) {
              if (runId !== latestFetchRunId) return;

              const hasAnyData = results.some(function (result) {
                return (
                  result.status === "fulfilled" &&
                  result.value &&
                  result.value.result &&
                  result.value.result.payload !== null
                );
              });

              const coldRefreshCompleted = !shouldFetchCold
                ? true
                : results.every(function (entry) {
                    if (coldEndpointNames.indexOf(entry.value && entry.value.endpointName) === -1) {
                      return true;
                    }
                    return entry.status === "fulfilled" &&
                      entry.value &&
                      entry.value.result &&
                      entry.value.result.payload !== null;
                  });

              if (shouldFetchCold && coldRefreshCompleted) {
                lastColdRefreshAt = Date.now();
              }

              if (!coldRefreshCompleted && shouldFetchCold) {
                setConnectionStatus(hasAnyData);
                return;
              }

              setConnectionStatus(hasAnyData);

              if (!shouldFetchCold) return;
              return fetchEndpoint(runFetch, monthlyEndpoint)
                .then(function (monthlyResult) {
                  applyMonthlyPayload(state, runId, monthlyResult);
                })
                .catch(function (err) {
                  console.warn("Monthly usage fetch failed (non-critical):", err);
                });
            })
            .catch(function () {
              setConnectionStatus(false);
            });
        } catch (err) {
          console.error("Fetch error:", err);
          setConnectionStatus(false);
          return Promise.resolve();
        }
      };

      activeFetchAll = run().finally(function () {
        activeFetchAll = null;
      });

      return activeFetchAll;
    }

    return {
      fetchAll,
    };
  }

  window.HUDApp.data = {
    createDataController,
  };
})();

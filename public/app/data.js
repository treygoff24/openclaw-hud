(function () {
  "use strict";

  window.HUDApp = window.HUDApp || {};
  const DEFAULT_ENDPOINT_TIMEOUT_MS = 8000;
  const COLD_REFRESH_INTERVAL_MS = 60 * 1000;
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
      // Ignore perf monitor failures to avoid runtime impact.
    }
  }

  function endpointFetchStatus(result) {
    if (result && result.meta && result.meta.statusText === "timeout") {
      return "timeout";
    }
    if (result && result.meta && result.meta.ok) {
      return "ok";
    }
    return "error";
  }

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
    const configuredEndpointMinIntervals =
      opts.endpointMinIntervalMs && typeof opts.endpointMinIntervalMs === "object"
        ? opts.endpointMinIntervalMs
        : null;

    let hasAttemptedChatSessionRestore = false;
    let latestFetchRunId = 0;
    let activeFetchAll = null;
    let queuedColdFetch = null;
    let lastColdRefreshAt = 0;
    let cachedMonthlyFingerprint = null;
    let endpointPayloadCache = Object.create(null);
    let endpointMetaCache = Object.create(null);
    let endpointETagCache = Object.create(null);
    let endpointInFlight = Object.create(null);
    let endpointLastFetchAt = Object.create(null);
    let endpointRenderFingerprints = Object.create(null);
    let endpointLastRenderedPayloads = Object.create(null);

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

    function resolveEndpointMinIntervalMs(endpointName) {
      if (!configuredEndpointMinIntervals) return 0;
      const interval = configuredEndpointMinIntervals[endpointName];
      if (!Number.isFinite(interval) || interval <= 0) return 0;
      return Math.floor(interval);
    }

    function shouldFetchEndpoint(endpointName, request) {
      if (request.includeCold) return true;
      const minIntervalMs = resolveEndpointMinIntervalMs(endpointName);
      if (minIntervalMs <= 0) return true;

      if (!Object.prototype.hasOwnProperty.call(endpointLastFetchAt, endpointName)) {
        return true;
      }
      const lastFetchedAt = endpointLastFetchAt[endpointName];
      return Date.now() - lastFetchedAt >= minIntervalMs;
    }

    function markEndpointFetched(endpointName) {
      endpointLastFetchAt[endpointName] = Date.now();
    }

    function isSuccessfulFetchMeta(meta) {
      if (!meta || typeof meta !== "object") return false;

      const statusText = typeof meta.statusText === "string" ? meta.statusText.toLowerCase() : "";
      if (statusText === "timeout") return false;
      if (statusText === "fetch-failed") return false;

      const status = Number(meta.status);
      if (Number.isFinite(status) && status > 0) {
        return status >= 200 && status < 400;
      }

      if (typeof meta.ok === "boolean") {
        return meta.ok;
      }

      return false;
    }

    function shouldMarkEndpointFetched(result) {
      if (!result || !isSuccessfulFetchMeta(result.meta)) return false;
      if (isEndpointNotModified(result)) return true;
      if (!Object.prototype.hasOwnProperty.call(result, "payload")) return false;
      return result.payload !== null && result.payload !== undefined;
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

    function payloadFingerprint(payload) {
      try {
        return JSON.stringify(payload);
      } catch {
        return null;
      }
    }

    function isEndpointNotModified(result) {
      const status = Number(result && result.meta && result.meta.status);
      return status === 304 || String(result && result.meta && result.meta.statusText).toLowerCase() === "not modified";
    }

    function extractResponseETag(response) {
      if (!response || !response.headers || typeof response.headers.get !== "function") return "";
      return (
        response.headers.get("if-none-match") ||
        response.headers.get("If-None-Match") ||
        response.headers.get("etag") ||
        response.headers.get("ETag") ||
        ""
      );
    }

    function shouldRenderEndpointPayload(endpointName, payload, providedFingerprint) {
      if (payload === null || payload === undefined) {
        return true;
      }

      const nextFingerprint =
        typeof providedFingerprint === "string" ? providedFingerprint : payloadFingerprint(payload);
      if (nextFingerprint === null) {
        const previousPayload = endpointLastRenderedPayloads[endpointName];
        endpointLastRenderedPayloads[endpointName] = payload;
        return previousPayload !== payload;
      }

      if (endpointRenderFingerprints[endpointName] === nextFingerprint) {
        return false;
      }

      endpointRenderFingerprints[endpointName] = nextFingerprint;
      endpointLastRenderedPayloads[endpointName] = payload;
      return true;
    }

    function endpointResultHasFreshData(endpointName, result) {
      const payload = result && Object.prototype.hasOwnProperty.call(result, "payload") ? result.payload : null;
      if (payload !== null && payload !== undefined) return true;
      if (!isEndpointNotModified(result)) return false;
      return Object.prototype.hasOwnProperty.call(endpointPayloadCache, endpointName);
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
      const payload = modelUsageWithMonthly(state);
      const modelUsageFingerprint = cachedMonthlyPayload
        ? null
        : state.responseFingerprints["model-usage"];
      if (!shouldRenderEndpointPayload("model-usage", payload, modelUsageFingerprint)) return;
      renderEndpointPanel("model-usage", payload, state.responseMeta["model-usage"]);
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
      if (endpointInFlight[endpoint.name]) return endpointInFlight[endpoint.name];

      const controller = typeof AbortController === "function" ? new AbortController() : null;
      let timeoutId = null;
      let timedOut = false;
      const shouldRecordPerf = Boolean(resolvePerfMonitor());
      const fetchStartedAt = shouldRecordPerf
        ? typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now()
        : null;

      const timeoutPromise = new Promise(function (resolve) {
        timeoutId = setTimeout(function () {
          timedOut = true;
          if (controller) controller.abort();
          console.warn(
            "Endpoint " + endpoint.name + " timed out after " + endpointTimeoutMs + "ms",
          );
          resolve({
            payload: null,
            payloadFingerprint: null,
            meta: createFailureMeta("timeout"),
          });
        }, endpointTimeoutMs);
      });

      const requestOptions = {};
      if (controller) requestOptions.signal = controller.signal;
      const cachedETag = endpointETagCache[endpoint.name];
      if (typeof cachedETag === "string" && cachedETag !== "") {
        requestOptions.headers = {
          "If-None-Match": cachedETag,
        };
      }

      const hasOptions = Object.keys(requestOptions).length > 0;
      const fetchPromise = Promise.resolve()
        .then(function () {
          return hasOptions ? runFetch(endpoint.url, requestOptions) : runFetch(endpoint.url);
        })
        .then(function (response) {
          const responseETag = extractResponseETag(response);
          if (responseETag) {
            endpointETagCache[endpoint.name] = responseETag;
          }

          if (Number(response && response.status) === 304) {
            return {
              payload: null,
              payloadFingerprint: null,
              meta: extractResponseMeta(response, null),
            };
          }

          if (response && typeof response.text === "function") {
            return response
              .text()
              .then(function (rawBody) {
                const rawText = typeof rawBody === "string" ? rawBody : "";
                try {
                  const payload = JSON.parse(rawText);
                  return {
                    payload,
                    payloadFingerprint: rawText,
                    meta: extractResponseMeta(response, payload),
                  };
                } catch (err) {
                  console.warn("Endpoint " + endpoint.name + " JSON parse failed:", err);
                  return {
                    payload: null,
                    payloadFingerprint: null,
                    meta: extractResponseMeta(response, null),
                  };
                }
              })
              .catch(function (err) {
                console.warn("Endpoint " + endpoint.name + " JSON parse failed:", err);
                return {
                  payload: null,
                  payloadFingerprint: null,
                  meta: extractResponseMeta(response, null),
                };
              });
          }

          return response
            .json()
            .then(function (payload) {
              const fingerprint = payloadFingerprint(payload);
              return {
                payload,
                payloadFingerprint: fingerprint,
                meta: extractResponseMeta(response, payload),
              };
            })
            .catch(function (err) {
              console.warn("Endpoint " + endpoint.name + " JSON parse failed:", err);
              return {
                payload: null,
                payloadFingerprint: null,
                meta: extractResponseMeta(response, null),
              };
            });
        })
        .catch(function (err) {
          if (timedOut || err?.name === "AbortError") {
            return {
              payload: null,
              payloadFingerprint: null,
              meta: createFailureMeta("timeout"),
            };
          }
          console.warn("Endpoint " + endpoint.name + " failed:", err);
          return {
            payload: null,
            payloadFingerprint: null,
            meta: createFailureMeta(err?.message || "fetch-failed"),
          };
        });

      const endpointRequest = Promise.race([fetchPromise, timeoutPromise]).then(function (result) {
        const status = endpointFetchStatus(result);

        if (shouldRecordPerf) {
          const endedAt =
            typeof performance !== "undefined" && typeof performance.now === "function"
              ? performance.now()
              : Date.now();
          recordPerf({
            name: "fetchEndpoint." + endpoint.name,
            durationMs: endedAt - fetchStartedAt,
            ok: status === "ok" ? 1 : 0,
            error: status === "error" ? 1 : 0,
            timeout: status === "timeout" ? 1 : 0,
            status: Number(result && result.meta && result.meta.status) || 0,
          });
        }

        return result;
      }).finally(function () {
        if (timeoutId) clearTimeout(timeoutId);
        delete endpointInFlight[endpoint.name];
      });

      endpointInFlight[endpoint.name] = endpointRequest;

      return endpointRequest;
    }

    function applyEndpointResult(runId, state, endpointName, result) {
      if (runId !== latestFetchRunId) return;

      const hasPayload = Object.prototype.hasOwnProperty.call(result, "payload");
      const payload = hasPayload ? result.payload : null;
      const hasCachedPayload = Object.prototype.hasOwnProperty.call(endpointPayloadCache, endpointName);
      const isNotModified = isEndpointNotModified(result);

      state.responseMeta[endpointName] = result.meta || null;
      endpointMetaCache[endpointName] = state.responseMeta[endpointName];

      if ((payload === null || payload === undefined || isNotModified) && hasCachedPayload) {
        state.data[endpointName] = endpointPayloadCache[endpointName];
        state.responseFingerprints[endpointName] = endpointRenderFingerprints[endpointName] || null;
      } else {
        state.data[endpointName] = payload;
        state.responseFingerprints[endpointName] =
          typeof result.payloadFingerprint === "string" ? result.payloadFingerprint : null;
        if (payload !== null && payload !== undefined) {
          endpointPayloadCache[endpointName] = payload;
        }
      }

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

      if (
        shouldRenderEndpointPayload(
          endpointName,
          state.data[endpointName],
          state.responseFingerprints[endpointName],
        )
      ) {
        renderEndpointPanel(endpointName, state.data[endpointName], state.responseMeta[endpointName]);
      }

      if (
        endpointName === "sessions" &&
        !hasAttemptedChatSessionRestore &&
        typeof onChatRestore === "function" &&
        state.data.sessions
      ) {
        hasAttemptedChatSessionRestore = true;
        onChatRestore(state.data.sessions);
      }

      if (endpointResultHasFreshData(endpointName, result)) {
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
      const hotRunTargets = hotEndpoints.filter(function (endpoint) {
        return shouldFetchEndpoint(endpoint.name, request);
      });
      const runTargets = shouldFetchCold ? hotRunTargets.concat(coldEndpoints) : hotRunTargets;
      const runFetch = getFetch();
      const data = {};
      const responseMeta = {};
      const responseFingerprints = {};

      runTargets.forEach(function (endpoint) {
        const hasCachedPayload = Object.prototype.hasOwnProperty.call(endpointPayloadCache, endpoint.name);
        data[endpoint.name] = hasCachedPayload ? endpointPayloadCache[endpoint.name] : null;
        responseMeta[endpoint.name] = Object.prototype.hasOwnProperty.call(endpointMetaCache, endpoint.name)
          ? endpointMetaCache[endpoint.name]
          : null;
        responseFingerprints[endpoint.name] = Object.prototype.hasOwnProperty.call(
          endpointRenderFingerprints,
          endpoint.name,
        )
          ? endpointRenderFingerprints[endpoint.name]
          : null;
      });

      const state = {
        data,
        responseMeta,
        responseFingerprints,
        hasAnyData: false,
        connectionSetConnected: false,
      };

      window._endpointResponseMeta = responseMeta;

      const run = function () {
        const shouldRecordPerf = Boolean(resolvePerfMonitor());
        const runStartedAt = shouldRecordPerf
          ? typeof performance !== "undefined" && typeof performance.now === "function"
            ? performance.now()
            : Date.now()
          : null;

        if (shouldRecordPerf) {
          recordPerf({
            name: "fetchAll.start",
            count: 1,
            includeCold: shouldFetchCold ? 1 : 0,
            endpointCount: runTargets.length,
          });
        }

        try {
          const endpointTasks = runTargets.map(function (endpoint) {
            return fetchEndpoint(runFetch, endpoint).then(function (result) {
              if (shouldMarkEndpointFetched(result)) {
                markEndpointFetched(endpoint.name);
              }
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

              const hasAnyData = results.some(function (entry) {
                if (entry.status !== "fulfilled" || !entry.value || !entry.value.endpointName) return false;
                return endpointResultHasFreshData(entry.value.endpointName, entry.value.result);
              });

              const coldRefreshCompleted = !shouldFetchCold
                ? true
                : results.every(function (entry) {
                    if (coldEndpointNames.indexOf(entry.value && entry.value.endpointName) === -1) {
                      return true;
                    }
                    if (entry.status !== "fulfilled") return false;

                    return endpointResultHasFreshData(
                      entry.value.endpointName,
                      entry.value && entry.value.result,
                    );
                  });

              if (shouldFetchCold && coldRefreshCompleted) {
                lastColdRefreshAt = Date.now();
              }

              if (shouldRecordPerf) {
                const runFinishedAt =
                  typeof performance !== "undefined" && typeof performance.now === "function"
                    ? performance.now()
                    : Date.now();
                recordPerf({
                  name: "fetchAll.finish",
                  durationMs: runFinishedAt - runStartedAt,
                  includeCold: shouldFetchCold ? 1 : 0,
                  hasAnyData: hasAnyData ? 1 : 0,
                  success: !(!coldRefreshCompleted && shouldFetchCold) ? 1 : 0,
                });
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
              if (shouldRecordPerf) {
                const runFinishedAt =
                  typeof performance !== "undefined" && typeof performance.now === "function"
                    ? performance.now()
                    : Date.now();
                recordPerf({
                  name: "fetchAll.finish",
                  durationMs: runFinishedAt - runStartedAt,
                  includeCold: shouldFetchCold ? 1 : 0,
                  hasAnyData: 0,
                  success: 0,
                });
              }

              setConnectionStatus(false);
            });
        } catch (err) {
          console.error("Fetch error:", err);
          setConnectionStatus(false);
          if (shouldRecordPerf) {
            const runFinishedAt =
              typeof performance !== "undefined" && typeof performance.now === "function"
                ? performance.now()
                : Date.now();
            recordPerf({
              name: "fetchAll.finish",
              durationMs: runFinishedAt - runStartedAt,
              includeCold: shouldFetchCold ? 1 : 0,
              hasAnyData: 0,
              success: 0,
            });
          }
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
      _test: {
        fetchEndpoint: function (endpointName, endpointUrl) {
          if (
            typeof endpointName !== "string" ||
            typeof endpointUrl !== "string" ||
            !endpointName ||
            !endpointUrl
          ) {
            return Promise.resolve({
              payload: null,
              payloadFingerprint: null,
              meta: createFailureMeta("invalid-test-endpoint"),
            });
          }

          return fetchEndpoint(getFetch(), {
            name: endpointName,
            url: endpointUrl,
          });
        },
      },
    };
  }

  window.HUDApp.data = {
    createDataController,
  };
})();

(function () {
  "use strict";

  window.HUDApp = window.HUDApp || {};

  function parseBooleanFlagValue(rawValue) {
    if (rawValue == null) {
      return null;
    }

    var normalized = String(rawValue).trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    if (normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes") {
      return true;
    }

    if (normalized === "0" || normalized === "false" || normalized === "off" || normalized === "no") {
      return false;
    }

    return null;
  }

  function parsePerfSinkValue(rawValue) {
    if (rawValue == null) {
      return null;
    }

    var normalized = String(rawValue).trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    return normalized;
  }

  function createNoopPerfMonitor() {
    function noop() {}

    return {
      record: noop,
      start: noop,
      stop: noop,
      flushSummary: function () {
        return {};
      },
      isEnabled: function () {
        return false;
      },
    };
  }

  function ensureHudDiagLogger() {
    if (typeof window.__hudDiagLog === "function") {
      return window.__hudDiagLog;
    }

    window.__hudDiagLog = function (prefix, event, fields) {
      const now = new Date().toISOString();
      const diag =
        window.__HUD_DIAG__ || (window.__HUD_DIAG__ = { maxEvents: 200, events: [], seq: 0 });
      if (!Array.isArray(diag.events)) diag.events = [];
      if (!diag.maxEvents || diag.maxEvents < 1) diag.maxEvents = 200;
      if (typeof diag.seq !== "number") diag.seq = 0;

      const payload = fields || {};
      const entry = Object.assign(
        { seq: ++diag.seq, ts: now, prefix: prefix, event: event },
        payload,
      );
      diag.events.push(entry);
      if (diag.events.length > diag.maxEvents) {
        diag.events.splice(0, diag.events.length - diag.maxEvents);
      }

      const parts = [];
      for (const key in payload) {
        if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
        const value = payload[key];
        if (value === undefined) continue;
        parts.push(key + "=" + (typeof value === "string" ? JSON.stringify(value) : String(value)));
      }

      console.log(
        (prefix + " " + event + " ts=" + now + (parts.length ? " " + parts.join(" ") : "")).trim(),
      );
    };

    return window.__hudDiagLog;
  }

  function resolvePerfDiagnosticsFlags(input) {
    var options = input || {};
    var storageUnavailable = false;
    var locationSearch =
      typeof options.locationSearch === "string"
        ? options.locationSearch
        : typeof options.search === "string"
          ? options.search
          : "";
    var querySink = parsePerfSinkValue(
      locationSearch ? new URLSearchParams(locationSearch).get("hudPerfSink") : null,
    );
    var hasQuerySink = querySink != null;
    var localStorageValue = null;

    if (options.localStorage && typeof options.localStorage.getItem === "function") {
      try {
        localStorageValue = options.localStorage.getItem("hudPerf");
      } catch (_error) {
        storageUnavailable = true;
      }
    } else if (typeof options.localStorageValue === "string") {
      localStorageValue = options.localStorageValue;
    }

    var queryValue = parseBooleanFlagValue(
      locationSearch ? new URLSearchParams(locationSearch).get("hudPerf") : null,
    );
    var sinkMode = hasQuerySink ? querySink : "console";

    function buildFlags(enabled) {
      var flags = { enabled: enabled };
      if (enabled || hasQuerySink) {
        flags.sink = sinkMode;
      }

      return flags;
    }

    if (queryValue !== null) {
      return buildFlags(queryValue);
    }

    if (storageUnavailable) {
      return buildFlags(false);
    }

    var storageValue = parseBooleanFlagValue(localStorageValue);
    if (storageValue !== null) {
      return buildFlags(storageValue);
    }

    if (typeof options.globalConfig === "boolean") {
      return { enabled: options.globalConfig };
    }

    if (typeof options.globalConfig === "string" || typeof options.globalConfig === "number") {
      var fallback = parseBooleanFlagValue(options.globalConfig);
      if (fallback !== null) {
        return buildFlags(fallback);
      }
    }

    return buildFlags(false);
  }

  function createPerfBatchTransport(input) {
    var options = input || {};
    var isEnabled = Boolean(options.enabled);
    var sink = parsePerfSinkValue(options.sink) || "file";
    var isFileSink = isEnabled && sink === "file";
    var endpoint = typeof options.endpoint === "string" ? options.endpoint : "/api/diag/perf";
    var batchSize = Number.isFinite(options.batchSize)
      ? Math.max(1, Math.floor(options.batchSize))
      : 5;
    var flushIntervalMs = Number.isFinite(options.flushIntervalMs)
      ? Math.max(1, Math.floor(options.flushIntervalMs))
      : 3000;
    var fetchImpl =
      typeof options.fetchImpl === "function"
        ? options.fetchImpl
        : typeof window !== "undefined" && typeof window.fetch === "function"
          ? window.fetch.bind(window)
          : null;
    var setIntervalImpl = options.setInterval || setInterval;
    var clearIntervalImpl = options.clearInterval || clearInterval;
    var logger = typeof options.logger === "function" ? options.logger : null;

    var transportEnabled = isFileSink && typeof fetchImpl === "function";
    var queue = [];
    var timer = null;
    var isSending = false;

    function start() {
      if (!transportEnabled || timer !== null) {
        return;
      }

      timer = setIntervalImpl(function () {
        flush();
      }, flushIntervalMs);
    }

    function stop() {
      if (timer === null) {
        return;
      }
      clearIntervalImpl(timer);
      timer = null;
    }

    function enqueue(summaryEvent) {
      if (!transportEnabled) {
        return;
      }

      if (summaryEvent == null) {
        return;
      }

      queue.push(summaryEvent);
      if (queue.length >= batchSize) {
        flush();
      } else {
        start();
      }
    }

    function flush() {
      if (!transportEnabled || isSending || queue.length === 0) {
        return;
      }

      var payload = queue.splice(0, batchSize);
      var didSend = false;
      isSending = true;
      var sendPromise;
      try {
        sendPromise = fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            source: "hud",
            sink: sink,
            events: payload,
          }),
        });
      } catch (error) {
        sendPromise = Promise.reject(error);
      }

      function requeueBatch(error) {
        queue = payload.concat(queue);
        logSummaryError(error);
      }

      Promise.resolve(sendPromise)
        .then(
          function (response) {
            if (!response || !response.ok) {
              var statusText = response && response.statusText ? " " + response.statusText : "";
              requeueBatch(
                new Error(
                  "Perf batch transport failed" +
                    " (status " +
                    (response && Number.isFinite(response.status) ? response.status : "unknown") +
                    statusText +
                    ")",
                ),
              );
              return;
            }
            didSend = true;
          },
          function (error) {
            requeueBatch(error);
          },
        )
        .finally(function () {
          isSending = false;
          if (!didSend || queue.length === 0) {
            return;
          }
          flush();
        });
    }

    function logSummaryError(error) {
      if (typeof logger === "function") {
        logger("perf", String(error && error.message ? error.message : error));
      }
    }

    return {
      start: start,
      stop: stop,
      enqueue: enqueue,
      flush: flush,
      isEnabled: function () {
        return transportEnabled;
      },
      isFileSink: function () {
        return isFileSink;
      },
      transportLogError: logSummaryError,
    };
  }

  function createPerfMonitor(options) {
    var opts = options || {};
    var enabled = Boolean(opts.enabled);
    var emitSummary = typeof opts.emitSummary === "function" ? opts.emitSummary : null;
    var transport = opts.transport || null;
    var summaryIntervalMs = Number.isFinite(opts.summaryIntervalMs)
      ? Math.max(0, Number(opts.summaryIntervalMs))
      : 30000;
    var schedule = opts.setInterval || setInterval;
    var cancel = opts.clearInterval || clearInterval;

    if (!enabled) {
      return createNoopPerfMonitor();
    }

    var summaryTimer = null;
    var metricsByEvent = new Map();

    var diagnosticLogger = opts.logger || ensureHudDiagLogger();

    function cloneMetric(metric) {
      return {
        count: metric.count,
        sum: metric.sum,
        min: metric.min,
        max: metric.max,
        last: metric.last,
      };
    }

    function publishSummary(summary) {
      if (summary == null) {
        return;
      }

      if (emitSummary) {
        emitSummary(summary);
      } else if (typeof diagnosticLogger === "function") {
        diagnosticLogger("[HUD-PERF]", "summary", summary);
      }
    }

    function flushSummary() {
      var result = {};
      metricsByEvent.forEach(function (fields, eventName) {
        var eventSummary = {};
        Object.keys(fields).forEach(function (fieldName) {
          var metric = fields[fieldName];
          eventSummary[fieldName] = cloneMetric(metric);
        });
        result[eventName] = eventSummary;
      });
      metricsByEvent = new Map();
      if (transport && typeof transport.enqueue === "function") {
        transport.enqueue({
          ts: new Date().toISOString(),
          summary: result,
        });
      }
      publishSummary(result);
      return result;
    }

    function normalizeName(record) {
      if (record && typeof record === "object" && typeof record.name === "string" && record.name.trim()) {
        return record.name.trim();
      }

      if (typeof record === "string" && record.trim()) {
        return record.trim();
      }

      return "default";
    }

    function updateMetric(metric, value) {
      if (!Number.isFinite(value)) {
        return;
      }

      if (metric.count === 0) {
        metric.min = value;
        metric.max = value;
      } else {
        if (value < metric.min) {
          metric.min = value;
        }
        if (value > metric.max) {
          metric.max = value;
        }
      }

      metric.count += 1;
      metric.sum += value;
      metric.last = value;
    }

    function makeNewMetric() {
      return {
        count: 0,
        sum: 0,
        min: 0,
        max: 0,
        last: 0,
      };
    }

    function ensureEventBucket(eventName) {
      if (!metricsByEvent.has(eventName)) {
        metricsByEvent.set(eventName, {});
      }

      return metricsByEvent.get(eventName);
    }

    function start() {
      if (summaryTimer !== null) {
        return;
      }

      if (summaryIntervalMs <= 0) {
        return;
      }

      summaryTimer = schedule(function () {
        flushSummary();
      }, summaryIntervalMs);
      if (transport && typeof transport.start === "function") {
        transport.start();
      }
    }

    function stop() {
      if (summaryTimer === null) {
        return;
      }
      cancel(summaryTimer);
      summaryTimer = null;
      if (transport && typeof transport.stop === "function") {
        transport.stop();
      }
    }

    function record(eventData) {
      if (eventData == null) {
        return;
      }

      var eventName = normalizeName(eventData);
      var bucket = ensureEventBucket(eventName);
      var fields = eventData;

      if (typeof eventData !== "object") {
        return;
      }

      Object.keys(fields).forEach(function (key) {
        if (key === "name") {
          return;
        }

        var value = fields[key];
        if (typeof value !== "number" || !Number.isFinite(value)) {
          return;
        }

        if (!bucket[key]) {
          bucket[key] = makeNewMetric();
        }
        updateMetric(bucket[key], value);
      });
    }

    return {
      record: record,
      start: start,
      stop: stop,
      flushSummary: flushSummary,
      isEnabled: function () {
        return true;
      },
    };
  }

  window.HUDApp.diagnostics = {
    ensureHudDiagLogger,
    resolvePerfDiagnosticsFlags,
    createPerfMonitor,
    createPerfBatchTransport,
  };
})();

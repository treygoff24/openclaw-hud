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

  function normalizePerfRunId(value) {
    if (value == null) {
      return null;
    }

    if (typeof value === "string") {
      var trimmed = value.trim();
      return trimmed ? trimmed : null;
    }

    if (typeof value === "number" && Number.isFinite(value) && !Number.isNaN(value)) {
      return String(Math.floor(value));
    }

    return String(value);
  }

  function normalizePerfRunIdFromSearch(locationSearch) {
    if (typeof locationSearch !== "string") return null;
    try {
      var params = new URLSearchParams(locationSearch);
      return normalizePerfRunId(params.get("hudPerfRunId"));
    } catch (_error) {
      return null;
    }
  }

  function resolvePerfRunIdFromStorage(storage) {
    if (!storage || typeof storage.getItem !== "function") return null;
    try {
      return normalizePerfRunId(storage.getItem("hudPerfRunId"));
    } catch (_error) {
      return null;
    }
  }

  function resolvePerfEventContext(input) {
    var options = input || {};
    var locationSearch =
      typeof options.locationSearch === "string"
        ? options.locationSearch
        : typeof options.search === "string"
          ? options.search
          : "";
    var storage =
      Object.prototype.hasOwnProperty.call(options, "localStorage")
        ? options.localStorage
        : typeof window !== "undefined"
          ? window.localStorage
          : null;

    var hydratedRunId = normalizePerfRunIdFromSearch(locationSearch);
    if (hydratedRunId == null) {
      hydratedRunId = resolvePerfRunIdFromStorage(storage);
    }

    window.HUDApp = window.HUDApp || {};

    if (!window.HUDApp.perfEventContext || typeof window.HUDApp.perfEventContext.setRunId !== "function") {
      window.HUDApp.perfEventContext = {
        runId: null,
        setRunId: function (runId) {
          this.runId = normalizePerfRunId(runId);
        },
        getRunId: function () {
          return this.runId;
        },
      };
    }

    if (hydratedRunId != null) {
      window.HUDApp.perfEventContext.setRunId(hydratedRunId);
    }

    return window.HUDApp.perfEventContext;
  }

  function resolvePerfRunId() {
    var context = resolvePerfEventContext();
    return context && typeof context.getRunId === "function" ? context.getRunId() : null;
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

  function createLongTaskTelemetryHook(input) {
    var options = input || {};
    var isEnabled = Boolean(options.enabled);
    var monitor = options.monitor || null;
    var observerFactory = options.performanceObserver || (typeof window !== "undefined" && window.PerformanceObserver);
    var eventName = typeof options.eventName === "string" && options.eventName.trim()
      ? options.eventName.trim()
      : "longtask";
    var logger =
      typeof options.logger === "function"
        ? options.logger
        : function () {};
    var longTaskObserver = null;
    var isStarted = false;

    function isMonitorUsable() {
      return isEnabled && monitor && typeof monitor.record === "function";
    }

    function safeRecord(entry) {
      if (!entry || !isMonitorUsable()) {
        return;
      }

      var durationMs = Number(entry.duration);
      if (!Number.isFinite(durationMs)) {
        return;
      }

      var sample = {
        name: eventName,
        durationMs: durationMs,
      };

      var startTimeMs = Number(entry.startTime);
      if (Number.isFinite(startTimeMs)) {
        sample.startTime = startTimeMs;
      }

      var attribution = entry.attribution;
      if (Array.isArray(attribution)) {
        sample.attributionCount = attribution.length;
      }

      try {
        monitor.record(sample);
      } catch (_error) {
        // Perf data capture must never break runtime behavior.
      }
    }

    function onLongTask(list) {
      var entries = list && typeof list.getEntries === "function" ? list.getEntries() : [];
      if (!Array.isArray(entries) || entries.length === 0) {
        return;
      }

      for (var i = 0; i < entries.length; i += 1) {
        safeRecord(entries[i]);
      }
    }

    function logHookError(hookEvent, error) {
      var details =
        error && typeof error === "object" && error.message
          ? { message: String(error.message) }
          : { message: String(error) };
      logger(hookEvent, details);
    }

    function start() {
      if (!isEnabled || longTaskObserver) {
        return;
      }
      if (!isMonitorUsable()) {
        return;
      }

      if (typeof observerFactory !== "function") {
        return;
      }

      try {
        longTaskObserver = new observerFactory(onLongTask);
        longTaskObserver.observe({ type: "longtask", buffered: true });
        isStarted = true;
      } catch (error) {
        longTaskObserver = null;
        isStarted = false;
        logHookError("long-task-observer-failed", error);
      }
    }

    function stop() {
      if (!longTaskObserver) {
        isStarted = false;
        return;
      }

      try {
        if (typeof longTaskObserver.disconnect === "function") {
          longTaskObserver.disconnect();
        }
      } catch (_error) {
        // Ignore cleanup issues.
      }

      longTaskObserver = null;
      isStarted = false;
    }

    return {
      start: start,
      stop: stop,
      isEnabled: function () {
        return isEnabled;
      },
      isStarted: function () {
        return isStarted;
      },
      isUsingObserver: function () {
        return longTaskObserver !== null;
      },
    };
  }

  function createLongAnimationFrameTelemetryHook(input) {
    var options = input || {};
    var isEnabled = Boolean(options.enabled);
    var monitor = options.monitor || null;
    var observerFactory =
      options.performanceObserver || (typeof window !== "undefined" && window.PerformanceObserver);
    var eventName = typeof options.eventName === "string" && options.eventName.trim()
      ? options.eventName.trim()
      : "long-animation-frame";
    var logger =
      typeof options.logger === "function"
        ? options.logger
        : function () {};
    var longAnimationFrameObserver = null;
    var isStarted = false;

    function isMonitorUsable() {
      return isEnabled && monitor && typeof monitor.record === "function";
    }

    function safeRecord(entry) {
      if (!entry || !isMonitorUsable()) {
        return;
      }

      var durationMs = Number(entry.duration);
      if (!Number.isFinite(durationMs)) {
        return;
      }

      var sample = {
        name: eventName,
        durationMs: durationMs,
      };

      var startTimeMs = Number(entry.startTime);
      if (Number.isFinite(startTimeMs)) {
        sample.startTime = startTimeMs;
      }

      var frameName = entry && entry.name;
      if (typeof frameName === "string" && frameName.trim()) {
        sample.frameName = frameName.trim();
      }

      var frameRate = Number(entry.frameRate);
      if (Number.isFinite(frameRate)) {
        sample.frameRate = frameRate;
      }

      try {
        monitor.record(sample);
      } catch (_error) {
        // Perf data capture must never break runtime behavior.
      }
    }

    function onLongAnimationFrame(list) {
      var entries = list && typeof list.getEntries === "function" ? list.getEntries() : [];
      if (!Array.isArray(entries) || entries.length === 0) {
        return;
      }

      for (var i = 0; i < entries.length; i += 1) {
        safeRecord(entries[i]);
      }
    }

    function logHookError(hookEvent, error) {
      var details =
        error && typeof error === "object" && error.message
          ? { message: String(error.message) }
          : { message: String(error) };
      logger(hookEvent, details);
    }

    function start() {
      if (!isEnabled || longAnimationFrameObserver) {
        return;
      }
      if (!isMonitorUsable()) {
        return;
      }

      if (typeof observerFactory !== "function") {
        return;
      }

      try {
        longAnimationFrameObserver = new observerFactory(onLongAnimationFrame);
        longAnimationFrameObserver.observe({ type: "long-animation-frame", buffered: true });
        isStarted = true;
      } catch (error) {
        longAnimationFrameObserver = null;
        isStarted = false;
        logHookError("long-animation-frame-observer-failed", error);
      }
    }

    function stop() {
      if (!longAnimationFrameObserver) {
        isStarted = false;
        return;
      }

      try {
        if (typeof longAnimationFrameObserver.disconnect === "function") {
          longAnimationFrameObserver.disconnect();
        }
      } catch (_error) {
        // Ignore cleanup issues.
      }

      longAnimationFrameObserver = null;
      isStarted = false;
    }

    return {
      start: start,
      stop: stop,
      isEnabled: function () {
        return isEnabled;
      },
      isStarted: function () {
        return isStarted;
      },
      isUsingObserver: function () {
        return longAnimationFrameObserver !== null;
      },
    };
  }

  function createFrameBudgetTelemetryHook(input) {
    var options = input || {};
    var isEnabled = Boolean(options.enabled);
    var monitor = options.monitor || null;
    var raf = options.requestAnimationFrame || (typeof window !== "undefined" && window.requestAnimationFrame);
    var cancelRaf = options.cancelAnimationFrame || (typeof window !== "undefined" && window.cancelAnimationFrame);
    var logger =
      typeof options.logger === "function"
        ? options.logger
        : function () {};
    var isStarted = false;
    var rafHandle = null;
    var lastTimestamp = null;

    function isMonitorUsable() {
      return isEnabled && monitor && typeof monitor.record === "function";
    }

    function safeRecord(deltaMs) {
      if (!Number.isFinite(deltaMs) || deltaMs < 0 || !isMonitorUsable()) {
        return;
      }

      try {
        monitor.record({
          name: "frameBudget",
          deltaMs: deltaMs,
          over16ms: deltaMs > 16.6667 ? 1 : 0,
          over33ms: deltaMs > 33.3333 ? 1 : 0,
        });
      } catch (_error) {
        // Perf data capture must never break runtime behavior.
      }
    }

    function onFrame(timestamp) {
      if (!isStarted || !isMonitorUsable()) {
        return;
      }

      if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
        if (typeof lastTimestamp === "number") {
          safeRecord(timestamp - lastTimestamp);
        }
        lastTimestamp = timestamp;
      }

      rafHandle = typeof raf === "function" ? raf(onFrame) : null;
    }

    function logHookError(hookEvent, error) {
      var details =
        error && typeof error === "object" && error.message
          ? { message: String(error.message) }
          : { message: String(error) };
      logger(hookEvent, details);
    }

    function start() {
      if (!isEnabled || isStarted) {
        return;
      }
      if (!isMonitorUsable()) {
        return;
      }
      if (typeof raf !== "function") {
        return;
      }

      isStarted = true;
      lastTimestamp = null;
      try {
        rafHandle = raf(onFrame);
      } catch (error) {
        isStarted = false;
        rafHandle = null;
        logHookError("frame-budget-start-failed", error);
      }
    }

    function stop() {
      if (!isStarted) {
        return;
      }

      isStarted = false;
      try {
        if (typeof cancelRaf === "function" && rafHandle != null) {
          cancelRaf(rafHandle);
        }
      } catch (_error) {
        // Ignore cleanup issues.
      }
      rafHandle = null;
      lastTimestamp = null;
    }

    return {
      start: start,
      stop: stop,
      isEnabled: function () {
        return isEnabled;
      },
      isStarted: function () {
        return isStarted;
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
    var queryParams = locationSearch ? new URLSearchParams(locationSearch) : null;
    var querySink = parsePerfSinkValue(queryParams ? queryParams.get("hudPerfSink") : null);
    var hasQuerySink = querySink != null;
    var longTaskFlag = parseBooleanFlagValue(queryParams ? queryParams.get("hudPerfLongTasks") : null);
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

    var queryValue = parseBooleanFlagValue(queryParams ? queryParams.get("hudPerf") : null);
    var sinkMode = hasQuerySink ? querySink : "console";
    var resolvedEnabled = false;
    var storageValue = parseBooleanFlagValue(localStorageValue);

    if (queryValue !== null) {
      resolvedEnabled = queryValue;
    } else if (storageUnavailable) {
      resolvedEnabled = false;
    } else if (storageValue !== null) {
      resolvedEnabled = storageValue;
    } else if (typeof options.globalConfig === "boolean") {
      resolvedEnabled = options.globalConfig;
    } else if (typeof options.globalConfig === "string" || typeof options.globalConfig === "number") {
      var fallback = parseBooleanFlagValue(options.globalConfig);
      if (fallback !== null) {
        resolvedEnabled = fallback;
      }
    }

    var flags = {
      enabled: resolvedEnabled,
      longTask: longTaskFlag === true,
    };
    if (resolvedEnabled || hasQuerySink) {
      flags.sink = sinkMode;
    }
    return flags;
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
        var summaryPayload = {
          ts: new Date().toISOString(),
          summary: result,
        };
        var runId = resolvePerfRunId();
        if (runId != null) {
          summaryPayload.runId = runId;
        }

        transport.enqueue(summaryPayload);
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
      var runId = resolvePerfRunId();

      if (
        runId != null &&
        fields &&
        typeof fields === "object" &&
        !Array.isArray(fields) &&
        fields.runId == null
      ) {
        fields.runId = runId;
      }

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
    createLongTaskTelemetryHook,
    createLongAnimationFrameTelemetryHook,
    createFrameBudgetTelemetryHook,
    resolvePerfEventContext,
    resolvePerfDiagnosticsFlags,
    createPerfMonitor,
    createPerfBatchTransport,
  };
})();

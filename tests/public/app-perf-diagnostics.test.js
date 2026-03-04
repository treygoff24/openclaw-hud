// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

function installLocalStorageMock() {
  const store = {};
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn((key) =>
        Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
      ),
      setItem: vi.fn((key, value) => {
        store[key] = String(value);
      }),
      removeItem: vi.fn((key) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        Object.keys(store).forEach((key) => delete store[key]);
      }),
    },
  });
}

async function loadAppDiagnosticsModule() {
  delete window.HUDApp;
  delete window.__hudDiagLog;
  delete window.__HUD_DIAG__;
  await import("../../public/app/diagnostics.js");
  return window.HUDApp.diagnostics;
}

function createBootstrapHarness(options = {}) {
  const hudFetchAll = options.hudFetchAll || vi.fn(() => Promise.resolve());
  const pollingStart = options.pollingStart || vi.fn();
  const wsConnect = options.wsConnect || vi.fn();
  const perfStart = options.perfStart || vi.fn();

  const diagnostics = options.diagnostics || {
    ensureHudDiagLogger: vi.fn(() => vi.fn()),
    resolvePerfDiagnosticsFlags: vi.fn(() => ({ enabled: false })),
    createPerfMonitor: vi.fn(() => ({
      start: perfStart,
      stop: vi.fn(),
      record: vi.fn(),
    })),
  };

  const statusController = {
    start: vi.fn(),
    setConnectionStatus: vi.fn(),
    setGatewayUptimeSnapshot: vi.fn(),
  };
  const uiController = {
    bindDelegationHandlers: vi.fn(),
    showToast: vi.fn(),
    renderPanelSafe: vi.fn(),
    setRetryHandler: vi.fn(),
  };
  const dataController = { fetchAll: hudFetchAll };
  const pollingController = { start: pollingStart, stop: vi.fn() };
  const wsController = { connect: wsConnect };

  window.HUDApp = {
    diagnostics,
    status: { createStatusController: vi.fn(() => statusController) },
    ui: { createUiController: vi.fn(() => uiController) },
    data: { createDataController: vi.fn(() => dataController) },
    polling: { createPollingController: vi.fn(() => pollingController) },
    ws: { createWsController: vi.fn(() => wsController) },
  };

  const HUD = {
    utils: { wsUrl: vi.fn(() => "ws://hud.test/ws") },
    agents: { init: vi.fn() },
    cron: { init: vi.fn() },
    spawn: { init: vi.fn() },
  };

  return {
    HUD,
    diagnostics,
    hudFetchAll,
    pollingStart,
    wsConnect,
    perfStart,
  };
}

function createMockJsonResponse(payload, overrides = {}) {
  return {
    ok: overrides.ok ?? true,
    status: overrides.status ?? 200,
    statusText: overrides.statusText ?? "OK",
    headers: {
      get: () => overrides.requestId ?? "",
    },
    json: () => Promise.resolve(payload),
  };
}

function createDataControllerPerfHarness(options = {}) {
  const doc = document.implementation.createHTMLDocument("hud-perf-data-controller");
  doc.body.innerHTML = `
    <div id="agents-list"></div>
    <div id="sessions-list"></div>
    <div id="cron-list"></div>
    <div id="system-info"></div>
    <div id="model-usage"></div>
    <div id="activity-feed"></div>
    <div id="tree-body"></div>
  `;

  const HUD = {
    agents: { render: vi.fn() },
    sessions: { render: vi.fn() },
    cron: { render: vi.fn() },
    system: { render: vi.fn() },
    models: { render: vi.fn() },
    activity: { render: vi.fn() },
    sessionTree: { render: vi.fn() },
  };

  const controller = window.HUDApp.data.createDataController({
    document: doc,
    HUD,
    getFetch: () => options.fetchImpl,
    renderPanelSafe: vi.fn((panelName, panelEl, renderFn, data) => {
      renderFn(panelEl, data);
    }),
    setConnectionStatus: options.setConnectionStatus || vi.fn(),
    onChatRestore: options.onChatRestore || vi.fn(),
    endpointTimeoutMs: options.endpointTimeoutMs ?? 200,
  });

  return { controller, HUD };
}

describe("HUD perf diagnostics flags", () => {
  beforeEach(async () => {
    vi.resetModules();
    installLocalStorageMock();
    const diagnostics = await loadAppDiagnosticsModule();
    expect(typeof diagnostics.ensureHudDiagLogger).toBe("function");
  });

  it("keeps perf monitoring disabled by default", () => {
    const diagnostics = window.HUDApp.diagnostics;
    expect(typeof diagnostics.resolvePerfDiagnosticsFlags).toBe("function");

    const flags = diagnostics.resolvePerfDiagnosticsFlags({
      search: "",
      localStorageValue: null,
    });
    expect(flags.enabled).toBe(false);
  });

  it("enables perf monitoring via ?hudPerf=1 and localStorage.hudPerf='1'", () => {
    const diagnostics = window.HUDApp.diagnostics;
    expect(typeof diagnostics.resolvePerfDiagnosticsFlags).toBe("function");

    let flags = diagnostics.resolvePerfDiagnosticsFlags({
      search: "?hudPerf=1",
      localStorageValue: null,
    });
    expect(flags.enabled).toBe(true);

    flags = diagnostics.resolvePerfDiagnosticsFlags({
      search: "",
      localStorageValue: "1",
    });
    expect(flags.enabled).toBe(true);
  });

  it("treats ?hudPerf=0 as an explicit override over enable sources", () => {
    const diagnostics = window.HUDApp.diagnostics;
    expect(typeof diagnostics.resolvePerfDiagnosticsFlags).toBe("function");

    const flags = diagnostics.resolvePerfDiagnosticsFlags({
      search: "?hudPerf=0",
      localStorageValue: "1",
    });
    expect(flags.enabled).toBe(false);
  });

  it("does not throw when localStorage.getItem raises SecurityError", () => {
    const diagnostics = window.HUDApp.diagnostics;
    expect(typeof diagnostics.resolvePerfDiagnosticsFlags).toBe("function");

    const securityError = new DOMException("Blocked by browser policy", "SecurityError");
    let flags;

    expect(() => {
      flags = diagnostics.resolvePerfDiagnosticsFlags({
        search: "",
        localStorage: {
          getItem: () => {
            throw securityError;
          },
        },
      });
    }).not.toThrow();

    expect(flags).toEqual({ enabled: false, longTask: false });
  });

  it("parses URLSearchParams once while resolving perf flags", () => {
    const diagnostics = window.HUDApp.diagnostics;
    const OriginalURLSearchParams = globalThis.URLSearchParams;
    let parseCount = 0;

    globalThis.URLSearchParams = function URLSearchParamsProxy(search) {
      parseCount += 1;
      return new OriginalURLSearchParams(search);
    };
    globalThis.URLSearchParams.prototype = OriginalURLSearchParams.prototype;

    try {
      const flags = diagnostics.resolvePerfDiagnosticsFlags({
        search: "?hudPerf=1&hudPerfSink=file&hudPerfLongTasks=1",
        localStorageValue: null,
      });

      expect(flags).toEqual({
        enabled: true,
        sink: "file",
        longTask: true,
      });
      expect(parseCount).toBe(1);
    } finally {
      globalThis.URLSearchParams = OriginalURLSearchParams;
    }
  });

  it("hydrates perfEventContext from hudPerfRunId query parameter", () => {
    const diagnostics = window.HUDApp.diagnostics;
    expect(typeof diagnostics.resolvePerfEventContext).toBe("function");

    const context = diagnostics.resolvePerfEventContext({
      locationSearch: "?hudPerfRunId=query-run-123",
      localStorage: null,
    });
    expect(context.getRunId()).toBe("query-run-123");
  });

  it("falls back to localStorage hudPerfRunId when query parameter is absent", async () => {
    const diagnostics = window.HUDApp.diagnostics;
    expect(typeof diagnostics.resolvePerfEventContext).toBe("function");

    window.localStorage.setItem("hudPerfRunId", "storage-run-789");

    const context = diagnostics.resolvePerfEventContext({
      locationSearch: "?hudPerf=1",
      localStorage: window.localStorage,
    });
    expect(context.getRunId()).toBe("storage-run-789");
  });
});

describe("HUD perf monitor cadence", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    installLocalStorageMock();
    await loadAppDiagnosticsModule();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("supports deterministic summary cadence overrides for tests", () => {
    const diagnostics = window.HUDApp.diagnostics;
    expect(typeof diagnostics.createPerfMonitor).toBe("function");

    const summarySpy = vi.fn();
    const monitor = diagnostics.createPerfMonitor({
      enabled: true,
      summaryIntervalMs: 250,
      emitSummary: summarySpy,
    });

    expect(monitor).toBeTruthy();
    expect(typeof monitor.start).toBe("function");
    expect(typeof monitor.stop).toBe("function");
    expect(typeof monitor.record).toBe("function");

    monitor.start();
    monitor.record({ name: "fetchAll", durationMs: 12 });

    vi.advanceTimersByTime(249);
    expect(summarySpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(summarySpy).toHaveBeenCalledTimes(1);

    monitor.stop();
  });

  it("emits one summary event per interval even when emitSummary and logger share a sink", () => {
    const diagnostics = window.HUDApp.diagnostics;
    expect(typeof diagnostics.createPerfMonitor).toBe("function");

    const logSink = vi.fn();
    const monitor = diagnostics.createPerfMonitor({
      enabled: true,
      summaryIntervalMs: 250,
      logger: logSink,
      emitSummary: function (summary) {
        logSink("[HUD-PERF]", "summary", summary);
      },
    });

    monitor.start();
    monitor.record({ name: "fetchAll", durationMs: 9 });
    vi.advanceTimersByTime(250);

    expect(logSink).toHaveBeenCalledTimes(1);
    monitor.stop();
  });

  it("records numeric telemetry fields and ignores non-numeric fields", () => {
    const diagnostics = window.HUDApp.diagnostics;
    expect(typeof diagnostics.createPerfMonitor).toBe("function");

    const summarySpy = vi.fn();
    const monitor = diagnostics.createPerfMonitor({
      enabled: true,
      summaryIntervalMs: 500,
      emitSummary: summarySpy,
    });
    monitor.record({ name: "longTaskProbe", durationMs: 8.25, panelId: 4, label: "ignored" });
    monitor.record({ name: "longTaskProbe", status: 1, payload: "drop-me" });
    const summary = monitor.flushSummary();

    expect(summary).toMatchObject({
      longTaskProbe: {
        durationMs: {
          count: 1,
          sum: 8.25,
          min: 8.25,
          max: 8.25,
          last: 8.25,
        },
        panelId: {
          count: 1,
          sum: 4,
          min: 4,
          max: 4,
          last: 4,
        },
        status: {
          count: 1,
          sum: 1,
          min: 1,
          max: 1,
          last: 1,
        },
      },
    });
    expect(summary.longTaskProbe.label).toBeUndefined();
  });

  it("injects client runId context into monitor payloads before recording", async () => {
    const diagnostics = window.HUDApp.diagnostics;
    expect(typeof diagnostics.createPerfMonitor).toBe("function");

    window.HUDApp = window.HUDApp || {};
    window.HUDApp.perfEventContext = {
      runId: null,
      setRunId: function (runId) {
        this.runId = runId == null ? null : String(runId);
      },
      getRunId: function () {
        return this.runId;
      },
    };

    const monitor = diagnostics.createPerfMonitor({
      enabled: true,
    });
    const event = {
      name: "testRunId",
      durationMs: 12,
    };

    window.HUDApp.perfEventContext.setRunId("run-1");
    monitor.record(event);

    expect(event).toMatchObject({
      name: "testRunId",
      durationMs: 12,
      runId: "run-1",
    });
  });

  it("includes runId in perf transport summary payloads", async () => {
    const diagnostics = window.HUDApp.diagnostics;
    expect(typeof diagnostics.createPerfMonitor).toBe("function");
    expect(typeof diagnostics.createPerfBatchTransport).toBe("function");

    const transport = {
      enqueue: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };

    window.HUDApp = window.HUDApp || {};
    window.HUDApp.perfEventContext = {
      runId: null,
      setRunId: function (runId) {
        this.runId = runId == null ? null : String(runId);
      },
      getRunId: function () {
        return this.runId;
      },
    };
    window.HUDApp.perfEventContext.setRunId("transport-run-321");

    const monitor = diagnostics.createPerfMonitor({
      enabled: true,
      transport,
    });

    monitor.record({ name: "fetchAll.finish", durationMs: 11 });
    monitor.flushSummary();

    expect(transport.enqueue).toHaveBeenCalledTimes(1);
    const payload = transport.enqueue.mock.calls[0][0];
    expect(payload).toMatchObject({
      runId: "transport-run-321",
      summary: {
        "fetchAll.finish": {
          durationMs: {
            count: 1,
            sum: 11,
          },
        },
      },
    });
    expect(typeof payload.ts).toBe("string");
  });
});

describe("HUD long-task telemetry hook", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    installLocalStorageMock();
    await loadAppDiagnosticsModule();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalPerformanceObserver !== undefined) {
      globalThis.PerformanceObserver = originalPerformanceObserver;
    } else {
      delete globalThis.PerformanceObserver;
    }
  });

  const originalPerformanceObserver = globalThis.PerformanceObserver;

  it("parses long-task flag from URL only and stays deterministic", () => {
    const diagnostics = window.HUDApp.diagnostics;
    expect(typeof diagnostics.resolvePerfDiagnosticsFlags).toBe("function");

    let flags = diagnostics.resolvePerfDiagnosticsFlags({
      search: "?hudPerf=1&hudPerfLongTasks=1",
      localStorageValue: null,
    });
    expect(flags.enabled).toBe(true);
    expect(flags.longTask).toBe(true);

    flags = diagnostics.resolvePerfDiagnosticsFlags({
      search: "?hudPerf=1&hudPerfLongTasks=0",
      localStorageValue: "1",
    });
    expect(flags.enabled).toBe(true);
    expect(flags.longTask).toBe(false);

    flags = diagnostics.resolvePerfDiagnosticsFlags({
      search: "?hudPerf=1",
      localStorageValue: "1",
    });
    expect(flags.enabled).toBe(true);
    expect(flags.longTask).toBe(false);
  });

  it("starts and stops long-task observer lifecycle safely on supported runtimes", () => {
    const diagnostics = window.HUDApp.diagnostics;
    const observe = vi.fn();
    const disconnect = vi.fn();
    let callback = null;

    const MockPerformanceObserver = vi.fn(function (cb) {
      callback = cb;
      return {
        observe,
        disconnect,
      };
    });

    const record = vi.fn();
    globalThis.PerformanceObserver = MockPerformanceObserver;
    const hook = diagnostics.createLongTaskTelemetryHook({
      enabled: true,
      monitor: {
        record,
      },
      performanceObserver: MockPerformanceObserver,
      logger: vi.fn(),
    });

    expect(hook.isStarted()).toBe(false);
    hook.start();
    expect(hook.isStarted()).toBe(true);
    expect(MockPerformanceObserver).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledWith({ type: "longtask", buffered: true });

    callback({ getEntries: () => [{ duration: 8.2, startTime: 123, attribution: [{}] }] });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toMatchObject({
      name: "longtask",
      durationMs: 8.2,
      startTime: 123,
      attributionCount: 1,
    });

    hook.stop();
    expect(hook.isStarted()).toBe(false);
    expect(disconnect).toHaveBeenCalledTimes(1);

    hook.stop();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("start() is a no-op when perf monitor is not usable", () => {
    const diagnostics = window.HUDApp.diagnostics;
    const observe = vi.fn();
    const MockPerformanceObserver = vi.fn(function () {
      return {
        observe,
        disconnect: vi.fn(),
      };
    });

    const hookWithoutMonitor = diagnostics.createLongTaskTelemetryHook({
      enabled: true,
      monitor: null,
      performanceObserver: MockPerformanceObserver,
      logger: vi.fn(),
    });
    hookWithoutMonitor.start();
    expect(MockPerformanceObserver).not.toHaveBeenCalled();
    expect(hookWithoutMonitor.isStarted()).toBe(false);

    const hookWithoutRecord = diagnostics.createLongTaskTelemetryHook({
      enabled: true,
      monitor: {},
      performanceObserver: MockPerformanceObserver,
      logger: vi.fn(),
    });
    hookWithoutRecord.start();
    expect(MockPerformanceObserver).not.toHaveBeenCalled();
    expect(hookWithoutRecord.isStarted()).toBe(false);
  });

  it("is a no-op when long-task observer is unavailable", () => {
    const diagnostics = window.HUDApp.diagnostics;
    const record = vi.fn();

    delete globalThis.PerformanceObserver;
    const hook = diagnostics.createLongTaskTelemetryHook({
      enabled: true,
      monitor: {
        record,
      },
      logger: vi.fn(),
    });

    expect(() => {
      hook.start();
      hook.stop();
    }).not.toThrow();
    expect(record).not.toHaveBeenCalled();
    expect(hook.isUsingObserver()).toBe(false);
  });

  it("supports long-animation-frame telemetry with browser fallback", () => {
    const diagnostics = window.HUDApp.diagnostics;
    const observe = vi.fn();
    const disconnect = vi.fn();

    const MockPerformanceObserver = vi.fn(function (cb) {
      return {
        observe,
        disconnect,
        callback: cb,
      };
    });
    globalThis.PerformanceObserver = MockPerformanceObserver;

    const record = vi.fn();
    const hook = diagnostics.createLongAnimationFrameTelemetryHook({
      enabled: true,
      monitor: {
        record,
      },
      performanceObserver: MockPerformanceObserver,
      logger: vi.fn(),
      eventName: "long-animation-frame",
    });

    hook.start();
    expect(hook.isStarted()).toBe(true);
    expect(observe).toHaveBeenCalledWith({ type: "long-animation-frame", buffered: true });

    const entry = {
      duration: 50,
      startTime: 120,
      name: "raf",
      frameRate: 48,
      attribution: [{ culprit: "script" }, { culprit: "gc" }],
    };
    MockPerformanceObserver.mock.results[0].value.callback({ getEntries: () => [entry] });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toMatchObject({
      name: "long-animation-frame",
      durationMs: 50,
      startTime: 120,
      frameName: "raf",
      frameRate: 48,
    });

    hook.stop();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(hook.isStarted()).toBe(false);
  });

  it("captures frame budget deltas and counters from requestAnimationFrame loop", () => {
    const diagnostics = window.HUDApp.diagnostics;
    const frames = [1000, 1018, 1080];
    let frameIndex = 0;
    const raf = vi.fn(function (fn) {
      const next = frames[frameIndex++];
      if (typeof next === "number") {
        fn(next);
      }
      return frameIndex;
    });
    const cancel = vi.fn();

    const record = vi.fn();
    const hook = diagnostics.createFrameBudgetTelemetryHook({
      enabled: true,
      monitor: {
        record,
      },
      requestAnimationFrame: raf,
      cancelAnimationFrame: cancel,
    });

    hook.start();
    expect(hook.isStarted()).toBe(true);
    expect(raf).toHaveBeenCalledTimes(4);
    expect(cancel).not.toHaveBeenCalled();

    const frameEvents = record.mock.calls
      .map(([entry]) => entry)
      .filter((entry) => entry && entry.name === "frameBudget");
    expect(frameEvents.length).toBe(2);
    expect(frameEvents[0]).toMatchObject({
      deltaMs: 18,
      over16ms: 1,
      over33ms: 0,
    });
    expect(frameEvents[1].deltaMs).toBeGreaterThan(33.3);
    expect(frameEvents[1].over16ms).toBe(1);
    expect(frameEvents[1].over33ms).toBe(1);

    hook.stop();
  });

  it("does not start frame-budget telemetry when requestAnimationFrame is unavailable", () => {
    const originalRaf = globalThis.requestAnimationFrame;
    const diagnostics = window.HUDApp.diagnostics;
    const record = vi.fn();
    globalThis.requestAnimationFrame = undefined;
    const hook = diagnostics.createFrameBudgetTelemetryHook({
      enabled: true,
      monitor: {
        record,
      },
      requestAnimationFrame: undefined,
      cancelAnimationFrame: undefined,
    });

    hook.start();
    expect(hook.isStarted()).toBe(false);
    expect(record).not.toHaveBeenCalled();

    globalThis.requestAnimationFrame = originalRaf;
  });
});

describe("app bootstrap with perf monitor disabled", () => {
  beforeEach(() => {
    vi.resetModules();
    installLocalStorageMock();
  });

  it("keeps startup stable while wiring disabled perf monitor", async () => {
    const { HUD, diagnostics, perfStart, hudFetchAll, pollingStart, wsConnect } =
      createBootstrapHarness();

    await import("../../public/app/bootstrap.js");

    expect(() => window.HUDApp.bootstrap.initApp({ document, HUD })).not.toThrow();
    expect(diagnostics.resolvePerfDiagnosticsFlags).toHaveBeenCalledTimes(1);
    expect(diagnostics.createPerfMonitor).toHaveBeenCalledTimes(1);
    expect(perfStart).not.toHaveBeenCalled();
    expect(hudFetchAll).toHaveBeenCalledTimes(1);
    expect(pollingStart).toHaveBeenCalledTimes(1);
    expect(wsConnect).toHaveBeenCalledTimes(1);
  });

  it("starts the perf monitor once when perf diagnostics are enabled", async () => {
    const perfStart = vi.fn();
    const diagnostics = {
      ensureHudDiagLogger: vi.fn(() => vi.fn()),
      resolvePerfDiagnosticsFlags: vi.fn(() => ({ enabled: true })),
      createPerfMonitor: vi.fn(() => ({
        start: perfStart,
        stop: vi.fn(),
        record: vi.fn(),
        isEnabled: () => true,
      })),
    };
    const { HUD } = createBootstrapHarness({ diagnostics, perfStart });

    await import("../../public/app/bootstrap.js");

    expect(() => window.HUDApp.bootstrap.initApp({ document, HUD })).not.toThrow();
    expect(perfStart).toHaveBeenCalledTimes(1);
  });

  it("stops an existing perf monitor before replacing it on re-init", async () => {
    const previousStop = vi.fn();
    const perfStart = vi.fn();
    const diagnostics = {
      ensureHudDiagLogger: vi.fn(() => vi.fn()),
      resolvePerfDiagnosticsFlags: vi.fn(() => ({ enabled: true })),
      createPerfMonitor: vi.fn(() => ({
        start: perfStart,
        stop: vi.fn(),
        record: vi.fn(),
        isEnabled: () => true,
      })),
    };
    const { HUD } = createBootstrapHarness({ diagnostics, perfStart });
    window.HUDApp.perfMonitor = { stop: previousStop };

    await import("../../public/app/bootstrap.js");

    expect(() => window.HUDApp.bootstrap.initApp({ document, HUD })).not.toThrow();
    expect(previousStop).toHaveBeenCalledTimes(1);
    expect(perfStart).toHaveBeenCalledTimes(1);
    expect(previousStop.mock.invocationCallOrder[0]).toBeLessThan(
      perfStart.mock.invocationCallOrder[0],
    );
  });

  it("does not crash bootstrap when window.localStorage accessor throws SecurityError", async () => {
    const securityError = new DOMException("Blocked by browser policy", "SecurityError");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => {
        throw securityError;
      },
    });

    const diagnostics = {
      ensureHudDiagLogger: vi.fn(() => vi.fn()),
      resolvePerfDiagnosticsFlags: vi.fn(() => ({ enabled: false })),
      createPerfMonitor: vi.fn(() => ({
        start: vi.fn(),
        stop: vi.fn(),
        record: vi.fn(),
      })),
    };
    const { HUD } = createBootstrapHarness({ diagnostics });

    await import("../../public/app/bootstrap.js");

    expect(() => window.HUDApp.bootstrap.initApp({ document, HUD })).not.toThrow();
    expect(diagnostics.resolvePerfDiagnosticsFlags).toHaveBeenCalledTimes(1);
  });

  it("wires a callable logger into perf batch transport options", async () => {
    const diagLog = vi.fn();
    const createPerfBatchTransport = vi.fn(() => ({
      start: vi.fn(),
      stop: vi.fn(),
      enqueue: vi.fn(),
      flush: vi.fn(),
      isEnabled: () => true,
      isFileSink: () => true,
      transportLogError: vi.fn(),
    }));
    const diagnostics = {
      ensureHudDiagLogger: vi.fn(() => diagLog),
      resolvePerfDiagnosticsFlags: vi.fn(() => ({ enabled: true, sink: "file" })),
      createPerfBatchTransport,
      createPerfMonitor: vi.fn(() => ({
        start: vi.fn(),
        stop: vi.fn(),
        record: vi.fn(),
        isEnabled: () => true,
      })),
    };
    const { HUD } = createBootstrapHarness({ diagnostics });

    await import("../../public/app/bootstrap.js");
    window.HUDApp.bootstrap.initApp({ document, HUD });

    expect(createPerfBatchTransport).toHaveBeenCalledTimes(1);
    const [transportOptions] = createPerfBatchTransport.mock.calls[0];
    expect(typeof transportOptions.logger).toBe("function");

    expect(() => transportOptions.logger("perf", "transport failed")).not.toThrow();
    expect(diagLog).toHaveBeenCalled();
  });

  it("normalizes long-task logger adapter contract to event + fields object", async () => {
    const diagLog = vi.fn();
    let capturedLongTaskLogger = null;
    const diagnostics = {
      ensureHudDiagLogger: vi.fn(() => diagLog),
      resolvePerfDiagnosticsFlags: vi.fn(() => ({ enabled: true, longTask: true })),
      createPerfBatchTransport: vi.fn(() => ({
        start: vi.fn(),
        stop: vi.fn(),
        enqueue: vi.fn(),
        flush: vi.fn(),
        isEnabled: () => true,
        isFileSink: () => true,
        transportLogError: vi.fn(),
      })),
      createPerfMonitor: vi.fn(() => ({
        start: vi.fn(),
        stop: vi.fn(),
        record: vi.fn(),
        isEnabled: () => true,
      })),
      createLongTaskTelemetryHook: vi.fn((input) => {
        capturedLongTaskLogger = input.logger;
        return {
          start: vi.fn(),
          stop: vi.fn(),
          isEnabled: () => true,
        };
      }),
    };
    const { HUD } = createBootstrapHarness({ diagnostics });

    await import("../../public/app/bootstrap.js");
    window.HUDApp.bootstrap.initApp({ document, HUD });

    expect(typeof capturedLongTaskLogger).toBe("function");
    capturedLongTaskLogger("long-task-observer-failed", { message: "observer rejected" });
    expect(diagLog).toHaveBeenCalledWith("[HUD-PERF]", "long-task-observer-failed", {
      message: "observer rejected",
    });
  });
});

describe("disabled perf mode fast paths", () => {
  const originalTextEncoder = globalThis.TextEncoder;
  const originalRaf = globalThis.requestAnimationFrame;

  beforeEach(() => {
    vi.resetModules();
    delete window._hudWs;
    delete window.HUDApp;
  });

  afterEach(() => {
    if (originalTextEncoder === undefined) {
      delete globalThis.TextEncoder;
    } else {
      globalThis.TextEncoder = originalTextEncoder;
    }

    if (originalRaf === undefined) {
      delete globalThis.requestAnimationFrame;
    } else {
      globalThis.requestAnimationFrame = originalRaf;
    }
  });

  it("ws onmessage avoids TextEncoder byte work when perf monitor is disabled", async () => {
    const encodeSpy = vi.fn(() => new Uint8Array([1, 2, 3]));
    const TextEncoderMock = vi.fn(function () {
      this.encode = encodeSpy;
    });
    globalThis.TextEncoder = TextEncoderMock;

    const ws = {
      readyState: window.WebSocket ? window.WebSocket.CONNECTING : 0,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send: vi.fn(),
      close: vi.fn(),
    };
    const WebSocketMock = vi.fn(function MockWebSocket() {
      return ws;
    });
    WebSocketMock.OPEN = 1;
    WebSocketMock.CONNECTING = 0;
    window.WebSocket = WebSocketMock;

    const fetchAll = vi.fn();
    window.HUDApp = {
      perfMonitor: {
        isEnabled: () => false,
        record: vi.fn(),
      },
    };

    await import("../../public/app/ws.js");

    const wsController = window.HUDApp.ws.createWsController({
      diagLog: vi.fn(),
      wsLogPrefix: "[HUD-WS]",
      fetchAll,
      setConnectionStatus: vi.fn(),
      setGatewayUptimeSnapshot: vi.fn(),
      startPolling: vi.fn(),
      stopPolling: vi.fn(),
      wsUrlFactory: () => "ws://hud.test/ws",
    });
    wsController.connect();

    expect(typeof ws.onmessage).toBe("function");
    ws.onmessage({ data: JSON.stringify({ type: "tick" }) });

    expect(fetchAll).toHaveBeenCalledWith(expect.objectContaining({ includeCold: false }));
    expect(encodeSpy).not.toHaveBeenCalled();
  });

  it("ws onmessage avoids perf timing clock work when perf monitor is disabled", async () => {
    const now = vi.fn(() => 1234);
    const ws = {
      readyState: window.WebSocket ? window.WebSocket.CONNECTING : 0,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send: vi.fn(),
      close: vi.fn(),
    };
    const WebSocketMock = vi.fn(function MockWebSocket() {
      return ws;
    });
    WebSocketMock.OPEN = 1;
    WebSocketMock.CONNECTING = 0;
    window.WebSocket = WebSocketMock;

    const fetchAll = vi.fn();
    window.HUDApp = {
      perfMonitor: {
        isEnabled: () => false,
        record: vi.fn(),
      },
    };

    await import("../../public/app/ws.js");

    const wsController = window.HUDApp.ws.createWsController({
      diagLog: vi.fn(),
      wsLogPrefix: "[HUD-WS]",
      fetchAll,
      setConnectionStatus: vi.fn(),
      setGatewayUptimeSnapshot: vi.fn(),
      startPolling: vi.fn(),
      stopPolling: vi.fn(),
      wsUrlFactory: () => "ws://hud.test/ws",
      now,
    });
    wsController.connect();

    expect(typeof ws.onmessage).toBe("function");
    ws.onmessage({ data: JSON.stringify({ type: "tick" }) });

    expect(fetchAll).toHaveBeenCalledWith(expect.objectContaining({ includeCold: false }));
    expect(now).not.toHaveBeenCalled();
  });

  it("renderPanelSafe does not schedule post-paint RAF when perf monitor is disabled", async () => {
    const rafSpy = vi.fn();
    globalThis.requestAnimationFrame = rafSpy;

    window.HUDApp = {
      perfMonitor: {
        isEnabled: () => false,
        record: vi.fn(),
      },
    };

    await import("../../public/app/ui.js");

    const controller = window.HUDApp.ui.createUiController({
      document,
      HUD: {
        cron: { openEditor: vi.fn() },
        agents: { showAgentSessions: vi.fn() },
        sessionTree: { toggleNode: vi.fn() },
      },
    });

    const panelEl = document.createElement("div");
    const renderFn = vi.fn();

    controller.renderPanelSafe("agents", panelEl, renderFn, {});
    controller.renderPanelSafe("agents", panelEl, renderFn, {});
    controller.renderPanelSafe("agents", panelEl, renderFn, {});
    controller.renderPanelSafe("agents", panelEl, renderFn, {});

    expect(renderFn).toHaveBeenCalledTimes(4);
    expect(rafSpy).not.toHaveBeenCalled();
  });
});

describe("ws perf telemetry and tick backpressure", () => {
  beforeEach(() => {
    vi.resetModules();
    delete window._hudWs;
    delete window.HUDApp;
    delete window.handleChatWsMessage;
  });

  function createWsHarness(options = {}) {
    const ws = {
      readyState: window.WebSocket ? window.WebSocket.CONNECTING : 0,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send: vi.fn(),
      close: vi.fn(),
    };

    const WebSocketMock = vi.fn(function MockWebSocket() {
      return ws;
    });
    WebSocketMock.OPEN = 1;
    WebSocketMock.CONNECTING = 0;
    window.WebSocket = WebSocketMock;

    return {
      ws,
      fetchAll: options.fetchAll || vi.fn(() => Promise.resolve()),
      setGatewayUptimeSnapshot: options.setGatewayUptimeSnapshot || vi.fn(),
      startPolling: options.startPolling || vi.fn(),
      stopPolling: options.stopPolling || vi.fn(),
      setConnectionStatus: options.setConnectionStatus || vi.fn(),
      diagLog: options.diagLog || vi.fn(),
      now: options.now,
    };
  }

  function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it("records ws telemetry with payloadBytes, parseMs, dispatchMs and type-specific metric names", async () => {
    const record = vi.fn();
    window.HUDApp = {
      perfMonitor: {
        isEnabled: () => true,
        record,
      },
    };
    const nowSequence = [100, 103, 109, 200, 205, 213];
    const harness = createWsHarness({
      now: () => nowSequence.shift() || 300,
    });
    window.handleChatWsMessage = vi.fn();

    await import("../../public/app/ws.js");

    const wsController = window.HUDApp.ws.createWsController({
      diagLog: harness.diagLog,
      wsLogPrefix: "[HUD-WS]",
      fetchAll: harness.fetchAll,
      setConnectionStatus: harness.setConnectionStatus,
      setGatewayUptimeSnapshot: harness.setGatewayUptimeSnapshot,
      startPolling: harness.startPolling,
      stopPolling: harness.stopPolling,
      wsUrlFactory: () => "ws://hud.test/ws",
      now: harness.now,
    });
    wsController.connect();

    harness.ws.onmessage({ data: JSON.stringify({ type: "tick" }) });
    harness.ws.onmessage({
      data: JSON.stringify({ type: "gateway-status", uptimeMs: 42 }),
    });

    const names = record.mock.calls.map(([entry]) => entry && entry.name);
    expect(names).toContain("ws.message.tick");
    expect(names).toContain("ws.message.gateway-status");

    const tickEntry = record.mock.calls
      .map(([entry]) => entry)
      .find((entry) => entry && entry.name === "ws.message.tick");
    expect(tickEntry).toMatchObject({
      payloadBytes: expect.any(Number),
      parseMs: expect.any(Number),
      dispatchMs: expect.any(Number),
    });
    expect(tickEntry.payloadBytes).toBeGreaterThan(0);
    expect(tickEntry.parseMs).toBeGreaterThanOrEqual(0);
    expect(tickEntry.dispatchMs).toBeGreaterThanOrEqual(0);

    expect(harness.fetchAll).toHaveBeenCalledWith(expect.objectContaining({ includeCold: false }));
    expect(harness.setGatewayUptimeSnapshot).toHaveBeenCalledWith(42);
  });

  it("keeps inbound ws telemetry counters scoped to each controller instance", async () => {
    const record = vi.fn();
    window.HUDApp = {
      perfMonitor: {
        isEnabled: () => true,
        record,
      },
    };
    window.handleChatWsMessage = vi.fn();

    await import("../../public/app/ws.js");

    const first = createWsHarness();
    const firstController = window.HUDApp.ws.createWsController({
      diagLog: first.diagLog,
      wsLogPrefix: "[HUD-WS]",
      fetchAll: first.fetchAll,
      setConnectionStatus: first.setConnectionStatus,
      setGatewayUptimeSnapshot: first.setGatewayUptimeSnapshot,
      startPolling: first.startPolling,
      stopPolling: first.stopPolling,
      wsUrlFactory: () => "ws://hud.test/ws",
    });
    firstController.connect();
    first.ws.onmessage({ data: JSON.stringify({ type: "tick" }) });

    window._hudWs = null;

    const second = createWsHarness();
    const secondController = window.HUDApp.ws.createWsController({
      diagLog: second.diagLog,
      wsLogPrefix: "[HUD-WS]",
      fetchAll: second.fetchAll,
      setConnectionStatus: second.setConnectionStatus,
      setGatewayUptimeSnapshot: second.setGatewayUptimeSnapshot,
      startPolling: second.startPolling,
      stopPolling: second.stopPolling,
      wsUrlFactory: () => "ws://hud.test/ws",
    });
    secondController.connect();
    second.ws.onmessage({ data: JSON.stringify({ type: "tick" }) });

    const tickEntries = record.mock.calls
      .map(([entry]) => entry)
      .filter((entry) => entry && entry.name === "ws.message.tick");
    expect(tickEntries).toHaveLength(2);
    expect(tickEntries[0].messageCount).toBe(1);
    expect(tickEntries[1].messageCount).toBe(1);
  });

  it("keeps existing perf runId stable across queued tick refreshes", async () => {
    const firstFetch = createDeferred();
    const fetchAll = vi
      .fn()
      .mockImplementationOnce(() => firstFetch.promise)
      .mockImplementation(() => Promise.resolve());

    const record = vi.fn();
    const setRunId = vi.fn(function (value) {
      this.runId = value;
    });
    window.HUDApp = {
      perfMonitor: {
        isEnabled: () => true,
        record,
      },
      perfEventContext: {
        runId: "shared-run-id",
        setRunId,
        getRunId: function () {
          return this.runId;
        },
      },
    };
    const harness = createWsHarness({ fetchAll });
    window.handleChatWsMessage = vi.fn();

    await import("../../public/app/ws.js");

    const wsController = window.HUDApp.ws.createWsController({
      diagLog: harness.diagLog,
      wsLogPrefix: "[HUD-WS]",
      fetchAll: harness.fetchAll,
      setConnectionStatus: harness.setConnectionStatus,
      setGatewayUptimeSnapshot: harness.setGatewayUptimeSnapshot,
      startPolling: harness.startPolling,
      stopPolling: harness.stopPolling,
      wsUrlFactory: () => "ws://hud.test/ws",
    });
    wsController.connect();

    harness.ws.onmessage({ data: JSON.stringify({ type: "tick" }) });
    harness.ws.onmessage({ data: JSON.stringify({ type: "tick" }) });
    expect(setRunId).not.toHaveBeenCalled();

    const firstCall = fetchAll.mock.calls[0][0];
    expect(firstCall).toMatchObject({ runId: "shared-run-id" });
    firstFetch.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchAll).toHaveBeenCalledTimes(2);
    const secondCall = fetchAll.mock.calls[1][0];
    expect(secondCall).toMatchObject({ runId: "shared-run-id" });
  });

  it("generates a tick runId once when no context runId is configured", async () => {
    const firstFetch = createDeferred();
    const fetchAll = vi
      .fn()
      .mockImplementationOnce(() => firstFetch.promise)
      .mockImplementation(() => Promise.resolve());

    const record = vi.fn();
    const setRunId = vi.fn(function (value) {
      this.runId = value == null ? null : String(value);
    });
    window.HUDApp = {
      perfMonitor: {
        isEnabled: () => true,
        record,
      },
      perfEventContext: {
        runId: null,
        setRunId,
        getRunId: function () {
          return this.runId;
        },
      },
    };
    const harness = createWsHarness({ fetchAll });
    window.handleChatWsMessage = vi.fn();

    await import("../../public/app/ws.js");

    const wsController = window.HUDApp.ws.createWsController({
      diagLog: harness.diagLog,
      wsLogPrefix: "[HUD-WS]",
      fetchAll: harness.fetchAll,
      setConnectionStatus: harness.setConnectionStatus,
      setGatewayUptimeSnapshot: harness.setGatewayUptimeSnapshot,
      startPolling: harness.startPolling,
      stopPolling: harness.stopPolling,
      wsUrlFactory: () => "ws://hud.test/ws",
    });
    wsController.connect();

    harness.ws.onmessage({ data: JSON.stringify({ type: "tick" }) });
    harness.ws.onmessage({ data: JSON.stringify({ type: "tick" }) });

    expect(setRunId).toHaveBeenCalledTimes(1);
    const firstCall = fetchAll.mock.calls[0][0];
    expect(firstCall.runId).toBeDefined();
    expect(firstCall.runId).toMatch(/^tick-/);
    firstFetch.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchAll).toHaveBeenCalledTimes(2);
    const secondCall = fetchAll.mock.calls[1][0];
    expect(secondCall).toBeTruthy();
    expect(secondCall.runId).toBe(firstCall.runId);
    expect(secondCall.runId).toMatch(/^tick-/);
  });

  it("handles ws JSON parse failures without throwing and records parse_error telemetry", async () => {
    const record = vi.fn();
    window.HUDApp = {
      perfMonitor: {
        isEnabled: () => true,
        record,
      },
    };
    const harness = createWsHarness();
    window.handleChatWsMessage = vi.fn();

    await import("../../public/app/ws.js");

    const wsController = window.HUDApp.ws.createWsController({
      diagLog: harness.diagLog,
      wsLogPrefix: "[HUD-WS]",
      fetchAll: harness.fetchAll,
      setConnectionStatus: harness.setConnectionStatus,
      setGatewayUptimeSnapshot: harness.setGatewayUptimeSnapshot,
      startPolling: harness.startPolling,
      stopPolling: harness.stopPolling,
      wsUrlFactory: () => "ws://hud.test/ws",
    });
    wsController.connect();

    expect(() => harness.ws.onmessage({ data: "{not-json}" })).not.toThrow();
    expect(harness.fetchAll).not.toHaveBeenCalled();
    expect(window.handleChatWsMessage).not.toHaveBeenCalled();

    const names = record.mock.calls.map(([entry]) => entry && entry.name);
    expect(names).toContain("ws.message.parse_error");
  });

  it("coalesces burst tick messages to avoid redundant fetchAll churn while preserving refresh", async () => {
    const firstFetch = createDeferred();
    const fetchAll = vi
      .fn()
      .mockImplementationOnce(() => firstFetch.promise)
      .mockImplementation(() => Promise.resolve());

    window.HUDApp = {
      perfMonitor: {
        isEnabled: () => false,
        record: vi.fn(),
      },
    };
    const harness = createWsHarness({ fetchAll });
    window.handleChatWsMessage = vi.fn();

    await import("../../public/app/ws.js");

    const wsController = window.HUDApp.ws.createWsController({
      diagLog: harness.diagLog,
      wsLogPrefix: "[HUD-WS]",
      fetchAll: harness.fetchAll,
      setConnectionStatus: harness.setConnectionStatus,
      setGatewayUptimeSnapshot: harness.setGatewayUptimeSnapshot,
      startPolling: harness.startPolling,
      stopPolling: harness.stopPolling,
      wsUrlFactory: () => "ws://hud.test/ws",
    });
    wsController.connect();

    harness.ws.onmessage({ data: JSON.stringify({ type: "tick" }) });
    harness.ws.onmessage({ data: JSON.stringify({ type: "tick" }) });
    harness.ws.onmessage({ data: JSON.stringify({ type: "tick" }) });
    harness.ws.onmessage({ data: JSON.stringify({ type: "tick" }) });
    harness.ws.onmessage({ data: JSON.stringify({ type: "tick" }) });

    expect(fetchAll).toHaveBeenCalledTimes(1);

    firstFetch.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchAll).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect(fetchAll).toHaveBeenCalledTimes(2);
  });
});

describe("data controller perf instrumentation", () => {
  beforeEach(() => {
    vi.resetModules();
    delete window.HUDApp;
  });

  function fetchImpl(url) {
    if (url === "/api/config") {
      return Promise.resolve(createMockJsonResponse({}));
    }
    if (url === "/api/model-usage/monthly") {
      return Promise.resolve(
        createMockJsonResponse({
          summary: {},
          models: [],
        }),
      );
    }
    return Promise.resolve(createMockJsonResponse([]));
  }

  it("does not record fetchAll or endpoint perf events when perf monitor is disabled", async () => {
    const record = vi.fn();
    window.HUDApp = {
      perfMonitor: {
        isEnabled: () => false,
        record,
      },
    };
    await import("../../public/app/data.js");

    const { controller } = createDataControllerPerfHarness({ fetchImpl });
    await controller.fetchAll({ includeCold: true });

    expect(record).not.toHaveBeenCalled();
  });

  it("adds HUD correlation request headers for instrumented fetch cycles", async () => {
    const record = vi.fn();
    const requests = [];
    const endpointPayloads = {
      "/api/agents": [],
      "/api/sessions": [],
      "/api/cron": [],
      "/api/config": {},
      "/api/model-usage/live-weekly": { weekly: { total: 1 } },
      "/api/models": [],
      "/api/activity": [],
      "/api/session-tree": { nodes: [] },
      "/api/model-usage/monthly": { month: "2026-03" },
    };

    const fetchImpl = vi.fn((url, options = {}) => {
      requests.push({ url: url, headers: options && options.headers ? options.headers : null });
      return Promise.resolve(createMockJsonResponse(endpointPayloads[url] ?? []));
    });

    const getHeaderValue = function (headers, name) {
      if (!headers) return "";
      if (typeof headers.get === "function") {
        return headers.get(name) || "";
      }
      return headers[name] || "";
    };

    window.HUDApp = {
      perfMonitor: {
        isEnabled: () => true,
        record,
      },
    };
    await import("../../public/app/data.js");

    const { controller } = createDataControllerPerfHarness({ fetchImpl });
    await controller.fetchAll({ includeCold: true, runId: "manual-run-1" });

    const urls = [
      "/api/agents",
      "/api/sessions",
      "/api/cron",
      "/api/config",
      "/api/model-usage/live-weekly",
      "/api/models",
      "/api/activity",
      "/api/session-tree",
      "/api/model-usage/monthly",
    ];

    urls.forEach((url) => {
      const request = requests.find((entry) => entry.url === url);
      expect(request).toBeDefined();
      expect(request.headers).toBeTruthy();
      expect(getHeaderValue(request.headers, "x-hud-source")).toBe("hud");
      expect(getHeaderValue(request.headers, "x-hud-run-id")).toBe("manual-run-1");
      expect(getHeaderValue(request.headers, "x-hud-perf")).toBe("1");
    });
  });

  it("adds run-id and source headers even when perf monitor is disabled", async () => {
    const requests = [];

    const fetchImpl = vi.fn((url, options = {}) => {
      requests.push({ url: url, headers: options && options.headers ? options.headers : null });
      return Promise.resolve(createMockJsonResponse([]));
    });

    const getHeaderValue = function (headers, name) {
      if (!headers) return "";
      if (typeof headers.get === "function") {
        return headers.get(name) || "";
      }
      return headers[name] || "";
    };

    window.HUDApp = {
      perfMonitor: {
        isEnabled: () => false,
        record: vi.fn(),
      },
    };
    await import("../../public/app/data.js");

    const { controller } = createDataControllerPerfHarness({ fetchImpl });
    await controller.fetchAll({ includeCold: true, runId: "disabled-run-2" });

    expect(requests.length).toBeGreaterThan(0);
    requests.forEach((request) => {
      const headers = request.headers;
      expect(getHeaderValue(headers, "x-hud-source")).toBe("hud");
      expect(getHeaderValue(headers, "x-hud-run-id")).toBe("disabled-run-2");
      expect(getHeaderValue(headers, "x-hud-perf")).toBe("");
    });
  });

  it("records fetchAll and endpoint perf event keys when perf monitor is enabled", async () => {
    const record = vi.fn();
    window.HUDApp = {
      perfMonitor: {
        isEnabled: () => true,
        record,
      },
    };
    await import("../../public/app/data.js");

    const { controller } = createDataControllerPerfHarness({ fetchImpl });
    await controller.fetchAll({ includeCold: true });

    const eventNames = record.mock.calls
      .map(([entry]) => entry && entry.name)
      .filter((name) => typeof name === "string");

    expect(eventNames).toContain("fetchAll.start");
    expect(eventNames).toContain("fetchAll.finish");
    expect(eventNames.some((name) => name.startsWith("fetchEndpoint."))).toBe(true);
  });

  it("records endpoint 304 hit-rate and payload bytes", async () => {
    const record = vi.fn();
    const responsesByUrl = {
      "/api/agents": {
        status: 200,
        payload: [{ id: "agent-1" }],
        headers: { "content-length": "20" },
      },
      "/api/sessions": { status: 200, payload: [], headers: { "content-length": "3" } },
      "/api/cron": { status: 200, payload: [], headers: { "content-length": "2" } },
      "/api/config": {
        status: 304,
        payload: null,
        headers: { "content-length": "128", "x-request-id": "cfg-304" },
      },
      "/api/model-usage/live-weekly": {
        status: 200,
        payload: { weekly: { count: 1 } },
        headers: { "content-length": "8" },
      },
      "/api/model-usage/monthly": {
        status: 200,
        payload: { month: "2026-03" },
        headers: { "content-length": "12" },
      },
      "/api/activity": { status: 200, payload: [], headers: { "content-length": "2" } },
      "/api/session-tree": {
        status: 200,
        payload: { nodes: [] },
        headers: { "content-length": "3" },
      },
    };
    const fetchImpl = vi.fn((url) => {
      const next = responsesByUrl[url];
      if (!next) {
        return Promise.resolve(createMockJsonResponse([]));
      }

      const status = next.status;
      if (status === 304) {
        return Promise.resolve({
          ok: false,
          status: 304,
          statusText: "Not Modified",
          headers: {
            get: (key) =>
              responsesByUrl[url].headers?.[key.toLowerCase()] ||
              responsesByUrl[url].headers?.[key] ||
              "",
          },
          text: () => Promise.resolve(""),
          json: () => Promise.resolve(null),
        });
      }

      return Promise.resolve({
        ok: true,
        status: status,
        statusText: "OK",
        headers: {
          get: (key) =>
            responsesByUrl[url].headers?.[key.toLowerCase()] ||
            responsesByUrl[url].headers?.[key] ||
            "",
        },
        text: () => Promise.resolve(JSON.stringify(next.payload)),
        json: () => Promise.resolve(next.payload),
      });
    });

    window.HUDApp = window.HUDApp || {};
    window.HUDApp.perfEventContext = {
      runId: null,
      setRunId: function (runId) {
        this.runId = runId == null ? null : String(runId);
      },
      getRunId: function () {
        return this.runId;
      },
    };
    window.HUDApp.perfMonitor = {
      isEnabled: () => true,
      record,
    };

    await import("../../public/app/data.js");
    const { controller } = createDataControllerPerfHarness({ fetchImpl });
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = function (callback) {
      if (typeof callback === "function") callback();
      return 1;
    };

    await controller.fetchAll({
      includeCold: true,
      runId: "manual-1",
      tickPaintStartMs: 100,
    });
    globalThis.requestAnimationFrame = originalRaf;

    const endpointEvent = record.mock.calls
      .map(([entry]) => entry)
      .find(
        (entry) =>
          entry &&
          typeof entry.name === "string" &&
          entry.name.startsWith("fetchEndpoint.") &&
          entry.endpoint === "config",
      );
    expect(endpointEvent).toMatchObject({
      name: "fetchEndpoint.config",
      notModified: 1,
      payloadBytes: 128,
      endpoint: "config",
    });

    const compositingEvent = record.mock.calls
      .map(([entry]) => entry)
      .find((entry) => entry && entry.name === "compositingPressure");
    expect(compositingEvent).toMatchObject({
      name: "compositingPressure",
      panelRenderCount: expect.any(Number),
      mutationCount: expect.any(Number),
    });
    expect(compositingEvent.panelRenderCount).toBeGreaterThan(0);

    const tickToPaintEvent = record.mock.calls
      .map(([entry]) => entry)
      .find((entry) => entry && entry.name === "tickToPaint");
    expect(tickToPaintEvent).toMatchObject({
      name: "tickToPaint",
      durationMs: expect.any(Number),
    });
    expect(tickToPaintEvent.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("records run-level SLO counters in fetchAll finish summary", async () => {
    const record = vi.fn();
    const callCounts = Object.create(null);

    const fetchImpl = vi.fn((url) => {
      callCounts[url] = (callCounts[url] || 0) + 1;
      const callIndex = callCounts[url];

      if (callIndex === 1) {
        const responseBodies = {
          "/api/agents": [{ id: "a-1" }],
          "/api/sessions": [{ sessionKey: "agent-a:s-1", agentId: "agent-a", sessionId: "s-1" }],
          "/api/cron": [],
          "/api/config": {},
          "/api/model-usage/live-weekly": { models: [] },
          "/api/activity": [],
          "/api/session-tree": { nodes: [] },
          "/api/models": [{ alias: "gpt-4o-mini" }],
          "/api/model-usage/monthly": { month: "2026-03" },
        };

        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          headers: {
            get: () => "",
          },
          text: () => Promise.resolve(JSON.stringify(responseBodies[url])),
          json: () => Promise.resolve(responseBodies[url]),
        });
      }

      if (url === "/api/agents" && callIndex === 2) {
        return Promise.resolve({
          ok: false,
          status: 304,
          statusText: "Not Modified",
          headers: { get: () => "" },
          text: () => Promise.resolve(""),
          json: () => Promise.resolve(null),
        });
      }

      if (url === "/api/sessions" && callIndex === 2) {
        return new Promise(function () {});
      }

      if (url === "/api/cron" && callIndex === 2) {
        return Promise.reject(new Error("cron unavailable"));
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: {
          get: () => "",
        },
        text: () => Promise.resolve(JSON.stringify([])),
        json: () => Promise.resolve([]),
      });
    });

    window.HUDApp = {
      perfMonitor: {
        isEnabled: () => true,
        record,
      },
    };
    await import("../../public/app/data.js");

    const { controller } = createDataControllerPerfHarness({
      fetchImpl,
      endpointTimeoutMs: 8,
      onChatRestore: vi.fn(),
    });

    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = function (callback) {
      if (typeof callback === "function") callback();
      return 1;
    };

    await controller.fetchAll({ includeCold: true });
    const secondFetch = controller.fetchAll({
      includeCold: true,
      runId: "slo-run",
      tickPaintStartMs: 1,
    });

    await secondFetch;
    globalThis.requestAnimationFrame = originalRaf;

    const finishEvent = record.mock.calls
      .map(([entry]) => entry)
      .filter((entry) => entry && entry.name === "fetchAll.finish")
      .at(-1);

    expect(finishEvent).toMatchObject({
      name: "fetchAll.finish",
      staleEndpoints: 2,
      timeoutEndpoints: 1,
      errorEndpoints: 1,
      freshEndpoints: 6,
      over500ms: 0,
      success: 1,
      hasAnyData: 1,
      coldRefreshCompleted: 1,
      includeCold: 1,
    });
  });
});

describe("HUD perf sink transport", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    installLocalStorageMock();
    await loadAppDiagnosticsModule();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses hudPerfSink=file into diagnostics flags", () => {
    const diagnostics = window.HUDApp.diagnostics;
    expect(typeof diagnostics.resolvePerfDiagnosticsFlags).toBe("function");

    const flags = diagnostics.resolvePerfDiagnosticsFlags({
      search: "?hudPerf=1&hudPerfSink=file",
      localStorageValue: null,
    });

    expect(flags).toMatchObject({
      enabled: true,
      sink: "file",
    });
  });

  it("defaults sink metadata in payload when sink option is omitted", async () => {
    const diagnostics = window.HUDApp.diagnostics;
    expect(typeof diagnostics.createPerfBatchTransport).toBe("function");

    const fetchImpl = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 202,
      }),
    );
    const transport = diagnostics.createPerfBatchTransport({
      enabled: true,
      endpoint: "/api/diag/perf",
      batchSize: 1,
      flushIntervalMs: 250,
      fetchImpl,
    });

    transport.enqueue({
      ts: "2026-03-03T18:00:00.000Z",
      summary: {
        "fetchAll.finish": {
          durationMs: { count: 1, sum: 15, min: 15, max: 15, last: 15 },
        },
      },
    });

    await vi.runOnlyPendingTimersAsync();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, options] = fetchImpl.mock.calls[0];
    const payload = JSON.parse(options.body);
    expect(payload.sink).toBe("file");
  });

  it("sends batched perf summaries when file sink transport is enabled", async () => {
    const diagnostics = window.HUDApp.diagnostics;
    expect(typeof diagnostics.createPerfBatchTransport).toBe("function");

    const fetchImpl = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 202,
        json: async () => ({ ok: true }),
      }),
    );
    const transport = diagnostics.createPerfBatchTransport({
      enabled: true,
      sink: "file",
      endpoint: "/api/diag/perf",
      batchSize: 2,
      flushIntervalMs: 250,
      fetchImpl,
    });

    transport.enqueue({
      ts: "2026-03-03T18:00:00.000Z",
      summary: {
        "fetchAll.finish": {
          durationMs: { count: 1, sum: 15, min: 15, max: 15, last: 15 },
        },
      },
    });
    transport.enqueue({
      ts: "2026-03-03T18:00:01.000Z",
      summary: {
        "chatBatcher.flush": {
          durationMs: { count: 1, sum: 8, min: 8, max: 8, last: 8 },
        },
      },
    });

    await vi.runOnlyPendingTimersAsync();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/diag/perf");
    expect(options).toMatchObject({
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
    });

    const payload = JSON.parse(options.body);
    expect(payload).toMatchObject({
      source: "hud",
      sink: "file",
    });
    expect(Array.isArray(payload.events)).toBe(true);
    expect(payload.events).toHaveLength(2);
  });

  it("does not send batched summaries when file sink transport is disabled", async () => {
    const diagnostics = window.HUDApp.diagnostics;
    expect(typeof diagnostics.createPerfBatchTransport).toBe("function");

    const fetchImpl = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 202,
      }),
    );
    const transport = diagnostics.createPerfBatchTransport({
      enabled: false,
      sink: "file",
      endpoint: "/api/diag/perf",
      batchSize: 2,
      flushIntervalMs: 250,
      fetchImpl,
    });

    transport.enqueue({
      ts: "2026-03-03T18:05:00.000Z",
      summary: {
        "fetchAll.finish": {
          durationMs: { count: 1, sum: 11, min: 11, max: 11, last: 11 },
        },
      },
    });
    transport.enqueue({
      ts: "2026-03-03T18:05:01.000Z",
      summary: {
        "fetchAll.finish": {
          durationMs: { count: 1, sum: 12, min: 12, max: 12, last: 12 },
        },
      },
    });

    await vi.runOnlyPendingTimersAsync();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retains failed batches for retry and logs transport errors when fetch rejects", async () => {
    const diagnostics = window.HUDApp.diagnostics;
    expect(typeof diagnostics.createPerfBatchTransport).toBe("function");

    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ ok: true, status: 202 });
    const logger = vi.fn();
    const transport = diagnostics.createPerfBatchTransport({
      enabled: true,
      sink: "file",
      endpoint: "/api/diag/perf",
      batchSize: 2,
      flushIntervalMs: 250,
      fetchImpl,
      logger,
    });

    transport.enqueue({
      ts: "2026-03-03T18:06:00.000Z",
      summary: {
        "fetchAll.finish": { durationMs: { count: 1, sum: 19, min: 19, max: 19, last: 19 } },
      },
    });
    transport.enqueue({
      ts: "2026-03-03T18:06:01.000Z",
      summary: {
        "fetchAll.finish": { durationMs: { count: 1, sum: 20, min: 20, max: 20, last: 20 } },
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalled();

    transport.flush();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const firstPayload = JSON.parse(fetchImpl.mock.calls[0][1].body);
    const retryPayload = JSON.parse(fetchImpl.mock.calls[1][1].body);
    expect(retryPayload.events).toEqual(firstPayload.events);

    const loggedText = logger.mock.calls.map((call) => call.map(String).join(" ")).join(" ");
    expect(loggedText).toContain("network down");
  });

  it("retains failed batches for retry when fetch returns non-2xx", async () => {
    const diagnostics = window.HUDApp.diagnostics;
    expect(typeof diagnostics.createPerfBatchTransport).toBe("function");

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: "Service Unavailable" })
      .mockResolvedValueOnce({ ok: true, status: 202 });
    const transport = diagnostics.createPerfBatchTransport({
      enabled: true,
      sink: "file",
      endpoint: "/api/diag/perf",
      batchSize: 2,
      flushIntervalMs: 250,
      fetchImpl,
    });

    transport.enqueue({
      ts: "2026-03-03T18:07:00.000Z",
      summary: {
        "chatBatcher.flush": { durationMs: { count: 1, sum: 9, min: 9, max: 9, last: 9 } },
      },
    });
    transport.enqueue({
      ts: "2026-03-03T18:07:01.000Z",
      summary: {
        "chatBatcher.flush": { durationMs: { count: 1, sum: 10, min: 10, max: 10, last: 10 } },
      },
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    transport.flush();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const firstPayload = JSON.parse(fetchImpl.mock.calls[0][1].body);
    const retryPayload = JSON.parse(fetchImpl.mock.calls[1][1].body);
    expect(retryPayload.events).toEqual(firstPayload.events);
  });
});

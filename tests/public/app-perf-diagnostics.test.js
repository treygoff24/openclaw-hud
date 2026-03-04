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

  const diagnostics =
    options.diagnostics ||
    {
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

    expect(flags).toEqual({ enabled: false });
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

    expect(fetchAll).toHaveBeenCalledWith({ includeCold: false });
    expect(encodeSpy).not.toHaveBeenCalled();
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
});

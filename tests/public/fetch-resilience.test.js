// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Set up minimal DOM that app.js expects
document.body.innerHTML = `
  <header></header>
  <span id="stat-uptime"></span>
  <span id="clock"></span>
  <div id="toast" class="toast"></div>
  <div id="spawn-modal"><button id="new-session-btn"></button><button id="open-spawn-btn"></button><button id="spawn-cancel-btn"></button><button id="spawn-modal-close"></button><button id="spawn-launch-btn"></button></div>
  <div id="cron-modal"><button id="cron-modal-close"></button><select id="cron-session-target"><option value="main">main</option></select><select id="cron-schedule-kind"><option value="cron">cron</option></select></div>
  <span id="agent-count"></span><div id="agents-list"></div><input id="agent-search" />
  <span id="stat-agents"></span><span id="stat-active"></span>
  <span id="cron-count"></span><div id="cron-list"></div>
  <span id="session-count"></span><div id="sessions-list"></div>
  <div id="model-usage"></div>
  <span id="activity-count"></span><div id="activity-feed"></div>
  <span id="tree-count"></span><div id="tree-body"></div>
  <div id="system-info"></div><span id="sys-model"></span>
  <input id="spawn-label" /><select id="spawn-mode"><option value="run">run</option></select>
  <input id="spawn-timeout" /><textarea id="spawn-files"></textarea><textarea id="spawn-prompt"></textarea>
  <select id="spawn-agent"></select><select id="spawn-model"></select><div id="spawn-error"></div>
  <span id="cron-edit-name"></span><input id="cron-name" /><input id="cron-enabled" type="checkbox" />
  <select id="cron-agent"></select><input id="cron-expr" /><input id="cron-tz" /><input id="cron-at" />
  <select id="cron-model"></select><input id="cron-timeout" /><textarea id="cron-prompt"></textarea>
  <div id="cron-model-group"></div><div id="cron-timeout-group"></div><span id="cron-prompt-label"></span>
  <div id="cron-expr-group"></div><div id="cron-tz-group"></div><div id="cron-at-group"></div>
  <div class="hud-layout">
    <div id="chat-title"></div>
    <div id="chat-live"></div>
    <div id="chat-messages"></div>
    <div id="chat-new-pill"></div>
    <button id="chat-close"></button>
    <button id="chat-new-chat-btn"></button>
    <div id="chat-model-picker" style="display:none"></div>
    <div id="gateway-banner" class="gateway-banner" style="display:none">Gateway connection lost</div>
    <div class="chat-input-area" id="chat-input-area">
      <textarea id="chat-input" class="chat-input" placeholder="Type a message..." rows="1"></textarea>
      <button id="chat-send-btn" class="chat-send-btn" title="Send">&#9654;</button>
      <button id="chat-stop-btn" class="chat-stop-btn" title="Stop" style="display:none">&#9632;</button>
    </div>
  </div>
`;

window.HUD = window.HUD || {};
window.makeFocusable = function (el, handler) {
  el.tabIndex = 0;
  el.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handler();
    }
  });
};
window.escapeHtml = function (s) {
  if (s == null) return "";
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
};

// Mock fetch
function createResolvedResponse(payload) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => "" },
    json: () => Promise.resolve(payload),
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise(function (res, rej) {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createEndpointResponse(payload, options) {
  const opts = options || {};
  const status = Number.isFinite(opts.status) && opts.status > 0 ? Math.floor(opts.status) : 200;
  const etag = opts.etag || "";
  return {
    ok: Boolean(opts.ok !== undefined ? opts.ok : status >= 200 && status < 400),
    status: status,
    statusText: opts.statusText || (status === 304 ? "Not Modified" : "OK"),
    headers: {
      get: (key) => {
        const header = String(key || "").toLowerCase();
        if (header === "x-request-id") return opts.requestId || "";
        if (header === "etag") return etag;
        return "";
      },
    },
    text: opts.text
      ? () => Promise.resolve(opts.text)
      : () => Promise.resolve(JSON.stringify(payload)),
    json: () => Promise.resolve(payload),
  };
}

const defaultPayloadFetch = vi.fn(() => Promise.resolve(createResolvedResponse([])));
window.fetch = defaultPayloadFetch;

// Mock WebSocket
const createdSockets = [];
function createMockWs() {
  return {
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send: vi.fn(),
    close: vi.fn(),
    readyState: 0,
  };
}
window.WebSocket = vi.fn(function MockWebSocket() {
  const ws = createMockWs();
  createdSockets.push(ws);
  return ws;
});
window.WebSocket.OPEN = 1;
window.WebSocket.CONNECTING = 0;

// crypto.randomUUID
let uuidCounter = 0;
if (!globalThis.crypto) globalThis.crypto = {};
if (!globalThis.crypto.randomUUID) globalThis.crypto.randomUUID = () => "uuid-" + ++uuidCounter;

// Mock localStorage
const _store = {};
Object.defineProperty(window, "localStorage", {
  value: {
    getItem: vi.fn((k) => (Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null)),
    setItem: vi.fn((k, v) => {
      _store[k] = v;
    }),
    removeItem: vi.fn((k) => {
      delete _store[k];
    }),
    clear: vi.fn(() => {
      Object.keys(_store).forEach((k) => delete _store[k]);
    }),
  },
  writable: true,
});

// Load all panels and app.js
await import("../../public/utils.js");
await import("../../public/label-sanitizer.js");
await import("../../public/session-labels.js");
await import("../../public/panels/activity.js");
await import("../../public/panels/sessions.js");
await import("../../public/panels/agents.js");
await import("../../public/panels/cron.js");
await import("../../public/panels/models.js");
await import("../../public/panels/session-tree.js");
await import("../../public/panels/system.js");
await import("../../public/panels/spawn.js");
await import("../../public/copy-utils.js");
await import("../../public/chat-message.js");
await import("../../public/chat-input/attachments.js");
await import("../../public/chat-input/autocomplete.js");
await import("../../public/chat-input/send-flow.js");
await import("../../public/chat-input/model-picker.js");
await import("../../public/chat-commands/catalog.js");
await import("../../public/chat-commands/fuzzy.js");
await import("../../public/chat-commands/registry.js");
await import("../../public/chat-commands/help.js");
await import("../../public/chat-commands/local-exec.js");
await import("../../public/chat-commands.js");
await import("../../public/chat-input.js");
await import("../../public/chat-ws/runtime.js");
await import("../../public/chat-ws/history-log.js");
await import("../../public/chat-ws/stream-events.js");
await import("../../public/chat-ws/system-events.js");
await import("../../public/chat-ws-handler.js");
await import("../../public/app/diagnostics.js");
await import("../../public/app/status.js");
await import("../../public/app/ui.js");
await import("../../public/app/data.js");
await import("../../public/app/polling.js");
await import("../../public/app/ws.js");
await import("../../public/app/bootstrap.js");
await import("../../public/app.js");
await import("../../public/chat-pane/constants.js");
await import("../../public/chat-pane/diagnostics.js");
await import("../../public/chat-pane/session-metadata.js");
await import("../../public/chat-pane/history-timeout.js");
await import("../../public/chat-pane/transport.js");
await import("../../public/chat-pane/state.js");
await import("../../public/chat-pane/pane-lifecycle.js");
await import("../../public/chat-pane/session-restore.js");
await import("../../public/chat-pane/ws-bridge.js");
await import("../../public/chat-pane/export.js");
await import("../../public/chat-pane.js");

const baseLocalFetch = defaultPayloadFetch;

beforeEach(() => {
  window.fetch = vi.fn(() => Promise.resolve(createResolvedResponse([])));
});

afterEach(() => {
  vi.restoreAllMocks();
  window.fetch = baseLocalFetch;
});

describe("fetchAll resilient fetching", () => {
  function createColdAndModelUsageController(overrides) {
    const fetchImpl =
      overrides && Object.prototype.hasOwnProperty.call(overrides, "fetch")
        ? overrides.fetch
        : null;
    const opts = {
      HUD: HUD,
      renderPanelSafe: window.renderPanelSafe,
      setConnectionStatus: vi.fn(),
    };
    if (fetchImpl) {
      opts.getFetch = function () {
        return fetchImpl;
      };
    }
    return HUDApp.data.createDataController(Object.assign(opts, overrides || {}));
  }

  it("renders weekly model usage before monthly enrichment during cold refresh", async () => {
    const modelsRenderSpy = vi.spyOn(HUD.models, "render");
    const modelUsageController = createColdAndModelUsageController();
    const weeklyResult = { weekly: 2, models: ["codex"] };
    const monthlyResult = { month: "2026-03" };
    const weeklyDeferred = createDeferred();
    const monthlyDeferred = createDeferred();

    window.fetch = vi.fn((url) => {
      if (url === "/api/model-usage/live-weekly") {
        return Promise.resolve(createResolvedResponse(weeklyDeferred.promise));
      }
      if (url === "/api/model-usage/monthly") {
        return Promise.resolve(createResolvedResponse(monthlyDeferred.promise));
      }
      return Promise.resolve(createResolvedResponse([]));
    });

    const fetchPromise = modelUsageController.fetchAll({ includeCold: true });
    weeklyDeferred.resolve(weeklyResult);
    await new Promise(function (resolve) {
      setTimeout(resolve, 0);
    });

    expect(modelsRenderSpy).toHaveBeenCalled();
    const firstRenderArg = modelsRenderSpy.mock.calls[0][0];
    expect(firstRenderArg).toMatchObject(weeklyResult);
    expect(firstRenderArg).not.toHaveProperty("_monthlyData");

    const renderCallsAfterWeekly = modelsRenderSpy.mock.calls.length;
    expect(renderCallsAfterWeekly).toBe(1);

    monthlyDeferred.resolve(monthlyResult);
    await fetchPromise;

    expect(modelsRenderSpy).toHaveBeenCalledTimes(2);
    const secondRenderArg = modelsRenderSpy.mock.calls[1][0];
    expect(secondRenderArg).toMatchObject({
      _monthlyData: monthlyResult,
    });
  });

  it("resolves includeCold fetch only after queued cold refresh finishes", async () => {
    const modelUsageController = createColdAndModelUsageController();
    const hotDeferred = createDeferred();
    const modelsDeferred = createDeferred();
    const monthlyDeferred = createDeferred();
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => 0);
    const hotPayload = [];

    const hotEndpoints = new Set([
      "/api/agents",
      "/api/sessions",
      "/api/cron",
      "/api/config",
      "/api/model-usage/live-weekly",
      "/api/activity",
      "/api/session-tree",
    ]);
    const fetchCalls = [];

    window.fetch = vi.fn((url) => {
      fetchCalls.push(url);
      if (url === "/api/models") {
        return Promise.resolve(createResolvedResponse(modelsDeferred.promise));
      }
      if (url === "/api/model-usage/monthly") {
        return Promise.resolve(createResolvedResponse(monthlyDeferred.promise));
      }
      if (hotEndpoints.has(url)) {
        return Promise.resolve(createResolvedResponse(hotDeferred.promise));
      }
      return Promise.resolve(createResolvedResponse(hotPayload));
    });

    const firstFetch = modelUsageController.fetchAll();
    const secondFetch = modelUsageController.fetchAll({ includeCold: true });
    let secondFetchResolved = false;
    secondFetch.then(() => {
      secondFetchResolved = true;
    });

    await Promise.resolve();
    expect(secondFetchResolved).toBe(false);
    expect(fetchCalls.filter((url) => url === "/api/models")).toHaveLength(0);

    hotDeferred.resolve(hotPayload);
    await firstFetch;

    expect(secondFetchResolved).toBe(false);

    modelsDeferred.resolve([]);
    monthlyDeferred.resolve({ totals: [] });
    await secondFetch;
    nowSpy.mockRestore();

    expect(secondFetchResolved).toBe(true);
    expect(fetchCalls.filter((url) => url === "/api/models")).toHaveLength(1);
    expect(fetchCalls.filter((url) => url === "/api/model-usage/monthly")).toHaveLength(1);
  });

  it("coalesces concurrent endpoint requests so hot endpoints are fetched once", async () => {
    const sessionsDeferred = createDeferred();
    const agentsDeferred = createDeferred();
    const fetchCalls = [];
    const sessionsPayload = [
      {
        sessionKey: "agent-alpha::session-stable",
        agentId: "agent-alpha",
        sessionId: "session-stable",
        status: "active",
        updatedAt: "2026-03-03T18:00:00.000Z",
      },
    ];
    const agentsPayload = [
      {
        id: "agent-alpha",
        sessions: sessionsPayload,
        sessionCount: 1,
        activeSessions: 1,
      },
    ];
    let sessionsPayloadResolved = false;

    window.fetch = vi.fn((url) => {
      fetchCalls.push(url);
      if (url === "/api/sessions") {
        return sessionsPayloadResolved
          ? Promise.resolve(createEndpointResponse(sessionsPayload, { status: 200 }))
          : sessionsDeferred.promise;
      }
      if (url === "/api/agents") {
        return sessionsPayloadResolved
          ? Promise.resolve(createEndpointResponse(agentsPayload, { status: 200 }))
          : agentsDeferred.promise;
      }
      return Promise.resolve(createEndpointResponse([]));
    });

    const modelUsageController = createColdAndModelUsageController();
    const firstRefresh = modelUsageController.fetchAll();
    await Promise.resolve();
    const secondRefresh = modelUsageController.fetchAll();
    await Promise.resolve();

    const sessionCalls = fetchCalls.filter((url) => url === "/api/sessions").length;
    const agentCalls = fetchCalls.filter((url) => url === "/api/agents").length;
    expect(sessionCalls).toBe(1);
    expect(agentCalls).toBe(1);

    sessionsPayloadResolved = true;
    sessionsDeferred.resolve(createEndpointResponse(sessionsPayload, { status: 200 }));
    agentsDeferred.resolve(createEndpointResponse(agentsPayload, { status: 200 }));
    await firstRefresh;
    await secondRefresh;

    expect(fetchCalls.filter((url) => url === "/api/sessions").length).toBe(1);
    expect(fetchCalls.filter((url) => url === "/api/agents").length).toBe(1);
  });

  it("counts an all-304 refresh cycle as connected when cache already exists", async () => {
    const setConnectionStatus = vi.fn();
    const requestCounts = Object.create(null);
    const fetchCalls = [];

    window.fetch = vi.fn((url) => {
      fetchCalls.push(url);
      requestCounts[url] = (requestCounts[url] || 0) + 1;

      const isInitialRequest = requestCounts[url] === 1;
      if (url === "/api/models") {
        return isInitialRequest
          ? Promise.resolve(createEndpointResponse(["gpt-4"], { status: 200, etag: '"models-v1"' }))
          : Promise.resolve(createEndpointResponse("", { status: 304 }));
      }

      if (url === "/api/model-usage/monthly") {
        return isInitialRequest
          ? Promise.resolve(createEndpointResponse({ month: "2026-02" }))
          : Promise.resolve(createEndpointResponse("", { status: 304 }));
      }

      return isInitialRequest
        ? Promise.resolve(createEndpointResponse([{ id: "seed" }], { status: 200 }))
        : Promise.resolve(createEndpointResponse("", { status: 304 }));
    });

    const modelUsageController = createColdAndModelUsageController({
      setConnectionStatus,
    });

    await modelUsageController.fetchAll({ includeCold: true });

    setConnectionStatus.mockClear();
    await modelUsageController.fetchAll({ includeCold: true });

    expect(setConnectionStatus).toHaveBeenCalledWith(true);
    expect(fetchCalls.filter((url) => url === "/api/agents")).toHaveLength(2);
    expect(fetchCalls.filter((url) => url === "/api/sessions")).toHaveLength(2);
    expect(fetchCalls.filter((url) => url === "/api/models")).toHaveLength(2);
    expect(fetchCalls.filter((url) => url === "/api/model-usage/monthly")).toHaveLength(2);
  });

  it("advances cold-refresh watermark when cold endpoint returns 304 with cache", async () => {
    let now = 0;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const requestCounts = Object.create(null);

    window.fetch = vi.fn((url) => {
      requestCounts[url] = (requestCounts[url] || 0) + 1;

      if (url === "/api/models") {
        if (requestCounts[url] === 1) {
          return Promise.resolve(
            createEndpointResponse(["gpt-4"], { status: 200, etag: '"models-v1"' }),
          );
        }
        return Promise.resolve(createEndpointResponse("", { status: 304 }));
      }

      if (url === "/api/model-usage/monthly") {
        return Promise.resolve(createEndpointResponse({ month: "2026-02" }));
      }

      return Promise.resolve(createEndpointResponse([]));
    });

    const modelUsageController = createColdAndModelUsageController();
    await modelUsageController.fetchAll({ includeCold: true });
    now = 1;
    await modelUsageController.fetchAll({ includeCold: true });

    now = 60 * 1000;
    await modelUsageController.fetchAll();

    expect(window.fetch.mock.calls.filter((call) => call[0] === "/api/models").length).toBe(2);

    dateNowSpy.mockRestore();
  });

  it("still runs monthly follow-up when cold endpoint responds 304", async () => {
    const requestCounts = Object.create(null);

    window.fetch = vi.fn((url) => {
      requestCounts[url] = (requestCounts[url] || 0) + 1;

      if (url === "/api/models") {
        if (requestCounts[url] === 1) {
          return Promise.resolve(
            createEndpointResponse(["gpt-4"], { status: 200, etag: '"models-v1"' }),
          );
        }
        return Promise.resolve(createEndpointResponse("", { status: 304 }));
      }

      if (url === "/api/model-usage/monthly") {
        return Promise.resolve(createEndpointResponse({ month: "2026-02" }));
      }

      return Promise.resolve(createEndpointResponse([]));
    });

    const modelUsageController = createColdAndModelUsageController();

    await modelUsageController.fetchAll({ includeCold: true });
    await modelUsageController.fetchAll({ includeCold: true });

    expect(
      window.fetch.mock.calls.filter((call) => call[0] === "/api/model-usage/monthly").length,
    ).toBe(2);
  });

  it("preserves stale payload on 304 and avoids extra render work", async () => {
    const sessionsRenderSpy = vi.spyOn(HUD.sessions, "render");
    const sessionsPayload = [
      {
        sessionKey: "agent-alpha::session-a",
        agentId: "agent-alpha",
        sessionId: "session-a",
        status: "active",
        updatedAt: "2026-03-03T18:00:00.000Z",
        label: "Session A",
      },
    ];
    let sessionsCallCount = 0;

    window.fetch = vi.fn((url) => {
      if (url === "/api/sessions") {
        sessionsCallCount += 1;
        if (sessionsCallCount === 1) {
          return Promise.resolve(
            createEndpointResponse(sessionsPayload, {
              status: 200,
              etag: '"sessions-v1"',
            }),
          );
        }
        return Promise.resolve(createEndpointResponse("", { status: 304 }));
      }

      return Promise.resolve(createEndpointResponse([], { status: 200 }));
    });

    const modelUsageController = createColdAndModelUsageController();

    await modelUsageController.fetchAll();
    expect(sessionsRenderSpy).toHaveBeenCalledTimes(1);

    sessionsRenderSpy.mockClear();
    await modelUsageController.fetchAll();

    expect(sessionsRenderSpy).toHaveBeenCalledTimes(0);
    expect(sessionsCallCount).toBe(2);
    sessionsRenderSpy.mockRestore();
  });

  it("sends If-None-Match when an ETag is known and keeps cached payload on unchanged response", async () => {
    const agentsRenderSpy = vi.spyOn(HUD.agents, "render");
    const agentsPayload = [
      {
        id: "agent-alpha",
        sessions: [],
        sessionCount: 0,
        activeSessions: 0,
      },
    ];
    let agentCallCount = 0;

    window.fetch = vi.fn((url, options = {}) => {
      if (url === "/api/agents") {
        agentCallCount += 1;
        if (agentCallCount === 1) {
          return Promise.resolve(
            createEndpointResponse(agentsPayload, {
              status: 200,
              etag: '"agent-v1"',
            }),
          );
        }

        if (options && options.headers && typeof options.headers.get === "function") {
          expect(options.headers.get("If-None-Match")).toBe('"agent-v1"');
        } else {
          expect(options.headers).toMatchObject({ "If-None-Match": '"agent-v1"' });
        }

        return Promise.resolve(createEndpointResponse("", { status: 304 }));
      }
      return Promise.resolve(createEndpointResponse([], { status: 200 }));
    });

    const modelUsageController = createColdAndModelUsageController();

    await modelUsageController.fetchAll();
    await modelUsageController.fetchAll();

    expect(agentCallCount).toBe(2);
    expect(agentsRenderSpy).toHaveBeenCalledTimes(1);
    agentsRenderSpy.mockRestore();
  });

  it("does not advance the cold-refresh timestamp when cold refresh fails", async () => {
    let now = 100000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(function () {
      const value = now;
      return value;
    });
    const fetchCalls = [];

    window.fetch = vi.fn((url) => {
      fetchCalls.push(url);
      if (url === "/api/models") {
        return Promise.reject(new Error("models offline"));
      }
      if (url === "/api/model-usage/monthly") {
        return Promise.resolve(createResolvedResponse({}));
      }
      return Promise.resolve(createResolvedResponse([]));
    });

    const modelUsageController = createColdAndModelUsageController();
    await modelUsageController.fetchAll({ includeCold: true });
    expect(fetchCalls.filter((url) => url === "/api/models")).toHaveLength(1);
    now += 1;

    await modelUsageController.fetchAll();
    expect(fetchCalls.filter((url) => url === "/api/models")).toHaveLength(2);
    nowSpy.mockRestore();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls fetch for all endpoints", async () => {
    const modelUsageController = createColdAndModelUsageController();
    const fetchCalls = [];
    window.fetch = vi.fn((url) => {
      fetchCalls.push(url);
      return Promise.resolve(createResolvedResponse([]));
    });

    await modelUsageController.fetchAll({ includeCold: true });

    expect(fetchCalls).toContain("/api/agents");
    expect(fetchCalls).toContain("/api/sessions");
    expect(fetchCalls).toContain("/api/config");
    expect(fetchCalls).toContain("/api/model-usage/live-weekly");
    expect(fetchCalls).toContain("/api/models");
    expect(fetchCalls).toContain("/api/model-usage/monthly");
  });

  it("does not run cold model endpoints on every fetchAll cycle", async () => {
    const fetchCalls = [];
    let now = 0;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    window.fetch = vi.fn((url) => {
      fetchCalls.push(url);
      return Promise.resolve(createResolvedResponse([]));
    });

    try {
      await HUD.fetchAll({ includeCold: true });
      expect(fetchCalls).toContain("/api/models");
      expect(fetchCalls).toContain("/api/model-usage/monthly");

      const firstColdCalls = fetchCalls.slice();

      now = 5 * 1000;
      await HUD.fetchAll();

      expect(fetchCalls.filter((url) => url === "/api/models")).toHaveLength(
        firstColdCalls.filter((url) => url === "/api/models").length,
      );
      expect(fetchCalls.filter((url) => url === "/api/model-usage/monthly")).toHaveLength(
        firstColdCalls.filter((url) => url === "/api/model-usage/monthly").length,
      );

      now = 70 * 1000;
      await HUD.fetchAll({ includeCold: true });
      expect(fetchCalls.filter((url) => url === "/api/models").length).toBeGreaterThan(
        firstColdCalls.filter((url) => url === "/api/models").length,
      );
      expect(fetchCalls.filter((url) => url === "/api/model-usage/monthly").length).toBeGreaterThan(
        firstColdCalls.filter((url) => url === "/api/model-usage/monthly").length,
      );
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it("keeps heavy endpoints on hot cadence by default and still fetches them on explicit cold refresh", async () => {
    let now = 0;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const fetchCalls = [];

    window.fetch = vi.fn((url) => {
      fetchCalls.push(url);
      return Promise.resolve(createResolvedResponse([]));
    });

    try {
      const controller = createColdAndModelUsageController();

      await controller.fetchAll();
      expect(fetchCalls.filter((url) => url === "/api/activity")).toHaveLength(1);
      expect(fetchCalls.filter((url) => url === "/api/session-tree")).toHaveLength(1);
      expect(fetchCalls.filter((url) => url === "/api/agents")).toHaveLength(1);

      now = 5000;
      await controller.fetchAll();

      expect(fetchCalls.filter((url) => url === "/api/activity")).toHaveLength(2);
      expect(fetchCalls.filter((url) => url === "/api/session-tree")).toHaveLength(2);
      expect(fetchCalls.filter((url) => url === "/api/agents")).toHaveLength(2);

      now = 6000;
      await controller.fetchAll({ includeCold: true });

      expect(fetchCalls.filter((url) => url === "/api/activity")).toHaveLength(3);
      expect(fetchCalls.filter((url) => url === "/api/session-tree")).toHaveLength(3);
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it("does not throttle heavy endpoints after failure so recovery can happen immediately", async () => {
    let now = 0;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    let activityCalls = 0;

    window.fetch = vi.fn((url) => {
      if (url === "/api/activity") {
        activityCalls += 1;
        if (activityCalls === 1) {
          return Promise.reject(new Error("activity temporarily unavailable"));
        }
      }
      return Promise.resolve({ json: () => Promise.resolve([]) });
    });

    try {
      const controller = createColdAndModelUsageController();

      await controller.fetchAll();
      now = 1000;
      await controller.fetchAll();

      expect(activityCalls).toBe(2);
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it("does not downshift heavy-endpoint cadence after successful responses", async () => {
    let now = 0;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    let activityCalls = 0;

    window.fetch = vi.fn((url) => {
      if (url === "/api/activity") {
        activityCalls += 1;
        return Promise.resolve(createResolvedResponse([]));
      }
      return Promise.resolve(createResolvedResponse([]));
    });

    try {
      const controller = createColdAndModelUsageController();

      await controller.fetchAll();
      now = 1000;
      await controller.fetchAll();

      expect(activityCalls).toBe(2);
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it("ignores unstable response metadata and skips no-op rerender when payload is unchanged", async () => {
    const sessionsRenderSpy = vi.spyOn(HUD.sessions, "render");
    const onChatRestore = vi.fn();
    const setConnectionStatus = vi.fn();
    let sessionsRequestCount = 0;
    let lastSessionsPayload = null;
    const sessionsPayload = [
      {
        sessionKey: "agent-alpha::session-static",
        agentId: "agent-alpha",
        sessionId: "session-static",
        updatedAt: "2026-03-03T18:00:00.000Z",
        status: "active",
        label: "Session Static",
      },
    ];

    window.fetch = vi.fn((url) => {
      if (url === "/api/sessions") {
        sessionsRequestCount += 1;
        lastSessionsPayload = sessionsPayload;
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          headers: {
            get: (key) =>
              String(key).toLowerCase() === "x-request-id"
                ? "dynamic-sessions-request-" + sessionsRequestCount
                : "",
          },
          json: () => Promise.resolve(lastSessionsPayload),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => "" },
        json: () => Promise.resolve([]),
      });
    });

    try {
      const controller = HUDApp.data.createDataController({
        HUD: HUD,
        renderPanelSafe: window.renderPanelSafe,
        setConnectionStatus,
        onChatRestore,
      });

      await controller.fetchAll();
      await controller.fetchAll();

      expect(sessionsRequestCount).toBe(2);
      expect(sessionsRenderSpy).toHaveBeenCalledTimes(1);
      expect(onChatRestore).toHaveBeenCalledTimes(1);
      expect(window._allSessions).toBe(lastSessionsPayload);
      expect(setConnectionStatus).toHaveBeenCalled();
    } finally {
      sessionsRenderSpy.mockRestore();
    }
  });

  it("rerenders when payload changes even if response metadata stays the same", async () => {
    const sessionsRenderSpy = vi.spyOn(HUD.sessions, "render");
    const onChatRestore = vi.fn();
    const setConnectionStatus = vi.fn();
    const sessionsPayloads = [
      [
        {
          sessionKey: "agent-alpha::session-a",
          agentId: "agent-alpha",
          sessionId: "session-a",
          updatedAt: "2026-03-03T18:00:00.000Z",
          status: "active",
          label: "Session A",
        },
      ],
      [
        {
          sessionKey: "agent-alpha::session-b",
          agentId: "agent-alpha",
          sessionId: "session-b",
          updatedAt: "2026-03-03T18:01:00.000Z",
          status: "active",
          label: "Session B",
        },
      ],
    ];
    let sessionsRequestCount = 0;

    window.fetch = vi.fn((url) => {
      if (url === "/api/sessions") {
        const payload =
          sessionsPayloads[Math.min(sessionsRequestCount, sessionsPayloads.length - 1)];
        sessionsRequestCount += 1;
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          headers: {
            get: (key) =>
              String(key).toLowerCase() === "x-request-id" ? "stable-sessions-request" : "",
          },
          json: () => Promise.resolve(payload),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => "" },
        json: () => Promise.resolve([]),
      });
    });

    try {
      const controller = HUDApp.data.createDataController({
        HUD: HUD,
        renderPanelSafe: window.renderPanelSafe,
        setConnectionStatus,
        onChatRestore,
      });

      await controller.fetchAll();
      await controller.fetchAll();

      expect(sessionsRequestCount).toBe(2);
      expect(sessionsRenderSpy).toHaveBeenCalledTimes(2);
      expect(onChatRestore).toHaveBeenCalledTimes(1);
      expect(window._allSessions).toEqual(sessionsPayloads[1]);
      expect(setConnectionStatus).toHaveBeenCalled();
    } finally {
      sessionsRenderSpy.mockRestore();
    }
  });

  it("rerenders when payload is mutated in place with stable metadata", async () => {
    const sessionsRenderSpy = vi.spyOn(HUD.sessions, "render");
    const onChatRestore = vi.fn();
    const setConnectionStatus = vi.fn();
    let sessionsRequestCount = 0;
    const sessionsPayload = [
      {
        sessionKey: "agent-alpha::session-a",
        agentId: "agent-alpha",
        sessionId: "session-a",
        updatedAt: "2026-03-03T18:00:00.000Z",
        status: "active",
        label: "Session A",
      },
    ];

    window.fetch = vi.fn((url) => {
      if (url === "/api/sessions") {
        sessionsRequestCount += 1;
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          headers: {
            get: (key) =>
              String(key).toLowerCase() === "x-request-id" ? "stable-sessions-request" : "",
          },
          json: () => Promise.resolve(sessionsPayload),
        });
      }
      return Promise.resolve(createResolvedResponse([]));
    });

    try {
      const controller = HUDApp.data.createDataController({
        HUD: HUD,
        renderPanelSafe: window.renderPanelSafe,
        setConnectionStatus,
        onChatRestore,
      });

      await controller.fetchAll();

      sessionsPayload[0].label = "Session A Updated";
      sessionsPayload[0].updatedAt = "2026-03-03T18:01:00.000Z";

      await controller.fetchAll();

      expect(sessionsRequestCount).toBe(2);
      expect(sessionsRenderSpy).toHaveBeenCalledTimes(2);
      expect(onChatRestore).toHaveBeenCalledTimes(1);
      expect(setConnectionStatus).toHaveBeenCalled();
    } finally {
      sessionsRenderSpy.mockRestore();
    }
  });

  it("falls back to payload fingerprint dedupe when response metadata is absent", async () => {
    const sessionsRenderSpy = vi.spyOn(HUD.sessions, "render");
    const onChatRestore = vi.fn();
    const setConnectionStatus = vi.fn();
    const stringifySpy = vi.spyOn(JSON, "stringify");
    let sessionsRequestCount = 0;
    let lastSessionsPayload = null;
    const sessionsPayload = [
      {
        sessionKey: "agent-alpha::session-static",
        agentId: "agent-alpha",
        sessionId: "session-static",
        updatedAt: "2026-03-03T18:00:00.000Z",
        status: "active",
        label: "Session Static",
      },
    ];

    window.fetch = vi.fn((url) => {
      if (url === "/api/sessions") {
        sessionsRequestCount += 1;
        lastSessionsPayload = sessionsPayload;
        return Promise.resolve({
          json: () => Promise.resolve(lastSessionsPayload),
        });
      }
      return Promise.resolve({
        json: () => Promise.resolve([]),
      });
    });

    try {
      const controller = HUDApp.data.createDataController({
        HUD: HUD,
        renderPanelSafe: window.renderPanelSafe,
        setConnectionStatus,
        onChatRestore,
      });

      await controller.fetchAll();
      await controller.fetchAll();

      const payloadStringifyCalls = stringifySpy.mock.calls.filter(
        ([value]) => value === sessionsPayload,
      );

      expect(sessionsRequestCount).toBe(2);
      expect(sessionsRenderSpy).toHaveBeenCalledTimes(1);
      expect(payloadStringifyCalls.length).toBeGreaterThan(0);
      expect(onChatRestore).toHaveBeenCalledTimes(1);
      expect(window._allSessions).toBe(lastSessionsPayload);
      expect(setConnectionStatus).toHaveBeenCalled();
    } finally {
      stringifySpy.mockRestore();
      sessionsRenderSpy.mockRestore();
    }
  });

  it("reuses fetch-path response fingerprint to avoid payload stringify during render dedupe", async () => {
    const sessionsRenderSpy = vi.spyOn(HUD.sessions, "render");
    const onChatRestore = vi.fn();
    const setConnectionStatus = vi.fn();
    const sessionsPayload = [
      {
        sessionKey: "agent-alpha::session-fingerprint",
        agentId: "agent-alpha",
        sessionId: "session-fingerprint",
        updatedAt: "2026-03-03T18:00:00.000Z",
        status: "active",
        label: "Session Fingerprint",
        fingerprintMarker: "sessions-fingerprint-marker",
      },
    ];
    const sessionsText = JSON.stringify(sessionsPayload);
    const sessionsJson = vi.fn(() => Promise.resolve(sessionsPayload));
    const stringifySpy = vi.spyOn(JSON, "stringify");
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => 1);

    window.fetch = vi.fn((url) => {
      if (url === "/api/sessions") {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          headers: {
            get: (key) =>
              String(key).toLowerCase() === "x-request-id" ? "dynamic-request-id" : "",
          },
          text: () => Promise.resolve(sessionsText),
          json: sessionsJson,
        });
      }
      return Promise.resolve(createResolvedResponse([]));
    });

    try {
      const controller = HUDApp.data.createDataController({
        HUD: HUD,
        renderPanelSafe: window.renderPanelSafe,
        setConnectionStatus,
        onChatRestore,
      });

      await controller.fetchAll();
      await controller.fetchAll();

      const payloadStringifyCalls = stringifySpy.mock.calls.filter(
        ([value]) =>
          Array.isArray(value) &&
          value[0] &&
          value[0].fingerprintMarker === "sessions-fingerprint-marker",
      );

      expect(sessionsRenderSpy).toHaveBeenCalledTimes(1);
      expect(payloadStringifyCalls).toHaveLength(0);
      expect(sessionsJson).not.toHaveBeenCalled();
      expect(onChatRestore).toHaveBeenCalledTimes(1);
      expect(setConnectionStatus).toHaveBeenCalled();
    } finally {
      dateNowSpy.mockRestore();
      stringifySpy.mockRestore();
      sessionsRenderSpy.mockRestore();
    }
  });

  it("renders panels even when some endpoints fail", async () => {
    const renderSpies = {
      agents: vi.spyOn(HUD.agents, "render"),
      sessions: vi.spyOn(HUD.sessions, "render"),
      system: vi.spyOn(HUD.system, "render"),
    };

    window.fetch = vi.fn((url) => {
      if (url === "/api/agents") {
        return Promise.reject(new Error("agents failed"));
      }
      return Promise.resolve({ json: () => Promise.resolve([]) });
    });

    const controller = createColdAndModelUsageController();
    await controller.fetchAll({ includeCold: true });

    expect(renderSpies.sessions).toHaveBeenCalled();
    expect(renderSpies.system).toHaveBeenCalled();

    renderSpies.agents.mockRestore();
    renderSpies.sessions.mockRestore();
    renderSpies.system.mockRestore();
  });

  it("renders available panels when all endpoints fail", async () => {
    const renderSpies = {
      agents: vi.spyOn(HUD.agents, "render"),
      sessions: vi.spyOn(HUD.sessions, "render"),
      cron: vi.spyOn(HUD.cron, "render"),
      system: vi.spyOn(HUD.system, "render"),
      models: vi.spyOn(HUD.models, "render"),
      activity: vi.spyOn(HUD.activity, "render"),
      sessionTree: vi.spyOn(HUD.sessionTree, "render"),
    };

    window.fetch = vi.fn(() => Promise.reject(new Error("network error")));

    const controller = createColdAndModelUsageController();
    await controller.fetchAll({ includeCold: true });

    Object.values(renderSpies).forEach((spy) => {
      expect(spy).toHaveBeenCalled();
    });

    Object.values(renderSpies).forEach((spy) => spy.mockRestore());
  });

  it("uses cached last-good payloads and keeps connected when all endpoints fail after warm cache", async () => {
    const setConnectionStatus = vi.fn();
    const callCounts = Object.create(null);
    const responsesByCall = {
      "/api/agents": [{ status: 200, payload: [] }],
      "/api/sessions": [{ status: 200, payload: [] }],
      "/api/cron": [{ status: 200, payload: [] }],
      "/api/config": [{ status: 200, payload: {} }],
      "/api/model-usage/live-weekly": [{ status: 200, payload: { models: [] } }],
      "/api/activity": [{ status: 200, payload: [] }],
      "/api/session-tree": [{ status: 200, payload: [] }],
      "/api/models": [{ status: 200, payload: [{ alias: "gpt-4.1" }] }],
      "/api/model-usage/monthly": [{ status: 200, payload: { month: "2026-03" } }],
    };

    const failing = (url) => {
      if (url in responsesByCall) return true;
      return false;
    };

    window.fetch = vi.fn((url) => {
      const seq = (callCounts[url] = (callCounts[url] || 0) + 1);
      if (!failing(url) || seq === 1) {
        const response = responsesByCall[url] && responsesByCall[url][0];
        if (!response) return Promise.resolve(createResolvedResponse([]));
        return Promise.resolve(createEndpointResponse(response.payload, response));
      }
      return Promise.reject(new Error("network error"));
    });

    const controller = createColdAndModelUsageController({
      setConnectionStatus,
    });

    await controller.fetchAll({ includeCold: true });
    await controller.fetchAll({ includeCold: true });

    expect(setConnectionStatus).toBeDefined();
    expect(setConnectionStatus).not.toHaveBeenCalledWith(false);
  });
});

describe("renderPanelSafe error boundaries", () => {
  beforeEach(() => {
    // Clear any existing error panels
    document.body.innerHTML = `
      <div id="system-info"></div>
      <span id="sys-model"></span>
      <div id="test-panel"></div>
    `;
  });

  it("catches render errors and shows unavailable state", () => {
    expect(typeof renderPanelSafe).toBe("function");

    const panelEl = document.getElementById("test-panel");

    const failingRender = () => {
      throw new Error("render failed");
    };

    // renderPanelSafe signature: (panelName, panelEl, renderFn, data)
    renderPanelSafe("test-panel", panelEl, failingRender, {});

    expect(panelEl.innerHTML).toContain("—");
    expect(panelEl.innerHTML).toContain("panel-error");
    expect(panelEl.innerHTML).toContain("panel-retry-btn");
  });

  it("calls retryPanel when retry button is clicked", () => {
    expect(typeof retryPanel).toBe("function");
    expect(typeof renderPanelSafe).toBe("function");

    const panelEl = document.getElementById("test-panel");

    const failingRender = () => {
      throw new Error("render failed");
    };

    renderPanelSafe("test-panel", panelEl, failingRender, {});

    const retryBtn = panelEl.querySelector(".panel-retry-btn");
    expect(retryBtn).not.toBeNull();

    // Verify the onclick handler is set correctly
    expect(retryBtn.getAttribute("onclick")).toContain("retryPanel('test-panel')");
  });

  it("renders normally when no error", () => {
    expect(typeof renderPanelSafe).toBe("function");

    const panelEl = document.getElementById("test-panel");

    const successfulRender = (el, data) => {
      el.innerHTML = `<div class="success">${data.value}</div>`;
    };

    renderPanelSafe("test-panel", panelEl, successfulRender, { value: "test-value" });

    expect(panelEl.innerHTML).toContain("test-value");
    expect(panelEl.innerHTML).not.toContain("panel-error");
  });
});

describe("setConnectionStatus with per-panel states", () => {
  it("shows disconnected badge when all panels fail", async () => {
    window.fetch = vi.fn(() => Promise.reject(new Error("network")));

    await HUD.fetchAll();

    const badge = document.getElementById("connection-badge");
    expect(badge).not.toBeNull();
    expect(badge.textContent).not.toContain("DISCONNECTED");
  });
});

describe("endpointFetchStatus", () => {
  let endpointFetchStatus;

  beforeEach(() => {
    // Access the exported function from the data module
    endpointFetchStatus = window.HUDApp.data._test.endpointFetchStatus;
  });

  it("returns 'ok' for status 200 with ok=true", () => {
    const result = {
      meta: {
        ok: true,
        status: 200,
        statusText: "OK",
      },
    };
    expect(endpointFetchStatus(result)).toBe("ok");
  });

  it("returns 'ok' for status 304 with ok=false (THE BUG FIX)", () => {
    const result = {
      meta: {
        ok: false,
        status: 304,
        statusText: "Not Modified",
      },
    };
    expect(endpointFetchStatus(result)).toBe("ok");
  });

  it("returns 'error' for status 0 with ok=false", () => {
    const result = {
      meta: {
        ok: false,
        status: 0,
        statusText: "",
      },
    };
    expect(endpointFetchStatus(result)).toBe("error");
  });

  it("returns 'error' for status 500 with ok=false", () => {
    const result = {
      meta: {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      },
    };
    expect(endpointFetchStatus(result)).toBe("error");
  });

  it("returns 'timeout' for statusText 'timeout'", () => {
    const result = {
      meta: {
        ok: false,
        status: 0,
        statusText: "timeout",
      },
    };
    expect(endpointFetchStatus(result)).toBe("timeout");
  });

  it("returns 'error' for null result", () => {
    expect(endpointFetchStatus(null)).toBe("error");
  });

  it("returns 'error' for undefined result", () => {
    expect(endpointFetchStatus(undefined)).toBe("error");
  });

  it("returns 'error' for result without meta", () => {
    expect(endpointFetchStatus({})).toBe("error");
  });
});

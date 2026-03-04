// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// Set up the full DOM that app.js expects
document.body.innerHTML = `
  <header></header>
  <span id="stat-uptime"></span>
  <span id="clock"></span>
  <div id="toast" class="toast"></div>
  <div id="spawn-modal"><button id="open-spawn-btn"></button><button id="spawn-cancel-btn"></button><button id="spawn-modal-close"></button><button id="spawn-launch-btn"></button></div>
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
// Mock makeFocusable for keyboard accessibility
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
const openChatPaneMock = vi.fn();
window.openChatPane = openChatPaneMock;

function createResolvedResponse(payload) {
  return {
    json: () => Promise.resolve(payload),
  };
}

const initialFetch = vi.fn(() => Promise.resolve(createResolvedResponse([])));
window.fetch = initialFetch;

beforeEach(() => {
  window.fetch = vi.fn(() => Promise.resolve(createResolvedResponse([])));
});

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
function getLatestWs() {
  return createdSockets[createdSockets.length - 1];
}

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, "localStorage", { value: localStorageMock });

// Load utilities and shared modules first
await import("../../public/utils.js");
await import("../../public/label-sanitizer.js");
await import("../../public/session-labels.js");
await import("../../public/chat-sender-resolver.js");
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
// Load panels before app runtime (app bootstrap initializes panel modules)
await import("../../public/panels/activity.js");
await import("../../public/panels/sessions.js");
await import("../../public/panels/agents.js");
await import("../../public/panels/cron.js");
await import("../../public/panels/models.js");
await import("../../public/panels/session-tree.js");
await import("../../public/panels/system.js");
await import("../../public/panels/spawn.js");
// Load app runtime modules before facade
await import("../../public/app/diagnostics.js");
await import("../../public/app/status.js");
await import("../../public/app/ui.js");
await import("../../public/app/data.js");
await import("../../public/app/polling.js");
await import("../../public/app/ws.js");
await import("../../public/app/bootstrap.js");
await import("../../public/app.js");
// Load chat pane modules after facade to mirror index.html load order
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
const restoreSavedChatSessionSpy = vi.spyOn(window, "restoreSavedChatSession");

describe("app.js initialization", () => {
  it("sets up HUD.fetchAll", () => {
    expect(typeof HUD.fetchAll).toBe("function");
  });

  it("sets up HUD.showToast", () => {
    expect(typeof HUD.showToast).toBe("function");
  });

  it("calls fetch on initialization", () => {
    expect(initialFetch).toHaveBeenCalled();
  });

  it("creates WebSocket connection", () => {
    expect(window.WebSocket).toHaveBeenCalled();
  });

  it("remains stable when #new-session-btn is absent", () => {
    expect(document.getElementById("new-session-btn")).toBeNull();
    expect(typeof HUD.spawn.init).toBe("function");
  });
});

describe("showToast", () => {
  it("shows toast message", () => {
    HUD.showToast("Test message");
    const toast = document.getElementById("toast");
    expect(toast.textContent).toBe("Test message");
  });

  it("adds error class for error toast", () => {
    HUD.showToast("Error!", true);
    const toast = document.getElementById("toast");
    expect(toast.className).toContain("error");
  });
});

describe("clock and uptime", () => {
  it("updates uptime display", async () => {
    await new Promise((r) => setTimeout(r, 50));
    const uptime = document.getElementById("stat-uptime").textContent;
    expect(uptime).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it("updates clock display", async () => {
    await new Promise((r) => setTimeout(r, 50));
    const clock = document.getElementById("clock").textContent;
    expect(clock.length).toBeGreaterThan(0);
  });
});

function uptimeToSeconds(text) {
  const parts = String(text || "")
    .split(":")
    .map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return -1;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

describe("gateway runtime uptime", () => {
  it("uses gateway-status uptimeMs instead of page-open uptime", async () => {
    const ws = getLatestWs();
    if (ws.onmessage) {
      ws.onmessage({
        data: JSON.stringify({
          type: "gateway-status",
          status: "connected",
          uptimeMs: 5 * 60 * 1000,
        }),
      });
    }

    await new Promise((r) => setTimeout(r, 25));
    const uptime = document.getElementById("stat-uptime").textContent;
    expect(uptimeToSeconds(uptime)).toBe(300);
  });

  it("increments from the latest gateway uptime snapshot", async () => {
    const ws = getLatestWs();
    if (ws.onmessage) {
      ws.onmessage({
        data: JSON.stringify({
          type: "gateway-status",
          status: "connected",
          uptimeMs: 2000,
        }),
      });
    }

    await new Promise((r) => setTimeout(r, 25));
    const before = uptimeToSeconds(document.getElementById("stat-uptime").textContent);

    await new Promise((r) => setTimeout(r, 2200));
    const after = uptimeToSeconds(document.getElementById("stat-uptime").textContent);

    expect(before).toBe(2);
    expect(after).toBeGreaterThanOrEqual(before + 1);
  });

  it("resets baseline when a new gateway uptime arrives after reconnect", async () => {
    const ws = getLatestWs();

    if (ws.onmessage) {
      ws.onmessage({
        data: JSON.stringify({
          type: "gateway-status",
          status: "connected",
          uptimeMs: 11 * 60 * 1000,
        }),
      });
    }

    await new Promise((r) => setTimeout(r, 25));
    expect(uptimeToSeconds(document.getElementById("stat-uptime").textContent)).toBe(660);

    if (ws.onmessage) {
      ws.onmessage({
        data: JSON.stringify({
          type: "gateway-status",
          status: "disconnected",
        }),
      });
      ws.onmessage({
        data: JSON.stringify({
          type: "gateway-status",
          status: "connected",
          uptimeMs: 4000,
        }),
      });
    }

    await new Promise((r) => setTimeout(r, 25));
    expect(uptimeToSeconds(document.getElementById("stat-uptime").textContent)).toBe(4);
  });
});

describe("event delegation", () => {
  beforeEach(() => {
    window.openChatPane = openChatPaneMock;
    openChatPaneMock.mockClear();
  });

  it("opens cron editor on cron row click", () => {
    // Render a cron job first
    HUD.cron.render({
      jobs: [
        {
          id: "j1",
          name: "Test",
          enabled: true,
          schedule: { expr: "* * * * *" },
          state: {},
        },
      ],
    });
    const cronRow = document.querySelector("[data-cron-id]");
    expect(cronRow).not.toBeNull();
    cronRow.click();
    expect(document.getElementById("cron-modal").classList.contains("active")).toBe(true);
  });

  it("shows agent sessions on agent card click", () => {
    const now = Date.now();
    window._allSessions = [
      {
        agentId: "bot1",
        sessionId: "s1",
        sessionKey: "agent:bot1:s1",
        status: "active",
        updatedAt: now,
      },
    ];
    HUD.agents.render([
      { id: "bot1", sessions: [{ updatedAt: now }], sessionCount: 1, activeSessions: 1 },
    ]);
    const card = document.querySelector("[data-agent-id]");
    expect(card).not.toBeNull();
    card.click();
  });

  it("handles tree node click for chat", () => {
    const now = Date.now();
    HUD.sessionTree.render([
      {
        key: "k1",
        sessionKey: "agent:a:s1",
        agentId: "a",
        sessionId: "s1",
        status: "active",
        updatedAt: now,
        label: "test",
      },
    ]);
    const treeNode = document.querySelector("[data-tree-key]");
    expect(treeNode).not.toBeNull();
    treeNode.click();
    expect(openChatPaneMock).toHaveBeenCalledWith("a", "s1", "test", "agent:a:s1");
  });

  it("forwards canonical session key when clicking session row", () => {
    const now = Date.now();
    HUD.sessions.render([
      {
        key: "agent:a:main",
        sessionKey: "agent:a:main",
        agentId: "a",
        sessionId: "internal-session-1",
        status: "active",
        updatedAt: now,
        label: "main",
      },
    ]);
    const row = document.querySelector(".session-row");
    expect(row).not.toBeNull();
    row.click();
    expect(openChatPaneMock).toHaveBeenCalledWith(
      "a",
      "internal-session-1",
      "main",
      "agent:a:main",
    );
  });

  it("handles tree toggle click", () => {
    const now = Date.now();
    HUD.sessionTree.render([
      {
        key: "parent",
        sessionKey: "agent:a:parent",
        agentId: "a",
        sessionId: "p",
        status: "active",
        updatedAt: now,
        label: "P",
      },
      {
        key: "child",
        sessionKey: "agent:a:child",
        agentId: "a",
        sessionId: "c",
        status: "active",
        updatedAt: now,
        label: "C",
        spawnedBy: "parent",
      },
    ]);
    const toggle = document.querySelector("[data-toggle-key]");
    if (toggle) toggle.click();
  });
});

describe("modal close on Escape", () => {
  it("closes spawn modal on escape", () => {
    HUD.spawn.open();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.getElementById("spawn-modal").classList.contains("active")).toBe(false);
  });
});

describe("fetch error handling", () => {
  it("handles fetch failure in fetchAll", async () => {
    const { controller, HUD } = createDataControllerHarness({
      fetchImpl: vi.fn(() => Promise.reject(new Error("network"))),
    });
    await controller.fetchAll();
    expect(HUD.agents.render).toHaveBeenCalled();
  });
});

describe("chat restore integration", () => {
  it("does not duplicate saved-session restore on subsequent fetchAll polls", async () => {
    await HUD.fetchAll();
    const afterFirstPoll = restoreSavedChatSessionSpy.mock.calls.length;
    await HUD.fetchAll();
    await HUD.fetchAll();
    expect(restoreSavedChatSessionSpy.mock.calls.length).toBe(afterFirstPoll);
  });
});

describe("WebSocket lifecycle", () => {
  it("reconnects after pre-open failure and flushes queued chat messages", () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const firstWs = getLatestWs();
    const timeoutsBefore = setTimeoutSpy.mock.calls.length;

    window._hudWs = null;
    window.ChatState.sendWs({ type: "chat-history", sessionKey: "agent:a:s" });

    firstWs.readyState = window.WebSocket.CONNECTING;
    if (firstWs.onerror) firstWs.onerror(new Error("connect failed"));
    if (firstWs.onclose) firstWs.onclose();

    const timeoutsAfter = setTimeoutSpy.mock.calls.length;
    expect(timeoutsAfter - timeoutsBefore).toBe(1);
    const reconnectTimer = setTimeoutSpy.mock.calls[timeoutsAfter - 1];
    reconnectTimer[0]();

    const reconnectWs = getLatestWs();
    expect(reconnectWs).not.toBe(firstWs);
    reconnectWs.readyState = window.WebSocket.OPEN;
    if (reconnectWs.onopen) reconnectWs.onopen();

    expect(reconnectWs.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "chat-history", sessionKey: "agent:a:s" }),
    );
    setTimeoutSpy.mockRestore();
  });

  it("handles onopen", () => {
    const ws = getLatestWs();
    const flushQueue = vi.fn();
    window._flushChatWsQueue = flushQueue;
    ws.readyState = window.WebSocket.OPEN;
    if (ws.onopen) ws.onopen();
    expect(flushQueue).toHaveBeenCalled();
  });

  it("handles tick message", () => {
    const callsBefore = window.fetch.mock.calls.length;
    const ws = getLatestWs();
    if (ws.onmessage) ws.onmessage({ data: JSON.stringify({ type: "tick" }) });
    expect(window.fetch.mock.calls.length).toBeGreaterThanOrEqual(callsBefore);
  });

  it("handles log-entry message", () => {
    const chatMessageSpy = vi.spyOn(window, "handleChatWsMessage").mockImplementation(() => {});
    const ws = getLatestWs();
    if (ws.onmessage) ws.onmessage({ data: JSON.stringify({ type: "log-entry", entry: {} }) });
    expect(chatMessageSpy).toHaveBeenCalledWith({ type: "log-entry", entry: {} });
    chatMessageSpy.mockRestore();
  });

  it("handles onclose", () => {
    const ws = getLatestWs();
    window._hudWs = ws;
    if (ws.onclose) ws.onclose();
    expect(window._hudWs).toBeNull();
  });

  it("handles onerror", () => {
    const ws = getLatestWs();
    const badge = document.getElementById("connection-badge");
    if (ws.onerror) ws.onerror();
    expect(badge).not.toBeNull();
    expect(badge.textContent).toContain("DISCONNECTED");
  });
});

describe("WebSocket reconnection after successful connection", () => {
  let setTimeoutSpy;
  let clearTimeoutSpy;

  beforeEach(() => {
    setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    // Reset the global WS state - need to simulate open to clear any existing reconnect timer
    // The onopen handler calls clearWsReconnectTimer(), so we need _hudWs to be set
    const ws = getLatestWs();
    if (ws) {
      window._hudWs = ws;
      ws.readyState = window.WebSocket.OPEN;
      if (ws.onopen) ws.onopen();
    }
    window._hudWs = null;
  });

  afterEach(() => {
    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });

  it("schedules reconnection when WebSocket closes after being open", () => {
    const ws = getLatestWs();

    // Ensure _hudWs is set so onopen will process and clear any pending timer
    window._hudWs = ws;

    // Simulate successful open (ws was previously opened)
    ws.readyState = window.WebSocket.OPEN;
    if (ws.onopen) ws.onopen();

    // Clear previous reconnect timers from initial connection
    setTimeoutSpy.mockClear();

    // Trigger onclose - should schedule reconnection even though WS was previously opened
    if (ws.onclose) ws.onclose({ code: 1006, reason: "", wasClean: false });

    // Should have scheduled a reconnection timer
    expect(setTimeoutSpy).toHaveBeenCalled();

    // The delay should be the short post-open reconnect delay (around 2 seconds)
    const reconnectDelay = setTimeoutSpy.mock.calls[0][1];
    expect(reconnectDelay).toBeGreaterThanOrEqual(1500); // ~2s with some tolerance
    expect(reconnectDelay).toBeLessThan(3000);
  });

  it("uses appropriate delay for post-open disconnect", () => {
    const ws = getLatestWs();

    // Ensure _hudWs is set
    window._hudWs = ws;

    // Simulate successful open (this sets wsEverOpened = true)
    ws.readyState = window.WebSocket.OPEN;
    if (ws.onopen) ws.onopen();

    // Now close after being open - should use post-open delay (~2000ms)
    setTimeoutSpy.mockClear();
    if (ws.onclose) ws.onclose({ code: 1006, reason: "", wasClean: false });

    const postOpenDelay = setTimeoutSpy.mock.calls[0][1];

    // Post-open should be around 2000ms
    expect(postOpenDelay).toBeGreaterThanOrEqual(1500);
    expect(postOpenDelay).toBeLessThan(3000);
  });

  it("does not stack reconnection timers on multiple rapid closes", () => {
    const ws = getLatestWs();

    // Ensure _hudWs is set
    window._hudWs = ws;

    // First, simulate successful connection
    ws.readyState = window.WebSocket.OPEN;
    if (ws.onopen) ws.onopen();

    // Clear the timers from the successful connection
    setTimeoutSpy.mockClear();

    // Close the WebSocket
    if (ws.onclose) ws.onclose({ code: 1006, reason: "", wasClean: false });

    // Should have exactly one reconnection timer scheduled
    const timersAfterFirstClose = setTimeoutSpy.mock.calls.length;
    expect(timersAfterFirstClose).toBe(1);

    // Try to trigger another close (simulating rapid disconnect)
    if (ws.onclose) ws.onclose({ code: 1006, reason: "", wasClean: false });

    // Should still have only one timer (no stacking)
    expect(setTimeoutSpy.mock.calls.length).toBe(1);

    // Fire the reconnection
    const reconnectFn = setTimeoutSpy.mock.calls[0][0];
    reconnectFn();

    // After reconnection fires, another close should schedule a new timer
    setTimeoutSpy.mockClear();
    const newWs = getLatestWs();
    window._hudWs = newWs;
    newWs.readyState = window.WebSocket.OPEN;
    if (newWs.onopen) newWs.onopen();
    if (newWs.onclose) newWs.onclose({ code: 1006, reason: "", wasClean: false });

    expect(setTimeoutSpy).toHaveBeenCalled();
  });

  it("resets reconnect attempts after successful reconnection", async () => {
    const ws = getLatestWs();

    // Ensure _hudWs is set
    window._hudWs = ws;

    // Simulate successful connection
    ws.readyState = window.WebSocket.OPEN;
    if (ws.onopen) ws.onopen();

    // Close it to trigger first reconnection
    setTimeoutSpy.mockClear();
    if (ws.onclose) ws.onclose({ code: 1006, reason: "", wasClean: false });
    const firstDelay = setTimeoutSpy.mock.calls[0][1];

    // Fire the reconnection
    const reconnectFn = setTimeoutSpy.mock.calls[0][0];
    reconnectFn();

    // Create new WS and open it (successful reconnection)
    const newWs = getLatestWs();
    window._hudWs = newWs;
    newWs.readyState = window.WebSocket.OPEN;
    if (newWs.onopen) newWs.onopen();

    // Close again - should use the short delay, not a longer backoff
    setTimeoutSpy.mockClear();
    if (newWs.onclose) newWs.onclose({ code: 1006, reason: "", wasClean: false });
    const secondDelay = setTimeoutSpy.mock.calls[0][1];

    // Both delays should be similar (both using short reconnect delay)
    // The second shouldn't have accumulated backoff from the first
    expect(secondDelay).toBeLessThan(3000);
  });
});

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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

function createDataControllerHarness(options = {}) {
  const doc = document.implementation.createHTMLDocument("hud-data-controller-test");
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
  const setConnectionStatus = vi.fn();
  const onChatRestore = vi.fn();
  const renderPanelSafe = vi.fn((panelName, panelEl, renderFn, data) => {
    renderFn(panelEl, data);
  });

  const controller = window.HUDApp.data.createDataController({
    document: doc,
    HUD,
    getFetch: () => options.fetchImpl,
    renderPanelSafe,
    setConnectionStatus,
    onChatRestore,
    endpointTimeoutMs: options.endpointTimeoutMs ?? 1000,
  });

  return {
    controller,
    HUD,
    setConnectionStatus,
    onChatRestore,
    renderPanelSafe,
  };
}

function flushAsyncWork() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("data controller progressive endpoint loading", () => {
  it("coalesces overlapping fetchAll calls into one in-flight cycle", async () => {
    const deferredByUrl = {
      "/api/agents": createDeferred(),
      "/api/sessions": createDeferred(),
      "/api/cron": createDeferred(),
      "/api/config": createDeferred(),
      "/api/model-usage/live-weekly": createDeferred(),
      "/api/activity": createDeferred(),
      "/api/session-tree": createDeferred(),
      "/api/models": createDeferred(),
      "/api/model-usage/monthly": createDeferred(),
    };

    const fetchImpl = vi.fn((url) => {
      const pending = deferredByUrl[url];
      if (pending) {
        return pending.promise;
      }
      return Promise.resolve(createMockJsonResponse([]));
    });

    const { controller } = createDataControllerHarness({
      fetchImpl,
      endpointTimeoutMs: 50,
    });

    const first = controller.fetchAll({ includeCold: true });
    await flushAsyncWork();
    const second = controller.fetchAll();

    const initialRequestedEndpoints = [
      "/api/agents",
      "/api/sessions",
      "/api/cron",
      "/api/config",
      "/api/model-usage/live-weekly",
      "/api/activity",
      "/api/session-tree",
      "/api/models",
    ];

    initialRequestedEndpoints.forEach(function (url) {
      expect(fetchImpl).toHaveBeenCalledWith(url, expect.any(Object));
    });
    expect(fetchImpl).toHaveBeenCalledTimes(initialRequestedEndpoints.length);

    deferredByUrl["/api/agents"].resolve(createMockJsonResponse([]));
    deferredByUrl["/api/sessions"].resolve(createMockJsonResponse([]));
    deferredByUrl["/api/cron"].resolve(createMockJsonResponse([]));
    deferredByUrl["/api/config"].resolve(createMockJsonResponse({}));
    deferredByUrl["/api/model-usage/live-weekly"].resolve(createMockJsonResponse([]));
    deferredByUrl["/api/activity"].resolve(createMockJsonResponse([]));
    deferredByUrl["/api/session-tree"].resolve(createMockJsonResponse([]));
    deferredByUrl["/api/models"].resolve(createMockJsonResponse([]));
    deferredByUrl["/api/model-usage/monthly"].resolve(createMockJsonResponse({}));

    await first;
    await second;

    expect(fetchImpl).toHaveBeenCalledWith("/api/model-usage/monthly", expect.any(Object));
    expect(fetchImpl).toHaveBeenCalledTimes(initialRequestedEndpoints.length + 1);
  });

  it("coalesces concurrent endpoint fetches through the endpoint in-flight map", async () => {
    const deferred = createDeferred();
    const fetchImpl = vi.fn(() => deferred.promise);
    const { controller } = createDataControllerHarness({
      fetchImpl,
      endpointTimeoutMs: 50,
    });

    const first = controller._test.fetchEndpoint("sessions", "/api/sessions");
    const second = controller._test.fetchEndpoint("sessions", "/api/sessions");

    await flushAsyncWork();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    deferred.resolve(createMockJsonResponse([]));
    await first;
    await second;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fetches cold model endpoints less frequently than hot endpoints", async () => {
    let now = 0;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const endpointCalls = [];
    const fetchImpl = vi.fn((url) => {
      endpointCalls.push(url);
      return Promise.resolve(createMockJsonResponse([]));
    });

    const { controller } = createDataControllerHarness({
      fetchImpl,
      endpointTimeoutMs: 20,
    });

    await controller.fetchAll({ includeCold: true });
    const firstCycleLength = endpointCalls.length;
    expect(endpointCalls).toContain("/api/models");
    expect(endpointCalls).toContain("/api/model-usage/monthly");

    now = 30 * 1000;
    await controller.fetchAll();

    const secondCycleCalls = endpointCalls.slice(firstCycleLength);
    expect(secondCycleCalls).not.toContain("/api/models");
    expect(secondCycleCalls).not.toContain("/api/model-usage/monthly");

    now = 90 * 1000;
    await controller.fetchAll({ includeCold: true });

    const thirdCycleCalls = endpointCalls.slice(firstCycleLength + secondCycleCalls.length);
    expect(thirdCycleCalls).toContain("/api/models");
    expect(thirdCycleCalls).toContain("/api/model-usage/monthly");

    dateNowSpy.mockRestore();
  });

  it("does not re-render model panel when monthly payload is unchanged", async () => {
    const hangingWeekly = new Promise(() => {});
    const weeklyPayload = {
      models: [{ model: "gpt-4", totalCost: 2 }],
      summary: { weekSpend: 2 },
    };
    const monthlyPayload = {
      summary: {
        monthSpend: 50,
        topMonthModel: { model: "gpt-4", totalCost: 50 },
      },
      models: [{ model: "gpt-4", totalCost: 50 }],
    };

    const responseQueues = {
      "/api/agents": [createMockJsonResponse([]), createMockJsonResponse([])],
      "/api/sessions": [createMockJsonResponse([]), createMockJsonResponse([])],
      "/api/cron": [createMockJsonResponse([]), createMockJsonResponse([])],
      "/api/config": [createMockJsonResponse({}), createMockJsonResponse({})],
      "/api/model-usage/live-weekly": [createMockJsonResponse(weeklyPayload), hangingWeekly],
      "/api/activity": [createMockJsonResponse([]), createMockJsonResponse([])],
      "/api/session-tree": [createMockJsonResponse([]), createMockJsonResponse([])],
      "/api/models": [createMockJsonResponse([]), createMockJsonResponse([])],
      "/api/model-usage/monthly": [
        createMockJsonResponse(monthlyPayload),
        createMockJsonResponse(monthlyPayload),
      ],
    };

    const fetchImpl = vi.fn((url) => {
      const queue = responseQueues[url];
      if (!queue || queue.length === 0) {
        return Promise.resolve(createMockJsonResponse([]));
      }
      return Promise.resolve(queue.shift());
    });

    const { controller, HUD } = createDataControllerHarness({
      fetchImpl,
      endpointTimeoutMs: 20,
    });
    const modelsRenderSpy = vi.spyOn(HUD.models, "render");

    await controller.fetchAll({ includeCold: true });
    expect(modelsRenderSpy).toHaveBeenCalledTimes(2);

    await controller.fetchAll({ includeCold: true });

    expect(modelsRenderSpy).toHaveBeenCalledTimes(2);
    modelsRenderSpy.mockRestore();
  });

  it("renders sessions before slow model-usage resolves and keeps one-time chat restore", async () => {
    const endpoints = [
      "/api/agents",
      "/api/sessions",
      "/api/cron",
      "/api/config",
      "/api/model-usage/live-weekly",
      "/api/activity",
      "/api/session-tree",
      "/api/models",
    ];
    const deferredByUrl = Object.fromEntries(endpoints.map((url) => [url, createDeferred()]));
    const fetchImpl = vi.fn((url) => deferredByUrl[url].promise);

    const { controller, HUD, setConnectionStatus, onChatRestore } = createDataControllerHarness({
      fetchImpl,
      endpointTimeoutMs: 500,
    });
    const fetchPromise = controller.fetchAll({ includeCold: true });
    await flushAsyncWork();

    deferredByUrl["/api/sessions"].resolve(
      createMockJsonResponse([{ sessionId: "s1", sessionKey: "agent:a:s1" }]),
    );
    await flushAsyncWork();

    expect(HUD.sessions.render).toHaveBeenCalledTimes(1);
    expect(HUD.models.render).not.toHaveBeenCalled();
    expect(onChatRestore).toHaveBeenCalledTimes(1);
    expect(window._allSessions).toEqual([{ sessionId: "s1", sessionKey: "agent:a:s1" }]);
    expect(setConnectionStatus).toHaveBeenCalledWith(true);

    deferredByUrl["/api/agents"].resolve(createMockJsonResponse([]));
    deferredByUrl["/api/cron"].resolve(createMockJsonResponse([]));
    deferredByUrl["/api/config"].resolve(createMockJsonResponse({}));
    deferredByUrl["/api/activity"].resolve(createMockJsonResponse([]));
    deferredByUrl["/api/session-tree"].resolve(createMockJsonResponse([]));
    deferredByUrl["/api/models"].resolve(createMockJsonResponse([{ alias: "gpt-4.1" }]));
    await flushAsyncWork();

    expect(HUD.agents.render).toHaveBeenCalledTimes(1);
    expect(HUD.models.render).not.toHaveBeenCalled();

    deferredByUrl["/api/model-usage/live-weekly"].resolve(createMockJsonResponse([]));
    await fetchPromise;

    expect(HUD.models.render).toHaveBeenCalledTimes(1);
    expect(window._modelAliases).toEqual([{ alias: "gpt-4.1" }]);
    expect(window._endpointResponseMeta.sessions).toEqual(
      expect.objectContaining({
        ok: true,
        status: 200,
      }),
    );
  });

  it("times out a hung endpoint without blocking other panel renders", async () => {
    const hangingPromise = new Promise(() => {});
    const fetchImpl = vi.fn((url) => {
      if (url === "/api/model-usage/live-weekly") return hangingPromise;
      return Promise.resolve(createMockJsonResponse([]));
    });
    const { controller, HUD, setConnectionStatus } = createDataControllerHarness({
      fetchImpl,
      endpointTimeoutMs: 20,
    });

    const fetchPromise = controller.fetchAll();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(HUD.agents.render).toHaveBeenCalled();
    expect(HUD.sessions.render).toHaveBeenCalled();

    await fetchPromise;

    expect(HUD.models.render).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ statusText: "timeout" }),
    );
    expect(window._endpointResponseMeta["model-usage"]).toEqual(
      expect.objectContaining({
        ok: false,
        status: 0,
        statusText: "timeout",
      }),
    );
    expect(setConnectionStatus).toHaveBeenCalledWith(true);
  });
});

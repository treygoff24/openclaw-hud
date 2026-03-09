// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

window.HUDApp = window.HUDApp || {};
await import("../../public/app/ws.js");

describe("HUDApp.ws.createWsController", () => {
  beforeEach(() => {
    window._hudWs = null;
  });

  function createWebSocketFactory() {
    const sockets = [];
    const mock = vi.fn(function WebSocketMock(_url) {
      const socket = {
        readyState: 0,
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        send: vi.fn(),
        close: vi.fn(),
      };
      sockets.push(socket);
      return socket;
    });
    mock.sockets = sockets;
    return mock;
  }

  it("opens a websocket, updates status, and replays lifecycle callbacks", () => {
    const wsFactory = createWebSocketFactory();
    window.WebSocket = wsFactory;
    window.WebSocket.OPEN = 1;
    window.WebSocket.CONNECTING = 0;

    const setConnectionStatus = vi.fn();
    const startPolling = vi.fn();
    const stopPolling = vi.fn();
    const fetchAll = vi.fn(() => Promise.resolve("ok"));
    const setGatewayUptimeSnapshot = vi.fn();

    const wsController = window.HUDApp.ws.createWsController({
      wsUrlFactory: () => "ws://example/ws",
      fetchAll,
      setConnectionStatus,
      setGatewayUptimeSnapshot,
      startPolling,
      stopPolling,
      setPerfMonitor: vi.fn(),
    });

    wsController.connect();
    expect(wsFactory).toHaveBeenCalledOnce();

    const socket = wsFactory.sockets[0];
    expect(socket.onopen).toBeTypeOf("function");
    expect(socket.onmessage).toBeTypeOf("function");
    expect(socket.onclose).toBeTypeOf("function");

    socket.onopen();
    expect(stopPolling).toHaveBeenCalled();
    expect(setConnectionStatus).toHaveBeenCalledWith(true);

    window.handleChatWsMessage = vi.fn();
    socket.onmessage({ data: JSON.stringify({ type: "chat", payload: { text: "hello" } }) });
    expect(window.handleChatWsMessage).toHaveBeenCalledWith({
      type: "chat",
      payload: { text: "hello" },
    });

    socket.onmessage({
      data: JSON.stringify({
        type: "gateway-status",
        uptimeMs: 5000,
      }),
    });
    expect(setGatewayUptimeSnapshot).toHaveBeenCalledWith(5000);

    socket.onmessage({ data: JSON.stringify({ type: "tick", payload: {} }) });
    expect(fetchAll).toHaveBeenCalledWith(
      expect.objectContaining({
        includeCold: false,
        runId: expect.any(String),
      }),
    );

    socket.onclose({ code: 1006, reason: "network" });
    expect(setConnectionStatus).toHaveBeenCalledWith(false);
    expect(startPolling).toHaveBeenCalled();
  });

  it("reuses an existing opened websocket and avoids duplicate connect", () => {
    const wsFactory = createWebSocketFactory();
    window.WebSocket = wsFactory;
    window.WebSocket.OPEN = 1;
    window.WebSocket.CONNECTING = 0;

    const keepOpen = { readyState: 1 };
    window._hudWs = keepOpen;

    const wsController = window.HUDApp.ws.createWsController({
      wsUrlFactory: () => "ws://example/ws",
      setConnectionStatus: vi.fn(),
      setGatewayUptimeSnapshot: vi.fn(),
      startPolling: vi.fn(),
      stopPolling: vi.fn(),
    });

    wsController.connect();

    expect(wsFactory).not.toHaveBeenCalled();
  });

  it("ignores malformed websocket payloads without throwing", () => {
    const wsFactory = createWebSocketFactory();
    window.WebSocket = wsFactory;
    window.WebSocket.OPEN = 1;
    window.WebSocket.CONNECTING = 0;

    const setConnectionStatus = vi.fn();

    const wsController = window.HUDApp.ws.createWsController({
      wsUrlFactory: () => "ws://example/ws",
      setConnectionStatus,
      setGatewayUptimeSnapshot: vi.fn(),
      startPolling: vi.fn(),
      stopPolling: vi.fn(),
    });

    wsController.connect();
    const socket = wsFactory.sockets[0];
    socket.onopen();

    expect(() => {
      socket.onmessage({ data: "{not-json" });
    }).not.toThrow();

    expect(setConnectionStatus).toHaveBeenCalledWith(true);
  });
});

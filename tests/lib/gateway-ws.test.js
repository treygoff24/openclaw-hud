// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebSocketServer } from "ws";
import { GatewayWS } from "../../lib/gateway-ws.js";

function waitEvent(emitter, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeoutMs);
    emitter.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function createMockServer(opts = {}) {
  const connectFrames = [];
  const requestFrames = [];
  let challengeCount = 0;
  const wss = new WebSocketServer({ port: 0 });
  const url = () => `ws://127.0.0.1:${wss.address().port}`;

  wss.on("connection", (ws) => {
    challengeCount += 1;
    const nonce = opts.challengeNonce
      ? opts.challengeNonce(challengeCount)
      : `nonce-${challengeCount}`;
    ws.send(
      JSON.stringify({
        type: "event",
        event: "connect.challenge",
        payload: { nonce, ts: Date.now() },
      }),
    );

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.method === "connect") {
        connectFrames.push(msg);
        const authFail =
          typeof opts.authFail === "function"
            ? opts.authFail(challengeCount)
            : Boolean(opts.authFail);
        if (authFail) {
          ws.send(
            JSON.stringify({
              type: "res",
              id: msg.id,
              ok: false,
              error: { code: "INVALID_REQUEST", message: "unauthorized: bad token" },
            }),
          );
          return;
        }
        ws.send(
          JSON.stringify({
            type: "res",
            id: msg.id,
            ok: true,
            payload: { features: {}, snapshot: { sessions: [] }, policy: { maxReq: 100 } },
          }),
        );
        return;
      }

      requestFrames.push(msg);
      if (opts.onRequest) opts.onRequest(ws, msg);
    });
  });

  return { wss, url, connectFrames, requestFrames };
}

describe("GatewayWS", () => {
  let server;
  let gw;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    if (gw) {
      gw.close();
      gw = null;
    }
    if (server) {
      await new Promise((resolve) => server.wss.close(resolve));
      server = null;
    }
  });

  it("connects and completes auth handshake", async () => {
    server = createMockServer();
    gw = new GatewayWS({ url: server.url(), token: "test-token", reconnect: { enabled: false } });
    await gw.connect();
    expect(gw.connected).toBe(true);
    expect(gw.snapshot).toEqual({ sessions: [] });
  });

  it("sends signed device proof with least-privilege default scopes", async () => {
    server = createMockServer();
    gw = new GatewayWS({ url: server.url(), token: "tk123", reconnect: { enabled: false } });
    await gw.connect();

    expect(server.connectFrames).toHaveLength(1);
    const frame = server.connectFrames[0];
    expect(frame.type).toBe("req");
    expect(frame.method).toBe("connect");
    expect(frame.params.minProtocol).toBe(3);
    expect(frame.params.maxProtocol).toBe(3);
    expect(frame.params.client.id).toBe("openclaw-ios");
    expect(frame.params.auth.token).toBe("tk123");
    expect(frame.params.scopes).toEqual(["operator.read", "operator.write"]);
    expect(frame.params.device).toBeTruthy();
    expect(frame.params.device.nonce).toBe("nonce-1");
    expect(typeof frame.params.device.signature).toBe("string");
    expect(typeof frame.params.device.signedAt).toBe("number");
  });

  it("rejects on auth failure and does not reconnect", async () => {
    server = createMockServer({ authFail: true });
    gw = new GatewayWS({
      url: server.url(),
      token: "bad",
      reconnect: { enabled: true, baseDelayMs: 50, maxDelayMs: 100 },
    });
    const errorEvent = waitEvent(gw, "error");
    const connectResult = gw.connect().catch((err) => err);
    const err = await errorEvent;
    const rejected = await connectResult;

    expect(err.message).toMatch(/unauthorized/);
    expect(rejected.message).toMatch(/unauthorized/);
    expect(gw.connected).toBe(false);
  });

  it("correlates request/response by id after connect", async () => {
    server = createMockServer({
      onRequest: (ws, msg) => {
        ws.send(
          JSON.stringify({ type: "res", id: msg.id, ok: true, payload: { method: msg.method } }),
        );
      },
    });
    gw = new GatewayWS({ url: server.url(), token: "ok", reconnect: { enabled: false } });
    await gw.connect();

    const result = await gw.request("chat.history", { sessionKey: "agent:codex:main" });
    expect(result).toEqual({ method: "chat.history" });
  });

  it("routes typed event frames", async () => {
    server = createMockServer();
    gw = new GatewayWS({ url: server.url(), token: "ok", reconnect: { enabled: false } });
    await gw.connect();

    const chatEvent = waitEvent(gw, "chat-event");
    const tickEvent = waitEvent(gw, "tick");
    const agentEvent = waitEvent(gw, "agent-event");

    for (const ws of server.wss.clients) {
      ws.send(JSON.stringify({ type: "event", event: "chat", payload: { text: "hi" } }));
      ws.send(JSON.stringify({ type: "event", event: "tick", payload: { ts: 1 } }));
      ws.send(JSON.stringify({ type: "event", event: "agent", payload: { action: "start" } }));
    }

    expect(await chatEvent).toEqual({ text: "hi" });
    expect(await tickEvent).toEqual({ ts: 1 });
    expect(await agentEvent).toEqual({ action: "start" });
  });

  it("reconnects and sends a fresh signed connect proof each time", async () => {
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => {
      now += 7;
      return now;
    });

    server = createMockServer();
    gw = new GatewayWS({
      url: server.url(),
      token: "ok",
      reconnect: { enabled: true, baseDelayMs: 20, maxDelayMs: 50 },
    });
    await gw.connect();
    expect(server.connectFrames).toHaveLength(1);

    const disconnected = waitEvent(gw, "disconnected");
    for (const ws of server.wss.clients) ws.close();
    await disconnected;

    await waitEvent(gw, "connected", 5000);
    expect(server.connectFrames.length).toBeGreaterThanOrEqual(2);

    const first = server.connectFrames[0].params.device;
    const second = server.connectFrames[1].params.device;
    expect(first.signedAt).not.toBe(second.signedAt);
    expect(first.signature).not.toBe(second.signature);
  });

  it("flushes queued requests after reconnect", async () => {
    server = createMockServer({
      onRequest: (ws, msg) => {
        ws.send(JSON.stringify({ type: "res", id: msg.id, ok: true, payload: { ok: msg.method } }));
      },
    });
    gw = new GatewayWS({
      url: server.url(),
      token: "ok",
      reconnect: { enabled: true, baseDelayMs: 20, maxDelayMs: 50 },
    });
    await gw.connect();

    const disconnected = waitEvent(gw, "disconnected");
    for (const ws of server.wss.clients) ws.close();
    await disconnected;

    const one = gw.request("method.one", {});
    const two = gw.request("method.two", {});

    await waitEvent(gw, "connected", 5000);
    await expect(one).resolves.toEqual({ ok: "method.one" });
    await expect(two).resolves.toEqual({ ok: "method.two" });
  });

  it("rejects oldest when reconnect queue overflows", async () => {
    server = createMockServer();
    gw = new GatewayWS({
      url: server.url(),
      token: "ok",
      reconnect: { enabled: true, baseDelayMs: 20, maxDelayMs: 50 },
    });
    await gw.connect();

    const disconnected = waitEvent(gw, "disconnected");
    for (const ws of server.wss.clients) ws.close();
    await disconnected;

    const queued = [];
    for (let i = 0; i < 51; i += 1) {
      queued.push(gw.request(`m${i}`, {}).catch((err) => err));
    }
    const first = await queued[0];
    expect(first).toBeInstanceOf(Error);
    expect(first.message).toMatch(/overflow/);
  });
});

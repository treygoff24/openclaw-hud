const { EventEmitter } = require("events");
const { randomUUID } = require("crypto");
const WebSocket = require("ws");
const { buildConnectParams, DEFAULT_ROLE, DEFAULT_SCOPES } = require("./gateway-connect-auth");

const EVENT_MAP = { chat: "chat-event", tick: "tick", agent: "agent-event", shutdown: "shutdown" };

class GatewayWS extends EventEmitter {
  constructor({ url, token, reconnect = {}, requestTimeoutMs = 60000, connect = {} }) {
    super();
    this._url = url;
    this._token = token;
    this._reconnect = { enabled: false, baseDelayMs: 1000, maxDelayMs: 30000, ...reconnect };
    this._requestTimeoutMs = requestTimeoutMs;
    this._connectRole = connect.role || DEFAULT_ROLE;
    const defaultScopes = Array.isArray(DEFAULT_SCOPES) ? DEFAULT_SCOPES : ["operator.read"];
    this._connectScopes = Array.isArray(connect.scopes) ? connect.scopes : defaultScopes;
    this._connectClient = {
      id: "openclaw-ios",
      displayName: "openclaw hud",
      version: "1.0.0",
      platform: "macos",
      mode: "ui",
      instanceId: "openclaw-hud",
      ...(connect.client || {}),
    };
    this._connectLocale = connect.locale || "en-US";
    this._connectUserAgent = connect.userAgent || "openclaw-hud/1.0.0";
    this._ws = null;
    this._connected = false;
    this._snapshot = null;
    this._policy = null;
    this._pending = new Map();
    this._queue = [];
    this._currentDelay = this._reconnect.baseDelayMs;
    this._reconnectTimer = null;
    this._closed = false;
    this._authFailed = false;
    this._lastSeq = null;
  }
  get connected() {
    return this._connected;
  }
  get snapshot() {
    return this._snapshot;
  }
  connect() {
    this._closed = false;
    this._authFailed = false;
    return this._doConnect();
  }
  _resolveToken() {
    if (typeof this._token === "function") return this._token();
    return this._token;
  }
  _doConnect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this._url);
      this._ws = ws;
      let handshakeDone = false;
      const handshakeTimeout = setTimeout(() => {
        if (!handshakeDone) {
          handshakeDone = true;
          ws.close();
          reject(new Error("Handshake timeout"));
        }
      }, 30000);
      ws.on("open", () => {
        /* wait for challenge */
      });
      ws.on("message", (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw);
        } catch {
          return;
        }
        if (msg?.type === "event" && msg.event === "connect.challenge" && !handshakeDone) {
          try {
            const id = randomUUID();
            this._connectId = id;
            const params = buildConnectParams({
              token: this._resolveToken(),
              nonce: msg?.payload?.nonce,
              role: this._connectRole,
              scopes: this._connectScopes,
              client: this._connectClient,
              locale: this._connectLocale,
              userAgent: this._connectUserAgent,
            });
            ws.send(
              JSON.stringify({
                type: "req",
                id,
                method: "connect",
                params,
              }),
            );
          } catch (err) {
            const message =
              typeof err === "string" && err ? err : err instanceof Error ? err.message : "";
            const error = err instanceof Error ? err : new Error(message || "Handshake failed");
            handshakeDone = true;
            clearTimeout(handshakeTimeout);
            this.emit("error", error);
            this._rejectPending();
            this._rejectQueue(error);
            ws.close();
            reject(error);
          }
          return;
        }
        if (msg?.type === "res" && msg.id && msg.id === this._connectId && !handshakeDone) {
          handshakeDone = true;
          clearTimeout(handshakeTimeout);
          if (msg.ok) {
            this._snapshot = msg.payload?.snapshot || null;
            this._policy = msg.payload?.policy || null;
            this._connected = true;
            this._currentDelay = this._reconnect.baseDelayMs;
            this._authFailed = false;
            this.emit("connected");
            this._flushQueue();
            resolve();
          } else {
            this._authFailed = true;
            const err = new Error(msg.error?.message || "Auth failed");
            this.emit("error", err);
            this._rejectPending();
            this._rejectQueue(err);
            ws.close();
            reject(err);
          }
          return;
        }
        if (msg?.type === "res" && msg.id && this._pending.has(msg.id)) {
          const { resolve: res, reject: rej, timer } = this._pending.get(msg.id);
          this._pending.delete(msg.id);
          clearTimeout(timer);
          if (msg.ok) res(msg.payload);
          else rej(new Error(msg.error?.message || "Request failed"));
          return;
        }
        if (msg?.type === "event" && msg.event && EVENT_MAP[msg.event]) {
          if (msg.event === "shutdown") {
            this.emit("shutdown");
            ws.close();
          } else {
            this.emit(EVENT_MAP[msg.event], msg.payload);
          }
        }
        if (msg.seq != null) {
          if (this._lastSeq != null && msg.seq > this._lastSeq + 1) {
            this.emit("seq-gap", { expected: this._lastSeq + 1, received: msg.seq });
          }
          this._lastSeq = msg.seq;
        }
      });
      ws.on("close", () => {
        if (!handshakeDone) {
          handshakeDone = true;
          clearTimeout(handshakeTimeout);
        }
        const wasConnected = this._connected;
        this._connected = false;
        this._rejectPending();
        if (wasConnected) this.emit("disconnected");
        if (!this._closed && !this._authFailed && this._reconnect.enabled)
          this._scheduleReconnect();
      });
      ws.on("error", (err) => {
        this.emit("error", err);
      });
    });
  }
  request(method, params) {
    if (!this._connected) {
      return new Promise((resolve, reject) => {
        this._queue.push({ method, params, resolve, reject });
        if (this._queue.length > 50) {
          const oldest = this._queue.shift();
          oldest.reject(new Error("reconnect queue overflow"));
        }
      });
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`Request ${method} timed out`));
      }, this._requestTimeoutMs);
      this._pending.set(id, { resolve, reject, timer });
      this._ws.send(JSON.stringify({ type: "req", id, method, params }));
    });
  }
  close() {
    this._closed = true;
    this._connected = false;
    clearTimeout(this._reconnectTimer);
    if (this._ws) {
      this._ws.removeAllListeners();
      this._ws.close();
      this._ws = null;
    }
    this._rejectPending();
    this._rejectQueue(new Error("Connection closed"));
  }
  _scheduleReconnect() {
    const jitter = 1 + (Math.random() - 0.5) * 0.5;
    const delay = Math.min(this._currentDelay * jitter, this._reconnect.maxDelayMs);
    this._currentDelay = Math.min(this._currentDelay * 2, this._reconnect.maxDelayMs);
    this._reconnectTimer = setTimeout(() => {
      if (this._closed) return;
      this._doConnect().catch(() => {});
    }, delay);
  }
  _flushQueue() {
    for (const { method, params, resolve, reject } of this._queue.splice(0))
      void this.request(method, params).then(resolve, reject);
  }
  _rejectPending() {
    for (const [, { reject, timer }] of this._pending) {
      clearTimeout(timer);
      reject(new Error("Connection lost"));
    }
    this._pending.clear();
  }
  _rejectQueue(err) {
    for (const { reject } of this._queue.splice(0)) reject(err);
  }
}

module.exports = { GatewayWS };

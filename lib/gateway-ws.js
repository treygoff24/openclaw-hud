const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');
const WebSocket = require('ws');

const EVENT_MAP = { chat: 'chat-event', tick: 'tick', agent: 'agent-event', shutdown: 'shutdown' };

class GatewayWS extends EventEmitter {
  constructor({ url, token, reconnect = {}, requestTimeoutMs = 60000 }) {
    super();
    this._url = url;
    this._token = token;
    this._reconnect = { enabled: false, baseDelayMs: 1000, maxDelayMs: 30000, ...reconnect };
    this._requestTimeoutMs = requestTimeoutMs;
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
  get connected() { return this._connected; }
  get snapshot() { return this._snapshot; }
  connect() {
    this._closed = false;
    this._authFailed = false;
    return this._doConnect();
  }
  _doConnect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this._url);
      this._ws = ws;
      let handshakeDone = false;
      const handshakeTimeout = setTimeout(() => {
        if (!handshakeDone) { handshakeDone = true; ws.close(); reject(new Error('Handshake timeout')); }
      }, 30000);
      ws.on('open', () => { console.log('[HUD-GW] ws open, waiting for challenge'); });
      ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        if (msg.event === 'connect.challenge' && !handshakeDone) {
          const id = randomUUID();
          this._connectId = id;
          ws.send(JSON.stringify({
            type: 'req', id, method: 'connect',
            params: {
              minProtocol: 3, maxProtocol: 3,
              client: { id: 'control-ui', version: '0.1.0', platform: 'hud', mode: 'ui' },
              auth: { token: this._token },
            },
          }));
          return;
        }
        if (msg.id && msg.id === this._connectId && !handshakeDone) {
          handshakeDone = true;
          clearTimeout(handshakeTimeout);
          if (msg.ok) {
            console.log('[HUD-GW] handshake OK');
            this._snapshot = msg.payload?.snapshot || null;
            this._policy = msg.payload?.policy || null;
            this._connected = true;
            this._currentDelay = this._reconnect.baseDelayMs;
            this._authFailed = false;
            this.emit('connected');
            this._flushQueue();
            resolve();
          } else {
            console.error('[HUD-GW] handshake FAILED:', msg.error);
            this._authFailed = true;
            const err = new Error(msg.error?.message || 'Auth failed');
            this.emit('error', err);
            this._rejectPending();
            this._rejectQueue(err);
            ws.close();
            reject(err);
          }
          return;
        }
        if (msg.id && this._pending.has(msg.id)) {
          const { resolve: res, reject: rej, timer } = this._pending.get(msg.id);
          this._pending.delete(msg.id);
          clearTimeout(timer);
          if (msg.ok) res(msg.payload); else rej(new Error(msg.error?.message || 'Request failed'));
          return;
        }
        if (msg.event && EVENT_MAP[msg.event]) {
          if (msg.event === 'shutdown') { this.emit('shutdown'); ws.close(); }
          else { this.emit(EVENT_MAP[msg.event], msg.payload); }
        }
        if (msg.seq != null) {
          if (this._lastSeq != null && msg.seq > this._lastSeq + 1) {
            this.emit('seq-gap', { expected: this._lastSeq + 1, received: msg.seq });
          }
          this._lastSeq = msg.seq;
        }
      });
      ws.on('close', (code, reason) => {
        console.log('[HUD-GW] ws close', { code, reason: reason?.toString(), handshakeDone });
        const wasHandshakeDone = handshakeDone;
        if (!handshakeDone) { handshakeDone = true; clearTimeout(handshakeTimeout); }
        const wasConnected = this._connected;
        this._connected = false;
        this._rejectPending();
        if (!wasHandshakeDone) reject(new Error(`Connection closed before handshake (code=${code})`));
        if (wasConnected) this.emit('disconnected');
        if (!this._closed && !this._authFailed && this._reconnect.enabled) this._scheduleReconnect();
      });
      ws.on('error', (err) => { console.error('[HUD-GW] ws error:', err.message); this.emit('error', err); });
    });
  }
  request(method, params) {
    if (!this._connected) {
      return new Promise((resolve, reject) => {
        this._queue.push({ method, params, resolve, reject });
        if (this._queue.length > 50) { const oldest = this._queue.shift(); oldest.reject(new Error('reconnect queue overflow')); }
      });
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this._pending.delete(id); reject(new Error(`Request ${method} timed out`)); }, this._requestTimeoutMs);
      this._pending.set(id, { resolve, reject, timer });
      this._ws.send(JSON.stringify({ type: 'req', id, method, params }));
    });
  }
  close() {
    this._closed = true;
    this._connected = false;
    clearTimeout(this._reconnectTimer);
    if (this._ws) { this._ws.removeAllListeners(); this._ws.close(); this._ws = null; }
    this._rejectPending();
    this._rejectQueue(new Error('Connection closed'));
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
    for (const { method, params, resolve, reject } of this._queue.splice(0)) this.request(method, params).then(resolve, reject);
  }
  _rejectPending() {
    for (const [, { reject, timer }] of this._pending) { clearTimeout(timer); reject(new Error('Connection lost')); }
    this._pending.clear();
  }
  _rejectQueue(err) { for (const { reject } of this._queue.splice(0)) reject(err); }
}

module.exports = { GatewayWS };

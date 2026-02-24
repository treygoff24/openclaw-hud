import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { GatewayWS } from '../../lib/gateway-ws.js';

/** Create a mock gateway WS server that does the challenge/auth handshake. */
function createMockServer(opts = {}) {
  const wss = new WebSocketServer({ port: 0 });
  const port = () => wss.address()?.port;
  const url = () => `ws://127.0.0.1:${port()}`;

  wss.on('connection', (ws) => {
    // Send challenge
    ws.send(JSON.stringify({ event: 'connect.challenge', payload: { nonce: 'abc', ts: Date.now() } }));

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.method === 'connect') {
        if (opts.authFail) {
          ws.send(JSON.stringify({ id: msg.id, ok: false, error: { code: 'INVALID_REQUEST', message: 'unauthorized: bad token' } }));
        } else {
          ws.send(JSON.stringify({
            id: msg.id, ok: true,
            payload: { features: {}, snapshot: { sessions: [] }, policy: { maxReq: 100 } }
          }));
        }
      } else if (opts.onRequest) {
        opts.onRequest(ws, msg);
      }
    });
  });

  return { wss, port, url };
}

function waitEvent(emitter, event, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
    emitter.once(event, (data) => { clearTimeout(timer); resolve(data); });
  });
}

describe('GatewayWS', () => {
  let server, gw;

  afterEach(async () => {
    if (gw) { gw.close(); gw = null; }
    if (server) {
      await new Promise(r => server.wss.close(r));
      server = null;
    }
  });

  describe('handshake', () => {
    it('connects and completes auth handshake', async () => {
      server = createMockServer();
      gw = new GatewayWS({ url: server.url(), token: 'test-token', reconnect: { enabled: false } });
      await gw.connect();
      expect(gw.connected).toBe(true);
      expect(gw.snapshot).toEqual({ sessions: [] });
    });

    it('sends correct connect request shape', async () => {
      let connectMsg;
      const wss = new WebSocketServer({ port: 0 });
      const url = `ws://127.0.0.1:${wss.address().port}`;
      wss.on('connection', (ws) => {
        ws.send(JSON.stringify({ event: 'connect.challenge', payload: { nonce: 'x', ts: 1 } }));
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw);
          if (msg.method === 'connect') {
            connectMsg = msg;
            ws.send(JSON.stringify({ id: msg.id, ok: true, payload: { features: {}, snapshot: {}, policy: {} } }));
          }
        });
      });

      gw = new GatewayWS({ url, token: 'tk123', reconnect: { enabled: false } });
      await gw.connect();
      expect(connectMsg.params.minProtocol).toBe(3);
      expect(connectMsg.params.maxProtocol).toBe(3);
      expect(connectMsg.params.client.id).toBe('openclaw-control-ui');
      expect(connectMsg.params.auth.token).toBe('tk123');
      gw.close();
      await new Promise(r => wss.close(r));
    });

    it('emits error and does not reconnect on auth failure', async () => {
      server = createMockServer({ authFail: true });
      gw = new GatewayWS({ url: server.url(), token: 'bad', reconnect: { enabled: true, baseDelayMs: 50 } });
      const errPromise = waitEvent(gw, 'error');
      const result = gw.connect().catch(e => e);
      const err = await errPromise;
      expect(err.message).toMatch(/unauthorized/);
      const connectErr = await result;
      expect(connectErr.message).toMatch(/unauthorized/);
      expect(gw.connected).toBe(false);
    });
  });

  describe('request/response', () => {
    it('correlates request and response by id', async () => {
      server = createMockServer({
        onRequest: (ws, msg) => {
          ws.send(JSON.stringify({ id: msg.id, ok: true, payload: { result: 42 } }));
        }
      });
      gw = new GatewayWS({ url: server.url(), token: 't', reconnect: { enabled: false } });
      await gw.connect();
      const res = await gw.request('test.method', { foo: 1 });
      expect(res).toEqual({ result: 42 });
    });

    it('rejects on error response', async () => {
      server = createMockServer({
        onRequest: (ws, msg) => {
          ws.send(JSON.stringify({ id: msg.id, ok: false, error: { code: 'FAIL', message: 'nope' } }));
        }
      });
      gw = new GatewayWS({ url: server.url(), token: 't', reconnect: { enabled: false } });
      await gw.connect();
      await expect(gw.request('bad', {})).rejects.toThrow('nope');
    });

    it('rejects on timeout', async () => {
      server = createMockServer({ onRequest: () => { /* no response */ } });
      gw = new GatewayWS({ url: server.url(), token: 't', reconnect: { enabled: false }, requestTimeoutMs: 100 });
      await gw.connect();
      await expect(gw.request('slow', {})).rejects.toThrow(/timed out/);
    });
  });

  describe('event routing', () => {
    it('routes chat events', async () => {
      server = createMockServer();
      gw = new GatewayWS({ url: server.url(), token: 't', reconnect: { enabled: false } });
      await gw.connect();
      const p = waitEvent(gw, 'chat-event');
      // Send event from server
      for (const ws of server.wss.clients) {
        ws.send(JSON.stringify({ event: 'chat', payload: { text: 'hello' } }));
      }
      const data = await p;
      expect(data).toEqual({ text: 'hello' });
    });

    it('routes tick events', async () => {
      server = createMockServer();
      gw = new GatewayWS({ url: server.url(), token: 't', reconnect: { enabled: false } });
      await gw.connect();
      const p = waitEvent(gw, 'tick');
      for (const ws of server.wss.clients) {
        ws.send(JSON.stringify({ event: 'tick', payload: { ts: 123 } }));
      }
      expect(await p).toEqual({ ts: 123 });
    });

    it('routes agent events', async () => {
      server = createMockServer();
      gw = new GatewayWS({ url: server.url(), token: 't', reconnect: { enabled: false } });
      await gw.connect();
      const p = waitEvent(gw, 'agent-event');
      for (const ws of server.wss.clients) {
        ws.send(JSON.stringify({ event: 'agent', payload: { action: 'start' } }));
      }
      expect(await p).toEqual({ action: 'start' });
    });

    it('routes shutdown events and emits shutdown', async () => {
      server = createMockServer();
      gw = new GatewayWS({ url: server.url(), token: 't', reconnect: { enabled: false } });
      await gw.connect();
      const p = waitEvent(gw, 'shutdown');
      for (const ws of server.wss.clients) {
        ws.send(JSON.stringify({ event: 'shutdown', payload: {} }));
      }
      await p;
    });
  });

  describe('connected getter', () => {
    it('false before connect, true after auth, false after close', async () => {
      server = createMockServer();
      gw = new GatewayWS({ url: server.url(), token: 't', reconnect: { enabled: false } });
      expect(gw.connected).toBe(false);
      await gw.connect();
      expect(gw.connected).toBe(true);
      gw.close();
      expect(gw.connected).toBe(false);
    });
  });

  describe('disconnect event', () => {
    it('emits disconnected on server close', async () => {
      server = createMockServer();
      gw = new GatewayWS({ url: server.url(), token: 't', reconnect: { enabled: false } });
      await gw.connect();
      const p = waitEvent(gw, 'disconnected');
      for (const ws of server.wss.clients) ws.close();
      await p;
      expect(gw.connected).toBe(false);
    });
  });

  describe('reconnect', () => {
    it('reconnects after disconnect', async () => {
      server = createMockServer();
      gw = new GatewayWS({ url: server.url(), token: 't', reconnect: { enabled: true, baseDelayMs: 50, maxDelayMs: 100 } });
      await gw.connect();
      expect(gw.connected).toBe(true);

      // Force disconnect
      const disconnP = waitEvent(gw, 'disconnected');
      for (const ws of server.wss.clients) ws.close();
      await disconnP;
      expect(gw.connected).toBe(false);

      // Wait for reconnect
      const connP = waitEvent(gw, 'connected', 5000);
      await connP;
      expect(gw.connected).toBe(true);
    });

    it('flushes queued requests after reconnect', async () => {
      server = createMockServer({
        onRequest: (ws, msg) => {
          ws.send(JSON.stringify({ id: msg.id, ok: true, payload: { method: msg.method } }));
        }
      });
      gw = new GatewayWS({ url: server.url(), token: 't', reconnect: { enabled: true, baseDelayMs: 50, maxDelayMs: 100 } });
      await gw.connect();

      // Disconnect
      const disconnP = waitEvent(gw, 'disconnected');
      for (const ws of server.wss.clients) ws.close();
      await disconnP;

      // Queue requests while disconnected
      const r1 = gw.request('method1', {});
      const r2 = gw.request('method2', {});

      // Wait for reconnect
      await waitEvent(gw, 'connected', 5000);

      const [res1, res2] = await Promise.all([r1, r2]);
      expect(res1).toEqual({ method: 'method1' });
      expect(res2).toEqual({ method: 'method2' });
    });

    it('rejects oldest when queue overflows', async () => {
      server = createMockServer();
      gw = new GatewayWS({ url: server.url(), token: 't', reconnect: { enabled: true, baseDelayMs: 50 } });
      await gw.connect();

      const disconnP = waitEvent(gw, 'disconnected');
      for (const ws of server.wss.clients) ws.close();
      await disconnP;

      // Queue 51 requests
      const promises = [];
      for (let i = 0; i < 51; i++) {
        promises.push(gw.request(`m${i}`, {}).catch(e => e));
      }

      // The first one should be rejected as overflow
      const first = await promises[0];
      expect(first).toBeInstanceOf(Error);
      expect(first.message).toMatch(/overflow/);
    });

    it('does not reconnect on auth failure', async () => {
      // Start with good auth, then switch to bad
      let authFail = false;
      const wss = new WebSocketServer({ port: 0 });
      const url = `ws://127.0.0.1:${wss.address().port}`;
      wss.on('connection', (ws) => {
        ws.send(JSON.stringify({ event: 'connect.challenge', payload: { nonce: 'x', ts: 1 } }));
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw);
          if (msg.method === 'connect') {
            if (authFail) {
              ws.send(JSON.stringify({ id: msg.id, ok: false, error: { code: 'INVALID_REQUEST', message: 'unauthorized' } }));
            } else {
              ws.send(JSON.stringify({ id: msg.id, ok: true, payload: { features: {}, snapshot: {}, policy: {} } }));
            }
          }
        });
      });

      gw = new GatewayWS({ url, token: 't', reconnect: { enabled: true, baseDelayMs: 50 } });
      await gw.connect();

      authFail = true;
      const disconnP = waitEvent(gw, 'disconnected');
      for (const ws of wss.clients) ws.close();
      await disconnP;

      // Wait and check it emits error but doesn't reconnect
      const errP = waitEvent(gw, 'error', 3000);
      const err = await errP;
      expect(err.message).toMatch(/unauthorized/);

      // Give it some time - should NOT reconnect
      await new Promise(r => setTimeout(r, 200));
      expect(gw.connected).toBe(false);

      gw.close();
      await new Promise(r => wss.close(r));
    });
  });
});

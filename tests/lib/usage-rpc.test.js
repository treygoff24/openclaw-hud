// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';

const helpers = require('../../lib/helpers');

function loadModule() {
  delete require.cache[require.resolve('../../lib/usage-rpc')];
  return require('../../lib/usage-rpc');
}

function createGatewayServer({ onRequest } = {}) {
  const wss = new WebSocketServer({ port: 0 });
  const url = () => `ws://127.0.0.1:${wss.address().port}`;
  const frames = { connect: [], request: [] };

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ event: 'connect.challenge', payload: { nonce: 'nonce-abc', ts: Date.now() } }));
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.method === 'connect') {
        frames.connect.push(msg);
        ws.send(JSON.stringify({ id: msg.id, ok: true, payload: { features: {}, snapshot: {}, policy: {} } }));
        return;
      }
      frames.request.push(msg);
      if (onRequest) onRequest(ws, msg);
    });
  });

  return { wss, url, frames };
}

describe('usage-rpc', () => {
  const originalGetGatewayConfig = helpers.getGatewayConfig;

  afterEach(async () => {
    helpers.getGatewayConfig = originalGetGatewayConfig;
    vi.restoreAllMocks();
  });

  it('throws when gateway token is missing', async () => {
    helpers.getGatewayConfig = vi.fn(() => ({ host: '127.0.0.1', port: 18789, token: '' }));
    const { requestSessionsUsage } = loadModule();

    await expect(requestSessionsUsage({ from: 1, to: 2 })).rejects.toMatchObject({
      code: 'GATEWAY_TOKEN_MISSING',
    });
  });

  it('fails closed when gateway host is not local', async () => {
    helpers.getGatewayConfig = vi.fn(() => ({ host: '198.51.100.10', port: 18789, token: 't' }));
    const { requestSessionsUsage } = loadModule();

    await expect(requestSessionsUsage({ from: 1, to: 2 })).rejects.toMatchObject({
      code: 'GATEWAY_HOST_UNSUPPORTED',
    });
  });

  it('sends signed connect payload and requests sessions.usage', async () => {
    const gateway = createGatewayServer({
      onRequest: (ws, msg) => {
        ws.send(JSON.stringify({ id: msg.id, ok: true, payload: { sessions: [{ key: 'agent:codex:main' }] } }));
      },
    });
    const port = gateway.wss.address().port;
    helpers.getGatewayConfig = vi.fn(() => ({ host: '127.0.0.1', port, token: 'test-token' }));

    const { requestSessionsUsage } = loadModule();
    const result = await requestSessionsUsage({
      from: '2026-02-25T00:00:00.000Z',
      to: '2026-02-25T23:59:59.000Z',
      limit: 5,
    });

    expect(result.ok).toBe(true);
    expect(result.result.sessions).toHaveLength(1);

    expect(gateway.frames.connect).toHaveLength(1);
    const connectFrame = gateway.frames.connect[0];
    expect(connectFrame.params.auth.token).toBe('test-token');
    expect(connectFrame.params.scopes).toEqual(['operator.read']);
    expect(connectFrame.params.device).toBeTruthy();
    expect(connectFrame.params.device.nonce).toBe('nonce-abc');
    expect(typeof connectFrame.params.device.signature).toBe('string');

    expect(gateway.frames.request).toHaveLength(1);
    expect(gateway.frames.request[0].method).toBe('sessions.usage');
    expect(gateway.frames.request[0].params.limit).toBe(5);
    expect(gateway.frames.request[0].params.startDate).toBe('2026-02-25');
    expect(gateway.frames.request[0].params.endDate).toBe('2026-02-25');

    await new Promise((resolve) => gateway.wss.close(resolve));
  });

  it('maps unavailable sessions.usage method errors', async () => {
    const gateway = createGatewayServer({
      onRequest: (ws, msg) => {
        ws.send(JSON.stringify({
          id: msg.id,
          ok: false,
          error: {
            code: 'METHOD_NOT_FOUND',
            status: 404,
            message: 'Tool not available: sessions.usage',
          },
        }));
      },
    });
    const port = gateway.wss.address().port;
    helpers.getGatewayConfig = vi.fn(() => ({ host: '127.0.0.1', port, token: 'test-token' }));

    const { requestSessionsUsage } = loadModule();
    await expect(requestSessionsUsage({ from: 1, to: 2 })).rejects.toMatchObject({
      code: 'GATEWAY_SESSIONS_USAGE_UNAVAILABLE',
      status: 404,
      gatewayCode: 'METHOD_NOT_FOUND',
    });

    await new Promise((resolve) => gateway.wss.close(resolve));
  });
});

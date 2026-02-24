// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const helpers = require('../../lib/helpers');

function loadModule() {
  delete require.cache[require.resolve('../../lib/usage-rpc')];
  return require('../../lib/usage-rpc');
}

describe('usage-rpc', () => {
  const originalFetch = global.fetch;
  const originalGetGatewayConfig = helpers.getGatewayConfig;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    helpers.getGatewayConfig = originalGetGatewayConfig;
  });

  it('throws when gateway token is missing', async () => {
    helpers.getGatewayConfig = vi.fn(() => ({ port: 18789, token: '' }));
    const { requestSessionsUsage } = loadModule();

    await expect(requestSessionsUsage({ from: 1, to: 2 })).rejects.toThrow('Gateway token not configured');
  });

  it('calls gateway tools/invoke with sessions.usage args', async () => {
    helpers.getGatewayConfig = vi.fn(() => ({ port: 19999, token: 'test-token' }));
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, result: { rows: [] } })
    }));

    const { requestSessionsUsage } = loadModule();
    await requestSessionsUsage({ from: 100, to: 200, timezone: 'America/Chicago' });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:19999/tools/invoke');
    expect(options.headers.Authorization).toBe('Bearer test-token');

    const payload = JSON.parse(options.body);
    expect(payload.tool).toBe('sessions.usage');
    expect(payload.args).toEqual({ from: 100, to: 200, timezone: 'America/Chicago' });
  });

  it('throws readable error when gateway returns non-ok response', async () => {
    helpers.getGatewayConfig = vi.fn(() => ({ port: 18789, token: 'test-token' }));
    global.fetch = vi.fn(async () => ({
      ok: false,
      text: async () => '{"error":{"message":"boom"}}'
    }));

    const { requestSessionsUsage } = loadModule();

    await expect(requestSessionsUsage({ from: 1, to: 2 })).rejects.toThrow('Gateway error: boom');
  });
});

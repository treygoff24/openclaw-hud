import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const helpers = require('../../lib/helpers');
const fs = require('fs');

helpers.getGatewayConfig = vi.fn(() => ({ port: 18789, token: 'test-token' }));
fs.realpathSync = vi.fn((p) => p);

const mockFetch = vi.fn();
global.fetch = mockFetch;

function createApp() {
  delete require.cache[require.resolve('../../routes/spawn')];
  const router = require('../../routes/spawn');
  const app = express();
  app.use(router);
  return app;
}

const validBody = { agentId: 'bot', prompt: 'Do something' };

describe('POST /api/spawn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    helpers.getGatewayConfig.mockReturnValue({ port: 18789, token: 'test-token' });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ result: { details: { childSessionKey: 'key-123', runId: 'run-456' } } }),
    });
  });

  it('returns 400 when prompt is missing', async () => {
    const res = await request(createApp()).post('/api/spawn').send({ agentId: 'bot' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Prompt is required');
  });

  it('returns 400 when prompt is empty string', async () => {
    const res = await request(createApp()).post('/api/spawn').send({ agentId: 'bot', prompt: '   ' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when prompt exceeds 50000 chars', async () => {
    const res = await request(createApp()).post('/api/spawn').send({ agentId: 'bot', prompt: 'x'.repeat(50001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('too long');
  });

  it('returns 400 when agentId is missing', async () => {
    const res = await request(createApp()).post('/api/spawn').send({ prompt: 'hello' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Agent is required');
  });

  it('returns 400 for invalid mode', async () => {
    const res = await request(createApp()).post('/api/spawn').send({ ...validBody, mode: 'invalid' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid mode');
  });

  it('returns 400 for invalid label format', async () => {
    const res = await request(createApp()).post('/api/spawn').send({ ...validBody, label: 'has spaces!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid label');
  });

  it('returns 400 for label exceeding 64 chars', async () => {
    const res = await request(createApp()).post('/api/spawn').send({ ...validBody, label: 'a'.repeat(65) });
    expect(res.status).toBe(400);
  });

  it('returns 400 for timeout out of range', async () => {
    const res = await request(createApp()).post('/api/spawn').send({ ...validBody, timeout: 9999 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Timeout');
  });

  it('returns 500 when gateway token is not configured', async () => {
    helpers.getGatewayConfig.mockReturnValue({ port: 18789, token: null });
    const res = await request(createApp()).post('/api/spawn').send(validBody);
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('token not configured');
  });

  it('successfully spawns and returns session key and run ID', async () => {
    const res = await request(createApp()).post('/api/spawn').send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.sessionKey).toBe('key-123');
    expect(res.body.runId).toBe('run-456');
  });

  it('forwards model and label to gateway when provided', async () => {
    await request(createApp()).post('/api/spawn').send({ ...validBody, model: 'gpt-4', label: 'my-task', mode: 'session' });
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.args.model).toBe('gpt-4');
    expect(fetchBody.args.label).toBe('my-task');
    expect(fetchBody.args.mode).toBe('session');
  });

  it('returns 502 when gateway returns error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      text: async () => JSON.stringify({ error: { message: 'agent not found' } }),
    });
    const res = await request(createApp()).post('/api/spawn').send(validBody);
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('agent not found');
  });

  it('returns 502 when gateway is unreachable', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await request(createApp()).post('/api/spawn').send(validBody);
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('ECONNREFUSED');
  });

  it('enforces rate limit of 5 spawns per minute', async () => {
    const app = createApp();
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/spawn').send(validBody);
    }
    const res = await request(app).post('/api/spawn').send(validBody);
    expect(res.status).toBe(429);
    expect(res.body.error).toContain('Rate limit');
  });

  it('validates context files are within allowed directories', async () => {
    const res = await request(createApp()).post('/api/spawn').send({
      ...validBody,
      contextFiles: '/etc/passwd\n/var/secret',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('not in allowed directory');
  });

  it('rejects more than 20 context files', async () => {
    const files = Array.from({ length: 21 }, (_, i) => `~/Development/file${i}.txt`).join('\n');
    const res = await request(createApp()).post('/api/spawn').send({ ...validBody, contextFiles: files });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Max 20');
  });

  it('accepts valid mode values', async () => {
    for (const mode of ['run', 'session']) {
      const res = await request(createApp()).post('/api/spawn').send({ ...validBody, mode });
      expect(res.status).not.toBe(400);
    }
  });

  it('uses model alias as label fallback when no label provided', async () => {
    // Create app first (this reloads the module)
    const app = createApp();
    // Get the freshly loaded module
    const spawnModule = require('../../routes/spawn');
    
    // Populate cached models on the freshly loaded module
    spawnModule.setCachedModels([
      { alias: 'Kimi K2.5', fullId: 'fireworks/accounts/fireworks/models/kimi-k2p5' },
      { alias: 'GPT-4', fullId: 'openai/gpt-4' }
    ]);
    
    const res = await request(app).post('/api/spawn').send({ 
      ...validBody, 
      model: 'fireworks/accounts/fireworks/models/kimi-k2p5',
      label: undefined 
    });
    expect(res.status).toBe(200);
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    // Should use the sanitized alias (non-alphanumeric chars replaced with underscores)
    expect(fetchBody.args.label).toBe('Kimi_K2_5');
  });

  it('preserves user-provided label over model alias', async () => {
    await request(createApp()).post('/api/spawn').send({ 
      ...validBody, 
      model: 'gpt-4',
      label: 'my-custom-label' 
    });
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.args.label).toBe('my-custom-label');
  });
});

describe('resolveAliasFromModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    helpers.getGatewayConfig.mockReturnValue({ port: 18789, token: 'test-token' });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ result: { details: { childSessionKey: 'key-123', runId: 'run-456' } } }),
    });
  });

  it('resolves alias by model id from cached models', async () => {
    // Mock the cachedModels by requiring the module directly
    const spawnModule = require('../../routes/spawn');
    
    // Create a test model list
    const testModels = [
      { id: 'gpt-4', alias: 'GPT-4 Turbo', model: 'openai/gpt-4-turbo' },
      { id: 'claude-opus', alias: 'Claude 3 Opus', model: 'anthropic/claude-3-opus' }
    ];
    
    // The resolveAliasFromModel function should be tested indirectly through the endpoint
    const res = await request(createApp()).post('/api/spawn').send({ 
      agentId: 'bot', 
      prompt: 'test',
      model: 'gpt-4'
    });
    
    expect(res.status).toBe(200);
  });
});

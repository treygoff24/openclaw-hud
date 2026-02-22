import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const helpers = require('../../lib/helpers');
const fs = require('fs');

// Save originals and override
const origSafeJSON5 = helpers.safeJSON5;
const origSafeReaddir = helpers.safeReaddir;
const origSafeRead = helpers.safeRead;
const origStripSecrets = helpers.stripSecrets;
const origHome = helpers.OPENCLAW_HOME;

helpers.OPENCLAW_HOME = '/mock/home';
helpers.safeJSON5 = vi.fn();
helpers.safeReaddir = vi.fn(() => []);
helpers.safeRead = vi.fn();
helpers.stripSecrets = vi.fn(obj => obj);

// Mock fs.statSync for model-usage
const origStatSync = fs.statSync;
fs.statSync = vi.fn(() => ({ mtimeMs: Date.now() }));

function createApp() {
  delete require.cache[require.resolve('../../routes/config')];
  const router = require('../../routes/config');
  const app = express();
  app.use(router);
  return app;
}

describe('GET /api/config', () => {
  beforeEach(() => { vi.clearAllMocks(); helpers.stripSecrets.mockImplementation(obj => obj); });

  it('returns empty object when config file is missing', async () => {
    helpers.safeJSON5.mockReturnValue(null);
    const res = await request(createApp()).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it('returns structured config with correct fields', async () => {
    helpers.safeJSON5.mockReturnValue({
      agents: { defaults: { model: { primary: 'anthropic/claude-sonnet-4' }, maxConcurrent: 3, subagents: { maxDepth: 5 }, models: { 'openai/gpt-4': { alias: 'gpt4' } } } },
      gateway: { port: 9999, mode: 'auto', bind: '0.0.0.0' },
      channels: { discord: {}, telegram: {} },
      models: { providers: { openai: {}, anthropic: {} } },
      meta: { version: '1.0' },
    });
    const res = await request(createApp()).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.defaultModel).toBe('anthropic/claude-sonnet-4');
    expect(res.body.channels).toEqual(['discord', 'telegram']);
    expect(res.body.providers).toEqual(['openai', 'anthropic']);
    expect(res.body.gateway.port).toBe(9999);
    expect(res.body.meta).toEqual({ version: '1.0' });
  });

  it('defaults model to "unknown" when not specified', async () => {
    helpers.safeJSON5.mockReturnValue({ agents: {}, gateway: {}, channels: {} });
    const res = await request(createApp()).get('/api/config');
    expect(res.body.defaultModel).toBe('unknown');
  });

  it('calls stripSecrets on the response', async () => {
    helpers.safeJSON5.mockReturnValue({ agents: { defaults: {} }, gateway: {} });
    helpers.stripSecrets.mockReturnValue({ stripped: true });
    const res = await request(createApp()).get('/api/config');
    expect(helpers.stripSecrets).toHaveBeenCalled();
    expect(res.body).toEqual({ stripped: true });
  });
});

describe('GET /api/models', () => {
  beforeEach(() => { vi.clearAllMocks(); helpers.stripSecrets.mockImplementation(obj => obj); });

  it('returns default entry plus hardcoded agent models when config empty', async () => {
    helpers.safeJSON5.mockReturnValue(null);
    const res = await request(createApp()).get('/api/models');
    expect(res.status).toBe(200);
    expect(res.body[0]).toEqual({ alias: 'default', fullId: '' });
    expect(res.body.some(m => m.alias === 'haiku')).toBe(true);
    expect(res.body.some(m => m.alias === 'vulcan (codex)')).toBe(true);
  });

  it('includes configured models and deduplicates hardcoded ones', async () => {
    helpers.safeJSON5.mockReturnValue({
      agents: { defaults: { models: {
        'anthropic/claude-haiku-4': { alias: 'haiku' },
        'custom/model': { alias: 'custom' },
      } } }
    });
    const res = await request(createApp()).get('/api/models');
    const haikus = res.body.filter(m => m.fullId === 'anthropic/claude-haiku-4');
    expect(haikus).toHaveLength(1);
    expect(res.body.find(m => m.alias === 'custom')).toBeTruthy();
  });

  it('uses last segment of fullId as alias when none provided', async () => {
    helpers.safeJSON5.mockReturnValue({
      agents: { defaults: { models: { 'provider/my-model': {} } } }
    });
    const res = await request(createApp()).get('/api/models');
    expect(res.body.find(m => m.fullId === 'provider/my-model').alias).toBe('my-model');
  });
});

describe('GET /api/model-usage', () => {
  beforeEach(() => { vi.clearAllMocks(); helpers.stripSecrets.mockImplementation(obj => obj); });

  it('returns empty object when no agents exist', async () => {
    helpers.safeReaddir.mockReturnValue([]);
    const res = await request(createApp()).get('/api/model-usage');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it('aggregates token usage from session JSONL files', async () => {
    helpers.safeReaddir.mockImplementation((dp) => {
      if (dp.endsWith('agents')) return ['agent1'];
      return ['sess1.jsonl'];
    });
    fs.statSync.mockReturnValue({ mtimeMs: Date.now() });
    const lines = [
      JSON.stringify({ type: 'model_change', modelId: 'openai/gpt-4' }),
      JSON.stringify({ type: 'message', message: { model: 'openai/gpt-4', usage: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, cost: { total: 0.01 } } } }),
    ];
    helpers.safeRead.mockReturnValue(lines.join('\n'));
    const res = await request(createApp()).get('/api/model-usage');
    expect(res.status).toBe(200);
    const model = res.body['openai/gpt-4'];
    expect(model).toBeTruthy();
    expect(model.inputTokens).toBe(100);
    expect(model.outputTokens).toBe(50);
    expect(model.cacheReadTokens).toBe(10);
    expect(model.totalCost).toBe(0.01);
    expect(model.agents.agent1.inputTokens).toBe(100);
  });

  it('uses currentModel from model_change when message has no model', async () => {
    helpers.safeReaddir.mockImplementation((dp) => {
      if (dp.endsWith('agents')) return ['a1'];
      return ['s.jsonl'];
    });
    fs.statSync.mockReturnValue({ mtimeMs: Date.now() });
    const lines = [
      JSON.stringify({ type: 'model_change', modelId: 'anthropic/claude' }),
      JSON.stringify({ type: 'message', message: { usage: { input: 10, output: 5 } } }),
    ];
    helpers.safeRead.mockReturnValue(lines.join('\n'));
    const res = await request(createApp()).get('/api/model-usage');
    expect(res.body['anthropic/claude']).toBeTruthy();
    expect(res.body['anthropic/claude'].inputTokens).toBe(10);
  });
});

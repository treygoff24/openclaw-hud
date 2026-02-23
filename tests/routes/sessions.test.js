import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const helpers = require('../../lib/helpers');

helpers.OPENCLAW_HOME = '/mock/home';
helpers.safeJSON = vi.fn();
helpers.safeReaddir = vi.fn(() => []);
helpers.safeRead = vi.fn();
helpers.getSessionStatus = vi.fn(() => 'active');

function createApp() {
  delete require.cache[require.resolve('../../routes/sessions')];
  const router = require('../../routes/sessions');
  const app = express();
  app.use(router);
  return app;
}

describe('GET /api/sessions', () => {
  beforeEach(() => { vi.clearAllMocks(); helpers.getSessionStatus.mockReturnValue('active'); });

  it('returns empty array when no agents exist', async () => {
    helpers.safeReaddir.mockReturnValue([]);
    const res = await request(createApp()).get('/api/sessions');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns sessions from multiple agents sorted by updatedAt', async () => {
    const now = Date.now();
    helpers.safeReaddir.mockReturnValue(['a1', 'a2']);
    helpers.safeJSON.mockImplementation((fp) => {
      if (fp.includes('a1')) return { 'k1': { sessionId: 's1', updatedAt: now - 2000 } };
      if (fp.includes('a2')) return { 'k2': { sessionId: 's2', updatedAt: now - 1000 } };
      return null;
    });
    const res = await request(createApp()).get('/api/sessions');
    expect(res.body).toHaveLength(2);
    expect(res.body[0].key).toBe('k2');
    expect(res.body[0].agentId).toBe('a2');
  });

  it('filters out sessions older than 24 hours', async () => {
    const now = Date.now();
    helpers.safeReaddir.mockReturnValue(['a1']);
    helpers.safeJSON.mockReturnValue({
      'recent': { sessionId: 's1', updatedAt: now - 1000 },
      'old': { sessionId: 's2', updatedAt: now - 90000000 },
    });
    const res = await request(createApp()).get('/api/sessions');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].key).toBe('recent');
  });

  it('limits results to 100 sessions', async () => {
    const now = Date.now();
    helpers.safeReaddir.mockReturnValue(['a1']);
    const sessions = {};
    for (let i = 0; i < 150; i++) sessions[`k${i}`] = { sessionId: `s${i}`, updatedAt: now - i * 1000 };
    helpers.safeJSON.mockReturnValue(sessions);
    const res = await request(createApp()).get('/api/sessions');
    expect(res.body).toHaveLength(100);
  });

  it('derives sessionId from canonical key when not in raw data', async () => {
    const now = Date.now();
    helpers.safeReaddir.mockReturnValue(['a1']);
    helpers.safeJSON.mockReturnValue({
      'agent:a1:abc123': { updatedAt: now, label: 'test' },
    });
    const res = await request(createApp()).get('/api/sessions');
    expect(res.body[0].sessionId).toBe('abc123');
  });

  it('preserves sessionId from raw data when present', async () => {
    const now = Date.now();
    helpers.safeReaddir.mockReturnValue(['a1']);
    helpers.safeJSON.mockReturnValue({
      'agent:a1:abc123': { sessionId: 'explicit-id', updatedAt: now },
    });
    const res = await request(createApp()).get('/api/sessions');
    expect(res.body[0].sessionId).toBe('explicit-id');
  });

  it('handles sessionId with colons in key', async () => {
    const now = Date.now();
    helpers.safeReaddir.mockReturnValue(['a1']);
    helpers.safeJSON.mockReturnValue({
      'agent:a1:uuid:with:colons': { updatedAt: now },
    });
    const res = await request(createApp()).get('/api/sessions');
    expect(res.body[0].sessionId).toBe('uuid:with:colons');
  });

  it('includes status from getSessionStatus', async () => {
    const now = Date.now();
    helpers.safeReaddir.mockReturnValue(['a1']);
    helpers.safeJSON.mockReturnValue({ 'k1': { sessionId: 's1', updatedAt: now } });
    helpers.getSessionStatus.mockReturnValue('warm');
    const res = await request(createApp()).get('/api/sessions');
    expect(res.body[0].status).toBe('warm');
  });
});

describe('GET /api/session-log/:agentId/:sessionId', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('rejects invalid agentId with path traversal', async () => {
    // Express normalizes `..` in paths so the route param won't contain `..`
    // Instead test with characters that fail the regex
    const res = await request(createApp()).get('/api/session-log/agent%20bad/sess1');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid parameters');
  });

  it('rejects sessionId with special characters', async () => {
    const res = await request(createApp()).get('/api/session-log/agent1/sess%20bad');
    expect(res.status).toBe(400);
  });

  it('returns empty array when log file does not exist', async () => {
    helpers.safeRead.mockReturnValue(null);
    const res = await request(createApp()).get('/api/session-log/agent1/sess1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns parsed JSONL entries limited to last N lines', async () => {
    const lines = Array.from({ length: 100 }, (_, i) => JSON.stringify({ type: 'msg', idx: i }));
    helpers.safeRead.mockReturnValue(lines.join('\n'));
    const res = await request(createApp()).get('/api/session-log/agent1/sess1?limit=10');
    expect(res.body).toHaveLength(10);
    expect(res.body[0].idx).toBe(90);
  });

  it('defaults to 50 entries when no limit specified', async () => {
    const lines = Array.from({ length: 80 }, (_, i) => JSON.stringify({ type: 'msg', idx: i }));
    helpers.safeRead.mockReturnValue(lines.join('\n'));
    const res = await request(createApp()).get('/api/session-log/agent1/sess1');
    expect(res.body).toHaveLength(50);
  });

  it('skips malformed JSON lines gracefully', async () => {
    helpers.safeRead.mockReturnValue('{"valid":true}\nnot-json\n{"also":"valid"}');
    const res = await request(createApp()).get('/api/session-log/agent1/sess1');
    expect(res.body).toHaveLength(2);
  });
});

describe('GET /api/session-tree', () => {
  beforeEach(() => { vi.clearAllMocks(); helpers.getSessionStatus.mockReturnValue('active'); });

  it('returns sessions with child counts computed from spawnedBy links', async () => {
    const now = Date.now();
    helpers.safeReaddir.mockReturnValue(['a1']);
    helpers.safeJSON.mockReturnValue({
      'parent': { sessionId: 'p', updatedAt: now, spawnDepth: 0 },
      'child1': { sessionId: 'c1', updatedAt: now, spawnedBy: 'parent', spawnDepth: 1 },
      'child2': { sessionId: 'c2', updatedAt: now, spawnedBy: 'parent', spawnDepth: 1 },
    });
    const res = await request(createApp()).get('/api/session-tree');
    const parent = res.body.find(s => s.key === 'parent');
    expect(parent.childCount).toBe(2);
    const child = res.body.find(s => s.key === 'child1');
    expect(child.spawnedBy).toBe('parent');
    expect(child.childCount).toBe(0);
  });

  it('derives sessionId from canonical key in tree when not in raw data', async () => {
    const now = Date.now();
    helpers.safeReaddir.mockReturnValue(['a1']);
    helpers.safeJSON.mockReturnValue({
      'agent:a1:tree-sess': { updatedAt: now, spawnDepth: 0 },
    });
    const res = await request(createApp()).get('/api/session-tree');
    expect(res.body[0].sessionId).toBe('tree-sess');
  });

  it('nullifies spawnedBy when parent session does not exist', async () => {
    const now = Date.now();
    helpers.safeReaddir.mockReturnValue(['a1']);
    helpers.safeJSON.mockReturnValue({
      'orphan': { sessionId: 'o', updatedAt: now, spawnedBy: 'nonexistent', spawnDepth: 1 },
    });
    const res = await request(createApp()).get('/api/session-tree');
    expect(res.body[0].spawnedBy).toBeNull();
  });

  it('filters sessions older than 24 hours', async () => {
    const now = Date.now();
    helpers.safeReaddir.mockReturnValue(['a1']);
    helpers.safeJSON.mockReturnValue({
      'recent': { sessionId: 'r', updatedAt: now },
      'old': { sessionId: 'o', updatedAt: now - 90000000 },
    });
    const res = await request(createApp()).get('/api/session-tree');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].key).toBe('recent');
  });
});

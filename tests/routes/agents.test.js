import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const helpers = require('../../lib/helpers');
const fs = require('fs');

helpers.OPENCLAW_HOME = '/mock/home';
helpers.safeJSON = vi.fn();
helpers.safeReaddir = vi.fn(() => []);
fs.statSync = vi.fn(() => ({ isDirectory: () => true }));

function createApp() {
  delete require.cache[require.resolve('../../routes/agents')];
  const router = require('../../routes/agents');
  const app = express();
  app.use(router);
  return app;
}

describe('GET /api/agents', () => {
  beforeEach(() => { vi.clearAllMocks(); fs.statSync.mockReturnValue({ isDirectory: () => true }); });

  it('returns empty array when no agents exist', async () => {
    helpers.safeReaddir.mockReturnValue([]);
    const res = await request(createApp()).get('/api/agents');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns agents with session metadata sorted by most recent', async () => {
    helpers.safeReaddir.mockReturnValue(['bot-a', 'bot-b']);
    const now = Date.now();
    helpers.safeJSON.mockImplementation((fp) => {
      if (fp.includes('bot-a')) return { 'sess-1': { sessionId: 's1', updatedAt: now - 1000, label: 'test', spawnDepth: 0 } };
      if (fp.includes('bot-b')) return { 'sess-2': { sessionId: 's2', updatedAt: now - 500, label: 'newer' } };
      return null;
    });
    const res = await request(createApp()).get('/api/agents');
    expect(res.body).toHaveLength(2);
    expect(res.body[0].id).toBe('bot-b');
    expect(res.body[1].id).toBe('bot-a');
    expect(res.body[0].sessionCount).toBe(1);
  });

  it('counts active sessions correctly (within 1 hour)', async () => {
    helpers.safeReaddir.mockReturnValue(['agent1']);
    const now = Date.now();
    helpers.safeJSON.mockReturnValue({
      's1': { sessionId: 's1', updatedAt: now - 1000 },
      's2': { sessionId: 's2', updatedAt: now - 7200000 },
    });
    const res = await request(createApp()).get('/api/agents');
    expect(res.body[0].activeSessions).toBe(1);
    expect(res.body[0].sessionCount).toBe(2);
  });

  it('filters out non-directory entries', async () => {
    helpers.safeReaddir.mockReturnValue(['agent1', 'file.txt']);
    fs.statSync.mockImplementation((fp) => ({ isDirectory: () => !fp.includes('file.txt') }));
    helpers.safeJSON.mockReturnValue(null);
    const res = await request(createApp()).get('/api/agents');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('agent1');
  });

  it('handles missing sessions.json gracefully', async () => {
    helpers.safeReaddir.mockReturnValue(['agent1']);
    helpers.safeJSON.mockReturnValue(null);
    const res = await request(createApp()).get('/api/agents');
    expect(res.body[0].sessions).toEqual([]);
    expect(res.body[0].sessionCount).toBe(0);
  });
});

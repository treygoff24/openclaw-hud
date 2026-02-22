import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const helpers = require('../../lib/helpers');
const fs = require('fs');

helpers.OPENCLAW_HOME = '/mock/home';
helpers.safeJSON = vi.fn();
helpers.safeJSON5 = vi.fn();
helpers.stripSecrets = vi.fn(obj => obj);
fs.copyFileSync = vi.fn();
fs.writeFileSync = vi.fn();

function createApp() {
  delete require.cache[require.resolve('../../routes/cron')];
  const router = require('../../routes/cron');
  const app = express();
  app.use(router);
  return app;
}

describe('GET /api/cron', () => {
  beforeEach(() => { vi.clearAllMocks(); helpers.stripSecrets.mockImplementation(obj => obj); });

  it('returns enriched jobs with default model info', async () => {
    helpers.safeJSON.mockReturnValue({ version: 2, jobs: [
      { id: 'job1', name: 'Test', enabled: true, schedule: '*/5 * * * *' },
    ]});
    helpers.safeJSON5.mockReturnValue({ agents: { defaults: { model: { primary: 'anthropic/claude' } } } });
    const res = await request(createApp()).get('/api/cron');
    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.jobs[0].defaultModel).toBe('anthropic/claude');
    expect(res.body.jobs[0].usesDefaultModel).toBe(true);
    expect(res.body.version).toBe(2);
  });

  it('returns empty jobs array when jobs.json is missing', async () => {
    helpers.safeJSON.mockReturnValue(null);
    helpers.safeJSON5.mockReturnValue(null);
    const res = await request(createApp()).get('/api/cron');
    expect(res.body.jobs).toEqual([]);
    expect(res.body.version).toBe(1);
  });

  it('marks job as not using default model when model override exists', async () => {
    helpers.safeJSON.mockReturnValue({ version: 1, jobs: [{ id: 'j1', payload: { model: 'openai/gpt-4' } }] });
    helpers.safeJSON5.mockReturnValue(null);
    const res = await request(createApp()).get('/api/cron');
    expect(res.body.jobs[0].usesDefaultModel).toBe(false);
    expect(res.body.jobs[0].modelOverride).toBe('openai/gpt-4');
  });
});

describe('PUT /api/cron/:jobId', () => {
  beforeEach(() => { vi.clearAllMocks(); fs.writeFileSync.mockImplementation(() => {}); });

  it('rejects invalid job ID characters', async () => {
    const res = await request(createApp()).put('/api/cron/bad%21id').send({ name: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid job ID');
  });

  it('returns 500 when jobs file cannot be read', async () => {
    helpers.safeJSON.mockReturnValue(null);
    const res = await request(createApp()).put('/api/cron/job1').send({ name: 'x' });
    expect(res.status).toBe(500);
  });

  it('returns 404 when job not found', async () => {
    helpers.safeJSON.mockReturnValue({ jobs: [{ id: 'other' }] });
    const res = await request(createApp()).put('/api/cron/missing').send({ name: 'x' });
    expect(res.status).toBe(404);
  });

  it('creates backup before writing', async () => {
    helpers.safeJSON.mockReturnValue({ jobs: [{ id: 'job1', name: 'old', payload: {} }] });
    await request(createApp()).put('/api/cron/job1').send({ name: 'new' });
    expect(fs.copyFileSync).toHaveBeenCalledWith(
      expect.stringContaining('jobs.json'),
      expect.stringContaining('jobs.json.bak')
    );
  });

  it('only updates editable fields, ignoring unknown fields', async () => {
    helpers.safeJSON.mockReturnValue({ jobs: [{ id: 'job1', name: 'old', payload: {}, internalField: 'keep' }] });
    await request(createApp()).put('/api/cron/job1').send({ name: 'new', id: 'hacked', internalField: 'evil' });
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    const job = written.jobs[0];
    expect(job.name).toBe('new');
    expect(job.id).toBe('job1');
    expect(job.internalField).toBe('keep');
  });

  it('auto-corrects payload.kind to systemEvent when sessionTarget is main', async () => {
    helpers.safeJSON.mockReturnValue({ jobs: [{ id: 'j1', sessionTarget: 'main', payload: { kind: 'agentTurn' } }] });
    await request(createApp()).put('/api/cron/j1').send({ sessionTarget: 'main' });
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    expect(written.jobs[0].payload.kind).toBe('systemEvent');
  });

  it('auto-corrects payload.kind to agentTurn when sessionTarget is isolated', async () => {
    helpers.safeJSON.mockReturnValue({ jobs: [{ id: 'j1', sessionTarget: 'isolated', payload: { kind: 'systemEvent' } }] });
    await request(createApp()).put('/api/cron/j1').send({ sessionTarget: 'isolated' });
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    expect(written.jobs[0].payload.kind).toBe('agentTurn');
  });

  it('returns the updated job on success', async () => {
    helpers.safeJSON.mockReturnValue({ jobs: [{ id: 'j1', name: 'old', schedule: '* * * * *', payload: {} }] });
    const res = await request(createApp()).put('/api/cron/j1').send({ name: 'updated', schedule: '0 * * * *' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.job.name).toBe('updated');
    expect(res.body.job.schedule).toBe('0 * * * *');
    expect(res.body.job.updatedAtMs).toBeGreaterThan(0);
  });

  it('returns 500 when write fails', async () => {
    helpers.safeJSON.mockReturnValue({ jobs: [{ id: 'j1', payload: {} }] });
    fs.writeFileSync.mockImplementation(() => { throw new Error('disk full'); });
    const res = await request(createApp()).put('/api/cron/j1').send({ name: 'x' });
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('Failed to write');
  });
});

describe('POST /api/cron/:jobId/toggle', () => {
  beforeEach(() => { vi.clearAllMocks(); fs.writeFileSync.mockImplementation(() => {}); });

  it('toggles enabled from true to false', async () => {
    helpers.safeJSON.mockReturnValue({ jobs: [{ id: 'j1', enabled: true }] });
    const res = await request(createApp()).post('/api/cron/j1/toggle');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  });

  it('toggles enabled from false to true', async () => {
    helpers.safeJSON.mockReturnValue({ jobs: [{ id: 'j1', enabled: false }] });
    const res = await request(createApp()).post('/api/cron/j1/toggle');
    expect(res.body.enabled).toBe(true);
  });

  it('rejects invalid job ID', async () => {
    const res = await request(createApp()).post('/api/cron/bad%21id/toggle');
    expect(res.status).toBe(400);
  });

  it('returns 404 for nonexistent job', async () => {
    helpers.safeJSON.mockReturnValue({ jobs: [] });
    const res = await request(createApp()).post('/api/cron/missing/toggle');
    expect(res.status).toBe(404);
  });

  it('creates backup before toggling', async () => {
    helpers.safeJSON.mockReturnValue({ jobs: [{ id: 'j1', enabled: true }] });
    await request(createApp()).post('/api/cron/j1/toggle');
    expect(fs.copyFileSync).toHaveBeenCalled();
  });
});

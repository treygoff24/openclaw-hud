import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TMPDIR = path.join(os.tmpdir(), 'helpers-cjs-test-' + Date.now());
fs.mkdirSync(TMPDIR, { recursive: true });

afterAll(() => {
  fs.rmSync(TMPDIR, { recursive: true, force: true });
});

// Use require() to load the CJS module — this ensures V8 instruments the CJS path
const helpers = require('../../lib/helpers.js');

describe('helpers via CJS require()', () => {
  it('safeRead returns content for existing file', () => {
    const fp = path.join(TMPDIR, 'test.txt');
    fs.writeFileSync(fp, 'data');
    expect(helpers.safeRead(fp)).toBe('data');
  });

  it('safeRead returns null for missing file', () => {
    expect(helpers.safeRead(path.join(TMPDIR, 'nope'))).toBeNull();
  });

  it('safeJSON parses valid JSON', () => {
    const fp = path.join(TMPDIR, 'data.json');
    fs.writeFileSync(fp, '{"x":1}');
    expect(helpers.safeJSON(fp)).toEqual({ x: 1 });
  });

  it('safeJSON returns null for invalid', () => {
    expect(helpers.safeJSON(path.join(TMPDIR, 'nope'))).toBeNull();
  });

  it('safeJSON5 parses JSON5', () => {
    const fp = path.join(TMPDIR, 'c.json5');
    fs.writeFileSync(fp, '{ key: "val", }');
    expect(helpers.safeJSON5(fp)).toEqual({ key: 'val' });
  });

  it('safeReaddir returns entries', () => {
    const dp = path.join(TMPDIR, 'dir');
    fs.mkdirSync(dp, { recursive: true });
    fs.writeFileSync(path.join(dp, 'a'), '');
    expect(helpers.safeReaddir(dp)).toContain('a');
  });

  it('stripSecrets removes keys', () => {
    expect(helpers.stripSecrets({ apiKey: 'x', name: 'ok' })).toEqual({ name: 'ok' });
  });

  it('getSessionStatus returns active for recent', () => {
    expect(helpers.getSessionStatus({ updatedAt: Date.now() })).toBe('active');
  });

  it('getSessionStatus returns warm', () => {
    expect(helpers.getSessionStatus({ updatedAt: Date.now() - 6 * 60 * 1000 })).toBe('warm');
  });

  it('getSessionStatus returns stale', () => {
    expect(helpers.getSessionStatus({ updatedAt: Date.now() - 2 * 60 * 60 * 1000 })).toBe('stale');
  });

  it('getSessionStatus returns completed for subagent', () => {
    expect(helpers.getSessionStatus({ updatedAt: Date.now() - 6 * 60 * 1000, spawnDepth: 1 })).toBe('completed');
  });

  it('getGatewayConfig returns port and token', () => {
    const cfg = helpers.getGatewayConfig();
    expect(typeof cfg.port).toBe('number');
    expect(cfg).toHaveProperty('token');
  });

  it('OPENCLAW_HOME is defined', () => {
    expect(typeof helpers.OPENCLAW_HOME).toBe('string');
  });

  it('enrichSessionMetadata uses provided aliases without reading config', () => {
    const originalGetModelAliasMap = helpers.getModelAliasMap;
    const getModelAliasMapMock = vi.fn(() => ({}));
    helpers.getModelAliasMap = getModelAliasMapMock;

    const metadata = helpers.enrichSessionMetadata(
      'main',
      { model: 'openai/gpt-4o' },
      {
        sessionKey: 'agent:test:main',
        modelAliases: {
          'openai/gpt-4o': { alias: 'gpt4o' }
        }
      }
    );

    expect(metadata.modelLabel).toBe('gpt4o');
    expect(getModelAliasMapMock).not.toHaveBeenCalled();
    helpers.getModelAliasMap = originalGetModelAliasMap;
  });
});

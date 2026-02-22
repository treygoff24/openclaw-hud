import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Use real temp files since CJS fs mocking is unreliable
const TMPDIR = path.join(os.tmpdir(), 'helpers-test-' + Date.now());
fs.mkdirSync(TMPDIR, { recursive: true });

afterAll(() => {
  fs.rmSync(TMPDIR, { recursive: true, force: true });
});

const {
  safeRead,
  safeJSON,
  safeJSON5,
  safeReaddir,
  stripSecrets,
  getSessionStatus,
  getGatewayConfig,
  OPENCLAW_HOME
} = await import('../../lib/helpers.js');

// --------------- safeRead ---------------
describe('safeRead', () => {
  it('returns file content as string when file exists', () => {
    const fp = path.join(TMPDIR, 'read.txt');
    fs.writeFileSync(fp, 'hello world');
    expect(safeRead(fp)).toBe('hello world');
  });

  it('returns null when file does not exist', () => {
    expect(safeRead(path.join(TMPDIR, 'nonexistent'))).toBeNull();
  });

  it('returns null on error (directory path)', () => {
    const dp = path.join(TMPDIR, 'adir');
    fs.mkdirSync(dp, { recursive: true });
    expect(safeRead(dp)).toBeNull();
  });
});

// --------------- safeJSON ---------------
describe('safeJSON', () => {
  it('parses valid JSON file', () => {
    const fp = path.join(TMPDIR, 'data.json');
    fs.writeFileSync(fp, '{"a":1,"b":"two"}');
    expect(safeJSON(fp)).toEqual({ a: 1, b: 'two' });
  });

  it('returns null for non-existent file', () => {
    expect(safeJSON(path.join(TMPDIR, 'nope.json'))).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    const fp = path.join(TMPDIR, 'bad.json');
    fs.writeFileSync(fp, '{bad json!!!}');
    expect(safeJSON(fp)).toBeNull();
  });
});

// --------------- safeJSON5 ---------------
describe('safeJSON5', () => {
  it('parses valid JSON5 with comments, trailing commas, unquoted keys', () => {
    const fp = path.join(TMPDIR, 'config.json5');
    fs.writeFileSync(fp, `{
      // a comment
      name: "test",
      value: 42,
      items: [1, 2, 3,],
    }`);
    expect(safeJSON5(fp)).toEqual({ name: 'test', value: 42, items: [1, 2, 3] });
  });

  it('returns null for non-existent file', () => {
    expect(safeJSON5(path.join(TMPDIR, 'nope.json5'))).toBeNull();
  });

  it('returns null for completely invalid content', () => {
    const fp = path.join(TMPDIR, 'garbage');
    fs.writeFileSync(fp, 'not even close {{{{');
    expect(safeJSON5(fp)).toBeNull();
  });
});

// --------------- safeReaddir ---------------
describe('safeReaddir', () => {
  it('returns array of entries for valid directory', () => {
    const dp = path.join(TMPDIR, 'mydir');
    fs.mkdirSync(dp, { recursive: true });
    fs.writeFileSync(path.join(dp, 'a.txt'), 'a');
    fs.writeFileSync(path.join(dp, 'b.txt'), 'b');
    const result = safeReaddir(dp);
    expect(result.sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('returns empty array for non-existent directory', () => {
    expect(safeReaddir(path.join(TMPDIR, 'nope'))).toEqual([]);
  });
});

// --------------- stripSecrets ---------------
describe('stripSecrets', () => {
  it('removes secret keys', () => {
    const obj = { apiKey: '123', token: 'abc', password: 'pw', secret: 's', authorization: 'a', credential: 'c', private_key: 'pk', signing_key: 'sk', name: 'keep' };
    expect(stripSecrets(obj)).toEqual({ name: 'keep' });
  });

  it('is case insensitive (matches regex substrings)', () => {
    expect(stripSecrets({ Token: 'y', PASSWORD: 'z', name: 'ok' })).toEqual({ name: 'ok' });
    expect(stripSecrets({ myApiKey: 'x', authToken: 'y', id: 1 })).toEqual({ id: 1 });
  });

  it('preserves non-secret keys', () => {
    expect(stripSecrets({ host: 'h', port: 8080 })).toEqual({ host: 'h', port: 8080 });
  });

  it('handles nested objects (strips secrets at any depth)', () => {
    const obj = { config: { apiKey: 'x', host: 'h' }, name: 'test' };
    expect(stripSecrets(obj)).toEqual({ config: { host: 'h' }, name: 'test' });
  });

  it('handles arrays of objects', () => {
    const arr = [{ token: 'x', id: 1 }, { secret: 'y', id: 2 }];
    expect(stripSecrets(arr)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('returns primitives as-is', () => {
    expect(stripSecrets('hello')).toBe('hello');
    expect(stripSecrets(42)).toBe(42);
    expect(stripSecrets(undefined)).toBeUndefined();
  });

  it('returns null for null input', () => {
    expect(stripSecrets(null)).toBeNull();
  });

  it('handles empty object', () => {
    expect(stripSecrets({})).toEqual({});
  });
});

// --------------- getSessionStatus ---------------
describe('getSessionStatus', () => {
  const FIVE_MIN = 5 * 60 * 1000;
  const ONE_HOUR = 60 * 60 * 1000;

  it('returns active when updatedAt < 5 minutes ago', () => {
    expect(getSessionStatus({ updatedAt: Date.now() - 1000 })).toBe('active');
  });

  it('returns completed when spawnDepth > 0 and age >= 5 min', () => {
    expect(getSessionStatus({ updatedAt: Date.now() - FIVE_MIN - 1, spawnDepth: 1 })).toBe('completed');
  });

  it('returns warm when age >= 5min but < 1 hour (non-subagent)', () => {
    expect(getSessionStatus({ updatedAt: Date.now() - FIVE_MIN - 1 })).toBe('warm');
  });

  it('returns stale when age >= 1 hour', () => {
    expect(getSessionStatus({ updatedAt: Date.now() - ONE_HOUR - 1 })).toBe('stale');
  });

  it('returns stale for missing updatedAt', () => {
    expect(getSessionStatus({})).toBe('stale');
  });

  it('boundary: exactly at 5 min is warm (not active) for non-subagent', () => {
    expect(getSessionStatus({ updatedAt: Date.now() - FIVE_MIN })).toBe('warm');
  });

  it('boundary: exactly at 5 min is completed for subagent', () => {
    expect(getSessionStatus({ updatedAt: Date.now() - FIVE_MIN, spawnDepth: 2 })).toBe('completed');
  });

  it('boundary: exactly at 1 hour is stale', () => {
    expect(getSessionStatus({ updatedAt: Date.now() - ONE_HOUR })).toBe('stale');
  });
});

// --------------- getGatewayConfig ---------------
describe('getGatewayConfig', () => {
  const savedToken = process.env.OPENCLAW_GATEWAY_TOKEN;

  beforeEach(() => {
    delete process.env.OPENCLAW_GATEWAY_TOKEN;
  });

  afterAll(() => {
    if (savedToken !== undefined) process.env.OPENCLAW_GATEWAY_TOKEN = savedToken;
    else delete process.env.OPENCLAW_GATEWAY_TOKEN;
  });

  it('returns port and token from config (reads real source-of-truth)', () => {
    // getGatewayConfig reads OPENCLAW_HOME/config/source-of-truth.json5
    // We test it returns an object with port (number) and token (string or null)
    const cfg = getGatewayConfig();
    expect(cfg).toHaveProperty('port');
    expect(typeof cfg.port).toBe('number');
    expect(cfg).toHaveProperty('token');
  });

  it('respects OPENCLAW_GATEWAY_TOKEN env var override', () => {
    process.env.OPENCLAW_GATEWAY_TOKEN = 'test-env-override-token';
    const cfg = getGatewayConfig();
    expect(cfg.token).toBe('test-env-override-token');
  });
});

// --------------- OPENCLAW_HOME ---------------
describe('OPENCLAW_HOME', () => {
  it('is a string ending with .openclaw', () => {
    expect(OPENCLAW_HOME).toMatch(/\.openclaw$/);
  });
});

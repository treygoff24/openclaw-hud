import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TMP_ROOT = path.join(os.tmpdir(), `usage-archive-test-${Date.now()}`);

beforeEach(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe('usage archive', () => {
  it('writes a weekly snapshot immutably and reads it back', async () => {
    const { writeWeeklySnapshot, readWeeklySnapshot } = await import('../../lib/usage-archive.js');
    const snapshot = {
      meta: {
        period: 'weekly',
        weekStart: '2026-02-15T06:00:00.000Z',
        generatedAt: '2026-02-22T06:00:05.000Z',
        source: 'sessions.usage+config-reprice',
      },
      models: [{ provider: 'openai', model: 'gpt-5', totalTokens: 10, totalCost: 0.1 }],
      totals: { totalTokens: 10, totalCost: 0.1 },
    };

    const writeResult = writeWeeklySnapshot(snapshot, { openclawHome: TMP_ROOT });
    expect(writeResult.weekKey).toBe('2026-02-15');
    expect(fs.existsSync(writeResult.path)).toBe(true);

    const loaded = readWeeklySnapshot('2026-02-15', { openclawHome: TMP_ROOT });
    expect(loaded).toEqual(snapshot);
  });

  it('fails when trying to overwrite an existing week snapshot', async () => {
    const { writeWeeklySnapshot } = await import('../../lib/usage-archive.js');
    const snapshot = {
      meta: {
        period: 'weekly',
        weekStart: '2026-02-15T06:00:00.000Z',
        generatedAt: '2026-02-22T06:00:05.000Z',
      },
      models: [],
      totals: { totalTokens: 0, totalCost: 0 },
    };

    writeWeeklySnapshot(snapshot, { openclawHome: TMP_ROOT });

    expect(() => writeWeeklySnapshot(snapshot, { openclawHome: TMP_ROOT })).toThrow(/already exists|EEXIST/i);
  });

  it('returns null when reading a missing week snapshot', async () => {
    const { readWeeklySnapshot } = await import('../../lib/usage-archive.js');
    expect(readWeeklySnapshot('2026-02-15', { openclawHome: TMP_ROOT })).toBeNull();
  });

  it('reads history in newest-first order and ignores malformed files', async () => {
    const { writeWeeklySnapshot, readWeeklyHistory, getUsageArchiveDir } = await import('../../lib/usage-archive.js');

    writeWeeklySnapshot(
      {
        meta: {
          period: 'weekly',
          weekStart: '2026-02-08T06:00:00.000Z',
          generatedAt: '2026-02-15T06:00:05.000Z',
        },
        models: [],
        totals: { totalTokens: 1, totalCost: 1 },
      },
      { openclawHome: TMP_ROOT },
    );

    writeWeeklySnapshot(
      {
        meta: {
          period: 'weekly',
          weekStart: '2026-02-15T06:00:00.000Z',
          generatedAt: '2026-02-22T06:00:05.000Z',
        },
        models: [],
        totals: { totalTokens: 2, totalCost: 2 },
      },
      { openclawHome: TMP_ROOT },
    );

    const archiveDir = getUsageArchiveDir({ openclawHome: TMP_ROOT });
    fs.writeFileSync(path.join(archiveDir, 'garbage.json'), '{ this is not valid json');
    fs.writeFileSync(path.join(archiveDir, 'README.txt'), 'not-a-snapshot');

    const history = readWeeklyHistory({ openclawHome: TMP_ROOT });
    expect(history).toHaveLength(2);
    expect(history[0].meta.weekStart).toBe('2026-02-15T06:00:00.000Z');
    expect(history[1].meta.weekStart).toBe('2026-02-08T06:00:00.000Z');
  });
});

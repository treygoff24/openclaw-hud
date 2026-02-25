import { describe, it, expect, vi } from 'vitest';

const { getArchiveWeekWindow, archiveWeeklyUsage } = await import('../../scripts/weekly-usage-archive.js');

describe('weekly usage archive script', () => {
  it('selects the just-ended previous week when run Sunday shortly after midnight', () => {
    const tz = 'America/Chicago';
    const nowMs = Date.parse('2026-02-22T00:05:00-06:00'); // Sunday 00:05 local

    const window = getArchiveWeekWindow(tz, nowMs);

    expect(window.fromMs).toBe(Date.parse('2026-02-15T00:00:00-06:00'));
    expect(window.toMs).toBe(Date.parse('2026-02-22T00:00:00-06:00'));
  });

  it('treats EEXIST archive writes as idempotent success in cron flow', async () => {
    const requestSessionsUsage = vi.fn().mockResolvedValue({ ok: true, result: { rows: [] } });
    const loadPricingCatalog = vi.fn(() => ({ providers: {} }));
    const repriceModelUsageRows = vi.fn((rows) => ({ rows, missingPricingModels: [] }));
    const writeWeeklySnapshot = vi.fn(() => {
      const err = new Error('file exists');
      err.code = 'EEXIST';
      throw err;
    });

    const result = await archiveWeeklyUsage(
      {
        tz: 'America/Chicago',
        nowMs: Date.parse('2026-02-22T00:05:00-06:00'),
      },
      {
        requestSessionsUsage,
        loadPricingCatalog,
        repriceModelUsageRows,
        writeWeeklySnapshot,
      },
    );

    expect(result.ok).toBe(true);
    expect(result.alreadyArchived).toBe(true);
    expect(writeWeeklySnapshot).toHaveBeenCalledTimes(1);
    expect(requestSessionsUsage).toHaveBeenCalledWith({
      from: Date.parse('2026-02-15T00:00:00-06:00'),
      to: Date.parse('2026-02-22T00:00:00-06:00'),
      timezone: 'America/Chicago',
    });
  });
});

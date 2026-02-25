import { describe, it, expect } from 'vitest';

const {
  isObject,
  normalizeModelRow,
  collectUsageRows,
} = await import('../../lib/usage-normalize.js');

describe('usage normalize helpers', () => {
  it('normalizes provider/model/tokens/cost from flexible row shapes', () => {
    const row = {
      model: 'openai/gpt-5',
      totals: {
        input: 7,
        output: 11,
        cacheRead: 3,
        cacheWrite: 2,
      },
      cost: { total: 9 },
    };

    const normalized = normalizeModelRow(row);

    expect(normalized).toMatchObject({
      provider: 'openai',
      model: 'openai/gpt-5',
      inputTokens: 7,
      outputTokens: 11,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
      totalTokens: 23,
      totalCost: 9,
    });
  });

  it('prefers totals.totalCost when both totals.totalCost and sourceRow.cost.total exist', () => {
    const normalized = normalizeModelRow({
      model: 'openai/gpt-5',
      totals: {
        totalCost: 12.34,
      },
      cost: {
        total: 99.99,
      },
    });

    expect(normalized.totalCost).toBe(12.34);
  });

  it('collects rows from result.rows or aggregates.byModel with null-safe fallback', () => {
    expect(collectUsageRows({ result: { rows: [{ model: 'a' }] } })).toEqual([{ model: 'a' }]);
    expect(collectUsageRows({ result: { aggregates: { byModel: [{ model: 'b' }] } } })).toEqual([{ model: 'b' }]);
    expect(collectUsageRows({ result: null })).toEqual([]);
    expect(collectUsageRows(null)).toEqual([]);
  });

  it('isObject only accepts non-array objects', () => {
    expect(isObject({})).toBe(true);
    expect(isObject([])).toBe(false);
    expect(isObject(null)).toBe(false);
    expect(isObject('x')).toBe(false);
  });
});

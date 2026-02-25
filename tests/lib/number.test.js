// @vitest-environment node
import { describe, it, expect } from 'vitest';

const { toFiniteNumber } = require('../../lib/number');

describe('toFiniteNumber', () => {
  it('returns the numeric value when coercion is finite', () => {
    expect(toFiniteNumber(42)).toBe(42);
    expect(toFiniteNumber('3.14')).toBe(3.14);
    expect(toFiniteNumber(null)).toBe(0);
    expect(toFiniteNumber('')).toBe(0);
  });

  it('returns 0 for non-finite values', () => {
    expect(toFiniteNumber(undefined)).toBe(0);
    expect(toFiniteNumber('not-a-number')).toBe(0);
    expect(toFiniteNumber(NaN)).toBe(0);
    expect(toFiniteNumber(Infinity)).toBe(0);
    expect(toFiniteNumber(-Infinity)).toBe(0);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function loadScript(relativePath) {
  const code = readFileSync(join(__dirname, '../../public', relativePath), 'utf-8');
  // Use eval so top-level function declarations become globals (window.escapeHtml)
  const script = new Function(code);
  script();
  // escapeHtml is a function declaration — in new Function scope it's local.
  // Re-execute with indirect eval to get it into global scope.
  (0, eval)(code);
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.HUD = {};
  loadScript('utils.js');
});

describe('escapeHtml', () => {
  it('returns empty string for null', () => {
    expect(escapeHtml(null)).toBe('');
  });
  it('returns empty string for undefined', () => {
    expect(escapeHtml(undefined)).toBe('');
  });
  it('escapes < and >', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });
  it('escapes &', () => {
    expect(escapeHtml('a&b')).toBe('a&amp;b');
  });
  it('preserves " in output (textContent→innerHTML does not escape quotes)', () => {
    const result = escapeHtml('"hello"');
    expect(result).toBe('"hello"');
  });
  it('preserves single quotes in output', () => {
    const result = escapeHtml("it's");
    expect(result).toBe("it's");
  });
  it('passes through plain text', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});

describe('HUD.utils.timeAgo', () => {
  it('returns — for falsy values', () => {
    expect(HUD.utils.timeAgo(0)).toBe('—');
    expect(HUD.utils.timeAgo(null)).toBe('—');
    expect(HUD.utils.timeAgo(undefined)).toBe('—');
  });
  it('returns seconds ago', () => {
    const result = HUD.utils.timeAgo(Date.now() - 30000);
    expect(result).toBe('30s ago');
  });
  it('returns minutes ago', () => {
    const result = HUD.utils.timeAgo(Date.now() - 120000);
    expect(result).toBe('2m ago');
  });
  it('returns hours ago', () => {
    const result = HUD.utils.timeAgo(Date.now() - 7200000);
    expect(result).toBe('2h ago');
  });
  it('returns days ago', () => {
    const result = HUD.utils.timeAgo(Date.now() - 172800000);
    expect(result).toBe('2d ago');
  });
  it('boundary: 59s is seconds', () => {
    const result = HUD.utils.timeAgo(Date.now() - 59000);
    expect(result).toBe('59s ago');
  });
  it('boundary: 60s is minutes', () => {
    const result = HUD.utils.timeAgo(Date.now() - 60000);
    expect(result).toBe('1m ago');
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';

window.HUD = window.HUD || {};
await import('../../public/utils.js');

describe('escapeHtml', () => {
  it('returns empty string for null', () => {
    expect(window.escapeHtml(null)).toBe('');
  });
  it('returns empty string for undefined', () => {
    expect(window.escapeHtml(undefined)).toBe('');
  });
  it('escapes < and >', () => {
    expect(window.escapeHtml('<script>')).toBe('&lt;script&gt;');
  });
  it('escapes &', () => {
    expect(window.escapeHtml('a&b')).toBe('a&amp;b');
  });
  it('preserves " in output', () => {
    expect(window.escapeHtml('"hello"')).toBe('"hello"');
  });
  it('preserves single quotes', () => {
    expect(window.escapeHtml("it's")).toBe("it's");
  });
  it('passes through plain text', () => {
    expect(window.escapeHtml('hello world')).toBe('hello world');
  });
});

describe('HUD.utils.timeAgo', () => {
  it('returns — for falsy values', () => {
    expect(HUD.utils.timeAgo(0)).toBe('—');
    expect(HUD.utils.timeAgo(null)).toBe('—');
    expect(HUD.utils.timeAgo(undefined)).toBe('—');
  });
  it('returns seconds ago', () => {
    expect(HUD.utils.timeAgo(Date.now() - 30000)).toBe('30s ago');
  });
  it('returns minutes ago', () => {
    expect(HUD.utils.timeAgo(Date.now() - 120000)).toBe('2m ago');
  });
  it('returns hours ago', () => {
    expect(HUD.utils.timeAgo(Date.now() - 7200000)).toBe('2h ago');
  });
  it('returns days ago', () => {
    expect(HUD.utils.timeAgo(Date.now() - 172800000)).toBe('2d ago');
  });
  it('boundary: 59s is seconds', () => {
    expect(HUD.utils.timeAgo(Date.now() - 59000)).toBe('59s ago');
  });
  it('boundary: 60s is minutes', () => {
    expect(HUD.utils.timeAgo(Date.now() - 60000)).toBe('1m ago');
  });
});

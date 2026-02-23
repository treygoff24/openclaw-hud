// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock marked and DOMPurify globally
window.marked = { parse: vi.fn(t => '<p>' + t + '</p>'), setOptions: vi.fn(), use: vi.fn() };
window.DOMPurify = { sanitize: vi.fn(t => t) };
window.escapeHtml = function(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };

await import('../../public/chat-markdown.js');

describe('ChatMarkdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes renderMarkdown and renderPlainText', () => {
    expect(typeof window.ChatMarkdown.renderMarkdown).toBe('function');
    expect(typeof window.ChatMarkdown.renderPlainText).toBe('function');
  });

  it('renderMarkdown calls marked.parse and DOMPurify.sanitize', () => {
    const result = window.ChatMarkdown.renderMarkdown('hello **world**');
    expect(window.marked.parse).toHaveBeenCalledWith('hello **world**');
    expect(window.DOMPurify.sanitize).toHaveBeenCalled();
  });

  it('renderMarkdown returns empty string for empty input', () => {
    expect(window.ChatMarkdown.renderMarkdown('')).toBe('');
    expect(window.ChatMarkdown.renderMarkdown(null)).toBe('');
  });

  it('renderPlainText escapes HTML', () => {
    const result = window.ChatMarkdown.renderPlainText('<script>alert("xss")</script>');
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('renderPlainText handles empty input', () => {
    expect(window.ChatMarkdown.renderPlainText('')).toBe('');
    expect(window.ChatMarkdown.renderPlainText(null)).toBe('');
  });

  it('initMarked calls marked.setOptions', () => {
    window.ChatMarkdown.initMarked();
    expect(window.marked.setOptions).toHaveBeenCalledWith({ gfm: true, breaks: true });
  });
});

describe('ChatMarkdown fallback', () => {
  it('falls back to escapeHtml when marked is unavailable', async () => {
    const origMarked = window.marked;
    const origPurify = window.DOMPurify;
    delete window.marked;
    delete window.DOMPurify;
    delete window.ChatMarkdown;
    await import('../../public/chat-markdown.js?nomarked');
    const result = window.ChatMarkdown.renderMarkdown('<b>test</b>');
    expect(result).toContain('&lt;b&gt;');
    window.marked = origMarked;
    window.DOMPurify = origPurify;
  });

  it('warns and falls back when DOMPurify missing but marked present', async () => {
    const origMarked = window.marked;
    const origPurify = window.DOMPurify;
    window.marked = { parse: (t) => '<p>' + t + '</p>', setOptions: () => {}, use: () => {} };
    delete window.DOMPurify;
    delete window.ChatMarkdown;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await import('../../public/chat-markdown.js?nopurify');
    const result = window.ChatMarkdown.renderMarkdown('test');
    expect(result).toContain('test');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('DOMPurify not loaded'));
    warnSpy.mockRestore();
    window.marked = origMarked;
    window.DOMPurify = origPurify;
  });
});

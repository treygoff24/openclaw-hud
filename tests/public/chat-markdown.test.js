// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock marked and DOMPurify globally
window.marked = { parse: vi.fn(t => '<p>' + t + '</p>'), setOptions: vi.fn(), use: vi.fn() };
window.DOMPurify = { sanitize: vi.fn(t => t), addHook: vi.fn() };
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

describe('ChatMarkdown link rendering (v15 token semantics)', () => {
  it('uses token-object signature (href, title, tokens) not positional params', () => {
    // Verify the renderer.link function accepts a single token parameter
    const useCall = window.marked.use.mock.calls[0]?.[0];
    expect(useCall).toBeDefined();
    expect(useCall.renderer).toBeDefined();
    expect(useCall.renderer.link).toBeDefined();

    const linkFn = useCall.renderer.link;
    expect(linkFn.length).toBe(1); // Marked v15: single token parameter

    // Test with Marked v15-style token object
    const mockParser = { parseInline: vi.fn(tokens => tokens.map(t => t.text).join('')) };
    const mockToken = {
      href: 'https://example.com',
      title: 'Example Site',
      tokens: [{ type: 'text', text: 'Click Here' }]
    };

    const result = linkFn.call({ parser: mockParser }, mockToken);
    expect(result).toBe('<a href="https://example.com" target="_blank" rel="noopener noreferrer">Click Here</a>');
    expect(mockParser.parseInline).toHaveBeenCalledWith(mockToken.tokens);
  });

  it('blocks javascript: links and returns only the parsed text content', () => {
    const useCall = window.marked.use.mock.calls[0]?.[0];
    const linkFn = useCall.renderer.link;

    const mockParser = { parseInline: vi.fn(tokens => tokens.map(t => t.text).join('')) };
    const maliciousToken = {
      href: 'javascript:alert("xss")',
      title: 'Bad Link',
      tokens: [{ type: 'text', text: 'Click me' }]
    };

    const result = linkFn.call({ parser: mockParser }, maliciousToken);
    expect(result).toBe('Click me'); // Only text, no anchor tag
    expect(result).not.toContain('<a');
    expect(result).not.toContain('javascript:');
    expect(result).not.toContain('href=');
  });

  it('preserves javascript: blocking for case-insensitive variants', () => {
    const useCall = window.marked.use.mock.calls[0]?.[0];
    const linkFn = useCall.renderer.link;

    const mockParser = { parseInline: vi.fn(tokens => tokens.map(t => t.text).join('')) };
    const variants = [
      { href: 'javascript:alert(1)', text: 'lowercase' },
      { href: 'JAVASCRIPT:alert(1)', text: 'uppercase' },
      { href: 'JavaScript:alert(1)', text: 'mixed case' },
    ];

    for (const variant of variants) {
      const token = { href: variant.href, title: null, tokens: [{ type: 'text', text: variant.text }] };
      const result = linkFn.call({ parser: mockParser }, token);
      expect(result).toBe(variant.text);
      expect(result).not.toContain('<a');
    }
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

describe('ChatMarkdown code block copy button', () => {
  it('exposes copyCodeToClipboard function', () => {
    expect(typeof window.ChatMarkdown.copyCodeToClipboard).toBe('function');
  });

  it('code renderer uses custom wrapper with copy button', () => {
    const useCall = window.marked.use.mock.calls[0]?.[0];
    expect(useCall).toBeDefined();
    expect(useCall.renderer).toBeDefined();
    expect(useCall.renderer.code).toBeDefined();

    const codeFn = useCall.renderer.code;
    const result = codeFn({ text: 'console.log("hello")', lang: 'javascript' });
    
    expect(result).toContain('code-block-wrapper');
    expect(result).toContain('code-copy-btn');
    expect(result).toContain('data-code-id');
    expect(result).toContain('console.log');
    expect(result).toContain('language-javascript');
  });

  it('code renderer escapes HTML in code content', () => {
    const useCall = window.marked.use.mock.calls[0]?.[0];
    const codeFn = useCall.renderer.code;
    const result = codeFn({ text: '<script>alert(1)</script>', lang: '' });
    
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('copyCodeToClipboard returns false for unknown codeId', async () => {
    const result = await window.ChatMarkdown.copyCodeToClipboard('unknown-id');
    expect(result).toBe(false);
  });
});

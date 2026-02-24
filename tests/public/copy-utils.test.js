// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(''),
  },
});

await import('../../public/copy-utils.js');

describe('CopyUtils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('SVG constants', () => {
    it('exports COPY_ICON as an SVG string', () => {
      expect(window.CopyUtils.COPY_ICON).toContain('<svg');
      expect(window.CopyUtils.COPY_ICON).toContain('</svg>');
    });

    it('exports CHECK_ICON as an SVG string', () => {
      expect(window.CopyUtils.CHECK_ICON).toContain('<svg');
      expect(window.CopyUtils.CHECK_ICON).toContain('</svg>');
    });

    it('COPY_ICON and CHECK_ICON are different', () => {
      expect(window.CopyUtils.COPY_ICON).not.toBe(window.CopyUtils.CHECK_ICON);
    });
  });

  describe('createCopyButton', () => {
    it('returns a button element', () => {
      const btn = window.CopyUtils.createCopyButton('hello', 'Copy text');
      expect(btn.tagName).toBe('BUTTON');
    });

    it('has copy-btn class', () => {
      const btn = window.CopyUtils.createCopyButton('hello', 'Copy text');
      expect(btn.classList.contains('copy-btn')).toBe(true);
    });

    it('uses the provided aria-label', () => {
      const btn = window.CopyUtils.createCopyButton('text', 'Copy message');
      expect(btn.getAttribute('aria-label')).toBe('Copy message');
    });

    it('uses the provided label as title', () => {
      const btn = window.CopyUtils.createCopyButton('text', 'Copy to clipboard');
      expect(btn.title).toBe('Copy to clipboard');
    });

    it('defaults aria-label to "Copy to clipboard" when not provided', () => {
      const btn = window.CopyUtils.createCopyButton('text');
      expect(btn.getAttribute('aria-label')).toBe('Copy to clipboard');
    });

    it('sets innerHTML to COPY_ICON initially', () => {
      const btn = window.CopyUtils.createCopyButton('text', 'Copy');
      expect(btn.innerHTML).toBe(window.CopyUtils.COPY_ICON);
    });

    it('has type=button', () => {
      const btn = window.CopyUtils.createCopyButton('text', 'Copy');
      expect(btn.type).toBe('button');
    });

    it('renders a visible label when provided in options', () => {
      const btn = window.CopyUtils.createCopyButton('text', 'Copy entire turn', { visibleLabel: 'Copy turn' });
      expect(btn.textContent).toContain('Copy turn');
      expect(btn.innerHTML).toContain('<svg');
    });

    describe('when getText is a string', () => {
      it('copies the string to clipboard on click', async () => {
        const btn = window.CopyUtils.createCopyButton('hello world', 'Copy');
        await btn.click();
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello world');
      });

      it('copies empty string', async () => {
        const btn = window.CopyUtils.createCopyButton('', 'Copy');
        await btn.click();
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('');
      });
    });

    describe('when getText is a function', () => {
      it('calls getText() and copies its result', async () => {
        const getText = vi.fn().mockReturnValue('dynamic content');
        const btn = window.CopyUtils.createCopyButton(getText, 'Copy');
        await btn.click();
        expect(getText).toHaveBeenCalled();
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('dynamic content');
      });

      it('calls getText lazily (only on click, not on creation)', () => {
        const getText = vi.fn().mockReturnValue('content');
        window.CopyUtils.createCopyButton(getText, 'Copy');
        expect(getText).not.toHaveBeenCalled();
      });
    });

    describe('copied state', () => {
      it('adds "copied" class after click', async () => {
        const btn = window.CopyUtils.createCopyButton('text', 'Copy');
        await btn.click();
        expect(btn.classList.contains('copied')).toBe(true);
      });

      it('switches to CHECK_ICON after click', async () => {
        const btn = window.CopyUtils.createCopyButton('text', 'Copy');
        await btn.click();
        expect(btn.innerHTML).toBe(window.CopyUtils.CHECK_ICON);
      });

      it('sets title to "Copied!" after click', async () => {
        const btn = window.CopyUtils.createCopyButton('text', 'Copy label');
        await btn.click();
        expect(btn.title).toBe('Copied!');
      });

      it('preserves visible label after copied state resets', async () => {
        const btn = window.CopyUtils.createCopyButton('text', 'Copy label', { visibleLabel: 'Copy turn' });
        await btn.click();

        vi.advanceTimersByTime(2000);
        await Promise.resolve();

        expect(btn.textContent).toContain('Copy turn');
        expect(btn.innerHTML).toContain('<svg');
      });

      it('resets class, icon, and title after 2000ms', async () => {
        const btn = window.CopyUtils.createCopyButton('text', 'Copy label');
        await btn.click();
        expect(btn.classList.contains('copied')).toBe(true);

        vi.advanceTimersByTime(2000);
        await Promise.resolve(); // flush microtasks

        expect(btn.classList.contains('copied')).toBe(false);
        expect(btn.innerHTML).toBe(window.CopyUtils.COPY_ICON);
        expect(btn.title).toBe('Copy label');
      });

      it('does not reset before 2000ms', async () => {
        const btn = window.CopyUtils.createCopyButton('text', 'Copy');
        await btn.click();

        vi.advanceTimersByTime(1999);

        expect(btn.classList.contains('copied')).toBe(true);
        expect(btn.innerHTML).toBe(window.CopyUtils.CHECK_ICON);
      });
    });

    describe('event propagation', () => {
      it('stops event propagation on click', async () => {
        const btn = window.CopyUtils.createCopyButton('text', 'Copy');
        const parent = document.createElement('div');
        parent.appendChild(btn);

        const parentClickSpy = vi.fn();
        parent.addEventListener('click', parentClickSpy);

        await btn.click();
        // Note: btn.click() does not trigger the onclick set via btn.onclick in jsdom
        // We need to dispatch a proper event to test stopPropagation
        const event = new MouseEvent('click', { bubbles: true });
        vi.spyOn(event, 'stopPropagation');
        btn.dispatchEvent(event);

        expect(event.stopPropagation).toHaveBeenCalled();
      });
    });

    describe('clipboard failure', () => {
      it('logs error to console on clipboard failure', async () => {
        // Use real timers for this test to avoid microtask hang with fake timers
        vi.useRealTimers();
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        navigator.clipboard.writeText.mockRejectedValueOnce(new Error('Permission denied'));

        const btn = window.CopyUtils.createCopyButton('text', 'Copy');
        // Trigger onclick directly and flush the rejected promise
        const clickEvent = new MouseEvent('click', { bubbles: true });
        btn.onclick(clickEvent);

        // Flush pending microtasks by awaiting a few times
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
      });
    });
  });

  describe('buildContentBlocksMarkdown', () => {
    it('returns empty string for empty array', () => {
      expect(window.CopyUtils.buildContentBlocksMarkdown([])).toBe('');
    });

    it('handles text blocks', () => {
      const content = [{ type: 'text', text: 'Hello world' }];
      const result = window.CopyUtils.buildContentBlocksMarkdown(content);
      expect(result).toContain('Hello world');
    });

    it('handles tool_use blocks', () => {
      const content = [{
        type: 'tool_use',
        name: 'exec',
        input: { command: 'ls -la' }
      }];
      const result = window.CopyUtils.buildContentBlocksMarkdown(content);
      expect(result).toContain('```json');
      expect(result).toContain('Tool: exec');
      expect(result).toContain('ls -la');
    });

    it('handles thinking blocks', () => {
      const content = [{ type: 'thinking', thinking: 'Let me think...' }];
      const result = window.CopyUtils.buildContentBlocksMarkdown(content);
      expect(result).toContain('> Thinking:');
      expect(result).toContain('Let me think...');
    });

    it('handles multiple mixed blocks', () => {
      const content = [
        { type: 'text', text: 'Here is the answer:' },
        { type: 'tool_use', name: 'web_search', input: { query: 'test' } },
        { type: 'thinking', thinking: 'Processing...' },
      ];
      const result = window.CopyUtils.buildContentBlocksMarkdown(content);
      expect(result).toContain('Here is the answer:');
      expect(result).toContain('Tool: web_search');
      expect(result).toContain('> Thinking:');
    });

    it('skips unknown block types gracefully', () => {
      const content = [
        { type: 'text', text: 'before' },
        { type: 'image', source: { type: 'url', url: 'http://example.com/img.png' } },
        { type: 'text', text: 'after' },
      ];
      const result = window.CopyUtils.buildContentBlocksMarkdown(content);
      expect(result).toContain('before');
      expect(result).toContain('after');
    });

    it('formats tool_use input as pretty JSON', () => {
      const input = { command: 'ls', path: '/home' };
      const content = [{ type: 'tool_use', name: 'exec', input }];
      const result = window.CopyUtils.buildContentBlocksMarkdown(content);
      expect(result).toContain(JSON.stringify(input, null, 2));
    });

    it('returns empty string for non-array content', () => {
      expect(window.CopyUtils.buildContentBlocksMarkdown(null)).toBe('');
      expect(window.CopyUtils.buildContentBlocksMarkdown(undefined)).toBe('');
      expect(window.CopyUtils.buildContentBlocksMarkdown('plain string')).toBe('');
    });
  });
});

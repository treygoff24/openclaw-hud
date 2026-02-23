// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';

window.escapeHtml = function(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };

await import('../../public/chat-tool-blocks.js');

describe('ChatToolBlocks', () => {
  describe('getToolIcon', () => {
    it('returns specific icons for known tools', () => {
      expect(window.ChatToolBlocks.getToolIcon('browser')).toBe('🌐');
      expect(window.ChatToolBlocks.getToolIcon('Read')).toBe('📁');
      expect(window.ChatToolBlocks.getToolIcon('exec')).toBe('⚡');
      expect(window.ChatToolBlocks.getToolIcon('web_search')).toBe('🔍');
    });

    it('returns generic icon for unknown tools', () => {
      expect(window.ChatToolBlocks.getToolIcon('custom_tool')).toBe('🔧');
    });
  });

  describe('getArgPreview', () => {
    it('returns first arg value truncated to 60 chars', () => {
      expect(window.ChatToolBlocks.getArgPreview({ cmd: 'ls -la' })).toBe('ls -la');
      const long = 'a'.repeat(100);
      expect(window.ChatToolBlocks.getArgPreview({ x: long })).toBe('a'.repeat(57) + '...');
    });

    it('returns empty string for empty/null input', () => {
      expect(window.ChatToolBlocks.getArgPreview(null)).toBe('');
      expect(window.ChatToolBlocks.getArgPreview({})).toBe('');
    });
  });

  describe('createToolUseBlock', () => {
    it('creates element with correct structure', () => {
      const el = window.ChatToolBlocks.createToolUseBlock({ id: 't1', name: 'exec', input: { command: 'ls' } });
      expect(el.className).toBe('chat-tool-use');
      expect(el.dataset.toolUseId).toBe('t1');
      expect(el.querySelector('.chat-tool-use-header').textContent).toContain('exec');
      expect(el.querySelector('.chat-tool-use-header').textContent).toContain('⚡');
    });

    it('toggles expanded class on click', () => {
      const el = window.ChatToolBlocks.createToolUseBlock({ id: 't1', name: 'exec', input: {} });
      el.querySelector('.chat-tool-use-header').click();
      expect(el.classList.contains('expanded')).toBe(true);
      el.querySelector('.chat-tool-use-header').click();
      expect(el.classList.contains('expanded')).toBe(false);
    });
  });

  describe('createToolResultBlock', () => {
    it('creates element with content', () => {
      const el = window.ChatToolBlocks.createToolResultBlock({ tool_use_id: 't1', content: 'output here' });
      expect(el.className).toBe('chat-tool-result');
      expect(el.textContent).toContain('output here');
    });

    it('truncates long content with Show more button', () => {
      const long = 'x'.repeat(2000);
      const el = window.ChatToolBlocks.createToolResultBlock({ tool_use_id: 't1', content: long });
      expect(el.querySelector('.chat-tool-result-content').textContent.length).toBe(1000);
      const btn = el.querySelector('.chat-tool-result-more');
      expect(btn).not.toBeNull();
      btn.click();
      expect(el.querySelector('.chat-tool-result-content').textContent.length).toBe(2000);
      btn.click();
      expect(el.querySelector('.chat-tool-result-content').textContent.length).toBe(1000);
    });

    it('no Show more for short content', () => {
      const el = window.ChatToolBlocks.createToolResultBlock({ tool_use_id: 't1', content: 'short' });
      expect(el.querySelector('.chat-tool-result-more')).toBeNull();
    });
  });

  describe('createToolGroup', () => {
    it('returns null for fewer than 3 blocks', () => {
      expect(window.ChatToolBlocks.createToolGroup([document.createElement('div')])).toBeNull();
    });

    it('groups 3+ blocks under collapsible header', () => {
      const blocks = [1, 2, 3].map(() => document.createElement('div'));
      const el = window.ChatToolBlocks.createToolGroup(blocks);
      expect(el.className).toContain('chat-tool-group');
      expect(el.querySelector('.chat-tool-group-header').textContent).toContain('3 tool calls');
      expect(el.classList.contains('collapsed')).toBe(true);
      el.querySelector('.chat-tool-group-header').click();
      expect(el.classList.contains('collapsed')).toBe(false);
    });
  });

  describe('createThinkingBlock', () => {
    it('renders thinking text', () => {
      const el = window.ChatToolBlocks.createThinkingBlock({ thinking: 'Let me think...' });
      expect(el.className).toBe('chat-thinking-block');
      expect(el.textContent).toBe('Let me think...');
    });
  });
});

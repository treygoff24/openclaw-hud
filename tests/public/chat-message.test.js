// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

window.escapeHtml = function(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
window.marked = { parse: vi.fn(t => '<p>' + t + '</p>'), setOptions: vi.fn(), use: vi.fn() };
window.DOMPurify = { sanitize: vi.fn(t => t), addHook: vi.fn() };

await import('../../public/chat-markdown.js');
await import('../../public/label-sanitizer.js');
await import('../../public/chat-sender-resolver.js');
await import('../../public/copy-utils.js');
await import('../../public/chat-tool-blocks.js');
await import('../../public/chat-message.js');

describe('ChatMessage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe('renderContentBlock', () => {
    it('renders text block', () => {
      const el = window.ChatMessage.renderContentBlock({ type: 'text', text: 'hello' }, 'user');
      expect(el.className).toBe('chat-msg-content');
      expect(el.textContent).toBe('hello');
    });

    it('renders text block with markdown for assistant', () => {
      const el = window.ChatMessage.renderContentBlock({ type: 'text', text: 'hi' }, 'assistant');
      expect(el.className).toBe('chat-msg-content');
      expect(window.marked.parse).toHaveBeenCalled();
    });

    it('renders tool_use block', () => {
      const el = window.ChatMessage.renderContentBlock({ type: 'tool_use', id: 't1', name: 'exec', input: {} }, 'assistant');
      expect(el.className).toContain('chat-tool-use');
      expect(el.classList.contains('expanded')).toBe(true);
    });

    it('renders tool_result block', () => {
      const el = window.ChatMessage.renderContentBlock({ type: 'tool_result', tool_use_id: 't1', content: 'ok' }, 'tool');
      expect(el.className).toBe('chat-tool-result');
    });

    it('renders thinking block', () => {
      const el = window.ChatMessage.renderContentBlock({ type: 'thinking', thinking: 'hmm' }, 'assistant');
      expect(el.className).toBe('chat-thinking-block');
    });

    it('renders unknown block type gracefully', () => {
      const el = window.ChatMessage.renderContentBlock({ type: 'image_url', url: 'x' }, 'assistant');
      expect(el.textContent).toContain('unsupported block type');
    });
  });

  describe('renderHistoryMessage', () => {
    it('renders mixed content blocks', () => {
      const el = window.ChatMessage.renderHistoryMessage({
        role: 'assistant',
        content: [
          { type: 'text', text: 'hi' },
          { type: 'tool_use', id: 't1', name: 'exec', input: { command: 'ls' } },
        ]
      });
      expect(el.className).toContain('assistant');
      expect(el.querySelector('.chat-msg-content')).not.toBeNull();
      expect(el.querySelector('.chat-tool-use')).not.toBeNull();
    });

    it('groups 3+ tool_use blocks', () => {
      const content = [1, 2, 3].map(i => ({ type: 'tool_use', id: 't' + i, name: 'exec', input: {} }));
      const el = window.ChatMessage.renderHistoryMessage({ role: 'assistant', content });
      expect(el.querySelector('.chat-tool-group')).not.toBeNull();
    });

    it('renders system role', () => {
      const el = window.ChatMessage.renderHistoryMessage({ role: 'system', content: 'sys msg' });
      expect(el.className).toContain('system');
    });

    it('uses Ren for main sessions', () => {
      window.ChatState = { currentSession: { spawnDepth: 0, label: 'Custom Agent', agentId: 'agent-123' } };
      const el = window.ChatMessage.renderHistoryMessage({ role: 'assistant', content: 'test' });
      const roleSpan = el.querySelector('.chat-msg-role');
      expect(roleSpan.textContent).toBe('Ren');
      delete window.ChatState;
    });

    it('uses subagent alias for assistant role', () => {
      window.ChatState = { currentSession: { spawnDepth: 1, label: 'research-planner', agentId: 'agent-456' } };
      const el = window.ChatMessage.renderHistoryMessage({ role: 'assistant', content: 'test' });
      const roleSpan = el.querySelector('.chat-msg-role');
      expect(roleSpan.textContent).toBe('research-planner');
      delete window.ChatState;
    });

    it('normalizes noisy session labels for assistant sender', () => {
      window.ChatState = { currentSession: { spawnDepth: 1, label: '  \"AGENT:SUB:Research\\nPlanner\" ', agentId: 'agent-456' } };
      const el = window.ChatMessage.renderHistoryMessage({ role: 'assistant', content: 'test' });
      const roleSpan = el.querySelector('.chat-msg-role');
      expect(roleSpan.textContent).toBe('Research Planner');
      delete window.ChatState;
    });

    it('falls back to sessionId for subagent aliases when label is missing', () => {
      window.ChatState = { currentSession: { spawnDepth: 1, sessionId: 'sub-run-123', agentId: 'agent-456', sessionKey: 'agent:agent-456:sub-run-123' } };
      const el = window.ChatMessage.renderHistoryMessage({ role: 'assistant', content: 'test' });
      const roleSpan = el.querySelector('.chat-msg-role');
      expect(roleSpan.textContent).toBe('sub-run-123');
      delete window.ChatState;
    });

    it('falls back to assistant when no session info', () => {
      const el = window.ChatMessage.renderHistoryMessage({ role: 'assistant', content: 'test' });
      const roleSpan = el.querySelector('.chat-msg-role');
      expect(roleSpan.textContent).toBe('assistant');
    });

    it('displays user role unchanged', () => {
      const el = window.ChatMessage.renderHistoryMessage({ role: 'user', content: 'hello' });
      const roleSpan = el.querySelector('.chat-msg-role');
      expect(roleSpan.textContent).toBe('user');
    });
  });

  describe('createAssistantStreamEl', () => {
    it('uses Ren for main session streaming', () => {
      window.ChatState = { currentSession: { spawnDepth: 0, label: 'Streaming Agent', agentId: 'agent-789' } };
      const el = window.ChatMessage.createAssistantStreamEl();
      const roleSpan = el.querySelector('.chat-msg-role');
      expect(roleSpan.textContent).toBe('Ren');
      delete window.ChatState;
    });

    it('normalizes noisy session labels for assistant streaming sender', () => {
      window.ChatState = { currentSession: { spawnDepth: 1, label: '   AGENT:SUB:streaming--agent\\n', agentId: 'agent-789' } };
      const el = window.ChatMessage.createAssistantStreamEl();
      const roleSpan = el.querySelector('.chat-msg-role');
      expect(roleSpan.textContent).toBe('streaming--agent');
      delete window.ChatState;
    });

    it('uses agentId when label not available for streaming', () => {
      window.ChatState = { agentId: 'agent-abc' };
      const el = window.ChatMessage.createAssistantStreamEl();
      const roleSpan = el.querySelector('.chat-msg-role');
      expect(roleSpan.textContent).toBe('agent-abc');
      delete window.ChatState;
    });

    it('falls back to assistant for streaming when no session info', () => {
      const el = window.ChatMessage.createAssistantStreamEl();
      const roleSpan = el.querySelector('.chat-msg-role');
      expect(roleSpan.textContent).toBe('assistant');
    });
  });
});

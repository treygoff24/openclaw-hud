// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

function setupDOM() {
  document.body.innerHTML = `
    <div class="hud-layout">
      <div id="chat-title"></div>
      <div id="chat-live"></div>
      <div id="chat-messages"></div>
      <div id="chat-new-pill"></div>
      <button id="chat-close"></button>
    </div>
  `;
}

setupDOM();
window.HUD = window.HUD || {};
window._hudWs = null;
window.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve([]) }));
const store = {};
vi.stubGlobal('localStorage', {
  getItem: vi.fn(k => store[k] || null),
  setItem: vi.fn((k, v) => { store[k] = v; }),
  removeItem: vi.fn(k => { delete store[k]; }),
});
window.WebSocket = { OPEN: 1 };

await import('../../public/chat-pane.js');

describe('openChatPane', () => {
  beforeEach(() => {
    setupDOM();
    vi.clearAllMocks();
    window.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve([]) }));
  });

  it('returns early if no agentId or sessionId', () => {
    window.openChatPane(null, null);
    expect(document.querySelector('.hud-layout').classList.contains('chat-open')).toBe(false);
  });

  it('adds chat-open class to layout', () => {
    window.openChatPane('agent1', 'session123', 'my-label');
    expect(document.querySelector('.hud-layout').classList.contains('chat-open')).toBe(true);
  });

  it('sets the title', () => {
    window.openChatPane('agent1', 'session123', 'my-label');
    expect(document.getElementById('chat-title').textContent).toBe('agent1 // my-label');
  });

  it('uses sessionId prefix when no label', () => {
    window.openChatPane('agent1', 'session123456789');
    expect(document.getElementById('chat-title').textContent).toBe('agent1 // session1');
  });

  it('saves to localStorage', () => {
    window.openChatPane('agent1', 'sess1', 'lbl');
    expect(localStorage.setItem).toHaveBeenCalledWith('hud-chat-session', JSON.stringify({ agentId: 'agent1', sessionId: 'sess1', label: 'lbl' }));
  });

  it('shows loading indicator in messages', () => {
    window.openChatPane('agent1', 'sess1');
    const loading = document.getElementById('chat-empty');
    expect(loading).not.toBeNull();
    expect(loading.textContent).toBe('Loading...');
  });

  it('calls fetch with correct URL', () => {
    window.openChatPane('agent1', 'sess1');
    expect(window.fetch).toHaveBeenCalledWith('/api/session-log/agent1/sess1?limit=100');
  });
});

describe('closeChatPane', () => {
  beforeEach(() => {
    setupDOM();
    vi.clearAllMocks();
    window.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve([]) }));
  });

  it('removes chat-open class', () => {
    window.openChatPane('agent1', 'sess1');
    window.closeChatPane();
    expect(document.querySelector('.hud-layout').classList.contains('chat-open')).toBe(false);
  });

  it('removes from localStorage', () => {
    window.openChatPane('agent1', 'sess1');
    window.closeChatPane();
    expect(localStorage.removeItem).toHaveBeenCalledWith('hud-chat-session');
  });
});

describe('handleChatWsMessage', () => {
  beforeEach(() => {
    setupDOM();
    vi.clearAllMocks();
    window.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve([]) }));
  });

  it('ignores non log-entry messages', () => {
    window.openChatPane('a', 's');
    const msgsBefore = document.getElementById('chat-messages').children.length;
    window.handleChatWsMessage({ type: 'other' });
    expect(document.getElementById('chat-messages').children.length).toBe(msgsBefore);
  });

  it('ignores log-entry for different session', () => {
    window.openChatPane('a', 's');
    const msgsBefore = document.getElementById('chat-messages').children.length;
    window.handleChatWsMessage({ type: 'log-entry', agentId: 'a', sessionId: 'other', entry: { role: 'user', content: 'hi' } });
    expect(document.getElementById('chat-messages').children.length).toBe(msgsBefore);
  });

  it('appends message for current session', () => {
    window.openChatPane('a', 's');
    window.handleChatWsMessage({ type: 'log-entry', agentId: 'a', sessionId: 's', entry: { role: 'user', content: 'hello' } });
    const msgs = document.querySelectorAll('.chat-msg');
    expect(msgs.length).toBe(1);
    expect(msgs[0].querySelector('.chat-msg-content').textContent).toBe('hello');
  });

  it('removes empty placeholder when appending', () => {
    window.openChatPane('a', 's');
    expect(document.getElementById('chat-empty')).not.toBeNull();
    window.handleChatWsMessage({ type: 'log-entry', agentId: 'a', sessionId: 's', entry: { role: 'assistant', content: 'hi' } });
    expect(document.getElementById('chat-empty')).toBeNull();
  });

  it('handles subscribed message and shows LIVE indicator', () => {
    window.openChatPane('a', 's');
    window.handleChatWsMessage({ type: 'subscribed', sessionId: 's' });
    expect(document.getElementById('chat-live').classList.contains('visible')).toBe(true);
  });

  it('ignores subscribed for different session', () => {
    window.openChatPane('a', 's');
    window.handleChatWsMessage({ type: 'subscribed', sessionId: 'other' });
    expect(document.getElementById('chat-live').classList.contains('visible')).toBe(false);
  });

  it('handles tool_use entries with tool role class', () => {
    window.openChatPane('a', 's');
    window.handleChatWsMessage({ type: 'log-entry', agentId: 'a', sessionId: 's', entry: { type: 'tool_use', name: 'exec', content: 'result' } });
    const msg = document.querySelector('.chat-msg.tool');
    expect(msg).not.toBeNull();
    expect(msg.querySelector('.chat-msg-content').textContent).toContain('[exec]');
  });

  it('handles array content', () => {
    window.openChatPane('a', 's');
    window.handleChatWsMessage({ type: 'log-entry', agentId: 'a', sessionId: 's', entry: { role: 'assistant', content: ['hello', { text: 'world' }] } });
    const msg = document.querySelector('.chat-msg-content');
    expect(msg.textContent).toContain('hello');
    expect(msg.textContent).toContain('world');
  });

  it('truncates long content', () => {
    window.openChatPane('a', 's');
    const longContent = 'x'.repeat(3000);
    window.handleChatWsMessage({ type: 'log-entry', agentId: 'a', sessionId: 's', entry: { role: 'user', content: longContent } });
    const msg = document.querySelector('.chat-msg-content');
    expect(msg.textContent.length).toBeLessThan(3000);
    expect(msg.querySelector('.chat-truncated')).not.toBeNull();
  });

  it('uses type as content when content is missing', () => {
    window.openChatPane('a', 's');
    window.handleChatWsMessage({ type: 'log-entry', agentId: 'a', sessionId: 's', entry: { type: 'model_change' } });
    const msg = document.querySelector('.chat-msg-content');
    expect(msg.textContent).toBe('model_change');
  });

  it('handles object content in array', () => {
    window.openChatPane('a', 's');
    window.handleChatWsMessage({ type: 'log-entry', agentId: 'a', sessionId: 's', entry: { role: 'assistant', content: [{ foo: 'bar' }] } });
    const msg = document.querySelector('.chat-msg-content');
    expect(msg.textContent).toContain('foo');
  });
});

describe('WS queue', () => {
  beforeEach(() => {
    setupDOM();
    vi.clearAllMocks();
    window.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve([]) }));
  });

  it('queues messages when WS is not open', () => {
    window._hudWs = null;
    window.openChatPane('a', 's');
    // The subscribe-log message should be queued since no WS
  });

  it('flushes queue when WS becomes available', () => {
    window._hudWs = null;
    window.openChatPane('a', 's');
    const mockSend = vi.fn();
    window._hudWs = { readyState: 1, send: mockSend };
    window._flushChatWsQueue();
    expect(mockSend).toHaveBeenCalled();
  });
});

describe('fetch response handling', () => {
  beforeEach(() => {
    setupDOM();
    vi.clearAllMocks();
  });

  it('renders fetched log entries', async () => {
    window.fetch = vi.fn(() => Promise.resolve({
      json: () => Promise.resolve([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
      ])
    }));
    window.openChatPane('a', 's');
    await new Promise(r => setTimeout(r, 50));
    const msgs = document.querySelectorAll('.chat-msg');
    expect(msgs.length).toBe(2);
  });

  it('shows "No log entries" when fetch returns empty', async () => {
    window.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve([]) }));
    window.openChatPane('a', 's');
    await new Promise(r => setTimeout(r, 50));
    const empty = document.getElementById('chat-empty');
    expect(empty).not.toBeNull();
    expect(empty.textContent).toBe('No log entries');
  });

  it('handles fetch error gracefully', async () => {
    window.fetch = vi.fn(() => Promise.reject(new Error('Network error')));
    window.openChatPane('a', 's');
    await new Promise(r => setTimeout(r, 50));
    const empty = document.getElementById('chat-empty');
    expect(empty.textContent).toContain('Error');
  });
});

describe('keyboard and UI events', () => {
  beforeEach(() => {
    setupDOM();
    vi.clearAllMocks();
    window.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve([]) }));
  });

  it('closes chat pane on Escape key', () => {
    window.openChatPane('a', 's');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.hud-layout').classList.contains('chat-open')).toBe(false);
  });

  it('does not close chat on Escape when modal is active', () => {
    window.openChatPane('a', 's');
    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    document.body.appendChild(modal);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.hud-layout').classList.contains('chat-open')).toBe(true);
  });

  it('close button closes chat', () => {
    window.openChatPane('a', 's');
    document.getElementById('chat-close').click();
    expect(document.querySelector('.hud-layout').classList.contains('chat-open')).toBe(false);
  });

  it('shows new-pill and scrolls on click', () => {
    window.openChatPane('a', 's');
    const pill = document.getElementById('chat-new-pill');
    pill.classList.add('visible');
    pill.click();
    expect(pill.classList.contains('visible')).toBe(false);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function loadScript(relativePath) {
  const code = readFileSync(join(__dirname, '../../public', relativePath), 'utf-8');
  new Function(code)();
}

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

beforeEach(() => {
  setupDOM();
  window.HUD = {};
  window._hudWs = null;
  // Mock fetch
  window.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve([]) }));
  // Mock localStorage
  const store = {};
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(k => store[k] || null),
    setItem: vi.fn((k, v) => { store[k] = v; }),
    removeItem: vi.fn(k => { delete store[k]; }),
  });
  // Mock WebSocket
  window.WebSocket = { OPEN: 1 };
  loadScript('chat-pane.js');
});

describe('openChatPane', () => {
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
    expect(msgs[0].classList.contains('user')).toBe(true);
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
});

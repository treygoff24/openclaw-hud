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
      <button id="chat-new-chat-btn"></button>
      <div id="chat-model-picker" style="display:none"></div>
      <div id="gateway-banner" class="gateway-banner" style="display:none">Gateway connection lost</div>
      <div class="chat-input-area" id="chat-input-area">
        <textarea id="chat-input" class="chat-input" placeholder="Type a message..." rows="1"></textarea>
        <button id="chat-send-btn" class="chat-send-btn" title="Send">▶</button>
        <button id="chat-stop-btn" class="chat-stop-btn" title="Stop" style="display:none">■</button>
      </div>
    </div>
  `;
}

setupDOM();
window.HUD = window.HUD || {};
window._hudWs = null;
window.escapeHtml = function(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
};
const store = {};
vi.stubGlobal('localStorage', {
  getItem: vi.fn(k => store[k] || null),
  setItem: vi.fn((k, v) => { store[k] = v; }),
  removeItem: vi.fn(k => { delete store[k]; }),
});
window.WebSocket = { OPEN: 1 };
let uuidCounter = 0;
if (!globalThis.crypto) globalThis.crypto = {};
globalThis.crypto.randomUUID = () => 'uuid-' + (++uuidCounter);

await import('../../public/chat-pane.js');

function mockWs() {
  const ws = { readyState: 1, send: vi.fn() };
  window._hudWs = ws;
  return ws;
}

function resetState() {
  window._hudWs = null;
  try { window.closeChatPane(); } catch(e) {}
  setupDOM();
  vi.clearAllMocks();
  uuidCounter = 0;
}

describe('openChatPane', () => {
  beforeEach(resetState);

  it('returns early if no agentId or sessionId', () => {
    window.openChatPane(null, null);
    expect(document.querySelector('.hud-layout').classList.contains('chat-open')).toBe(false);
  });

  it('adds chat-open class and sets title', () => {
    mockWs();
    window.openChatPane('agent1', 'session123', 'my-label');
    expect(document.querySelector('.hud-layout').classList.contains('chat-open')).toBe(true);
    expect(document.getElementById('chat-title').textContent).toBe('agent1 // my-label');
  });

  it('uses sessionId prefix when no label', () => {
    mockWs();
    window.openChatPane('agent1', 'session123456789');
    expect(document.getElementById('chat-title').textContent).toBe('agent1 // session1');
  });

  it('sends chat-subscribe and chat-history over WS', () => {
    const ws = mockWs();
    window.openChatPane('agent1', 'sess1', 'lbl');
    const calls = ws.send.mock.calls.map(c => JSON.parse(c[0]));
    expect(calls.find(c => c.type === 'chat-subscribe' && c.sessionKey === 'agent:agent1:sess1')).toBeTruthy();
    expect(calls.find(c => c.type === 'chat-history' && c.sessionKey === 'agent:agent1:sess1')).toBeTruthy();
  });

  it('shows loading spinner', () => {
    mockWs();
    window.openChatPane('a', 's');
    expect(document.querySelector('.chat-loading')).not.toBeNull();
  });

  it('unsubscribes from previous session', () => {
    const ws = mockWs();
    window.openChatPane('a', 's1');
    ws.send.mockClear();
    window.openChatPane('a', 's2');
    const calls = ws.send.mock.calls.map(c => JSON.parse(c[0]));
    expect(calls.find(c => c.type === 'chat-unsubscribe' && c.sessionKey === 'agent:a:s1')).toBeTruthy();
  });

  it('saves to localStorage', () => {
    mockWs();
    window.openChatPane('agent1', 'sess1', 'lbl');
    expect(localStorage.setItem).toHaveBeenCalled();
  });
});

describe('closeChatPane', () => {
  beforeEach(resetState);

  it('removes chat-open class and clears localStorage', () => {
    mockWs();
    window.openChatPane('a', 's');
    window.closeChatPane();
    expect(document.querySelector('.hud-layout').classList.contains('chat-open')).toBe(false);
    expect(localStorage.removeItem).toHaveBeenCalledWith('hud-chat-session');
  });
});

describe('handleChatWsMessage — chat-history-result', () => {
  beforeEach(resetState);

  it('renders history messages and removes spinner', () => {
    mockWs();
    window.openChatPane('a', 's');
    window.handleChatWsMessage({
      type: 'chat-history-result', sessionKey: 'agent:a:s',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'hi there' }] },
      ]
    });
    expect(document.querySelectorAll('.chat-msg').length).toBe(2);
    expect(document.querySelector('.chat-loading')).toBeNull();
  });

  it('renders tool_use blocks as collapsed', () => {
    mockWs();
    window.openChatPane('a', 's');
    window.handleChatWsMessage({
      type: 'chat-history-result', sessionKey: 'agent:a:s',
      messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'exec', input: { cmd: 'ls' } }] }]
    });
    const tb = document.querySelector('.chat-tool-block');
    expect(tb).not.toBeNull();
    expect(tb.textContent).toContain('Tool: exec');
  });

  it('renders tool_result blocks as collapsed', () => {
    mockWs();
    window.openChatPane('a', 's');
    window.handleChatWsMessage({
      type: 'chat-history-result', sessionKey: 'agent:a:s',
      messages: [{ role: 'tool', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'done' }] }]
    });
    const tb = document.querySelector('.chat-tool-block');
    expect(tb).not.toBeNull();
    expect(tb.textContent).toContain('Result');
  });
});

describe('handleChatWsMessage — chat-event deltas', () => {
  beforeEach(resetState);

  it('creates assistant message on delta and replaces text', () => {
    mockWs();
    window.openChatPane('a', 's');
    window.handleChatWsMessage({ type: 'chat-history-result', sessionKey: 'agent:a:s', messages: [] });
    window.handleChatWsMessage({ type: 'chat-event', payload: { sessionKey: 'agent:a:s', runId: 'r1', state: 'delta', seq: 1, message: 'Hello' } });
    let msg = document.querySelector('.chat-msg.assistant.streaming');
    expect(msg).not.toBeNull();
    expect(msg.querySelector('.chat-msg-content').textContent).toBe('Hello');
    window.handleChatWsMessage({ type: 'chat-event', payload: { sessionKey: 'agent:a:s', runId: 'r1', state: 'delta', seq: 2, message: 'Hello world' } });
    expect(msg.querySelector('.chat-msg-content').textContent).toBe('Hello world');
  });

  it('shows stop button when run is active', () => {
    mockWs();
    window.openChatPane('a', 's');
    window.handleChatWsMessage({ type: 'chat-history-result', sessionKey: 'agent:a:s', messages: [] });
    window.handleChatWsMessage({ type: 'chat-event', payload: { sessionKey: 'agent:a:s', runId: 'r1', state: 'delta', seq: 1, message: 'Hi' } });
    expect(document.getElementById('chat-stop-btn').style.display).not.toBe('none');
    expect(document.getElementById('chat-send-btn').style.display).toBe('none');
  });

  it('handles final state', () => {
    mockWs();
    window.openChatPane('a', 's');
    window.handleChatWsMessage({ type: 'chat-history-result', sessionKey: 'agent:a:s', messages: [] });
    window.handleChatWsMessage({ type: 'chat-event', payload: { sessionKey: 'agent:a:s', runId: 'r1', state: 'delta', seq: 1, message: 'Hi' } });
    window.handleChatWsMessage({ type: 'chat-event', payload: { sessionKey: 'agent:a:s', runId: 'r1', state: 'final', seq: 2 } });
    expect(document.querySelector('.chat-msg.streaming')).toBeNull();
    expect(document.getElementById('chat-send-btn').style.display).not.toBe('none');
  });

  it('handles error state', () => {
    mockWs();
    window.openChatPane('a', 's');
    window.handleChatWsMessage({ type: 'chat-history-result', sessionKey: 'agent:a:s', messages: [] });
    window.handleChatWsMessage({ type: 'chat-event', payload: { sessionKey: 'agent:a:s', runId: 'r1', state: 'error', errorMessage: 'Something broke' } });
    const errorMsg = document.querySelector('.chat-msg.error');
    expect(errorMsg).not.toBeNull();
    expect(errorMsg.textContent).toContain('Something broke');
  });

  it('handles aborted state with badge', () => {
    mockWs();
    window.openChatPane('a', 's');
    window.handleChatWsMessage({ type: 'chat-history-result', sessionKey: 'agent:a:s', messages: [] });
    window.handleChatWsMessage({ type: 'chat-event', payload: { sessionKey: 'agent:a:s', runId: 'r1', state: 'delta', seq: 1, message: 'partial' } });
    window.handleChatWsMessage({ type: 'chat-event', payload: { sessionKey: 'agent:a:s', runId: 'r1', state: 'aborted', stopReason: 'user_cancelled' } });
    expect(document.querySelector('.chat-aborted-badge')).not.toBeNull();
    expect(document.querySelector('.chat-aborted-badge').textContent).toContain('user_cancelled');
  });
});

describe('handleChatWsMessage — chat-send-ack', () => {
  beforeEach(resetState);

  it('removes pending class on success ack', () => {
    const ws = mockWs();
    window.openChatPane('a', 's');
    window.handleChatWsMessage({ type: 'chat-history-result', sessionKey: 'agent:a:s', messages: [] });
    const input = document.getElementById('chat-input');
    input.value = 'test message';
    document.getElementById('chat-send-btn').click();
    const key = JSON.parse(ws.send.mock.calls.find(c => JSON.parse(c[0]).type === 'chat-send')[0]).idempotencyKey;
    expect(document.querySelector('.chat-msg.pending')).not.toBeNull();
    window.handleChatWsMessage({ type: 'chat-send-ack', idempotencyKey: key, ok: true });
    expect(document.querySelector('.chat-msg.pending')).toBeNull();
    expect(input.disabled).toBe(false);
  });

  it('marks as failed on error ack', () => {
    const ws = mockWs();
    window.openChatPane('a', 's');
    window.handleChatWsMessage({ type: 'chat-history-result', sessionKey: 'agent:a:s', messages: [] });
    const input = document.getElementById('chat-input');
    input.value = 'test message';
    document.getElementById('chat-send-btn').click();
    const key = JSON.parse(ws.send.mock.calls.find(c => JSON.parse(c[0]).type === 'chat-send')[0]).idempotencyKey;
    window.handleChatWsMessage({ type: 'chat-send-ack', idempotencyKey: key, ok: false, error: 'fail' });
    expect(document.querySelector('.chat-msg.failed')).not.toBeNull();
    expect(input.disabled).toBe(false);
  });
});

describe('handleChatWsMessage — gateway-status', () => {
  beforeEach(resetState);

  it('shows banner on disconnect', () => {
    window.handleChatWsMessage({ type: 'gateway-status', status: 'disconnected' });
    expect(document.getElementById('gateway-banner').style.display).toBe('block');
  });

  it('hides banner on connected', () => {
    mockWs();
    window.openChatPane('a', 's');
    window.handleChatWsMessage({ type: 'gateway-status', status: 'disconnected' });
    window.handleChatWsMessage({ type: 'gateway-status', status: 'connected' });
    expect(document.getElementById('gateway-banner').style.display).toBe('none');
  });
});

describe('message input', () => {
  beforeEach(resetState);

  it('Enter sends message, Shift+Enter does not', () => {
    const ws = mockWs();
    window.openChatPane('a', 's');
    window.handleChatWsMessage({ type: 'chat-history-result', sessionKey: 'agent:a:s', messages: [] });
    const input = document.getElementById('chat-input');
    input.value = 'hello';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
    expect(ws.send.mock.calls.map(c => JSON.parse(c[0])).filter(c => c.type === 'chat-send').length).toBe(0);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: false, bubbles: true, cancelable: true }));
    expect(ws.send.mock.calls.map(c => JSON.parse(c[0])).filter(c => c.type === 'chat-send').length).toBe(1);
  });

  it('optimistic send creates pending message and disables input', () => {
    mockWs();
    window.openChatPane('a', 's');
    window.handleChatWsMessage({ type: 'chat-history-result', sessionKey: 'agent:a:s', messages: [] });
    const input = document.getElementById('chat-input');
    input.value = 'test';
    document.getElementById('chat-send-btn').click();
    expect(document.querySelector('.chat-msg.user.pending')).not.toBeNull();
    expect(input.disabled).toBe(true);
  });

  it('does not send empty messages', () => {
    const ws = mockWs();
    window.openChatPane('a', 's');
    window.handleChatWsMessage({ type: 'chat-history-result', sessionKey: 'agent:a:s', messages: [] });
    document.getElementById('chat-input').value = '   ';
    document.getElementById('chat-send-btn').click();
    expect(ws.send.mock.calls.map(c => JSON.parse(c[0])).filter(c => c.type === 'chat-send').length).toBe(0);
  });
});

describe('abort button', () => {
  beforeEach(resetState);

  it('sends chat-abort on click', () => {
    const ws = mockWs();
    window.openChatPane('a', 's');
    window.handleChatWsMessage({ type: 'chat-history-result', sessionKey: 'agent:a:s', messages: [] });
    window.handleChatWsMessage({ type: 'chat-event', payload: { sessionKey: 'agent:a:s', runId: 'r1', state: 'delta', seq: 1, message: 'Hi' } });
    ws.send.mockClear();
    document.getElementById('chat-stop-btn').click();
    const calls = ws.send.mock.calls.map(c => JSON.parse(c[0]));
    expect(calls.find(c => c.type === 'chat-abort')).toBeTruthy();
  });
});

describe('multiple concurrent runs', () => {
  beforeEach(resetState);

  it('tracks multiple runs independently', () => {
    mockWs();
    window.openChatPane('a', 's');
    window.handleChatWsMessage({ type: 'chat-history-result', sessionKey: 'agent:a:s', messages: [] });
    window.handleChatWsMessage({ type: 'chat-event', payload: { sessionKey: 'agent:a:s', runId: 'r1', state: 'delta', seq: 1, message: 'Run1' } });
    window.handleChatWsMessage({ type: 'chat-event', payload: { sessionKey: 'agent:a:s', runId: 'r2', state: 'delta', seq: 1, message: 'Run2' } });
    expect(document.querySelectorAll('.chat-msg.assistant.streaming').length).toBe(2);
  });
});

describe('WS queue', () => {
  beforeEach(resetState);

  it('queues and flushes messages', () => {
    window._hudWs = null;
    window.openChatPane('a', 's');
    const ws = mockWs();
    window._flushChatWsQueue();
    expect(ws.send).toHaveBeenCalled();
  });
});

describe('backward compatibility', () => {
  beforeEach(resetState);

  it('handles subscribed message for LIVE indicator', () => {
    mockWs();
    window.openChatPane('a', 's');
    window.handleChatWsMessage({ type: 'subscribed', sessionId: 's' });
    expect(document.getElementById('chat-live').classList.contains('visible')).toBe(true);
  });

  it('handles log-entry messages', () => {
    mockWs();
    window.openChatPane('a', 's');
    window.handleChatWsMessage({ type: 'chat-history-result', sessionKey: 'agent:a:s', messages: [] });
    window.handleChatWsMessage({ type: 'log-entry', agentId: 'a', sessionId: 's', entry: { role: 'user', content: 'hi' } });
    expect(document.querySelectorAll('.chat-msg').length).toBe(1);
  });
});

describe('keyboard and UI events', () => {
  beforeEach(resetState);

  it('closes chat pane on Escape key', () => {
    mockWs();
    window.openChatPane('a', 's');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.hud-layout').classList.contains('chat-open')).toBe(false);
  });

  it('does not close on Escape when modal is active', () => {
    mockWs();
    window.openChatPane('a', 's');
    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    document.body.appendChild(modal);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.hud-layout').classList.contains('chat-open')).toBe(true);
  });

  it('close button closes chat', () => {
    mockWs();
    window.openChatPane('a', 's');
    document.getElementById('chat-close').click();
    expect(document.querySelector('.hud-layout').classList.contains('chat-open')).toBe(false);
  });
});

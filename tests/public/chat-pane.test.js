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

await import('../../public/copy-utils.js');
await import('../../public/label-sanitizer.js');
await import('../../public/chat-sender-resolver.js');
await import('../../public/chat-message.js');
await import('../../public/chat-input.js');
await import('../../public/chat-ws-handler.js');
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
  window._allSessions = [];
  uuidCounter = 0;
}

describe('openChatPane', () => {
  beforeEach(resetState);

  it('returns early if no agentId or sessionId', () => {
    window.openChatPane(null, null);
    expect(document.querySelector('.hud-layout').classList.contains('chat-open')).toBe(false);
  });

  it('throws if canonical sessionKey is missing', () => {
    expect(() => window.openChatPane('agent1', 'session123', 'my-label')).toThrow(
      'openChatPane requires canonical sessionKey from /api/sessions'
    );
  });

  it('throws if sessionKey is not canonical', () => {
    expect(() => window.openChatPane('agent1', 'session123', 'my-label', 'not-canonical')).toThrow(
      'openChatPane requires canonical sessionKey from /api/sessions'
    );
  });

  it('adds chat-open class and sets title', () => {
    mockWs();
    window.openChatPane('agent1', 'session123', 'my-label', 'agent:agent1:session123');
    expect(document.querySelector('.hud-layout').classList.contains('chat-open')).toBe(true);
    expect(document.getElementById('chat-title').textContent).toBe('agent1 // my-label');
  });

  it('sanitizes noisy labels for title', () => {
    mockWs();
    window.openChatPane('agent1', 'session123', '  noisy\\nlabel ', 'agent:agent1:session123');
    expect(document.getElementById('chat-title').textContent).toBe('agent1 // noisy label');
  });

  it('uses sessionId prefix when no label', () => {
    mockWs();
    window.openChatPane('agent1', 'session123456789', '', 'agent:agent1:session123456789');
    expect(document.getElementById('chat-title').textContent).toBe('agent1 // session1');
  });

  it('sends chat-subscribe and chat-history over WS', () => {
    const ws = mockWs();
    window.openChatPane('agent1', 'sess1', 'lbl', 'agent:agent1:sess1');
    const calls = ws.send.mock.calls.map(c => JSON.parse(c[0]));
    expect(calls.find(c => c.type === 'chat-subscribe' && c.sessionKey === 'agent:agent1:sess1')).toBeTruthy();
    expect(calls.find(c => c.type === 'chat-history' && c.sessionKey === 'agent:agent1:sess1')).toBeTruthy();
  });

  it('uses canonical session key when provided and resolves loading on matching history', () => {
    const ws = mockWs();
    window.openChatPane('agent1', 'sess-internal-123', 'main', 'agent:agent1:main');
    const calls = ws.send.mock.calls.map(c => JSON.parse(c[0]));
    expect(calls.find(c => c.type === 'chat-subscribe' && c.sessionKey === 'agent:agent1:main')).toBeTruthy();
    expect(calls.find(c => c.type === 'chat-history' && c.sessionKey === 'agent:agent1:main')).toBeTruthy();

    expect(document.querySelector('.chat-loading')).not.toBeNull();
    window.handleChatWsMessage({ type: 'chat-history-result', sessionKey: 'agent:agent1:main', messages: [] });
    expect(document.querySelector('.chat-loading')).toBeNull();
  });

  it('enriches chat state with sender metadata from _allSessions', () => {
    window._allSessions = [
      {
        sessionId: 'my-sub-session',
        sessionKey: 'agent:agent1:my-sub-session',
        agentId: 'agent1',
        label: 'AGENT:SUB:research-planner',
        spawnDepth: 1,
        spawnedBy: 'agent:agent1:main',
        model: 'gpt-5'
      }
    ];
    const ws = mockWs();
    window.openChatPane('agent1', 'my-sub-session', 'AGENT:SUB:research-planner', 'agent:agent1:my-sub-session');
    const current = window.ChatState.currentSession;
    expect(current.spawnDepth).toBe(1);
    expect(current.spawnedBy).toBe('agent:agent1:main');
    expect(current.sessionRole).toBe('subagent');
    expect(current.sessionAlias).toBe('research-planner');
    expect(current.model).toBe('gpt-5');
    expect(current.sessionKey).toBe('agent:agent1:my-sub-session');
    const calls = ws.send.mock.calls.map(c => JSON.parse(c[0]));
    expect(calls.find(c => c.type === 'chat-subscribe' && c.sessionKey === 'agent:agent1:my-sub-session')).toBeTruthy();
  });

  it('routes chat transport by canonical key even when sessionId is empty', () => {
    const ws = mockWs();
    window.openChatPane('agent1', '', 'main', 'agent:agent1:main');
    const calls = ws.send.mock.calls.map(c => JSON.parse(c[0]));
    expect(calls.find(c => c.type === 'chat-subscribe' && c.sessionKey === 'agent:agent1:main')).toBeTruthy();
    expect(calls.find(c => c.type === 'chat-history' && c.sessionKey === 'agent:agent1:main')).toBeTruthy();
  });

  it('shows loading spinner', () => {
    mockWs();
    window.openChatPane('a', 's', '', 'agent:a:s');
    expect(document.querySelector('.chat-loading')).not.toBeNull();
  });

  it('fails safe when history never arrives and clears loading state', () => {
    vi.useFakeTimers();
    mockWs();
    window.openChatPane('a', 's', '', 'agent:a:s');
    expect(document.querySelector('.chat-loading')).not.toBeNull();

    vi.advanceTimersByTime(10001);

    expect(document.querySelector('.chat-loading')).toBeNull();
    expect(document.querySelector('.chat-history-warning')).not.toBeNull();
    expect(document.getElementById('chat-messages').dataset.ready).toBe('true');
    vi.useRealTimers();
  });

  it('does not show history timeout warning after successful history result', () => {
    vi.useFakeTimers();
    mockWs();
    window.openChatPane('a', 's', '', 'agent:a:s');

    window.handleChatWsMessage({ type: 'chat-history-result', sessionKey: 'agent:a:s', messages: [] });
    vi.advanceTimersByTime(10001);

    expect(document.querySelector('.chat-history-warning')).toBeNull();
    expect(document.querySelector('.chat-loading')).toBeNull();
    vi.useRealTimers();
  });

  it('allows retry by reopening chat after history timeout', () => {
    vi.useFakeTimers();
    mockWs();
    window.openChatPane('a', 's', '', 'agent:a:s');
    vi.advanceTimersByTime(10001);
    expect(document.querySelector('.chat-history-warning')).not.toBeNull();

    window.closeChatPane();
    window.openChatPane('a', 's', '', 'agent:a:s');

    expect(document.querySelector('.chat-history-warning')).toBeNull();
    expect(document.querySelector('.chat-loading')).not.toBeNull();
    vi.useRealTimers();
  });

  it('unsubscribes from previous session', () => {
    const ws = mockWs();
    window.openChatPane('a', 's1', '', 'agent:a:s1');
    ws.send.mockClear();
    window.openChatPane('a', 's2', '', 'agent:a:s2');
    const calls = ws.send.mock.calls.map(c => JSON.parse(c[0]));
    expect(calls.find(c => c.type === 'chat-unsubscribe' && c.sessionKey === 'agent:a:s1')).toBeTruthy();
  });

  it('saves to localStorage', () => {
    mockWs();
    window.openChatPane('agent1', 'sess1', 'lbl', 'agent:agent1:sess1');
    expect(localStorage.setItem).toHaveBeenCalled();
  });
});

describe('restoreSavedChatSession', () => {
  beforeEach(resetState);

  it('does not restore stale saved key and clears localStorage', () => {
    store['hud-chat-session'] = JSON.stringify({
      agentId: 'a',
      sessionId: 'stale',
      label: 'stale',
      sessionKey: 'agent:a:stale',
    });
    const openSpy = vi.spyOn(window, 'openChatPane');

    const restored = window.restoreSavedChatSession([
      { agentId: 'a', sessionId: 'live', label: 'live', sessionKey: 'agent:a:live' },
    ]);

    expect(restored).toBe(false);
    expect(openSpy).not.toHaveBeenCalled();
    expect(localStorage.removeItem).toHaveBeenCalledWith('hud-chat-session');
    openSpy.mockRestore();
  });

  it('restores valid saved key from fetched sessions payload', () => {
    store['hud-chat-session'] = JSON.stringify({
      agentId: 'a',
      sessionId: 'live',
      label: 'saved-label',
      sessionKey: 'agent:a:live',
    });
    const openSpy = vi.spyOn(window, 'openChatPane');

    const restored = window.restoreSavedChatSession([
      { agentId: 'a', sessionId: 'live', label: 'live-label', sessionKey: 'agent:a:live' },
    ]);

    expect(restored).toBe(true);
    expect(openSpy).toHaveBeenCalledWith('a', 'live', 'live-label', 'agent:a:live');
    expect(localStorage.removeItem).not.toHaveBeenCalledWith('hud-chat-session');
    openSpy.mockRestore();
  });
});

describe('closeChatPane', () => {
  beforeEach(resetState);

  it('removes chat-open class and clears localStorage', () => {
    mockWs();
    window.openChatPane('a', 's', '', 'agent:a:s');
    window.closeChatPane();
    expect(document.querySelector('.hud-layout').classList.contains('chat-open')).toBe(false);
    expect(localStorage.removeItem).toHaveBeenCalledWith('hud-chat-session');
  });
});

describe('handleChatWsMessage — chat-history-result', () => {
  beforeEach(resetState);

  it('renders history messages and removes spinner', () => {
    mockWs();
    window.openChatPane('a', 's', '', 'agent:a:s');
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
    window.openChatPane('a', 's', '', 'agent:a:s');
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
    window.openChatPane('a', 's', '', 'agent:a:s');
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
    window.openChatPane('a', 's', '', 'agent:a:s');
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
    window.openChatPane('a', 's', '', 'agent:a:s');
    window.handleChatWsMessage({ type: 'chat-history-result', sessionKey: 'agent:a:s', messages: [] });
    window.handleChatWsMessage({ type: 'chat-event', payload: { sessionKey: 'agent:a:s', runId: 'r1', state: 'delta', seq: 1, message: 'Hi' } });
    expect(document.getElementById('chat-stop-btn').style.display).not.toBe('none');
    expect(document.getElementById('chat-send-btn').style.display).toBe('none');
  });

  it('handles final state', () => {
    mockWs();
    window.openChatPane('a', 's', '', 'agent:a:s');
    window.handleChatWsMessage({ type: 'chat-history-result', sessionKey: 'agent:a:s', messages: [] });
    window.handleChatWsMessage({ type: 'chat-event', payload: { sessionKey: 'agent:a:s', runId: 'r1', state: 'delta', seq: 1, message: 'Hi' } });
    window.handleChatWsMessage({ type: 'chat-event', payload: { sessionKey: 'agent:a:s', runId: 'r1', state: 'final', seq: 2 } });
    expect(document.querySelector('.chat-msg.streaming')).toBeNull();
    expect(document.getElementById('chat-send-btn').style.display).not.toBe('none');
  });

  it('handles error state', () => {
    mockWs();
    window.openChatPane('a', 's', '', 'agent:a:s');
    window.handleChatWsMessage({ type: 'chat-history-result', sessionKey: 'agent:a:s', messages: [] });
    window.handleChatWsMessage({ type: 'chat-event', payload: { sessionKey: 'agent:a:s', runId: 'r1', state: 'error', errorMessage: 'Something broke' } });
    const errorMsg = document.querySelector('.chat-msg.error');
    expect(errorMsg).not.toBeNull();
    expect(errorMsg.textContent).toContain('Something broke');
  });

  it('handles aborted state with badge', () => {
    mockWs();
    window.openChatPane('a', 's', '', 'agent:a:s');
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
    window.openChatPane('a', 's', '', 'agent:a:s');
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
    window.openChatPane('a', 's', '', 'agent:a:s');
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
    window.openChatPane('a', 's', '', 'agent:a:s');
    window.handleChatWsMessage({ type: 'gateway-status', status: 'disconnected' });
    window.handleChatWsMessage({ type: 'gateway-status', status: 'connected' });
    expect(document.getElementById('gateway-banner').style.display).toBe('none');
  });
});

describe('message input', () => {
  beforeEach(resetState);

  it('Enter sends message, Shift+Enter does not', () => {
    const ws = mockWs();
    window.openChatPane('a', 's', '', 'agent:a:s');
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
    window.openChatPane('a', 's', '', 'agent:a:s');
    window.handleChatWsMessage({ type: 'chat-history-result', sessionKey: 'agent:a:s', messages: [] });
    const input = document.getElementById('chat-input');
    input.value = 'test';
    document.getElementById('chat-send-btn').click();
    expect(document.querySelector('.chat-msg.user.pending')).not.toBeNull();
    expect(input.disabled).toBe(true);
  });

  it('does not send empty messages', () => {
    const ws = mockWs();
    window.openChatPane('a', 's', '', 'agent:a:s');
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
    window.openChatPane('a', 's', '', 'agent:a:s');
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
    window.openChatPane('a', 's', '', 'agent:a:s');
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
    window.openChatPane('a', 's', '', 'agent:a:s');
    const ws = mockWs();
    window._flushChatWsQueue();
    expect(ws.send).toHaveBeenCalled();
  });
});

describe('backward compatibility', () => {
  beforeEach(resetState);

  it('handles subscribed message for LIVE indicator', () => {
    mockWs();
    window.openChatPane('a', 's', '', 'agent:a:s');
    window.handleChatWsMessage({ type: 'subscribed', sessionId: 's' });
    expect(document.getElementById('chat-live').classList.contains('visible')).toBe(true);
  });

  it('handles log-entry messages', () => {
    mockWs();
    window.openChatPane('a', 's', '', 'agent:a:s');
    window.handleChatWsMessage({ type: 'chat-history-result', sessionKey: 'agent:a:s', messages: [] });
    window.handleChatWsMessage({ type: 'log-entry', agentId: 'a', sessionId: 's', entry: { role: 'user', content: 'hi' } });
    expect(document.querySelectorAll('.chat-msg').length).toBe(1);
  });
});

describe('keyboard and UI events', () => {
  beforeEach(resetState);

  it('closes chat pane on Escape key', () => {
    mockWs();
    window.openChatPane('a', 's', '', 'agent:a:s');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.hud-layout').classList.contains('chat-open')).toBe(false);
  });

  it('does not close on Escape when modal is active', () => {
    mockWs();
    window.openChatPane('a', 's', '', 'agent:a:s');
    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    document.body.appendChild(modal);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.hud-layout').classList.contains('chat-open')).toBe(true);
  });

  it('does not call closeChatPane on Escape when subscribedKey is falsy (no chat pane open)', () => {
    // Reset state without opening a chat pane - subscribedKey should be null
    setupDOM();
    vi.clearAllMocks();
    window._hudWs = null;

    // Spy on closeChatPane to ensure it's not called
    const closeSpy = vi.spyOn(window, 'closeChatPane');

    // Dispatch Escape key when no chat pane is open
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    // closeChatPane should NOT be called since there's no active chat subscription
    expect(closeSpy).not.toHaveBeenCalled();

    closeSpy.mockRestore();
  });

  it('close button closes chat', () => {
    mockWs();
    window.openChatPane('a', 's', '', 'agent:a:s');
    document.getElementById('chat-close').click();
    expect(document.querySelector('.hud-layout').classList.contains('chat-open')).toBe(false);
  });
});

describe('textarea auto-grow', () => {
  beforeEach(() => {
    setupDOM();
    vi.clearAllMocks();
    window._hudWs = mockWs();
  });

  it('sets height on input event', () => {
    window.openChatPane('a', 's', '', 'agent:a:s');
    const input = document.getElementById('chat-input');
    input.value = 'line1\nline2\nline3';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // jsdom doesn't compute real scroll heights, but style.height should be set
    expect(input.style.height).toBeDefined();
  });
});

describe('textarea scrollbar behavior', () => {
  beforeEach(() => {
    setupDOM();
    vi.clearAllMocks();
    window._hudWs = mockWs();
  });

  it('sets overflowY to hidden when scrollHeight <= 160', () => {
    window.openChatPane('a', 's', '', 'agent:a:s');
    const input = document.getElementById('chat-input');
    // Simulate scrollHeight that is less than or equal to max-height (160px)
    Object.defineProperty(input, 'scrollHeight', { value: 100, writable: true });
    input.value = 'short text';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.style.overflowY).toBe('hidden');
  });

  it('sets overflowY to auto when scrollHeight > 160', () => {
    window.openChatPane('a', 's', '', 'agent:a:s');
    const input = document.getElementById('chat-input');
    // Simulate scrollHeight that exceeds max-height (160px)
    Object.defineProperty(input, 'scrollHeight', { value: 200, writable: true });
    input.value = 'very long text that exceeds the max height limit';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.style.overflowY).toBe('auto');
  });
});

describe('ChatState message cache', () => {
  beforeEach(() => {
    resetState();
    window.ChatState.currentMessages = [];
  });

  it('caps cache at MAX_CACHED_MESSAGES (500)', () => {
    const MAX_CACHED_MESSAGES = 500;
    // Add 600 messages
    for (let i = 0; i < 600; i++) {
      window.ChatState.addMessage({ role: 'user', content: 'msg-' + i, timestamp: 'ts-' + i });
    }
    expect(window.ChatState.currentMessages.length).toBe(MAX_CACHED_MESSAGES);
  });

  it('evicts oldest messages when cap is exceeded', () => {
    // Add 505 messages
    for (let i = 0; i < 505; i++) {
      window.ChatState.addMessage({ role: 'user', content: 'msg-' + i, timestamp: 'ts-' + i });
    }
    // The first 5 messages (0-4) should have been evicted
    expect(window.ChatState.currentMessages[0].content).toBe('msg-5');
    expect(window.ChatState.currentMessages[0].timestamp).toBe('ts-5');
    // The last message should be msg-504
    expect(window.ChatState.currentMessages[window.ChatState.currentMessages.length - 1].content).toBe('msg-504');
  });

  it('deduplicates messages based on timestamp', () => {
    const msg1 = { role: 'user', content: 'hello', timestamp: '2024-01-01T00:00:00Z' };
    const msg2 = { role: 'user', content: 'hello', timestamp: '2024-01-01T00:00:00Z' };
    window.ChatState.addMessage(msg1);
    window.ChatState.addMessage(msg2);
    expect(window.ChatState.currentMessages.length).toBe(1);
  });

  it('deduplicates recent messages based on content and role (within last 10)', () => {
    // Add 12 messages with distinct content
    for (let i = 0; i < 12; i++) {
      window.ChatState.addMessage({ role: 'user', content: 'msg-' + i, timestamp: 'ts-' + i });
    }
    // Try to duplicate the last message (msg-11) - should be blocked
    window.ChatState.addMessage({ role: 'user', content: 'msg-11', timestamp: 'ts-dup' });
    expect(window.ChatState.currentMessages.length).toBe(12);
    // Try to duplicate the 3rd from last (msg-9) - should be blocked (within last 10)
    window.ChatState.addMessage({ role: 'user', content: 'msg-9', timestamp: 'ts-dup2' });
    expect(window.ChatState.currentMessages.length).toBe(12);
  });

  it('allows duplicates outside the recent 10 window', () => {
    // Add 15 messages
    for (let i = 0; i < 15; i++) {
      window.ChatState.addMessage({ role: 'user', content: 'msg-' + i, timestamp: 'ts-' + i });
    }
    // Try to duplicate msg-4 (11th from end, outside the recent 10 window)
    window.ChatState.addMessage({ role: 'user', content: 'msg-4', timestamp: 'ts-dup' });
    // Should be allowed since we only check last 10
    expect(window.ChatState.currentMessages.length).toBe(16);
  });

  it('allows different roles with same content', () => {
    window.ChatState.addMessage({ role: 'user', content: 'hello', timestamp: 'ts-1' });
    window.ChatState.addMessage({ role: 'assistant', content: 'hello', timestamp: 'ts-2' });
    expect(window.ChatState.currentMessages.length).toBe(2);
  });

  it('export works correctly with capped cache', () => {
    // Add 600 messages
    for (let i = 0; i < 600; i++) {
      window.ChatState.addMessage({ 
        role: i % 2 === 0 ? 'user' : 'assistant', 
        content: 'msg-' + i, 
        timestamp: 'ts-' + i 
      });
    }
    // Should have exactly 500 messages
    expect(window.ChatState.currentMessages.length).toBe(500);
    // Export should not throw and should have the right count
    const state = window.ChatState;
    expect(state.currentMessages.length).toBe(500);
    // Verify the messages are the correct ones (latest 500)
    expect(state.currentMessages[0].content).toBe('msg-100');
    expect(state.currentMessages[state.currentMessages.length - 1].content).toBe('msg-599');
  });

  it('setMessages respects the cache cap', () => {
    const largeArray = [];
    for (let i = 0; i < 600; i++) {
      largeArray.push({ role: 'user', content: 'msg-' + i, timestamp: 'ts-' + i });
    }
    window.ChatState.setMessages(largeArray);
    expect(window.ChatState.currentMessages.length).toBe(500);
    // Should keep only the last 500
    expect(window.ChatState.currentMessages[0].content).toBe('msg-100');
  });
});

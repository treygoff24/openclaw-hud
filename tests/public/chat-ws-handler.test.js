// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

function setupDOM() {
  document.body.innerHTML = `
    <div id="chat-live"></div>
    <div id="chat-messages"><div class="chat-loading">Loading...</div></div>
    <input id="chat-input" />
    <button id="chat-send-btn"></button>
    <button id="chat-stop-btn"></button>
  `;
}

function extractTextValue(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map(function(block) { return (block && typeof block.text === 'string') ? block.text : ''; })
      .join('');
  }
  if (value && typeof value === 'object' && value.content !== undefined) {
    return extractTextValue(value.content);
  }
  return '';
}

setupDOM();
if (!globalThis.crypto) globalThis.crypto = {};
globalThis.crypto.randomUUID = vi.fn(() => 'retry-uuid');

window.ChatState = {
  currentSession: null,
  activeRuns: new Map(),
  pendingAcks: new Map(),
  cachedModels: null,
  sendWs: vi.fn(),
  setMessages: vi.fn(),
};
window.ChatMessage = {
  createAssistantStreamEl: vi.fn(function() {
    var el = document.createElement('div');
    el.className = 'chat-msg assistant streaming';
    var content = document.createElement('div');
    content.className = 'chat-msg-content';
    el.appendChild(content);
    return el;
  }),
  extractText: vi.fn(extractTextValue),
  renderHistoryMessage: vi.fn(function(msg) {
    var el = document.createElement('div');
    el.className = 'chat-msg ' + (msg && msg.role ? msg.role : 'system');
    el.textContent = extractTextValue(msg);
    return el;
  }),
};
window.ChatMarkdown = {
  renderMarkdown: vi.fn(function(text) { return '<p>' + text + '</p>'; }),
};
window.ChatInput = {
  renderModelPicker: vi.fn(),
};
window.openChatPane = vi.fn();

await import('../../public/chat-ws-handler.js');

function resetState() {
  setupDOM();
  vi.clearAllMocks();
  window.ChatState.currentSession = null;
  window.ChatState.activeRuns = new Map();
  window.ChatState.pendingAcks = new Map();
  window.ChatState.cachedModels = null;
  window.ChatState.sendWs = vi.fn();
  window.ChatState.setMessages = vi.fn();
  window.WebSocketMessageBatcher = undefined;
}

function setCurrentSession() {
  window.ChatState.currentSession = {
    agentId: 'agent1',
    sessionId: 'session1',
    sessionKey: 'agent:agent1:session1',
  };
}

describe('ChatWsHandler branches', () => {
  beforeEach(resetState);

  it('renders history error path and marks container ready', () => {
    setCurrentSession();

    window.ChatWsHandler.handle({
      type: 'chat-history-result',
      sessionKey: 'agent:agent1:session1',
      error: 'history unavailable',
    });

    const errorEl = document.querySelector('#chat-messages .chat-loading');
    expect(errorEl).not.toBeNull();
    expect(errorEl.textContent).toContain('Error loading history: history unavailable');
    expect(document.getElementById('chat-messages').dataset.ready).toBe('true');
  });

  it('handles failed chat-send-ack and retry flow', () => {
    setCurrentSession();
    const input = document.getElementById('chat-input');
    input.disabled = true;

    const pending = document.createElement('div');
    pending.className = 'chat-msg user pending';
    pending.innerHTML = '<div class="chat-msg-content">retry me</div>';
    document.getElementById('chat-messages').appendChild(pending);
    window.ChatState.pendingAcks.set('ack-1', { el: pending, message: 'retry me' });

    window.ChatWsHandler.handle({ type: 'chat-send-ack', idempotencyKey: 'ack-1', ok: false });

    const retryBtn = pending.querySelector('.retry-btn');
    expect(pending.classList.contains('failed')).toBe(true);
    expect(input.disabled).toBe(false);
    expect(retryBtn).not.toBeNull();

    retryBtn.click();

    expect(pending.isConnected).toBe(false);
    const resent = document.querySelector('.chat-msg.user.pending .chat-msg-content');
    expect(resent.textContent).toBe('retry me');
    expect(window.ChatState.sendWs).toHaveBeenCalledWith(expect.objectContaining({
      type: 'chat-send',
      sessionKey: 'agent:agent1:session1',
      message: 'retry me',
      idempotencyKey: 'retry-uuid',
    }));
  });

  it('renders final chat-event via markdown renderer', () => {
    setCurrentSession();

    window.ChatWsHandler.handle({
      type: 'chat-event',
      payload: {
        sessionKey: 'agent:agent1:session1',
        runId: 'run-1',
        state: 'final',
        seq: 1,
        message: [{ type: 'text', text: '**done**' }],
      },
    });

    const msg = document.querySelector('.chat-msg.assistant.final');
    expect(msg).not.toBeNull();
    expect(msg.classList.contains('streaming')).toBe(false);
    expect(msg.querySelector('.chat-msg-content').innerHTML).toBe('<p>**done**</p>');
    expect(window.ChatMarkdown.renderMarkdown).toHaveBeenCalledWith('**done**');
    expect(window.ChatState.activeRuns.size).toBe(0);
  });

  it('toggles live indicator on chat-subscribe-ack', () => {
    setCurrentSession();

    window.ChatWsHandler.handle({
      type: 'chat-subscribe-ack',
      sessionKey: 'agent:agent1:session1',
    });

    expect(document.getElementById('chat-live').classList.contains('visible')).toBe(true);
  });

  it('caches models and calls model picker renderer', () => {
    const models = [{ id: 'gpt-5' }, { id: 'claude-sonnet-4' }];

    window.ChatWsHandler.handle({
      type: 'models-list-result',
      models,
    });

    expect(window.ChatState.cachedModels).toEqual(models);
    expect(window.ChatInput.renderModelPicker).toHaveBeenCalledWith(models);
  });

  it('opens pane on chat-new-result success', () => {
    window.ChatWsHandler.handle({
      type: 'chat-new-result',
      ok: true,
      sessionKey: 'agent:agent1:session:child',
    });

    expect(window.openChatPane).toHaveBeenCalledWith(
      'agent1',
      'session:child',
      '',
      'agent:agent1:session:child'
    );
  });

  it('routes chat-event through batcher when available', () => {
    const queue = vi.fn();
    window.WebSocketMessageBatcher = { queue };

    const event = {
      type: 'chat-event',
      payload: {
        sessionKey: 'agent:agent1:session1',
        runId: 'run-1',
        state: 'delta',
        seq: 1,
        message: 'chunk',
      },
    };
    window.ChatWsHandler.handle(event);

    expect(queue).toHaveBeenCalledWith(event);
    expect(document.querySelector('.chat-msg.assistant')).toBeNull();
  });
});

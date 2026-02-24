// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Set up the full DOM that app.js expects
document.body.innerHTML = `
  <header></header>
  <span id="stat-uptime"></span>
  <span id="clock"></span>
  <div id="toast" class="toast"></div>
  <div id="spawn-modal"><button id="new-session-btn"></button><button id="open-spawn-btn"></button><button id="spawn-cancel-btn"></button><button id="spawn-modal-close"></button><button id="spawn-launch-btn"></button></div>
  <div id="cron-modal"><button id="cron-modal-close"></button><select id="cron-session-target"><option value="main">main</option></select><select id="cron-schedule-kind"><option value="cron">cron</option></select></div>
  <span id="agent-count"></span><div id="agents-list"></div><input id="agent-search" />
  <span id="stat-agents"></span><span id="stat-active"></span>
  <span id="cron-count"></span><div id="cron-list"></div>
  <span id="session-count"></span><div id="sessions-list"></div>
  <div id="model-usage"></div>
  <span id="activity-count"></span><div id="activity-feed"></div>
  <span id="tree-count"></span><div id="tree-body"></div>
  <div id="system-info"></div><span id="sys-model"></span>
  <input id="spawn-label" /><select id="spawn-mode"><option value="run">run</option></select>
  <input id="spawn-timeout" /><textarea id="spawn-files"></textarea><textarea id="spawn-prompt"></textarea>
  <select id="spawn-agent"></select><select id="spawn-model"></select><div id="spawn-error"></div>
  <span id="cron-edit-name"></span><input id="cron-name" /><input id="cron-enabled" type="checkbox" />
  <select id="cron-agent"></select><input id="cron-expr" /><input id="cron-tz" /><input id="cron-at" />
  <select id="cron-model"></select><input id="cron-timeout" /><textarea id="cron-prompt"></textarea>
  <div id="cron-model-group"></div><div id="cron-timeout-group"></div><span id="cron-prompt-label"></span>
  <div id="cron-expr-group"></div><div id="cron-tz-group"></div><div id="cron-at-group"></div>
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
      <button id="chat-send-btn" class="chat-send-btn" title="Send">&#9654;</button>
      <button id="chat-stop-btn" class="chat-stop-btn" title="Stop" style="display:none">&#9632;</button>
    </div>
  </div>
`;

window.HUD = window.HUD || {};
// Mock makeFocusable for keyboard accessibility
window.makeFocusable = function(el, handler) {
  el.tabIndex = 0;
  el.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler();
    }
  });
};
window.escapeHtml = function(s) {
  if (s == null) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
};

// Mock fetch for all API calls
window.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve([]) }));

// Mock WebSocket
const createdSockets = [];
function createMockWs() {
  return {
    onopen: null, onmessage: null, onclose: null, onerror: null,
    send: vi.fn(), close: vi.fn(), readyState: 0,
  };
}
window.WebSocket = vi.fn(function MockWebSocket() {
  const ws = createMockWs();
  createdSockets.push(ws);
  return ws;
});
window.WebSocket.OPEN = 1;
window.WebSocket.CONNECTING = 0;
function getLatestWs() {
  return createdSockets[createdSockets.length - 1];
}

// crypto.randomUUID required by chat-pane.js
let uuidCounter = 0;
if (!globalThis.crypto) globalThis.crypto = {};
if (!globalThis.crypto.randomUUID) globalThis.crypto.randomUUID = () => 'uuid-' + (++uuidCounter);

// Mock localStorage
const _store = {};
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: vi.fn(k => Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null),
    setItem: vi.fn((k, v) => { _store[k] = v; }),
    removeItem: vi.fn(k => { delete _store[k]; }),
    clear: vi.fn(() => { Object.keys(_store).forEach(k => delete _store[k]); }),
  },
  writable: true,
});

// Load all panels first, then app.js
await import('../../public/utils.js');
await import('../../public/chat-pane.js');
const restoreSavedChatSessionSpy = vi.spyOn(window, 'restoreSavedChatSession');
await import('../../public/panels/activity.js');
await import('../../public/panels/sessions.js');
await import('../../public/panels/agents.js');
await import('../../public/panels/cron.js');
await import('../../public/panels/models.js');
await import('../../public/panels/session-tree.js');
await import('../../public/panels/system.js');
await import('../../public/panels/spawn.js');
await import('../../public/chat-message.js');
await import('../../public/chat-input.js');
await import('../../public/chat-ws-handler.js');
await import('../../public/chat-pane.js');
await import('../../public/app.js');

describe('app.js initialization', () => {
  it('sets up HUD.fetchAll', () => {
    expect(typeof HUD.fetchAll).toBe('function');
  });

  it('sets up HUD.showToast', () => {
    expect(typeof HUD.showToast).toBe('function');
  });

  it('calls fetch on initialization', () => {
    expect(window.fetch).toHaveBeenCalled();
  });

  it('creates WebSocket connection', () => {
    expect(window.WebSocket).toHaveBeenCalled();
  });
});

describe('showToast', () => {
  it('shows toast message', () => {
    HUD.showToast('Test message');
    const toast = document.getElementById('toast');
    expect(toast.textContent).toBe('Test message');
  });

  it('adds error class for error toast', () => {
    HUD.showToast('Error!', true);
    const toast = document.getElementById('toast');
    expect(toast.className).toContain('error');
  });
});

describe('clock and uptime', () => {
  it('updates uptime display', async () => {
    await new Promise(r => setTimeout(r, 50));
    const uptime = document.getElementById('stat-uptime').textContent;
    expect(uptime).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('updates clock display', async () => {
    await new Promise(r => setTimeout(r, 50));
    const clock = document.getElementById('clock').textContent;
    expect(clock.length).toBeGreaterThan(0);
  });
});

describe('event delegation', () => {
  let openChatSpy;

  beforeEach(() => {
    openChatSpy = vi.spyOn(window, 'openChatPane');
  });

  afterEach(() => {
    openChatSpy.mockRestore();
  });

  it('opens cron editor on cron row click', () => {
    // Render a cron job first
    HUD.cron.render({ jobs: [{
      id: 'j1', name: 'Test', enabled: true,
      schedule: { expr: '* * * * *' }, state: {}
    }]});
    const cronRow = document.querySelector('[data-cron-id]');
    expect(cronRow).not.toBeNull();
    cronRow.click();
    expect(document.getElementById('cron-modal').classList.contains('active')).toBe(true);
  });

  it('shows agent sessions on agent card click', () => {
    const now = Date.now();
    window._allSessions = [{ agentId: 'bot1', sessionId: 's1', sessionKey: 'agent:bot1:s1', status: 'active', updatedAt: now }];
    HUD.agents.render([{ id: 'bot1', sessions: [{ updatedAt: now }], sessionCount: 1, activeSessions: 1 }]);
    const card = document.querySelector('[data-agent-id]');
    expect(card).not.toBeNull();
    card.click();
  });

  it('handles tree node click for chat', () => {
    const now = Date.now();
    HUD.sessionTree.render([
      { key: 'k1', sessionKey: 'agent:a:s1', agentId: 'a', sessionId: 's1', status: 'active', updatedAt: now, label: 'test' }
    ]);
    const treeNode = document.querySelector('[data-tree-key]');
    expect(treeNode).not.toBeNull();
    treeNode.click();
    expect(openChatSpy).toHaveBeenCalledWith('a', 's1', 'test', 'agent:a:s1');
  });

  it('forwards canonical session key when clicking session row', () => {
    const now = Date.now();
    HUD.sessions.render([
      { key: 'agent:a:main', sessionKey: 'agent:a:main', agentId: 'a', sessionId: 'internal-session-1', status: 'active', updatedAt: now, label: 'main' }
    ]);
    const row = document.querySelector('.session-row');
    expect(row).not.toBeNull();
    row.click();
    expect(openChatSpy).toHaveBeenCalledWith('a', 'internal-session-1', 'main', 'agent:a:main');
  });

  it('handles tree toggle click', () => {
    const now = Date.now();
    HUD.sessionTree.render([
      { key: 'parent', sessionKey: 'agent:a:parent', agentId: 'a', sessionId: 'p', status: 'active', updatedAt: now, label: 'P' },
      { key: 'child', sessionKey: 'agent:a:child', agentId: 'a', sessionId: 'c', status: 'active', updatedAt: now, label: 'C', spawnedBy: 'parent' },
    ]);
    const toggle = document.querySelector('[data-toggle-key]');
    if (toggle) toggle.click();
  });
});

describe('modal close on Escape', () => {
  it('closes spawn modal on escape', () => {
    HUD.spawn.open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('spawn-modal').classList.contains('active')).toBe(false);
  });
});

describe('fetch error handling', () => {
  it('handles fetch failure in fetchAll', async () => {
    window.fetch = vi.fn(() => Promise.reject(new Error('network')));
    await HUD.fetchAll();
    // Should not throw
  });
});

describe('chat restore integration', () => {
  it('does not duplicate saved-session restore on subsequent fetchAll polls', async () => {
    await HUD.fetchAll();
    const afterFirstPoll = restoreSavedChatSessionSpy.mock.calls.length;
    await HUD.fetchAll();
    await HUD.fetchAll();
    expect(restoreSavedChatSessionSpy.mock.calls.length).toBe(afterFirstPoll);
  });
});

describe('WebSocket lifecycle', () => {
  it('reconnects after pre-open failure and flushes queued chat messages', () => {
    const firstWs = getLatestWs();
    const socketsBeforeQueue = createdSockets.length;

    // Queue a message while WS is not open
    window._hudWs = null;
    window.ChatState.sendWs({ type: 'chat-history', sessionKey: 'agent:a:s' });

    // sendWs should have triggered connectWs, creating a new WS
    expect(createdSockets.length).toBeGreaterThan(socketsBeforeQueue);
    const reconnectWs = getLatestWs();
    expect(reconnectWs).not.toBe(firstWs);

    // Open the new WS — should flush queued messages
    reconnectWs.readyState = window.WebSocket.OPEN;
    if (reconnectWs.onopen) reconnectWs.onopen();

    expect(reconnectWs.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'chat-history', sessionKey: 'agent:a:s' })
    );
  });

  it('reconnects after a successful connection drops', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    // Get the latest WS and open it successfully
    const firstWs = getLatestWs();
    firstWs.readyState = window.WebSocket.OPEN;
    if (firstWs.onopen) firstWs.onopen();

    // Simulate the connection dropping (code 1006 — network change)
    const timeoutsBefore = setTimeoutSpy.mock.calls.length;
    firstWs.readyState = 3; // CLOSED
    if (firstWs.onclose) firstWs.onclose({ code: 1006, reason: '', wasClean: false });

    // A reconnect timer should have been scheduled (even though WS was previously open)
    const timeoutsAfter = setTimeoutSpy.mock.calls.length;
    expect(timeoutsAfter).toBeGreaterThan(timeoutsBefore);

    // Fire the reconnect timer
    const reconnectTimer = setTimeoutSpy.mock.calls[timeoutsAfter - 1];
    reconnectTimer[0]();

    // Verify a new WS was created
    const reconnectWs = getLatestWs();
    expect(reconnectWs).not.toBe(firstWs);

    setTimeoutSpy.mockRestore();
  });

  it('sendWs triggers immediate reconnect when WS is dead', () => {
    // Ensure WS is fully dead (null)
    window._hudWs = null;
    const socketsBefore = createdSockets.length;

    // sendWs should call connectWs directly, creating a new WS immediately
    window.ChatState.sendWs({ type: 'chat-subscribe', sessionKey: 'agent:x:y' });

    expect(createdSockets.length).toBeGreaterThan(socketsBefore);

    // Open the new WS — queued message should flush
    const newWs = getLatestWs();
    newWs.readyState = window.WebSocket.OPEN;
    if (newWs.onopen) newWs.onopen();

    expect(newWs.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'chat-subscribe', sessionKey: 'agent:x:y' })
    );
  });

  it('handles onopen', () => {
    const ws = getLatestWs();
    ws.readyState = window.WebSocket.OPEN;
    if (ws.onopen) ws.onopen();
  });

  it('handles tick message', () => {
    const callsBefore = window.fetch.mock.calls.length;
    const ws = getLatestWs();
    if (ws.onmessage) ws.onmessage({ data: JSON.stringify({ type: 'tick' }) });
    expect(window.fetch.mock.calls.length).toBeGreaterThanOrEqual(callsBefore);
  });

  it('handles log-entry message', () => {
    const ws = getLatestWs();
    if (ws.onmessage) ws.onmessage({ data: JSON.stringify({ type: 'log-entry', entry: {} }) });
  });

  it('handles onclose', () => {
    const ws = getLatestWs();
    if (ws.onclose) ws.onclose();
  });

  it('handles onerror', () => {
    const ws = getLatestWs();
    if (ws.onerror) ws.onerror();
  });
});

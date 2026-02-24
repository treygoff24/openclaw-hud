// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Set up minimal DOM that app.js expects
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

// Mock fetch
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

// crypto.randomUUID
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

// Load all panels and app.js
await import('../../public/utils.js');
await import('../../public/label-sanitizer.js');
await import('../../public/session-labels.js');
await import('../../public/panels/activity.js');
await import('../../public/panels/sessions.js');
await import('../../public/panels/agents.js');
await import('../../public/panels/cron.js');
await import('../../public/panels/models.js');
await import('../../public/panels/session-tree.js');
await import('../../public/panels/system.js');
await import('../../public/panels/spawn.js');
await import('../../public/copy-utils.js');
await import('../../public/chat-message.js');
await import('../../public/chat-input/attachments.js');
await import('../../public/chat-input/autocomplete.js');
await import('../../public/chat-input/send-flow.js');
await import('../../public/chat-input/model-picker.js');
await import('../../public/chat-commands/catalog.js');
await import('../../public/chat-commands/fuzzy.js');
await import('../../public/chat-commands/registry.js');
await import('../../public/chat-commands/help.js');
await import('../../public/chat-commands/local-exec.js');
await import('../../public/chat-commands.js');
await import('../../public/chat-input.js');
await import('../../public/chat-ws-handler.js');
await import('../../public/app/diagnostics.js');
await import('../../public/app/status.js');
await import('../../public/app/ui.js');
await import('../../public/app/data.js');
await import('../../public/app/polling.js');
await import('../../public/app/ws.js');
await import('../../public/app/bootstrap.js');
await import('../../public/app.js');
await import('../../public/chat-pane/constants.js');
await import('../../public/chat-pane/diagnostics.js');
await import('../../public/chat-pane/session-metadata.js');
await import('../../public/chat-pane/history-timeout.js');
await import('../../public/chat-pane/transport.js');
await import('../../public/chat-pane/state.js');
await import('../../public/chat-pane/pane-lifecycle.js');
await import('../../public/chat-pane/session-restore.js');
await import('../../public/chat-pane/ws-bridge.js');
await import('../../public/chat-pane/export.js');
await import('../../public/chat-pane.js');

describe('fetchAll resilient fetching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls fetch for all endpoints', async () => {
    const fetchCalls = [];
    window.fetch = vi.fn((url) => {
      fetchCalls.push(url);
      return Promise.resolve({ json: () => Promise.resolve([]) });
    });

    await HUD.fetchAll();

    expect(fetchCalls).toContain('/api/agents');
    expect(fetchCalls).toContain('/api/sessions');
    expect(fetchCalls).toContain('/api/config');
  });

  it('renders panels even when some endpoints fail', async () => {
    const renderSpies = {
      agents: vi.spyOn(HUD.agents, 'render'),
      sessions: vi.spyOn(HUD.sessions, 'render'),
      system: vi.spyOn(HUD.system, 'render'),
    };

    window.fetch = vi.fn((url) => {
      if (url === '/api/agents') {
        return Promise.reject(new Error('agents failed'));
      }
      return Promise.resolve({ json: () => Promise.resolve([]) });
    });

    await HUD.fetchAll();

    expect(renderSpies.sessions).toHaveBeenCalled();
    expect(renderSpies.system).toHaveBeenCalled();

    renderSpies.agents.mockRestore();
    renderSpies.sessions.mockRestore();
    renderSpies.system.mockRestore();
  });

  it('renders available panels when all endpoints fail', async () => {
    const renderSpies = {
      agents: vi.spyOn(HUD.agents, 'render'),
      sessions: vi.spyOn(HUD.sessions, 'render'),
      cron: vi.spyOn(HUD.cron, 'render'),
      system: vi.spyOn(HUD.system, 'render'),
      models: vi.spyOn(HUD.models, 'render'),
      activity: vi.spyOn(HUD.activity, 'render'),
      sessionTree: vi.spyOn(HUD.sessionTree, 'render'),
    };

    window.fetch = vi.fn(() => Promise.reject(new Error('network error')));

    await HUD.fetchAll();

    Object.values(renderSpies).forEach(spy => {
      expect(spy).toHaveBeenCalled();
    });

    Object.values(renderSpies).forEach(spy => spy.mockRestore());
  });
});

describe('renderPanelSafe error boundaries', () => {
  beforeEach(() => {
    // Clear any existing error panels
    document.body.innerHTML = `
      <div id="system-info"></div>
      <span id="sys-model"></span>
      <div id="test-panel"></div>
    `;
  });

  it('catches render errors and shows unavailable state', () => {
    if (typeof renderPanelSafe !== 'function') return;

    const panelEl = document.getElementById('test-panel');

    const failingRender = () => {
      throw new Error('render failed');
    };

    // renderPanelSafe signature: (panelName, panelEl, renderFn, data)
    renderPanelSafe('test-panel', panelEl, failingRender, {});

    expect(panelEl.innerHTML).toContain('—');
    expect(panelEl.innerHTML).toContain('panel-error');
    expect(panelEl.innerHTML).toContain('panel-retry-btn');
  });

  it('calls retryPanel when retry button is clicked', () => {
    if (typeof retryPanel !== 'function' || typeof renderPanelSafe !== 'function') return;

    const panelEl = document.getElementById('test-panel');

    const failingRender = () => {
      throw new Error('render failed');
    };

    renderPanelSafe('test-panel', panelEl, failingRender, {});

    const retryBtn = panelEl.querySelector('.panel-retry-btn');
    expect(retryBtn).not.toBeNull();

    // Verify the onclick handler is set correctly
    expect(retryBtn.getAttribute('onclick')).toContain("retryPanel('test-panel')");
  });

  it('renders normally when no error', () => {
    if (typeof renderPanelSafe !== 'function') return;

    const panelEl = document.getElementById('test-panel');

    const successfulRender = (el, data) => {
      el.innerHTML = `<div class="success">${data.value}</div>`;
    };

    renderPanelSafe('test-panel', panelEl, successfulRender, { value: 'test-value' });

    expect(panelEl.innerHTML).toContain('test-value');
    expect(panelEl.innerHTML).not.toContain('panel-error');
  });
});

describe('setConnectionStatus with per-panel states', () => {
  it('shows disconnected badge when all panels fail', async () => {
    window.fetch = vi.fn(() => Promise.reject(new Error('network')));

    await HUD.fetchAll();

    const badge = document.getElementById('connection-badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toContain('DISCONNECTED');
  });
});

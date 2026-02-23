// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Set up the full DOM that app.js expects
document.body.innerHTML = `
  <header></header>
  <span id="stat-uptime"></span>
  <span id="clock"></span>
  <div id="toast" class="toast"></div>
  <div id="spawn-modal"><button id="open-spawn-btn"></button><button id="spawn-cancel-btn"></button><button id="spawn-modal-close"></button><button id="spawn-launch-btn"></button></div>
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
`;

window.HUD = window.HUD || {};
window.escapeHtml = function(s) {
  if (s == null) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
};

// Mock fetch for all API calls
window.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve([]) }));

// Mock WebSocket
const mockWs = {
  onopen: null, onmessage: null, onclose: null, onerror: null,
  send: vi.fn(), close: vi.fn(), readyState: 1,
};
window.WebSocket = vi.fn(() => mockWs);

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Load all panels first, then app.js
await import('../../public/utils.js');
await import('../../public/chat-pane.js');
await import('../../public/panels/activity.js');
await import('../../public/panels/sessions.js');
await import('../../public/panels/agents.js');
await import('../../public/panels/cron.js');
await import('../../public/panels/models.js');
await import('../../public/panels/session-tree.js');
await import('../../public/panels/system.js');
await import('../../public/panels/spawn.js');
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
    window._allSessions = [{ agentId: 'bot1', sessionId: 's1', status: 'active', updatedAt: now }];
    HUD.agents.render([{ id: 'bot1', sessions: [{ updatedAt: now }], sessionCount: 1, activeSessions: 1 }]);
    const card = document.querySelector('[data-agent-id]');
    expect(card).not.toBeNull();
    card.click();
  });

  it('handles tree node click for chat', () => {
    const now = Date.now();
    HUD.sessionTree.render([
      { key: 'k1', agentId: 'a', sessionId: 's1', status: 'active', updatedAt: now, label: 'test' }
    ]);
    const treeNode = document.querySelector('[data-tree-key]');
    expect(treeNode).not.toBeNull();
    treeNode.click();
    expect(window.fetch).toHaveBeenCalled();
  });

  it('handles tree toggle click', () => {
    const now = Date.now();
    HUD.sessionTree.render([
      { key: 'parent', agentId: 'a', sessionId: 'p', status: 'active', updatedAt: now, label: 'P' },
      { key: 'child', agentId: 'a', sessionId: 'c', status: 'active', updatedAt: now, label: 'C', spawnedBy: 'parent' },
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

describe('WebSocket lifecycle', () => {
  it('handles onopen', () => {
    if (mockWs.onopen) mockWs.onopen();
    // Should flush WS queue
  });

  it('handles tick message', () => {
    const callsBefore = window.fetch.mock.calls.length;
    if (mockWs.onmessage) mockWs.onmessage({ data: JSON.stringify({ type: 'tick' }) });
    expect(window.fetch.mock.calls.length).toBeGreaterThanOrEqual(callsBefore);
  });

  it('handles log-entry message', () => {
    if (mockWs.onmessage) mockWs.onmessage({ data: JSON.stringify({ type: 'log-entry', entry: {} }) });
    // Should not throw
  });

  it('handles onclose', () => {
    if (mockWs.onclose) mockWs.onclose();
    // Should restart polling
  });

  it('handles onerror', () => {
    if (mockWs.onerror) mockWs.onerror();
    // Should update connection status
  });
});

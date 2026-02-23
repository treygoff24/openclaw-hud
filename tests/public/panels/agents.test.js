// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';

document.body.innerHTML = `
  <span id="agent-count"></span>
  <div id="agents-list"></div>
  <input id="agent-search" />
  <span id="stat-agents"></span>
  <span id="stat-active"></span>
  <span id="session-count"></span>
  <div id="sessions-list"></div>
`;
window.HUD = window.HUD || {};
window._agents = [];
window._allSessions = [];
window.escapeHtml = function(s) {
  if (s == null) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
};
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

// Load sessions panel first (agents depends on HUD.sessions)
await import('../../../public/utils.js');
await import('../../../public/panels/sessions.js');
await import('../../../public/panels/agents.js');

describe('agents.render', () => {
  beforeEach(() => {
    document.getElementById('agents-list').innerHTML = '';
    document.getElementById('agent-count').textContent = '';
  });

  it('renders agent count', () => {
    HUD.agents.render([{ id: 'bot1', sessions: [], sessionCount: 0, activeSessions: 0 }]);
    expect(document.getElementById('agent-count').textContent).toBe('1');
  });

  it('renders agent cards with correct structure', () => {
    const now = Date.now();
    HUD.agents.render([{
      id: 'mybot', sessions: [{ updatedAt: now - 1000 }], sessionCount: 3, activeSessions: 1
    }]);
    const cards = document.querySelectorAll('.agent-card');
    expect(cards.length).toBe(1);
    expect(cards[0].querySelector('.agent-id').textContent).toContain('mybot');
    expect(cards[0].querySelector('.agent-id').textContent).toContain('1 live');
    expect(cards[0].querySelector('.agent-sessions-count').textContent).toBe('3 sess');
  });

  it('shows green dot for recently active agents', () => {
    const now = Date.now();
    HUD.agents.render([{
      id: 'active-bot', sessions: [{ updatedAt: now - 1000 }], sessionCount: 1, activeSessions: 1
    }]);
    expect(document.querySelector('.status-dot-green')).not.toBeNull();
  });

  it('shows gray dot for inactive agents', () => {
    HUD.agents.render([{
      id: 'old-bot', sessions: [{ updatedAt: Date.now() - 999999999 }], sessionCount: 1, activeSessions: 0
    }]);
    expect(document.querySelector('.status-dot-gray')).not.toBeNull();
  });

  it('updates stat-agents and stat-active', () => {
    const now = Date.now();
    HUD.agents.render([
      { id: 'a', sessions: [{ updatedAt: now }], sessionCount: 1, activeSessions: 1 },
      { id: 'b', sessions: [{ updatedAt: now - 999999 }], sessionCount: 1, activeSessions: 0 },
    ]);
    expect(document.getElementById('stat-agents').textContent).toBe('2');
  });

  it('renders empty array', () => {
    HUD.agents.render([]);
    expect(document.getElementById('agent-count').textContent).toBe('0');
  });
});

describe('agents.showAgentSessions', () => {
  it('shows "No sessions" when agent has no sessions', () => {
    window._allSessions = [];
    HUD.agents.showAgentSessions('nonexistent');
    expect(document.getElementById('sessions-list').textContent).toContain('No sessions');
  });

  it('renders filtered sessions for the agent', () => {
    window._allSessions = [
      { agentId: 'bot', sessionId: 's1', sessionKey: 'agent:bot:s1', status: 'active', updatedAt: Date.now() },
      { agentId: 'other', sessionId: 's2', sessionKey: 'agent:other:s2', status: 'active', updatedAt: Date.now() },
    ];
    HUD.agents.showAgentSessions('bot');
    expect(document.querySelectorAll('.session-row').length).toBe(1);
  });
});

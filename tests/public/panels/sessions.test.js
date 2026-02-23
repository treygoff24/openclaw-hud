// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';

document.body.innerHTML = '<span id="session-count"></span><div id="sessions-list"></div>';
window.HUD = window.HUD || {};
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

// Load utils for HUD.utils.timeAgo
await import('../../../public/utils.js');
await import('../../../public/panels/sessions.js');

describe('sessions.render', () => {
  beforeEach(() => {
    document.getElementById('session-count').textContent = '';
    document.getElementById('sessions-list').innerHTML = '';
  });

  it('renders session count', () => {
    HUD.sessions.render([
      { agentId: 'a', sessionId: 's1', sessionKey: 'agent:a:s1', status: 'active', updatedAt: Date.now() }
    ]);
    expect(document.getElementById('session-count').textContent).toBe('1');
  });

  it('renders session rows with correct structure', () => {
    HUD.sessions.render([
      { agentId: 'bot', sessionId: 'abc12345xyz', sessionKey: 'agent:bot:abc12345xyz', label: 'my-session', status: 'active', updatedAt: Date.now() - 5000 }
    ]);
    const rows = document.querySelectorAll('.session-row');
    expect(rows.length).toBe(1);
    expect(rows[0].querySelector('.session-agent').textContent).toBe('bot');
    expect(rows[0].querySelector('.session-label').textContent).toBe('my-session');
    expect(rows[0].querySelector('.status-dot-green')).not.toBeNull();
  });

  it('uses correct status dot classes', () => {
    const statuses = [
      { status: 'active', expected: 'status-dot-green' },
      { status: 'completed', expected: 'status-dot-completed' },
      { status: 'warm', expected: 'status-dot-amber' },
      { status: 'stale', expected: 'status-dot-gray' },
      { status: 'unknown', expected: 'status-dot-gray' }
    ];
    statuses.forEach(({ status, expected }) => {
      HUD.sessions.render([{ agentId: 'a', sessionId: 's', sessionKey: `agent:a:s-${status}`, status, updatedAt: Date.now() }]);
      expect(document.querySelector(`.${expected}`)).not.toBeNull();
    });
  });

  it('shows depth tag for subagents', () => {
    HUD.sessions.render([
      { agentId: 'a', sessionId: 's', sessionKey: 'agent:a:s', status: 'active', spawnDepth: 2, updatedAt: Date.now() }
    ]);
    expect(document.querySelector('.session-label').innerHTML).toContain('depth:2');
  });

  it('does not show depth tag when spawnDepth is 0', () => {
    HUD.sessions.render([
      { agentId: 'a', sessionId: 's', sessionKey: 'agent:a:s', status: 'active', spawnDepth: 0, updatedAt: Date.now() }
    ]);
    expect(document.querySelector('.session-label').innerHTML).not.toContain('depth');
  });

  it('renders empty array', () => {
    HUD.sessions.render([]);
    expect(document.getElementById('session-count').textContent).toBe('0');
  });

  it('caps at 40 rows', () => {
    const sessions = Array.from({ length: 50 }, (_, i) => ({
      agentId: 'a', sessionId: `s${i}`, sessionKey: `agent:a:s${i}`, status: 'active', updatedAt: Date.now()
    }));
    HUD.sessions.render(sessions);
    expect(document.getElementById('session-count').textContent).toBe('50');
    expect(document.querySelectorAll('.session-row').length).toBe(40);
  });

  it('sets data attributes on session rows', () => {
    HUD.sessions.render([
      { agentId: 'bot', sessionId: 'xyz', sessionKey: 'agent:bot:xyz', label: 'lbl', status: 'active', updatedAt: Date.now() }
    ]);
    const row = document.querySelector('.session-row');
    expect(row.dataset.agent).toBe('bot');
    expect(row.dataset.session).toBe('xyz');
    expect(row.dataset.sessionKey).toBe('agent:bot:xyz');
  });

  it('throws explicitly when sessionKey is missing', () => {
    expect(() => {
      HUD.sessions.render([
        { agentId: 'bot', sessionId: 'xyz', label: 'lbl', status: 'active', updatedAt: Date.now() }
      ]);
    }).toThrow('sessions.render requires canonical sessionKey for each session');
  });
});

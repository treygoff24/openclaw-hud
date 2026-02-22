// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';

document.body.innerHTML = '<span id="activity-count"></span><div id="activity-feed"></div>';
window.HUD = window.HUD || {};
// Provide escapeHtml globally (as utils.js does)
window.escapeHtml = function(s) {
  if (s == null) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
};

await import('../../../public/panels/activity.js');

describe('activity.render', () => {
  beforeEach(() => {
    document.getElementById('activity-count').textContent = '';
    document.getElementById('activity-feed').innerHTML = '';
  });

  it('renders event count', () => {
    HUD.activity.render([
      { timestamp: Date.now(), type: 'message', agentId: 'bot', content: 'hello' }
    ]);
    expect(document.getElementById('activity-count').textContent).toBe('1');
  });

  it('renders activity items with correct structure', () => {
    HUD.activity.render([
      { timestamp: '2025-01-15T12:30:00Z', type: 'session', agentId: 'agent1', content: 'started' }
    ]);
    const items = document.querySelectorAll('.activity-item');
    expect(items.length).toBe(1);
    expect(items[0].querySelector('.activity-type').textContent).toBe('session');
    expect(items[0].querySelector('.activity-agent').textContent).toBe('agent1');
    expect(items[0].querySelector('.activity-content').textContent).toBe('started');
  });

  it('shows toolName with ⚡ prefix', () => {
    HUD.activity.render([
      { timestamp: Date.now(), type: 'tool', agentId: 'a', toolName: 'web_search' }
    ]);
    expect(document.querySelector('.activity-content').textContent).toBe('⚡ web_search');
  });

  it('renders empty array', () => {
    HUD.activity.render([]);
    expect(document.getElementById('activity-count').textContent).toBe('0');
    expect(document.querySelectorAll('.activity-item').length).toBe(0);
  });

  it('handles missing fields gracefully', () => {
    HUD.activity.render([{ timestamp: Date.now() }]);
    const item = document.querySelector('.activity-item');
    expect(item.querySelector('.activity-type').textContent).toBe('?');
  });

  it('renders multiple events', () => {
    HUD.activity.render([
      { timestamp: Date.now(), type: 'a', agentId: 'x', content: '1' },
      { timestamp: Date.now(), type: 'b', agentId: 'y', content: '2' },
      { timestamp: Date.now(), type: 'c', agentId: 'z', content: '3' }
    ]);
    expect(document.querySelectorAll('.activity-item').length).toBe(3);
  });
});

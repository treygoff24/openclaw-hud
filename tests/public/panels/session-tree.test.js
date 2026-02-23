// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';

document.body.innerHTML = `
  <span id="tree-count"></span>
  <div id="tree-body"></div>
`;
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

await import('../../../public/utils.js');
await import('../../../public/panels/session-tree.js');

describe('sessionTree.render', () => {
  beforeEach(() => {
    document.getElementById('tree-body').innerHTML = '';
    document.getElementById('tree-count').textContent = '';
  });

  it('renders tree count', () => {
    const now = Date.now();
    HUD.sessionTree.render([
      { key: 'k1', agentId: 'a', sessionId: 's1', status: 'active', updatedAt: now, label: 'test' }
    ]);
    expect(document.getElementById('tree-count').textContent).toBe('1');
  });

  it('renders tree nodes with labels', () => {
    const now = Date.now();
    HUD.sessionTree.render([
      { key: 'k1', agentId: 'a', sessionId: 's1', status: 'active', updatedAt: now, label: 'my-session' }
    ]);
    expect(document.querySelector('.tree-label').textContent).toBe('my-session');
    expect(document.querySelector('.tree-agent').textContent).toBe('a');
  });

  it('renders parent-child relationships', () => {
    const now = Date.now();
    HUD.sessionTree.render([
      { key: 'parent', agentId: 'a', sessionId: 'p', status: 'active', updatedAt: now, label: 'Parent' },
      { key: 'child', agentId: 'a', sessionId: 'c', status: 'active', updatedAt: now, label: 'Child', spawnedBy: 'parent' },
    ]);
    expect(document.querySelectorAll('.tree-node').length).toBe(2);
    const children = document.querySelectorAll('.tree-children .tree-node');
    expect(children.length).toBe(1);
  });

  it('renders empty array', () => {
    HUD.sessionTree.render([]);
    expect(document.getElementById('tree-count').textContent).toBe('0');
  });

  it('uses correct status dot classes', () => {
    const now = Date.now();
    HUD.sessionTree.render([
      { key: 'k1', agentId: 'a', sessionId: 's', status: 'active', updatedAt: now }
    ]);
    expect(document.querySelector('.status-dot-green')).not.toBeNull();
  });
});

describe('sessionTree.toggleNode', () => {
  it('collapses and expands nodes', () => {
    const now = Date.now();
    HUD.sessionTree.render([
      { key: 'parent', agentId: 'a', sessionId: 'p', status: 'active', updatedAt: now, label: 'Parent' },
      { key: 'child', agentId: 'a', sessionId: 'c', status: 'active', updatedAt: now, label: 'Child', spawnedBy: 'parent' },
    ]);
    // Toggle collapse
    HUD.sessionTree.toggleNode('parent');
    expect(document.querySelector('.tree-children.collapsed')).not.toBeNull();
    // Toggle expand
    HUD.sessionTree.toggleNode('parent');
    expect(document.querySelector('.tree-children.collapsed')).toBeNull();
  });
});

window.HUD = window.HUD || {};
HUD.sessionTree = (function() {
  'use strict';
  const $ = s => document.querySelector(s);
  const collapseState = {};

  function render(sessions) {
    window._treeData = sessions;
    $('#tree-count').textContent = sessions.length;

    const byKey = {};
    sessions.forEach(s => { byKey[s.key] = s; });
    const children = {};
    const roots = [];
    sessions.forEach(s => {
      if (s.spawnedBy && byKey[s.spawnedBy]) {
        if (!children[s.spawnedBy]) children[s.spawnedBy] = [];
        children[s.spawnedBy].push(s);
      } else {
        roots.push(s);
      }
    });
    for (const k in children) children[k].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    roots.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    function renderNode(node, prefix, isLast) {
      const statusMap = { active: 'status-dot-green', completed: 'status-dot-completed', warm: 'status-dot-amber', stale: 'status-dot-gray' };
      const dotClass = statusMap[node.status] || 'status-dot-gray';
      const label = node.label || node.key;
      const kids = children[node.key] || [];
      const hasKids = kids.length > 0;
      const collapsed = collapseState[node.key] === true;
      const toggleChar = hasKids ? (collapsed ? '▸' : '▾') : ' ';
      const countBadge = (hasKids && collapsed) ? `<span class="tree-child-count">${kids.length}</span>` : '';

      let html = `<div class="tree-node">
        <div class="tree-node-content" data-tree-key="${escapeHtml(node.key)}" data-agent="${escapeHtml(node.agentId || '')}" data-session="${escapeHtml(node.sessionId || '')}" data-label="${escapeHtml(label)}">
          <span class="tree-indent">${escapeHtml(prefix)}</span>
          <span class="tree-toggle" data-toggle-key="${escapeHtml(node.key)}">${toggleChar}</span>
          <div class="${dotClass}"></div>
          <span class="tree-label">${escapeHtml(label)}</span>
          <span class="tree-agent">${escapeHtml(node.agentId || '')}</span>
          ${countBadge}
          <span class="tree-age">${HUD.utils.timeAgo(node.updatedAt)}</span>
        </div>`;

      if (hasKids) {
        html += `<div class="tree-children${collapsed ? ' collapsed' : ''}">`;
        kids.forEach((kid, i) => {
          const kidIsLast = i === kids.length - 1;
          const childPrefix = prefix + (isLast ? '   ' : '│  ');
          const connector = kidIsLast ? '└─ ' : '├─ ';
          html += renderNode(kid, childPrefix + connector, kidIsLast);
        });
        html += '</div>';
      }
      html += '</div>';
      return html;
    }

    let html = '<div class="tree-root">';
    roots.forEach((r, i) => {
      const connector = i === roots.length - 1 ? '└─ ' : '├─ ';
      html += renderNode(r, connector, i === roots.length - 1);
    });
    html += '</div>';

    $('#tree-body').innerHTML = html;
  }

  function toggleNode(key) {
    collapseState[key] = !collapseState[key];
    if (window._treeData) render(window._treeData);
  }

  return { render, toggleNode };
})();

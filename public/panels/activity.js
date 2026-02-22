window.HUD = window.HUD || {};
HUD.activity = (function() {
  'use strict';
  const $ = s => document.querySelector(s);

  function render(events) {
    $('#activity-count').textContent = events.length;
    $('#activity-feed').innerHTML = events.map(e => {
      const t = new Date(e.timestamp);
      const time = t.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
      let content = e.content || e.type || '';
      if (e.toolName) content = `⚡ ${e.toolName}`;
      return `<div class="activity-item">
        <span class="activity-time">${time}</span>
        <span class="activity-type ${escapeHtml(e.type || 'session')}">${escapeHtml(e.type || '?')}</span>
        <span class="activity-agent">${escapeHtml(e.agentId)}</span>
        <span class="activity-content">${escapeHtml(content)}</span>
      </div>`;
    }).join('');
  }

  return { render };
})();

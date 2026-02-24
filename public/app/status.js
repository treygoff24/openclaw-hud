(function() {
  'use strict';

  window.HUDApp = window.HUDApp || {};

  function createStatusController(options) {
    const opts = options || {};
    const doc = opts.document || document;
    const $ = opts.querySelector || function(selector) { return doc.querySelector(selector); };
    const pageStartTime = Date.now();
    let connected = true;

    function updateUptime() {
      const diff = Date.now() - pageStartTime;
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      const el = doc.getElementById('stat-uptime');
      if (!el) return;
      el.textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }

    function updateClock() {
      const now = new Date();
      const clockEl = $('#clock');
      if (!clockEl) return;
      clockEl.textContent = now.toLocaleString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    }

    function setConnectionStatus(ok) {
      connected = !!ok;
      let badge = doc.getElementById('connection-badge');
      if (!badge) {
        badge = doc.createElement('span');
        badge.id = 'connection-badge';
        badge.style.cssText = 'color:#ff1744;font-weight:bold;font-size:12px;margin-left:12px;font-family:var(--font-mono);';
        const header = $('header') || doc.querySelector('.header') || doc.body.firstElementChild;
        if (header) header.appendChild(badge);
      }

      badge.textContent = connected ? '' : '⚠ DISCONNECTED';
      badge.style.display = connected ? 'none' : 'inline';
    }

    function start() {
      setInterval(updateUptime, 1000);
      updateUptime();
      setInterval(updateClock, 1000);
      updateClock();
    }

    function isConnected() {
      return connected;
    }

    return {
      start,
      setConnectionStatus,
      isConnected,
    };
  }

  window.HUDApp.status = {
    createStatusController,
  };
})();

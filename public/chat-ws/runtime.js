(function() {
  'use strict';

  var CHAT_LOG_PREFIX = '[HUD-CHAT]';

  if (!window.__hudDiagLog) {
    window.__hudDiagLog = function(prefix, event, fields) {
      var now = new Date().toISOString();
      var diag = window.__HUD_DIAG__ || (window.__HUD_DIAG__ = { maxEvents: 200, events: [], seq: 0 });
      if (!Array.isArray(diag.events)) diag.events = [];
      if (!diag.maxEvents || diag.maxEvents < 1) diag.maxEvents = 200;
      if (typeof diag.seq !== 'number') diag.seq = 0;
      var payload = fields || {};
      var entry = Object.assign({ seq: ++diag.seq, ts: now, prefix: prefix, event: event }, payload);
      diag.events.push(entry);
      if (diag.events.length > diag.maxEvents) {
        diag.events.splice(0, diag.events.length - diag.maxEvents);
      }
      var parts = [];
      for (var key in payload) {
        if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
        var value = payload[key];
        if (value === undefined) continue;
        parts.push(key + '=' + (typeof value === 'string' ? JSON.stringify(value) : String(value)));
      }
      console.log((prefix + ' ' + event + ' ts=' + now + (parts.length ? ' ' + parts.join(' ') : '')).trim());
    };
  }

  function updateButtons() {
    var sendBtn = document.getElementById('chat-send-btn');
    var stopBtn = document.getElementById('chat-stop-btn');
    if (!sendBtn || !stopBtn) return;

    var active = window.ChatState.activeRuns.size > 0;
    sendBtn.style.display = active ? 'none' : '';
    stopBtn.style.display = active ? '' : 'none';
  }

  function showLive(match) {
    if (!match) return;
    var el = document.getElementById('chat-live');
    if (el) el.classList.add('visible');
  }

  function createRetryBtn(sessionKey, message, parentEl) {
    var btn = document.createElement('button');
    btn.className = 'retry-btn';
    btn.textContent = 'Retry';
    btn.dataset.sessionKey = sessionKey || '';
    btn.dataset.message = message || '';
    btn.onclick = function() {
      parentEl.remove();
      var key = crypto.randomUUID();
      var div = document.createElement('div');
      div.className = 'chat-msg user pending';
      var role = document.createElement('span');
      role.className = 'chat-msg-role user';
      role.textContent = 'user';
      div.appendChild(role);
      var content = document.createElement('div');
      content.className = 'chat-msg-content';
      content.textContent = this.dataset.message || '(retry)';
      div.appendChild(content);
      var container = document.getElementById('chat-messages');
      if (container) container.appendChild(div);
      window.ChatState.sendWs({
        type: 'chat-send',
        sessionKey: this.dataset.sessionKey,
        message: this.dataset.message || '(retry)',
        idempotencyKey: key
      });
    };
    return btn;
  }

  window.ChatWsRuntime = {
    CHAT_LOG_PREFIX: CHAT_LOG_PREFIX,
    hudDiagLog: window.__hudDiagLog,
    updateButtons: updateButtons,
    showLive: showLive,
    createRetryBtn: createRetryBtn
  };
})();

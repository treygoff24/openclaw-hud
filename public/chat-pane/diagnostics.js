(function() {
  'use strict';
  var runtime = window.ChatPaneRuntime || (window.ChatPaneRuntime = {});

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

  runtime.hudDiagLog = window.__hudDiagLog;
})();

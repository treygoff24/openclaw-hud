// app.js — Thin entry point: initialization, fetchAll, polling/WebSocket
(function() {
  'use strict';
  const $ = s => document.querySelector(s);
  const WS_LOG_PREFIX = '[HUD-WS]';

  if (!window.__hudDiagLog) {
    window.__hudDiagLog = function(prefix, event, fields) {
      const now = new Date().toISOString();
      const diag = window.__HUD_DIAG__ || (window.__HUD_DIAG__ = { maxEvents: 200, events: [], seq: 0 });
      if (!Array.isArray(diag.events)) diag.events = [];
      if (!diag.maxEvents || diag.maxEvents < 1) diag.maxEvents = 200;
      if (typeof diag.seq !== 'number') diag.seq = 0;
      const payload = fields || {};
      const entry = Object.assign({ seq: ++diag.seq, ts: now, prefix: prefix, event: event }, payload);
      diag.events.push(entry);
      if (diag.events.length > diag.maxEvents) {
        diag.events.splice(0, diag.events.length - diag.maxEvents);
      }
      const parts = [];
      for (const key in payload) {
        if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
        const value = payload[key];
        if (value === undefined) continue;
        parts.push(key + '=' + (typeof value === 'string' ? JSON.stringify(value) : String(value)));
      }
      console.log((prefix + ' ' + event + ' ts=' + now + (parts.length ? ' ' + parts.join(' ') : '')).trim());
    };
  }
  const hudDiagLog = window.__hudDiagLog;

  // Uptime counter
  const pageStartTime = Date.now();
  function updateUptime() {
    const diff = Date.now() - pageStartTime;
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    const el = document.getElementById('stat-uptime');
    if (el) el.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }
  setInterval(updateUptime, 1000);
  updateUptime();

  // Clock
  function updateClock() {
    const now = new Date();
    $('#clock').textContent = now.toLocaleString('en-US', {
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
      year: 'numeric', month: '2-digit', day: '2-digit'
    });
  }
  setInterval(updateClock, 1000);
  updateClock();

  // Connection status
  let connected = true;
  let hasAttemptedChatSessionRestore = false;
  function setConnectionStatus(ok) {
    connected = ok;
    let badge = document.getElementById('connection-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'connection-badge';
      badge.style.cssText = 'color:#ff1744;font-weight:bold;font-size:12px;margin-left:12px;font-family:var(--font-mono);';
      const header = $('header') || document.querySelector('.header') || document.body.firstElementChild;
      if (header) header.appendChild(badge);
    }
    badge.textContent = ok ? '' : '⚠ DISCONNECTED';
    badge.style.display = ok ? 'none' : 'inline';
  }

  // Event delegation for clickable rows
  document.addEventListener('click', e => {
    const cronRow = e.target.closest('[data-cron-id]');
    if (cronRow) {
      HUD.cron.openEditor(cronRow.dataset.cronId);
      return;
    }
    const row = e.target.closest('[data-agent][data-session-key]');
    if (row) {
      openChatPane(row.dataset.agent, row.dataset.session || '', row.dataset.label || '', row.dataset.sessionKey);
    }
    const card = e.target.closest('[data-agent-id]');
    if (card && !row) {
      HUD.agents.showAgentSessions(card.dataset.agentId);
    }
  });

  // Tree event delegation
  document.addEventListener('click', e => {
    const toggle = e.target.closest('[data-toggle-key]');
    if (toggle) {
      HUD.sessionTree.toggleNode(toggle.dataset.toggleKey);
      e.stopPropagation();
      return;
    }
    const treeNode = e.target.closest('[data-tree-key]');
    if (treeNode && !e.target.closest('[data-toggle-key]')) {
      const agent = treeNode.dataset.agent;
      const session = treeNode.dataset.session;
      const sessionKey = treeNode.dataset.sessionKey;
      if (agent && sessionKey) openChatPane(agent, session || '', treeNode.dataset.label || '', sessionKey);
    }
  });

  // Modal close on Escape
  function closeModal() {
    const modals = ['#spawn-modal', '#cron-modal'];
    for (const id of modals) {
      if ($(id).classList.contains('active')) {
        $(id).classList.remove('active');
        return;
      }
    }
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const modals = ['#spawn-modal', '#cron-modal'];
      for (const id of modals) {
        if ($(id).classList.contains('active')) {
          e.preventDefault();
          $(id).classList.remove('active');
          e.stopImmediatePropagation();
          return;
        }
      }
    }
  });

  // Toast
  function showToast(message, isError = false) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.className = 'toast' + (isError ? ' error' : '');
    requestAnimationFrame(() => {
      toast.classList.add('visible');
      setTimeout(() => toast.classList.remove('visible'), 3000);
    });
  }
  HUD.showToast = showToast;

  // Per-panel error boundary - wraps render functions to catch errors gracefully
  function renderPanelSafe(panelName, panelEl, renderFn, data) {
    if (!panelEl) {
      console.warn(`Panel element not found: ${panelName}`);
      return;
    }
    try {
      renderFn(panelEl, data);
    } catch (err) {
      console.error(`Panel render failed: ${panelName}`, err);
      panelEl.innerHTML = `
        <div class="panel-error">
          <span class="panel-error-msg">—</span>
          <button class="panel-retry-btn" onclick="retryPanel('${panelName}')" title="Retry">↻</button>
        </div>`;
    }
  }
  window.renderPanelSafe = renderPanelSafe;

  // Retry a specific panel by re-fetching all data
  function retryPanel(panelName) {
    console.log(`Retrying panel: ${panelName}`);
    fetchAll();
  }
  window.retryPanel = retryPanel;

  // Fetch all data with resilience - uses Promise.allSettled so individual failures don't blank all panels
  async function fetchAll() {
    const endpoints = [
      { name: 'agents', url: '/api/agents' },
      { name: 'sessions', url: '/api/sessions' },
      { name: 'cron', url: '/api/cron' },
      { name: 'config', url: '/api/config' },
      { name: 'model-usage', url: '/api/model-usage' },
      { name: 'activity', url: '/api/activity' },
      { name: 'session-tree', url: '/api/session-tree' },
      { name: 'models', url: '/api/models' },
    ];

    try {
      // Use Promise.allSettled so one failure doesn't reject all
      const results = await Promise.allSettled(
        endpoints.map(e => fetch(e.url).then(r => r.json()).catch(err => {
          console.warn(`Endpoint ${e.name} failed:`, err);
          return null; // Return null for failed endpoints
        }))
      );

      // Extract data or null for each endpoint
      const data = {};
      results.forEach((result, index) => {
        data[endpoints[index].name] = result.status === 'fulfilled' ? result.value : null;
      });

      // Store global data
      window._modelAliases = data.models || [];
      window._allSessions = data.sessions || [];

      // Render each panel with error boundaries
      renderPanelSafe('agents', document.getElementById('agents-list'), (el, d) => HUD.agents.render(d), data.agents);
      renderPanelSafe('sessions', document.getElementById('sessions-list'), (el, d) => HUD.sessions.render(d), data.sessions);
      renderPanelSafe('cron', document.getElementById('cron-list'), (el, d) => HUD.cron.render(d), data.cron);
      renderPanelSafe('system', document.getElementById('system-info'), (el, d) => HUD.system.render(d), data.config);
      renderPanelSafe('models', document.getElementById('model-usage'), (el, d) => HUD.models.render(d), data['model-usage']);
      renderPanelSafe('activity', document.getElementById('activity-feed'), (el, d) => HUD.activity.render(d), data.activity);
      renderPanelSafe('session-tree', document.getElementById('tree-body'), (el, d) => HUD.sessionTree.render(d), data['session-tree']);

      // Restore chat session only once
      if (!hasAttemptedChatSessionRestore && typeof window.restoreSavedChatSession === 'function' && data.sessions) {
        hasAttemptedChatSessionRestore = true;
        window.restoreSavedChatSession(data.sessions);
      }

      // Set connection status based on whether any data was retrieved
      const hasAnyData = results.some(r => r.status === 'fulfilled' && r.value !== null);
      setConnectionStatus(hasAnyData);
    } catch (err) {
      console.error('Fetch error:', err);
      setConnectionStatus(false);
    }
  }
  HUD.fetchAll = fetchAll;

  // Initialize panels
  HUD.agents.init();
  HUD.cron.init();
  HUD.spawn.init();

  fetchAll();

  // Polling management
  let pollInterval = null;
  function startPolling() {
    if (!pollInterval) pollInterval = setInterval(fetchAll, 15000);
  }
  function stopPolling() {
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  }
  startPolling();

  // WebSocket for ticks
  const WS_RECONNECT_BASE_MS = 500;
  const WS_RECONNECT_MAX_MS = 5000;
  const WS_RECONNECT_JITTER_MS = 250;
  let wsReconnectAttempts = 0;
  let wsReconnectTimer = null;
  let wsEverOpened = false;
  let wsConnectAttempt = 0;

  function clearWsReconnectTimer() {
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }
  }

  function scheduleWsReconnect(trigger) {
    if (wsEverOpened || wsReconnectTimer) return;
    const exp = Math.min(wsReconnectAttempts, 6);
    const backoff = Math.min(WS_RECONNECT_MAX_MS, WS_RECONNECT_BASE_MS * Math.pow(2, exp));
    const jitter = Math.floor(Math.random() * WS_RECONNECT_JITTER_MS);
    const delayMs = backoff + jitter;
    const reconnectAttempt = wsReconnectAttempts + 1;
    hudDiagLog(WS_LOG_PREFIX, 'reconnect_scheduled', {
      trigger: trigger || 'unknown',
      reconnectAttempt: reconnectAttempt,
      delayMs: delayMs,
      backoffMs: backoff,
      jitterMs: jitter
    });
    wsReconnectAttempts += 1;
    wsReconnectTimer = setTimeout(() => {
      wsReconnectTimer = null;
      hudDiagLog(WS_LOG_PREFIX, 'reconnect_fired', {
        reconnectAttempt: reconnectAttempt
      });
      connectWs();
    }, delayMs);
  }

  function connectWs() {
    const existing = window._hudWs;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const attempt = ++wsConnectAttempt;
    const wsUrl = HUD.utils.wsUrl(location);
    hudDiagLog(WS_LOG_PREFIX, 'connect_attempt', {
      attempt: attempt,
      url: wsUrl
    });

    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      hudDiagLog(WS_LOG_PREFIX, 'connect_constructor_error', {
        attempt: attempt,
        url: wsUrl
      });
      startPolling();
      setConnectionStatus(false);
      scheduleWsReconnect('constructor_error');
      return;
    }

    window._hudWs = ws;
    let opened = false;

    ws.onopen = () => {
      if (window._hudWs !== ws) return;
      opened = true;
      wsEverOpened = true;
      wsReconnectAttempts = 0;
      clearWsReconnectTimer();
      stopPolling();
      setConnectionStatus(true);
      hudDiagLog(WS_LOG_PREFIX, 'open', {
        attempt: attempt,
        url: wsUrl
      });
      if (window._flushChatWsQueue) window._flushChatWsQueue();
    };
    ws.onmessage = e => {
      const data = JSON.parse(e.data);
      if (data.type === 'tick') fetchAll();
      if (window.handleChatWsMessage) window.handleChatWsMessage(data);
    };
    ws.onclose = evt => {
      if (window._hudWs === ws) window._hudWs = null;
      startPolling();
      setConnectionStatus(false);
      hudDiagLog(WS_LOG_PREFIX, 'close', {
        attempt: attempt,
        url: wsUrl,
        code: evt && typeof evt.code === 'number' ? evt.code : '',
        reason: evt && typeof evt.reason === 'string' ? evt.reason : '',
        wasClean: evt && typeof evt.wasClean === 'boolean' ? evt.wasClean : '',
        opened: opened
      });
      if (!opened) scheduleWsReconnect('close_before_open');
    };
    ws.onerror = () => {
      setConnectionStatus(false);
      hudDiagLog(WS_LOG_PREFIX, 'error', {
        attempt: attempt,
        url: wsUrl,
        opened: opened
      });
      if (!opened) scheduleWsReconnect('error_before_open');
    };
  }

  connectWs();
})();
